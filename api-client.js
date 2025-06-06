/**
 * Enhanced API Client Module
 * Provides centralised, DRY API client management with consistent error handling
 */

import 'dotenv/config';
import { GoogleAuth } from 'google-auth-library';
import { google } from 'googleapis';
import { EnvironmentConfig, CONFIG } from './config.js';
import { dataTransferMonitor } from './data-transfer-monitor.js';

/**
 * Base API Client with common functionality
 */
export class BaseApiClient {
  constructor(authClient) {
    this.auth = authClient;
    this.retryConfig = CONFIG.API.RETRY;
  }
  
  /**
   * Enhanced retry mechanism with consistent error handling
   */
  async callWithRetry(apiFunction, maxRetries = this.retryConfig.maxRetries) {
    let lastError;
    
    for (let attempt = 0; attempt <= maxRetries; attempt++) {
      try {
        const startTime = Date.now();
        const result = await apiFunction();
        const endTime = Date.now();
        
        // Track data transfer
        dataTransferMonitor.trackApiCall('api', 'general', 0, 0);
        
        return result;
      } catch (error) {
        lastError = error;
        
        const isRetryable = this.isRetryableError(error);
        const isLastAttempt = attempt === maxRetries;
        
        if (!isRetryable || isLastAttempt) {
          throw error;
        }
        
        const delay = this.calculateBackoffDelay(attempt);
        console.warn(`API call failed (attempt ${attempt + 1}/${maxRetries + 1}). Retrying in ${delay}ms...`);
        await this.sleep(delay);
      }
    }
    
    throw lastError;
  }
  
  isRetryableError(error) {
    return error.code === 403 || // Rate limit exceeded
           error.code === 429 || // Too many requests
           error.code === 500 || // Internal server error
           error.code === 502 || // Bad gateway
           error.code === 503 || // Service unavailable
           error.code === 504;   // Gateway timeout
  }
  
  calculateBackoffDelay(attempt) {
    const baseDelay = this.retryConfig.baseDelay;
    const maxDelay = this.retryConfig.maxDelay;
    const exponentialDelay = baseDelay * Math.pow(2, attempt);
    const jitteredDelay = exponentialDelay + Math.random() * 1000;
    
    return Math.min(jitteredDelay, maxDelay);
  }
  
  sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }
}

/**
 * Drive API Client with specialised drive operations
 */
export class DriveApiClient extends BaseApiClient {
  constructor(authClient) {
    super(authClient);
    this.drive = google.drive({ version: 'v3', auth: authClient });
  }
  
  async getFileMetadata(fileId, fields = 'id,name,mimeType,webViewLink,owners,createdTime,modifiedTime,size,permissions') {
    return this.callWithRetry(() => 
      this.drive.files.get({ fileId, fields })
    );
  }
  
  async listFiles(query, fields = 'files(id,name,mimeType,webViewLink,owners,createdTime,modifiedTime,size)', pageSize = 1000) {
    return this.callWithRetry(() =>
      this.drive.files.list({ q: query, fields, pageSize })
    );
  }
  
  async getFilePermissions(fileId) {
    return this.callWithRetry(() =>
      this.drive.permissions.list({ fileId, fields: 'permissions(id,emailAddress,role,type,domain)' })
    );
  }
  
  async getDriveInfo() {
    return this.callWithRetry(() =>
      this.drive.about.get({ fields: 'user,storageQuota' })
    );
  }
  
  async listSharedDrives() {
    return this.callWithRetry(() =>
      this.drive.drives.list({ fields: 'drives(id,name,capabilities)' })
    );
  }
  
  async getSharedDriveMembers(driveId) {
    return this.callWithRetry(() =>
      this.drive.permissions.list({
        fileId: driveId,
        fields: 'permissions(id,emailAddress,role,type,displayName)',
        supportsAllDrives: true
      })
    );
  }
}

/**
 * Documents API Client
 */
export class DocsApiClient extends BaseApiClient {
  constructor(authClient) {
    super(authClient);
    this.docs = google.docs({ version: 'v1', auth: authClient });
  }
  
  async getDocument(documentId) {
    const fields = 'body.content,inlineObjects,lists,namedStyles,documentStyle,headers,footers';
    return this.callWithRetry(() =>
      this.docs.documents.get({ documentId, fields })
    );
  }
}

/**
 * Sheets API Client
 */
export class SheetsApiClient extends BaseApiClient {
  constructor(authClient) {
    super(authClient);
    this.sheets = google.sheets({ version: 'v4', auth: authClient });
  }
  
  async getSpreadsheet(spreadsheetId) {
    const fields = 'sheets.data.rowData.values(formattedValue,hyperlink,formula),sheets.properties.title';
    return this.callWithRetry(() =>
      this.sheets.spreadsheets.get({ spreadsheetId, fields })
    );
  }
  
  async updateValues(spreadsheetId, range, values, valueInputOption = 'RAW') {
    return this.callWithRetry(() =>
      this.sheets.spreadsheets.values.update({
        spreadsheetId,
        range,
        valueInputOption,
        resource: { values }
      })
    );
  }
  
  async getValues(spreadsheetId, range) {
    return this.callWithRetry(() =>
      this.sheets.spreadsheets.values.get({ spreadsheetId, range })
    );
  }
  
  async batchUpdate(spreadsheetId, requests) {
    return this.callWithRetry(() =>
      this.sheets.spreadsheets.batchUpdate({
        spreadsheetId,
        resource: { requests }
      })
    );
  }
}

/**
 * Slides API Client
 */
export class SlidesApiClient extends BaseApiClient {
  constructor(authClient) {
    super(authClient);
    this.slides = google.slides({ version: 'v1', auth: authClient });
  }
  
  async getPresentation(presentationId) {
    return this.callWithRetry(() =>
      this.slides.presentations.get({ presentationId })
    );
  }
}

/**
 * Gmail API Client
 */
export class GmailApiClient extends BaseApiClient {
  constructor(authClient) {
    super(authClient);
    this.gmail = google.gmail({ version: 'v1', auth: authClient });
  }
  
  async getProfile(userId = 'me') {
    return this.callWithRetry(() =>
      this.gmail.users.getProfile({ userId })
    );
  }
}

/**
 * Calendar API Client
 */
export class CalendarApiClient extends BaseApiClient {
  constructor(authClient) {
    super(authClient);
    this.calendar = google.calendar({ version: 'v3', auth: authClient });
  }
  
  async listCalendars() {
    return this.callWithRetry(() =>
      this.calendar.calendarList.list()
    );
  }
  
  async listEvents(calendarId, timeMin, timeMax, maxResults = 2500) {
    return this.callWithRetry(() =>
      this.calendar.events.list({
        calendarId,
        timeMin,
        timeMax,
        maxResults,
        singleEvents: true,
        orderBy: 'startTime'
      })
    );
  }
}

/**
 * Authentication Manager
 * Single Responsibility: Manages Google API authentication
 */
class AuthenticationManager {
  constructor() {
    this.config = EnvironmentConfig.getInstance();
    this.authClients = new Map();
  }
  
  async getAuthenticatedClient(userEmail = null) {
    const key = userEmail || 'admin';
    
    if (!this.authClients.has(key)) {
      const authClient = await this.createAuthenticatedClient(userEmail);
      this.authClients.set(key, authClient);
    }
    
    return this.authClients.get(key);
  }
  
  async createAuthenticatedClient(userEmail = null) {
    const auth = new GoogleAuth({
      scopes: CONFIG.API.SCOPES,
      clientOptions: {
        subject: userEmail || this.config.adminUser
      }
    });
    
    try {
      const authClient = await auth.getClient();
      await this.validatePermissions(authClient);
      return authClient;
    } catch (error) {
      throw new Error(`Authentication failed for ${userEmail || this.config.adminUser}: ${error.message}`);
    }
  }
  
  async validatePermissions(authClient) {
    const drive = google.drive({ version: 'v3', auth: authClient });
    await drive.about.get({ fields: 'user' });
  }
  
  clearCache() {
    this.authClients.clear();
  }
}

/**
 * Unified API Client
 * Single Responsibility: Provides a unified interface for all Google API operations
 * Follows DRY: Centralises authentication and retry logic
 */
export class ApiClient extends BaseApiClient {
  constructor() {
    super();
    this.authManager = new AuthenticationManager();
  }
  
  async createAuthenticatedClient(userEmail = null) {
    return this.authManager.getAuthenticatedClient(userEmail);
  }
  
  async withAuth(userEmail, apiCallback) {
    const authClient = await this.authManager.getAuthenticatedClient(userEmail);
    return this.callWithRetry(() => apiCallback(authClient));
  }
  
  // Drive API methods
  async getFileMetadata(fileId, fields = 'id,name,mimeType,webViewLink,owners,createdTime,modifiedTime,size,permissions', userEmail = null) {
    return this.withAuth(userEmail, (authClient) => {
      const drive = google.drive({ version: 'v3', auth: authClient });
      return drive.files.get({ fileId, fields });
    });
  }
  
  async listFiles(query, fields = 'files(id,name,mimeType,webViewLink,owners,createdTime,modifiedTime,size)', pageSize = 1000, userEmail = null) {
    return this.withAuth(userEmail, (authClient) => {
      const drive = google.drive({ version: 'v3', auth: authClient });
      return drive.files.list({ q: query, fields, pageSize });
    });
  }
  
  async getFilePermissions(fileId, userEmail = null) {
    return this.withAuth(userEmail, (authClient) => {
      const drive = google.drive({ version: 'v3', auth: authClient });
      return drive.permissions.list({ fileId, fields: 'permissions(id,emailAddress,role,type,domain)' });
    });
  }
  
  async getDriveInfo(userEmail = null) {
    return this.withAuth(userEmail, (authClient) => {
      const drive = google.drive({ version: 'v3', auth: authClient });
      return drive.about.get({ fields: 'user,storageQuota' });
    });
  }
  
  async listSharedDrives(userEmail = null) {
    return this.withAuth(userEmail, (authClient) => {
      const drive = google.drive({ version: 'v3', auth: authClient });
      return drive.drives.list({ fields: 'drives(id,name,capabilities)' });
    });
  }
  
  async getSharedDriveMembers(driveId, userEmail = null) {
    return this.withAuth(userEmail, (authClient) => {
      const drive = google.drive({ version: 'v3', auth: authClient });
      return drive.permissions.list({
        fileId: driveId,
        fields: 'permissions(id,emailAddress,role,type,displayName)',
        supportsAllDrives: true
      });
    });
  }
  
  // Docs API methods
  async getDocument(documentId, userEmail = null) {
    return this.withAuth(userEmail, (authClient) => {
      const docs = google.docs({ version: 'v1', auth: authClient });
      const fields = 'body.content,inlineObjects,lists,namedStyles,documentStyle,headers,footers';
      return docs.documents.get({ documentId, fields });
    });
  }
  
  // Sheets API methods
  async getSpreadsheet(spreadsheetId, userEmail = null) {
    return this.withAuth(userEmail, (authClient) => {
      const sheets = google.sheets({ version: 'v4', auth: authClient });
      const fields = 'sheets.data.rowData.values(formattedValue,hyperlink,formula),sheets.properties.title';
      return sheets.spreadsheets.get({ spreadsheetId, fields });
    });
  }
  
  async updateValues(spreadsheetId, range, values, valueInputOption = 'RAW', userEmail = null) {
    return this.withAuth(userEmail, (authClient) => {
      const sheets = google.sheets({ version: 'v4', auth: authClient });
      return sheets.spreadsheets.values.update({
        spreadsheetId,
        range,
        valueInputOption,
        resource: { values }
      });
    });
  }
  
  async getValues(spreadsheetId, range, userEmail = null) {
    return this.withAuth(userEmail, (authClient) => {
      const sheets = google.sheets({ version: 'v4', auth: authClient });
      return sheets.spreadsheets.values.get({ spreadsheetId, range });
    });
  }
  
  async batchUpdate(spreadsheetId, requests, userEmail = null) {
    return this.withAuth(userEmail, (authClient) => {
      const sheets = google.sheets({ version: 'v4', auth: authClient });
      return sheets.spreadsheets.batchUpdate({
        spreadsheetId,
        resource: { requests }
      });
    });
  }
  
  // Slides API methods
  async getPresentation(presentationId, userEmail = null) {
    return this.withAuth(userEmail, (authClient) => {
      const slides = google.slides({ version: 'v1', auth: authClient });
      return slides.presentations.get({ presentationId });
    });
  }
  
  // Admin API methods
  async listUsers(domain, maxResults = 500) {
    return this.withAuth(null, (authClient) => {
      const admin = google.admin({ version: 'directory_v1', auth: authClient });
      return admin.users.list({
        domain,
        maxResults,
        projection: 'basic',
        query: 'isSuspended=false isArchived=false'
      });
    });
  }
  
  // Gmail API methods
  async getProfile(userId = 'me', userEmail = null) {
    return this.withAuth(userEmail, (authClient) => {
      const gmail = google.gmail({ version: 'v1', auth: authClient });
      return gmail.users.getProfile({ userId });
    });
  }
  
  // Calendar API methods
  async listCalendars(userEmail = null) {
    return this.withAuth(userEmail, (authClient) => {
      const calendar = google.calendar({ version: 'v3', auth: authClient });
      return calendar.calendarList.list();
    });
  }
  
  async listEvents(calendarId, timeMin, timeMax, maxResults = 2500, userEmail = null) {
    return this.withAuth(userEmail, (authClient) => {
      const calendar = google.calendar({ version: 'v3', auth: authClient });
      return calendar.events.list({
        calendarId,
        timeMin,
        timeMax,
        maxResults,
        singleEvents: true,
        orderBy: 'startTime'
      });
    });
  }

  /**
   * Processes raw URLs and resolves Google Drive file metadata
   * @param {Object} drive - Google Drive API client
   * @param {Array} rawUrls - Array of raw URLs
   * @returns {Promise<Array>} Processed URLs with metadata
   */
  async processRawUrls(drive, rawUrls) {
    const uniqueRawUrls = [
      ...new Set(rawUrls.filter((url) => url && typeof url === 'string')),
    ];
    const resolvedLinkInfo = [];

    for (const url of uniqueRawUrls) {
      const fileId = this.getDriveFileIdFromUrl(url);
      if (fileId) {
        const metadata = await this.resolveFileMetadata(drive, fileId, url);
        if (metadata) {
          resolvedLinkInfo.push(
            `${url} (Name: ${metadata.name}, Type: ${metadata.type}${metadata.isSharedDrive ? ', Shared Drive' : ''})`
          );
        } else {
          resolvedLinkInfo.push(`${url} (Unresolved Drive Link: ID ${fileId})`);
        }
      } else if (this.isGoogleWorkspaceUrl(url)) {
        // Only include Google Workspace document URLs, not general google.com links
        resolvedLinkInfo.push(url);
      }
    }
    return resolvedLinkInfo;
  }

  /**
   * Extracts Google Drive file ID from a URL
   * @param {string} url - URL to extract file ID from
   * @returns {string|null} File ID or null if not found
   */
  getDriveFileIdFromUrl(url) {
    if (!url || typeof url !== 'string') return null;
    
    // Match various Google Drive URL formats
    const patterns = [
      /\/d\/([a-zA-Z0-9-_]+)/,           // /d/fileId format
      /id=([a-zA-Z0-9-_]+)/,            // id=fileId format
      /folders\/([a-zA-Z0-9-_]+)/       // folders/folderId format
    ];
    
    for (const pattern of patterns) {
      const match = url.match(pattern);
      if (match) return match[1];
    }
    
    return null;
  }

  /**
   * Resolves file metadata from Google Drive
   * @param {Object} drive - Google Drive API client
   * @param {string} fileId - File ID to resolve
   * @param {string} originalUrl - Original URL for context
   * @returns {Promise<Object|null>} File metadata or null
   */
  async resolveFileMetadata(drive, fileId, originalUrl) {
    try {
      const response = await this.callWithRetry(() =>
        drive.files.get({
          fileId,
          fields: 'name,mimeType,driveId',
          supportsAllDrives: true
        })
      );
      
      const file = response.data;
      return {
        name: file.name,
        type: this.getDisplayNameForMimeType(file.mimeType),
        isSharedDrive: !!file.driveId
      };
    } catch (error) {
      console.warn(`Could not resolve metadata for file ${fileId}: ${error.message}`);
      return null;
    }
  }

  /**
   * Gets display name for a MIME type
   * @param {string} mimeType - MIME type
   * @returns {string} Display name
   */
  getDisplayNameForMimeType(mimeType) {
    return CONFIG.FILE_TYPES.DISPLAY_NAMES[mimeType] || 'Unknown File Type';
  }

  /**
   * Checks if a URL is a Google Workspace file URL
   * @param {string} url - URL to check
   * @returns {boolean} True if Google Workspace URL
   */
  isGoogleWorkspaceUrl(url) {
    if (!url || typeof url !== 'string') return false;
    
    const workspacePatterns = [
      /docs\.google\.com\/(?:document|spreadsheets|presentation|forms|drawings)/,
      /drive\.google\.com\/(?:file\/d\/|open\?id=)/,
      /drive\.google\.com\/drive\/(?:folders|shared-drives)/
    ];
    
    return workspacePatterns.some(pattern => pattern.test(url));
  }
}

/**
 * Admin API Client
 * Single Responsibility: Handles admin-specific operations that require elevated permissions
 * Extends ApiClient for admin operations only
 */
export class AdminApiClient extends ApiClient {
  constructor() {
    super();
  }
  
  /**
   * Get all users with pagination support
   * @param {string} domain - Domain to list users from
   * @returns {Promise<Array>} Array of all users
   */
  async getAllUsers(domain = null) {
    const targetDomain = domain || this.authManager.config.primaryDomain;
    let allUsers = [];
    let pageToken = null;
    
    do {
      const response = await this.withAuth(null, (authClient) => {
        const admin = google.admin({ version: 'directory_v1', auth: authClient });
        return admin.users.list({
          domain: targetDomain,
          maxResults: 500,
          projection: 'basic',
          query: 'isSuspended=false isArchived=false',
          pageToken
        });
      });
      
      if (response.data.users) {
        allUsers = allUsers.concat(response.data.users);
      }
      pageToken = response.data.nextPageToken;
    } while (pageToken);
    
    return allUsers;
  }
}

// Export singleton instances following DRY principle
export const apiClient = new ApiClient();
export const adminApiClient = new AdminApiClient();
