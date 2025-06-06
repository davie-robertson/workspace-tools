/**
 * Streaming Logger for Google Workspace Scanner
 * Streams scan data and progress to separate log files during scanning
 */

import fs from 'fs';
import path from 'path';

export class StreamingLogger {
  constructor(outputPath = './') {
    this.outputPath = outputPath;
    this.scanLogPath = path.join(outputPath, 'scan-log.jsonl');
    this.summaryLogPath = path.join(outputPath, 'summary-log.jsonl');
    this.startTime = new Date();
    
    // Don't initialise files automatically - wait for explicit call
  }

  initialiseLogFiles() {
    // Clear existing log files or create new ones
    try {
      fs.writeFileSync(this.scanLogPath, '');
      fs.writeFileSync(this.summaryLogPath, '');
      
      // Write initial summary entry
      this.logSummary({
        type: 'scan_started',
        timestamp: this.startTime.toISOString(),
        message: 'Google Workspace scan initiated'
      });
      
      console.log(`Streaming logs initialised:`);
      console.log(`  Scan log: ${this.scanLogPath}`);
      console.log(`  Summary log: ${this.summaryLogPath}`);
      
    } catch (error) {
      console.error('Failed to initialise log files:', error.message);
      throw error;
    }
  }

  // Log individual file data (JSONL format - one JSON object per line)
  logFile(fileData) {
    try {
      const logEntry = {
        timestamp: new Date().toISOString(),
        type: 'file_processed',
        data: fileData
      };
      
      fs.appendFileSync(this.scanLogPath, JSON.stringify(logEntry) + '\n');
    } catch (error) {
      console.error('Failed to write to scan log:', error.message);
    }
  }

  // Log summary information and progress updates
  logSummary(summaryData) {
    try {
      const logEntry = {
        timestamp: new Date().toISOString(),
        ...summaryData
      };
      
      fs.appendFileSync(this.summaryLogPath, JSON.stringify(logEntry) + '\n');
    } catch (error) {
      console.error('Failed to write to summary log:', error.message);
    }
  }

  // Log user processing start
  logUserStart(userEmail, userIndex, totalUsers) {
    this.logSummary({
      type: 'user_processing_started',
      user: userEmail,
      progress: `${userIndex + 1}/${totalUsers}`,
      message: `Started processing user: ${userEmail}`
    });
  }

  // Log user processing completion with stats
  logUserComplete(userEmail, userStats) {
    this.logSummary({
      type: 'user_processing_completed',
      user: userEmail,
      stats: userStats,
      message: `Completed processing user: ${userEmail}`
    });
  }

  // Log quota information
  logQuota(userEmail, quotaData) {
    this.logSummary({
      type: 'quota_collected',
      user: userEmail,
      quota: quotaData,
      message: `Collected quota data for: ${userEmail}`
    });
  }

  // Log calendar analysis data
  logCalendar(calendarData) {
    try {
      const logEntry = {
        timestamp: new Date().toISOString(),
        type: 'calendar_analysis',
        data: calendarData
      };
      
      fs.appendFileSync(this.scanLogPath, JSON.stringify(logEntry) + '\n');
    } catch (error) {
      console.error('Failed to log calendar data:', error.message);
    }
  }

  // Log migration summary data
  logMigrationSummary(summaryData) {
    try {
      const logEntry = {
        timestamp: new Date().toISOString(),
        type: 'migration_summary',
        data: summaryData
      };
      
      fs.appendFileSync(this.summaryLogPath, JSON.stringify(logEntry) + '\n');
    } catch (error) {
      console.error('Failed to log migration summary:', error.message);
    }
  }

  // Log Drive analysis summary
  logDriveSummary(userEmail, driveSummary) {
    try {
      const logEntry = {
        timestamp: new Date().toISOString(),
        type: 'drive_summary',
        userEmail: userEmail,
        data: driveSummary
      };
      
      fs.appendFileSync(this.summaryLogPath, JSON.stringify(logEntry) + '\n');
    } catch (error) {
      console.error('Failed to log drive summary:', error.message);
    }
  }

  // Log individual Drive analysis
  logDriveAnalysis(userEmail, driveAnalysis) {
    try {
      const logEntry = {
        timestamp: new Date().toISOString(),
        type: 'drive_analysis',
        userEmail: userEmail,
        data: driveAnalysis
      };
      
      fs.appendFileSync(this.summaryLogPath, JSON.stringify(logEntry) + '\n');
    } catch (error) {
      console.error('Failed to log drive analysis:', error.message);
    }
  }

  // Log Drive analysis events
  logDriveEvent(userEmail, driveEvent) {
    try {
      const logEntry = {
        timestamp: new Date().toISOString(),
        type: 'drive_event',
        user: userEmail,
        data: driveEvent
      };
      
      fs.appendFileSync(this.scanLogPath, JSON.stringify(logEntry) + '\n');
    } catch (error) {
      console.error('Failed to log drive event:', error.message);
    }
  }

  // Log external sharing events with document details
  logExternalSharingEvent(userEmail, shareEvent) {
    try {
      const logEntry = {
        timestamp: new Date().toISOString(),
        type: 'external_sharing_event',
        user: userEmail,
        data: shareEvent
      };
      
      fs.appendFileSync(this.scanLogPath, JSON.stringify(logEntry) + '\n');
    } catch (error) {
      console.error('Failed to log external sharing event:', error.message);
    }
  }

  // Log Shared Drive events
  logSharedDriveEvent(userEmail, sharedDriveEvent) {
    try {
      const logEntry = {
        timestamp: new Date().toISOString(),
        type: 'shared_drive_event',
        user: userEmail,
        data: sharedDriveEvent
      };
      
      fs.appendFileSync(this.scanLogPath, JSON.stringify(logEntry) + '\n');
    } catch (error) {
      console.error('Failed to log shared drive event:', error.message);
    }
  }

  // Log scan completion
  logScanComplete(totalStats, userStats, scanDuration) {
    this.logSummary({
      type: 'scan_completed',
      duration_seconds: scanDuration,
      total_stats: totalStats,
      user_count: Object.keys(userStats).length,
      message: 'Google Workspace scan completed'
    });
  }

  // Log errors
  logError(error, context = '') {
    this.logSummary({
      type: 'error',
      error: error.message,
      context: context,
      stack: error.stack
    });
  }

  // Generate final consolidated JSON from log files
  generateConsolidatedJSON(outputFilePath) {
    try {
      console.log('Generating consolidated JSON from logs...');
      
      // Read all file entries from scan log
      const scanLogContent = fs.readFileSync(this.scanLogPath, 'utf8');
      const scanLines = scanLogContent.trim().split('\n').filter(line => line);
      
      // Read summary entries
      const summaryLogContent = fs.readFileSync(this.summaryLogPath, 'utf8');
      const summaryLines = summaryLogContent.trim().split('\n').filter(line => line);
      
      // Extract file data
      const files = [];
      const userStats = {};
      const driveAnalysisResults = [];
      let totalStats = {};
      let scanStartTime = null;
      let scanEndTime = null;
      
      // Process scan log
      scanLines.forEach(line => {
        try {
          const entry = JSON.parse(line);
          if (entry.type === 'file_processed') {
            files.push(entry.data);
          } else if (entry.type === 'drive_analysis') {
            driveAnalysisResults.push(entry.data);
          }
        } catch (e) {
          console.warn('Skipped malformed scan log entry:', e.message);
        }
      });
      
      // Process summary log
      summaryLines.forEach(line => {
        try {
          const entry = JSON.parse(line);
          
          if (entry.type === 'scan_started') {
            scanStartTime = entry.timestamp;
          } else if (entry.type === 'scan_completed') {
            scanEndTime = entry.timestamp;
            totalStats = entry.total_stats || {};
          } else if (entry.type === 'user_processing_completed') {
            userStats[entry.user] = entry.stats;
          }
        } catch (e) {
          console.warn('Skipped malformed summary log entry:', e.message);
        }
      });
      
      // Create consolidated JSON structure
      const consolidatedData = {
        summary: {
          generationDate: scanEndTime || new Date().toISOString(),
          scanStartTime: scanStartTime,
          scanEndTime: scanEndTime,
          totalStats: totalStats,
          userStats: userStats
        },
        files: files
      };

      // Add Drive analysis data if available
      if (driveAnalysisResults.length > 0) {
        consolidatedData.driveAnalysis = driveAnalysisResults;
        
        // Add global Drive summary
        consolidatedData.summary.driveAnalysisSummary = {
          totalUsersAnalysed: driveAnalysisResults.length,
          totalSharedDrives: driveAnalysisResults.reduce((sum, result) => sum + result.summary.totalSharedDrives, 0),
          totalExternalUsers: [...new Set(driveAnalysisResults.flatMap(result => result.externalUsers || []))].length,
          totalOrphanedFiles: driveAnalysisResults.reduce((sum, result) => sum + result.summary.totalOrphanedFiles, 0),
          usersWithExternalSharing: driveAnalysisResults.filter(result => result.summary.hasExternalSharing).length,
          highRiskUsers: driveAnalysisResults.filter(result => result.summary.riskLevel === 'high').length,
          mediumRiskUsers: driveAnalysisResults.filter(result => result.summary.riskLevel === 'medium').length,
          lowRiskUsers: driveAnalysisResults.filter(result => result.summary.riskLevel === 'low').length
        };
      }
      
      // Write consolidated JSON
      fs.writeFileSync(outputFilePath, JSON.stringify(consolidatedData, null, 2));
      console.log(`Consolidated JSON written to: ${outputFilePath}`);
      
      return consolidatedData;
      
    } catch (error) {
      console.error('Failed to generate consolidated JSON:', error.message);
      throw error;
    }
  }

  // Get current log file sizes for monitoring
  getLogStats() {
    try {
      const scanLogStats = fs.statSync(this.scanLogPath);
      const summaryLogStats = fs.statSync(this.summaryLogPath);
      
      return {
        scanLogSize: scanLogStats.size,
        summaryLogSize: summaryLogStats.size,
        scanLogSizeFormatted: this.formatBytes(scanLogStats.size),
        summaryLogSizeFormatted: this.formatBytes(summaryLogStats.size)
      };
    } catch (error) {
      return {
        scanLogSize: 0,
        summaryLogSize: 0,
        scanLogSizeFormatted: '0 Bytes',
        summaryLogSizeFormatted: '0 Bytes'
      };
    }
  }

  formatBytes(bytes) {
    if (bytes === 0) return '0 Bytes';
    const k = 1024;
    const sizes = ['Bytes', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
  }
}

// Create default instance for easy importing - but don't initialise files yet
export const streamingLogger = new StreamingLogger();

// Function to initialise streaming logs when actually needed
export function initialiseStreamingLogs() {
  // Always clear and reinitialise log files for a fresh scan
  streamingLogger.initialiseLogFiles();
}
