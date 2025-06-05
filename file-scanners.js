/**
 * File Scanners Module
 * Contains functions for scanning Google Docs, Sheets, and Slides for links and compatibility issues
 */

import { google } from 'googleapis';
import {
  callWithRetry,
  getAuthenticatedClientForUser,
  processRawUrls,
} from './API-Calls.js';
import {
  extractDriveLinks,
  extractFunctionNamesFromFormula,
  extractImportrangeIds,
  extractHyperlinkUrls,
  extractImageUrls,
} from './extract-helpers.js';

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

// --- DOCS ---
/**
 * Extracts links from a Google Document
 *
 * @async
 * @function findLinksInDoc
 * @param {string} docId - The ID of the Google Document to extract links from
 * @param {string} userEmail - The email of the user to impersonate for API access
 * @returns {Promise<Array>} A processed array of URLs found in the document
 * @description
 * This function extracts links from various elements in a Google Document:
 * - Text with hyperlinks
 * - URLs mentioned in text content
 * - Links in embedded object descriptions
 * - Image content URLs and source URLs
 * - Links to Google Sheets from embedded charts
 *
 * It creates authenticated clients for the specified user and uses the Google Docs API
 * to retrieve document content with specific fields, then parses the content to extract
 * all URLs, which are finally processed by the processRawUrls function.
 */
export async function findLinksInDoc(docId, userEmail) {
  // Create authenticated clients for the specific user
  const userAuthClient = await getAuthenticatedClientForUser(userEmail);
  const docs = google.docs({ version: 'v1', auth: userAuthClient });
  const drive = google.drive({ version: 'v3', auth: userAuthClient });
  
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
          if (elem.inlineObjectElement?.inlineObjectId) {
            const objId = elem.inlineObjectElement.inlineObjectId;
            const obj = res.data.inlineObjects?.[objId];
            if (obj?.inlineObjectProperties?.embeddedObject) {
              const embeddedObj = obj.inlineObjectProperties.embeddedObject;
              if (embeddedObj.description) {
                rawUrls.push(...extractDriveLinks(embeddedObj.description));
              }
              if (embeddedObj.imageProperties?.contentUri) {
                rawUrls.push(embeddedObj.imageProperties.contentUri);
              }
              if (embeddedObj.imageProperties?.sourceUri) {
                rawUrls.push(embeddedObj.imageProperties.sourceUri);
              }
              if (embeddedObj.linkedContentReference?.sheetsChartReference?.spreadsheetId) {
                const sheetId = embeddedObj.linkedContentReference.sheetsChartReference.spreadsheetId;
                rawUrls.push(`https://docs.google.com/spreadsheets/d/${sheetId}/`);
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
/**
 * Extracts links and incompatible formula functions from a Google Spreadsheet
 *
 * This function scans through all cells, charts, conditional formats and data validations
 * in a Google Spreadsheet to find links to other resources (documents, spreadsheets, etc.)
 * and identifies Google Workspace specific formula functions that may be incompatible with
 * other spreadsheet applications.
 *
 * @async
 * @param {string} sheetId - The ID of the Google Spreadsheet to analyze
 * @param {string} userEmail - The email of the user to impersonate for API access
 *
 * @returns {Promise<object>} An object containing:
 *   - links {Array} - Processed links found in the spreadsheet
 *   - incompatibleFunctions {Array<string>} - Google Workspace specific formula functions used in the spreadsheet
 *
 * @throws Will throw an error if the API calls fail beyond retry attempts
 */
export async function findLinksInSheet(sheetId, userEmail) {
  // Create authenticated clients for the specific user
  const userAuthClient = await getAuthenticatedClientForUser(userEmail);
  const sheets = google.sheets({ version: 'v4', auth: userAuthClient });
  const drive = google.drive({ version: 'v3', auth: userAuthClient });
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
                  if (cell.hyperlink) rawUrls.push(cell.hyperlink);
                  if (cell.textFormatRuns) {
                    for (const run of cell.textFormatRuns) {
                      if (run.format?.link?.uri) {
                        rawUrls.push(run.format.link.uri);
                      }
                    }
                  }
                  if (cell.userEnteredValue?.formulaValue) {
                    const formula = cell.userEnteredValue.formulaValue;
                    rawUrls.push(...extractDriveLinks(formula));
                    const functions = extractFunctionNamesFromFormula(formula);
                    functions.forEach((fn) => allFormulaFunctions.add(fn));
                  }
                  if (cell.effectiveValue?.formulaValue) {
                    const formula = cell.effectiveValue.formulaValue;
                    rawUrls.push(...extractDriveLinks(formula));
                    const functions = extractFunctionNamesFromFormula(formula);
                    functions.forEach((fn) => allFormulaFunctions.add(fn));
                  }
                  if (cell.formattedValue) {
                    rawUrls.push(...extractDriveLinks(cell.formattedValue));
                  }
                  if (cell.dataValidation?.condition?.values) {
                    for (const value of cell.dataValidation.condition.values) {
                      if (value.userEnteredValue) {
                        const formula = value.userEnteredValue;
                        rawUrls.push(...extractDriveLinks(formula));
                        const functions = extractFunctionNamesFromFormula(formula);
                        functions.forEach((fn) => allFormulaFunctions.add(fn));
                      }
                    }
                  }
                }
              }
            }
          }
        }
      }
      sheet.conditionalFormats?.forEach((cf) =>
        cf.booleanRule?.condition?.values?.forEach((v) => {
          if (v.userEnteredValue) {
            const formula = v.userEnteredValue;
            rawUrls.push(...extractDriveLinks(formula));
            const functions = extractFunctionNamesFromFormula(formula);
            functions.forEach((fn) => allFormulaFunctions.add(fn));
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
/**
 * Extracts all links from a Google Slides presentation.
 *
 * This function searches through a presentation to find URLs in:
 * - Text links
 * - Raw text content that contains links
 * - Image content and source URLs
 * - Image hyperlinks
 * - Video URLs and Drive video links
 * - Google Sheets chart references
 * - Both main slide content and speaker notes
 *
 * @async
 * @param {string} slideId - The ID of the Google Slides presentation
 * @param {string} userEmail - The email of the user to impersonate for API access
 * @returns {Promise<Array>} A processed array of links found in the presentation
 * @throws {Error} If the API call fails after retries
 */
export async function findLinksInSlide(slideId, userEmail) {
  // Create authenticated clients for the specific user
  const userAuthClient = await getAuthenticatedClientForUser(userEmail);
  const slides = google.slides({ version: 'v1', auth: userAuthClient });
  const drive = google.drive({ version: 'v3', auth: userAuthClient });
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

// --- FILE SHARING ANALYSIS ---
/**
 * Analyzes file sharing permissions for migration planning
 * @param {Object} file - Google Drive file object
 * @param {Object} drive - Google Drive API client
 * @returns {Object} Sharing analysis data
 */
export async function analyzeFileSharing(file, drive) {
  const sharing = {
    isPrivate: true,
    sharedWith: [],
    sharingType: 'private',
    externalShares: [],
    crossTenantShares: [],
    publicLinks: false,
    domainSharing: false,
    migrationRisk: 'low'
  };

  try {
    const permissionsResponse = await callWithRetry(async () => {
      return await drive.permissions.list({
        fileId: file.id,
        fields: 'permissions(id,type,role,emailAddress,domain,displayName,allowFileDiscovery)'
      });
    });

    const permissions = permissionsResponse.data.permissions || [];

    for (const permission of permissions) {
      if (permission.type === 'anyone') {
        sharing.publicLinks = true;
        sharing.sharingType = 'public';
        sharing.isPrivate = false;
      } else if (permission.type === 'domain') {
        sharing.domainSharing = true;
        sharing.sharingType = 'domain-wide';
        sharing.isPrivate = false;
      } else if (permission.emailAddress) {
        sharing.isPrivate = false;
        const shareInfo = {
          email: permission.emailAddress,
          role: permission.role,
          displayName: permission.displayName,
          domain: permission.emailAddress?.split('@')[1],
          type: permission.type
        };
        
        sharing.sharedWith.push(shareInfo);

        // Check for external/cross-tenant sharing
        const domain = permission.emailAddress.split('@')[1];
        const primaryDomain = process.env.PRIMARY_DOMAIN;
        
        if (domain && domain !== primaryDomain) {
          sharing.externalShares.push(shareInfo);
          sharing.crossTenantShares.push(permission.emailAddress);
        }
      }
    }

    // Assess migration risk based on sharing complexity
    sharing.migrationRisk = assessSharingMigrationRisk(sharing);

  } catch (error) {
    console.error(`Error analyzing sharing for ${file.id} (${file.name}):`, error.message);
    sharing.error = error.message;
  }

  return sharing;
}

/**
 * Analyzes file location and folder structure for migration planning
 * @param {Object} file - Google Drive file object
 * @param {Object} drive - Google Drive API client
 * @returns {Object} Location analysis data
 */
export async function analyzeFileLocation(file, drive) {
  const location = {
    type: 'unknown',
    ownerEmail: null,
    sharedDriveName: null,
    sharedDriveId: null,
    folderPath: [],
    isOrphan: false,
    isInRoot: false,
    migrationComplexity: 'low'
  };

  try {
    // Check if file is in a shared drive
    if (file.driveId) {
      try {
        const driveInfoResponse = await callWithRetry(async () => {
          return await drive.drives.get({
            driveId: file.driveId,
            fields: 'id,name'
          });
        });
        
        location.type = 'shared-drive';
        location.sharedDriveName = driveInfoResponse.data.name;
        location.sharedDriveId = file.driveId;
      } catch (error) {
        location.type = 'shared-drive-inaccessible';
        location.sharedDriveId = file.driveId;
      }
    } else {
      location.type = 'personal-drive';
      location.ownerEmail = file.owners?.[0]?.emailAddress;
    }

    // Get folder path
    if (file.parents && file.parents.length > 0) {
      location.folderPath = await buildFolderPath(file.parents[0], drive);
      location.isInRoot = location.folderPath.length === 0;
    } else {
      location.isOrphan = true;
    }

    // Assess migration complexity
    location.migrationComplexity = assessLocationMigrationComplexity(location);

  } catch (error) {
    console.error(`Error analyzing location for ${file.id} (${file.name}):`, error.message);
    location.error = error.message;
  }

  return location;
}

/**
 * Builds the full folder path for a file
 * @param {string} folderId - Starting folder ID
 * @param {Object} drive - Google Drive API client
 * @param {Array} path - Accumulated path (for recursion)
 * @returns {Array} Array of folder names representing the path
 */
async function buildFolderPath(folderId, drive, path = []) {
  try {
    const folderResponse = await callWithRetry(async () => {
      return await drive.files.get({
        fileId: folderId,
        fields: 'id,name,parents'
      });
    });
    
    const folder = folderResponse.data;
    
    // Don't include root folder in path
    if (folder.name && folder.name !== 'My Drive') {
      path.unshift(folder.name);
    }
    
    // Continue up the hierarchy if there are parents
    if (folder.parents && folder.parents.length > 0) {
      return await buildFolderPath(folder.parents[0], drive, path);
    }
    
    return path;
  } catch (error) {
    // If we can't access a parent folder, return what we have
    console.warn(`Could not access folder ${folderId}: ${error.message}`);
    return path;
  }
}

/**
 * Assesses migration risk based on sharing configuration
 * @param {Object} sharing - Sharing analysis data
 * @returns {string} Risk level (low, medium, high)
 */
function assessSharingMigrationRisk(sharing) {
  if (sharing.publicLinks) return 'high';
  if (sharing.externalShares.length > 5) return 'high';
  if (sharing.domainSharing) return 'medium';
  if (sharing.externalShares.length > 0) return 'medium';
  if (sharing.sharedWith.length > 10) return 'medium';
  return 'low';
}

/**
 * Assesses migration complexity based on file location
 * @param {Object} location - Location analysis data
 * @returns {string} Complexity level (low, medium, high)
 */
function assessLocationMigrationComplexity(location) {
  if (location.type === 'shared-drive') return 'high';
  if (location.folderPath.length > 5) return 'medium';
  if (location.isOrphan) return 'medium';
  return 'low';
}
