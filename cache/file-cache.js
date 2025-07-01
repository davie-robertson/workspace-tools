/**
 * File Cache Module
 * Implements Redis + BigQuery caching for Google Workspace file metadata and analysis
 */

import Redis from 'ioredis';
import { BigQuery } from '@google-cloud/bigquery';
import { EnvironmentConfig } from '../config.js';
import crypto from 'crypto';

export class FileCache {
  constructor(options = {}) {
    const envConfig = EnvironmentConfig.getInstance();
    
    // Initialize Redis connection
    this.redis = new Redis(options.redis || process.env.REDIS_URL || {
      host: process.env.REDIS_HOST || 'localhost',
      port: process.env.REDIS_PORT || 6379,
      password: process.env.REDIS_PASSWORD,
      retryDelayOnFailover: 100,
      maxRetriesPerRequest: 3,
      lazyConnect: true
    });

    // Initialize BigQuery
    this.bigquery = new BigQuery({
      projectId: process.env.GOOGLE_CLOUD_PROJECT
    });
    
    // Cache configuration
    this.dataset = options.dataset || process.env.CACHE_DATASET || 'workspace_cache';
    this.metadataTable = 'file_metadata';
    this.analysisTable = 'file_analysis';
    this.userStatsTable = 'user_stats';
    
    // TTL settings
    this.ttl = {
      metadata: options.metadataTtl || 3600, // 1 hour for file metadata
      analysis: options.analysisTtl || 7200, // 2 hours for analysis results
      stats: options.statsTtl || 1800 // 30 minutes for user stats
    };

    // Initialize BigQuery tables
    this.initializeTables();
  }

  /**
   * Initialize BigQuery tables if they don't exist
   */
  async initializeTables() {
    try {
      const dataset = this.bigquery.dataset(this.dataset);
      const [exists] = await dataset.exists();
      
      if (!exists) {
        await dataset.create();
        console.log(`Created BigQuery dataset: ${this.dataset}`);
      }

      // Create metadata table
      await this.createTableIfNotExists(this.metadataTable, {
        file_id: 'STRING',
        name: 'STRING',
        mime_type: 'STRING',
        owners: 'REPEATED JSON',
        permissions: 'REPEATED JSON',
        modified_time: 'TIMESTAMP',
        created_time: 'TIMESTAMP',
        size: 'INTEGER',
        parents: 'REPEATED STRING',
        last_updated: 'TIMESTAMP',
        cache_version: 'STRING',
        user_email: 'STRING'
      });

      // Create analysis table
      await this.createTableIfNotExists(this.analysisTable, {
        analysis_id: 'STRING',
        file_id: 'STRING',
        user_email: 'STRING',
        analysis_types: 'REPEATED STRING',
        links_found: 'REPEATED STRING',
        sharing_analysis: 'JSON',
        migration_analysis: 'JSON',
        risk_level: 'STRING',
        external_shares: 'INTEGER',
        created_at: 'TIMESTAMP',
        file_modified_time: 'TIMESTAMP',
        cache_version: 'STRING'
      });

      // Create user stats table
      await this.createTableIfNotExists(this.userStatsTable, {
        user_email: 'STRING',
        total_files: 'INTEGER',
        files_by_type: 'JSON',
        external_shares: 'INTEGER',
        high_risk_files: 'INTEGER',
        last_scan: 'TIMESTAMP',
        scan_duration_seconds: 'FLOAT'
      });

    } catch (error) {
      console.warn(`BigQuery initialization warning: ${error.message}`);
    }
  }

  /**
   * Create BigQuery table if it doesn't exist
   */
  async createTableIfNotExists(tableName, schema) {
    try {
      const table = this.bigquery.dataset(this.dataset).table(tableName);
      const [exists] = await table.exists();
      
      if (!exists) {
        const options = {
          schema: Object.entries(schema).map(([name, type]) => {
            if (type.includes('REPEATED')) {
              const baseType = type.replace('REPEATED ', '');
              return {
                name,
                type: baseType,
                mode: 'REPEATED'
              };
            } else {
              return {
                name,
                type: type,
                mode: 'NULLABLE'
              };
            }
          })
        };
        
        await table.create(options);
        console.log(`Created BigQuery table: ${tableName}`);
      }
    } catch (error) {
      console.warn(`Error creating table ${tableName}: ${error.message}`);
    }
  }

  /**
   * Get file metadata from cache
   */
  async getFileMetadata(fileId, userEmail) {
    try {
      // Try Redis first (fast)
      const redisKey = `file:${fileId}:${userEmail}`;
      const cached = await this.redis.get(redisKey);
      
      if (cached) {
        const metadata = JSON.parse(cached);
        if (!this.isMetadataStale(metadata)) {
          return metadata;
        }
      }

      // Fall back to BigQuery (persistent)
      const query = `
        SELECT * FROM \`${this.dataset}.${this.metadataTable}\`
        WHERE file_id = @fileId AND user_email = @userEmail
        ORDER BY last_updated DESC
        LIMIT 1
      `;
      
      const [rows] = await this.bigquery.query({
        query,
        params: { fileId, userEmail }
      });

      if (rows.length > 0) {
        const metadata = rows[0];
        
        // Check if BigQuery data is stale
        if (!this.isMetadataStale(metadata)) {
          // Cache in Redis for future fast access
          await this.redis.setex(redisKey, this.ttl.metadata, JSON.stringify(metadata));
          return metadata;
        }
      }

      return null;
    } catch (error) {
      console.warn(`Cache lookup error for file ${fileId}: ${error.message}`);
      return null;
    }
  }

  /**
   * Store file metadata in cache
   */
  async setFileMetadata(fileId, userEmail, metadata) {
    try {
      const enrichedMetadata = {
        ...metadata,
        file_id: fileId,
        user_email: userEmail,
        last_updated: new Date(),
        cache_version: '2.0'
      };

      const redisKey = `file:${fileId}:${userEmail}`;

      // Store in both Redis and BigQuery
      await Promise.all([
        this.redis.setex(redisKey, this.ttl.metadata, JSON.stringify(enrichedMetadata)),
        this.insertToBigQuery(this.metadataTable, enrichedMetadata)
      ]);

      return true;
    } catch (error) {
      console.warn(`Cache store error for file ${fileId}: ${error.message}`);
      return false;
    }
  }

  /**
   * Get analysis results from cache
   */
  async getAnalysis(fileId, userEmail, analysisTypes) {
    try {
      const cacheKey = this.generateAnalysisCacheKey(fileId, userEmail, analysisTypes);
      
      // Try Redis first
      const cached = await this.redis.get(`analysis:${cacheKey}`);
      if (cached) {
        const analysis = JSON.parse(cached);
        if (!this.isAnalysisStale(analysis)) {
          return analysis;
        }
      }

      // Try BigQuery
      const query = `
        SELECT * FROM \`${this.dataset}.${this.analysisTable}\`
        WHERE analysis_id = @analysisId
        ORDER BY created_at DESC
        LIMIT 1
      `;
      
      const [rows] = await this.bigquery.query({
        query,
        params: { analysisId: cacheKey }
      });

      if (rows.length > 0) {
        const analysis = rows[0];
        if (!this.isAnalysisStale(analysis)) {
          // Cache in Redis
          await this.redis.setex(`analysis:${cacheKey}`, this.ttl.analysis, JSON.stringify(analysis));
          return analysis;
        }
      }

      return null;
    } catch (error) {
      console.warn(`Analysis cache lookup error: ${error.message}`);
      return null;
    }
  }

  /**
   * Store analysis results in cache
   */
  async setAnalysis(fileId, userEmail, analysisTypes, analysis, fileModifiedTime) {
    try {
      const cacheKey = this.generateAnalysisCacheKey(fileId, userEmail, analysisTypes);
      
      const enrichedAnalysis = {
        analysis_id: cacheKey,
        file_id: fileId,
        user_email: userEmail,
        analysis_types: analysisTypes,
        ...analysis,
        created_at: new Date(),
        file_modified_time: fileModifiedTime,
        cache_version: '2.0'
      };

      // Store in both Redis and BigQuery
      await Promise.all([
        this.redis.setex(`analysis:${cacheKey}`, this.ttl.analysis, JSON.stringify(enrichedAnalysis)),
        this.insertToBigQuery(this.analysisTable, enrichedAnalysis)
      ]);

      return true;
    } catch (error) {
      console.warn(`Analysis cache store error: ${error.message}`);
      return false;
    }
  }

  /**
   * Generate consistent cache key for analysis
   */
  generateAnalysisCacheKey(fileId, userEmail, analysisTypes) {
    const sortedTypes = Array.isArray(analysisTypes) ? analysisTypes.sort() : [analysisTypes];
    const keyString = `${fileId}:${userEmail}:${sortedTypes.join(',')}`;
    return crypto.createHash('sha256').update(keyString).digest('hex').substring(0, 16);
  }

  /**
   * Check if metadata is stale (older than 24 hours or file was modified after cache)
   */
  isMetadataStale(metadata) {
    if (!metadata || !metadata.last_updated) return true;
    
    const cacheAge = Date.now() - new Date(metadata.last_updated).getTime();
    const maxAge = 24 * 60 * 60 * 1000; // 24 hours
    
    return cacheAge > maxAge;
  }

  /**
   * Check if analysis is stale
   */
  isAnalysisStale(analysis) {
    if (!analysis || !analysis.created_at) return true;
    
    const cacheAge = Date.now() - new Date(analysis.created_at).getTime();
    const maxAge = 48 * 60 * 60 * 1000; // 48 hours
    
    // Also check if file was modified after analysis
    if (analysis.file_modified_time && analysis.created_at) {
      const fileModified = new Date(analysis.file_modified_time);
      const analysisCreated = new Date(analysis.created_at);
      if (fileModified > analysisCreated) {
        return true;
      }
    }
    
    return cacheAge > maxAge;
  }

  /**
   * Insert data into BigQuery table
   */
  async insertToBigQuery(tableName, data) {
    try {
      // Check if BigQuery caching is enabled
      if (process.env.ENABLE_BIGQUERY_CACHE === 'false') {
        return true; // Skip BigQuery insert but return success
      }

      const table = this.bigquery.dataset(this.dataset).table(tableName);
      
      // Use insertAll with rows instead of streaming insert for free tier compatibility
      const rows = [{
        insertId: `${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
        json: data
      }];
      
      await table.insert(rows, {
        ignoreUnknownValues: true,
        skipInvalidRows: false
      });
      
      return true;
    } catch (error) {
      // If it's a streaming insert error, log but don't fail the operation
      if (error.message && error.message.includes('Streaming insert is not allowed in the free tier')) {
        console.warn(`BigQuery free tier limitation: ${tableName} data cached in Redis only`);
        return true;
      }
      console.warn(`BigQuery insert error for ${tableName}: ${error.message}`);
      return false;
    }
  }

  /**
   * Get user statistics from cache
   */
  async getUserStats(userEmail) {
    try {
      const redisKey = `stats:${userEmail}`;
      const cached = await this.redis.get(redisKey);
      
      if (cached) {
        return JSON.parse(cached);
      }

      // Try BigQuery
      const query = `
        SELECT * FROM \`${this.dataset}.${this.userStatsTable}\`
        WHERE user_email = @userEmail
        ORDER BY last_scan DESC
        LIMIT 1
      `;
      
      const [rows] = await this.bigquery.query({
        query,
        params: { userEmail }
      });

      if (rows.length > 0) {
        const stats = rows[0];
        await this.redis.setex(redisKey, this.ttl.stats, JSON.stringify(stats));
        return stats;
      }

      return null;
    } catch (error) {
      console.warn(`User stats cache error: ${error.message}`);
      return null;
    }
  }

  /**
   * Set user statistics in cache
   */
  async setUserStats(userEmail, stats) {
    try {
      const enrichedStats = {
        user_email: userEmail,
        last_scan: new Date(),
        ...stats
      };

      const redisKey = `stats:${userEmail}`;

      await Promise.all([
        this.redis.setex(redisKey, this.ttl.stats, JSON.stringify(enrichedStats)),
        this.insertToBigQuery(this.userStatsTable, enrichedStats)
      ]);

      return true;
    } catch (error) {
      console.warn(`User stats cache store error: ${error.message}`);
      return false;
    }
  }

  /**
   * Clear cache for a specific file
   */
  async clearFileCache(fileId, userEmail) {
    try {
      const redisKey = `file:${fileId}:${userEmail}`;
      await this.redis.del(redisKey);
      
      // Also clear any analysis cache entries for this file
      const pattern = `analysis:*${fileId}*`;
      const keys = await this.redis.keys(pattern);
      if (keys.length > 0) {
        await this.redis.del(...keys);
      }
      
      return true;
    } catch (error) {
      console.warn(`Cache clear error: ${error.message}`);
      return false;
    }
  }

  /**
   * Health check for cache connections
   */
  async healthCheck() {
    const health = {
      redis: false,
      bigquery: false,
      timestamp: new Date().toISOString()
    };

    try {
      await this.redis.ping();
      health.redis = true;
    } catch (error) {
      console.warn(`Redis health check failed: ${error.message}`);
    }

    try {
      await this.bigquery.query('SELECT 1');
      health.bigquery = true;
    } catch (error) {
      console.warn(`BigQuery health check failed: ${error.message}`);
    }

    return health;
  }

  /**
   * Close cache connections
   */
  async close() {
    try {
      await this.redis.quit();
    } catch (error) {
      console.warn(`Error closing Redis connection: ${error.message}`);
    }
  }
}
