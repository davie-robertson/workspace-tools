import 'dotenv/config';
import fs from 'fs'; // For writing JSON output
import ora from 'ora';
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
  console.error('Missing required environment variable: ADMIN_USER. This user account is used to impersonate and access other users\' Drive data and list users via the Admin SDK.');
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
// `spinner`: An 'ora' spinner instance to update with status messages.
// `maxRetries`: Maximum number of times to retry the API call.
// `initialDelay`: Initial delay in milliseconds before the first retry.
async function callWithRetry(
  apiCallFunction, // The function that makes the API call
  spinner, // Ora spinner instance for progress indication
  maxRetries = 5, // Maximum number of retries
  initialDelay = 1000 // Initial delay in milliseconds for backoff
) {
  let retries = 0;
  const intendedOperationText = spinner ? spinner.text : null; // Store original spinner text
  while (true) {
    try {
      if (spinner && intendedOperationText) {
        // Restore original spinner text if it was changed by a previous retry attempt's message
        spinner.text = intendedOperationText;
      }
      return await apiCallFunction(); // Attempt the API call
    } catch (error) {
      const errorCode = error.code || (error.response && error.response.status);
      const errorMessage =
        error.response?.data?.error?.message || error.message;
      
      // Determine if the error is retryable based on error code and message.
      // Retries on:
      // - 403 or 429 with "quota" in message (specific quota errors)
      // - 429 (generic rate limit)
      // - 403 with "rate limit exceeded" in message
      // - 500, 503 (server errors)
      // - 403 with "service is currently unavailable"
      const isRetryable =
        (((errorCode === 403 || errorCode === 429) && // Quota related 403s or general 429s
          errorMessage?.toLowerCase().includes('quota')) ||
          errorCode === 429 || // General "Too Many Requests"
          (errorCode === 403 && // Specific rate limit 403s
            errorMessage?.toLowerCase().includes('rate limit exceeded')) ||
          errorCode === 500 || // Internal Server Error
          errorCode === 503 || // Service Unavailable
          (errorCode === 403 && // Service unavailable 403s
            errorMessage
              ?.toLowerCase()
              .includes('service is currently unavailable'))) &&
        retries < maxRetries;

      if (isRetryable) {
        retries++;
        const delay = initialDelay * Math.pow(2, retries -1); // Exponential backoff
        const retryMessage = `API error (${errorCode}): "${errorMessage}". Retrying in ${delay / 1000}s... (Attempt ${retries}/${maxRetries})`;
        if (spinner) spinner.text = retryMessage; else console.warn(retryMessage);
        await new Promise((resolve) => setTimeout(resolve, delay));
      } else {
        // If not retryable or max retries reached, throw the error.
        const nonRetryableMessage = `API error (${errorCode}): "${errorMessage}". Not retrying.`;
        if (spinner) spinner.fail(nonRetryableMessage); else console.error(nonRetryableMessage);
        throw error; // Re-throw the original error
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
    if (error.response?.data) { // Log response data if available
      console.error('Error response data:', JSON.stringify(error.response.data, null, 2));
    }
    // SECURITY: Ensure error messages do not leak overly sensitive details if logged publicly.
    throw new Error(`Failed to authenticate: ${error.message}. Check service account credentials, permissions, and domain-wide delegation settings.`);
  }
}

// --- MAIN LOGIC ---
// The main function orchestrates the entire audit process.
async function main() {
  // Initialize an ora spinner for visual feedback in the console during long operations.
  const mainSpinner = ora('Starting audit...').start();
  try {
    // Authenticate and get API clients.
    // SECURITY: getAuthenticatedClient handles authentication using service account credentials.
    // The resulting `auth` object is an OAuth2 client with the necessary permissions (scopes)
    // to access Google APIs on behalf of ADMIN_USER or other users via delegation.
    const auth = await getAuthenticatedClient(); // Authenticate first.
    // Initialize Google API service clients with the authenticated client.
    const admin = google.admin({ version: 'directory_v1', auth });
    const drive = google.drive({ version: 'v3', auth });
    const docs = google.docs({ version: 'v1', auth });
    const sheets = google.sheets({ version: 'v4', auth });
    const slides = google.slides({ version: 'v1', auth });

    // Determine users to scan based on CLI arguments.
    // This logic handles different scenarios: single file scan, user-filtered scan, or full domain scan.
    mainSpinner.text = 'Fetching users...';
    let usersToScan = [];
    // Determine the list of users to scan.
    // If a singleFileId is provided and specific users are filtered, use those users.
    // This allows scanning a specific file in the context of a particular user (e.g., for permissions).
    if (singleFileId && filterUsers?.length > 0) {
      usersToScan = filterUsers.map(email => ({ primaryEmail: email.toLowerCase() }));
      mainSpinner.info(`Targeting specific users for single file scan: ${filterUsers.join(', ')}`);
    } else if (!singleFileId) {
      // If not a single file scan, fetch all non-suspended, non-archived users from the domain.
      // If filterUsers is set, filter this list.
      const allUsers = await getAllUsers(admin, mainSpinner);
      usersToScan = filterUsers
        ? allUsers.filter(user => filterUsers.includes(user.primaryEmail.toLowerCase()))
        : allUsers;
      mainSpinner.info(`Found ${allUsers.length} total users. Will scan ${usersToScan.length} users.`);
    } else {
      // For single file scan without specific user filter, use ADMIN_USER as context.
      // This is important because file access might depend on the user context.
      usersToScan = [{ primaryEmail: ADMIN_USER.toLowerCase() }];
      mainSpinner.info(`No specific user filter for single file scan, using ADMIN_USER (${ADMIN_USER}) context.`);
    }


    // Initialize arrays and objects to store scan results.
    const allFilesData = []; // Stores detailed data for each file found with links/issues.
    const rowsForSheet = []; // Stores rows to be written to Google Sheets (if that output is used).

    // Initialize statistics objects.
    const userStats = {}; // Per-user statistics.
    const totalStats = { // Overall statistics.
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
      mainSpinner.text = 'Preparing output sheet...';
      await clearAndSetHeaders(sheets, OUTPUT_SHEET_ID, mainSpinner);
    } else if (jsonOutputFilePath) {
      mainSpinner.info(`JSON output will be written to: ${jsonOutputFilePath}`);
    }

    // --- SINGLE FILE SCAN LOGIC ---
    // Handles the case where the --file <ID> argument is provided.
    // Scans only the specified file, not iterating through users' drives.
    if (singleFileId) {
      // SECURITY: Check if the single file ID is the same as the output sheet ID.
      // If so, skip scanning to prevent accidental modification or infinite loops if script writes to it.
      if (singleFileId === OUTPUT_SHEET_ID) {
        mainSpinner.warn(`Skipping scan of OUTPUT_SHEET_ID (${OUTPUT_SHEET_ID}) to prevent conflicts.`);
        // Consider if an exit or different handling is needed here. For now, it just skips.
      } else {
        // Determine user context for the single file scan.
        // If usersToScan was populated (e.g. by --users), use the first one. Otherwise, default to ADMIN_USER.
        const contextUserEmail = usersToScan[0]?.primaryEmail || ADMIN_USER;
        mainSpinner.info(
          `Single file mode: scanning ${singleFileId} (context: ${contextUserEmail})`
        );
        let fileMetadata;
        try {
          // Fetch metadata for the single file.
          // Note: This uses the authenticated client which acts as ADMIN_USER by default for Drive API calls,
          // unless the Drive service was initialized with a specific user's context (not done here for single get).
          // The service account needs access to this specific file.
          fileMetadata = await callWithRetry(() => drive.files.get({
            fileId: singleFileId,
            fields: 'id, name, mimeType, webViewLink, owners(emailAddress)',
            supportsAllDrives: true, // Important for files in Shared Drives
          }), mainSpinner);
        } catch (e) {
          mainSpinner.fail(`Failed to fetch metadata for file ${singleFileId}: ${e.message}`);
          // Decide if to exit or continue. For now, it would effectively stop this path.
          throw e; // Re-throw to be caught by the main try-catch
        }

        let links = [];
        let incompatibleFunctions = [];
        const fileType = getFileType(fileMetadata.data.mimeType);
        mainSpinner.text = `Scanning single file: ${fileMetadata.data.name} (${fileType})`;

        try {
          // Scan the file based on its type.
          // Calls specific helper functions (findLinksInDoc, findLinksInSheet, findLinksInSlide)
          // to extract relevant information (links, incompatible functions).
          // SECURITY: These helper functions interact with Google APIs to read file content.
          // Ensure the service account has appropriate read-only access to the file types being scanned.
          if (fileMetadata.data.mimeType === 'application/vnd.google-apps.document') {
            links = await findLinksInDoc(docs, drive, singleFileId, mainSpinner);
          } else if (fileMetadata.data.mimeType === 'application/vnd.google-apps.spreadsheet') {
            const sheetData = await findLinksInSheet(sheets, drive, singleFileId, mainSpinner);
            links = sheetData.links;
            incompatibleFunctions = sheetData.incompatibleFunctions;
          } else if (fileMetadata.data.mimeType === 'application/vnd.google-apps.presentation') {
            links = await findLinksInSlide(slides, drive, singleFileId, mainSpinner);
          } else {
            mainSpinner.info(`File type ${fileMetadata.data.mimeType} is not scannable for links.`);
          }
        } catch (e) {
          mainSpinner.fail(`Error scanning file ${singleFileId} (${fileMetadata.data.name}): ${e.message}`);
          // Log error but continue to report what was found (e.g., metadata)
          console.error(`Detailed error scanning file:`, e);
        }

        const owner =
          fileMetadata.data.owners?.[0]?.emailAddress || 'Unknown Owner';
        const fileData = {
          ownerEmail: owner, // Could be different from contextUserEmail if file is shared.
          fileName: fileMetadata.data.name,
          fileId: fileMetadata.data.id,
          fileType: fileType,
          fileUrl: fileMetadata.data.webViewLink,
          linkedItems: links, // Array of resolved link information strings
        };
        if (
          fileMetadata.data.mimeType === 'application/vnd.google-apps.spreadsheet'
        ) {
          fileData.incompatibleFunctions = incompatibleFunctions; // Array of function name strings
        }
        allFilesData.push(fileData); // Add to the main data array for JSON output

        // Output for single file scan
        // If JSON output is configured, data is added to allFilesData and written later.
        // If Google Sheets output is configured, a row is prepared and added to rowsForSheet.
        if (jsonOutputFilePath) {
          // JSON output handled after main loop.
        } else if (OUTPUT_SHEET_ID) {
          // If outputting to Google Sheets, prepare and append the row.
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
          // Note: Summary tab is not written for single file scans in the current logic.
        }
        mainSpinner.succeed(
          `Single file scan complete for ${fileMetadata.data.name}. Found ${links.length} links/references.` +
          (incompatibleFunctions.length > 0 ? ` ${incompatibleFunctions.length} incompatible functions.` : '')
        );
      }
    } else {
      // --- MULTI-FILE SCAN LOGIC (Iterate through users) ---
      // Handles the case where no --file argument is provided.
      // Iterates through the determined list of users (usersToScan).
      for (const [idx, user] of usersToScan.entries()) {
        const userEmail = user.primaryEmail; // Already lowercased if from filterUsers or ADMIN_USER
        mainSpinner.text = `User ${idx + 1}/${usersToScan.length}: ${
          userEmail
        } - Fetching files...`;
        
        // SECURITY: listUserFiles will use the service account's delegated authority
        // to act as `userEmail` to list their files. This is a key privileged operation.
        let files = await listUserFiles(drive, userEmail, mainSpinner);
        mainSpinner.info(
          `User ${userEmail}: Found ${files.length} files. Analyzing...`
        );

        // Initialize stats for the current user.
        userStats[userEmail] = {
          doc: 0, sheet: 0, slide: 0, other: 0,
          docWithLinks: 0, sheetWithLinks: 0, slideWithLinks: 0, otherWithLinks: 0,
          sheetWithIncompatibleFunctions: 0,
        };

        // Filter files by type if --types argument was provided.
        // This reduces the number of files to scan if the user is interested in specific types only.
        if (filterTypes) {
          files = files.filter(file => {
            const fileTypeSimple = getFileType(file.mimeType).toLowerCase().replace('google ', ''); // e.g., "doc", "sheet"
            return filterTypes.includes(fileTypeSimple);
          });
          mainSpinner.info(`Filtered to ${files.length} files based on specified types for ${userEmail}.`);
        }

        for (const [fileIdx, file] of files.entries()) {
          // SECURITY: Skip scanning the OUTPUT_SHEET_ID if it appears in a user's file list.
          // This prevents the script from analyzing its own output sheet, which could lead to errors or loops.
          if (file.id === OUTPUT_SHEET_ID) {
            mainSpinner.warn(`Skipping scan of OUTPUT_SHEET_ID (${file.id}) found in ${userEmail}'s files.`);
            continue; // Skip this file
          }

          const fileProgressText = `User ${userEmail} (${idx + 1}/${usersToScan.length}) - File ${fileIdx + 1}/${files.length}: ${file.name}`;
          mainSpinner.text = fileProgressText;

          const fileType = getFileType(file.mimeType);
          let links = [];
          let incompatibleFunctions = [];

          // Update total and user stats for the type of file being processed.
          if (fileType === 'Google Doc') { totalStats.doc++; userStats[userEmail].doc++; }
          else if (fileType === 'Google Sheet') { totalStats.sheet++; userStats[userEmail].sheet++; }
          else if (fileType === 'Google Slide') { totalStats.slide++; userStats[userEmail].slide++; } // Added for completeness
          else { totalStats.other++; userStats[userEmail].other++; } // Added for completeness


          try {
            // Scan the file for links and incompatible functions based on its type.
            // These calls use the main `auth` client, which is authenticated as ADMIN_USER.
            // The service account (acting as ADMIN_USER) must have read access to these files.
            // This is generally true if ADMIN_USER is a super admin or if files are domain-shared.
            // If files are user-private, this might fail unless service account has broad access.
            // Consider if `auth` should be re-scoped per user for these calls if granular access is an issue.
            if (file.mimeType === 'application/vnd.google-apps.document') {
              links = await findLinksInDoc(docs, drive, file.id, mainSpinner);
            } else if (file.mimeType === 'application/vnd.google-apps.spreadsheet') {
              const sheetData = await findLinksInSheet(sheets, drive, file.id, mainSpinner);
              links = sheetData.links;
              incompatibleFunctions = sheetData.incompatibleFunctions;
            } else if (file.mimeType === 'application/vnd.google-apps.presentation') {
              links = await findLinksInSlide(slides, drive, file.id, mainSpinner);
            } else if (file.mimeType === 'application/vnd.google-apps.folder') {
              // Folders are not scanned for content, already handled by file listing.
              // No specific action needed here for folders regarding link scanning.
            } else {
              // 'other' types are counted but not scanned for links in this structure.
              // If other types could have links and need scanning, add logic here.
            }

            // Update stats based on links found
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
                // case 'Other': // 'Other' not currently scanned for links
                //   totalStats.otherWithLinks++; 
                //   userStats[userEmail].otherWithLinks++;
                //   break;
              }
            }
            if (incompatibleFunctions.length > 0 && fileType === 'Google Sheet') {
              totalStats.sheetWithIncompatibleFunctions++; userStats[userEmail].sheetWithIncompatibleFunctions++;
            }
            mainSpinner.text = fileProgressText; // Reset spinner to file progress after successful scan operations
          } catch (scanError) {
            mainSpinner.warn(`Could not scan file ${file.name} (${file.id}) for user ${userEmail}: ${scanError.message}. Skipping this file's content scan.`);
            // Log the error but continue with the next file.
            console.error(`Detailed scan error for ${file.name}:`, scanError.stack);
            // Optionally, mark this file as having an error in the output.
          }

          // If links or incompatible functions are found, store the file data.
          // This data is used for both JSON and Google Sheets output.
          if (links.length > 0 || incompatibleFunctions.length > 0) {
            const fileData = {
              ownerEmail: userEmail, // The user being scanned is the owner context here.
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

            // If outputting to Google Sheets, prepare and add the row.
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

        // Batch write to Google Sheet to avoid hitting rate limits and improve performance.
        // Writes accumulated rows to the sheet when the batch size (100 rows) is reached.
        if (!jsonOutputFilePath && OUTPUT_SHEET_ID && rowsForSheet.length >= 100) { // Write every 100 rows
          mainSpinner.text = `Writing batch of ${rowsForSheet.length} rows to Google Sheet...`;
          await appendRows(sheets, OUTPUT_SHEET_ID, rowsForSheet, mainSpinner);
          rowsForSheet.length = 0; // Clear the array for the next batch
        }
      }
    }

    // --- OUTPUT GENERATION ---
    // Handles writing the collected data to either a JSON file or Google Sheets.

    if (jsonOutputFilePath) {
      mainSpinner.text = `Preparing JSON output: ${jsonOutputFilePath}`;
      // jsonOutputMode is already defined from argv, defaulting to 'overwrite'.

      // Initialize with current run's data (use deep copies to avoid modifying original stats).
      let jsonDataToWrite = {
        summary: {
          totalStats: JSON.parse(JSON.stringify(totalStats)),
          userStats: JSON.parse(JSON.stringify(userStats)),
          generationDate: new Date().toISOString(),
        },
        files: JSON.parse(JSON.stringify(allFilesData)), // allFilesData contains info on files with links/issues
      };

      // Logic for appending to an existing JSON file.
      // If --json-output-mode is 'append' and the file exists, data is merged.
      if (jsonOutputMode === 'append' && fs.existsSync(jsonOutputFilePath)) {
        mainSpinner.info(
          `Attempting to append to existing JSON file: ${jsonOutputFilePath}`
        );
        try {
          const existingJsonString = fs.readFileSync(jsonOutputFilePath, 'utf-8');
          const existingJsonData = JSON.parse(existingJsonString);

          // 1. Merge 'files' arrays: Concatenate new files with existing ones.
          // SECURITY: Assumes existing JSON structure is compatible. Malformed JSON could cause errors.
          // Consider adding more robust validation or merging strategies if complex conflicts are possible.
          jsonDataToWrite.files = (existingJsonData.files || []).concat(
            jsonDataToWrite.files // current run's files
          );

          // 2. Merge 'totalStats': Sum numerical values from current run into existing stats.
          const newTotalStats = JSON.parse(
            JSON.stringify(existingJsonData.summary?.totalStats || {})
          );
          for (const key in totalStats) {
            newTotalStats[key] = (newTotalStats[key] || 0) + totalStats[key];
          }
          jsonDataToWrite.summary.totalStats = newTotalStats;

          // 3. Merge 'userStats': Sum numerical values for each user.
          const newUserStats = JSON.parse(
            JSON.stringify(existingJsonData.summary?.userStats || {})
          );
          for (const userEmail in userStats) {
            if (!newUserStats[userEmail]) {
              newUserStats[userEmail] = JSON.parse(JSON.stringify(userStats[userEmail]));
            } else {
              for (const key in userStats[userEmail]) {
                newUserStats[userEmail][key] =
                  (newUserStats[userEmail][key] || 0) + userStats[userEmail][key];
              }
            }
          }
          jsonDataToWrite.summary.userStats = newUserStats;

          // 4. Update generation date to reflect the latest append operation.
          jsonDataToWrite.summary.generationDate = new Date().toISOString();
          mainSpinner.info(
            `Successfully prepared data for appending to ${jsonOutputFilePath}.`
          );
        } catch (e) {
          mainSpinner.fail(
            `Error reading/parsing existing JSON for append: ${e.message}. Will overwrite with current scan data as a fallback.`
          );
          // Fallback: jsonDataToWrite is already initialized with current run's data,
          // so it effectively becomes an overwrite operation.
          jsonDataToWrite = { // Re-initialize to be absolutely sure it's only current run's data
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
        // If append mode is specified but file doesn't exist, create a new file.
        mainSpinner.info(
          `JSON file ${jsonOutputFilePath} not found. Will create a new file (append mode specified but no file to append to).`
        );
        // jsonDataToWrite is already set to current run's data, which is correct.
      } else {
        // This covers 'overwrite' mode, or if jsonOutputMode is invalid (defaulting to overwrite).
        mainSpinner.info(
          `Overwriting or creating new JSON file: ${jsonOutputFilePath}`
        );
        // jsonDataToWrite is already set to current run's data.
      }

      try {
        // Write the final JSON data to the specified file.
        // SECURITY: Ensure the path `jsonOutputFilePath` is sanitized if it could be user-influenced
        // beyond a simple filename (e.g., to prevent directory traversal if path construction was more complex).
        // Here, it's taken directly from CLI arg, so user is responsible for providing a valid path.
        fs.writeFileSync(
          jsonOutputFilePath,
          JSON.stringify(jsonDataToWrite, null, 2) // Pretty print JSON
        );
        mainSpinner.succeed(`Audit results written to ${jsonOutputFilePath}`);
      } catch (e) {
        mainSpinner.fail(
          `Failed to write JSON to ${jsonOutputFilePath}: ${e.message}`
        );
        console.error(e); // Log the full error
      }
    } else if (OUTPUT_SHEET_ID) {
      // Logic for writing to Google Sheets.
      // Write any remaining rows from the multi-file scan.
      if (rowsForSheet.length > 0) {
        mainSpinner.text = `Writing final batch of ${rowsForSheet.length} rows to Google Sheet...`;
        await appendRows(sheets, OUTPUT_SHEET_ID, rowsForSheet, mainSpinner);
      }
      // Write the summary tab, but only if it was a multi-file scan (not single file).
      // The summary tab provides an overview of the scan results.
      if (!singleFileId) {
        mainSpinner.text = 'Writing summary tab...';
        await writeSummaryTab(
          sheets,
          OUTPUT_SHEET_ID,
          userStats,
          totalStats,
          mainSpinner
        );
      }
      mainSpinner.succeed('Audit complete! Results written to Google Sheet.');
    } else {
      // This case should ideally not be reached due to earlier checks, but as a safeguard:
      mainSpinner.info(
        'No output method specified (JSON or Sheet ID). Results not saved.'
      );
    }
  } catch (error) {
    // Catch-all for errors in the main function.
    // This ensures that any unexpected errors are logged and the script exits gracefully.
    mainSpinner.fail(`Audit failed: ${error.message}`);
    console.error('Detailed error:', error, error.stack); // Log full error and stack.
    process.exit(1); // Exit with error code.
  }
}

// --- CONSTANTS FOR SHEET NAMES ---
// Defines constant names for the Google Sheets used by the script.
// This improves maintainability and reduces the risk of typos.
const AUDIT_DETAILS_SHEET_NAME = 'AuditDetails'; // Name for the sheet containing detailed file findings.
const SUMMARY_SHEET_NAME = 'Summary';           // Name for the sheet containing summary statistics.

// --- SHEET HELPERS ---
// Contains functions for interacting with Google Sheets (clearing, setting headers, appending rows, writing summary).

// Clears the 'AuditDetails' sheet and sets its header row.
// If the sheet doesn't exist, it attempts to create it.
// SECURITY: Modifies a Google Sheet. Ensure OUTPUT_SHEET_ID is correct and the service account
// has write permissions to this sheet.
async function clearAndSetHeaders(sheets, spreadsheetId, spinner) {
  spinner.text = `Preparing sheet: ${AUDIT_DETAILS_SHEET_NAME}`;
  try {
    // Attempt to clear the sheet.
    await callWithRetry(
      () =>
        sheets.spreadsheets.values.clear({
          spreadsheetId,
          range: AUDIT_DETAILS_SHEET_NAME, // Clear all cells in this sheet
        }),
      spinner
    );
  } catch (e) {
    // If clearing fails because the sheet doesn't exist, create it.
    if (
      e.message?.includes('Unable to parse range') || // Error message if sheet name is not found
      e.message?.toLowerCase().includes('not found')
    ) {
      spinner.text = `${AUDIT_DETAILS_SHEET_NAME} not found, creating...`;
      try {
        await callWithRetry(
          () =>
            sheets.spreadsheets.batchUpdate({ // Use batchUpdate to add a new sheet
              spreadsheetId,
              requestBody: {
                requests: [
                  {
                    addSheet: { // Request to add a sheet
                      properties: { title: AUDIT_DETAILS_SHEET_NAME },
                    },
                  },
                ],
              },
            }),
          spinner
        );
        spinner.info(`${AUDIT_DETAILS_SHEET_NAME} created.`);
      } catch (addSheetError) {
        spinner.fail(
          `Failed to create ${AUDIT_DETAILS_SHEET_NAME}: ${addSheetError.message}`
        );
        throw addSheetError; // Propagate error
      }
    } else {
      // If clearing failed for another reason, report and propagate.
      spinner.fail(
        `Failed to clear/prepare ${AUDIT_DETAILS_SHEET_NAME}: ${e.message}`
      );
      throw e; // Propagate error
    }
  }

  // Set the header row for the 'AuditDetails' sheet.
  spinner.text = `Setting headers for: ${AUDIT_DETAILS_SHEET_NAME}`;
  const headers = [
    'Owner Email',
    'File Name',
    'File ID',
    'File Type',
    'File URL',
    'Linked Items/References (URLs, Drive IDs)',
    'GSuite Specific Functions (Sheets only)',
  ];
  await callWithRetry(
    () =>
      sheets.spreadsheets.values.update({ // Update cell A1 onwards with headers
        spreadsheetId,
        range: `${AUDIT_DETAILS_SHEET_NAME}!A1`, // Start at cell A1
        valueInputOption: 'RAW', // Treat values as raw strings, not parsed (e.g., for dates)
        requestBody: { values: [headers] }, // Data is an array of arrays (rows)
      }),
    spinner
  );
}

// Appends an array of rows to the 'AuditDetails' sheet.
// SECURITY: Writes data to Google Sheets. Ensure data is sanitized if it originates from untrusted sources,
// though here it's primarily file metadata and extracted links/functions.
async function appendRows(sheets, spreadsheetId, rows, spinner) {
  if (rows.length === 0) return; // Do nothing if there are no rows to append.
  spinner.text = `Appending ${rows.length} rows to: ${AUDIT_DETAILS_SHEET_NAME}`;
  await callWithRetry(
    () =>
      sheets.spreadsheets.values.append({
        spreadsheetId,
        range: AUDIT_DETAILS_SHEET_NAME, // Append to this sheet
        valueInputOption: 'USER_ENTERED', // Values treated as if user typed them (e.g., formulas calculated)
        insertDataOption: 'INSERT_ROWS',  // Insert new rows for the data
        requestBody: { values: rows },
      }),
    spinner
  );
}

// Writes the summary statistics to the 'Summary' sheet.
// Clears the sheet if it exists, or creates it if it doesn't.
// SECURITY: Similar to other sheet operations, ensure OUTPUT_SHEET_ID is correct and permissions are set.
async function writeSummaryTab(
  sheets,
  spreadsheetId,
  userStats,
  totalStats,
  spinner
) {
  spinner.text = `Preparing summary sheet: ${SUMMARY_SHEET_NAME}`;
  let sheetExists = false;
  try {
    // Check if the summary sheet already exists in the spreadsheet.
    const sp = await callWithRetry(
      () =>
        sheets.spreadsheets.get({ // Get spreadsheet metadata
          spreadsheetId,
          fields: 'sheets.properties.title', // Only need sheet titles
        }),
      spinner
    );
    sheetExists = sp.data.sheets.some(
      (s) => s.properties.title === SUMMARY_SHEET_NAME
    );
  } catch (e) {
    // If checking fails (e.g., permissions issue, though unlikely if other ops worked),
    // warn and proceed assuming it might need creation.
    spinner.warn(
      `Could not check for summary sheet existence: ${e.message}. Will attempt to create/clear.`
    );
  }

  if (sheetExists) {
    spinner.text = `Clearing: ${SUMMARY_SHEET_NAME}`;
    try {
      // If sheet exists, clear its content.
      await callWithRetry(
        () =>
          sheets.spreadsheets.values.clear({
            spreadsheetId,
            range: SUMMARY_SHEET_NAME,
          }),
        spinner
      );
    } catch (e) {
      // If clearing fails, warn but proceed to try writing.
      // This might happen if sheet has protections not bypassable by 'clear'.
      spinner.warn(`Could not clear ${SUMMARY_SHEET_NAME}: ${e.message}. Data might be appended or overwrite partially.`);
    }
  } else {
    spinner.text = `Creating: ${SUMMARY_SHEET_NAME}`;
    try {
      // If sheet doesn't exist, create it.
      await callWithRetry(
        () =>
          sheets.spreadsheets.batchUpdate({
            spreadsheetId,
            requestBody: {
              requests: [
                { addSheet: { properties: { title: SUMMARY_SHEET_NAME } } },
              ],
            },
          }),
        spinner
      );
      spinner.info(`${SUMMARY_SHEET_NAME} created.`);
    } catch (e) {
      spinner.fail(`Failed to create ${SUMMARY_SHEET_NAME}: ${e.message}`);
      throw e; // Critical failure if sheet cannot be created for summary.
    }
  }

  // Prepare data for the summary tab.
  // This includes headers, per-user statistics, and overall totals.
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
    'Other Files w/ Links', // Currently not populated for 'other'
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
    stats.otherWithLinks, // Currently 0 for 'other'
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
    totalStats.otherWithLinks, // Currently 0 for 'other'
  ];
  const allRows = [header, ...userRows, totalRow]; // Combine header, user data, and total data.

  spinner.text = `Writing summary data to ${SUMMARY_SHEET_NAME}`;
  await callWithRetry(
    () =>
      sheets.spreadsheets.values.update({ // Write all summary data starting at A1.
        spreadsheetId,
        range: `${SUMMARY_SHEET_NAME}!A1`,
        valueInputOption: 'USER_ENTERED', // Allow formulas/numbers to be interpreted.
        requestBody: { values: allRows },
      }),
    spinner
  );
}

// --- USER & FILE HELPERS ---
// Contains functions for fetching user lists and file lists from Google Workspace.

// Fetches all non-suspended, non-archived users from the Google Workspace domain.
// Uses pagination to retrieve all users if there are more than `maxResults` per page.
// SECURITY: Requires Admin SDK `admin.directory.user.readonly` scope and ADMIN_USER to have
// sufficient privileges (e.g., User Management Admin role).
async function getAllUsers(admin, spinner) {
  let users = [];
  let pageToken;
  let pageCount = 0;
  const MAX_USERS_PER_PAGE = 500; // Max allowed by API is 500.
  do {
    pageCount++;
    spinner.text = `Fetching users (page ${pageCount}, ${users.length} fetched so far)...`;
    const res = await callWithRetry(
      () =>
        admin.users.list({
          customer: 'my_customer', // Refers to the primary domain.
          maxResults: MAX_USERS_PER_PAGE,
          pageToken,
          orderBy: 'email', // Sort for consistent ordering, useful for resumability if ever added.
          query: 'isSuspended=false', // Filter for active users. `orgUnitPath='/'` could also be used.
          projection: 'full', // 'basic' or 'custom' could be used if fewer fields are needed. 'full' gets more attributes.
                              // We only strictly need primaryEmail here.
        }),
      spinner
    );
    if (res.data.users?.length) {
      // Further filter to ensure users are not suspended or archived and have a primary email.
      // The API query 'isSuspended=false' should handle suspended, but this is an extra check.
      // `archived` is another state to exclude.
      users = users.concat(
        res.data.users.filter(
          (u) => !u.suspended && !u.archived && u.primaryEmail
        )
      );
    }
    pageToken = res.data.nextPageToken; // Token for the next page of results.
  } while (pageToken);
  return users;
}

// Lists files owned by a specific user in Google Drive.
// Filters for Google Docs, Sheets, and Presentations by default.
// SECURITY: This function operates under the context of the `ADMIN_USER` usually,
// but the `q` parameter specifies `'${userEmail}' in owners`.
// The service account (delegated to ADMIN_USER) must have authority to access metadata
// for files owned by `userEmail`. This is typically granted via domain-wide delegation.
async function listUserFiles(drive, userEmail, spinner) {
  let files = [];
  let pageToken;
  // Define MIME types for Google Workspace documents to be scanned.
  const queryMimeTypes = [
    'application/vnd.google-apps.document',    // Google Docs
    'application/vnd.google-apps.spreadsheet', // Google Sheets
    'application/vnd.google-apps.presentation', // Google Slides
  ];
  // Construct the query for the Drive API.
  // - `'${userEmail}' in owners`: Files owned by the specified user.
  // - `trashed = false`: Exclude files in the trash.
  // - `mimeType = ...`: Filter by the defined Google Workspace MIME types.
  const q = `'${userEmail}' in owners and trashed = false and (${queryMimeTypes
    .map((m) => `mimeType = '${m}'`)
    .join(' or ')})`;
  // Specify the fields to retrieve for each file. Minimizing fields improves performance.
  const fields =
    'nextPageToken, files(id, name, mimeType, webViewLink, owners(emailAddress))'; // owners for single file context
  const PAGE_SIZE = 1000; // Max files per page request (API max is 1000).
  do {
    const res = await callWithRetry(
      () =>
        drive.files.list({
          q,
          fields,
          pageSize: PAGE_SIZE,
          pageToken,
          supportsAllDrives: true,      // Include results from Shared Drives where user is a member.
          includeItemsFromAllDrives: true, // Required with supportsAllDrives.
          corpora: 'user', // Specifies that the query is for the user's corpus, not domain-wide.
                           // Other options: 'drive' (for a specific Shared Drive), 'allDrives'.
        }),
      spinner
    );
    if (res.data.files?.length) files = files.concat(res.data.files);
    pageToken = res.data.nextPageToken;
  } while (pageToken);
  return files;
}

// Converts a MIME type string to a more human-readable file type string.
// This helps in presenting file types in a user-friendly way in the output.
function getFileType(mimeType) {
  if (!mimeType) return 'Unknown Type';
  if (mimeType === 'application/vnd.google-apps.document') return 'Google Doc';
  if (mimeType === 'application/vnd.google-apps.spreadsheet') return 'Google Sheet';
  if (mimeType === 'application/vnd.google-apps.presentation') return 'Google Slide';
  if (mimeType.startsWith('application/vnd.google-apps')) return 'Google Workspace File'; // Catch-all for other GApps types
  return mimeType; // Return the original MIME type if not a known Google type.
}

// --- LINK EXTRACTION HELPERS ---
// Contains functions for extracting URLs and other relevant information (like Drive File IDs or function names)
// from various content types (text, formulas).

// Extracts a Google Drive file ID from various Google Drive/Docs URL formats.
// Returns the file ID string or null if no ID is found.
// SECURITY: URL parsing can be complex. While these regexes are for known Google formats,
// ensure they don't have unintended capture groups or catastrophic backtracking potential with unusual inputs,
// though input here is typically from Google APIs themselves.
function getDriveFileIdFromUrl(url) {
  if (typeof url !== 'string') return null;
  // Regex patterns to match different Google Drive URL structures.
  // These aim to capture the ~44 character base64-like ID.
  const patterns = [
    // Standard Docs/Sheets/Slides/Forms/Drawings links: https://docs.google.com/.../d/FILE_ID/...
    /https?:\/\/docs\.google\.com\/(?:document|spreadsheets|presentation|forms|drawings|file)\/d\/([a-zA-Z0-9\-_]{25,})/i,
    // Drive file links: https://drive.google.com/file/d/FILE_ID/...
    /https?:\/\/drive\.google\.com\/file\/d\/([a-zA-Z0-9\-_]{25,})/i,
    // Drive open links: https://drive.google.com/open?id=FILE_ID
    /https?:\/\/drive\.google\.com\/open\?id=([a-zA-Z0-9\-_]{25,})/i,
    // Drive folder links (captures folder ID, might be useful for context but this fn is for file IDs)
    // Note: This might not be what's intended if strictly file IDs are needed.
    /https?:\/\/drive\.google\.com\/drive\/(?:folders|u\/\d+\/folders)\/([a-zA-Z0-9\-_]{25,})/i,
    // Shared Drive links (captures shared drive ID, not file ID)
    // Note: Similar to folder IDs, this might not be the primary target for "file ID".
    /https?:\/\/drive\.google\.com\/drive\/shared-drives\/([a-zA-Z0-9\-_]{15,})/i, // Shared drive IDs are shorter
  ];
  for (const regex of patterns) {
    const match = url.match(regex);
    if (match?.[1]) return match[1]; // Return the captured group (the ID)
  }
  return null; // No ID found
}

// Resolves a Google Drive file ID to its metadata (name, type, URL, shared drive status).
// Used to enrich link information from just a URL/ID to a more descriptive entry.
// `originalUrl` is kept for fallback if webViewLink is not available.
// SECURITY: Makes an API call to `drive.files.get`. Ensure service account has permission
// to access metadata for the given fileId. If a file is highly restricted, this might fail.
async function resolveFileMetadata(drive, fileId, spinner, originalUrl) {
  try {
    const originalSpinnerText = spinner.text; // Save current spinner text
    // Update spinner to indicate file ID resolution is in progress.
    spinner.text = `${originalSpinnerText} - Resolving ID ${fileId.substring(
      0,
      10 // Show first 10 chars of ID for brevity
    )}... for ${originalUrl.substring(0, 30)}...`; // Show start of URL

    const file = await callWithRetry(
      () =>
        drive.files.get({
          fileId,
          // Request specific fields to minimize data transfer and processing.
          fields: 'name,mimeType,webViewLink,teamDriveId,driveId', // driveId is for Shared Drives
          supportsAllDrives: true, // Essential for accessing files in Shared Drives.
        }),
      spinner
    );
    spinner.text = originalSpinnerText; // Restore original spinner text
    return {
      name: file.data.name || 'Unknown Name', // Fallback for missing name
      type: getFileType(file.data.mimeType),
      url: file.data.webViewLink || originalUrl, // Fallback to original URL
      // `teamDriveId` is the legacy field for Shared Drive ID. `driveId` is the current one.
      isSharedDrive: !!(file.data.teamDriveId || file.data.driveId),
    };
  } catch (error) {
    // If file resolution fails (e.g., file deleted, no permission), log a warning and return null.
    // This prevents one failed resolution from stopping the entire scan.
    // spinner.text is already restored or handled by callWithRetry's fail.
    // console.warn(`Could not resolve metadata for file ID ${fileId} (URL: ${originalUrl}): ${error.message}`);
    return null; // Indicate failure to resolve
  }
}

// Processes a list of raw URLs, attempting to resolve Google Drive links to their metadata.
// Filters out duplicate URLs before processing.
// Returns an array of strings, where each string is either the original URL (if not a Drive link or unresolvable)
// or a formatted string with resolved metadata.
// SECURITY: Iterates over URLs extracted from file content. If content can be user-manipulated
// to include excessively long or malformed URLs, it could impact performance, though `getDriveFileIdFromUrl`
// and `resolveFileMetadata` have some robustness.
async function processRawUrls(drive, rawUrls, spinner) {
  // Deduplicate URLs and filter out any null/empty/non-string entries.
  const uniqueRawUrls = [
    ...new Set(rawUrls.filter((url) => url && typeof url === 'string')),
  ];
  const resolvedLinkInfo = [];

  for (const url of uniqueRawUrls) {
    const fileId = getDriveFileIdFromUrl(url);
    if (fileId) {
      // If a Drive file ID is extracted, attempt to resolve its metadata.
      const metadata = await resolveFileMetadata(drive, fileId, spinner, url);
      if (metadata) {
        // If metadata is resolved, create a descriptive string.
        resolvedLinkInfo.push(
          `${url} (Name: ${metadata.name}, Type: ${metadata.type}${
            metadata.isSharedDrive ? ', Shared Drive' : ''
          })`
        );
      } else {
        // If metadata resolution fails, include the URL and ID, noting it's unresolved.
        resolvedLinkInfo.push(`${url} (Unresolved Drive Link: ID ${fileId})`);
      }
    } else if (url.includes('google.com/') || url.startsWith('/')) {
      // If it's a Google-related URL but not a standard Drive file link (e.g., other Google services, relative links),
      // or if it's a relative path that might be contextually Google-related, keep it.
      // This helps capture links to other Google properties or potentially internal tools.
      // SECURITY: Be cautious if these URLs are ever used for outbound requests without validation,
      // though here they are just for reporting.
      resolvedLinkInfo.push(url);
    }
    // Non-Google URLs are implicitly filtered out by not being added to resolvedLinkInfo,
    // unless the original `extractDriveLinks` and other extractors pick them up and they pass the `if/else if` above.
    // Current logic primarily focuses on Google ecosystem links.
  }
  return resolvedLinkInfo;
}

// --- Formula/URL Extractors ---
// These functions parse formulas or text content to find specific types of URLs or function names.
// SECURITY: Regex-based parsing of potentially complex strings (formulas, text).
// Ensure regexes are well-tested to avoid performance issues (e.g., catastrophic backtracking)
// on crafted inputs, although inputs are generally from Google API responses.

// Extracts Google Sheet IDs from IMPORTRANGE formulas.
// Handles both direct Sheet IDs and full Sheet URLs within the IMPORTRANGE.
function extractImportrangeIds(formula) {
  const ids = [];
  // Regex to find IMPORTRANGE function calls and capture the first argument (spreadsheet_url or spreadsheet_key).
  const regex = /IMPORTRANGE\s*\(\s*(?:"([^"]+)"|'([^']+)')\s*,/gi; // Matches URL/ID in double or single quotes
  let match;
  while ((match = regex.exec(formula)) !== null) {
    const val = match[1] || match[2]; // The captured URL or ID
    const id = getDriveFileIdFromUrl(val); // Try to get a standard ID from it
    if (id) {
      ids.push(`https://docs.google.com/spreadsheets/d/${id}`); // Standardize to a full URL
    } else if (val?.length >= 25 && !val.includes(' ') && !val.includes(',')) {
      // If it looks like an ID (length check, no spaces/commas which are invalid in IDs but common in sheet names)
      // but getDriveFileIdFromUrl didn't parse it (e.g. it was just the ID string, not a full URL),
      // assume it's a direct ID.
      ids.push(`https://docs.google.com/spreadsheets/d/${val}`);
    }
    // Otherwise, if 'val' is neither a recognizable URL nor a standalone ID, it's ignored.
  }
  return ids;
}

// Extracts URLs from HYPERLINK formulas.
function extractHyperlinkUrls(formula) {
  const urls = [];
  // Regex to find HYPERLINK function calls and capture the first argument (url).
  const regex = /HYPERLINK\s*\(\s*(?:"([^"]+)"|'([^']+)')/gi; // URL is the first argument
  let match;
  while ((match = regex.exec(formula)) !== null) {
    urls.push(match[1] || match[2]);
  }
  return urls;
}

// Extracts URLs from IMAGE formulas.
function extractImageUrls(formula) {
  const urls = [];
  // Regex to find IMAGE function calls and capture the first argument (url).
  const regex = /IMAGE\s*\(\s*(?:"([^"]+)"|'([^']+)')/gi; // URL is the first argument
  let match;
  while ((match = regex.exec(formula)) !== null) {
    urls.push(match[1] || match[2]);
  }
  return urls;
}

// Extracts Google Drive and other Google-related links from arbitrary text.
// Uses a set of regex patterns to find various URL formats.
// SECURITY: Relies on regex to parse text. Broad regexes (like the google.com catch-all)
// could have performance implications or false positives on very large/complex text inputs.
// The filtering logic (e.g., `getDriveFileIdFromUrl` check) helps mitigate some false positives.
function extractDriveLinks(text) {
  if (typeof text !== 'string' || !text) return [];
  const patterns = [
    // Google Docs, Sheets, Presentations, Forms, Files, Drawings by /d/ID structure
    /https?:\/\/docs\.google\.com\/(?:document|spreadsheets|presentation|forms|file|drawings)\/d\/[a-zA-Z0-9\-_]{25,}(?:\/[^#?\s]*)?/gi,
    // Google Drive links by /file/d/ID or open?id=ID structure
    /https?:\/\/drive\.google\.com\/(?:file\/d\/|open\?id=)[a-zA-Z0-9\-_]{25,}(?:\/[^#?\s]*)?/gi,
    // Google Drive folder or shared drive links
    /https?:\/\/drive\.google\.com\/drive\/(?:folders|u\/\d+\/folders|shared-drives)\/[a-zA-Z0-9\-_]{15,}(?:\/[^#?\s]*)?/gi,
    // Broader catch-all for *.google.com links to capture other services or less common formats.
    // SECURITY: This is a broad regex. While used for reporting here, if such extracted links were
    // ever used for active requests, they'd need careful validation to prevent SSRF or other issues.
    /https?:\/\/(?:[a-zA-Z0-9-]+\.)*google\.com\/[^\s"';<>()]+/gi,
  ];
  let foundLinks = new Set(); // Use a Set to store unique links
  for (const regex of patterns) {
    let match;
    while ((match = regex.exec(text)) !== null) {
      // Clean trailing punctuation that might be part of the sentence but not the URL.
      const potentialLink = match[0].replace(/[;,.)]$/, '');
      // Further qualify that it's likely a Drive/Docs link before adding.
      // This helps reduce false positives from the broader google.com regex.
      if (
        getDriveFileIdFromUrl(potentialLink) || // Has a parsable Drive ID
        potentialLink.includes('docs.google.com/') ||
        potentialLink.includes('drive.google.com/')
      ) {
        foundLinks.add(potentialLink);
      }
    }
  }
  return Array.from(foundLinks);
}

// Extracts function names from a spreadsheet formula string.
// E.g., "SUM(A1:B2)" -> ["SUM"]. "IF(COUNTIF(C:C,">10"),"Yes","No")" -> ["IF", "COUNTIF"]
// SECURITY: Regex for function names. Assumes function names follow typical conventions.
// Complex or obfuscated formulas might not be fully parsed.
function extractFunctionNamesFromFormula(formula) {
  if (typeof formula !== 'string') return [];
  // Regex to find sequences of uppercase letters, numbers, underscores, and periods (for custom functions or add-on functions)
  // followed by an opening parenthesis, indicating a function call.
  const functionRegex = /\b([A-Z0-9_.]+)\s*\(/gi;
  const foundFunctions = new Set(); // Use Set for unique function names
  let match;
  while ((match = functionRegex.exec(formula)) !== null) {
    foundFunctions.add(match[1].toUpperCase()); // Standardize to uppercase
  }
  return Array.from(foundFunctions);
}

// --- DOCS ---
// Finds links within a Google Document.
// Fetches document content and parses paragraphs, text runs, and inline objects for URLs.
// SECURITY: Reads content from Google Docs. Service account needs read access to the document.
// The parsing logic iterates through document structure; very large or complex documents
// could impact performance, though API responses are typically paginated or structured.
async function findLinksInDoc(docs, drive, docId, spinner) {
  // Specify fields to fetch: body content, paragraph elements, text runs, links, and inline objects.
  // This minimizes the data retrieved from the API.
  const DOC_FIELDS =
    'body(content(paragraph(elements(textRun(content,textStyle.link.url),inlineObjectElement(inlineObjectId))))),inlineObjects';
  const res = await callWithRetry(
    () => docs.documents.get({ documentId: docId, fields: DOC_FIELDS }),
    spinner
  );
  let rawUrls = [];
  if (res.data.body?.content) {
    for (const el of res.data.body.content) {
      if (el.paragraph?.elements) {
        for (const elem of el.paragraph.elements) {
          if (elem.textRun) {
            // Check for explicit links in text runs.
            if (elem.textRun.textStyle?.link?.url) {
              rawUrls.push(elem.textRun.textStyle.link.url);
            }
            // Also extract potential Drive links from the text content itself.
            if (elem.textRun.content) {
              rawUrls.push(...extractDriveLinks(elem.textRun.content));
            }
          }
          // Check for links in inline objects (e.g., embedded images, charts).
          if (
            elem.inlineObjectElement?.inlineObjectId &&
            res.data.inlineObjects // Ensure inlineObjects map exists
          ) {
            const obj =
              res.data.inlineObjects[elem.inlineObjectElement.inlineObjectId];
            if (obj?.inlineObjectProperties?.embeddedObject) {
              const emb = obj.inlineObjectProperties.embeddedObject;
              // Extract links from various properties of embedded objects.
              if (emb.description) { // Links in descriptions
                rawUrls.push(...extractDriveLinks(emb.description));
              }
              if (emb.imageProperties?.contentUrl) { // Direct content URL of an image
                rawUrls.push(emb.imageProperties.contentUrl);
              }
              if (emb.imageProperties?.sourceUrl) { // Source URL if image is linked
                rawUrls.push(emb.imageProperties.sourceUrl);
              }
              // Links to spreadsheets from embedded Sheets charts.
              if (
                emb.linkedContentReference?.sheetsChartReference?.spreadsheetId
              ) {
                rawUrls.push(
                  `https://docs.google.com/spreadsheets/d/${emb.linkedContentReference.sheetsChartReference.spreadsheetId}/`
                );
              }
              // Other embedded object types could be added here if needed (e.g., drawings).
            }
          }
        }
      }
    }
  }
  // Process all collected raw URLs to resolve Drive links and deduplicate.
  return processRawUrls(drive, rawUrls, spinner);
}

// --- SHEETS ---
// Finds links and G Suite specific functions within a Google Spreadsheet.
// Fetches sheet data including cell values, formulas, hyperlinks, charts, and conditional formatting.
// SECURITY: Reads content from Google Sheets. Service account needs read access.
// Spreadsheets can be very large. The script fetches a lot of data (SPREADSHEET_FIELDS).
// Performance could be an issue for extremely large or complex sheets. Parsing formulas and cell content
// relies on regex and iteration, which should be monitored for performance with diverse inputs.
async function findLinksInSheet(sheets, drive, sheetId, spinner) {
  // Specify a comprehensive set of fields to ensure all potential link locations are covered.
  // This includes sheet properties, cell data (values, formulas, hyperlinks), charts, and conditional formats.
  const SPREADSHEET_FIELDS =
    'properties.title,spreadsheetId,sheets(properties(title,sheetType,sheetId),data(rowData(values(userEnteredValue,effectiveValue,formattedValue,hyperlink,textFormatRuns.format.link.uri,dataValidation.condition.values.userEnteredValue))),charts(chartId,spec),conditionalFormats(booleanRule(condition(values(userEnteredValue)))))';
  const res = await callWithRetry(
    () =>
      sheets.spreadsheets.get({
        spreadsheetId: sheetId,
        fields: SPREADSHEET_FIELDS,
      }),
    spinner
  );

  let rawUrls = []; // To store all found URLs before processing.
  let allFormulaFunctions = new Set(); // To store all unique function names found in formulas.

  if (res.data?.sheets) {
    for (const sheet of res.data.sheets) { // Iterate through each sheet in the spreadsheet
      if (sheet.data) {
        for (const gridData of sheet.data) { // Iterate through grid data (actual cell data)
          if (gridData.rowData) {
            for (const row of gridData.rowData) { // Iterate through rows
              if (row.values) {
                for (const cell of row.values) { // Iterate through cells in the row
                  if (!cell) continue; // Skip empty cells

                  // Extract from formula (userEnteredValue or effectiveValue if formula result)
                  const formula =
                    cell.userEnteredValue?.formulaValue || // Prefer user-entered formula
                    cell.effectiveValue?.formulaValue;   // Fallback to effective formula
                  if (formula) {
                    rawUrls.push(
                      ...extractImportrangeIds(formula),
                      ...extractHyperlinkUrls(formula),
                      ...extractImageUrls(formula),
                      ...extractDriveLinks(formula) // Also check formula string for plain URLs
                    );
                    extractFunctionNamesFromFormula(formula).forEach((fn) =>
                      allFormulaFunctions.add(fn)
                    );
                  }

                  // Extract from explicit hyperlink property on the cell.
                  if (cell.hyperlink) rawUrls.push(cell.hyperlink);

                  // Extract from text format runs (links applied to parts of cell text).
                  cell.textFormatRuns?.forEach((run) => {
                    if (run.format?.link?.uri) {
                      rawUrls.push(run.format.link.uri);
                    }
                  });

                  // Extract from plain text content of the cell (formatted or string value).
                  const plainText =
                    cell.userEnteredValue?.stringValue || cell.formattedValue;
                  if (plainText) rawUrls.push(...extractDriveLinks(plainText));

                  // Extract from data validation rules (e.g., list from range that might be a URL).
                  // This specifically looks at userEnteredValue within condition values.
                  cell.dataValidation?.condition?.values?.forEach((v) => {
                    if (v.userEnteredValue) { // If the condition value is a user-entered string
                      rawUrls.push(...extractDriveLinks(v.userEnteredValue));
                      // Also check for functions if the DV condition value is a formula string
                       extractFunctionNamesFromFormula(v.userEnteredValue).forEach(fn => allFormulaFunctions.add(fn));
                    }
                  });
                }
              }
            }
          }
        }
      }
      // Extract from conditional formatting rules.
      sheet.conditionalFormats?.forEach((cf) =>
        cf.booleanRule?.condition?.values?.forEach((v) => {
          if (v.userEnteredValue) { // If condition value is a user-entered string (could be formula or text)
            rawUrls.push(...extractDriveLinks(v.userEnteredValue));
            extractFunctionNamesFromFormula(v.userEnteredValue).forEach((fn) =>
              allFormulaFunctions.add(fn)
            );
          }
        })
      );
      // Extract from embedded charts (links to other spreadsheets if chart data is external).
      sheet.charts?.forEach((chart) => {
        if (chart.spec?.spreadsheetId) { // If chart references another spreadsheet
          rawUrls.push(
            `https://docs.google.com/spreadsheets/d/${chart.spec.spreadsheetId}/`
          );
        }
        // Other chart properties like title, axis labels, etc., could also be scanned if needed.
        // For example, chart.spec.title, chart.spec.subtitle, etc.
        // if (chart.spec?.title) rawUrls.push(...extractDriveLinks(chart.spec.title));
      });
    }
  }
  // Process all collected raw URLs and identify G Suite specific functions.
  const links = await processRawUrls(drive, rawUrls, spinner);
  const incompatibleFunctions = Array.from(allFormulaFunctions).filter((fn) =>
    GSUITE_SPECIFIC_FUNCTIONS.includes(fn) // Compare against the predefined list
  );

  return { links, incompatibleFunctions };
}

// --- SLIDES ---
// Finds links within a Google Slides presentation.
// Fetches presentation content and parses page elements (shapes, images, videos, charts) for URLs.
// SECURITY: Reads content from Google Slides. Service account needs read access.
// Similar to Docs and Sheets, performance can be affected by presentation size and complexity.
async function findLinksInSlide(slides, drive, slideId, spinner) {
  // Specify fields to retrieve: presentation ID, slides, page elements within slides,
  // and elements within notes pages associated with slides.
  const SLIDE_FIELDS =
    'presentationId,slides(pageElements,slideProperties.notesPage.pageElements)';
  const res = await callWithRetry(
    () =>
      slides.presentations.get({
        presentationId: slideId,
        fields: SLIDE_FIELDS,
      }),
    spinner
  );
  let rawUrls = []; // To store all found URLs.

  // Helper function to recursively process page elements for links.
  // This is used for slide content, notes page content, and grouped elements.
  function processPageElements(elements) {
    if (!elements) return;
    for (const el of elements) { // Iterate through page elements
      // Links in text shapes.
      el.shape?.text?.textElements?.forEach((te) => {
        if (te.textRun) {
          if (te.textRun.style?.link?.url) { // Explicit link on text
            rawUrls.push(te.textRun.style.link.url);
          }
          if (te.textRun.content) { // Links embedded in text content
            rawUrls.push(...extractDriveLinks(te.textRun.content));
          }
        }
      });
      // Links in images (content URL, source URL, or link applied to image).
      if (el.image) {
        if (el.image.contentUrl) rawUrls.push(el.image.contentUrl); // URL of the image itself
        if (el.image.sourceUrl) rawUrls.push(el.image.sourceUrl);   // Source if image is linked externally
        if (el.image.imageProperties?.link?.url) { // Explicit link applied to the image
          rawUrls.push(el.image.imageProperties.link.url);
        }
      }
      // Links in videos (direct URL or Drive link if video is from Drive).
      if (el.video) {
        if (el.video.url) rawUrls.push(el.video.url); // URL if video is from YouTube or elsewhere
        if (el.video.source === 'DRIVE' && el.video.id) { // If video is from Google Drive
          rawUrls.push(`https://drive.google.com/file/d/${el.video.id}/view`);
        }
      }
      // Links from embedded Sheets charts.
      if (el.sheetsChart?.spreadsheetId) {
        rawUrls.push(
          `https://docs.google.com/spreadsheets/d/${el.sheetsChart.spreadsheetId}/`
        );
      }
      // Recursively process elements within groups.
      if (el.elementGroup?.children) {
               processPageElements(el.elementGroup.children);
      }
      // Other element types (e.g., tables, word art) could be added here if they can contain links.
    }
  }
  if (res.data.slides) {
    for (const slide of res.data.slides) { // Iterate through each slide
      processPageElements(slide.pageElements); // Process elements on the slide itself.
      if (slide.slideProperties?.notesPage) { // Process elements on the notes page for the slide.
        processPageElements(slide.slideProperties.notesPage.pageElements);
      }
    }
  }
  // Process all collected raw URLs to resolve Drive links and deduplicate.
  return processRawUrls(drive, rawUrls, spinner);
}

// --- SCRIPT EXECUTION ---
// Calls the main function and catches any unhandled top-level errors.
// This is the entry point of the script.
main().catch((error) => {
  // This is a final safety net for errors not caught within main().
  // Ora spinner might not be active or correctly finalized here, so direct console logging is best.
  console.error('Unhandled error at top level:', error, error.stack);
  process.exit(1); // Exit with an error code.
});
