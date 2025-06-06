/**
 * Drive Analyser Module
 * Provides comprehensive analysis of Google Drives including My Drive and Shared Drives
 */

import 'dotenv/config';
import { google } from 'googleapis';
import { apiClient } from './api-client.js';
import { CONFIG, EnvironmentConfig } from './config.js';

/**
 * Drive Analyser class - handles comprehensive Drive analysis
 * Follows Single Responsibility Principle for Drive-specific analysis
 */
export class DriveAnalyser {
  constructor(options = {}) {
    this.options = {
      includeDriveDetails: true,
      includeSharedDrives: true,
      includeMembers: true,
      includeExternalSharing: true,
      ...options
    };
    const envConfig = EnvironmentConfig.getInstance();
    this.primaryDomain = envConfig.primaryDomain;
    this.apiClient = apiClient;
  }

  /**
   * Performs comprehensive Drive analysis for a user
   * @param {string} userEmail - User email to analyse
   * @param {Function} streamingLogger - Logger for real-time updates
   * @returns {Object} Complete Drive analysis results
   */
  async analyseUserDrives(userEmail, streamingLogger) {
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
      const userAuthClient = await this.apiClient.createAuthenticatedClient(userEmail);
      const drive = google.drive({ version: 'v3', auth: userAuthClient });

      // Stream drive analysis start
      if (streamingLogger) {
        streamingLogger.logDriveEvent(userEmail, {
          type: 'drive_analysis_started',
          includeSharedDrives: this.options.includeSharedDrives,
          includeMembers: this.options.includeMembers
        });
      }

      // Analyse My Drive
      analysis.myDrive = await this.analyseMyDrive(userEmail, drive);

      // Analyse Shared Drives
      if (this.options.includeSharedDrives) {
        analysis.sharedDrives = await this.analyseSharedDrives(userEmail, drive);
        analysis.summary.totalSharedDrives = analysis.sharedDrives.length;
      }

      // Find orphaned files and cross-tenant shares
      const { orphanedFiles, crossTenantShares } = await this.findOrphanedFiles(userEmail, drive);
      analysis.orphanedFiles = orphanedFiles;
      analysis.crossTenantShares = crossTenantShares;
      analysis.summary.totalOrphanedFiles = orphanedFiles.length;
      analysis.summary.totalCrossTenantShares = crossTenantShares.length;

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
      analysis.externalUsers = Array.from(analysis.externalUsers); // Convert Set to Array for JSON serialisation

      // Assess overall risk
      analysis.summary.riskLevel = this.assessDriveRiskLevel(analysis);

      // Log summary
      if (streamingLogger) {
        streamingLogger.logDriveSummary(userEmail, analysis.summary);
      }

    } catch (error) {
      console.error(`Error analysing drives for ${userEmail}: ${error.message}`);
      analysis.error = error.message;
    }

    return analysis;
  }

  /**
   * Analyses user's My Drive
   * @param {string} userEmail - User email
   * @param {Object} drive - Google Drive API client
   * @returns {Object} My Drive analysis
   */
  async analyseMyDrive(userEmail, drive) {
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
      const aboutResponse = await this.apiClient.callWithRetry(async () => {
        return await drive.about.get({
          fields: 'storageQuota,user'
        });
      });

      if (aboutResponse.data.storageQuota?.usageInDrive) {
        analysis.storageUsed = Math.round(parseInt(aboutResponse.data.storageQuota.usageInDrive) / (1024 * 1024)); // Convert to MB
      }

      // Analyse files in My Drive (non-shared drive files)
      const filesResponse = await this.apiClient.callWithRetry(async () => {
        return await drive.files.list({
          q: "trashed = false and 'me' in owners",
          fields: 'files(id,name,mimeType,shared,webViewLink,permissions,modifiedTime)',
          pageSize: 1000,
          supportsAllDrives: false // Only My Drive files
        });
      });

      const files = filesResponse.data.files || [];
      analysis.totalFiles = files.length;

      // Analyse each file for sharing
      for (const file of files) {
        if (file.shared) {
          analysis.sharedFiles++;
          
          // Use the centralised permission analysis method
          await this.analyseFilePermissions(drive, file.id, file, analysis);
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
      console.error(`Error analysing My Drive for ${userEmail}: ${error.message}`);
      analysis.error = error.message;
    }

    return analysis;
  }

  /**
   * Analyses user's accessible Shared Drives
   * @param {string} userEmail - User email
   * @param {Object} drive - Google Drive API client
   * @returns {Array} Array of Shared Drive analyses
   */
  async analyseSharedDrives(userEmail, drive) {
    const sharedDrives = [];

    try {
      const drivesResponse = await this.apiClient.callWithRetry(async () => {
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

        const analysis = await this.analyseSharedDrive(userEmail, drive, driveInfo);
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
   * Analyses a specific Shared Drive
   * @param {string} userEmail - User email
   * @param {Object} drive - Google Drive API client
   * @param {Object} driveInfo - Shared Drive information
   * @returns {Object} Shared Drive analysis
   */
  async analyseSharedDrive(userEmail, drive, driveInfo) {
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
        const membersResponse = await this.apiClient.callWithRetry(async () => {
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

      // Analyse files in the Shared Drive
      const filesResponse = await this.apiClient.callWithRetry(async () => {
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
            const permissionsResponse = await this.apiClient.callWithRetry(async () => {
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
            console.warn(`Could not analyse permissions for file ${file.id} in shared drive: ${permError.message}`);
          }
        }
      }

      analysis.externalUsers = Array.from(analysis.externalUsers);
      analysis.riskLevel = this.assessSharedDriveRisk(analysis);

    } catch (error) {
      console.error(`Error analysing shared drive ${driveInfo.name}: ${error.message}`);
      analysis.error = error.message;
    }

    return analysis;
  }

  /**
   * Finds orphaned files (files without parents) and cross-tenant shares
   * @param {string} userEmail - User email
   * @param {Object} drive - Google Drive API client
   * @returns {Object} Object containing orphanedFiles and crossTenantShares arrays
   */
  async findOrphanedFiles(userEmail, drive) {
    const orphanedFiles = [];
    const crossTenantShares = [];

    try {
      // First, get all cross-tenant folders to check for parent relationships
      const crossTenantFolders = await this.getCrossTenantFolders(userEmail, drive);
      
      // Query for files that are not in trash and don't have the root folder as parent
      // We'll look for files that have no parents or invalid parent references
      const response = await this.apiClient.callWithRetry(async () => {
        return await drive.files.list({
          q: "trashed = false",
          fields: 'files(id,name,mimeType,createdTime,modifiedTime,size,parents,owners,shared,sharingUser)',
          supportsAllDrives: true,
          includeItemsFromAllDrives: true,
          pageSize: 1000
        });
      });

      const files = response.data.files || [];
      
      for (const file of files) {
        // Check if file has parents and if any parent is a cross-tenant folder
        const parentAnalysis = await this.analyseFileParents(file, crossTenantFolders, userEmail, drive);
        
        if (parentAnalysis.isInCrossTenantFolder) {
          crossTenantShares.push({
            id: file.id,
            name: file.name,
            mimeType: file.mimeType,
            createdTime: file.createdTime,
            modifiedTime: file.modifiedTime,
            size: file.size ? parseInt(file.size) : 0,
            owners: file.owners,
            parentFolder: parentAnalysis.crossTenantFolderName,
            parentFolderId: parentAnalysis.crossTenantFolderId,
            category: 'file-in-cross-tenant-folder',
            reason: `File located in cross-tenant folder: ${parentAnalysis.crossTenantFolderName}`
          });
        }
        // A file is considered orphaned if it has no parents or empty parents array
        else if (!file.parents || file.parents.length === 0) {
          // Check if this is a standalone cross-tenant share
          const isCrossTenantShare = await this.isCrossTenantShare(file, userEmail, drive);
          
          if (isCrossTenantShare) {
            crossTenantShares.push({
              id: file.id,
              name: file.name,
              mimeType: file.mimeType,
              createdTime: file.createdTime,
              modifiedTime: file.modifiedTime,
              size: file.size ? parseInt(file.size) : 0,
              owners: file.owners,
              category: 'cross-tenant-share',
              reason: 'File shared from external tenant'
            });
          } else {
            orphanedFiles.push({
              id: file.id,
              name: file.name,
              mimeType: file.mimeType,
              createdTime: file.createdTime,
              modifiedTime: file.modifiedTime,
              size: file.size ? parseInt(file.size) : 0,
              parents: file.parents || [],
              category: 'orphaned',
              reason: 'No parent folder found'
            });
          }
        }
      }

    } catch (error) {
      console.error(`Error finding orphaned files for ${userEmail}: ${error.message}`);
    }

    return { orphanedFiles, crossTenantShares };
  }

  /**
   * Determines if a file is a cross-tenant share
   * @param {Object} file - Google Drive file object
   * @param {string} userEmail - Current user's email
   * @param {Object} drive - Google Drive API client
   * @returns {boolean} True if file is a cross-tenant share
   */
  async isCrossTenantShare(file, userEmail, drive) {
    try {
      // Check if file owners are from different domain
      if (file.owners && file.owners.length > 0) {
        const userDomain = userEmail.split('@')[1];
        const ownerDomains = file.owners.map(owner => owner.emailAddress?.split('@')[1]);
        
        // If any owner is from a different domain, it's likely a cross-tenant share
        return ownerDomains.some(domain => domain && domain !== userDomain);
      }
      
      return false;
    } catch (error) {
      console.warn(`Could not determine cross-tenant status for file ${file.id}: ${error.message}`);
      return false;
    }
  }

  /**
   * Gets all cross-tenant folders visible to the user
   * @param {string} userEmail - User email
   * @param {Object} drive - Google Drive API client
   * @returns {Array} Array of cross-tenant folder objects
   */
  async getCrossTenantFolders(userEmail, drive) {
    const crossTenantFolders = [];
    
    try {
      const response = await this.apiClient.callWithRetry(async () => {
        return await drive.files.list({
          q: "trashed = false and mimeType = 'application/vnd.google-apps.folder'",
          fields: 'files(id,name,owners,parents)',
          supportsAllDrives: true,
          includeItemsFromAllDrives: true,
          pageSize: 1000
        });
      });

      const folders = response.data.files || [];
      
      for (const folder of folders) {
        const isCrossTenant = await this.isCrossTenantShare(folder, userEmail, drive);
        if (isCrossTenant) {
          crossTenantFolders.push({
            id: folder.id,
            name: folder.name,
            owners: folder.owners
          });
        }
      }
    } catch (error) {
      console.warn(`Error getting cross-tenant folders for ${userEmail}: ${error.message}`);
    }
    
    return crossTenantFolders;
  }

  /**
   * Analyses a file's parent relationships to determine if it's in a cross-tenant folder
   * @param {Object} file - Google Drive file object
   * @param {Array} crossTenantFolders - Array of known cross-tenant folders
   * @param {string} userEmail - User email
   * @param {Object} drive - Google Drive API client
   * @returns {Object} Analysis result
   */
  async analyseFileParents(file, crossTenantFolders, userEmail, drive) {
    const result = {
      isInCrossTenantFolder: false,
      crossTenantFolderName: null,
      crossTenantFolderId: null
    };

    if (!file.parents || file.parents.length === 0) {
      return result;
    }

    try {
      // Check if any of the file's parents is a cross-tenant folder
      for (const parentId of file.parents) {
        const crossTenantFolder = crossTenantFolders.find(folder => folder.id === parentId);
        if (crossTenantFolder) {
          result.isInCrossTenantFolder = true;
          result.crossTenantFolderName = crossTenantFolder.name;
          result.crossTenantFolderId = crossTenantFolder.id;
          break;
        }

        // If not found in known cross-tenant folders, check directly
        try {
          const parentResponse = await this.apiClient.callWithRetry(async () => {
            return await drive.files.get({
              fileId: parentId,
              fields: 'id,name,owners',
              supportsAllDrives: true
            });
          });

          const parentFolder = parentResponse.data;
          const isCrossTenant = await this.isCrossTenantShare(parentFolder, userEmail, drive);
          
          if (isCrossTenant) {
            result.isInCrossTenantFolder = true;
            result.crossTenantFolderName = parentFolder.name;
            result.crossTenantFolderId = parentFolder.id;
            break;
          }
        } catch (parentError) {
          // Parent folder might not be accessible, continue checking other parents
          console.warn(`Could not access parent folder ${parentId}: ${parentError.message}`);
        }
      }
    } catch (error) {
      console.warn(`Error analysing file parents for ${file.id}: ${error.message}`);
    }

    return result;
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

  /**
   * Analyses file permissions for external sharing
   * @param {Object} drive - Google Drive API client
   * @param {string} fileId - File ID
   * @param {Object} file - File metadata
   * @param {Object} analysis - Analysis object to update
   * @returns {Promise<void>}
   */
  async analyseFilePermissions(drive, fileId, file, analysis) {
    try {
      const permissionsResponse = await this.apiClient.callWithRetry(async () => {
        return await drive.permissions.list({
          fileId: fileId,
          fields: 'permissions(type,role,emailAddress,domain,allowFileDiscovery)'
        });
      });

      const permissions = permissionsResponse.data.permissions || [];
      
      for (const permission of permissions) {
        if (permission.type === 'anyone') {
          analysis.publicFiles++;
          analysis.linkSharingEnabled = true;
        } else if (permission.emailAddress && this.isExternalEmail(permission.emailAddress)) {
          analysis.externalShares++;
          analysis.externalUsers.add(permission.emailAddress);
          
          // Capture external share details
          const shareDetail = {
            documentId: file.id,
            documentName: file.name,
            documentType: file.mimeType,
            externalUser: permission.emailAddress,
            externalDomain: permission.emailAddress.split('@')[1],
            role: permission.role,
            permission: permission.type,
            fileUrl: file.webViewLink
          };
          
          analysis.externalShareDetails.push(shareDetail);

          // Stream external sharing events
          if (this.streamingLogger) {
            this.streamingLogger.logExternalSharingEvent(analysis.ownerEmail, {
              type: 'external_share_detected',
              fileId: file.id,
              fileName: file.name,
              externalUser: permission.emailAddress,
              role: permission.role
            });
          }
        }
      }
    } catch (error) {
      console.error(`Error analysing permissions for file ${fileId}: ${error.message}`);
    }
  }

  /**
   * Checks if an email address is external to the primary domain
   * @param {string} email - Email address to check
   * @returns {boolean} True if external
   */
  isExternalEmail(email) {
    if (!email || !this.primaryDomain) return false;
    const domain = email.split('@')[1];
    return domain && domain !== this.primaryDomain;
  }
}
