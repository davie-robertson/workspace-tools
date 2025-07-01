/**
 * Analysis Orchestrator
 * Consolidates different types of analysis (links, sharing, migration) into a single workflow
 */

import { 
  findLinksInDoc, 
  findLinksInSheet, 
  findLinksInSlide,
  analyseFileSharing,
  analyseFileLocation 
} from '../file-scanners.js';
import { google } from 'googleapis';
import { apiClient } from '../api-client.js';
import { EnvironmentConfig } from '../config.js';

export class AnalysisOrchestrator {
  constructor(options = {}) {
    this.options = {
      enableLinkAnalysis: options.enableLinkAnalysis !== false,
      enableSharingAnalysis: options.enableSharingAnalysis !== false,
      enableMigrationAnalysis: options.enableMigrationAnalysis !== false,
      enableLocationAnalysis: options.enableLocationAnalysis !== false,
      maxRetries: options.maxRetries || 3,
      ...options
    };
    
    this.envConfig = EnvironmentConfig.getInstance();
  }

  /**
   * Perform consolidated analysis on a file
   * @param {Object} fileMetadata - Google Drive file metadata
   * @param {string} userEmail - User email for authentication
   * @param {Array} analysisTypes - Types of analysis to perform
   * @param {Function} progressCallback - Progress reporting callback
   * @returns {Object} Consolidated analysis results
   */
  async analyzeFile(fileMetadata, userEmail, analysisTypes = ['links', 'sharing', 'migration'], progressCallback = null) {
    const analysis = {
      fileId: fileMetadata.id,
      fileName: fileMetadata.name,
      fileType: fileMetadata.mimeType,
      userEmail: userEmail,
      fileMetadata: fileMetadata,
      linksFound: [],
      sharingAnalysis: null,
      migrationAnalysis: null,
      locationAnalysis: null,
      overallRisk: 'low',
      analysisTypes: analysisTypes,
      errors: []
    };

    try {
      // Create authenticated clients once for all analyses
      const userAuth = await apiClient.createAuthenticatedClient(userEmail);
      const drive = google.drive({ version: 'v3', auth: userAuth });

      // Run analyses based on requested types
      const analysisPromises = [];

      if (analysisTypes.includes('links') && this.options.enableLinkAnalysis) {
        analysisPromises.push(
          this.performLinkAnalysis(fileMetadata, userAuth, progressCallback)
            .then(result => ({ type: 'links', result }))
            .catch(error => ({ type: 'links', error: error.message }))
        );
      }

      if (analysisTypes.includes('sharing') && this.options.enableSharingAnalysis) {
        analysisPromises.push(
          this.performSharingAnalysis(fileMetadata, drive, progressCallback)
            .then(result => ({ type: 'sharing', result }))
            .catch(error => ({ type: 'sharing', error: error.message }))
        );
      }

      if (analysisTypes.includes('migration') && this.options.enableMigrationAnalysis) {
        analysisPromises.push(
          this.performMigrationAnalysis(fileMetadata, drive, progressCallback)
            .then(result => ({ type: 'migration', result }))
            .catch(error => ({ type: 'migration', error: error.message }))
        );
      }

      if (analysisTypes.includes('location') && this.options.enableLocationAnalysis) {
        analysisPromises.push(
          this.performLocationAnalysis(fileMetadata, drive, progressCallback)
            .then(result => ({ type: 'location', result }))
            .catch(error => ({ type: 'location', error: error.message }))
        );
      }

      // Wait for all analyses to complete
      const results = await Promise.allSettled(analysisPromises);

      // Process results
      results.forEach(result => {
        if (result.status === 'fulfilled') {
          const { type, result: analysisResult, error } = result.value;
          
          if (error) {
            analysis.errors.push({ type, error });
          } else {
            switch (type) {
              case 'links':
                analysis.linksFound = analysisResult;
                break;
              case 'sharing':
                analysis.sharingAnalysis = analysisResult;
                break;
              case 'migration':
                analysis.migrationAnalysis = analysisResult;
                break;
              case 'location':
                analysis.locationAnalysis = analysisResult;
                break;
            }
          }
        } else {
          analysis.errors.push({ 
            type: 'unknown', 
            error: result.reason.message 
          });
        }
      });

      // Calculate overall risk assessment
      analysis.overallRisk = this.calculateOverallRisk(analysis);

      return analysis;

    } catch (error) {
      console.error(`Error in orchestrated analysis for file ${fileMetadata.id}: ${error.message}`);
      analysis.errors.push({ type: 'orchestration', error: error.message });
      return analysis;
    }
  }

  /**
   * Perform link analysis on a file
   * @param {Object} fileMetadata - File metadata
   * @param {Object} userAuth - Authenticated user client
   * @param {Function} progressCallback - Progress callback
   * @returns {Array} Found links
   */
  async performLinkAnalysis(fileMetadata, userAuth, progressCallback) {
    if (progressCallback) {
      progressCallback({ 
        stage: 'link_analysis_start', 
        fileId: fileMetadata.id 
      });
    }

    const mimeType = fileMetadata.mimeType;
    let links = [];

    try {
      if (mimeType.includes('document')) {
        links = await findLinksInDoc(fileMetadata.id, fileMetadata.owners?.[0]?.emailAddress);
      } else if (mimeType.includes('spreadsheet')) {
        links = await findLinksInSheet(fileMetadata.id, fileMetadata.owners?.[0]?.emailAddress);
      } else if (mimeType.includes('presentation')) {
        links = await findLinksInSlide(fileMetadata.id, fileMetadata.owners?.[0]?.emailAddress);
      }

      if (progressCallback) {
        progressCallback({ 
          stage: 'link_analysis_complete', 
          fileId: fileMetadata.id,
          linksFound: links.length
        });
      }

      return links;

    } catch (error) {
      console.error(`Link analysis error for file ${fileMetadata.id}: ${error.message}`);
      throw error;
    }
  }

  /**
   * Perform sharing analysis on a file
   * @param {Object} fileMetadata - File metadata
   * @param {Object} drive - Google Drive client
   * @param {Function} progressCallback - Progress callback
   * @returns {Object} Sharing analysis results
   */
  async performSharingAnalysis(fileMetadata, drive, progressCallback) {
    if (progressCallback) {
      progressCallback({ 
        stage: 'sharing_analysis_start', 
        fileId: fileMetadata.id 
      });
    }

    try {
      const sharingData = await analyseFileSharing(fileMetadata, drive);
      
      const analysis = {
        ...sharingData,
        isPublic: this.isFilePublic(fileMetadata),
        hasExternalSharing: this.hasExternalSharing(fileMetadata),
        permissionCount: fileMetadata.permissions?.length || 0,
        isShared: fileMetadata.shared || false
      };

      if (progressCallback) {
        progressCallback({ 
          stage: 'sharing_analysis_complete', 
          fileId: fileMetadata.id,
          isPublic: analysis.isPublic,
          hasExternalSharing: analysis.hasExternalSharing
        });
      }

      return analysis;

    } catch (error) {
      console.error(`Sharing analysis error for file ${fileMetadata.id}: ${error.message}`);
      throw error;
    }
  }

  /**
   * Perform migration analysis on a file
   * @param {Object} fileMetadata - File metadata
   * @param {Object} drive - Google Drive client
   * @param {Function} progressCallback - Progress callback
   * @returns {Object} Migration analysis results
   */
  async performMigrationAnalysis(fileMetadata, drive, progressCallback) {
    if (progressCallback) {
      progressCallback({ 
        stage: 'migration_analysis_start', 
        fileId: fileMetadata.id 
      });
    }

    try {
      const analysis = {
        compatibility: this.assessCompatibility(fileMetadata),
        migrationComplexity: 'low',
        potentialIssues: [],
        recommendations: []
      };

      // Check for Google Workspace specific features
      if (fileMetadata.mimeType.includes('spreadsheet')) {
        analysis.potentialIssues.push(...this.identifySheetMigrationIssues(fileMetadata));
      }

      if (fileMetadata.mimeType.includes('document')) {
        analysis.potentialIssues.push(...this.identifyDocMigrationIssues(fileMetadata));
      }

      if (fileMetadata.mimeType.includes('presentation')) {
        analysis.potentialIssues.push(...this.identifyPresentationMigrationIssues(fileMetadata));
      }

      // Assess overall complexity
      analysis.migrationComplexity = this.calculateMigrationComplexity(analysis.potentialIssues);
      
      // Generate recommendations
      analysis.recommendations = this.generateMigrationRecommendations(analysis);

      if (progressCallback) {
        progressCallback({ 
          stage: 'migration_analysis_complete', 
          fileId: fileMetadata.id,
          complexity: analysis.migrationComplexity,
          issueCount: analysis.potentialIssues.length
        });
      }

      return analysis;

    } catch (error) {
      console.error(`Migration analysis error for file ${fileMetadata.id}: ${error.message}`);
      throw error;
    }
  }

  /**
   * Perform location analysis on a file
   * @param {Object} fileMetadata - File metadata
   * @param {Object} drive - Google Drive client
   * @param {Function} progressCallback - Progress callback
   * @returns {Object} Location analysis results
   */
  async performLocationAnalysis(fileMetadata, drive, progressCallback) {
    if (progressCallback) {
      progressCallback({ 
        stage: 'location_analysis_start', 
        fileId: fileMetadata.id 
      });
    }

    try {
      const locationData = await analyseFileLocation(fileMetadata, drive);
      
      const analysis = {
        ...locationData,
        isInSharedDrive: this.isInSharedDrive(fileMetadata),
        parentCount: fileMetadata.parents?.length || 0,
        isOrphaned: this.isOrphaned(fileMetadata)
      };

      if (progressCallback) {
        progressCallback({ 
          stage: 'location_analysis_complete', 
          fileId: fileMetadata.id,
          isInSharedDrive: analysis.isInSharedDrive,
          isOrphaned: analysis.isOrphaned
        });
      }

      return analysis;

    } catch (error) {
      console.error(`Location analysis error for file ${fileMetadata.id}: ${error.message}`);
      throw error;
    }
  }

  /**
   * Calculate overall risk based on all analysis results
   * @param {Object} analysis - Complete analysis object
   * @returns {string} Risk level: 'low', 'medium', 'high'
   */
  calculateOverallRisk(analysis) {
    let riskScore = 0;

    // Sharing risks
    if (analysis.sharingAnalysis) {
      if (analysis.sharingAnalysis.isPublic) riskScore += 3;
      if (analysis.sharingAnalysis.hasExternalSharing) riskScore += 2;
      if (analysis.sharingAnalysis.permissionCount > 10) riskScore += 1;
    }

    // Migration risks
    if (analysis.migrationAnalysis) {
      switch (analysis.migrationAnalysis.migrationComplexity) {
        case 'high': riskScore += 3; break;
        case 'medium': riskScore += 2; break;
        case 'low': riskScore += 1; break;
      }
      
      if (analysis.migrationAnalysis.potentialIssues.length > 5) riskScore += 1;
    }

    // Link risks
    if (analysis.linksFound && analysis.linksFound.length > 0) {
      const externalLinks = analysis.linksFound.filter(link => 
        !link.includes(this.envConfig.primaryDomain)
      );
      if (externalLinks.length > 0) riskScore += 1;
      if (analysis.linksFound.length > 20) riskScore += 1;
    }

    // Location risks
    if (analysis.locationAnalysis) {
      if (analysis.locationAnalysis.isOrphaned) riskScore += 2;
    }

    // Error penalty
    if (analysis.errors.length > 0) riskScore += 1;

    // Determine risk level
    if (riskScore >= 6) return 'high';
    if (riskScore >= 3) return 'medium';
    return 'low';
  }

  // Helper methods for analysis

  isFilePublic(fileMetadata) {
    return fileMetadata.permissions?.some(permission => 
      permission.type === 'anyone' || permission.type === 'domain'
    ) || false;
  }

  hasExternalSharing(fileMetadata) {
    const primaryDomain = this.envConfig.primaryDomain;
    return fileMetadata.permissions?.some(permission => 
      permission.emailAddress && 
      !permission.emailAddress.endsWith(`@${primaryDomain}`)
    ) || false;
  }

  isInSharedDrive(fileMetadata) {
    return fileMetadata.spaces?.includes('sharedDrive') || false;
  }

  isOrphaned(fileMetadata) {
    return !fileMetadata.parents || fileMetadata.parents.length === 0;
  }

  assessCompatibility(fileMetadata) {
    const mimeType = fileMetadata.mimeType;
    
    if (mimeType.includes('google')) {
      return {
        platform: 'google-workspace',
        exportable: true,
        nativeSupport: false,
        conversionRequired: true
      };
    }
    
    return {
      platform: 'standard',
      exportable: true,
      nativeSupport: true,
      conversionRequired: false
    };
  }

  identifySheetMigrationIssues(fileMetadata) {
    const issues = [];
    
    // These would need deeper analysis of actual sheet content
    // For now, we identify potential issues based on file properties
    
    if (fileMetadata.mimeType === 'application/vnd.google-apps.spreadsheet') {
      issues.push({
        type: 'google-sheets-functions',
        severity: 'medium',
        description: 'May contain Google Sheets specific functions'
      });
    }
    
    return issues;
  }

  identifyDocMigrationIssues(fileMetadata) {
    const issues = [];
    
    if (fileMetadata.mimeType === 'application/vnd.google-apps.document') {
      issues.push({
        type: 'google-docs-features',
        severity: 'low',
        description: 'May contain Google Docs specific features'
      });
    }
    
    return issues;
  }

  identifyPresentationMigrationIssues(fileMetadata) {
    const issues = [];
    
    if (fileMetadata.mimeType === 'application/vnd.google-apps.presentation') {
      issues.push({
        type: 'google-slides-features',
        severity: 'low',
        description: 'May contain Google Slides specific features'
      });
    }
    
    return issues;
  }

  calculateMigrationComplexity(issues) {
    const highSeverityCount = issues.filter(i => i.severity === 'high').length;
    const mediumSeverityCount = issues.filter(i => i.severity === 'medium').length;
    
    if (highSeverityCount > 0 || mediumSeverityCount > 3) return 'high';
    if (mediumSeverityCount > 0 || issues.length > 5) return 'medium';
    return 'low';
  }

  generateMigrationRecommendations(analysis) {
    const recommendations = [];
    
    if (analysis.migrationComplexity === 'high') {
      recommendations.push('Consider manual review and testing after migration');
    }
    
    if (analysis.potentialIssues.some(i => i.type.includes('functions'))) {
      recommendations.push('Review formulas and functions for compatibility');
    }
    
    return recommendations;
  }
}
