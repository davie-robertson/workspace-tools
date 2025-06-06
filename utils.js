/**
 * Enhanced Utilities Module
 * Contains utility functions with consistent naming and modern JS practices
 */

import fs from 'fs';
import { CONFIG } from './config.js';

/**
 * File Type Utilities
 */
export class FileTypeUtils {
  /**
   * Determines the file type based on its MIME type using modern Map lookup
   * @param {string|null} mimeType - The MIME type of the file
   * @returns {string} A human-readable file type description
   */
  static getDisplayName(mimeType) {
    if (!mimeType) return 'Unknown Type';
    
    return CONFIG.FILE_TYPES.DISPLAY_NAMES[mimeType] || 
           (mimeType.startsWith('application/vnd.google-apps') ? 'Google Workspace File' : mimeType);
  }
  
  /**
   * Checks if a MIME type is a Google Workspace file
   * @param {string} mimeType - The MIME type to check
   * @returns {boolean} True if it's a Google Workspace file
   */
  static isWorkspaceFile(mimeType) {
    return Object.values(CONFIG.FILE_TYPES.WORKSPACE).includes(mimeType);
  }
  
  /**
   * Gets the workspace file type category
   * @param {string} mimeType - The MIME type
   * @returns {string|null} The file category or null if not a workspace file
   */
  static getWorkspaceCategory(mimeType) {
    const categoryMap = {
      [CONFIG.FILE_TYPES.WORKSPACE.DOCUMENT]: 'document',
      [CONFIG.FILE_TYPES.WORKSPACE.SPREADSHEET]: 'spreadsheet',
      [CONFIG.FILE_TYPES.WORKSPACE.PRESENTATION]: 'presentation',
      [CONFIG.FILE_TYPES.WORKSPACE.FORM]: 'form',
      [CONFIG.FILE_TYPES.WORKSPACE.DRAWING]: 'drawing',
    };
    
    return categoryMap[mimeType] || null;
  }
  
  /**
   * Alias for getDisplayName for backward compatibility
   * @param {string|null} mimeType - The MIME type of the file
   * @returns {string} A human-readable file type description
   */
  static getFileType(mimeType) {
    return this.getDisplayName(mimeType);
  }
}

/**
 * String Utilities
 */
export class StringUtils {
  /**
   * Converts string to camelCase
   * @param {string} str - String to convert
   * @returns {string} camelCase string
   */
  static toCamelCase(str) {
    return str.replace(/-([a-z])/g, (_, letter) => letter.toUpperCase());
  }
  
  /**
   * Converts camelCase to kebab-case
   * @param {string} str - String to convert
   * @returns {string} kebab-case string
   */
  static toKebabCase(str) {
    return str.replace(/([a-z0-9]|(?=[A-Z]))([A-Z])/g, '$1-$2').toLowerCase();
  }
  
  /**
   * Truncates string to specified length with ellipsis
   * @param {string} str - String to truncate
   * @param {number} maxLength - Maximum length
   * @returns {string} Truncated string
   */
  static truncate(str, maxLength) {
    if (!str || str.length <= maxLength) return str;
    return str.substring(0, maxLength - 3) + '...';
  }
  
  /**
   * Normalizes email address to lowercase
   * @param {string} email - Email address
   * @returns {string} Normalized email
   */
  static normaliseEmail(email) {
    return email?.toLowerCase()?.trim() || '';
  }
}

/**
 * Array Utilities
 */
export class ArrayUtils {
  /**
   * Removes duplicates from array using Set
   * @param {Array} array - Array to deduplicate
   * @returns {Array} Array without duplicates
   */
  static unique(array) {
    return [...new Set(array)];
  }
  
  /**
   * Chunks array into smaller arrays of specified size
   * @param {Array} array - Array to chunk
   * @param {number} size - Chunk size
   * @returns {Array[]} Array of chunks
   */
  static chunk(array, size) {
    const chunks = [];
    for (let i = 0; i < array.length; i += size) {
      chunks.push(array.slice(i, i + size));
    }
    return chunks;
  }
  
  /**
   * Groups array elements by a key function
   * @param {Array} array - Array to group
   * @param {Function} keyFn - Function to generate group key
   * @returns {Object} Grouped object
   */
  static groupBy(array, keyFn) {
    return array.reduce((groups, item) => {
      const key = keyFn(item);
      groups[key] = groups[key] || [];
      groups[key].push(item);
      return groups;
    }, {});
  }
}

/**
 * Date Utilities
 */
export class DateUtils {
  /**
   * Formats date to ISO string for consistent logging
   * @param {Date} date - Date to format
   * @returns {string} ISO date string
   */
  static toIsoString(date = new Date()) {
    return date.toISOString();
  }
  
  /**
   * Checks if date is within the last N days
   * @param {Date} date - Date to check
   * @param {number} days - Number of days
   * @returns {boolean} True if within the timeframe
   */
  static isWithinLastDays(date, days) {
    const now = new Date();
    const cutoff = new Date(now.getTime() - (days * 24 * 60 * 60 * 1000));
    return date >= cutoff;
  }
  
  /**
   * Gets future date by adding days
   * @param {number} days - Days to add
   * @param {Date} fromDate - Base date (defaults to now)
   * @returns {Date} Future date
   */
  static addDays(days, fromDate = new Date()) {
    const result = new Date(fromDate);
    result.setDate(result.getDate() + days);
    return result;
  }
}

/**
 * File System Utilities
 */
export class FileSystemUtils {
  /**
   * Safely checks if file exists
   * @param {string} filePath - Path to check
   * @returns {boolean} True if file exists
   */
  static fileExists(filePath) {
    try {
      return fs.existsSync(filePath);
    } catch {
      return false;
    }
  }
  
  /**
   * Safely deletes file with error handling
   * @param {string} filePath - Path to delete
   * @returns {boolean} True if successfully deleted
   */
  static safeDelete(filePath) {
    try {
      if (this.fileExists(filePath)) {
        fs.unlinkSync(filePath);
        return true;
      }
      return false;
    } catch (error) {
      console.warn(`Warning: Failed to delete ${filePath}: ${error.message}`);
      return false;
    }
  }
  
  /**
   * Ensures directory exists, creates if necessary
   * @param {string} dirPath - Directory path
   */
  static ensureDirectory(dirPath) {
    try {
      if (!fs.existsSync(dirPath)) {
        fs.mkdirSync(dirPath, { recursive: true });
      }
    } catch (error) {
      throw new Error(`Failed to create directory ${dirPath}: ${error.message}`);
    }
  }
}

/**
 * Streaming Log Cleanup Utilities
 */
export class StreamingLogUtils {
  /**
   * Clean up streaming log files after processing
   * @param {Object} streamingLogger - Logger instance with file paths
   */
  static cleanupLogs(streamingLogger) {
    if (!streamingLogger) return;
    
    const filesToClean = [
      streamingLogger.scanLogPath,
      streamingLogger.summaryLogPath
    ].filter(Boolean);
    
    let cleanedCount = 0;
    
    for (const filePath of filesToClean) {
      if (FileSystemUtils.safeDelete(filePath)) {
        console.log(`Cleaned up: ${filePath}`);
        cleanedCount++;
      }
    }
    
    if (cleanedCount > 0) {
      console.log('Streaming log files cleaned up successfully.');
    }
  }
}

/**
 * Validation Utilities
 */
export class ValidationUtils {
  /**
   * Validates email format using simple regex
   * @param {string} email - Email to validate
   * @returns {boolean} True if valid email format
   */
  static isValidEmail(email) {
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    return emailRegex.test(email);
  }
  
  /**
   * Validates Google file ID format
   * @param {string} fileId - File ID to validate
   * @returns {boolean} True if valid file ID format
   */
  static isValidFileId(fileId) {
    return typeof fileId === 'string' && fileId.length > 0 && /^[a-zA-Z0-9_-]+$/.test(fileId);
  }
  
  /**
   * Validates URL format
   * @param {string} url - URL to validate
   * @returns {boolean} True if valid URL
   */
  static isValidUrl(url) {
    try {
      new URL(url);
      return true;
    } catch {
      return false;
    }
  }
}

// Legacy exports for backward compatibility
export const getFileType = FileTypeUtils.getDisplayName;
export const cleanupStreamingLogs = StreamingLogUtils.cleanupLogs;
