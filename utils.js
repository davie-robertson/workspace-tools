/**
 * Utilities Module
 * Contains utility functions and constants used throughout the application
 */

import fs from 'fs';

/**
 * Determines the file type based on its MIME type.
 *
 * @param {string|null} mimeType - The MIME type of the file.
 * @returns {string} A human-readable file type description.
 *   - 'Google Doc' for Google Documents
 *   - 'Google Sheet' for Google Spreadsheets
 *   - 'Google Slide' for Google Presentations
 *   - 'Google Workspace File' for other Google Workspace files
 *   - The original MIME type if not a Google Workspace file
 *   - 'Unknown Type' if no MIME type is provided
 */
export function getFileType(mimeType) {
  if (!mimeType) return 'Unknown Type';
  if (mimeType === 'application/vnd.google-apps.document') return 'Google Doc';
  if (mimeType === 'application/vnd.google-apps.spreadsheet')
    return 'Google Sheet';
  if (mimeType === 'application/vnd.google-apps.presentation')
    return 'Google Slide';
  if (mimeType.startsWith('application/vnd.google-apps'))
    return 'Google Workspace File';
  return mimeType;
}

/**
 * Clean up streaming log files after processing is complete
 */
export function cleanupStreamingLogs(streamingLogger) {
  if (!streamingLogger) return;
  
  try {
    const scanLogExists = fs.existsSync(streamingLogger.scanLogPath);
    const summaryLogExists = fs.existsSync(streamingLogger.summaryLogPath);
    
    if (scanLogExists) {
      fs.unlinkSync(streamingLogger.scanLogPath);
      console.log(`Cleaned up: ${streamingLogger.scanLogPath}`);
    }
    
    if (summaryLogExists) {
      fs.unlinkSync(streamingLogger.summaryLogPath);
      console.log(`Cleaned up: ${streamingLogger.summaryLogPath}`);
    }
    
    if (scanLogExists || summaryLogExists) {
      console.log('Streaming log files cleaned up successfully.');
    }
    
  } catch (error) {
    console.warn(`Warning: Failed to clean up streaming log files: ${error.message}`);
    // Don't throw - cleanup failure shouldn't stop the process
  }
}
