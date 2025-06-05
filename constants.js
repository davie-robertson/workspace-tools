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
  'https://www.googleapis.com/auth/calendar.readonly', // To read calendar events and settings
];

// --- SHEET CONSTANTS ---
// Maximum number of characters allowed in a single Google Sheet cell.
// A buffer is included to prevent errors.
export const MAX_CELL_CHARACTERS = 49500; // Max characters for a cell, with some buffer

// Sheet names for output
export const SHEET_NAMES = {
  SUMMARY: 'Summary',
  ISSUES: 'Issues', 
  QUOTA: 'UserQuota',
  CHART: 'Issue Chart',
  DRIVES: 'Drive Analysis',
  SHARED_DRIVES: 'Shared Drives',
  EXTERNAL_SHARING: 'External Sharing',
  ORPHANED_FILES: 'Orphaned Files',
  DRIVE_MEMBERS: 'Drive Members'
};

// Issue types
export const ISSUE_TYPES = {
  EXTERNAL_LINK: 'External Link',
  INCOMPATIBLE_FUNCTION: 'Incompatible Function',
  NO_ISSUES: 'No Issues'
};

// Google Workspace file types
export const WORKSPACE_FILE_TYPES = {
  DOCUMENT: 'application/vnd.google-apps.document',
  SPREADSHEET: 'application/vnd.google-apps.spreadsheet', 
  PRESENTATION: 'application/vnd.google-apps.presentation',
  FORM: 'application/vnd.google-apps.form',
  DRAWING: 'application/vnd.google-apps.drawing'
};

// Chart configuration
export const CHART_CONFIG = {
  WIDTH: 600,
  HEIGHT: 400,
  POSITION: {
    ROW: 2,
    COLUMN: 1
  }
};

// API retry configuration
export const RETRY_CONFIG = {
  MAX_RETRIES: 3,
  BASE_DELAY: 1000,
  MAX_DELAY: 10000
};

// File scanning limits
export const SCAN_LIMITS = {
  MAX_FILES_PER_USER: 1000,
  MAX_USERS_TO_SCAN: 100
};

// Legacy - keeping for backward compatibility
export const SUMMARY_SHEET_NAME = SHEET_NAMES.SUMMARY;
