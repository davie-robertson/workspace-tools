
/**
 * Extracts URLs from HYPERLINK formulas in a string.
 * 
 * @param {string} formula - The string containing HYPERLINK formulas to process
 * @returns {string[]} An array of URLs extracted from the HYPERLINK formulas
 * 
 * @example
 * // Returns ["https://example.com"]
 * extractHyperlinkUrls('HYPERLINK("https://example.com", "Example Site")');
 * 
 * @example
 * // Returns ["https://example1.com", "https://example2.com"]
 * extractHyperlinkUrls('HYPERLINK("https://example1.com") HYPERLINK("https://example2.com")');
 */
export function extractHyperlinkUrls(formula) {
  const urls = [];
  const regex = /HYPERLINK\s*\(\s*(?:"([^"]+)"|'([^']+)')/gi;
  let match;
  while ((match = regex.exec(formula)) !== null) {
    urls.push(match[1] || match[2]);
  }
  return urls;
}
/**
 * Extracts image URLs from a formula string that contains IMAGE functions.
 * 
 * This function searches for patterns like IMAGE("url") or IMAGE('url') in the 
 * formula string and extracts the URL from within the quotes.
 *
 * @param {string} formula - The formula string to extract image URLs from
 * @returns {string[]} An array of extracted image URLs
 * 
 * @example
 * // Returns ["https://example.com/image.png"]
 * extractImageUrls('IMAGE("https://example.com/image.png")')
 */
export function extractImageUrls(formula) {
  const urls = [];
  const regex = /IMAGE\s*\(\s*(?:"([^"]+)"|'([^']+)')/gi;
  let match;
  while ((match = regex.exec(formula)) !== null) {
    urls.push(match[1] || match[2]);
  }
  return urls;
}
/**
 * Extracts Google Drive, Google Docs, and other Google document links from text.
 * 
 * @param {string} text - The text to search for Google links.
 * @returns {string[]} An array of unique Google Drive links found in the text.
 * The function looks for various Google document formats including:
 * - Google Docs, Sheets, Slides, Forms, Files, and Drawings
 * - Direct Google Drive file links
 * - Google Drive folder links and shared drives
 * - Other Google domain links that might contain documents
 * 
 * @example
 * const text = "Check out this document: https://docs.google.com/document/d/1a2b3c4d5e6f7g8h9i0j1k2l3m4n5o6p7q8r9s0t1u2v/edit";
 * const links = extractDriveLinks(text);
 * // returns ["https://docs.google.com/document/d/1a2b3c4d5e6f7g8h9i0j1k2l3m4n5o6p7q8r9s0t1u2v/edit"]
 */
export function extractDriveLinks(text) {
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
      if (getDriveFileIdFromUrl(potentialLink) ||
        potentialLink.includes('docs.google.com/') ||
        potentialLink.includes('drive.google.com/')) {
        foundLinks.add(potentialLink);
      }
    }
  }
  return Array.from(foundLinks);
}

/**
 * Extracts function names from a formula string.
 *
 * @param {string} formula - The formula string to extract function names from.
 * @returns {Array<string>} An array of uppercase function names found in the formula.
 *                         Returns an empty array if the input is not a string.
 * @example
 * // Returns ['SUM', 'MAX']
 * extractFunctionNamesFromFormula('=SUM(A1:A5) + MAX(B1:B5)');
 */
export function extractFunctionNamesFromFormula(formula) {
  if (typeof formula !== 'string') return [];
  const functionRegex = /\b([A-Z0-9_.]+)\s*\(/gi;
  const foundFunctions = new Set();
  let match;
  while ((match = functionRegex.exec(formula)) !== null) {
    foundFunctions.add(match[1].toUpperCase());
  }
  return Array.from(foundFunctions);
}

/**
 * Extracts Google Spreadsheet IDs from IMPORTRANGE formulas in a string.
 * 
 * @param {string} formula - The formula string to extract IDs from
 * @returns {string[]} An array of Google Spreadsheet URLs constructed from the extracted IDs
 * 
 * This function parses IMPORTRANGE functions in a formula and extracts the spreadsheet 
 * identifiers (either direct IDs or URLs containing IDs). It returns an array of 
 * fully formed Google Spreadsheet URLs.
 * 
 * @example
 * // Returns ["https://docs.google.com/spreadsheets/d/abc123xyz"]
 * extractImportrangeIds('=IMPORTRANGE("abc123xyz", "Sheet1!A1:B10")')
 */
export function extractImportrangeIds(formula) {
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

/**
 * Extracts a Google Drive file ID from various types of Google Drive URLs.
 * 
 * @param {string} url - The Google Drive URL to extract the file ID from.
 * @returns {string|null} The file ID if found, otherwise null.
 * 
 * @example
 * // Returns "1aBcDeFgHiJkLmNoPqRsTuVwX"
 * getDriveFileIdFromUrl("https://docs.google.com/document/d/1aBcDeFgHiJkLmNoPqRsTuVwX");
 * 
 * @example
 * // Returns "1aBcDeFgHiJkLmNoPqRsTuVwX"
 * getDriveFileIdFromUrl("https://drive.google.com/file/d/1aBcDeFgHiJkLmNoPqRsTuVwX");
 * 
 * @example
 * // Returns null
 * getDriveFileIdFromUrl(null);
 */
export function getDriveFileIdFromUrl(url) {
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

