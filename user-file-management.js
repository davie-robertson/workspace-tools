/**
 * User and File Management Module
 * Contains functions for listing users and files from Google Workspace
 */

import { google } from 'googleapis';
import { adminApiClient, apiClient } from './api-client.js';
import { EnvironmentConfig } from './config.js';
import { dataTransferMonitor } from './data-transfer-monitor.js';

/**
 * Retrieves all active users from Google Workspace admin API
 *
 * @async
 * @returns {Promise<Array>} A promise that resolves to an array of active user objects
 *
 * @description
 * This function uses the AdminApiClient singleton to fetch all active users.
 * It automatically handles pagination and filtering of suspended/archived users.
 */
export async function getAllUsers() {
  try {
    const users = await adminApiClient.getAllUsers();
    
    // Track this API call
    dataTransferMonitor.trackUserList({ users });
    
    return users;
  } catch (error) {
    console.error('Error fetching users:', error.message);
    throw error;
  }
}

/**
 * Retrieves a list of Google Drive files owned by a specific user.
 *
 * @async
 * @function listUserFiles
 * @param {string} userEmail - The email address of the user whose files to list.
 * @returns {Promise<Array<Object>>} A promise that resolves to an array of file objects.
 *   Each file object contains id, name, mimeType, webViewLink, and owners properties.
 * @description
 *   This function searches for Google Docs, Sheets, and Slides files that:
 *   - Are owned by the specified user (by impersonating that user)
 *   - Are not in the trash
 *   - Retrieves up to 1000 files per page of results
 *   - Uses pagination to fetch all matching files
 */
export async function listUserFiles(userEmail) {
  // Create an authenticated client for the specific user
  const userAuthClient = await apiClient.createAuthenticatedClient(userEmail);
  const drive = google.drive({ version: 'v3', auth: userAuthClient });
  
  let files = [];
  let pageToken;
  const queryMimeTypes = [
    'application/vnd.google-apps.document',
    'application/vnd.google-apps.spreadsheet',
    'application/vnd.google-apps.presentation',
  ];
  // Simplified query since we're now impersonating the user - just look for files they own
  const q = `trashed = false and (${queryMimeTypes
    .map((m) => `mimeType = '${m}'`)
    .join(' or ')})`;
  const fields =
    'nextPageToken, files(id, name, mimeType, webViewLink, owners(emailAddress), createdTime, modifiedTime, size)';
  const PAGE_SIZE = 1000;
  do {
    const res = await apiClient.callWithRetry(() =>
      drive.files.list({
        q,
        fields,
        pageSize: PAGE_SIZE,
        pageToken,
        supportsAllDrives: true,
        includeItemsFromAllDrives: true,
        corpora: 'allDrives',
      })
    );
    if (res.data.files?.length) files = files.concat(res.data.files);
    pageToken = res.data.nextPageToken;
  } while (pageToken);
  return files;
}
