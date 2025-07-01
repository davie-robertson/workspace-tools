import 'dotenv/config';
import fs from 'fs';
import { EnvironmentConfig, FeatureConfig, CONFIG } from './config.js';
import { apiClient, adminApiClient } from './api-client.js';
import { dataTransferMonitor } from './data-transfer-monitor.js';
import {
  streamingLogger,
  initialiseStreamingLogs,
} from './streaming-logger.js';
import {
  findLinksInDoc,
  findLinksInSheet,
  findLinksInSlide,
} from './file-scanners.js';
import { getAllUsers, listUserFiles } from './user-file-management.js';
import {
  FileTypeUtils,
  StreamingLogUtils,
  StringUtils,
  ArrayUtils,
} from './utils.js';
import { parseArgs, validateArgs, showHelp } from './cli.js';
import { CalendarScanner } from './calendar-scanner.js';
import { MigrationAnalyser } from './migration-analyser.js';
import { DriveAnalyser } from './drive-analyser.js';
import { google } from 'googleapis';

// Parse and validate command line arguments
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

// Initialise configuration
const envConfig = EnvironmentConfig.getInstance();
const featureConfig = new FeatureConfig(argv);

// Process CLI arguments with consistent naming
const userFilters = argv.users
  ? argv.users.split(',').map(StringUtils.normaliseEmail)
  : null;

const fileTypeFilters = argv.types
  ? argv.types.split(',').map((type) => type.trim().toLowerCase())
  : null;

const singleFileId = argv.file;
const jsonOutputFilePath = argv['json-output'];
const jsonOutputMode = argv['json-output-mode'] || 'overwrite';
const enableSheetsOutput = argv['sheets-output'] || false;

// Export for other modules
export const ADMIN_USER = envConfig.adminUser;

// Validate environment configuration
try {
  envConfig.validateRequired();

  // Validate additional requirements based on features
  if (
    featureConfig
      .getEnabledFeatures()
      .some((f) =>
        ['sharingAnalysis', 'driveAnalysis', 'calendars'].includes(f)
      )
  ) {
    envConfig.validateForAnalysis();
  }

  if (enableSheetsOutput) {
    envConfig.validateForSheetsOutput();
  }
} catch (error) {
  console.error(`Configuration Error: ${error.message}`);
  process.exit(1);
}

// Initialise global state
const totalStats = {
  doc: 0,
  sheet: 0,
  slide: 0,
  other: 0,
  docWithLinks: 0,
  sheetWithLinks: 0,
  slideWithLinks: 0,
  sheetWithIncompatibleFunctions: 0,
};

const userStats = {};
const allFilesData = [];
const allMigrationResults = [];
const allDriveResults = [];

/**
 * Main application logic
 */
async function main() {
  try {
    // Initialise streaming logs for the scan
    initialiseStreamingLogs();

    // Determine users to scan based on CLI arguments
    const usersToScan = await determineUsersToScan();

    console.log(
      `Will scan ${usersToScan.length} users with features: ${featureConfig
        .getEnabledFeatures()
        .join(', ')}`
    );

    // Initialise analysers based on enabled features
    const analysers = initialiseAnalysers();

    // Handle single file scan or multi-user scan
    if (singleFileId) {
      await processSingleFile(usersToScan, analysers);
    } else {
      await processAllUsers(usersToScan, analysers);
    }

    // Generate final output
    await generateOutput(usersToScan.length);

    console.log('✅ Scan completed successfully!');
  } catch (error) {
    console.error('❌ Scan failed:', error.message);
    throw error;
  } finally {
    // Always cleanup streaming logs
    console.log('Keeping streaming logs for debugging...');
    // StreamingLogUtils.cleanupLogs(streamingLogger);
  }
}

/**
 * Determines which users to scan based on CLI arguments
 */
async function determineUsersToScan() {
  if (singleFileId && userFilters?.length > 0) {
    return userFilters.map((email) => ({ primaryEmail: email }));
  }

  if (!singleFileId) {
    const allUsers = await getAllUsers();
    return userFilters
      ? allUsers.filter((user) =>
          userFilters.includes(StringUtils.normaliseEmail(user.primaryEmail))
        )
      : allUsers;
  }

  return [];
}

/**
 * Initialises analyser instances based on enabled features
 */
function initialiseAnalysers() {
  const analysers = {};

  if (featureConfig.isEnabled('calendars')) {
    analysers.calendar = new CalendarScanner();
  }

  if (featureConfig.isEnabled('sharingAnalysis')) {
    analysers.migration = new MigrationAnalyser();
  }

  if (featureConfig.isEnabled('driveAnalysis')) {
    analysers.drive = new DriveAnalyser();
  }

  return analysers;
}

/**
 * Process a single file scan
 */
async function processSingleFile(usersToScan, analysers) {
  // SECURITY: Check if the single file ID is the same as the output sheet ID.
  if (singleFileId === CONFIG.googleSheets?.outputSheetId) {
    console.warn(
      `Skipping scan of OUTPUT_SHEET_ID (${CONFIG.googleSheets.outputSheetId}) to prevent conflicts.`
    );
    return;
  }

  console.log(`Fetching metadata for single file ${singleFileId}...`);
  let fileMetadata;
  let contextUserEmail;

  // Try to find which user owns this file by attempting to access it as each user
  let foundOwner = false;

  for (const user of usersToScan) {
    try {
      const userAuthClient = await apiClient.createAuthenticatedClient(
        user.primaryEmail
      );
      const userDrive = google.drive({
        version: 'v3',
        auth: userAuthClient,
      });

      fileMetadata = await apiClient.callWithRetry(() =>
        userDrive.files.get({
          fileId: singleFileId,
          fields:
            'id, name, mimeType, webViewLink, owners(emailAddress), createdTime, modifiedTime, size',
          supportsAllDrives: true,
        })
      );

      // Track file metadata retrieval
      dataTransferMonitor.trackFileMetadata(singleFileId, fileMetadata.data);

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
      quotaInfo: null,
    };
  }

  let links = [];
  let incompatibleFunctions = [];
  const fileType = FileTypeUtils.getFileType(fileMetadata.data.mimeType);
  console.log(`Scanning single file: ${fileMetadata.data.name} (${fileType})`);

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
  }

  const owner = fileMetadata.data.owners?.[0]?.emailAddress || 'Unknown Owner';
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
    fileMetadata.data.mimeType === 'application/vnd.google-apps.spreadsheet'
  ) {
    fileData.incompatibleFunctions = incompatibleFunctions;
  }

  allFilesData.push(fileData);

  // Stream file data for single file scan
  streamingLogger.logFile(fileData);

  console.log(
    `Single file scan complete for ${fileMetadata.data.name}. Found ${links.length} links/references.` +
      (incompatibleFunctions.length > 0
        ? ` ${incompatibleFunctions.length} incompatible functions.`
        : '')
  );
}

/**
 * Process all users in the domain
 */
async function processAllUsers(usersToScan, analysers) {
  // Process users in batches for efficiency
  const userBatches = ArrayUtils.chunk(usersToScan, 10);
  let processedUsers = 0;

  for (const userBatch of userBatches) {
    await Promise.all(
      userBatch.map(async (user, userIndex) => {
        const globalUserIndex = processedUsers + userIndex;
        await processUser(user, globalUserIndex, usersToScan.length, analysers);
      })
    );
    processedUsers += userBatch.length;
  }
}

/**
 * Process a single user
 */
async function processUser(user, userIndex, totalUsers, analysers) {
  try {
    const userEmail = user.primaryEmail;
    console.log(`Processing user ${userIndex + 1}/${totalUsers}: ${userEmail}`);

    // Stream user processing start
    streamingLogger.logUserStart(userEmail, userIndex, totalUsers);

    let files = await listUserFiles(userEmail);
    console.log(`User ${userEmail}: Found ${files.length} files. Analysing...`);

    // Initialise user stats
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
      quotaInfo: null,
    };

    // Perform migration analysis if enabled
    let migrationResults = null;
    if (analysers.migration) {
      migrationResults = await analysers.migration.analyseUser(
        userEmail,
        files,
        streamingLogger
      );
      allMigrationResults.push(migrationResults);
    }

    // Perform Drive analysis if enabled
    let driveResults = null;
    if (analysers.drive) {
      console.log(`Analysing drives for ${userEmail}...`);
      driveResults = await analysers.drive.analyseUserDrives(
        userEmail,
        streamingLogger
      );
      allDriveResults.push(driveResults);

      // Log detailed Drive analysis
      streamingLogger.logDriveAnalysis(userEmail, driveResults);
    }

    // Collect quota information for this user
    try {
      console.log(`Collecting quota information for ${userEmail}...`);
      const driveInfo = await apiClient.getDriveInfo(userEmail);

      // Also collect Gmail profile information
      try {
        const gmailProfile = await apiClient.getProfile('me', userEmail);

        // Combine drive and Gmail data
        userStats[userEmail].quotaInfo = {
          ...driveInfo.data,
          gmailProfile: gmailProfile.data,
        };
      } catch (gmailError) {
        console.warn(
          `Failed to collect Gmail profile for ${userEmail}: ${gmailError.message}`
        );
        userStats[userEmail].quotaInfo = driveInfo.data;
      }
    } catch (error) {
      console.warn(
        `Failed to collect quota info for ${userEmail}: ${error.message}`
      );
      userStats[userEmail].quotaInfo = null;
    }

    // Filter files by type if specified
    if (fileTypeFilters) {
      files = files.filter((file) => {
        const fileTypeSimple = FileTypeUtils.getFileType(file.mimeType)
          .toLowerCase()
          .replace('google ', '');
        return fileTypeFilters.includes(fileTypeSimple);
      });
      console.log(
        `Filtered to ${files.length} files based on specified types for ${userEmail}.`
      );
    }

    // Process each file
    for (const [fileIdx, file] of files.entries()) {
      if (file.id === CONFIG.googleSheets?.outputSheetId) {
        console.warn(
          `Skipping scan of OUTPUT_SHEET_ID (${file.id}) found in ${userEmail}'s files.`
        );
        continue;
      }

      const fileType = FileTypeUtils.getFileType(file.mimeType);
      let links = [];
      let incompatibleFunctions = [];

      switch (file.mimeType) {
        case 'application/vnd.google-apps.document':
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

        case 'application/vnd.google-apps.spreadsheet':
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

        case 'application/vnd.google-apps.presentation':
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
          break;
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

      // Add migration analysis data if available
      if (migrationResults) {
        const fileMigrationData = migrationResults.fileAnalysis.find(
          (f) => f.fileId === file.id
        );
        if (fileMigrationData) {
          fileData.sharingAnalysis = {
            sharing: fileMigrationData.sharing,
            location: fileMigrationData.location,
            overallRisk: fileMigrationData.overallRisk,
            migrationIssues: fileMigrationData.migrationIssues,
          };
        }
      }

      allFilesData.push(fileData);

      // Stream file data immediately
      streamingLogger.logFile(fileData);
    }

    // Add migration analysis to user stats if performed
    if (migrationResults) {
      userStats[userEmail].sharingAnalysis = {
        totalFiles: migrationResults.migrationSummary.totalFiles,
        highRiskFiles: migrationResults.migrationSummary.highRiskFiles,
        mediumRiskFiles: migrationResults.migrationSummary.mediumRiskFiles,
        lowRiskFiles: migrationResults.migrationSummary.lowRiskFiles,
        externalShares: migrationResults.migrationSummary.externalShares,
        publicFiles: migrationResults.migrationSummary.publicFiles,
      };

      if (migrationResults.calendarAnalysis) {
        userStats[userEmail].calendarAnalysis = {
          totalCalendars: migrationResults.calendarAnalysis.calendars.length,
          futureEvents: migrationResults.calendarAnalysis.futureEvents.length,
          recurringEvents:
            migrationResults.calendarAnalysis.recurringEvents.length,
          externalMeetings:
            migrationResults.calendarAnalysis.externalAttendees.length,
          migrationRisks: migrationResults.calendarAnalysis.migrationRisks,
          calendarDisabled:
            migrationResults.calendarAnalysis.calendarDisabled || false,
        };
      }
    }

    // Add Drive analysis to user stats if performed
    if (driveResults) {
      userStats[userEmail].driveAnalysis = {
        totalSharedDrives: driveResults.summary.totalSharedDrives,
        totalExternalUsers: driveResults.summary.totalExternalUsers,
        totalOrphanedFiles: driveResults.summary.totalOrphanedFiles,
        hasExternalSharing: driveResults.summary.hasExternalSharing,
        riskLevel: driveResults.summary.riskLevel,
        myDriveFiles: driveResults.myDrive?.totalFiles || 0,
        myDriveSharedFiles: driveResults.myDrive?.sharedFiles || 0,
        myDrivePublicFiles: driveResults.myDrive?.publicFiles || 0,
        myDriveStorageUsed: driveResults.myDrive?.storageUsed || 0,
      };
    }

    // Log user processing completion
    streamingLogger.logUserComplete(userEmail, userStats[userEmail]);
  } catch (error) {
    console.error(`Error processing user ${user.primaryEmail}:`, error.message);
  }
}

/**
 * Generate output after scanning
 */
async function generateOutput(totalUsers) {
  console.log(`Processed ${totalUsers} users successfully.`);

  // Log scan completion
  const scanEndTime = new Date();
  const scanDuration = Math.round(
    (scanEndTime - streamingLogger.startTime) / 1000
  );
  streamingLogger.logScanComplete(totalStats, userStats, scanDuration);

  // --- OUTPUT GENERATION ---
  if (jsonOutputFilePath) {
    console.log(`Preparing JSON output: ${jsonOutputFilePath}`);
    await generateJSONOutput();
  }

  // Google Sheets output (if requested)
  if (enableSheetsOutput && CONFIG.googleSheets?.outputSheetId) {
    console.log('Building Google Sheets from streaming logs...');
    await generateSheetsOutput();
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
}

/**
 * Generate JSON output
 */
async function generateJSONOutput() {
  // Check if we should use streaming logs for consolidated JSON (more memory efficient)
  const useStreamingConsolidation = allFilesData.length > 1000;

  if (useStreamingConsolidation) {
    console.log(
      'Large dataset detected. Using streaming logs for JSON generation...'
    );
    try {
      streamingLogger.generateConsolidatedJSON(jsonOutputFilePath);
      console.log(`Streaming JSON output written to: ${jsonOutputFilePath}`);
      return;
    } catch (error) {
      console.error(
        'Failed to generate consolidated JSON from streams. Falling back to memory-based approach.'
      );
      console.error(error.message);
    }
  }

  // Traditional approach - keep all data in memory
  let jsonDataToWrite = {
    summary: {
      totalStats: JSON.parse(JSON.stringify(totalStats)),
      userStats: JSON.parse(JSON.stringify(userStats)),
      generationDate: new Date().toISOString(),
    },
    files: JSON.parse(JSON.stringify(allFilesData)),
  };

  // Add Drive analysis results if available
  if (allDriveResults.length > 0) {
    jsonDataToWrite.driveAnalysis = JSON.parse(JSON.stringify(allDriveResults));

    // Add global Drive summary
    jsonDataToWrite.summary.driveAnalysisSummary = {
      totalUsersAnalysed: allDriveResults.length,
      totalSharedDrives: allDriveResults.reduce(
        (sum, result) => sum + result.summary.totalSharedDrives,
        0
      ),
      totalExternalUsers: [
        ...new Set(
          allDriveResults.flatMap((result) => result.externalUsers || [])
        ),
      ].length,
      totalOrphanedFiles: allDriveResults.reduce(
        (sum, result) => sum + result.summary.totalOrphanedFiles,
        0
      ),
      usersWithExternalSharing: allDriveResults.filter(
        (result) => result.summary.hasExternalSharing
      ).length,
      highRiskUsers: allDriveResults.filter(
        (result) => result.summary.riskLevel === 'high'
      ).length,
      mediumRiskUsers: allDriveResults.filter(
        (result) => result.summary.riskLevel === 'medium'
      ).length,
      lowRiskUsers: allDriveResults.filter(
        (result) => result.summary.riskLevel === 'low'
      ).length,
    };
  }

  if (jsonOutputMode === 'append' && fs.existsSync(jsonOutputFilePath)) {
    console.log(
      `Attempting to append to existing JSON file: ${jsonOutputFilePath}`
    );
    try {
      const existingJsonString = fs.readFileSync(jsonOutputFilePath, 'utf-8');
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
              (newUserStats[userEmail][key] || 0) + userStats[userEmail][key];
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
    }
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
  }
}

/**
 * Generate Google Sheets output
 */
async function generateSheetsOutput() {
  try {
    const { buildSheetsFromStreamingLogs } = await import('./build-sheet.js');

    // Use apiClient's authentication to create sheets client
    const sheets = await apiClient.withAuth(null, (authClient) => {
      return google.sheets({ version: 'v4', auth: authClient });
    });

    await buildSheetsFromStreamingLogs(
      sheets,
      CONFIG.googleSheets.outputSheetId,
      streamingLogger.scanLogPath,
      streamingLogger.summaryLogPath
    );
    console.log('Audit complete! Issue-based results written to Google Sheet.');
  } catch (error) {
    console.error('Failed to build sheets from streaming logs:', error.message);
    console.error('Google Sheets output failed.');
  }
}

// Run the main function
main().catch((error) => {
  console.error('Unhandled error at top level:', error);
  StreamingLogUtils.cleanupLogs(streamingLogger);
  process.exit(1);
});
