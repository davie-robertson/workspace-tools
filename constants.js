/**
 * Constants Module
 * Contains all constants used throughout the application
 */

// --- OAUTH SCOPES ---
// Define the OAuth scopes required by the script.
// SECURITY: These scopes define the permissions the script requests.
// Review them to ensure they are the minimum necessary for the script's functionality.
// - admin.directory.user.readonly: To list users in the domain.
// - drive.readonly: To read files and their metadata from Google Drive.
// - documents.readonly: To read content from Google Docs.
// - presentations.readonly: To read content from Google Slides.
// - spreadsheets: To read content from Google Sheets and write audit results (if OUTPUT_SHEET_ID is used).
export const SCOPES = [
  'https://www.googleapis.com/auth/admin.directory.user.readonly', // To list users
  'https://www.googleapis.com/auth/drive.readonly', // To list and read files
  'https://www.googleapis.com/auth/documents.readonly', // To read Google Docs
  'https://www.googleapis.com/auth/presentations.readonly', // To read Google Slides
  'https://www.googleapis.com/auth/spreadsheets', // Read and Write for output and analysis
  'https://www.googleapis.com/auth/gmail.readonly', // To read Gmail quota information
];

// --- SHEET CONSTANTS ---
// Maximum number of characters allowed in a single Google Sheet cell.
// A buffer is included to prevent errors.
export const MAX_CELL_CHARACTERS = 49500; // Max characters for a cell, with some buffer

// Sheet names for output
export const SUMMARY_SHEET_NAME = 'Summary';
