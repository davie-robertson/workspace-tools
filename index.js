import 'dotenv/config';
import fs from 'fs'; // For writing JSON output
import { google } from 'googleapis';
import {
  callWithRetry,
  getAuthenticatedClient,
  getAuthenticatedClientForUser,
  getUserQuotaInfo,
} from './API-Calls.js';
import { dataTransferMonitor } from './data-transfer-monitor.js';
import {
  streamingLogger,
  initializeStreamingLogs,
} from './streaming-logger.js';
import {
  findLinksInDoc,
  findLinksInSheet,
  findLinksInSlide,
} from './file-scanners.js';
import { getAllUsers, listUserFiles } from './user-file-management.js';
import { getFileType, cleanupStreamingLogs } from './utils.js';
import { parseArgs, validateArgs, showHelp } from './cli.js';

// Parse the command line arguments
const argv = parseArgs();

// Check for help argument
if (argv.help || argv.h) {
  showHelp();
  process.exit(0);
}

// Validate the parsed arguments
try {
  validateArgs(argv);
} catch (error) {
  console.error(`Error: ${error.message}`);
  process.exit(1);
}

// Process --users argument: split by comma, trim whitespace, convert to lowercase.
// If not provided, filterUsers will be null (scan all users, unless singleFileId is given).
const filterUsers = argv.users
  ? argv.users.split(',').map((u) => u.trim().toLowerCase())
  : null;
// Process --types argument: split by comma, trim whitespace, convert to lowercase.
// If not provided, filterTypes will be null (scan all supported file types).
const filterTypes = argv.types
  ? argv.types.split(',').map((t) => t.trim().toLowerCase())
  : null;
// Process --file argument: specifies a single file ID to scan.
const singleFileId = argv.file;
// Process --json-output argument: specifies the path for the JSON output file.
export const jsonOutputFilePath = argv['json-output']; // Matches the new argument name
// Process --json-output-mode argument: 'overwrite' or 'append'.
const jsonOutputMode = argv['json-output-mode'] || 'overwrite'; // Default to 'overwrite'
// Process --sheets-output flag: determines if Google Sheets output should be generated
const sheetsOutput = argv['sheets-output'] || false;

// --- ENVIRONMENT VARIABLES ---
// SECURITY: ADMIN_USER is critical as it defines the user context for Google Workspace Admin SDK calls.
// This user MUST have necessary administrative privileges.
export const ADMIN_USER = process.env.ADMIN_USER;
// SECURITY: OUTPUT_SHEET_ID is the ID of the Google Sheet where results are written.
// Only required if --sheets-output flag is used.
const OUTPUT_SHEET_ID = process.env.OUTPUT_SHEET_ID;

// Validate that essential environment variables are set.
if (!ADMIN_USER) {
  console.error(
    "Missing required environment variable: ADMIN_USER. This user account is used to impersonate and access other users' Drive data and list users via the Admin SDK."
  );
  process.exit(1);
}

// Validate Google Sheets configuration if requested
if (sheetsOutput && !OUTPUT_SHEET_ID) {
  console.error(
    'Google Sheets output requested (--sheets-output) but OUTPUT_SHEET_ID environment variable is not set. Please set OUTPUT_SHEET_ID in your .env file or remove the --sheets-output flag.'
  );
  process.exit(1);
}
// SECURITY: GOOGLE_APPLICATION_CREDENTIALS points to the service account key file.
// This file contains sensitive credentials. Protect it accordingly (e.g., file permissions, .gitignore).
// The service account needs domain-wide delegation enabled and the necessary OAuth scopes granted.
if (!process.env.GOOGLE_APPLICATION_CREDENTIALS) {
  console.error(
    'Missing GOOGLE_APPLICATION_CREDENTIALS environment variable. This should be the path to your service account JSON key file. This key is used for authentication with Google APIs.'
  );
  process.exit(1);
}

// --- MAIN LOGIC ---
// The main function orchestrates the entire audit process.
async function main() {
  try {
    // Initialize streaming logs for the scan
    initializeStreamingLogs();

    const auth = await getAuthenticatedClient();
    const admin = google.admin({ version: 'directory_v1', auth });
    const drive = google.drive({ version: 'v3', auth });
    const docs = google.docs({ version: 'v1', auth });
    const sheets = google.sheets({ version: 'v4', auth });
    const slides = google.slides({ version: 'v1', auth });

    // Determine users to scan based on CLI arguments.
    // This logic handles different scenarios: single file scan, user-filtered scan, or full domain scan.
    let usersToScan = [];
    // Determine the list of users to scan.
    // If a singleFileId is provided and specific users are filtered, use those users.
    // This allows scanning a specific file in the context of a particular user (e.g., for permissions).
    if (singleFileId && filterUsers && filterUsers.length > 0) {
      usersToScan = filterUsers.map((email) => ({
        primaryEmail: email.toLowerCase(),
      }));
      console.log(
        `Targeting specific users for single file scan: ${filterUsers.join(
          ', '
        )}`
      );
    } else if (!singleFileId) {
      // If not a single file scan, fetch all non-suspended, non-archived users from the domain.
      // If filterUsers is set, filter this list.
      const allUsers = await getAllUsers(admin);
      usersToScan = filterUsers
        ? allUsers.filter((user) =>
            filterUsers.includes(user.primaryEmail.toLowerCase())
          )
        : allUsers;
      console.log(
        `Found ${allUsers.length} total users. Will scan ${usersToScan.length} users.`
      );
    } else {
      // Single file scan without user filter - need to fetch all users to find file owner
      const allUsers = await getAllUsers(admin);

      if (filterUsers && filterUsers.length > 0) {
        // If specific users are filtered, use only those users
        usersToScan = filterUsers.map((email) => ({
          primaryEmail: email,
        }));
        console.log(
          `Single file scan with user filter. Will check ${usersToScan.length} users.`
        );
      } else {
        // No user filter specified - need to scan all users to find file owner
        usersToScan = allUsers
          ? allUsers.filter((user) => user.primaryEmail)
          : [];
        console.log(
          `Single file scan with no user filter. Will check all ${usersToScan.length} users to find file owner.`
        );
      }
    }

    // Initialize arrays and objects to store scan results.
    const allFilesData = []; // Stores detailed data for each file found with links/issues.

    // Initialize statistics objects.
    const userStats = {}; // Per-user statistics.
    const totalStats = {
      // Overall statistics.
      doc: 0,
      sheet: 0,
      slide: 0,
      other: 0, // Count of files not Docs, Sheets, or Slides
      docWithLinks: 0,
      sheetWithLinks: 0,
      slideWithLinks: 0,
      otherWithLinks: 0, // Currently not populated, consider if needed
      sheetWithIncompatibleFunctions: 0,
    };

    // Prepare output: Confirm JSON output path if provided.
    // Google Sheets will be generated from streaming logs after scanning is complete.
    if (jsonOutputFilePath) {
      console.log(`JSON output will be written to: ${jsonOutputFilePath}`);
    }

    // --- SINGLE FILE SCAN LOGIC ---
    // Handles the case where the --file <ID> argument is provided.
    // Scans only the specified file, not iterating through users' drives.
    if (singleFileId) {
      // SECURITY: Check if the single file ID is the same as the output sheet ID.
      // If so, skip scanning to prevent accidental modification or infinite loops if script writes to it.
      if (singleFileId === OUTPUT_SHEET_ID) {
        console.warn(
          `Skipping scan of OUTPUT_SHEET_ID (${OUTPUT_SHEET_ID}) to prevent conflicts.`
        );
        // Consider if an exit or different handling is needed here. For now, it just skips.
      } else {
        console.log(`Fetching metadata for single file ${singleFileId}...`);
        let fileMetadata;
        let contextUserEmail;

        // Try to find which user owns this file by attempting to access it as each user
        let foundOwner = false;
        for (const user of usersToScan) {
          try {
            const userAuthClient = await getAuthenticatedClientForUser(
              user.primaryEmail
            );
            const userDrive = google.drive({
              version: 'v3',
              auth: userAuthClient,
            });

            fileMetadata = await callWithRetry(() =>
              userDrive.files.get({
                fileId: singleFileId,
                fields:
                  'id, name, mimeType, webViewLink, owners(emailAddress), createdTime, modifiedTime, size',
                supportsAllDrives: true,
              })
            );

            // Track file metadata retrieval
            dataTransferMonitor.trackFileMetadata(
              singleFileId,
              fileMetadata.data
            );

            contextUserEmail = user.primaryEmail;
            foundOwner = true;
            console.log(
              `File ${singleFileId} found in ${contextUserEmail}'s accessible files.`
            );
            break;
          } catch (e) {
            // File not accessible by this user, try next user
            continue;
          }
        }

        if (!foundOwner) {
          console.error(
            `File ${singleFileId} not found or not accessible by any user in the domain.`
          );
          throw new Error(`File ${singleFileId} not accessible`);
        }

        // Get quota information for the context user
        console.log(`Getting quota information for ${contextUserEmail}...`);
        const contextUserQuotaInfo = await getUserQuotaInfo(contextUserEmail);

        // Initialize userStats for the context user if not already present
        if (!userStats[contextUserEmail]) {
          userStats[contextUserEmail] = {
            doc: 0,
            sheet: 0,
            slide: 0,
            other: 0,
            docWithLinks: 0,
            sheetWithLinks: 0,
            slideWithLinks: 0,
            otherWithLinks: 0,
            sheetWithIncompatibleFunctions: 0,
            quotaInfo: contextUserQuotaInfo,
          };
        }

        let links = [];
        let incompatibleFunctions = [];
        const fileType = getFileType(fileMetadata.data.mimeType);
        console.log(
          `Scanning single file: ${fileMetadata.data.name} (${fileType})`
        );

        try {
          switch (fileMetadata.data.mimeType) {
            case 'application/vnd.google-apps.document':
              links = await findLinksInDoc(singleFileId, contextUserEmail);
              break;
            case 'application/vnd.google-apps.spreadsheet':
              const sheetData = await findLinksInSheet(
                singleFileId,
                contextUserEmail
              );
              links = sheetData.links;
              incompatibleFunctions = sheetData.incompatibleFunctions;
              break;
            case 'application/vnd.google-apps.presentation':
              links = await findLinksInSlide(singleFileId, contextUserEmail);
              break;
            default:
              console.log(
                `File type ${fileMetadata.data.mimeType} is not scannable for links.`
              );
          }
        } catch (e) {
          console.error(
            `Error scanning file ${singleFileId} (${fileMetadata.data.name}): ${e.message}`
          );
          console.error(`Detailed error scanning file:`, e);
        }

        const owner =
          fileMetadata.data.owners?.[0]?.emailAddress || 'Unknown Owner';
        const fileData = {
          ownerEmail: owner,
          fileName: fileMetadata.data.name,
          createdTime: fileMetadata.data.createdTime,
          modifiedTime: fileMetadata.data.modifiedTime,
          size: fileMetadata.data.size,
          fileId: fileMetadata.data.id,
          fileType: fileType,
          fileUrl: fileMetadata.data.webViewLink,
          linkedItems: links,
        };
        if (
          fileMetadata.data.mimeType ===
          'application/vnd.google-apps.spreadsheet'
        ) {
          fileData.incompatibleFunctions = incompatibleFunctions;
        }
        allFilesData.push(fileData);

        // Stream file data for single file scan
        streamingLogger.logFile(fileData);

        if (jsonOutputFilePath) {
          // JSON output handled after main loop.
        } else if (OUTPUT_SHEET_ID) {
          // Legacy row data structure no longer used - sheets built from streaming logs
          // Note: rowsForSheet removed - sheets are now built from streaming logs
        }
        console.log(
          `Single file scan complete for ${fileMetadata.data.name}. Found ${links.length} links/references.` +
            (incompatibleFunctions.length > 0
              ? ` ${incompatibleFunctions.length} incompatible functions.`
              : '')
        );
      }
    } else {
      // --- MULTI-FILE SCAN LOGIC (Iterate through users) ---
      for (const [idx, user] of usersToScan.entries()) {
        const userEmail = user.primaryEmail;
        console.log(
          `Scanning files for user ${userEmail} (${idx + 1} of ${
            usersToScan.length
          })`
        );

        // Stream user processing start
        streamingLogger.logUserStart(userEmail, idx, usersToScan.length);

        let files = await listUserFiles(userEmail);
        console.log(
          `User ${userEmail}: Found ${files.length} files. Analyzing...`
        );

        // Get user quota information
        console.log(`Getting quota information for ${userEmail}...`);
        const userQuotaInfo = await getUserQuotaInfo(userEmail);

        // Stream quota data
        streamingLogger.logQuota(userEmail, userQuotaInfo);

        userStats[userEmail] = {
          doc: 0,
          sheet: 0,
          slide: 0,
          other: 0,
          docWithLinks: 0,
          sheetWithLinks: 0,
          slideWithLinks: 0,
          otherWithLinks: 0,
          sheetWithIncompatibleFunctions: 0,
          quotaInfo: userQuotaInfo,
        };

        if (filterTypes) {
          files = files.filter((file) => {
            const fileTypeSimple = getFileType(file.mimeType)
              .toLowerCase()
              .replace('google ', '');
            return filterTypes.includes(fileTypeSimple);
          });
          console.log(
            `Filtered to ${files.length} files based on specified types for ${userEmail}.`
          );
        }

        for (const [fileIdx, file] of files.entries()) {
          if (file.id === OUTPUT_SHEET_ID) {
            console.warn(
              `Skipping scan of OUTPUT_SHEET_ID (${file.id}) found in ${userEmail}'s files.`
            );
            continue;
          }

          console.log(
            `user ${userEmail} : Scanning file (${fileIdx + 1} of ${
              files.length
            })`
          );

          const fileType = getFileType(file.mimeType);
          let links = [];
          let incompatibleFunctions = [];

          switch (fileType) {
            case 'Google Doc':
              totalStats.doc++;
              userStats[userEmail].doc++;
              try {
                links = await findLinksInDoc(file.id, userEmail);
              } catch (error) {
                console.error(
                  `Error scanning Google Doc ${file.name}: ${error.message}`
                );
              }
              break;

            case 'Google Sheet':
              totalStats.sheet++;
              userStats[userEmail].sheet++;
              try {
                const sheetData = await findLinksInSheet(file.id, userEmail);
                links = sheetData.links;
                incompatibleFunctions = sheetData.incompatibleFunctions;
              } catch (error) {
                console.error(
                  `Error scanning Google Sheet ${file.name}: ${error.message}`
                );
              }
              break;

            case 'Google Slide':
              totalStats.slide++;
              userStats[userEmail].slide++;
              try {
                links = await findLinksInSlide(file.id, userEmail);
              } catch (error) {
                console.error(
                  `Error scanning Google Slide ${file.name}: ${error.message}`
                );
              }
              break;

            default:
              totalStats.other++;
              userStats[userEmail].other++;
              console.log(`File type ${fileType} is not scannable for links.`);
          }

          if (links.length > 0) {
            switch (fileType) {
              case 'Google Doc':
                totalStats.docWithLinks++;
                userStats[userEmail].docWithLinks++;
                break;
              case 'Google Sheet':
                totalStats.sheetWithLinks++;
                userStats[userEmail].sheetWithLinks++;
                break;
              case 'Google Slide':
                totalStats.slideWithLinks++;
                userStats[userEmail].slideWithLinks++;
                break;
            }
          }
          if (incompatibleFunctions.length > 0 && fileType === 'Google Sheet') {
            totalStats.sheetWithIncompatibleFunctions++;
            userStats[userEmail].sheetWithIncompatibleFunctions++;
          }

          // Create file data for all scanned files
          const fileData = {
            ownerEmail: userEmail,
            fileName: file.name,
            createdTime: file.createdTime,
            modifiedTime: file.modifiedTime,
            size: file.size,
            fileId: file.id,
            fileType: fileType,
            fileUrl: file.webViewLink,
            linkedItems: links,
          };
          if (file.mimeType === 'application/vnd.google-apps.spreadsheet') {
            fileData.incompatibleFunctions = incompatibleFunctions;
          }
          allFilesData.push(fileData);

          // Stream file data immediately (for all files, not just those with issues)
          streamingLogger.logFile(fileData);

          if (!jsonOutputFilePath && OUTPUT_SHEET_ID) {
            // Legacy row data structure no longer used - sheets built from streaming logs
            // Note: rowsForSheet removed - sheets are now built from streaming logs
          }
        }

        // Log user processing completion
        streamingLogger.logUserComplete(userEmail, userStats[userEmail]);
      }
    }

    // Log scan completion
    const scanEndTime = new Date();
    const scanDuration = Math.round(
      (scanEndTime - streamingLogger.startTime) / 1000
    );
    streamingLogger.logScanComplete(totalStats, userStats, scanDuration);

    // --- OUTPUT GENERATION ---
    if (jsonOutputFilePath) {
      console.log(`Preparing JSON output: ${jsonOutputFilePath}`);

      // Check if we should use streaming logs for consolidated JSON (more memory efficient)
      const useStreamingConsolidation = allFilesData.length > 1000; // Use streaming for large datasets

      if (useStreamingConsolidation) {
        console.log(
          'Large dataset detected. Using streaming logs for JSON generation...'
        );
        try {
          streamingLogger.generateConsolidatedJSON(jsonOutputFilePath);
          console.log(
            `Streaming JSON output written to: ${jsonOutputFilePath}`
          );

          // Print log stats
          const logStats = streamingLogger.getLogStats();
          console.log(`Log files created:`);
          console.log(
            `  Scan log: ${streamingLogger.scanLogPath} (${logStats.scanLogSizeFormatted})`
          );
          console.log(
            `  Summary log: ${streamingLogger.summaryLogPath} (${logStats.summaryLogSizeFormatted})`
          );
        } catch (error) {
          console.error(
            'Failed to generate consolidated JSON from streams. Falling back to memory-based approach.'
          );
          console.error(error.message);
          // Fall through to traditional approach
        }
      }

      if (
        !useStreamingConsolidation ||
        fs.existsSync(jsonOutputFilePath) === false
      ) {
        // Traditional approach - keep all data in memory
        let jsonDataToWrite = {
          summary: {
            totalStats: JSON.parse(JSON.stringify(totalStats)),
            userStats: JSON.parse(JSON.stringify(userStats)),
            generationDate: new Date().toISOString(),
          },
          files: JSON.parse(JSON.stringify(allFilesData)),
        };

        if (jsonOutputMode === 'append' && fs.existsSync(jsonOutputFilePath)) {
          console.log(
            `Attempting to append to existing JSON file: ${jsonOutputFilePath}`
          );
          try {
            const existingJsonString = fs.readFileSync(
              jsonOutputFilePath,
              'utf-8'
            );
            const existingJsonData = JSON.parse(existingJsonString);
            jsonDataToWrite.files = (existingJsonData.files || []).concat(
              jsonDataToWrite.files
            );
            const newTotalStats = JSON.parse(
              JSON.stringify(existingJsonData.summary?.totalStats || {})
            );
            for (const key in totalStats) {
              newTotalStats[key] = (newTotalStats[key] || 0) + totalStats[key];
            }
            jsonDataToWrite.summary.totalStats = newTotalStats;
            const newUserStats = JSON.parse(
              JSON.stringify(existingJsonData.summary?.userStats || {})
            );
            for (const userEmail in userStats) {
              if (!newUserStats[userEmail]) {
                newUserStats[userEmail] = JSON.parse(
                  JSON.stringify(userStats[userEmail])
                );
              } else {
                for (const key in userStats[userEmail]) {
                  newUserStats[userEmail][key] =
                    (newUserStats[userEmail][key] || 0) +
                    userStats[userEmail][key];
                }
              }
            }
            jsonDataToWrite.summary.userStats = newUserStats;
            jsonDataToWrite.summary.generationDate = new Date().toISOString();
            console.log(
              `Successfully prepared data for appending to ${jsonOutputFilePath}.`
            );
          } catch (e) {
            console.error(
              `Error reading/parsing existing JSON for append: ${e.message}. Will overwrite with current scan data as a fallback.`
            );
            jsonDataToWrite = {
              summary: {
                totalStats: JSON.parse(JSON.stringify(totalStats)),
                userStats: JSON.parse(JSON.stringify(userStats)),
                generationDate: new Date().toISOString(),
              },
              files: JSON.parse(JSON.stringify(allFilesData)),
            };
          }
        } else if (
          jsonOutputMode === 'append' &&
          !fs.existsSync(jsonOutputFilePath)
        ) {
          console.log(
            `JSON file ${jsonOutputFilePath} not found. Will create a new file.`
          );
        } else {
          console.log(
            `Overwriting or creating new JSON file: ${jsonOutputFilePath}`
          );
        }

        try {
          fs.writeFileSync(
            jsonOutputFilePath,
            JSON.stringify(jsonDataToWrite, null, 2)
          );
          console.log(`Audit results written to ${jsonOutputFilePath}`);
        } catch (e) {
          console.error(
            `Failed to write JSON to ${jsonOutputFilePath}: ${e.message}`
          );
          console.error(e);
        }
      } // End of traditional approach block
    }

    // Google Sheets output (if requested)
    if (sheetsOutput && OUTPUT_SHEET_ID) {
      console.log('Building Google Sheets from streaming logs...');

      try {
        const { buildSheetsFromStreamingLogs } = await import(
          './build-sheet.js'
        );
        await buildSheetsFromStreamingLogs(
          sheets,
          OUTPUT_SHEET_ID,
          streamingLogger.scanLogPath,
          streamingLogger.summaryLogPath
        );
        console.log(
          'Audit complete! Issue-based results written to Google Sheet.'
        );
      } catch (error) {
        console.error(
          'Failed to build sheets from streaming logs:',
          error.message
        );
        console.error('Google Sheets output failed.');
      }
    }

    // Always print data transfer report and log stats
    dataTransferMonitor.printReport();

    const logStats = streamingLogger.getLogStats();
    console.log(`\nStreaming logs created:`);
    console.log(
      `  Scan log: ${streamingLogger.scanLogPath} (${logStats.scanLogSizeFormatted})`
    );
    console.log(
      `  Summary log: ${streamingLogger.summaryLogPath} (${logStats.summaryLogSizeFormatted})`
    );

    if (!jsonOutputFilePath && !sheetsOutput) {
      console.log('\nTo export data, use:');
      console.log('  --json-output <path>     Export consolidated JSON');
      console.log(
        '  --sheets-output          Export to Google Sheets (requires OUTPUT_SHEET_ID)'
      );
    }

    // Clean up streaming log files after processing is complete
    cleanupStreamingLogs(streamingLogger);
  } catch (error) {
    console.error('Audit failed:', error);
    // Clean up streaming logs even on error
    cleanupStreamingLogs(streamingLogger);
    process.exit(1);
  }
}

// --- SCRIPT EXECUTION ---
main().catch((error) => {
  console.error('Unhandled error at top level:', error, error.stack);
  process.exit(1);
});
