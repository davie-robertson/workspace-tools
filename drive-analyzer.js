/**
 * Drive Analyzer Module
 * Provides comprehensive analysis of Google Drives including My Drive and Shared Drives
 */

import { google } from 'googleapis';
import { callWithRetry, getAuthenticatedClientForUser } from './API-Calls.js';

/**
 * Drive Analyzer class - handles comprehensive Drive analysis
 * Follows Single Responsibility Principle for Drive-specific analysis
 */
export class DriveAnalyzer {
  constructor(options = {}) {
    this.options = {
      includeDriveDetails: true,
      includeSharedDrives: true,
      includeMembers: true,
      includeExternalSharing: true,
      ...options
    };
    this.primaryDomain = process.env.PRIMARY_DOMAIN;
  }

  /**
   * Performs comprehensive Drive analysis for a user
   * @param {string} userEmail - User email to analyze
   * @param {Function} streamingLogger - Logger for real-time updates
   * @returns {Object} Complete Drive analysis results
   */
  async analyzeUserDrives(userEmail, streamingLogger) {
    // Store streaming logger for use in analysis methods
    this.streamingLogger = streamingLogger;
    
    const analysis = {
      userEmail,
      timestamp: new Date().toISOString(),
      myDrive: null,
      sharedDrives: [],
      externalUsers: new Set(),
      orphanedFiles: [],
      summary: {
        totalSharedDrives: 0,
        totalExternalUsers: 0,
        totalOrphanedFiles: 0,
        hasExternalSharing: false,
        riskLevel: 'low'
      }
    };

    try {
      const userAuthClient = await getAuthenticatedClientForUser(userEmail);
      const drive = google.drive({ version: 'v3', auth: userAuthClient });

      // Stream drive analysis start
      if (streamingLogger) {
        streamingLogger.logDriveEvent(userEmail, {
          type: 'drive_analysis_started',
          includeSharedDrives: this.options.includeSharedDrives,
          includeMembers: this.options.includeMembers
        });
      }

      // Analyze My Drive
      analysis.myDrive = await this.analyzeMyDrive(userEmail, drive);
      
      // Analyze Shared Drives
      if (this.options.includeSharedDrives) {
        analysis.sharedDrives = await this.analyzeSharedDrives(userEmail, drive);
        analysis.summary.totalSharedDrives = analysis.sharedDrives.length;
      }

      // Find orphaned files
      analysis.orphanedFiles = await this.findOrphanedFiles(userEmail, drive);
      analysis.summary.totalOrphanedFiles = analysis.orphanedFiles.length;

      // Collect all external users from My Drive and Shared Drives
      if (analysis.myDrive?.externalUsers) {
        analysis.myDrive.externalUsers.forEach(user => analysis.externalUsers.add(user));
      }
      
      // Collect all external share details from My Drive and Shared Drives
      analysis.externalShareDetails = [];
      if (analysis.myDrive?.externalShareDetails) {
        analysis.externalShareDetails.push(...analysis.myDrive.externalShareDetails);
      }
      
      analysis.sharedDrives.forEach(sharedDrive => {
        if (sharedDrive.externalUsers) {
          sharedDrive.externalUsers.forEach(user => analysis.externalUsers.add(user));
        }
        if (sharedDrive.externalShareDetails) {
          analysis.externalShareDetails.push(...sharedDrive.externalShareDetails);
        }
      });

      analysis.summary.totalExternalUsers = analysis.externalUsers.size;
      analysis.summary.hasExternalSharing = analysis.summary.totalExternalUsers > 0;
      analysis.externalUsers = Array.from(analysis.externalUsers); // Convert Set to Array for JSON serialization

      // Assess overall risk
      analysis.summary.riskLevel = this.assessDriveRiskLevel(analysis);

      // Log summary
      if (streamingLogger) {
        streamingLogger.logDriveSummary(userEmail, analysis.summary);
      }

    } catch (error) {
      console.error(`Error analyzing drives for ${userEmail}: ${error.message}`);
      analysis.error = error.message;
    }

    return analysis;
  }

  /**
   * Analyzes user's My Drive
   * @param {string} userEmail - User email
   * @param {Object} drive - Google Drive API client
   * @returns {Object} My Drive analysis
   */
  async analyzeMyDrive(userEmail, drive) {
    const analysis = {
      type: 'my-drive',
      ownerEmail: userEmail,
      totalFiles: 0,
      sharedFiles: 0,
      publicFiles: 0,
      externalShares: 0,
      externalUsers: new Set(),
      externalShareDetails: [], // Array of {documentId, documentName, externalUser, role, permission}
      linkSharingEnabled: false,
      storageUsed: 0,
      lastActivity: null,
      riskLevel: 'low'
    };

    try {
      // Get Drive about information
      const aboutResponse = await callWithRetry(async () => {
        return await drive.about.get({
          fields: 'storageQuota,user'
        });
      });

      if (aboutResponse.data.storageQuota?.usageInDrive) {
        analysis.storageUsed = Math.round(parseInt(aboutResponse.data.storageQuota.usageInDrive) / (1024 * 1024)); // Convert to MB
      }

      // Analyze files in My Drive (non-shared drive files)
      const filesResponse = await callWithRetry(async () => {
        return await drive.files.list({
          q: "trashed = false and 'me' in owners",
          fields: 'files(id,name,mimeType,shared,webViewLink,permissions,modifiedTime)',
          pageSize: 1000,
          supportsAllDrives: false // Only My Drive files
        });
      });

      const files = filesResponse.data.files || [];
      analysis.totalFiles = files.length;

      // Analyze each file for sharing
      for (const file of files) {
        if (file.shared) {
          analysis.sharedFiles++;
          
          // Get detailed permissions for shared files
          try {
            const permissionsResponse = await callWithRetry(async () => {
              return await drive.permissions.list({
                fileId: file.id,
                fields: 'permissions(type,role,emailAddress,domain,allowFileDiscovery)'
              });
            });

            const permissions = permissionsResponse.data.permissions || [];
            
            for (const permission of permissions) {
              if (permission.type === 'anyone') {
                analysis.publicFiles++;
                analysis.linkSharingEnabled = true;
              } else if (permission.emailAddress) {
                const domain = permission.emailAddress.split('@')[1];
                if (domain && domain !== this.primaryDomain) {
                  analysis.externalShares++;
                  analysis.externalUsers.add(permission.emailAddress);
                  
                  // Capture external share details with document information
                  const shareDetail = {
                    documentId: file.id,
                    documentName: file.name,
                    documentType: file.mimeType,
                    externalUser: permission.emailAddress,
                    externalDomain: domain,
                    role: permission.role,
                    permissionType: permission.type
                  };
                  
                  analysis.externalShareDetails.push(shareDetail);
                  
                  // Stream external sharing event in real-time
                  if (this.streamingLogger) {
                    this.streamingLogger.logExternalSharingEvent(userEmail, {
                      ...shareDetail,
                      source: 'My Drive',
                      driveType: 'my-drive'
                    });
                  }
                }
              }
            }
          } catch (permError) {
            console.warn(`Could not analyze permissions for file ${file.id}: ${permError.message}`);
          }
        }

        // Track latest activity
        if (file.modifiedTime) {
          const modifiedDate = new Date(file.modifiedTime);
          if (!analysis.lastActivity || modifiedDate > new Date(analysis.lastActivity)) {
            analysis.lastActivity = file.modifiedTime;
          }
        }
      }

      analysis.externalUsers = Array.from(analysis.externalUsers);
      analysis.riskLevel = this.assessMyDriveRisk(analysis);

    } catch (error) {
      console.error(`Error analyzing My Drive for ${userEmail}: ${error.message}`);
      analysis.error = error.message;
    }

    return analysis;
  }

  /**
   * Analyzes user's accessible Shared Drives
   * @param {string} userEmail - User email
   * @param {Object} drive - Google Drive API client
   * @returns {Array} Array of Shared Drive analyses
   */
  async analyzeSharedDrives(userEmail, drive) {
    const sharedDrives = [];

    try {
      const drivesResponse = await callWithRetry(async () => {
        return await drive.drives.list({
          fields: 'drives(id,name,createdTime,restrictions,capabilities)'
        });
      });

      const drives = drivesResponse.data.drives || [];

      for (const driveInfo of drives) {
        // Stream shared drive analysis start
        if (this.streamingLogger) {
          this.streamingLogger.logSharedDriveEvent(userEmail, {
            type: 'shared_drive_analysis_started',
            driveId: driveInfo.id,
            driveName: driveInfo.name
          });
        }
        
        const analysis = await this.analyzeSharedDrive(userEmail, drive, driveInfo);
        sharedDrives.push(analysis);
        
        // Stream shared drive analysis completion
        if (this.streamingLogger) {
          this.streamingLogger.logSharedDriveEvent(userEmail, {
            type: 'shared_drive_analysis_completed',
            driveId: driveInfo.id,
            driveName: driveInfo.name,
            summary: {
              totalFiles: analysis.totalFiles,
              externalShares: analysis.externalShares,
              externalMembers: analysis.externalMembers,
              riskLevel: analysis.riskLevel
            }
          });
        }
      }

    } catch (error) {
      console.error(`Error listing shared drives for ${userEmail}: ${error.message}`);
    }

    return sharedDrives;
  }

  /**
   * Analyzes a specific Shared Drive
   * @param {string} userEmail - User email
   * @param {Object} drive - Google Drive API client
   * @param {Object} driveInfo - Shared Drive information
   * @returns {Object} Shared Drive analysis
   */
  async analyzeSharedDrive(userEmail, drive, driveInfo) {
    const analysis = {
      type: 'shared-drive',
      id: driveInfo.id,
      name: driveInfo.name,
      createdTime: driveInfo.createdTime,
      userRole: null,
      members: [],
      totalFiles: 0,
      sharedFiles: 0,
      publicFiles: 0,
      externalShares: 0,
      externalMembers: 0,
      externalUsers: new Set(),
      externalShareDetails: [], // Array of {documentId, documentName, externalUser, role, permission}
      restrictions: driveInfo.restrictions || {},
      capabilities: driveInfo.capabilities || {},
      storageUsed: 0,
      riskLevel: 'low'
    };

    try {
      // Get members/permissions for the Shared Drive
      if (this.options.includeMembers) {
        const membersResponse = await callWithRetry(async () => {
          return await drive.permissions.list({
            fileId: driveInfo.id,
            fields: 'permissions(id,type,role,emailAddress,displayName,domain)',
            supportsAllDrives: true
          });
        });

        const members = membersResponse.data.permissions || [];
        
        for (const member of members) {
          const memberInfo = {
            email: member.emailAddress,
            role: member.role,
            displayName: member.displayName,
            type: member.type,
            domain: member.emailAddress?.split('@')[1]
          };

          analysis.members.push(memberInfo);

          // Check if this is the current user
          if (member.emailAddress === userEmail) {
            analysis.userRole = member.role;
          }

          // Check for external members
          if (member.emailAddress && memberInfo.domain !== this.primaryDomain) {
            analysis.externalMembers++;
            analysis.externalUsers.add(member.emailAddress);
          }
        }
      }

      // Analyze files in the Shared Drive
      const filesResponse = await callWithRetry(async () => {
        return await drive.files.list({
          q: `trashed = false and parents in '${driveInfo.id}'`,
          fields: 'files(id,name,mimeType,shared,webViewLink,modifiedTime)',
          pageSize: 1000,
          supportsAllDrives: true,
          includeItemsFromAllDrives: true,
          corpora: 'drive',
          driveId: driveInfo.id
        });
      });

      const files = filesResponse.data.files || [];
      analysis.totalFiles = files.length;

      // Count shared files (files shared beyond the Shared Drive)
      for (const file of files) {
        if (file.shared) {
          analysis.sharedFiles++;
          
          // For shared files, check if they have external sharing
          try {
            const permissionsResponse = await callWithRetry(async () => {
              return await drive.permissions.list({
                fileId: file.id,
                fields: 'permissions(type,role,emailAddress,domain)',
                supportsAllDrives: true
              });
            });

            const permissions = permissionsResponse.data.permissions || [];
            
            for (const permission of permissions) {
              if (permission.type === 'anyone') {
                analysis.publicFiles++;
              } else if (permission.emailAddress) {
                const domain = permission.emailAddress.split('@')[1];
                if (domain && domain !== this.primaryDomain) {
                  analysis.externalShares++;
                  analysis.externalUsers.add(permission.emailAddress);
                  
                  // Capture external share details with document information
                  const shareDetail = {
                    documentId: file.id,
                    documentName: file.name,
                    documentType: file.mimeType,
                    sharedDriveId: analysis.id,
                    sharedDriveName: analysis.name,
                    externalUser: permission.emailAddress,
                    externalDomain: domain,
                    role: permission.role,
                    permissionType: permission.type
                  };
                  
                  analysis.externalShareDetails.push(shareDetail);
                  
                  // Stream external sharing event in real-time
                  if (this.streamingLogger) {
                    this.streamingLogger.logExternalSharingEvent(userEmail, {
                      ...shareDetail,
                      source: 'Shared Drive',
                      driveType: 'shared-drive'
                    });
                  }
                }
              }
            }
          } catch (permError) {
            console.warn(`Could not analyze permissions for file ${file.id} in shared drive: ${permError.message}`);
          }
        }
      }

      analysis.externalUsers = Array.from(analysis.externalUsers);
      analysis.riskLevel = this.assessSharedDriveRisk(analysis);

    } catch (error) {
      console.error(`Error analyzing shared drive ${driveInfo.name}: ${error.message}`);
      analysis.error = error.message;
    }

    return analysis;
  }

  /**
   * Finds orphaned files (files without parents)
   * @param {string} userEmail - User email
   * @param {Object} drive - Google Drive API client
   * @returns {Array} Array of orphaned files
   */
  async findOrphanedFiles(userEmail, drive) {
    const orphanedFiles = [];

    try {
      // Query for files that are not in trash and don't have the root folder as parent
      // We'll look for files that have no parents or invalid parent references
      const response = await callWithRetry(async () => {
        return await drive.files.list({
          q: "trashed = false",
          fields: 'files(id,name,mimeType,createdTime,modifiedTime,size,parents)',
          supportsAllDrives: true,
          includeItemsFromAllDrives: true,
          pageSize: 1000
        });
      });

      const files = response.data.files || [];
      
      for (const file of files) {
        // A file is considered orphaned if it has no parents or empty parents array
        if (!file.parents || file.parents.length === 0) {
          orphanedFiles.push({
            id: file.id,
            name: file.name,
            mimeType: file.mimeType,
            createdTime: file.createdTime,
            modifiedTime: file.modifiedTime,
            size: file.size ? parseInt(file.size) : 0,
            parents: file.parents || []
          });
        }
      }

    } catch (error) {
      console.error(`Error finding orphaned files for ${userEmail}: ${error.message}`);
    }

    return orphanedFiles;
  }

  /**
   * Assesses overall Drive risk level
   * @param {Object} analysis - Complete Drive analysis
   * @returns {string} Risk level
   */
  assessDriveRiskLevel(analysis) {
    let riskScore = 0;

    // High risk factors
    if (analysis.summary.totalExternalUsers > 10) riskScore += 3;
    else if (analysis.summary.totalExternalUsers > 5) riskScore += 2;
    else if (analysis.summary.totalExternalUsers > 0) riskScore += 1;

    if (analysis.summary.totalOrphanedFiles > 50) riskScore += 2;
    else if (analysis.summary.totalOrphanedFiles > 10) riskScore += 1;

    if (analysis.myDrive?.publicFiles > 0) riskScore += 2;
    if (analysis.sharedDrives.some(drive => drive.publicFiles > 0)) riskScore += 2;

    // Medium risk factors
    if (analysis.summary.totalSharedDrives > 10) riskScore += 1;
    if (analysis.myDrive?.linkSharingEnabled) riskScore += 1;

    if (riskScore >= 5) return 'high';
    if (riskScore >= 3) return 'medium';
    return 'low';
  }

  /**
   * Assesses My Drive risk level
   * @param {Object} analysis - My Drive analysis
   * @returns {string} Risk level
   */
  assessMyDriveRisk(analysis) {
    let riskScore = 0;

    if (analysis.publicFiles > 0) riskScore += 3;
    if (analysis.externalShares > 10) riskScore += 2;
    else if (analysis.externalShares > 0) riskScore += 1;
    if (analysis.linkSharingEnabled) riskScore += 1;

    if (riskScore >= 4) return 'high';
    if (riskScore >= 2) return 'medium';
    return 'low';
  }

  /**
   * Assesses Shared Drive risk level
   * @param {Object} analysis - Shared Drive analysis
   * @returns {string} Risk level
   */
  assessSharedDriveRisk(analysis) {
    let riskScore = 0;

    if (analysis.publicFiles > 0) riskScore += 3;
    if (analysis.externalMembers > 5) riskScore += 2;
    else if (analysis.externalMembers > 0) riskScore += 1;
    if (analysis.externalShares > 0) riskScore += 1;

    // Check restrictions - less restrictive = higher risk
    if (!analysis.restrictions?.adminManagedRestrictions) riskScore += 1;
    if (!analysis.restrictions?.copyRequiresWriterPermission) riskScore += 1;

    if (riskScore >= 5) return 'high';
    if (riskScore >= 3) return 'medium';
    return 'low';
  }
}
