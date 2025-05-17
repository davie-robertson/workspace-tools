
import 'dotenv/config';
import ora from 'ora'; // Added for progress indication
import { GoogleAuth } from 'google-auth-library';
import { google } from 'googleapis';


// --- CLI PARAMS ---
// Usage: node index.js --users user1@domain.com,user2@domain.com --types doc,sheet,slide
function parseArgs() {
  const args = process.argv.slice(2);
  const result = {};
  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--users' && args[i + 1]) {
      result.users = args[i + 1];
      i++;
    } else if (args[i] === '--types' && args[i + 1]) {
      result.types = args[i + 1];
      i++;
    }
  }
  return result;
}

const argv = parseArgs();
const filterUsers = argv.users ? argv.users.split(',').map(u => u.trim().toLowerCase()) : null;
const filterTypes = argv.types ? argv.types.split(',').map(t => t.trim().toLowerCase()) : null;

const ADMIN_USER = process.env.ADMIN_USER;
const OUTPUT_SHEET_ID = process.env.OUTPUT_SHEET_ID;

if (!ADMIN_USER || !OUTPUT_SHEET_ID) {
    console.error('Missing required environment variables: ADMIN_USER, OUTPUT_SHEET_ID');
    process.exit(1);
}

if (!process.env.GOOGLE_APPLICATION_CREDENTIALS) {
    console.error('Missing GOOGLE_APPLICATION_CREDENTIALS environment variable. This should be the path to your service account JSON key file.');
    process.exit(1);
}

const SCOPES = [
  'https://www.googleapis.com/auth/admin.directory.user.readonly',
  'https://www.googleapis.com/auth/drive.readonly',
  'https://www.googleapis.com/auth/documents.readonly',
  'https://www.googleapis.com/auth/presentations.readonly',
  'https://www.googleapis.com/auth/spreadsheets',
];

// --- API RETRY HELPER ---
async function callWithRetry(apiCallFunction, spinner, maxRetries = 5, initialDelay = 1000) {
    let retries = 0;
    // Text active when this specific operation (the apiCallFunction) was intended to start.
    // This text comes from the main loop's progress updates.
    const intendedOperationText = spinner ? spinner.text : null;

    while (true) {
        try {
            // Ensure the spinner text reflects the current operation being attempted (or re-attempted)
            // and that the spinner is active.
            if (spinner && intendedOperationText) {
                spinner.text = intendedOperationText;
                if (!spinner.isSpinning) { // Check if the spinner is actually spinning
                    spinner.start();       // If not, start it.
                }
            }
            return await apiCallFunction();
        } catch (error) {
            const isQuotaError = (error.code === 403 || error.code === 429 || error.code === '429') &&
                                 error.message &&
                                 error.message.toLowerCase().includes('quota');
            const isRateLimitError = error.message && error.message.toLowerCase().includes('rate limit exceeded');
            const isServiceUnavailable = error.code === 500 || error.code === 503 || error.code === '500' || error.code === '503';

            if ((isQuotaError || isRateLimitError || isServiceUnavailable) && retries < maxRetries) {
                retries++;
                const delay = initialDelay * Math.pow(2, retries - 1) + Math.random() * 1000;
                if (spinner) {
                    // spinner.warn() will change the icon and text, and keep spinning.
                    spinner.warn(`API call for '${intendedOperationText || 'current operation'}' failed (attempt ${retries}/${maxRetries}): ${error.message}. Retrying in ${Math.round(delay / 1000)}s...`);
                } else {
                    console.warn(`API call for '${intendedOperationText || 'current operation'}' failed (attempt ${retries}/${maxRetries}): ${error.message}. Retrying in ${Math.round(delay / 1000)}s...`);
                }
                await new Promise(resolve => setTimeout(resolve, delay));
                // On the next iteration, spinner.text will be restored to intendedOperationText and spinner started if needed.
            } else {
                // If throwing, the main catch block in main() will call spinner.fail().
                // No need to restore spinner text here as it's about to fail.
                throw error;
            }
        }
    }
}


// --- AUTH ---
async function getAuthenticatedClient() {
    try {
        const auth = new GoogleAuth({
            scopes: SCOPES,
            clientOptions: {
                subject: ADMIN_USER,
            }
        });
        const client = await auth.getClient();
        return client;
    } catch (error) {
        console.error('Error creating authenticated client:', error.message);
        if (error.response && error.response.data) {
            console.error('Error details:', error.response.data);
        }
        if (error.stack) {
            console.error('Stack trace:', error.stack);
        }
        throw new Error(`Failed to authenticate: ${error.message}`);
    }
}

// --- MAIN LOGIC ---
async function main() {
  const mainSpinner = ora('Initializing...').start();
  try {
    mainSpinner.text = 'Authenticating...';
    const auth = await getAuthenticatedClient(); // Spinner not typically needed here as it's usually fast
    const admin = google.admin({ version: 'directory_v1', auth });
    const drive = google.drive({ version: 'v3', auth });
    const docs = google.docs({ version: 'v1', auth });
    const sheets = google.sheets({ version: 'v4', auth });
    const slides = google.slides({ version: 'v1', auth });

    if (!OUTPUT_SHEET_ID) {
        mainSpinner.fail('OUTPUT_SHEET_ID must be set in your .env file');
        throw new Error('OUTPUT_SHEET_ID must be set in your .env file');
    }

    mainSpinner.text = 'Fetching users...';

    let users = await getAllUsers(admin, mainSpinner);
    if (filterUsers) {
      users = users.filter(u => filterUsers.includes(u.primaryEmail.toLowerCase()));
      mainSpinner.info(`Filtered users: ${users.map(u => u.primaryEmail).join(', ')}`);
    } else {
      mainSpinner.info(`Found ${users.length} users.`);
    }

    mainSpinner.text = 'Preparing output sheet...';
    await clearAndSetHeaders(sheets, OUTPUT_SHEET_ID, mainSpinner);
    const rows = [];
    // --- Stats for summary tab ---
    const userStats = {}; // { [userEmail]: { doc: 0, sheet: 0, slide: 0, docWithLinks: 0, sheetWithLinks: 0, slideWithLinks: 0 } }
    const totalStats = { doc: 0, sheet: 0, slide: 0, docWithLinks: 0, sheetWithLinks: 0, slideWithLinks: 0 };


    for (const [idx, user] of users.entries()) {
        mainSpinner.text = `Processing user ${idx + 1}/${users.length}: ${user.primaryEmail} - Fetching files...`;
        let files = await listUserFiles(drive, user.primaryEmail, mainSpinner);
        mainSpinner.info(`User ${idx + 1}/${users.length} (${user.primaryEmail}): Found ${files.length} files. Starting analysis...`);

        // Initialize stats for this user
        userStats[user.primaryEmail] = {
            doc: 0, sheet: 0, slide: 0,
            docWithLinks: 0, sheetWithLinks: 0, slideWithLinks: 0
        };

        // Filter files by type if requested
        if (filterTypes) {
            files = files.filter(f => {
                const t = getFileType(f.mimeType).toLowerCase();
                return (
                    (filterTypes.includes('doc') && t === 'google doc') ||
                    (filterTypes.includes('sheet') && t === 'google sheet') ||
                    (filterTypes.includes('slide') && t === 'google slide')
                );
            });
        }

        for (const [fileIdx, file] of files.entries()) {
            mainSpinner.text = `User ${idx + 1}/${users.length} (${user.primaryEmail}) - File ${fileIdx + 1}/${files.length}: ${file.name}`;
            let links = [];
            let fileType = getFileType(file.mimeType);
            try {
                switch (file.mimeType) {
                    case 'application/vnd.google-apps.document':
                        links = await findLinksInDoc(docs, drive, file.id, mainSpinner);
                        userStats[user.primaryEmail].doc++;
                        totalStats.doc++;
                        if (links.length > 0) {
                            userStats[user.primaryEmail].docWithLinks++;
                            totalStats.docWithLinks++;
                        }
                        break;
                    case 'application/vnd.google-apps.spreadsheet':
                        links = await findLinksInSheet(sheets, drive, file.id, mainSpinner);
                        userStats[user.primaryEmail].sheet++;
                        totalStats.sheet++;
                        if (links.length > 0) {
                            userStats[user.primaryEmail].sheetWithLinks++;
                            totalStats.sheetWithLinks++;
                        }
                        break;
                    case 'application/vnd.google-apps.presentation':
                        links = await findLinksInSlide(slides, drive, file.id, mainSpinner);
                        userStats[user.primaryEmail].slide++;
                        totalStats.slide++;
                        if (links.length > 0) {
                            userStats[user.primaryEmail].slideWithLinks++;
                            totalStats.slideWithLinks++;
                        }
                        break;
                    default:
                        // Do nothing for other mime types
                        break;
                }
            } catch (e) {
                mainSpinner.warn(`Error reading file ${file.name} (${file.id}): ${e.message}`);
                links = [`Error reading file: ${e.message}`];
            }
            rows.push([
                user.primaryEmail,
                file.name,
                file.id,
                fileType,
                file.webViewLink,
                links.join(', ')
            ]);
        }

        if (rows.length >= 100) {
            mainSpinner.text = `Writing batch of ${rows.length} rows to Google Sheet...`;
            await appendRows(sheets, OUTPUT_SHEET_ID, rows, mainSpinner);
            rows.length = 0;
        }
    }

    if (rows.length > 0) {
        mainSpinner.text = `Writing final batch of ${rows.length} rows to Google Sheet...`;
        await appendRows(sheets, OUTPUT_SHEET_ID, rows, mainSpinner);
    }

    // Write summary tab
    mainSpinner.text = 'Writing summary tab...';
    await writeSummaryTab(sheets, OUTPUT_SHEET_ID, userStats, totalStats, mainSpinner);
    mainSpinner.succeed('Audit complete! Results written to Google Sheet.');
// --- SUMMARY TAB WRITER ---
async function writeSummaryTab(sheets, spreadsheetId, userStats, totalStats, spinner) {
    const summarySheetName = 'Summary';
    // Clear the summary sheet (or create if not exists)
    spinner.text = `Clearing summary sheet: ${summarySheetName}`;
    try {
        await callWithRetry(() => sheets.spreadsheets.values.clear({
            spreadsheetId,
            range: `${summarySheetName}`,
        }), spinner);
    } catch (e) {
        // If the sheet doesn't exist, create it
        if (e.errors && e.errors[0] && e.errors[0].reason === 'badRequest') {
            spinner.text = `Creating summary sheet: ${summarySheetName}`;
            await callWithRetry(() => sheets.spreadsheets.batchUpdate({
                spreadsheetId,
                requestBody: {
                    requests: [{
                        addSheet: {
                            properties: { title: summarySheetName }
                        }
                    }]
                }
            }), spinner);
        } else {
            spinner.warn(`Could not clear summary sheet: ${e.message}`);
        }
    }

    // Prepare summary data
    const header = [
        'User Email',
        'Google Docs', 'Docs w/ Links',
        'Google Sheets', 'Sheets w/ Links',
        'Google Slides', 'Slides w/ Links',
    ];
    const userRows = Object.entries(userStats).map(([email, stats]) => [
        email,
        stats.doc, stats.docWithLinks,
        stats.sheet, stats.sheetWithLinks,
        stats.slide, stats.slideWithLinks
    ]);
    const totalRow = [
        'TOTAL',
        totalStats.doc, totalStats.docWithLinks,
        totalStats.sheet, totalStats.sheetWithLinks,
        totalStats.slide, totalStats.slideWithLinks
    ];
    const allRows = [header, ...userRows, totalRow];

    // Write summary data
    spinner.text = `Writing summary data to ${summarySheetName}`;
    await callWithRetry(() => sheets.spreadsheets.values.update({
        spreadsheetId,
        range: `${summarySheetName}!A1`,
        valueInputOption: 'RAW',
        requestBody: { values: allRows },
    }), spinner);
}
  } catch (error) {
    mainSpinner.fail(`Audit failed: ${error.message}`);
    console.error('Detailed error:', error); // Log the full error object
    throw error; // Re-throw to be caught by main().catch()
  }
}

// --- SHEET HELPERS ---
async function clearAndSetHeaders(sheets, spreadsheetId, spinner) {
  spinner.text = `Clearing sheet: ${spreadsheetId}`;
  await callWithRetry(() => sheets.spreadsheets.values.clear({
    spreadsheetId,
    range: 'Sheet1', // Assuming the main sheet is named Sheet1
  }), spinner);
  spinner.text = `Setting headers for sheet: ${spreadsheetId}`;
  await callWithRetry(() => sheets.spreadsheets.values.update({
    spreadsheetId,
    range: 'Sheet1!A1',
    valueInputOption: 'RAW',
    requestBody: {
      values: [[
        'Owner Email', 'File Title', 'File ID', 'File Type', 'File URL', 'Linked Files/URLs'
      ]],
    },
  }), spinner);
}

async function appendRows(sheets, spreadsheetId, rows, spinner) {
  if (rows.length === 0) return;
  spinner.text = `Appending ${rows.length} rows to sheet: ${spreadsheetId}`;
  await callWithRetry(() => sheets.spreadsheets.values.append({
    spreadsheetId,
    range: 'Sheet1',
    valueInputOption: 'RAW',
    insertDataOption: 'INSERT_ROWS',
    requestBody: {
      values: rows,
    },
  }), spinner);
}

// --- HELPERS ---
async function getAllUsers(admin, spinner) {
  let users = [];
  let pageToken = undefined;
  let pageCount = 0;
  do {
    pageCount++;
    spinner.text = `Fetching users (page ${pageCount})...`;
    const res = await callWithRetry(() => admin.users.list({
      customer: 'my_customer',
      maxResults: 500, // Max allowed
      pageToken,
      orderBy: 'email',
      query: 'isSuspended=false', 
    }), spinner);
    if (res.data.users && res.data.users.length) {
      users = users.concat(res.data.users.filter(u => !u.suspended && !u.archived));
    }
    pageToken = res.data.nextPageToken;
  } while (pageToken);
  return users;
}

async function listUserFiles(drive, userEmail, spinner) {
  let files = [];
  let pageToken = undefined;
  let pageCount = 0;
  const mimeTypes = [
    'application/vnd.google-apps.document',
    'application/vnd.google-apps.spreadsheet',
    'application/vnd.google-apps.presentation',
  ];
  const q = `'${userEmail}' in owners and trashed = false and (${mimeTypes.map(m => `mimeType = '${m}'`).join(' or ')})`;
  do {
    pageCount++;
    // Spinner update can be too noisy here if many users have few files.
    // spinner.text = `Fetching files for ${userEmail} (page ${pageCount})...`; // Still potentially noisy
    const res = await callWithRetry(() => drive.files.list({
      q,
      fields: 'nextPageToken, files(id, name, mimeType, webViewLink)',
      pageSize: 1000, // Max allowed
      pageToken,
      supportsAllDrives: true,
      includeItemsFromAllDrives: true,
      corpora: 'user',
    }), spinner);
    if (res.data.files && res.data.files.length) {
      files = files.concat(res.data.files);
    }
    pageToken = res.data.nextPageToken;
  } while (pageToken);
  return files;
}

function getFileType(mimeType) {
  if (mimeType === 'application/vnd.google-apps.document') return 'Google Doc';
  if (mimeType === 'application/vnd.google-apps.spreadsheet') return 'Google Sheet';
  if (mimeType === 'application/vnd.google-apps.presentation') return 'Google Slide';
  return mimeType;
}

// --- NEW HELPER TO EXTRACT FILE ID FROM URL ---
function getDriveFileIdFromUrl(url) {
    if (typeof url !== 'string') return null;
    const patterns = [
        // Google Docs, Sheets, Slides, Forms, Drawings (generic file endpoint)
        /https?:\/\/docs\\.google\\.com\/(?:document|spreadsheets|presentation|forms|drawings|file)\/d\/([a-zA-Z0-9\\-_]+)/i,
        // Google Drive file view or open link
        /https?:\/\/drive\\.google\\.com\/(?:file\/d\/|open\\?id=)([a-zA-Z0-9\\-_]+)/i,
        // Drive folders (less common for direct linking in docs, but possible)
        // /https?:\/\/drive\\.google\\.com\/drive\/(?:folders|shared-drives)\/([a-zA-Z0-9\\-_]+)/i
    ];
    for (const regex of patterns) {
        const match = url.match(regex);
        if (match && match[1]) {
            return match[1];
        }
    }
    return null;
}

// --- NEW HELPER TO RESOLVE FILE METADATA ---
async function resolveFileMetadata(drive, fileId, spinner, originalUrl) {
    // The spinner.text is expected to be set by the caller (e.g., findLinksInDoc)
    // to something like "Processing File X - Resolving link ID YYY"
    // callWithRetry will use this current spinner.text as its intendedOperationText.
    try {
        const file = await callWithRetry(() => drive.files.get({
            fileId: fileId,
            fields: 'name, mimeType, webViewLink',
            supportsAllDrives: true, // Important for files in Shared Drives
        }), spinner);

        return {
            name: file.data.name || 'Unknown Name',
            type: getFileType(file.data.mimeType),
            url: file.data.webViewLink || originalUrl // Prefer official webViewLink
        };
    } catch (error) {
        // callWithRetry would have handled retries and spinner.warn for retryable errors.
        // This catch is for final, non-retryable errors from drive.files.get (e.g., 404 Not Found, 403 Permission Denied).
        // The spinner text is still the one set by the caller.
        // We can add a more specific warning here if needed, but callWithRetry might have already done so.
        if (error.code === 404) {
            spinner.warn(`Could not resolve link: File ID ${fileId} not found (for ${originalUrl}).`);
        } else if (error.code === 403) {
            spinner.warn(`Could not resolve link: Permission denied for file ID ${fileId} (for ${originalUrl}).`);
        } else if (!spinner.text.includes('failed')) { // Avoid double warning if callWithRetry already warned
            spinner.warn(`Failed to resolve metadata for file ID ${fileId} (link: ${originalUrl}): ${error.message}`);
        }
        return null; // Indicate failure to resolve
    }
}


async function findLinksInDoc(docs, drive, docId, spinner) {
  // spinner.text is already "User X/Y - File A/B: docName"
  const baseFileProcessingText = spinner.text; // Save base text for restoring
  const res = await callWithRetry(() => docs.documents.get({
    documentId: docId,
    fields: 'body(content(paragraph(elements(textRun(content,textStyle(link(url)))))))',
  }), spinner);

  let rawUrls = [];
  if (res.data.body && res.data.body.content) {
    for (const el of res.data.body.content) {
      if (el.paragraph && el.paragraph.elements) {
        for (const elem of el.paragraph.elements) {
          if (elem.textRun && elem.textRun.textStyle && elem.textRun.textStyle.link && elem.textRun.textStyle.link.url) {
            rawUrls.push(elem.textRun.textStyle.link.url);
          }
          if (elem.textRun && elem.textRun.content) {
             rawUrls.push(...extractDriveLinks(elem.textRun.content));
          }
        }
      }
    }
  }

  const uniqueRawUrls = [...new Set(rawUrls)];
  const resolvedLinkInfo = [];

  if (uniqueRawUrls.length > 0) {
    spinner.text = `${baseFileProcessingText} - Found ${uniqueRawUrls.length} potential links, resolving...`;
  }

  for (const url of uniqueRawUrls) {
      const fileId = getDriveFileIdFromUrl(url);
      if (fileId) {
          // Only process Google Docs/Sheets/Slides links (not generic websites)
          const resolvingText = `${baseFileProcessingText} - Resolving link to ID ${fileId}`;
          spinner.text = resolvingText;
          const metadata = await resolveFileMetadata(drive, fileId, spinner, url);
          if (metadata && (metadata.type === 'Google Doc' || metadata.type === 'Google Sheet' || metadata.type === 'Google Slide')) {
              resolvedLinkInfo.push(`${url} (Name: ${metadata.name}, Type: ${metadata.type})`);
          }
          // If not a Google Doc/Sheet/Slide, skip adding
      }
      // If not a Drive file, skip (do not add plain URLs)
  }
  spinner.text = baseFileProcessingText; // Restore spinner to "Processing file X"
  return resolvedLinkInfo;
}

async function findLinksInSheet(sheets, drive, sheetId, spinner) {
    const baseFileProcessingText = spinner.text;
    try {
        spinner.text = `${baseFileProcessingText} - Fetching sheet structure...`;
        const res = await callWithRetry(() => sheets.spreadsheets.get({
            spreadsheetId: sheetId,
            fields: 'sheets(properties(title,sheetType,gridProperties))',
        }), spinner);
        
        let rawUrls = [];
        if (!res.data.sheets) {
            spinner.text = baseFileProcessingText;
            return [];
        }

        for (const sheet of res.data.sheets) {
            if (sheet.properties && sheet.properties.sheetType && sheet.properties.sheetType !== 'GRID') {
                spinner.info(`Skipping non-grid sheet '${sheet.properties.title}' (type: ${sheet.properties.sheetType}) in spreadsheet ${sheetId}.`);
                continue;
            }
            if (!sheet.properties || !sheet.properties.title) {
                spinner.info(`Skipping sheet without properties or title in spreadsheet ${sheetId}.`);
                continue;
            }

            try {
                spinner.text = `${baseFileProcessingText} - Reading sheet: '${sheet.properties.title}'...`;
                const rangeData = await callWithRetry(() => sheets.spreadsheets.values.get({
                    spreadsheetId: sheetId,
                    range: `'${sheet.properties.title}'`, 
                }), spinner);

                if (rangeData.data.values) {
                    for (const row of rangeData.data.values) {
                        for (const cell of row) {
                            if (typeof cell === 'string') {
                                rawUrls.push(...extractDriveLinks(cell));
                            }
                        }
                    }
                }
            } catch (e) {
                spinner.warn(`Error reading values from sheet '${sheet.properties.title}' in ${sheetId}: ${e.message}. Skipping this sheet.`);
            }
        }
        
        const uniqueRawUrls = [...new Set(rawUrls)];
        const resolvedLinkInfo = [];

        if (uniqueRawUrls.length > 0) {
            spinner.text = `${baseFileProcessingText} - Found ${uniqueRawUrls.length} potential links, resolving...`;
        }

        for (const url of uniqueRawUrls) {
            const fileId = getDriveFileIdFromUrl(url);
            if (fileId) {
                spinner.text = `${baseFileProcessingText} - Resolving link to ID ${fileId}`;
                const metadata = await resolveFileMetadata(drive, fileId, spinner, url);
                if (metadata && (metadata.type === 'Google Doc' || metadata.type === 'Google Sheet' || metadata.type === 'Google Slide')) {
                    resolvedLinkInfo.push(`${url} (Name: ${metadata.name}, Type: ${metadata.type})`);
                }
                // If not a Google Doc/Sheet/Slide, skip adding
            }
            // If not a Drive file, skip (do not add plain URLs)
        }
        spinner.text = baseFileProcessingText;
        return resolvedLinkInfo;

    } catch (error) {
        spinner.warn(`Failed to get details for spreadsheet ${sheetId}: ${error.message}`);
        spinner.text = baseFileProcessingText; // Ensure restoration on error
        throw error;
    }
}

async function findLinksInSlide(slides, drive, slideId, spinner) {
  const baseFileProcessingText = spinner.text;
  spinner.text = `${baseFileProcessingText} - Fetching presentation structure...`;
  const res = await callWithRetry(() => slides.presentations.get({
    presentationId: slideId,
    fields: 'slides(pageElements(shape(text(textElements(textRun(content,style(link(url))))))))',
  }), spinner);
  
  let rawUrls = [];
  if (res.data.slides) {
    for (const slide of res.data.slides) {
      if (slide.pageElements) {
        for (const element of slide.pageElements) {
          if (element.shape && element.shape.text && element.shape.text.textElements) {
            for (const te of element.shape.text.textElements) {
              if (te.textRun && te.textRun.style && te.textRun.style.link && te.textRun.style.link.url) {
                rawUrls.push(te.textRun.style.link.url);
              }
              if (te.textRun && te.textRun.content) {
                rawUrls.push(...extractDriveLinks(te.textRun.content));
              }
            }
          }
        }
      }
    }
  }

  const uniqueRawUrls = [...new Set(rawUrls)];
  const resolvedLinkInfo = [];
  
  if (uniqueRawUrls.length > 0) {
    spinner.text = `${baseFileProcessingText} - Found ${uniqueRawUrls.length} potential links, resolving...`;
  }

  for (const url of uniqueRawUrls) {
      const fileId = getDriveFileIdFromUrl(url);
      if (fileId) {
          spinner.text = `${baseFileProcessingText} - Resolving link to ID ${fileId}`;
          const metadata = await resolveFileMetadata(drive, fileId, spinner, url);
          if (metadata && (metadata.type === 'Google Doc' || metadata.type === 'Google Sheet' || metadata.type === 'Google Slide')) {
              resolvedLinkInfo.push(`${url} (Name: ${metadata.name}, Type: ${metadata.type})`);
          }
          // If not a Google Doc/Sheet/Slide, skip adding
      }
      // If not a Drive file, skip (do not add plain URLs)
  }
  spinner.text = baseFileProcessingText;
  return resolvedLinkInfo;
}

// getTextFromGoogleDoc is no longer directly used for link extraction, 
// but can be kept if other text processing is needed.
// function getTextFromGoogleDoc(body) { ... }

function extractDriveLinks(text) {
    if (typeof text !== 'string' || !text) return [];
    // Regex to find Google Drive, Docs, Sheets, Slides, Forms URLs
    const patterns = [
        /https?:\/\/docs\.google\.com\/(?:document|spreadsheets|presentation|forms|file)\/d\/([a-zA-Z0-9\-_]+)(?:\/[^#?\s]*)?/gi,
        /https?:\/\/drive\.google\.com\/(?:file\/d\/|open\?id=)([a-zA-Z0-9\-_]+)/gi,
        /https?:\/\/drive\.google\.com\/drive\/(?:folders|shared-drives)\/([a-zA-Z0-9\-_]+)/gi
    ];
    let foundLinks = [];
    for (const regex of patterns) {
        let match;
        while ((match = regex.exec(text)) !== null) {
            foundLinks.push(match[0]); // Push the full matched URL
        }
    }
    return foundLinks.length > 0 ? [...new Set(foundLinks)] : []; // Return unique links
}

main().catch(error => {
  // The main function's try/catch should handle spinner failure.
  // This is a final catch for any unhandled promise rejections.
  // console.error("Unhandled error during script execution:", error); // Already logged in main's catch
  process.exit(1);
});
