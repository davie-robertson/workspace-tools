/**
 * Consolidated File Processor
 * Single pipeline for processing Google Workspace files with caching and analysis
 */

import { FileCache } from '../cache/file-cache.js';
import { AnalysisOrchestrator } from './analysis-orchestrator.js';
import { apiClient } from '../api-client.js';
import { google } from 'googleapis';
import { EnvironmentConfig } from '../config.js';

export class FileProcessor {
  constructor(options = {}) {
    this.orchestrator = new AnalysisOrchestrator(options.analysis);
    this.envConfig = EnvironmentConfig.getInstance();
    this.options = {
      enableCaching: options.enableCaching !== false, // Default to true
      maxRetries: options.maxRetries || 3,
      batchSize: options.batchSize || 50,
      ...options
    };
    
    // Only initialize cache if caching is enabled
    if (this.options.enableCaching) {
      this.cache = new FileCache(options.cache);
    } else {
      this.cache = null;
    }
  }

  /**
   * Main file processing pipeline - consolidates all analysis types
   * @param {string} fileId - Google Drive file ID
   * @param {string} userEmail - User email for authentication
   * @param {Array} analysisTypes - Types of analysis to perform
   * @param {Function} progressCallback - Progress reporting callback
   * @returns {Object} Consolidated analysis results
   */
  async processFile(fileId, userEmail, analysisTypes = ['links', 'sharing', 'migration'], progressCallback = null) {
    const startTime = Date.now();
    
    try {
      if (progressCallback) {
        progressCallback({ stage: 'cache_check', fileId, userEmail });
      }

      // 1. Check cache first if enabled
      let fileMetadata = null;
      let cachedAnalysis = null;

      if (this.options.enableCaching && this.cache) {
        fileMetadata = await this.cache.getFileMetadata(fileId, userEmail);
        cachedAnalysis = await this.cache.getAnalysis(fileId, userEmail, analysisTypes);
        
        if (cachedAnalysis && !this.cache.isAnalysisStale(cachedAnalysis)) {
          if (progressCallback) {
            progressCallback({ stage: 'cache_hit', fileId, userEmail, analysisTypes });
          }
          return this.enrichAnalysisResult(cachedAnalysis, startTime, true);
        }
      }

      if (progressCallback) {
        progressCallback({ stage: 'metadata_fetch', fileId, userEmail });
      }

      // 2. Fetch fresh metadata if not cached or stale
      if (!fileMetadata || (this.options.enableCaching && this.cache && this.cache.isMetadataStale(fileMetadata))) {
        fileMetadata = await this.fetchFileMetadata(fileId, userEmail);
        
        if (this.options.enableCaching && this.cache && fileMetadata) {
          await this.cache.setFileMetadata(fileId, userEmail, fileMetadata);
        }
      }

      if (!fileMetadata) {
        throw new Error(`Unable to fetch metadata for file ${fileId}`);
      }

      if (progressCallback) {
        progressCallback({ stage: 'analysis_start', fileId, userEmail, analysisTypes });
      }

      // 3. Perform consolidated analysis
      const analysis = await this.orchestrator.analyzeFile(fileMetadata, userEmail, analysisTypes, progressCallback);

      // 4. Cache results if enabled
      if (this.options.enableCaching && this.cache) {
        await this.cache.setAnalysis(
          fileId, 
          userEmail, 
          analysisTypes, 
          analysis, 
          fileMetadata.modifiedTime
        );
      }

      if (progressCallback) {
        progressCallback({ stage: 'analysis_complete', fileId, userEmail, analysisTypes });
      }

      return this.enrichAnalysisResult(analysis, startTime, false);

    } catch (error) {
      if (progressCallback) {
        progressCallback({ stage: 'error', fileId, userEmail, error: error.message });
      }
      
      console.error(`Error processing file ${fileId} for user ${userEmail}: ${error.message}`);
      return {
        fileId,
        userEmail,
        error: error.message,
        timestamp: new Date().toISOString(),
        processingTime: Date.now() - startTime,
        fromCache: false
      };
    }
  }

  /**
   * Process multiple files in batches
   * @param {Array} fileRequests - Array of {fileId, userEmail, analysisTypes}
   * @param {Function} progressCallback - Progress reporting callback
   * @returns {Array} Array of analysis results
   */
  async processFiles(fileRequests, progressCallback = null) {
    const results = [];
    const totalFiles = fileRequests.length;
    let processedCount = 0;

    if (progressCallback) {
      progressCallback({ 
        stage: 'batch_start', 
        total: totalFiles, 
        processed: 0 
      });
    }

    // Process files in batches to avoid overwhelming the API
    for (let i = 0; i < fileRequests.length; i += this.options.batchSize) {
      const batch = fileRequests.slice(i, i + this.options.batchSize);
      
      const batchPromises = batch.map(async (request) => {
        const result = await this.processFile(
          request.fileId, 
          request.userEmail, 
          request.analysisTypes || ['links', 'sharing', 'migration'],
          progressCallback
        );
        
        processedCount++;
        if (progressCallback) {
          progressCallback({
            stage: 'file_complete',
            processed: processedCount,
            total: totalFiles,
            progress: (processedCount / totalFiles) * 100
          });
        }
        
        return result;
      });

      const batchResults = await Promise.allSettled(batchPromises);
      
      // Extract results and handle any failures
      batchResults.forEach((result, index) => {
        if (result.status === 'fulfilled') {
          results.push(result.value);
        } else {
          const request = batch[index];
          results.push({
            fileId: request.fileId,
            userEmail: request.userEmail,
            error: result.reason.message,
            timestamp: new Date().toISOString(),
            fromCache: false
          });
        }
      });

      // Small delay between batches to be nice to the API
      if (i + this.options.batchSize < fileRequests.length) {
        await new Promise(resolve => setTimeout(resolve, 100));
      }
    }

    if (progressCallback) {
      progressCallback({ 
        stage: 'batch_complete', 
        total: totalFiles, 
        processed: processedCount,
        results: results.length
      });
    }

    return results;
  }

  /**
   * Fetch file metadata from Google Drive API
   * @param {string} fileId - Google Drive file ID
   * @param {string} userEmail - User email for authentication
   * @returns {Object} File metadata
   */
  async fetchFileMetadata(fileId, userEmail) {
    try {
      const userAuth = await apiClient.createAuthenticatedClient(userEmail);
      const drive = google.drive({ version: 'v3', auth: userAuth });

      const fields = [
        'id', 'name', 'mimeType', 'owners', 'permissions', 
        'modifiedTime', 'createdTime', 'size', 'parents',
        'webViewLink', 'webContentLink', 'iconLink', 'shared',
        'ownedByMe', 'capabilities', 'properties', 'spaces'
      ].join(',');

      const response = await apiClient.callWithRetry(() =>
        drive.files.get({
          fileId: fileId,
          fields: fields,
          supportsAllDrives: true
        })
      );

      return {
        ...response.data,
        fetchedAt: new Date().toISOString()
      };

    } catch (error) {
      console.error(`Error fetching metadata for file ${fileId}: ${error.message}`);
      throw error;
    }
  }

  /**
   * Process files for a specific user
   * @param {string} userEmail - User email
   * @param {Array} analysisTypes - Types of analysis to perform
   * @param {Object} filters - File filters (type, modified date, etc.)
   * @param {Function} progressCallback - Progress reporting callback
   * @returns {Object} User analysis results
   */
  async processUserFiles(userEmail, analysisTypes = ['links', 'sharing', 'migration'], filters = {}, progressCallback = null) {
    const startTime = Date.now();
    
    try {
      if (progressCallback) {
        progressCallback({ stage: 'user_start', userEmail });
      }

      // Get user's files (from existing user-file-management.js)
      const { listUserFiles } = await import('../user-file-management.js');
      const files = await listUserFiles(userEmail, filters);

      if (progressCallback) {
        progressCallback({ 
          stage: 'files_found', 
          userEmail, 
          fileCount: files.length 
        });
      }

      // Convert files to processing requests
      const fileRequests = files.map(file => ({
        fileId: file.id,
        userEmail: userEmail,
        analysisTypes: analysisTypes
      }));

      // Process all files
      const fileResults = await this.processFiles(fileRequests, (progress) => {
        if (progressCallback) {
          progressCallback({
            ...progress,
            userEmail: userEmail
          });
        }
      });

      // Aggregate results
      const userStats = this.aggregateUserResults(fileResults, userEmail);
      
      // Cache user stats if enabled
      if (this.options.enableCaching && this.cache) {
        await this.cache.setUserStats(userEmail, {
          ...userStats,
          scan_duration_seconds: (Date.now() - startTime) / 1000
        });
      }

      if (progressCallback) {
        progressCallback({ 
          stage: 'user_complete', 
          userEmail, 
          stats: userStats 
        });
      }

      return {
        userEmail,
        timestamp: new Date().toISOString(),
        processingTime: Date.now() - startTime,
        fileResults,
        aggregateStats: userStats
      };

    } catch (error) {
      console.error(`Error processing files for user ${userEmail}: ${error.message}`);
      throw error;
    }
  }

  /**
   * Aggregate analysis results for a user
   * @param {Array} fileResults - Array of file analysis results
   * @param {string} userEmail - User email
   * @returns {Object} Aggregated statistics
   */
  aggregateUserResults(fileResults, userEmail) {
    const stats = {
      user_email: userEmail,
      total_files: fileResults.length,
      files_by_type: {},
      external_shares: 0,
      high_risk_files: 0,
      medium_risk_files: 0,
      low_risk_files: 0,
      files_with_links: 0,
      public_files: 0,
      errors: 0,
      cache_hits: 0
    };

    fileResults.forEach(result => {
      if (result.error) {
        stats.errors++;
        return;
      }

      if (result.fromCache) {
        stats.cache_hits++;
      }

      // Count by file type
      const mimeType = result.fileMetadata?.mimeType || 'unknown';
      const fileType = this.getSimpleFileType(mimeType);
      stats.files_by_type[fileType] = (stats.files_by_type[fileType] || 0) + 1;

      // Count sharing statistics
      if (result.sharingAnalysis) {
        if (result.sharingAnalysis.hasExternalSharing) {
          stats.external_shares++;
        }
        if (result.sharingAnalysis.isPublic) {
          stats.public_files++;
        }
      }

      // Count risk levels
      if (result.overallRisk) {
        switch (result.overallRisk) {
          case 'high':
            stats.high_risk_files++;
            break;
          case 'medium':
            stats.medium_risk_files++;
            break;
          default:
            stats.low_risk_files++;
        }
      }

      // Count files with links
      if (result.linksFound && result.linksFound.length > 0) {
        stats.files_with_links++;
      }
    });

    return stats;
  }

  /**
   * Get simplified file type from MIME type
   * @param {string} mimeType - Google Drive MIME type
   * @returns {string} Simplified file type
   */
  getSimpleFileType(mimeType) {
    if (mimeType.includes('document')) return 'document';
    if (mimeType.includes('spreadsheet')) return 'spreadsheet';
    if (mimeType.includes('presentation')) return 'presentation';
    if (mimeType.includes('folder')) return 'folder';
    if (mimeType.includes('form')) return 'form';
    if (mimeType.includes('drawing')) return 'drawing';
    return 'other';
  }

  /**
   * Enrich analysis result with metadata
   * @param {Object} analysis - Raw analysis result
   * @param {number} startTime - Processing start time
   * @param {boolean} fromCache - Whether result came from cache
   * @returns {Object} Enriched analysis result
   */
  enrichAnalysisResult(analysis, startTime, fromCache) {
    return {
      ...analysis,
      processingTime: Date.now() - startTime,
      fromCache: fromCache,
      timestamp: new Date().toISOString()
    };
  }

  /**
   * Get cache health status
   * @returns {Object} Cache health information
   */
  async getCacheHealth() {
    if (!this.options.enableCaching || !this.cache) {
      return { enabled: false };
    }
    
    return await this.cache.healthCheck();
  }

  /**
   * Clear cache for specific files or users
   * @param {Object} options - Clear options
   * @returns {boolean} Success status
   */
  async clearCache(options = {}) {
    if (!this.options.enableCaching || !this.cache) {
      return false;
    }

    if (options.fileId && options.userEmail) {
      return await this.cache.clearFileCache(options.fileId, options.userEmail);
    }

    // Could add more clearing options here (all cache, user cache, etc.)
    return false;
  }

  /**
   * Close processor and clean up resources
   */
  async close() {
    if (this.cache) {
      await this.cache.close();
    }
  }
}
