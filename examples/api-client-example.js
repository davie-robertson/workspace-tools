/**
 * Example Client for Workspace Tools API
 * Demonstrates how to use the new Cloud Run API endpoints
 */

class WorkspaceToolsClient {
  constructor(baseUrl) {
    this.baseUrl = baseUrl.replace(/\/$/, ''); // Remove trailing slash
  }

  /**
   * Check service health
   */
  async checkHealth() {
    const response = await fetch(`${this.baseUrl}/health`);
    return await response.json();
  }

  /**
   * Start a comprehensive workspace scan
   */
  async startWorkspaceScan(options = {}) {
    const {
      users = null,
      analysisTypes = ['links', 'sharing', 'migration'],
      filters = {},
      jobId = null
    } = options;

    const response = await fetch(`${this.baseUrl}/api/scan/workspace`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        users,
        analysisTypes,
        filters,
        jobId
      })
    });

    if (!response.ok) {
      throw new Error(`HTTP ${response.status}: ${await response.text()}`);
    }

    return await response.json();
  }

  /**
   * Scan specific files
   */
  async scanFiles(fileRequests, jobId = null) {
    const response = await fetch(`${this.baseUrl}/api/scan/files`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        fileRequests,
        jobId
      })
    });

    if (!response.ok) {
      throw new Error(`HTTP ${response.status}: ${await response.text()}`);
    }

    return await response.json();
  }

  /**
   * Get job status
   */
  async getJobStatus(jobId) {
    const response = await fetch(`${this.baseUrl}/api/scan/status/${jobId}`);
    
    if (!response.ok) {
      throw new Error(`HTTP ${response.status}: ${await response.text()}`);
    }

    return await response.json();
  }

  /**
   * Get job results (paginated)
   */
  async getJobResults(jobId, page = 1, limit = 50) {
    const response = await fetch(
      `${this.baseUrl}/api/scan/results/${jobId}?page=${page}&limit=${limit}`
    );
    
    if (!response.ok) {
      throw new Error(`HTTP ${response.status}: ${await response.text()}`);
    }

    return await response.json();
  }

  /**
   * Wait for job completion with progress updates
   */
  async waitForJob(jobId, onProgress = null, pollInterval = 5000) {
    return new Promise((resolve, reject) => {
      const poll = async () => {
        try {
          const status = await this.getJobStatus(jobId);
          
          if (onProgress) {
            onProgress(status);
          }

          if (status.status === 'completed') {
            resolve(status);
          } else if (status.status === 'failed') {
            reject(new Error(`Job failed: ${status.error || 'Unknown error'}`));
          } else {
            // Job still running, poll again
            setTimeout(poll, pollInterval);
          }
        } catch (error) {
          reject(error);
        }
      };

      poll();
    });
  }

  /**
   * Get all users in the workspace
   */
  async getUsers() {
    const response = await fetch(`${this.baseUrl}/api/users`);
    
    if (!response.ok) {
      throw new Error(`HTTP ${response.status}: ${await response.text()}`);
    }

    return await response.json();
  }

  /**
   * Get cache statistics
   */
  async getCacheStats() {
    const response = await fetch(`${this.baseUrl}/api/cache/stats`);
    
    if (!response.ok) {
      throw new Error(`HTTP ${response.status}: ${await response.text()}`);
    }

    return await response.json();
  }

  /**
   * Clear cache for specific file
   */
  async clearCache(fileId, userEmail) {
    const response = await fetch(
      `${this.baseUrl}/api/cache?fileId=${fileId}&userEmail=${userEmail}`,
      { method: 'DELETE' }
    );
    
    if (!response.ok) {
      throw new Error(`HTTP ${response.status}: ${await response.text()}`);
    }

    return await response.json();
  }
}

// Example usage
async function example() {
  // Initialize client (replace with your Cloud Run service URL)
  const client = new WorkspaceToolsClient('https://your-service-url.run.app');

  try {
    // Check service health
    console.log('Checking service health...');
    const health = await client.checkHealth();
    console.log('Service health:', health);

    // Start a comprehensive workspace scan
    console.log('Starting workspace scan...');
    const scanResult = await client.startWorkspaceScan({
      users: ['user1@domain.com', 'user2@domain.com'], // Optional: specific users
      analysisTypes: ['links', 'sharing', 'migration'],
      filters: {
        fileTypes: ['document', 'spreadsheet'], // Optional: filter by file types
        modifiedAfter: '2024-01-01' // Optional: only recent files
      }
    });

    console.log('Scan started:', scanResult);
    const jobId = scanResult.jobId;

    // Wait for completion with progress updates
    console.log('Waiting for job completion...');
    await client.waitForJob(jobId, (status) => {
      console.log(`Job ${jobId} status:`, status.status);
      if (status.progress) {
        console.log(`Progress: ${status.progress.filesProcessed}/${status.progress.filesTotal} files`);
      }
    });

    // Get results
    console.log('Getting results...');
    const results = await client.getJobResults(jobId, 1, 100);
    console.log(`Got ${results.results.length} results`);

    // Process results
    results.results.forEach(result => {
      if (result.error) {
        console.log(`Error processing ${result.fileId}: ${result.error}`);
      } else {
        console.log(`File: ${result.fileName}`);
        console.log(`  Links found: ${result.linksFound?.length || 0}`);
        console.log(`  Risk level: ${result.overallRisk}`);
        console.log(`  From cache: ${result.fromCache}`);
      }
    });

  } catch (error) {
    console.error('Error:', error.message);
  }
}

// Example: Scan specific files
async function scanSpecificFiles() {
  const client = new WorkspaceToolsClient('https://your-service-url.run.app');

  const fileRequests = [
    {
      fileId: '1BxiMVs0XRA5nFMdKvBdBZjgmUUqptlbs74OgvE2upms',
      userEmail: 'user@domain.com',
      analysisTypes: ['links', 'sharing']
    },
    {
      fileId: '1mMVs0XRA5nFMdKvBdBZjgmUUqptlbs74OgvE2upms2',
      userEmail: 'user@domain.com',
      analysisTypes: ['migration']
    }
  ];

  try {
    const result = await client.scanFiles(fileRequests);
    console.log('Scan completed:', result);
    
    result.results.forEach(fileResult => {
      console.log(`File: ${fileResult.fileName}`);
      console.log(`  Processing time: ${fileResult.processingTime}ms`);
      console.log(`  From cache: ${fileResult.fromCache}`);
    });

  } catch (error) {
    console.error('Error scanning files:', error.message);
  }
}

// Example: Monitor cache performance
async function monitorCache() {
  const client = new WorkspaceToolsClient('https://your-service-url.run.app');

  try {
    const stats = await client.getCacheStats();
    console.log('Cache health:', stats);

    if (stats.redis) {
      console.log('✅ Redis connection healthy');
    } else {
      console.log('❌ Redis connection issue');
    }

    if (stats.bigquery) {
      console.log('✅ BigQuery connection healthy');
    } else {
      console.log('❌ BigQuery connection issue');
    }

  } catch (error) {
    console.error('Error checking cache:', error.message);
  }
}

// Export for use in other modules
if (typeof module !== 'undefined' && module.exports) {
  module.exports = { WorkspaceToolsClient };
}

// Run example if called directly
if (typeof window === 'undefined' && import.meta.url === `file://${process.argv[1]}`) {
  example().catch(console.error);
}
