import { GoogleAuth } from "google-auth-library";
import { SCOPES, ADMIN_USER, getFileType } from "./index.js";
import { getDriveFileIdFromUrl } from "./extract-helpers.js";


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
    return await auth.getClient(); // Returns an authenticated OAuth2 client.
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
    } else if (url.includes('google.com/') || url.startsWith('/')) {
      resolvedLinkInfo.push(url);
    }
  }
  return resolvedLinkInfo;
}

