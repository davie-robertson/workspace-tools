/**
 * Migration Analysis Module
 * Provides comprehensive migration analysis functionality following SOLID principles
 */

import { CalendarScanner } from './calendar-scanner.js';
import { analyzeFileSharing, analyzeFileLocation } from './file-scanners.js';
import { getAuthenticatedClientForUser } from './API-Calls.js';
import { google } from 'googleapis';

/**
 * Migration Analyzer class - handles all migration-related analysis
 * Follows Single Responsibility Principle
 */
export class MigrationAnalyzer {
  constructor(options = {}) {
    this.includeCalendars = options.includeCalendars || false;
    this.primaryDomain = process.env.PRIMARY_DOMAIN;
  }

  /**
   * Performs comprehensive migration analysis for a user
   * @param {string} userEmail - User email to analyze
   * @param {Array} files - User's files to analyze
   * @param {Function} streamingLogger - Logger for real-time updates
   * @returns {Object} Complete migration analysis results
   */
  async analyzeUser(userEmail, files, streamingLogger) {
    const results = {
      userEmail,
      fileAnalysis: [],
      calendarAnalysis: null,
      migrationSummary: {
        totalFiles: files.length,
        highRiskFiles: 0,
        mediumRiskFiles: 0,
        lowRiskFiles: 0,
        externalShares: 0,
        publicFiles: 0
      }
    };

    let userDrive = null;
    let userAuth = null;

    try {
      // Create user-specific authenticated clients
      userAuth = await getAuthenticatedClientForUser(userEmail);
      userDrive = google.drive({ version: 'v3', auth: userAuth });

      // Analyze files for migration issues
      console.log(`  Performing migration analysis for ${files.length} files...`);
      for (const file of files) {
        const fileAnalysis = await this.analyzeFile(file, userDrive);
        results.fileAnalysis.push(fileAnalysis);
        this.updateMigrationSummary(results.migrationSummary, fileAnalysis);
      }

      // Perform calendar analysis if enabled
      if (this.includeCalendars) {
        console.log(`  Analyzing calendars for migration planning...`);
        const calendarScanner = new CalendarScanner(userAuth);
        results.calendarAnalysis = await calendarScanner.scanUserCalendars(userEmail);
        
        // Log service availability for migration planning
        if (results.calendarAnalysis.calendarDisabled) {
          console.log(`  Calendar service disabled for ${userEmail} - no calendar migration needed`);
        }
        
        // Log calendar data
        if (streamingLogger) {
          streamingLogger.logCalendar(results.calendarAnalysis);
        }
      }

    } catch (error) {
      console.error(`Error in migration analysis for ${userEmail}: ${error.message}`);
      results.error = error.message;
    }

    return results;
  }

  /**
   * Analyzes a single file for migration issues
   * @param {Object} file - Google Drive file object
   * @param {Object} drive - Google Drive API client
   * @returns {Object} File migration analysis
   */
  async analyzeFile(file, drive) {
    const analysis = {
      fileId: file.id,
      fileName: file.name,
      fileType: file.mimeType,
      sharing: null,
      location: null,
      overallRisk: 'low',
      migrationIssues: []
    };

    try {
      // Analyze sharing permissions
      analysis.sharing = await analyzeFileSharing(file, drive);
      
      // Analyze file location
      analysis.location = await analyzeFileLocation(file, drive);
      
      // Assess overall migration risk
      analysis.overallRisk = this.assessOverallMigrationRisk(
        analysis.sharing, 
        analysis.location, 
        file.mimeType
      );

      // Identify specific migration issues
      analysis.migrationIssues = this.identifyMigrationIssues(analysis);

    } catch (error) {
      console.error(`Error analyzing file ${file.name}: ${error.message}`);
      analysis.error = error.message;
    }

    return analysis;
  }

  /**
   * Assesses overall migration risk for a file
   * @param {Object} sharing - Sharing analysis data
   * @param {Object} location - Location analysis data  
   * @param {string} mimeType - File MIME type
   * @returns {string} Risk level (low, medium, high, critical)
   */
  assessOverallMigrationRisk(sharing, location, mimeType) {
    const risks = [];
    
    // Sharing risks
    if (sharing?.migrationRisk === 'high') risks.push('high');
    else if (sharing?.migrationRisk === 'medium') risks.push('medium');
    
    // Location risks  
    if (location?.migrationComplexity === 'high') risks.push('high');
    else if (location?.migrationComplexity === 'medium') risks.push('medium');
    
    // File type specific risks
    if (mimeType === 'application/vnd.google-apps.spreadsheet') {
      risks.push('medium'); // Sheets often have complex formulas
    }
    
    // Determine overall risk
    if (risks.includes('high')) return 'critical';
    if (risks.filter(r => r === 'medium').length >= 2) return 'high';
    if (risks.includes('medium')) return 'medium';
    return 'low';
  }

  /**
   * Identifies specific migration issues for a file
   * @param {Object} analysis - File analysis data
   * @returns {Array} List of migration issues
   */
  identifyMigrationIssues(analysis) {
    const issues = [];

    if (analysis.sharing?.publicLinks) {
      issues.push('Public sharing will need to be recreated');
    }

    if (analysis.sharing?.externalShares?.length > 0) {
      issues.push(`External shares with ${analysis.sharing.externalShares.length} users`);
    }

    if (analysis.location?.type === 'shared-drive') {
      issues.push('Shared drive content requires coordinated migration');
    }

    if (analysis.location?.isOrphan) {
      issues.push('Orphaned file may be difficult to organize');
    }

    if (analysis.sharing?.domainSharing) {
      issues.push('Domain-wide sharing permissions need review');
    }

    return issues;
  }

  /**
   * Updates migration summary statistics
   * @param {Object} summary - Migration summary object to update
   * @param {Object} fileAnalysis - File analysis data
   */
  updateMigrationSummary(summary, fileAnalysis) {
    switch (fileAnalysis.overallRisk) {
      case 'critical':
      case 'high':
        summary.highRiskFiles++;
        break;
      case 'medium':
        summary.mediumRiskFiles++;
        break;
      default:
        summary.lowRiskFiles++;
    }

    if (fileAnalysis.sharing?.externalShares?.length > 0) {
      summary.externalShares++;
    }

    if (fileAnalysis.sharing?.publicLinks) {
      summary.publicFiles++;
    }
  }

  /**
   * Generates a comprehensive migration report summary
   * @param {Array} userAnalysisResults - Array of user analysis results
   * @returns {Object} Migration report summary
   */
  generateMigrationReport(userAnalysisResults) {
    const report = {
      generatedAt: new Date().toISOString(),
      totalUsers: userAnalysisResults.length,
      totalFiles: 0,
      riskDistribution: {
        low: 0,
        medium: 0,
        high: 0,
        critical: 0
      },
      sharingAnalysis: {
        totalExternalShares: 0,
        totalPublicFiles: 0,
        uniqueExternalDomains: new Set()
      },
      calendarAnalysis: {
        totalUsers: 0,
        totalFutureEvents: 0,
        totalRecurringEvents: 0,
        totalExternalMeetings: 0
      },
      recommendations: []
    };

    // Aggregate data from all users
    for (const userResult of userAnalysisResults) {
      if (userResult.error) continue;

      report.totalFiles += userResult.migrationSummary.totalFiles;
      report.riskDistribution.low += userResult.migrationSummary.lowRiskFiles;
      report.riskDistribution.medium += userResult.migrationSummary.mediumRiskFiles;
      report.riskDistribution.high += userResult.migrationSummary.highRiskFiles;
      
      report.sharingAnalysis.totalExternalShares += userResult.migrationSummary.externalShares;
      report.sharingAnalysis.totalPublicFiles += userResult.migrationSummary.publicFiles;

      // Calendar analysis aggregation
      if (userResult.calendarAnalysis) {
        report.calendarAnalysis.totalUsers++;
        report.calendarAnalysis.totalFutureEvents += userResult.calendarAnalysis.futureEvents.length;
        report.calendarAnalysis.totalRecurringEvents += userResult.calendarAnalysis.recurringEvents.length;
        report.calendarAnalysis.totalExternalMeetings += userResult.calendarAnalysis.externalAttendees.length;

        // Collect external domains
        userResult.calendarAnalysis.futureEvents?.forEach(event => {
          event.externalDomains?.forEach(domain => {
            report.sharingAnalysis.uniqueExternalDomains.add(domain);
          });
        });
      }

      // Collect external domains from file sharing
      userResult.fileAnalysis?.forEach(file => {
        file.sharing?.externalShares?.forEach(share => {
          if (share.domain) {
            report.sharingAnalysis.uniqueExternalDomains.add(share.domain);
          }
        });
      });
    }

    // Convert Set to Array for JSON serialization
    report.sharingAnalysis.uniqueExternalDomains = Array.from(report.sharingAnalysis.uniqueExternalDomains);

    // Generate recommendations
    report.recommendations = this.generateRecommendations(report);

    return report;
  }

  /**
   * Generates migration recommendations based on analysis
   * @param {Object} report - Migration report data
   * @returns {Array} List of recommendations
   */
  generateRecommendations(report) {
    const recommendations = [];

    if (report.riskDistribution.high + report.riskDistribution.critical > report.totalFiles * 0.3) {
      recommendations.push('High-risk file percentage is significant - consider phased migration approach');
    }

    if (report.sharingAnalysis.totalPublicFiles > 50) {
      recommendations.push('Many public files detected - review public sharing policies before migration');
    }

    if (report.sharingAnalysis.uniqueExternalDomains.length > 10) {
      recommendations.push('High number of external domains detected - coordinate with external partners');
    }

    if (report.calendarAnalysis.totalRecurringEvents > 100) {
      recommendations.push('Many recurring events found - plan calendar migration carefully to maintain schedules');
    }

    if (report.calendarAnalysis.totalExternalMeetings > report.calendarAnalysis.totalFutureEvents * 0.5) {
      recommendations.push('High percentage of external meetings - ensure meeting platform compatibility');
    }

    return recommendations;
  }
}

export default MigrationAnalyzer;
