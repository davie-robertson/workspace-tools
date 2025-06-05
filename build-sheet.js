import { 
  MAX_CELL_CHARACTERS, 
  SHEET_NAMES,
  ISSUE_TYPES 
} from "./constants.js";
import { jsonOutputFilePath } from "./index.js";
import { callWithRetry } from "./API-Calls.js";
import { dataTransferMonitor } from './data-transfer-monitor.js';
import { SheetManager } from './sheet-manager.js';
import { ChartService } from './chart-service.js';
import fs from 'fs';

/**
 * Reads streaming logs and creates issue-focused Google Sheets
 * One row per issue instead of one row per file
 */
export async function buildSheetsFromStreamingLogs(sheets, spreadsheetId, scanLogPath, summaryLogPath) {
  try {
    // Initialize managers
    const sheetManager = new SheetManager(sheets, spreadsheetId);
    const chartService = new ChartService(sheets, spreadsheetId);
    
    // Read and parse streaming logs
    const fileData = readScanLog(scanLogPath);
    const summaryData = readSummaryLog(summaryLogPath);
    
    // Extract user stats and totals from summary data
    const { userStats, totalStats } = extractStatsFromSummary(summaryData);
    
    // Create issue-focused audit details
    await writeIssueBasedAuditDetails(sheetManager, fileData);
    
    // Create issue chart
    await chartService.createIssueChart(SHEET_NAMES.ISSUES, SHEET_NAMES.CHART);
    
    // Create summary tab
    await writeSummaryTab(sheetManager, userStats, totalStats);
    
    // Create quota tab  
    await writeQuotaTab(sheetManager, userStats);
    
    console.log('Google Sheets successfully built from streaming logs');
    
  } catch (error) {
    console.error('Failed to build sheets from streaming logs:', error.message);
    throw error;
  }
}

/**
 * Reads the scan log and returns parsed file data
 */
function readScanLog(scanLogPath) {
  const scanLogContent = fs.readFileSync(scanLogPath, 'utf8');
  const scanLines = scanLogContent.trim().split('\n').filter(line => line);
  
  const files = [];
  scanLines.forEach(line => {
    try {
      const entry = JSON.parse(line);
      if (entry.type === 'file_processed') {
        files.push(entry.data);
      }
    } catch (e) {
      console.warn('Skipped malformed scan log entry:', e.message);
    }
  });
  
  return files;
}

/**
 * Reads the summary log and returns parsed summary data
 */
function readSummaryLog(summaryLogPath) {
  const summaryLogContent = fs.readFileSync(summaryLogPath, 'utf8');
  const summaryLines = summaryLogContent.trim().split('\n').filter(line => line);
  
  const events = [];
  summaryLines.forEach(line => {
    try {
      const entry = JSON.parse(line);
      events.push(entry);
    } catch (e) {
      console.warn('Skipped malformed summary log entry:', e.message);
    }
  });
  
  return events;
}

/**
 * Extracts user stats and total stats from summary log events
 */
function extractStatsFromSummary(summaryData) {
  const userStats = {};
  let totalStats = {};
  
  summaryData.forEach(event => {
    if (event.type === 'user_processing_completed') {
      userStats[event.user] = event.stats;
    } else if (event.type === 'scan_completed') {
      totalStats = event.total_stats || {};
    }
  });
  
  return { userStats, totalStats };
}

/**
 * Creates issue-focused audit details with one row per issue
 */
async function writeIssueBasedAuditDetails(sheetManager, fileData) {
  // Create or clear sheet
  await sheetManager.getOrCreateSheet(SHEET_NAMES.ISSUES);

  // Build issue rows
  const issueRows = buildIssueRows(fileData);
  
  // Write headers and data
  const headers = [
    'Issue Type', 'Issue Detail', 'Owner Email', 'File Name', 'File Type', 
    'File ID', 'File URL', 'Created Time', 'Modified Time', 'File Size'
  ];
  
  const allRows = [headers, ...issueRows];
  
  await sheetManager.writeData(SHEET_NAMES.ISSUES, 'A1', allRows);
  
  console.log(`Issues sheet created with ${issueRows.length} issue rows`);
}

/**
 * Builds issue-focused rows from file data
 */
function buildIssueRows(fileData) {
  const rows = [];
  
  fileData.forEach(file => {
    // Add row for each external link
    if (file.linkedItems && file.linkedItems.length > 0) {
      file.linkedItems.forEach(link => {
        rows.push([
          ISSUE_TYPES.EXTERNAL_LINK,
          link,
          file.ownerEmail,
          file.fileName,
          file.fileType,
          file.fileId,
          file.fileUrl,
          file.createdTime,
          file.modifiedTime,
          file.size
        ]);
      });
    }
    
    // Add row for each incompatible function
    if (file.incompatibleFunctions && file.incompatibleFunctions.length > 0) {
      file.incompatibleFunctions.forEach(func => {
        rows.push([
          ISSUE_TYPES.INCOMPATIBLE_FUNCTION,
          func,
          file.ownerEmail,
          file.fileName,
          file.fileType,
          file.fileId,
          file.fileUrl,
          file.createdTime,
          file.modifiedTime,
          file.size
        ]);
      });
    }
    
    // Add row for files with no issues (for completeness)
    if ((!file.linkedItems || file.linkedItems.length === 0) && 
        (!file.incompatibleFunctions || file.incompatibleFunctions.length === 0)) {
      rows.push([
        ISSUE_TYPES.NO_ISSUES,
        'File scanned successfully with no issues found',
        file.ownerEmail,
        file.fileName,
        file.fileType,
        file.fileId,
        file.fileUrl,
        file.createdTime,
        file.modifiedTime,
        file.size
      ]);
    }
  });
  
  return rows;
}

/**
 * Writes summary statistics to a dedicated summary sheet in a Google Spreadsheet.
 * 
 * This function handles creating a summary sheet if it doesn't exist, or clearing it if it does,
 * and then populates it with user statistics and totals.
 * 
 * @async
 * @param {Object} sheets - The Google Sheets API client
 * @param {string} spreadsheetId - The ID of the Google Spreadsheet
 * @param {Object.<string, Object>} userStats - Object containing user statistics, keyed by email
 *   @param {number} userStats[].doc - Number of documents scanned for a user
 *   @param {number} userStats[].docWithLinks - Number of documents with links for a user
 *   @param {number} userStats[].sheet - Number of sheets scanned for a user
 *   @param {number} userStats[].sheetWithLinks - Number of sheets with links for a user
 *   @param {number} userStats[].sheetWithIncompatibleFunctions - Number of sheets with incompatible functions for a user
 *   @param {number} userStats[].slide - Number of slides scanned for a user
 *   @param {number} userStats[].slideWithLinks - Number of slides with links for a user
 *   @param {number} userStats[].other - Number of other files scanned for a user
 *   @param {number} userStats[].otherWithLinks - Number of other files with links for a user
 * @param {Object} totalStats - Object containing aggregated statistics across all users
 *   @param {number} totalStats.doc - Total number of documents scanned
 *   @param {number} totalStats.docWithLinks - Total number of documents with links
 *   @param {number} totalStats.sheet - Total number of sheets scanned
 *   @param {number} totalStats.sheetWithLinks - Total number of sheets with links
 *   @param {number} totalStats.sheetWithIncompatibleFunctions - Total number of sheets with incompatible functions
 *   @param {number} totalStats.slide - Total number of slides scanned
 *   @param {number} totalStats.slideWithLinks - Total number of slides with links
 *   @param {number} totalStats.other - Total number of other files scanned
 *   @param {number} totalStats.otherWithLinks - Total number of other files with links
 * @returns {Promise<void>} A Promise that resolves when the summary sheet has been written
 * @throws {Error} If there's an error creating the summary sheet
 */
export async function writeSummaryTab(sheetManager, userStats, totalStats) {
  // Create or clear sheet
  await sheetManager.getOrCreateSheet(SHEET_NAMES.SUMMARY);

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

  await sheetManager.writeData(SHEET_NAMES.SUMMARY, 'A1', allRows);
}

/**
 * Writes user quota information to a dedicated quota sheet in a Google Spreadsheet.
 * 
 * @async
 * @param {Object} sheets - The Google Sheets API client
 * @param {string} spreadsheetId - The ID of the Google Spreadsheet
 * @param {Object.<string, Object>} userStats - Object containing user statistics including quota info
 * @returns {Promise<void>} A Promise that resolves when the quota sheet has been written
 * @throws {Error} If there's an error creating or writing to the quota sheet
 */
export async function writeQuotaTab(sheetManager, userStats) {
  // Create or clear sheet
  await sheetManager.getOrCreateSheet(SHEET_NAMES.QUOTA);

  // Set headers
  const headers = [
    'User Email',
    'Drive Quota Limit (MB)',
    'Drive Total Usage (MB)',
    'Drive Files Usage (MB)', 
    'Drive Trash Usage (MB)',
    'Gmail Email Address',
    'Gmail Messages Total',
    'Gmail Threads Total',
    'Gmail History ID',
    'Gmail Storage Usage (MB)'
  ];

  // Prepare data rows
  const rows = [headers];
  
  for (const [userEmail, stats] of Object.entries(userStats)) {
    if (stats.quotaInfo) {
      const quota = stats.quotaInfo;
      rows.push([
        userEmail,
        quota.driveQuota.limit,
        quota.driveQuota.usage,
        quota.driveQuota.usageInDrive,
        quota.driveQuota.usageInDriveTrash,
        quota.gmailInfo.emailAddress,
        quota.gmailInfo.messagesTotal,
        quota.gmailInfo.threadsTotal,
        quota.gmailInfo.historyId,
        quota.gmailInfo.storageUsage
      ]);
    }
  }

  // Write all data at once
  await sheetManager.writeData(SHEET_NAMES.QUOTA, 'A1', rows);
  
  console.log(`User quota information written to ${SHEET_NAMES.QUOTA} sheet.`);
}

/**
 * Creates an Issue Chart sheet with a bar chart showing issue types and their counts
 * 
 * @async
 * @param {Object} sheets - The Google Sheets API client
 * @param {string} spreadsheetId - The ID of the Google Spreadsheet
 * @param {Array} fileData - Array of file data from scan logs
 */
// Legacy scanning functions below - these may be moved to a separate module in the future