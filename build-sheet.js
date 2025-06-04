import { MAX_CELL_CHARACTERS, SUMMARY_SHEET_NAME } from "./constants.js";
import { jsonOutputFilePath } from "./index.js";
import { callWithRetry } from "./API-Calls.js";
import { dataTransferMonitor } from './data-transfer-monitor.js';
import fs from 'fs';

/**
 * Reads streaming logs and creates issue-focused Google Sheets
 * One row per issue instead of one row per file
 */
export async function buildSheetsFromStreamingLogs(sheets, spreadsheetId, scanLogPath, summaryLogPath) {
  try {
    // Read and parse streaming logs
    const fileData = readScanLog(scanLogPath);
    const summaryData = readSummaryLog(summaryLogPath);
    
    // Extract user stats and totals from summary data
    const { userStats, totalStats } = extractStatsFromSummary(summaryData);
    
    // Create issue-focused audit details
    await writeIssueBasedAuditDetails(sheets, spreadsheetId, fileData);
    
    // Create issue chart
    await createIssueChart(sheets, spreadsheetId, fileData);
    
    // Create summary tab
    await writeSummaryTab(sheets, spreadsheetId, userStats, totalStats);
    
    // Create quota tab  
    await writeQuotaTab(sheets, spreadsheetId, userStats);
    
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
async function writeIssueBasedAuditDetails(sheets, spreadsheetId, fileData) {
  const ISSUE_SHEET_NAME = 'Issues';
  
  // Check if sheet exists
  let sheetExists = false;
  try {
    const sp = await callWithRetry(() => sheets.spreadsheets.get({
      spreadsheetId,
      fields: 'sheets.properties.title',
    }));
    sheetExists = sp.data.sheets.some(s => s.properties.title === ISSUE_SHEET_NAME);
  } catch (e) {
    console.warn('Error checking for existing Issues sheet:', e.message);
  }

  // Create or clear sheet
  if (!sheetExists) {
    await callWithRetry(() => sheets.spreadsheets.batchUpdate({
      spreadsheetId,
      resource: {
        requests: [{
          addSheet: {
            properties: { title: ISSUE_SHEET_NAME }
          }
        }]
      }
    }));
    console.log(`Created new sheet: ${ISSUE_SHEET_NAME}`);
  } else {
    await callWithRetry(() => sheets.spreadsheets.values.clear({
      spreadsheetId,
      range: `${ISSUE_SHEET_NAME}!A:Z`
    }));
    console.log(`Cleared existing sheet: ${ISSUE_SHEET_NAME}`);
  }

  // Build issue rows
  const issueRows = buildIssueRows(fileData);
  
  // Write headers and data
  const headers = [
    'Issue Type', 'Issue Detail', 'Owner Email', 'File Name', 'File Type', 
    'File ID', 'File URL', 'Created Time', 'Modified Time', 'File Size'
  ];
  
  const allRows = [headers, ...issueRows];
  
  await callWithRetry(() => sheets.spreadsheets.values.update({
    spreadsheetId,
    range: `${ISSUE_SHEET_NAME}!A1`,
    valueInputOption: 'RAW',
    resource: { values: allRows }
  }));
  
  console.log(`Issues sheet created with ${issueRows.length} issue rows`);
  
  // Track data transfer
  dataTransferMonitor.trackSheetWrite(`${ISSUE_SHEET_NAME}!A1`, allRows);
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
          'External Link',
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
          'Incompatible Function',
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
        'No Issues',
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
export async function writeSummaryTab(sheets, spreadsheetId, userStats, totalStats) {
  let sheetExists = false;
  try {
    const sp = await callWithRetry(() => sheets.spreadsheets.get({
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
      await callWithRetry(() => sheets.spreadsheets.values.clear({
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
      await callWithRetry(() => sheets.spreadsheets.batchUpdate({
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

  const result = await callWithRetry(() => sheets.spreadsheets.values.update({
    spreadsheetId,
    range: `${SUMMARY_SHEET_NAME}!A1`,
    valueInputOption: 'USER_ENTERED',
    requestBody: { values: allRows },
  })
  );
  
  // Track sheet write operation
  dataTransferMonitor.trackSheetWrite(`${SUMMARY_SHEET_NAME}!A1`, allRows);
}

/**
 * Truncates an array of items to fit within a cell's character limit.
 * If the combined items exceed the maximum character limit, it includes as many
 * items as possible and adds a message indicating how many items were omitted.
 * 
 * @param {string[]} itemsArray - The array of items to be joined and potentially truncated.
 * @param {string} [separator='; '] - The separator to use between items.
 * @param {boolean} [forFunctions=false] - Unused parameter, marked for potential removal.
 * @returns {string} A string of joined items, truncated if necessary with a count of omitted items.
 * 
 * @example
 * // With items that fit within limit
 * truncateItemsForCell(['item1', 'item2']); // Returns "item1; item2"
 * 
 * // With items exceeding limit
 * truncateItemsForCell(['very long item 1', ..., 'very long item N']); 
 * // Returns "very long item 1; ... (and X more items, see JSON for full list)"
 */
export function truncateItemsForCell(
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
    if (truncatedString.length +
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
  truncatedString += `${separator}... (and ${remainingItems} more item${remainingItems > 1 ? 's' : ''}${seeJsonMessage})`;

  // Final check to ensure the truncated message itself isn't too long.
  if (truncatedString.length > MAX_CELL_CHARACTERS) {
    return (
      truncatedString.substring(0, MAX_CELL_CHARACTERS - 50) + // Adjusted buffer
      `... (TRUNCATED${seeJsonMessage})`
    );
  }
  return truncatedString;
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
export async function writeQuotaTab(sheets, spreadsheetId, userStats) {
  const QUOTA_SHEET_NAME = 'UserQuota';
  
  // Check if quota sheet exists, create if not
  let sheetExists = false;
  try {
    const sp = await callWithRetry(() => sheets.spreadsheets.get({
      spreadsheetId,
      fields: 'sheets.properties.title',
    }));
    sheetExists = sp.data.sheets.some(
      (s) => s.properties.title === QUOTA_SHEET_NAME
    );
  } catch (e) {
    console.warn(`Could not check for quota sheet existence: ${e.message}`);
  }

  if (!sheetExists) {
    try {
      await callWithRetry(() => sheets.spreadsheets.batchUpdate({
        spreadsheetId,
        requestBody: {
          requests: [
            {
              addSheet: {
                properties: { title: QUOTA_SHEET_NAME },
              },
            },
          ],
        },
      }));
      console.log(`${QUOTA_SHEET_NAME} sheet created.`);
    } catch (addSheetError) {
      console.error(`Failed to create ${QUOTA_SHEET_NAME} sheet:`, addSheetError.message);
      return;
    }
  } else {
    // Clear existing content
    try {
      await callWithRetry(() => sheets.spreadsheets.values.clear({
        spreadsheetId,
        range: QUOTA_SHEET_NAME,
      }));
    } catch (e) {
      console.warn(`Could not clear ${QUOTA_SHEET_NAME} sheet:`, e.message);
    }
  }

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
  try {
    await callWithRetry(() => sheets.spreadsheets.values.update({
      spreadsheetId,
      range: `${QUOTA_SHEET_NAME}!A1`,
      valueInputOption: 'RAW',
      requestBody: { values: rows },
    }));
    
    // Track sheet write operation
    dataTransferMonitor.trackSheetWrite(`${QUOTA_SHEET_NAME}!A1`, rows);
    
    console.log(`User quota information written to ${QUOTA_SHEET_NAME} sheet.`);
  } catch (error) {
    console.error(`Failed to write quota data: ${error.message}`);
  }
}

/**
 * Creates an Issue Chart sheet with a bar chart showing issue types and their counts
 * 
 * @async
 * @param {Object} sheets - The Google Sheets API client
 * @param {string} spreadsheetId - The ID of the Google Spreadsheet
 * @param {Array} fileData - Array of file data from scan logs
 */
async function createIssueChart(sheets, spreadsheetId, fileData) {
  const CHART_SHEET_NAME = 'Issue Chart';
  const ISSUES_SHEET_NAME = 'Issues';
  
  // First, get the Issues sheet ID and determine the data range
  let issuesSheetId = null;
  let chartSheetId = null;
  let issuesDataRowCount = 0;
  
  try {
    const sp = await callWithRetry(() => sheets.spreadsheets.get({
      spreadsheetId,
      fields: 'sheets.properties',
    }));
    
    // Find Issues sheet ID
    const issuesSheet = sp.data.sheets.find(s => s.properties.title === ISSUES_SHEET_NAME);
    if (!issuesSheet) {
      console.error('Issues sheet not found - cannot create chart');
      return;
    }
    issuesSheetId = issuesSheet.properties.sheetId;
    
    // Get Issues data to determine the range dynamically
    const issuesResponse = await callWithRetry(() => sheets.spreadsheets.values.get({
      spreadsheetId,
      range: `${ISSUES_SHEET_NAME}!A:A`, // Get just column A to count rows
    }));
    issuesDataRowCount = (issuesResponse.data.values || []).length;
    
    if (issuesDataRowCount <= 1) {
      console.log('No issue data found (only header row) - skipping chart creation');
      return;
    }
    
    // Check if chart sheet exists and create/clear it
    const existingChartSheet = sp.data.sheets.find(s => s.properties.title === CHART_SHEET_NAME);
    if (existingChartSheet) {
      chartSheetId = existingChartSheet.properties.sheetId;
      
      // Get and delete any existing charts in this sheet
      try {
        const sheetWithCharts = await callWithRetry(() => sheets.spreadsheets.get({
          spreadsheetId,
          fields: 'sheets(properties.sheetId,charts.chartId)',
        }));
        
        const chartSheet = sheetWithCharts.data.sheets.find(s => s.properties && s.properties.sheetId === chartSheetId);
        if (chartSheet && chartSheet.charts && chartSheet.charts.length > 0) {
          const deleteRequests = chartSheet.charts.map(chart => ({
            deleteEmbeddedObject: {
              objectId: chart.chartId
            }
          }));
          
          await callWithRetry(() => sheets.spreadsheets.batchUpdate({
            spreadsheetId,
            resource: { requests: deleteRequests }
          }));
          
          console.log(`Deleted ${chartSheet.charts.length} existing chart(s) to prevent duplicates`);
        }
      } catch (e) {
        console.warn('Error deleting existing charts:', e.message);
      }
      
      console.log(`Using existing sheet: ${CHART_SHEET_NAME}`);
    } else {
      // Create new sheet
      const response = await callWithRetry(() => sheets.spreadsheets.batchUpdate({
        spreadsheetId,
        resource: {
          requests: [{
            addSheet: {
              properties: { title: CHART_SHEET_NAME }
            }
          }]
        }
      }));
      chartSheetId = response.data.replies[0].addSheet.properties.sheetId;
      console.log(`Created new sheet: ${CHART_SHEET_NAME}`);
    }
  } catch (e) {
    console.warn('Error managing Issue Chart sheet:', e.message);
    return;
  }

  // Create pre-aggregated data for the chart
  let issueCounts = {};
  try {
    const issuesResponse = await callWithRetry(() => sheets.spreadsheets.values.get({
      spreadsheetId,
      range: `${ISSUES_SHEET_NAME}!A2:A${issuesDataRowCount}`, // Skip header row
    }));
    const issueData = issuesResponse.data.values || [];
    
    // Count occurrences of each issue type
    issueData.forEach(row => {
      if (row && row[0]) {
        const issueType = row[0];
        issueCounts[issueType] = (issueCounts[issueType] || 0) + 1;
      }
    });
    
    // Create aggregated data table in the chart sheet
    const aggregatedData = [
      ['Issue Type', 'Count'],
      ...Object.entries(issueCounts).map(([type, count]) => [type, count])
    ];
    
    await callWithRetry(() => sheets.spreadsheets.values.update({
      spreadsheetId,
      range: `${CHART_SHEET_NAME}!A1`,
      valueInputOption: 'RAW',
      resource: { values: aggregatedData }
    }));
    
    console.log(`Created aggregated data table with ${Object.keys(issueCounts).length} issue types`);
    
  } catch (e) {
    console.warn('Error creating aggregated data:', e.message);
    return;
  }

  // Create chart that references the aggregated data in the chart sheet
  try {
    await callWithRetry(() => sheets.spreadsheets.batchUpdate({
      spreadsheetId,
      resource: {
        requests: [{
          addChart: {
            chart: {
              spec: {
                title: 'Issues Found by Type',
                basicChart: {
                  chartType: 'COLUMN',
                  legendPosition: 'BOTTOM_LEGEND',
                  stackedType: 'NOT_STACKED',
                  axis: [
                    {
                      position: 'BOTTOM_AXIS',
                      title: 'Issue Type'
                    },
                    {
                      position: 'LEFT_AXIS', 
                      title: 'Count'
                    }
                  ],
                  domains: [{
                    domain: {
                      sourceRange: {
                        sources: [{
                          sheetId: chartSheetId,
                          startRowIndex: 1, // Skip header row
                          endRowIndex: 1 + Object.keys(issueCounts).length,
                          startColumnIndex: 0, // Column A (Issue Type)
                          endColumnIndex: 1
                        }]
                      }
                    },
                    reversed: false
                  }],
                  series: [{
                    series: {
                      sourceRange: {
                        sources: [{
                          sheetId: chartSheetId,
                          startRowIndex: 1, // Skip header row
                          endRowIndex: 1 + Object.keys(issueCounts).length,
                          startColumnIndex: 1, // Column B (Count)
                          endColumnIndex: 2
                        }]
                      }
                    },
                    type: 'COLUMN',
                    targetAxis: 'LEFT_AXIS'
                  }],
                  headerCount: 0 // No headers since we're skipping row 1
                }
              },
              position: {
                overlayPosition: {
                  anchorCell: {
                    sheetId: chartSheetId,
                    rowIndex: 2,
                    columnIndex: 1
                  },
                  widthPixels: 600,
                  heightPixels: 400
                }
              }
            }
          }
        }]
      }
    }));

    console.log(`Issue chart created in ${CHART_SHEET_NAME} sheet referencing ${issuesDataRowCount} rows from Issues tab`);
    
  } catch (error) {
    console.error(`Failed to create issue chart: ${error.message}`);
  }
}

