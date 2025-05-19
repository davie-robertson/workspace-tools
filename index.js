import 'dotenv/config';
import fs from 'fs'; // For writing JSON output
import { GoogleAuth } from 'google-auth-library';
import { google } from 'googleapis';

// --- CLI PARAMS ---
// Parses command-line arguments provided to the script.
// Supports:
// --users: Comma-separated list of user emails to filter scans by.
// --types: Comma-separated list of file types (doc, sheet, slide) to filter scans by.
// --file: A single file ID to scan, bypassing the multi-user/multi-file scan.
// --json-output <filepath>: Path to a file where JSON output should be written.
// --json-output-mode <overwrite|append>: Mode for JSON output if the file exists. Defaults to 'overwrite'.
function parseArgs() {
  const args = process.argv.slice(2); // Skip 'node' and script path
  const result = {};
  for (let i = 0; i < args.length; i++) {
    if (args[i].startsWith('--')) {
      const key = args[i].substring(2);
      // Check if next argument exists and is not another option
      if (i + 1 < args.length && !args[i + 1].startsWith('--')) {
        result[key] = args[i + 1];
        i++; // Skip the value argument
      } else {
        result[key] = true; // For boolean flags without explicit values
      }
    }
  }
  return result;
}

// Parse the command line arguments
const argv = parseArgs();
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
// Renamed from 'jsonOutputFile' in argv to 'jsonOutputFilePath' for clarity.
const jsonOutputFilePath = argv['json-output']; // Matches the new argument name
// Process --json-output-mode argument: 'overwrite' or 'append'.
const jsonOutputMode = argv['json-output-mode'] || 'overwrite'; // Default to 'overwrite'

// --- ENVIRONMENT VARIABLES ---
// SECURITY: ADMIN_USER is critical as it defines the user context for Google Workspace Admin SDK calls.
// This user MUST have necessary administrative privileges.
const ADMIN_USER = process.env.ADMIN_USER;
// SECURITY: OUTPUT_SHEET_ID is the ID of the Google Sheet where results are written.
// Ensure this Sheet has appropriate permissions if it contains sensitive audit data.
const OUTPUT_SHEET_ID = process.env.OUTPUT_SHEET_ID;

// Validate that essential environment variables are set.
if (!ADMIN_USER) {
  console.error(
    "Missing required environment variable: ADMIN_USER. This user account is used to impersonate and access other users' Drive data and list users via the Admin SDK."
  );
  process.exit(1);
}
// Ensure at least one output method is configured.
if (!jsonOutputFilePath && !OUTPUT_SHEET_ID) {
  console.error(
    'Missing output configuration: Provide either OUTPUT_SHEET_ID (for Google Sheets output) in .env or --json-output <filepath> (for JSON output) via CLI.'
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

// --- CONSTANTS ---
// Define the OAuth scopes required by the script.
// SECURITY: These scopes define the permissions the script requests.
// Review them to ensure they are the minimum necessary for the script's functionality.
// - admin.directory.user.readonly: To list users in the domain.
// - drive.readonly: To read files and their metadata from Google Drive.
// - documents.readonly: To read content from Google Docs.
// - presentations.readonly: To read content from Google Slides.
// - spreadsheets: To read content from Google Sheets and write audit results (if OUTPUT_SHEET_ID is used).
const SCOPES = [
  'https://www.googleapis.com/auth/admin.directory.user.readonly', // To list users
  'https://www.googleapis.com/auth/drive.readonly', // To list and read files
  'https://www.googleapis.com/auth/documents.readonly', // To read Google Docs
  'https://www.googleapis.com/auth/presentations.readonly', // To read Google Slides
  'https://www.googleapis.com/auth/spreadsheets', // Read and Write for output and analysis
];

// List of Google Sheets functions considered specific to Google Workspace,
// which might cause compatibility issues if migrating to other platforms (e.g., Excel).
const GSUITE_SPECIFIC_FUNCTIONS = [
  'QUERY',
  'FILTER',
  'SORTN',
  'UNIQUE',
  'ARRAYFORMULA',
  'GOOGLEFINANCE',
  'GOOGLETRANSLATE',
  'IMPORTHTML',
  'IMPORTXML',
  'IMPORTFEED',
  'IMPORTRANGE', // Particularly important for identifying external data links
  'SPLIT',
  'JOIN',
  'REGEXMATCH',
  'REGEXEXTRACT',
  'REGEXREPLACE',
  'SPARKLINE',
  'FLATTEN',
  'CONTINUE',
  'LAMBDA',
  'MAP',
  'REDUCE',
  'SCAN',
  'MAKEARRAY',
  'BYROW',
  'BYCOL',
  'DETECTLANGUAGE',
  'ARRAY_CONSTRAIN',
  'SORT',
  'CONCAT',
].map((f) => f.toUpperCase()); // Standardize to uppercase for case-insensitive comparison.

// Maximum number of characters allowed in a single Google Sheet cell.
// A buffer is included to prevent errors.
const MAX_CELL_CHARACTERS = 49500; // Max characters for a cell, with some buffer

// --- Helper function to truncate string for sheet cell ---
// Truncates an array of items (strings) into a single string, separated by `separator`,
// ensuring the total length does not exceed MAX_CELL_CHARACTERS.
// Used to prevent errors when writing long lists of links or functions to a Google Sheet cell.
// `forFunctions` flag is currently unused but could be for future specific formatting.
function truncateItemsForCell(
  itemsArray,
  separator = '; ',
  forFunctions = false // Unused parameter, consider removing if not planned for future use
) {
  if (!itemsArray || itemsArray.length === 0) {
    return '';
  }

  let fullString = itemsArray.join(separator);
  if (fullString.length <= MAX_CELL_CHARACTERS) {
    return fullString;
  }

  // If the full string is too long, truncate it item by item.
  let truncatedString = '';
  let itemsIncludedCount = 0;
  for (let i = 0; i < itemsArray.length; i++) {
    const item = itemsArray[i];
    // Check if adding the next item (plus separator) would exceed the limit.
    if (
      truncatedString.length +
        (truncatedString ? separator.length : 0) +
        item.length >
      MAX_CELL_CHARACTERS - 50 // 50 char buffer for the "and X more items" message
    ) {
      break;
    }
    if (truncatedString) {
      truncatedString += separator;
    }
    truncatedString += item;
    itemsIncludedCount++;
  }
  const remainingItems = itemsArray.length - itemsIncludedCount;
  // Add a message indicating truncation and if full list is in JSON.
  const seeJsonMessage = jsonOutputFilePath ? ', see JSON for full list' : '';
  truncatedString += `${separator}... (and ${remainingItems} more item${
    remainingItems > 1 ? 's' : ''
  }${seeJsonMessage})`;

  // Final check to ensure the truncated message itself isn't too long.
  if (truncatedString.length > MAX_CELL_CHARACTERS) {
    return (
      truncatedString.substring(0, MAX_CELL_CHARACTERS - 50) + // Adjusted buffer
      `... (TRUNCATED${seeJsonMessage})`
    );
  }
  return truncatedString;
}

// --- API RETRY HELPER ---
// A robust wrapper for Google API calls that implements an exponential backoff retry mechanism.
// This helps handle transient errors like rate limits (403, 429) or server errors (500, 503).
// `apiCallFunction`: The async function to call (e.g., a Google API request).
// `maxRetries`: Maximum number of times to retry the API call.
// `initialDelay`: Initial delay in milliseconds before the first retry.
async function callWithRetry(
  apiCallFunction, // The function that makes the API call
  maxRetries = 5, // Maximum number of retries
  initialDelay = 1000 // Initial delay in milliseconds for backoff
) {
  let retries = 0;
  while (true) {
    try {
      return await apiCallFunction();
    } catch (error) {
      const isRetryable =
        error.code === 403 ||
        error.code === 429 ||
        error.code === 500 ||
        error.code === 503;

      if (isRetryable && retries < maxRetries) {
        retries++;
        const delay =
          initialDelay * Math.pow(2, retries - 1) + Math.random() * 1000;
        console.warn(
          `API call failed (attempt ${retries}/${maxRetries}): ${
            error.message
          }. Retrying in ${Math.round(delay / 1000)}s...`
        );
        await new Promise((resolve) => setTimeout(resolve, delay));
      } else {
        throw error;
      }
    }
  }
}

// --- AUTH ---
// Authenticates with Google APIs using a service account and domain-wide delegation.
// The service account key is specified by GOOGLE_APPLICATION_CREDENTIALS env var.
// Impersonates ADMIN_USER for Admin SDK calls and potentially for Drive access if needed broadly,
// though Drive access is typically per-user in listUserFiles.
async function getAuthenticatedClient() {
  try {
    // Initialize GoogleAuth with specified scopes and client options (for impersonation).
    const auth = new GoogleAuth({
      scopes: SCOPES,
      // SECURITY: Subject (ADMIN_USER) is used for service account impersonation.
      // This allows the service account to act on behalf of ADMIN_USER.
      clientOptions: { subject: ADMIN_USER },
    });
    return await auth.getClient(); // Returns an authenticated OAuth2 client.
  } catch (error) {
    // Log detailed error information for authentication failures.
    console.error(
      'Error creating authenticated client:',
      error.message,
      error.stack // Include stack trace for better debugging
    );
    if (error.response?.data) {
      // Log response data if available
      console.error(
        'Error response data:',
        JSON.stringify(error.response.data, null, 2)
      );
    }
    // SECURITY: Ensure error messages do not leak overly sensitive details if logged publicly.
    throw new Error(
      `Failed to authenticate: ${error.message}. Check service account credentials, permissions, and domain-wide delegation settings.`
    );
  }
}

// --- MAIN LOGIC ---
// The main function orchestrates the entire audit process.
async function main() {
  try {
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
    if (singleFileId && filterUsers?.length > 0) {
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
      // For single file scan without specific user filter, use ADMIN_USER as context.
      // This is important because file access might depend on the user context.
      usersToScan = [{ primaryEmail: ADMIN_USER.toLowerCase() }];
      console.log(
        `No specific user filter for single file scan, using ADMIN_USER (${ADMIN_USER}) context.`
      );
    }

    // Initialize arrays and objects to store scan results.
    const allFilesData = []; // Stores detailed data for each file found with links/issues.
    const rowsForSheet = []; // Stores rows to be written to Google Sheets (if that output is used).

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

    // Prepare output: Clear Google Sheet and set headers, or confirm JSON output path.
    // This setup is done before starting the main scan loop.
    if (!jsonOutputFilePath && OUTPUT_SHEET_ID) {
      console.log('Preparing output Google Sheet...');
      await clearAndSetHeaders(sheets, OUTPUT_SHEET_ID);
    } else if (jsonOutputFilePath) {
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
        // Determine user context for the single file scan.
        // If usersToScan was populated (e.g. by --users), use the first one. Otherwise, default to ADMIN_USER.
        const contextUserEmail = usersToScan[0]?.primaryEmail || ADMIN_USER;
        console.log(`Fetching metadata for single file ${singleFileId}...`);
        let fileMetadata;
        try {
          fileMetadata = await callWithRetry(() =>
            drive.files.get({
              fileId: singleFileId,
              fields: 'id, name, mimeType, webViewLink, owners(emailAddress)',
              supportsAllDrives: true,
            })
          );
        } catch (e) {
          console.error(
            `Failed to fetch metadata for file ${singleFileId}: ${e.message}`
          );
          throw e;
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
              links = await findLinksInDoc(docs, drive, singleFileId);
              break;
            case 'application/vnd.google-apps.spreadsheet':
              const sheetData = await findLinksInSheet(
                sheets,
                drive,
                singleFileId
              );
              links = sheetData.links;
              incompatibleFunctions = sheetData.incompatibleFunctions;
              break;
            case 'application/vnd.google-apps.presentation':
              links = await findLinksInSlide(slides, drive, singleFileId);
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

        if (jsonOutputFilePath) {
          // JSON output handled after main loop.
        } else if (OUTPUT_SHEET_ID) {
          const row = [
            owner,
            fileMetadata.data.name,
            fileMetadata.data.id,
            fileType,
            fileMetadata.data.webViewLink,
            truncateItemsForCell(links),
            truncateItemsForCell(incompatibleFunctions, '; ', true),
          ];
          rowsForSheet.push(row);
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

        let files = await listUserFiles(drive, userEmail);
        console.log(
          `User ${userEmail}: Found ${files.length} files. Analyzing...`
        );

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
                links = await findLinksInDoc(docs, drive, file.id);
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
                const sheetData = await findLinksInSheet(
                  sheets,
                  drive,
                  file.id
                );
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
                links = await findLinksInSlide(slides, drive, file.id);
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

          if (links.length > 0 || incompatibleFunctions.length > 0) {
            const fileData = {
              ownerEmail: userEmail,
              fileName: file.name,
              fileId: file.id,
              fileType: fileType,
              fileUrl: file.webViewLink,
              linkedItems: links,
            };
            if (file.mimeType === 'application/vnd.google-apps.spreadsheet') {
              fileData.incompatibleFunctions = incompatibleFunctions;
            }
            allFilesData.push(fileData);

            if (!jsonOutputFilePath && OUTPUT_SHEET_ID) {
              const row = [
                userEmail,
                file.name,
                file.id,
                fileType,
                file.webViewLink,
                truncateItemsForCell(links),
                truncateItemsForCell(incompatibleFunctions, '; ', true),
              ];
              rowsForSheet.push(row);
            }
          }
        }

        if (
          !jsonOutputFilePath &&
          OUTPUT_SHEET_ID &&
          rowsForSheet.length >= 100
        ) {
          console.log(
            `Writing batch of ${rowsForSheet.length} rows to Google Sheet for ${userEmail}...`
          );
          await appendRows(sheets, OUTPUT_SHEET_ID, rowsForSheet);
          rowsForSheet.length = 0;
        }
      }
    }

    // --- OUTPUT GENERATION ---
    if (jsonOutputFilePath) {
      console.log(`Preparing JSON output: ${jsonOutputFilePath}`);
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
    } else if (OUTPUT_SHEET_ID) {
      if (rowsForSheet.length > 0) {
        console.log(
          `Writing final batch of ${rowsForSheet.length} rows to Google Sheet...`
        );
        await appendRows(sheets, OUTPUT_SHEET_ID, rowsForSheet);
      }
      if (!singleFileId) {
        console.log('Writing summary tab to Google Sheet...');
        await writeSummaryTab(sheets, OUTPUT_SHEET_ID, userStats, totalStats);
      }
      console.log('Audit complete! Results written to Google Sheet.');
    } else {
      console.log(
        'No output method specified (JSON or Sheet ID). Results not saved.'
      );
    }
  } catch (error) {
    console.error('Audit failed:', error);
    process.exit(1);
  }
}

// --- CONSTANTS FOR SHEET NAMES ---
const AUDIT_DETAILS_SHEET_NAME = 'AuditDetails';
const SUMMARY_SHEET_NAME = 'Summary';

// --- SHEET HELPERS ---

async function clearAndSetHeaders(sheets, spreadsheetId) {
  try {
    await callWithRetry(() =>
      sheets.spreadsheets.values.clear({
        spreadsheetId,
        range: AUDIT_DETAILS_SHEET_NAME,
      })
    );
  } catch (e) {
    if (
      e.message?.includes('Unable to parse range') ||
      e.message?.toLowerCase().includes('not found')
    ) {
      console.log(`${AUDIT_DETAILS_SHEET_NAME} not found, creating...`);
      try {
        await callWithRetry(() =>
          sheets.spreadsheets.batchUpdate({
            spreadsheetId,
            requestBody: {
              requests: [
                {
                  addSheet: {
                    properties: { title: AUDIT_DETAILS_SHEET_NAME },
                  },
                },
              ],
            },
          })
        );
        console.log(`${AUDIT_DETAILS_SHEET_NAME} created.`);
      } catch (addSheetError) {
        throw addSheetError;
      }
    } else {
      throw e;
    }
  }

  const headers = [
    'Owner Email',
    'File Name',
    'File ID',
    'File Type',
    'File URL',
    'Linked Items/References (URLs, Drive IDs)',
    'GSuite Specific Functions (Sheets only)',
  ];
  await callWithRetry(() =>
    sheets.spreadsheets.values.update({
      spreadsheetId,
      range: `${AUDIT_DETAILS_SHEET_NAME}!A1`,
      valueInputOption: 'RAW',
      requestBody: { values: [headers] },
    })
  );
}

async function appendRows(sheets, spreadsheetId, rows) {
  if (rows.length === 0) return;
  await callWithRetry(() =>
    sheets.spreadsheets.values.append({
      spreadsheetId,
      range: AUDIT_DETAILS_SHEET_NAME,
      valueInputOption: 'USER_ENTERED',
      insertDataOption: 'INSERT_ROWS',
      requestBody: { values: rows },
    })
  );
}

async function writeSummaryTab(sheets, spreadsheetId, userStats, totalStats) {
  let sheetExists = false;
  try {
    const sp = await callWithRetry(() =>
      sheets.spreadsheets.get({
        spreadsheetId,
        fields: 'sheets.properties.title',
      })
    );
    sheetExists = sp.data.sheets.some(
      (s) => s.properties.title === SUMMARY_SHEET_NAME
    );
  } catch (e) {
    console.warn(
      `Could not check for summary sheet existence: ${e.message}. Will attempt to create/clear.`
    );
  }

  if (sheetExists) {
    try {
      await callWithRetry(() =>
        sheets.spreadsheets.values.clear({
          spreadsheetId,
          range: SUMMARY_SHEET_NAME,
        })
      );
    } catch (e) {
      console.warn(`Could not clear ${SUMMARY_SHEET_NAME}: ${e.message}.`);
    }
  } else {
    console.log(`Creating summary sheet: ${SUMMARY_SHEET_NAME}`);
    try {
      await callWithRetry(() =>
        sheets.spreadsheets.batchUpdate({
          spreadsheetId,
          requestBody: {
            requests: [
              { addSheet: { properties: { title: SUMMARY_SHEET_NAME } } },
            ],
          },
        })
      );
    } catch (e) {
      throw e;
    }
  }

  const header = [
    'User Email',
    'Docs Scanned',
    'Docs w/ Links',
    'Sheets Scanned',
    'Sheets w/ Links',
    'Sheets w/ Incomp. Funcs',
    'Slides Scanned',
    'Slides w/ Links',
    'Other Files Scanned',
    'Other Files w/ Links',
  ];
  const userRows = Object.entries(userStats).map(([email, stats]) => [
    email,
    stats.doc,
    stats.docWithLinks,
    stats.sheet,
    stats.sheetWithLinks,
    stats.sheetWithIncompatibleFunctions,
    stats.slide,
    stats.slideWithLinks,
    stats.other,
    stats.otherWithLinks,
  ]);
  const totalRow = [
    'TOTAL',
    totalStats.doc,
    totalStats.docWithLinks,
    totalStats.sheet,
    totalStats.sheetWithLinks,
    totalStats.sheetWithIncompatibleFunctions,
    totalStats.slide,
    totalStats.slideWithLinks,
    totalStats.other,
    totalStats.otherWithLinks,
  ];
  const allRows = [header, ...userRows, totalRow];

  await callWithRetry(() =>
    sheets.spreadsheets.values.update({
      spreadsheetId,
      range: `${SUMMARY_SHEET_NAME}!A1`,
      valueInputOption: 'USER_ENTERED',
      requestBody: { values: allRows },
    })
  );
}

// --- USER & FILE HELPERS ---

async function getAllUsers(admin) {
  let users = [];
  let pageToken;
  let pageCount = 0;
  const MAX_USERS_PER_PAGE = 500;
  do {
    pageCount++;
    const res = await callWithRetry(() =>
      admin.users.list({
        customer: 'my_customer',
        maxResults: MAX_USERS_PER_PAGE,
        pageToken,
        orderBy: 'email',
        query: 'isSuspended=false',
        projection: 'full',
      })
    );
    if (res.data.users?.length) {
      users = users.concat(
        res.data.users.filter(
          (u) => !u.suspended && !u.archived && u.primaryEmail
        )
      );
    }
    pageToken = res.data.nextPageToken;
  } while (pageToken);
  return users;
}

async function listUserFiles(drive, userEmail) {
  let files = [];
  let pageToken;
  const queryMimeTypes = [
    'application/vnd.google-apps.document',
    'application/vnd.google-apps.spreadsheet',
    'application/vnd.google-apps.presentation',
  ];
  const q = `'${userEmail}' in owners and trashed = false and (${queryMimeTypes
    .map((m) => `mimeType = '${m}'`)
    .join(' or ')})`;
  const fields =
    'nextPageToken, files(id, name, mimeType, webViewLink, owners(emailAddress))';
  const PAGE_SIZE = 1000;
  do {
    const res = await callWithRetry(() =>
      drive.files.list({
        q,
        fields,
        pageSize: PAGE_SIZE,
        pageToken,
        supportsAllDrives: true,
        includeItemsFromAllDrives: true,
        corpora: 'user',
      })
    );
    if (res.data.files?.length) files = files.concat(res.data.files);
    pageToken = res.data.nextPageToken;
  } while (pageToken);
  return files;
}

// Converts a MIME type string to a more human-readable file type string.
function getFileType(mimeType) {
  if (!mimeType) return 'Unknown Type';
  if (mimeType === 'application/vnd.google-apps.document') return 'Google Doc';
  if (mimeType === 'application/vnd.google-apps.spreadsheet')
    return 'Google Sheet';
  if (mimeType === 'application/vnd.google-apps.presentation')
    return 'Google Slide';
  if (mimeType.startsWith('application/vnd.google-apps'))
    return 'Google Workspace File';
  return mimeType;
}

// --- LINK EXTRACTION HELPERS ---
// These do not interact with APIs directly
function getDriveFileIdFromUrl(url) {
  if (typeof url !== 'string') return null;
  const patterns = [
    /https?:\/\/docs\.google\.com\/(?:document|spreadsheets|presentation|forms|drawings|file)\/d\/([a-zA-Z0-9\-_]{25,})/i,
    /https?:\/\/drive\.google\.com\/file\/d\/([a-zA-Z0-9\-_]{25,})/i,
    /https?:\/\/drive\.google\.com\/open\?id=([a-zA-Z0-9\-_]{25,})/i,
    /https?:\/\/drive\.google\.com\/drive\/(?:folders|u\/\d+\/folders)\/([a-zA-Z0-9\-_]{25,})/i,
    /https?:\/\/drive\.google\.com\/drive\/shared-drives\/([a-zA-Z0-9\-_]{15,})/i,
  ];
  for (const regex of patterns) {
    const match = url.match(regex);
    if (match?.[1]) return match[1];
  }
  return null;
}

// `resolveFileMetadata` makes an API call
async function resolveFileMetadata(drive, fileId, originalUrl) {
  try {
    const file = await callWithRetry(() =>
      drive.files.get({
        fileId,
        fields: 'name,mimeType,webViewLink,teamDriveId,driveId',
        supportsAllDrives: true,
      })
    );
    return {
      name: file.data.name || 'Unknown Name',
      type: getFileType(file.data.mimeType),
      url: file.data.webViewLink || originalUrl,
      isSharedDrive: !!(file.data.teamDriveId || file.data.driveId),
    };
  } catch (error) {
    console.warn(
      `Could not resolve metadata for file ID ${fileId} (URL: ${originalUrl}): ${error.message}`
    );
    return null;
  }
}

// `processRawUrls` calls `resolveFileMetadata`
async function processRawUrls(drive, rawUrls) {
  const uniqueRawUrls = [
    ...new Set(rawUrls.filter((url) => url && typeof url === 'string')),
  ];
  const resolvedLinkInfo = [];

  for (const url of uniqueRawUrls) {
    const fileId = getDriveFileIdFromUrl(url);
    if (fileId) {
      const metadata = await resolveFileMetadata(drive, fileId, url);
      if (metadata) {
        resolvedLinkInfo.push(
          `${url} (Name: ${metadata.name}, Type: ${metadata.type}${
            metadata.isSharedDrive ? ', Shared Drive' : ''
          })`
        );
      } else {
        resolvedLinkInfo.push(`${url} (Unresolved Drive Link: ID ${fileId})`);
      }
    } else if (url.includes('google.com/') || url.startsWith('/')) {
      resolvedLinkInfo.push(url);
    }
  }
  return resolvedLinkInfo;
}

// --- Formula/URL Extractors
function extractImportrangeIds(formula) {
  const ids = [];
  const regex = /IMPORTRANGE\s*\(\s*(?:"([^"]+)"|'([^']+)')\s*,/gi;
  let match;
  while ((match = regex.exec(formula)) !== null) {
    const val = match[1] || match[2];
    const id = getDriveFileIdFromUrl(val);
    if (id) {
      ids.push(`https://docs.google.com/spreadsheets/d/${id}`);
    } else if (val?.length >= 25 && !val.includes(' ') && !val.includes(',')) {
      ids.push(`https://docs.google.com/spreadsheets/d/${val}`);
    }
  }
  return ids;
}

function extractHyperlinkUrls(formula) {
  const urls = [];
  const regex = /HYPERLINK\s*\(\s*(?:"([^"]+)"|'([^']+)')/gi;
  let match;
  while ((match = regex.exec(formula)) !== null) {
    urls.push(match[1] || match[2]);
  }
  return urls;
}

function extractImageUrls(formula) {
  const urls = [];
  const regex = /IMAGE\s*\(\s*(?:"([^"]+)"|'([^']+)')/gi;
  let match;
  while ((match = regex.exec(formula)) !== null) {
    urls.push(match[1] || match[2]);
  }
  return urls;
}

function extractDriveLinks(text) {
  if (typeof text !== 'string' || !text) return [];
  const patterns = [
    /https?:\/\/docs\.google\.com\/(?:document|spreadsheets|presentation|forms|file|drawings)\/d\/[a-zA-Z0-9\-_]{25,}(?:\/[^#?\s]*)?/gi,
    /https?:\/\/drive\.google\.com\/(?:file\/d\/|open\?id=)[a-zA-Z0-9\-_]{25,}(?:\/[^#?\s]*)?/gi,
    /https?:\/\/drive\.google\.com\/drive\/(?:folders|u\/\d+\/folders|shared-drives)\/[a-zA-Z0-9\-_]{15,}(?:\/[^#?\s]*)?/gi,
    /https?:\/\/(?:[a-zA-Z0-9-]+\.)*google\.com\/[^\s"';<>()]+/gi,
  ];
  let foundLinks = new Set();
  for (const regex of patterns) {
    let match;
    while ((match = regex.exec(text)) !== null) {
      const potentialLink = match[0].replace(/[;,.)]$/, '');
      if (
        getDriveFileIdFromUrl(potentialLink) ||
        potentialLink.includes('docs.google.com/') ||
        potentialLink.includes('drive.google.com/')
      ) {
        foundLinks.add(potentialLink);
      }
    }
  }
  return Array.from(foundLinks);
}

function extractFunctionNamesFromFormula(formula) {
  if (typeof formula !== 'string') return [];
  const functionRegex = /\b([A-Z0-9_.]+)\s*\(/gi;
  const foundFunctions = new Set();
  let match;
  while ((match = functionRegex.exec(formula)) !== null) {
    foundFunctions.add(match[1].toUpperCase());
  }
  return Array.from(foundFunctions);
}

// --- DOCS ---
async function findLinksInDoc(docs, drive, docId) {
  const DOC_FIELDS =
    'body(content(paragraph(elements(textRun(content,textStyle.link.url),inlineObjectElement(inlineObjectId))))),inlineObjects';
  const res = await callWithRetry(() =>
    docs.documents.get({ documentId: docId, fields: DOC_FIELDS })
  );
  let rawUrls = [];
  if (res.data.body?.content) {
    for (const el of res.data.body.content) {
      if (el.paragraph?.elements) {
        for (const elem of el.paragraph.elements) {
          if (elem.textRun) {
            if (elem.textRun.textStyle?.link?.url) {
              rawUrls.push(elem.textRun.textStyle.link.url);
            }
            if (elem.textRun.content) {
              rawUrls.push(...extractDriveLinks(elem.textRun.content));
            }
          }
          if (
            elem.inlineObjectElement?.inlineObjectId &&
            res.data.inlineObjects
          ) {
            const obj =
              res.data.inlineObjects[elem.inlineObjectElement.inlineObjectId];
            if (obj?.inlineObjectProperties?.embeddedObject) {
              const emb = obj.inlineObjectProperties.embeddedObject;
              if (emb.description) {
                rawUrls.push(...extractDriveLinks(emb.description));
              }
              if (emb.imageProperties?.contentUrl) {
                rawUrls.push(emb.imageProperties.contentUrl);
              }
              if (emb.imageProperties?.sourceUrl) {
                rawUrls.push(emb.imageProperties.sourceUrl);
              }
              if (
                emb.linkedContentReference?.sheetsChartReference?.spreadsheetId
              ) {
                rawUrls.push(
                  `https://docs.google.com/spreadsheets/d/${emb.linkedContentReference.sheetsChartReference.spreadsheetId}/`
                );
              }
            }
          }
        }
      }
    }
  }
  return processRawUrls(drive, rawUrls);
}

// --- SHEETS ---
async function findLinksInSheet(sheets, drive, sheetId) {
  const SPREADSHEET_FIELDS =
    'properties.title,spreadsheetId,sheets(properties(title,sheetType,sheetId),data(rowData(values(userEnteredValue,effectiveValue,formattedValue,hyperlink,textFormatRuns.format.link.uri,dataValidation.condition.values.userEnteredValue))),charts(chartId,spec),conditionalFormats(booleanRule(condition(values(userEnteredValue)))))';
  const res = await callWithRetry(() =>
    sheets.spreadsheets.get({
      spreadsheetId: sheetId,
      fields: SPREADSHEET_FIELDS,
    })
  );

  let rawUrls = [];
  let allFormulaFunctions = new Set();

  if (res.data?.sheets) {
    for (const sheet of res.data.sheets) {
      if (sheet.data) {
        for (const gridData of sheet.data) {
          if (gridData.rowData) {
            for (const row of gridData.rowData) {
              if (row.values) {
                for (const cell of row.values) {
                  if (!cell) continue;
                  const formula =
                    cell.userEnteredValue?.formulaValue ||
                    cell.effectiveValue?.formulaValue;
                  if (formula) {
                    rawUrls.push(
                      ...extractImportrangeIds(formula),
                      ...extractHyperlinkUrls(formula),
                      ...extractImageUrls(formula),
                      ...extractDriveLinks(formula)
                    );
                    extractFunctionNamesFromFormula(formula).forEach((fn) =>
                      allFormulaFunctions.add(fn)
                    );
                  }
                  if (cell.hyperlink) rawUrls.push(cell.hyperlink);
                  cell.textFormatRuns?.forEach((run) => {
                    if (run.format?.link?.uri) {
                      rawUrls.push(run.format.link.uri);
                    }
                  });
                  const plainText =
                    cell.userEnteredValue?.stringValue || cell.formattedValue;
                  if (plainText) rawUrls.push(...extractDriveLinks(plainText));
                  cell.dataValidation?.condition?.values?.forEach((v) => {
                    if (v.userEnteredValue) {
                      rawUrls.push(...extractDriveLinks(v.userEnteredValue));
                      extractFunctionNamesFromFormula(
                        v.userEnteredValue
                      ).forEach((fn) => allFormulaFunctions.add(fn));
                    }
                  });
                }
              }
            }
          }
        }
      }
      sheet.conditionalFormats?.forEach((cf) =>
        cf.booleanRule?.condition?.values?.forEach((v) => {
          if (v.userEnteredValue) {
            rawUrls.push(...extractDriveLinks(v.userEnteredValue));
            extractFunctionNamesFromFormula(v.userEnteredValue).forEach((fn) =>
              allFormulaFunctions.add(fn)
            );
          }
        })
      );
      sheet.charts?.forEach((chart) => {
        if (chart.spec?.spreadsheetId) {
          rawUrls.push(
            `https://docs.google.com/spreadsheets/d/${chart.spec.spreadsheetId}/`
          );
        }
      });
    }
  }
  const links = await processRawUrls(drive, rawUrls);
  const incompatibleFunctions = Array.from(allFormulaFunctions).filter((fn) =>
    GSUITE_SPECIFIC_FUNCTIONS.includes(fn)
  );

  return { links, incompatibleFunctions };
}

// --- SLIDES ---
async function findLinksInSlide(slides, drive, slideId) {
  const SLIDE_FIELDS =
    'presentationId,slides(pageElements,slideProperties.notesPage.pageElements)';
  const res = await callWithRetry(() =>
    slides.presentations.get({
      presentationId: slideId,
      fields: SLIDE_FIELDS,
    })
  );
  let rawUrls = [];

  function processPageElementsForSlides(elements) {
    // Renamed to avoid conflict if used elsewhere
    if (!elements) return;
    for (const el of elements) {
      el.shape?.text?.textElements?.forEach((te) => {
        if (te.textRun) {
          if (te.textRun.style?.link?.url) {
            rawUrls.push(te.textRun.style.link.url);
          }
          if (te.textRun.content) {
            rawUrls.push(...extractDriveLinks(te.textRun.content));
          }
        }
      });
      if (el.image) {
        if (el.image.contentUrl) rawUrls.push(el.image.contentUrl);
        if (el.image.sourceUrl) rawUrls.push(el.image.sourceUrl);
        if (el.image.imageProperties?.link?.url) {
          rawUrls.push(el.image.imageProperties.link.url);
        }
      }
      if (el.video) {
        if (el.video.url) rawUrls.push(el.video.url);
        if (el.video.source === 'DRIVE' && el.video.id) {
          rawUrls.push(`https://drive.google.com/file/d/${el.video.id}/view`);
        }
      }
      if (el.sheetsChart?.spreadsheetId) {
        rawUrls.push(
          `https://docs.google.com/spreadsheets/d/${el.sheetsChart.spreadsheetId}/`
        );
      }
      if (el.elementGroup?.children) {
        processPageElementsForSlides(el.elementGroup.children); // Recursive call
      }
    }
  }

  if (res.data.slides) {
    for (const slide of res.data.slides) {
      processPageElementsForSlides(slide.pageElements);
      if (slide.slideProperties?.notesPage) {
        processPageElementsForSlides(
          slide.slideProperties.notesPage.pageElements
        );
      }
    }
  }

  return processRawUrls(drive, rawUrls);
}

// --- SCRIPT EXECUTION ---
main().catch((error) => {
  console.error('Unhandled error at top level:', error, error.stack);
  process.exit(1);
});
