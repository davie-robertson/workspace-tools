/**
 * Cloud Run Server
 * Express.js server for hosting the workspace scanning application on Google Cloud Run
 */

import express from 'express';
import compression from 'compression';
import helmet from 'helmet';
import 'dotenv/config';
import { FileProcessor } from '../processing/file-processor.js';
import { EnvironmentConfig } from '../config.js';
import { getAllUsers } from '../user-file-management.js';

const app = express();
const port = process.env.PORT || 8080;

// Security and performance middleware
app.use(helmet());
app.use(compression());
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));

// Initialize environment config
const envConfig = EnvironmentConfig.getInstance();

// Initialize file processor with Cloud Run optimized settings
const fileProcessor = new FileProcessor({
  enableCaching: process.env.ENABLE_CACHING !== 'false',
  batchSize: parseInt(process.env.BATCH_SIZE) || 25, // Smaller batches for Cloud Run
  cache: {
    redis: process.env.REDIS_URL,
    dataset: process.env.CACHE_DATASET || 'workspace_cache',
    metadataTtl: parseInt(process.env.METADATA_TTL) || 3600,
    analysisTtl: parseInt(process.env.ANALYSIS_TTL) || 7200
  }
});

// Store active scanning jobs
const activeJobs = new Map();

// Health check endpoint
app.get('/health', async (req, res) => {
  try {
    const health = {
      status: 'healthy',
      timestamp: new Date().toISOString(),
      version: process.env.npm_package_version || '1.0.0',
      environment: process.env.NODE_ENV || 'development'
    };

    // Check cache health if enabled
    if (process.env.ENABLE_CACHING !== 'false') {
      health.cache = await fileProcessor.getCacheHealth();
    }

    res.json(health);
  } catch (error) {
    res.status(503).json({
      status: 'unhealthy',
      error: error.message,
      timestamp: new Date().toISOString()
    });
  }
});

// Start a comprehensive workspace scan
app.post('/api/scan/workspace', async (req, res) => {
  try {
    const {
      users = null,
      analysisTypes = ['links', 'sharing', 'migration'],
      filters = {},
      jobId = generateJobId()
    } = req.body;

    // Validate request
    if (!Array.isArray(analysisTypes) || analysisTypes.length === 0) {
      return res.status(400).json({
        error: 'analysisTypes must be a non-empty array'
      });
    }

    // Check if job already exists
    if (activeJobs.has(jobId)) {
      return res.status(409).json({
        error: 'Job ID already exists',
        jobId
      });
    }

    // Initialize job tracking
    const job = {
      jobId,
      status: 'starting',
      startTime: new Date(),
      progress: {
        usersTotal: 0,
        usersProcessed: 0,
        filesTotal: 0,
        filesProcessed: 0,
        errors: 0
      },
      results: [],
      errors: []
    };

    activeJobs.set(jobId, job);

    // Start async processing
    processWorkspaceAsync(jobId, users, analysisTypes, filters);

    res.json({
      jobId,
      status: 'started',
      message: 'Workspace scan initiated',
      statusUrl: `/api/scan/status/${jobId}`
    });

  } catch (error) {
    console.error('Error starting workspace scan:', error);
    res.status(500).json({
      error: 'Failed to start workspace scan',
      details: error.message
    });
  }
});

// Scan specific files
app.post('/api/scan/files', async (req, res) => {
  try {
    const {
      fileRequests, // Array of {fileId, userEmail, analysisTypes}
      jobId = generateJobId()
    } = req.body;

    if (!Array.isArray(fileRequests) || fileRequests.length === 0) {
      return res.status(400).json({
        error: 'fileRequests must be a non-empty array'
      });
    }

    // Validate file requests
    for (const request of fileRequests) {
      if (!request.fileId || !request.userEmail) {
        return res.status(400).json({
          error: 'Each file request must have fileId and userEmail'
        });
      }
    }

    // Initialize job
    const job = {
      jobId,
      status: 'processing',
      startTime: new Date(),
      progress: {
        filesTotal: fileRequests.length,
        filesProcessed: 0,
        errors: 0
      },
      results: [],
      errors: []
    };

    activeJobs.set(jobId, job);

    // Process files
    const results = await fileProcessor.processFiles(fileRequests, (progress) => {
      updateJobProgress(jobId, progress);
    });

    // Update job with results
    job.status = 'completed';
    job.endTime = new Date();
    job.results = results;
    job.progress.filesProcessed = results.length;

    res.json({
      jobId,
      status: 'completed',
      results: results.slice(0, 100), // Limit response size
      summary: {
        totalFiles: results.length,
        successful: results.filter(r => !r.error).length,
        errors: results.filter(r => r.error).length,
        fromCache: results.filter(r => r.fromCache).length
      }
    });

  } catch (error) {
    console.error('Error scanning files:', error);
    res.status(500).json({
      error: 'Failed to scan files',
      details: error.message
    });
  }
});

// Get job status
app.get('/api/scan/status/:jobId', (req, res) => {
  const { jobId } = req.params;
  const job = activeJobs.get(jobId);

  if (!job) {
    return res.status(404).json({
      error: 'Job not found',
      jobId
    });
  }

  const response = {
    jobId: job.jobId,
    status: job.status,
    startTime: job.startTime,
    endTime: job.endTime,
    progress: job.progress,
    duration: job.endTime ? 
      job.endTime.getTime() - job.startTime.getTime() : 
      Date.now() - job.startTime.getTime()
  };

  // Include results summary for completed jobs
  if (job.status === 'completed' && job.results) {
    response.summary = {
      totalResults: job.results.length,
      errors: job.errors.length,
      fromCache: job.results.filter(r => r.fromCache).length
    };
  }

  // Include recent errors
  if (job.errors.length > 0) {
    response.recentErrors = job.errors.slice(-5);
  }

  res.json(response);
});

// Get job results (paginated)
app.get('/api/scan/results/:jobId', (req, res) => {
  const { jobId } = req.params;
  const { page = 1, limit = 50 } = req.query;
  
  const job = activeJobs.get(jobId);

  if (!job) {
    return res.status(404).json({
      error: 'Job not found',
      jobId
    });
  }

  if (job.status !== 'completed') {
    return res.status(425).json({
      error: 'Job not completed yet',
      status: job.status
    });
  }

  const startIndex = (parseInt(page) - 1) * parseInt(limit);
  const endIndex = startIndex + parseInt(limit);
  const results = job.results.slice(startIndex, endIndex);

  res.json({
    jobId,
    page: parseInt(page),
    limit: parseInt(limit),
    total: job.results.length,
    results
  });
});

// Get cache statistics
app.get('/api/cache/stats', async (req, res) => {
  try {
    const health = await fileProcessor.getCacheHealth();
    res.json(health);
  } catch (error) {
    res.status(500).json({
      error: 'Failed to get cache stats',
      details: error.message
    });
  }
});

// Clear cache
app.delete('/api/cache', async (req, res) => {
  try {
    const { fileId, userEmail } = req.query;
    
    if (fileId && userEmail) {
      const success = await fileProcessor.clearCache({ fileId, userEmail });
      res.json({ 
        success, 
        message: success ? 'Cache cleared' : 'Cache clear failed'
      });
    } else {
      res.status(400).json({
        error: 'fileId and userEmail required for cache clearing'
      });
    }
  } catch (error) {
    res.status(500).json({
      error: 'Failed to clear cache',
      details: error.message
    });
  }
});

// List all users in the workspace
app.get('/api/users', async (req, res) => {
  try {
    const users = await getAllUsers();
    res.json({
      users: users.map(user => ({
        email: user.primaryEmail,
        name: user.name?.fullName,
        suspended: user.suspended,
        orgPath: user.orgUnitPath
      }))
    });
  } catch (error) {
    res.status(500).json({
      error: 'Failed to get users',
      details: error.message
    });
  }
});

// Error handling middleware
app.use((error, req, res, next) => {
  console.error('Unhandled error:', error);
  res.status(500).json({
    error: 'Internal server error',
    details: process.env.NODE_ENV === 'development' ? error.message : undefined
  });
});

// 404 handler
app.use((req, res) => {
  res.status(404).json({
    error: 'Endpoint not found',
    path: req.path
  });
});

// Async workspace processing function
async function processWorkspaceAsync(jobId, userFilter, analysisTypes, filters) {
  const job = activeJobs.get(jobId);
  if (!job) return;

  try {
    job.status = 'getting_users';
    
    // Get all users or filtered users
    const allUsers = await getAllUsers();
    const usersToProcess = userFilter ? 
      allUsers.filter(user => userFilter.includes(user.primaryEmail)) : 
      allUsers;

    job.progress.usersTotal = usersToProcess.length;
    job.status = 'processing_users';

    // Process each user
    for (const user of usersToProcess) {
      if (job.status === 'cancelled') break;

      try {
        const userResults = await fileProcessor.processUserFiles(
          user.primaryEmail,
          analysisTypes,
          filters,
          (progress) => updateJobProgress(jobId, progress)
        );

        job.results.push(userResults);
        job.progress.usersProcessed++;

      } catch (error) {
        console.error(`Error processing user ${user.primaryEmail}:`, error);
        job.errors.push({
          type: 'user_processing',
          userEmail: user.primaryEmail,
          error: error.message,
          timestamp: new Date().toISOString()
        });
        job.progress.errors++;
      }
    }

    job.status = 'completed';
    job.endTime = new Date();

  } catch (error) {
    console.error(`Job ${jobId} failed:`, error);
    job.status = 'failed';
    job.endTime = new Date();
    job.errors.push({
      type: 'job_failure',
      error: error.message,
      timestamp: new Date().toISOString()
    });
  }
}

// Update job progress
function updateJobProgress(jobId, progress) {
  const job = activeJobs.get(jobId);
  if (!job) return;

  if (progress.total) {
    job.progress.filesTotal = progress.total;
  }
  if (progress.processed) {
    job.progress.filesProcessed = progress.processed;
  }
  if (progress.stage === 'error') {
    job.progress.errors++;
  }
}

// Generate unique job ID
function generateJobId() {
  return `job_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
}

// Graceful shutdown
process.on('SIGTERM', async () => {
  console.log('SIGTERM received, shutting down gracefully');
  
  // Close file processor and cache connections
  await fileProcessor.close();
  
  process.exit(0);
});

// Start server
app.listen(port, () => {
  console.log(`Workspace Tools Server running on port ${port}`);
  console.log(`Environment: ${process.env.NODE_ENV || 'development'}`);
  console.log(`Caching enabled: ${process.env.ENABLE_CACHING !== 'false'}`);
});

export default app;
