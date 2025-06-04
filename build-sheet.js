import { AUDIT_DETAILS_SHEET_NAME, jsonOutputFilePath, MAX_CELL_CHARACTERS, SUMMARY_SHEET_NAME } from "./index.js";
import { callWithRetry } from "./API-Calls.js";
import { dataTransferMonitor } from './data-transfer-monitor.js';


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
 * Appends rows of data to a specified Google Sheet
 * 
 * @async
 * @function appendRows
 * @param {Object} sheets - The Google Sheets API client
 * @param {string} spreadsheetId - The ID of the Google Sheet to append to
 * @param {Array<Array<*>>} rows - The rows of data to append to the sheet
 * @returns {Promise<void>} - A promise that resolves when the operation is complete
 * @throws {Error} - If the API call fails after retries
 */
export async function appendRows(sheets, spreadsheetId, rows) {
  if (rows.length === 0) return;
  await callWithRetry(() => sheets.spreadsheets.values.append({
    spreadsheetId,
    range: AUDIT_DETAILS_SHEET_NAME,
    valueInputOption: 'USER_ENTERED',
    insertDataOption: 'INSERT_ROWS',
    requestBody: { values: rows },
  })
  );
}
// --- SHEET HELPERS ---
/**
 * Clears the audit details sheet and sets up headers. If the sheet doesn't exist, it creates a new one.
 * 
 * @param {object} sheets - The Google Sheets API client instance
 * @param {string} spreadsheetId - The ID of the Google Spreadsheet to modify
 * @returns {Promise<void>} - A promise that resolves when headers are set up
 * @throws {Error} - If sheet creation fails or any other API errors occur
 * 
 * @async
 */
export async function clearAndSetHeaders(sheets, spreadsheetId) {
  try {
    await callWithRetry(() => sheets.spreadsheets.values.clear({
      spreadsheetId,
      range: AUDIT_DETAILS_SHEET_NAME,
    })
    );
  } catch (e) {
    if (e.message?.includes('Unable to parse range') ||
      e.message?.toLowerCase().includes('not found')) {
      console.log(`${AUDIT_DETAILS_SHEET_NAME} not found, creating...`);
      try {
        await callWithRetry(() => sheets.spreadsheets.batchUpdate({
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
    'Created Time',
    'Modified Time',
    'File Size',
    'File ID',
    'File Type',
    'File URL',
    'Linked Items/References (URLs, Drive IDs)',
    'GSuite Specific Functions (Sheets only)',
  ];
  await callWithRetry(() => sheets.spreadsheets.values.update({
    spreadsheetId,
    range: `${AUDIT_DETAILS_SHEET_NAME}!A1`,
    valueInputOption: 'RAW',
    requestBody: { values: [headers] },
  })
  );
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

