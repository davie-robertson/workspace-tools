import { GoogleAuth } from "google-auth-library";
import { SCOPES } from "./constants.js";
import { ADMIN_USER } from "./index.js";
import { getFileType } from "./utils.js";
import { getDriveFileIdFromUrl } from "./extract-helpers.js";
import { google } from "googleapis";
import { dataTransferMonitor } from './data-transfer-monitor.js';


/**
 * Creates and returns an authenticated Google OAuth2 client.
 * 
 * This function initializes a GoogleAuth instance with specified scopes and sets up
 * service account impersonation for the admin user. It handles authentication errors
 * with detailed logging while ensuring sensitive information is not leaked in error messages.
 * 
 * @async
 * @returns {Promise<OAuth2Client>} A Promise that resolves to an authenticated Google OAuth2 client
 * @throws {Error} If authentication fails with a sanitized error message
 * 
 * @example
 * try {
 *   const authClient = await getAuthenticatedClient();
 *   // Use authClient to make authenticated API calls
 * } catch (error) {
 *   console.error("Authentication failed:", error.message);
 * }
 */
export async function getAuthenticatedClient() {
  try {
    // Initialize GoogleAuth with specified scopes and client options (for impersonation).
    const auth = new GoogleAuth({
      scopes: SCOPES,
      // SECURITY: Subject (ADMIN_USER) is used for service account impersonation.
      // This allows the service account to act on behalf of ADMIN_USER.
      clientOptions: { subject: ADMIN_USER },
    });
    const authClient = await auth.getClient(); // Returns an authenticated OAuth2 client

    // Check and log permissions
    await checkPermissions(authClient);

    return authClient;
  } catch (error) {
    // Log detailed error information for authentication failures.
    console.error(
      'Error creating authenticated client:',
      error.message,
      error.stack // Include stack trace for better debugging
    );
    if (error.response?.data) {
      // Log response data if available
      console.error(
        'Error response data:',
        JSON.stringify(error.response.data, null, 2)
      );
    }
    // SECURITY: Ensure error messages do not leak overly sensitive details if logged publicly.
    throw new Error(
      `Failed to authenticate: ${error.message}. Check service account credentials, permissions, and domain-wide delegation settings.`
    );
  }
}

/**
 * Checks and logs the permissions of the authenticated client.
 * 
 * @async
 * @param {OAuth2Client} authClient - The authenticated Google OAuth2 client
 * @throws {Error} If permission verification fails
 * 
 * @example
 * try {
 *   const authClient = await getAuthenticatedClient();
 *   await checkPermissions(authClient);
 * } catch (error) {
 *   console.error("Permission check failed:", error.message);
 * }
 */
export async function checkPermissions(authClient) {
  try {
    const drive = google.drive({ version: 'v3', auth: authClient });
    const response = await drive.about.get({ fields: 'user, storageQuota' });
    // Authentication successful - user info available if needed for debugging
  } catch (error) {
    console.error('Error checking permissions:', error.message);
    throw new Error('Failed to verify permissions. Ensure the service account has the necessary scopes.');
  }
}

/**
 * Makes an API call with automatic retries using exponential backoff.
 * 
 * @async
 * @param {Function} apiCallFunction - The function that makes the API call.
 * @param {number} [maxRetries=5] - Maximum number of retry attempts.
 * @param {number} [initialDelay=1000] - Initial delay in milliseconds for the backoff strategy.
 * @returns {Promise<*>} The result from the API call.
 * @throws {Error} Throws if the API call fails after all retry attempts or if the error is not retryable.
 * 
 * @example
 * const data = await callWithRetry(
 *   () => fetch('https://api.example.com/data'),
 *   3,
 *   2000
 * );
 */
export async function callWithRetry(
  apiCallFunction, // The function that makes the API call
  maxRetries = 5, // Maximum number of retries
  initialDelay = 1000 // Initial delay in milliseconds for backoff
) {
  let retries = 0;
  while (true) {
    try {
      return await apiCallFunction();
    } catch (error) {
      const isRetryable = error.code === 403 ||
        error.code === 429 ||
        error.code === 500 ||
        error.code === 503;

      if (isRetryable && retries < maxRetries) {
        retries++;
        const delay = initialDelay * Math.pow(2, retries - 1) + Math.random() * 1000;
        console.warn(
          `API call failed (attempt ${retries}/${maxRetries}): ${error.message}. Retrying in ${Math.round(delay / 1000)}s...`
        );
        await new Promise((resolve) => setTimeout(resolve, delay));
      } else {
        throw error;
      }
    }
  }
}

/**
 * Resolves metadata for a Google Drive file using the Drive API
 * 
 * @async
 * @param {Object} drive - The Google Drive API client instance
 * @param {string} fileId - The ID of the file to retrieve metadata for
 * @param {string} originalUrl - The original URL of the file (used as fallback and for error reporting)
 * @returns {Promise<Object|null>} A promise that resolves to an object containing:
 *   - name: The file name or 'Unknown Name' if unavailable
 *   - type: The file type determined from its MIME type
 *   - url: The web view link or the original URL if unavailable
 *   - isSharedDrive: Boolean indicating if the file is in a shared drive
 * @throws {Error} If the API call fails, the error is caught and null is returned
 */
export async function resolveFileMetadata(drive, fileId, originalUrl) {
  try {
    const file = await callWithRetry(() => drive.files.get({
      fileId,
      fields: 'name,mimeType,webViewLink,teamDriveId,driveId',
      supportsAllDrives: true,
    })
    );
    
    // Track file metadata retrieval
    dataTransferMonitor.trackFileMetadata(fileId, file.data);
    
    return {
      name: file.data.name || 'Unknown Name',
      type: getFileType(file.data.mimeType),
      url: file.data.webViewLink || originalUrl,
      isSharedDrive: !!(file.data.teamDriveId || file.data.driveId),
    };
  } catch (error) {
    console.warn(
      `Could not resolve metadata for file ID ${fileId} (URL: ${originalUrl}): ${error.message}`
    );
    return null;
  }
}

/**
 * Processes a list of raw URLs, particularly Google Drive URLs, to extract metadata.
 * 
 * @async
 * @param {Object} drive - The Google Drive API client instance.
 * @param {string[]} rawUrls - An array of URLs to process.
 * @returns {Promise<string[]>} A promise that resolves to an array of formatted strings containing
 *                              the original URL and its metadata (name, type, shared drive status)
 *                              or an indication that the link couldn't be resolved.
 * 
 * @example
 * // Returns an array of processed URLs with their metadata
 * const processedUrls = await processRawUrls(driveClient, ["https://drive.google.com/file/d/1abc123/view"]);
 * 
 * @description
 * This function filters out non-string values and duplicates from the input URLs,
 * then attempts to resolve Google Drive file IDs from each URL.
 * For each valid Drive URL, it fetches metadata using the Drive API.
 * URLs that contain "google.com/" or start with "/" but aren't valid Drive links
 * are included without modification in the output.
 */
export async function processRawUrls(drive, rawUrls) {
  const uniqueRawUrls = [
    ...new Set(rawUrls.filter((url) => url && typeof url === 'string')),
  ];
  const resolvedLinkInfo = [];

  for (const url of uniqueRawUrls) {
    const fileId = getDriveFileIdFromUrl(url);
    if (fileId) {
      const metadata = await resolveFileMetadata(drive, fileId, url);
      if (metadata) {
        resolvedLinkInfo.push(
          `${url} (Name: ${metadata.name}, Type: ${metadata.type}${metadata.isSharedDrive ? ', Shared Drive' : ''})`
        );
      } else {
        resolvedLinkInfo.push(`${url} (Unresolved Drive Link: ID ${fileId})`);
      }
    } else if (isGoogleWorkspaceUrl(url)) {
      // Only include Google Workspace document URLs, not general google.com links
      resolvedLinkInfo.push(url);
    }
  }
  return resolvedLinkInfo;
}

/**
 * Scans and lists files for a specific user in Google Drive.
 * 
 * @async
 * @param {OAuth2Client} authClient - The authenticated Google OAuth2 client
 * @param {string} targetUserEmail - The email of the user whose files are to be scanned
 * @returns {Promise<Object[]>} A promise that resolves to an array of file objects containing:
 *                              - id: The file ID
 *                              - name: The file name
 * @throws {Error} If the file scanning fails
 * 
 * @example
 * try {
 *   const authClient = await getAuthenticatedClient();
 *   const files = await scanUserFiles(authClient, 'user@example.com');
 *   console.log('Files:', files);
 * } catch (error) {
 *   console.error('Error:', error.message);
 * }
 */
export async function scanUserFiles(authClient, targetUserEmail) {
  try {
    console.log(`Scanning files for user ${targetUserEmail}...`);

    // Force reauthentication by creating a new GoogleAuth instance
    const userAuth = new GoogleAuth({
      scopes: SCOPES,
      clientOptions: { subject: targetUserEmail },
    });
    const userAuthClient = await userAuth.getClient();

    const drive = google.drive({ version: 'v3', auth: userAuthClient });

    // Test impersonation with a simple API call
    const testResponse = await drive.files.list({
      q: "'me' in owners",
      fields: 'files(id, name)',
      supportsAllDrives: true,
      includeItemsFromAllDrives: true,
    });

    // Verify impersonated user
    const about = await drive.about.get({ fields: 'user' });

    if (about.data.user.emailAddress !== targetUserEmail) {
      throw new Error(
        `Impersonation failed: Expected ${targetUserEmail}, but got ${about.data.user.emailAddress}`
      );
    }

    // List files owned by or shared with the user
    const response = await drive.files.list({
      q: "'me' in owners",
      fields: 'files(id, name, owners)',
      supportsAllDrives: true,
      includeItemsFromAllDrives: true,
    });

    const files = response.data.files || [];
    console.log(`User ${targetUserEmail}: Found ${files.length} files.`);

    return files;
  } catch (error) {
    console.error(`Error scanning files for user ${targetUserEmail}:`, error.message);
    console.error('Full error details:', error);
    throw error;
  }
}

/**
 * Creates an authenticated Google API client for a specific user using service account impersonation.
 * This is required when accessing files owned by different users in Google Workspace.
 *
 * @async
 * @param {string} userEmail - The email address of the user to impersonate
 * @returns {Promise<OAuth2Client>} An authenticated OAuth2 client impersonating the specified user
 * @throws {Error} If authentication fails or the user cannot be impersonated
 *
 * @example
 * try {
 *   const userAuthClient = await getAuthenticatedClientForUser('alice@example.com');
 *   // Use userAuthClient to make API calls as alice@example.com
 * } catch (error) {
 *   console.error("User impersonation failed:", error.message);
 * }
 */
export async function getAuthenticatedClientForUser(userEmail) {
  try {
    // Initialize GoogleAuth with specified scopes and impersonate the target user
    const auth = new GoogleAuth({
      scopes: SCOPES,
      // SECURITY: Subject is set to the target user for impersonation
      // This allows the service account to act on behalf of the specified user
      clientOptions: { subject: userEmail },
    });
    const authClient = await auth.getClient();

    return authClient;
  } catch (error) {
    console.error(
      `Error creating authenticated client for user ${userEmail}:`,
      error.message,
      error.stack
    );
    if (error.response?.data) {
      console.error(
        'Error response data:',
        JSON.stringify(error.response.data, null, 2)
      );
    }
    throw new Error(
      `Failed to authenticate as ${userEmail}: ${error.message}. Check service account permissions and domain-wide delegation settings.`
    );
  }
}

/**
 * Gets quota information for a specific user including Drive and Gmail storage
 *
 * @async
 * @param {string} userEmail - The email address of the user to get quota for
 * @returns {Promise<Object>} An object containing quota information
 * @throws {Error} If quota retrieval fails
 *
 * @example
 * try {
 *   const quotaInfo = await getUserQuotaInfo('user@example.com');
 *   console.log('Drive usage:', quotaInfo.driveUsage);
 *   console.log('Gmail usage:', quotaInfo.gmailUsage);
 * } catch (error) {
 *   console.error("Quota retrieval failed:", error.message);
 * }
 */
export async function getUserQuotaInfo(userEmail) {
  try {
    // Create authenticated client for the specific user
    const userAuthClient = await getAuthenticatedClientForUser(userEmail);
    const drive = google.drive({ version: 'v3', auth: userAuthClient });
    const gmail = google.gmail({ version: 'v1', auth: userAuthClient });

    // Get Drive quota information
    const driveResponse = await callWithRetry(() =>
      drive.about.get({ fields: 'storageQuota' })
    );

    // Get Gmail quota information
    let gmailInfo = null;
    let gmailResponse = null;
    try {
      gmailResponse = await callWithRetry(() =>
        gmail.users.getProfile({ userId: 'me' })
      );
      gmailInfo = {
        emailAddress: gmailResponse.data.emailAddress,
        messagesTotal: gmailResponse.data.messagesTotal || 0,
        threadsTotal: gmailResponse.data.threadsTotal || 0,
        historyId: gmailResponse.data.historyId || null
      };
    } catch (gmailError) {
      console.warn(`Could not retrieve Gmail info for ${userEmail}: ${gmailError.message}`);
      gmailInfo = {
        emailAddress: 'unavailable',
        messagesTotal: 'unavailable',
        threadsTotal: 'unavailable', 
        historyId: 'unavailable',
        storageUsage: 'unavailable'
      };
    }

    const quota = driveResponse.data.storageQuota;
    
    // Convert bytes to megabytes (1 MB = 1,048,576 bytes)
    const bytesToMB = (bytes) => {
      if (bytes === 'unlimited' || bytes === 'error' || !bytes) return bytes;
      return (parseInt(bytes) / 1048576).toFixed(2);
    };
    
    const limitMB = quota?.limit ? bytesToMB(quota.limit) : 'unlimited';
    const usageMB = quota?.usage ? bytesToMB(quota.usage) : '0';
    const usageInDriveMB = quota?.usageInDrive ? bytesToMB(quota.usageInDrive) : '0';
    const usageInDriveTrashMB = quota?.usageInDriveTrash ? bytesToMB(quota.usageInDriveTrash) : '0';
    
    // Calculate Gmail storage usage: Total usage - Drive usage - Drive trash usage
    let gmailStorageMB = '0';
    if (quota?.usage && quota?.usageInDrive && quota?.usageInDriveTrash) {
      const totalUsage = parseInt(quota.usage);
      const driveUsage = parseInt(quota.usageInDrive);
      const trashUsage = parseInt(quota.usageInDriveTrash);
      const gmailUsageBytes = Math.max(0, totalUsage - driveUsage - trashUsage);
      gmailStorageMB = bytesToMB(gmailUsageBytes);
    }
    
    // Track quota API calls
    dataTransferMonitor.trackQuotaCheck(userEmail, driveResponse.data, gmailResponse?.data);
    
    return {
      userEmail,
      driveQuota: {
        limit: limitMB,
        usage: usageMB,
        usageInDrive: usageInDriveMB,
        usageInDriveTrash: usageInDriveTrashMB
      },
      gmailInfo: {
        ...gmailInfo,
        storageUsage: gmailStorageMB
      }
    };
  } catch (error) {
    console.error(`Error getting quota info for ${userEmail}:`, error.message);
    return {
      userEmail,
      driveQuota: {
        limit: 'error',
        usage: 'error', 
        usageInDrive: 'error',
        usageInDriveTrash: 'error'
      },
      gmailInfo: {
        emailAddress: 'error',
        messagesTotal: 'error',
        threadsTotal: 'error',
        historyId: 'error',
        storageUsage: 'error'
      }
    };
  }
}

/**
 * Checks if a URL is a Google Workspace file URL (Docs, Sheets, Slides, etc.)
 * 
 * @param {string} url - The URL to check
 * @returns {boolean} True if the URL is a Google Workspace file, false otherwise
 */
function isGoogleWorkspaceUrl(url) {
  if (!url || typeof url !== 'string') return false;
  
  // Check for Google Workspace document types
  const workspacePatterns = [
    /docs\.google\.com\/(?:document|spreadsheets|presentation|forms|drawings)/,
    /drive\.google\.com\/(?:file\/d\/|open\?id=)/,
    /drive\.google\.com\/drive\/(?:folders|shared-drives)/
  ];
  
  return workspacePatterns.some(pattern => pattern.test(url));
}

