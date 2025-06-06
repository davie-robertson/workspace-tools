import { 
  MAX_CELL_CHARACTERS, 
  SHEET_NAMES,
  ISSUE_TYPES 
} from "./constants.js";
import { CONFIG } from './config.js';
import { dataTransferMonitor } from './data-transfer-monitor.js';
import { SheetManager } from './sheet-manager.js';
import { ChartService } from './chart-service.js';
import fs from 'fs';

/**
 * Reads streaming logs and creates issue-focused Google Sheets
 * One row per issue instead of one row per file
 */
export async function buildSheetsFromStreamingLogs(sheets, spreadsheetId, scanLogPath, summaryLogPath) {
  try {
    // Initialise managers
    const sheetManager = new SheetManager(sheets, spreadsheetId);
    const chartService = new ChartService(sheets, spreadsheetId);
    
    // Read and parse streaming logs
    const fileData = readScanLog(scanLogPath);
    const summaryData = readSummaryLog(summaryLogPath);
    
    // Extract user stats and totals from summary data
    const { userStats, totalStats } = extractStatsFromSummary(summaryData);
    
    // Create issue-focused audit details
    await writeIssueBasedAuditDetails(sheetManager, fileData);
    
    // Create issue chart
    await chartService.createIssueChart(SHEET_NAMES.ISSUES, SHEET_NAMES.CHART);
    
    // Create summary tab
    await writeSummaryTab(sheetManager, userStats, totalStats);
    
    // Create quota tab  
    await writeQuotaTab(sheetManager, userStats);
    
    // Create Drive analysis tabs if data is available
    await writeDriveAnalysisTabs(sheetManager, summaryData);
    
    console.log('Google Sheets successfully built from streaming logs');
    
  } catch (error) {
    console.error('Failed to build sheets from streaming logs:', error.message);
    throw error;
  }
}

/**
 * Reads the scan log and returns parsed file data
 */
function readScanLog(scanLogPath) {
  const scanLogContent = fs.readFileSync(scanLogPath, 'utf8');
  const scanLines = scanLogContent.trim().split('\n').filter(line => line);
  
  const files = [];
  scanLines.forEach(line => {
    try {
      const entry = JSON.parse(line);
      if (entry.type === 'file_processed') {
        files.push(entry.data);
      }
    } catch (e) {
      console.warn('Skipped malformed scan log entry:', e.message);
    }
  });
  
  return files;
}

/**
 * Reads the summary log and returns parsed summary data
 */
function readSummaryLog(summaryLogPath) {
  const summaryLogContent = fs.readFileSync(summaryLogPath, 'utf8');
  const summaryLines = summaryLogContent.trim().split('\n').filter(line => line);
  
  const events = [];
  summaryLines.forEach(line => {
    try {
      const entry = JSON.parse(line);
      events.push(entry);
    } catch (e) {
      console.warn('Skipped malformed summary log entry:', e.message);
    }
  });
  
  return events;
}

/**
 * Extracts user stats and total stats from summary log events
 */
function extractStatsFromSummary(summaryData) {
  const userStats = {};
  let totalStats = {};
  
  summaryData.forEach(event => {
    if (event.type === 'user_processing_completed') {
      userStats[event.user] = event.stats;
    } else if (event.type === 'scan_completed') {
      totalStats = event.total_stats || {};
    }
  });
  
  return { userStats, totalStats };
}

/**
 * Creates issue-focused audit details with one row per issue
 */
async function writeIssueBasedAuditDetails(sheetManager, fileData) {
  // Create or clear sheet
  await sheetManager.getOrCreateSheet(SHEET_NAMES.ISSUES);

  // Build issue rows
  const issueRows = buildIssueRows(fileData);
  
  // Write headers and data
  const headers = [
    'Issue Type', 'Issue Detail', 'Owner Email', 'File Name', 'File Type', 
    'File ID', 'File URL', 'Created Time', 'Modified Time', 'File Size'
  ];
  
  const allRows = [headers, ...issueRows];
  
  await sheetManager.writeData(SHEET_NAMES.ISSUES, 'A1', allRows);
  
  console.log(`Issues sheet created with ${issueRows.length} issue rows`);
}

/**
 * Builds issue-focused rows from file data
 */
function buildIssueRows(fileData) {
  const rows = [];
  
  fileData.forEach((file, index) => {
    // Add row for each external link
    if (file.linkedItems && file.linkedItems.length > 0) {
      file.linkedItems.forEach(link => {
        rows.push([
          ISSUE_TYPES.EXTERNAL_LINK,
          link,
          file.ownerEmail,
          file.fileName,
          file.fileType,
          file.fileId,
          file.fileUrl,
          file.createdTime,
          file.modifiedTime,
          file.size
        ]);
      });
    }
    
    // Add row for each incompatible function
    if (file.incompatibleFunctions && file.incompatibleFunctions.length > 0) {
      file.incompatibleFunctions.forEach(func => {
        rows.push([
          ISSUE_TYPES.INCOMPATIBLE_FUNCTION,
          func,
          file.ownerEmail,
          file.fileName,
          file.fileType,
          file.fileId,
          file.fileUrl,
          file.createdTime,
          file.modifiedTime,
          file.size
        ]);
      });
    }
  });
  
  return rows;
}

/**
 * Writes summary statistics to a dedicated summary sheet in a Google Spreadsheet.
 * 
 * This function handles creating a summary sheet if it doesn't exist, or clearing it if it does,
 * and then populates it with user statistics and totals.
 * 
 * @async
 * @param {Object} sheets - The Google Sheets API client
 * @param {string} spreadsheetId - The ID of the Google Spreadsheet
 * @param {Object.<string, Object>} userStats - Object containing user statistics, keyed by email
 *   @param {number} userStats[].doc - Number of documents scanned for a user
 *   @param {number} userStats[].docWithLinks - Number of documents with links for a user
 *   @param {number} userStats[].sheet - Number of sheets scanned for a user
 *   @param {number} userStats[].sheetWithLinks - Number of sheets with links for a user
 *   @param {number} userStats[].sheetWithIncompatibleFunctions - Number of sheets with incompatible functions for a user
 *   @param {number} userStats[].slide - Number of slides scanned for a user
 *   @param {number} userStats[].slideWithLinks - Number of slides with links for a user
 *   @param {number} userStats[].other - Number of other files scanned for a user
 *   @param {number} userStats[].otherWithLinks - Number of other files with links for a user
 * @param {Object} totalStats - Object containing aggregated statistics across all users
 *   @param {number} totalStats.doc - Total number of documents scanned
 *   @param {number} totalStats.docWithLinks - Total number of documents with links
 *   @param {number} totalStats.sheet - Total number of sheets scanned
 *   @param {number} totalStats.sheetWithLinks - Total number of sheets with links
 *   @param {number} totalStats.sheetWithIncompatibleFunctions - Total number of sheets with incompatible functions
 *   @param {number} totalStats.slide - Total number of slides scanned
 *   @param {number} totalStats.slideWithLinks - Total number of slides with links
 *   @param {number} totalStats.other - Total number of other files scanned
 *   @param {number} totalStats.otherWithLinks - Total number of other files with links
 * @returns {Promise<void>} A Promise that resolves when the summary sheet has been written
 * @throws {Error} If there's an error creating the summary sheet
 */
export async function writeSummaryTab(sheetManager, userStats, totalStats) {
  // Create or clear sheet
  await sheetManager.getOrCreateSheet(SHEET_NAMES.SUMMARY);

  const header = [
    'User Email',
    'Docs Scanned',
    'Docs w/ Links',
    'Sheets Scanned',
    'Sheets w/ Links',
    'Sheets w/ Incomp. Funcs',
    'Slides Scanned',
    'Slides w/ Links',
    'Other Files Scanned',
    'Other Files w/ Links',
  ];
  const userRows = Object.entries(userStats).map(([email, stats]) => [
    email,
    stats.doc,
    stats.docWithLinks,
    stats.sheet,
    stats.sheetWithLinks,
    stats.sheetWithIncompatibleFunctions,
    stats.slide,
    stats.slideWithLinks,
    stats.other,
    stats.otherWithLinks,
  ]);
  const totalRow = [
    'TOTAL',
    totalStats.doc,
    totalStats.docWithLinks,
    totalStats.sheet,
    totalStats.sheetWithLinks,
    totalStats.sheetWithIncompatibleFunctions,
    totalStats.slide,
    totalStats.slideWithLinks,
    totalStats.other,
    totalStats.otherWithLinks,
  ];
  const allRows = [header, ...userRows, totalRow];

  await sheetManager.writeData(SHEET_NAMES.SUMMARY, 'A1', allRows);
}

/**
 * Writes user quota information to a dedicated quota sheet in a Google Spreadsheet.
 * 
 * @async
 * @param {Object} sheets - The Google Sheets API client
 * @param {string} spreadsheetId - The ID of the Google Spreadsheet
 * @param {Object.<string, Object>} userStats - Object containing user statistics including quota info
 * @returns {Promise<void>} A Promise that resolves when the quota sheet has been written
 * @throws {Error} If there's an error creating or writing to the quota sheet
 */
export async function writeQuotaTab(sheetManager, userStats) {
  // Create or clear sheet
  await sheetManager.getOrCreateSheet(SHEET_NAMES.QUOTA);

  // Set headers
  const headers = [
    'User Email',
    'Drive Quota Limit (MB)',
    'Organization Total Usage (MB)',
    'Drive Files Usage (MB)', 
    'Drive Trash Usage (MB)',
    'Gmail Email Address',
    'Gmail Messages Total',
    'Gmail Threads Total',
    'Gmail History ID',
    'Gmail Storage Usage (MB)'
  ];

  // Prepare data rows
  const rows = [headers];
  let quotaDataCount = 0;
  
  for (const [userEmail, stats] of Object.entries(userStats)) {
    if (stats.quotaInfo) {
      quotaDataCount++;
      const quota = stats.quotaInfo;
      
      // Convert bytes to MB for storage values
      const bytesToMB = (bytes) => bytes ? Math.round(parseInt(bytes) / (1024 * 1024)) : 'N/A';
      
      // Calculate Gmail storage usage - note: with pooled storage this calculation is not reliable
      const calculateGmailUsage = () => {
        // First check if user has Gmail service enabled
        if (!quota.gmailProfile) {
          return 'N/A (No Gmail Service)';
        }
        
        if (quota.storageQuota?.usage && quota.storageQuota?.usageInDrive !== undefined && quota.storageQuota?.usageInDriveTrash !== undefined) {
          const totalUsage = parseInt(quota.storageQuota.usage);
          const driveUsage = parseInt(quota.storageQuota.usageInDrive);
          const trashUsage = parseInt(quota.storageQuota.usageInDriveTrash);
          
          // Calculate Gmail usage: Total - Drive files - Drive trash (like main branch)
          const gmailUsageBytes = Math.max(0, totalUsage - driveUsage - trashUsage);
          
          // In pooled storage environments, only return meaningful values for users with significant Drive usage
          if (driveUsage > 0 || trashUsage > 0) {
            return gmailUsageBytes > 0 ? bytesToMB(gmailUsageBytes) : 0;
          }
        }
        // Return N/A for users with no Drive usage in pooled storage environments
        return 'N/A (Pooled Storage)';
      };
      
      const driveFilesUsageMB = quota.storageQuota?.usageInDrive ? bytesToMB(quota.storageQuota.usageInDrive) : 'N/A';
      const gmailUsageMB = calculateGmailUsage();
      
      const rowData = [
        userEmail,
        quota.storageQuota?.limit ? bytesToMB(quota.storageQuota.limit) : 'N/A',
        quota.storageQuota?.usage ? bytesToMB(quota.storageQuota.usage) : 'N/A',
        driveFilesUsageMB,
        quota.storageQuota?.usageInDriveTrash ? bytesToMB(quota.storageQuota.usageInDriveTrash) : 'N/A',
        quota.user?.emailAddress || userEmail,
        quota.gmailProfile?.messagesTotal || 'N/A',
        quota.gmailProfile?.threadsTotal || 'N/A', 
        quota.gmailProfile?.historyId || 'N/A',
        gmailUsageMB
      ];
      
      rows.push(rowData);
    } else {
      // Add row with N/A values for users without quota data
      rows.push([
        userEmail,
        'N/A', 'N/A', 'N/A', 'N/A', userEmail, 'N/A', 'N/A', 'N/A', 'N/A'
      ]);
    }
  }

  // Write all data at once
  await sheetManager.writeData(SHEET_NAMES.QUOTA, 'A1', rows);
  
  console.log(`User quota information written to ${SHEET_NAMES.QUOTA} sheet. (${quotaDataCount}/${Object.keys(userStats).length} users with quota data)`);
}

/**
 * Creates an Issue Chart sheet with a bar chart showing issue types and their counts
 * 
 * @async
 * @param {Object} sheets - The Google Sheets API client
 * @param {string} spreadsheetId - The ID of the Google Spreadsheet
 * @param {Array} fileData - Array of file data from scan logs
 */
// Legacy scanning functions below - these may be moved to a separate module in the future

/**
 * Writes Drive analysis data to dedicated sheets
 * 
 * @async
 * @param {SheetManager} sheetManager - Sheet manager instance
 * @param {Array} summaryData - Summary log data containing Drive analysis
 */
async function writeDriveAnalysisTabs(sheetManager, summaryData) {
  // Extract Drive analysis data from summary logs
  const driveAnalysisData = [];
  const sharedDrivesData = [];
  const externalSharingData = [];
  const orphanedFilesData = [];
  const crossTenantSharesData = [];
  const driveMembersData = [];
  
  summaryData.forEach(event => {
    if (event.type === 'drive_analysis') {
      const analysis = event.data;
      driveAnalysisData.push({
        userEmail: event.userEmail,
        ...analysis
      });
      
      // Extract shared drives data with enhanced details
      if (analysis.sharedDrives && analysis.sharedDrives.length > 0) {
        analysis.sharedDrives.forEach(drive => {
          const driveData = {
            userEmail: event.userEmail,
            driveName: drive.name,
            driveId: drive.id,
            userRole: drive.userRole,
            totalMembers: drive.members ? drive.members.length : 0,
            externalMembers: drive.externalMembers || 0,
            totalFiles: drive.totalFiles || 0,
            sharedFiles: drive.sharedFiles || 0,
            publicFiles: drive.publicFiles || 0,
            externalShares: drive.externalShares || 0,
            riskLevel: drive.riskLevel || 'low',
            createdTime: drive.createdTime || '',
            adminManagedRestrictions: drive.restrictions?.adminManagedRestrictions ? 'Yes' : 'No',
            copyRequiresWriterPermission: drive.restrictions?.copyRequiresWriterPermission ? 'Yes' : 'No',
            error: drive.error || ''
          };
          sharedDrivesData.push(driveData);
          
          // Extract drive members data if available
          if (drive.members && drive.members.length > 0) {
            drive.members.forEach(member => {
              driveMembersData.push({
                userEmail: event.userEmail,
                driveName: drive.name,
                driveId: drive.id,
                memberEmail: member.email,
                memberRole: member.role,
                memberDisplayName: member.displayName || '',
                memberType: member.type,
                memberDomain: member.domain || '',
                isExternal: member.domain !== CONFIG.PRIMARY_DOMAIN ? 'Yes' : 'No'
              });
            });
          }
        });
      }
      
      // Extract orphaned files data
      if (analysis.orphanedFiles && analysis.orphanedFiles.length > 0) {
        analysis.orphanedFiles.forEach(file => {
          orphanedFilesData.push({
            userEmail: event.userEmail,
            fileName: file.name,
            fileId: file.id,
            mimeType: file.mimeType,
            fileSizeBytes: file.size || 0,
            fileSizeMB: file.size ? Math.round(file.size / (1024 * 1024) * 100) / 100 : 0,
            createdTime: file.createdTime || '',
            modifiedTime: file.modifiedTime || '',
            category: file.category || 'orphaned',
            reason: file.reason || 'No parent folder found'
          });
        });
      }
      
      // Extract cross-tenant shares data
      if (analysis.crossTenantShares && analysis.crossTenantShares.length > 0) {
        analysis.crossTenantShares.forEach(file => {
          crossTenantSharesData.push({
            userEmail: event.userEmail,
            fileName: file.name,
            fileId: file.id,
            mimeType: file.mimeType,
            fileSizeBytes: file.size || 0,
            fileSizeMB: file.size ? Math.round(file.size / (1024 * 1024) * 100) / 100 : 0,
            createdTime: file.createdTime || '',
            modifiedTime: file.modifiedTime || '',
            owners: file.owners?.map(o => o.emailAddress).join(', ') || '',
            parentFolder: file.parentFolder || '',
            parentFolderId: file.parentFolderId || '',
            category: file.category || 'cross-tenant-share',
            reason: file.reason || 'Shared from external tenant'
          });
        });
      }
      
      // Extract detailed external sharing data with document information
      if (analysis.externalShareDetails && analysis.externalShareDetails.length > 0) {
        analysis.externalShareDetails.forEach(shareDetail => {
          externalSharingData.push({
            userEmail: event.userEmail,
            externalUser: shareDetail.externalUser,
            externalDomain: shareDetail.externalDomain,
            documentId: shareDetail.documentId,
            documentName: shareDetail.documentName,
            documentType: shareDetail.documentType,
            sharedDriveId: shareDetail.sharedDriveId || '',
            sharedDriveName: shareDetail.sharedDriveName || '',
            role: shareDetail.role,
            permissionType: shareDetail.permissionType,
            source: 'Drive Analysis'
          });
        });
      }
    }
  });
  
  // Write Drive Analysis summary sheet
  if (driveAnalysisData.length > 0) {
    await writeDriveAnalysisSheet(sheetManager, driveAnalysisData);
  }
  
  // Write Shared Drives sheet
  if (sharedDrivesData.length > 0) {
    await writeSharedDrivesSheet(sheetManager, sharedDrivesData);
  }
  
  // Write External Sharing sheet
  if (externalSharingData.length > 0) {
    await writeExternalSharingSheet(sheetManager, externalSharingData);
  }
  
  // Write Orphaned Files sheet
  if (orphanedFilesData.length > 0) {
    await writeOrphanedFilesSheet(sheetManager, orphanedFilesData);
  }
  
  // Write Cross-Tenant Shares sheet
  if (crossTenantSharesData.length > 0) {
    await writeCrossTenantSharesSheet(sheetManager, crossTenantSharesData);
  }
  
  // Write Drive Members sheet
  if (driveMembersData.length > 0) {
    await writeDriveMembersSheet(sheetManager, driveMembersData);
  }
}

/**
 * Writes Drive Analysis summary sheet
 */
async function writeDriveAnalysisSheet(sheetManager, driveAnalysisData) {
  await sheetManager.getOrCreateSheet(SHEET_NAMES.DRIVES);
  
  const headers = [
    'User Email',
    'My Drive Files',
    'My Drive Shared Files',
    'My Drive Public Files',
    'My Drive External Shares',
    'My Drive Storage (MB)',
    'My Drive Link Sharing Enabled',
    'My Drive Last Activity',
    'My Drive Risk Level',
    'Total Shared Drives',
    'Total External Users',
    'Total Orphaned Files',
    'Total Cross-Tenant Shares',
    'Overall Risk Level',
    'Has External Sharing',
    'Analysis Timestamp',
    'Analysis Error'
  ];
  
  const rows = [headers];
  
  driveAnalysisData.forEach(analysis => {
    rows.push([
      analysis.userEmail,
      analysis.myDrive?.totalFiles || 0,
      analysis.myDrive?.sharedFiles || 0,
      analysis.myDrive?.publicFiles || 0,
      analysis.myDrive?.externalShares || 0,
      analysis.myDrive?.storageUsed || 0,
      analysis.myDrive?.linkSharingEnabled ? 'Yes' : 'No',
      analysis.myDrive?.lastActivity || '',
      analysis.myDrive?.riskLevel || 'low',
      analysis.summary?.totalSharedDrives || 0,
      analysis.summary?.totalExternalUsers || 0,
      analysis.summary?.totalOrphanedFiles || 0,
      analysis.summary?.totalCrossTenantShares || 0,
      analysis.summary?.riskLevel || 'low',
      analysis.summary?.hasExternalSharing ? 'Yes' : 'No',
      analysis.timestamp || '',
      analysis.error || ''
    ]);
  });
  
  await sheetManager.writeData(SHEET_NAMES.DRIVES, 'A1', rows);
  console.log(`Drive Analysis sheet created with ${driveAnalysisData.length} user records`);
}

/**
 * Writes Shared Drives sheet
 */
async function writeSharedDrivesSheet(sheetManager, sharedDrivesData) {
  await sheetManager.getOrCreateSheet(SHEET_NAMES.SHARED_DRIVES);
  
  const headers = [
    'User Email',
    'Drive Name',
    'Drive ID',
    'User Role',
    'Total Members',
    'External Members',
    'Total Files',
    'Shared Files',
    'Public Files', 
    'External Shares',
    'Risk Level',
    'Created Time',
    'Admin Managed Restrictions',
    'Copy Requires Writer Permission',
    'Analysis Error'
  ];
  
  const rows = [headers, ...sharedDrivesData.map(drive => [
    drive.userEmail,
    drive.driveName,
    drive.driveId,
    drive.userRole,
    drive.totalMembers,
    drive.externalMembers,
    drive.totalFiles,
    drive.sharedFiles,
    drive.publicFiles,
    drive.externalShares,
    drive.riskLevel,
    drive.createdTime,
    drive.adminManagedRestrictions || 'Unknown',
    drive.copyRequiresWriterPermission || 'Unknown',
    drive.error || ''
  ])];
  
  await sheetManager.writeData(SHEET_NAMES.SHARED_DRIVES, 'A1', rows);
  console.log(`Shared Drives sheet created with ${sharedDrivesData.length} drive records`);
}

/**
 * Writes External Sharing sheet
 */
async function writeExternalSharingSheet(sheetManager, externalSharingData) {
  await sheetManager.getOrCreateSheet(SHEET_NAMES.EXTERNAL_SHARING);
  
  const headers = [
    'User Email',
    'External User',
    'External Domain',
    'Document ID',
    'Document Name', 
    'Document Type',
    'Shared Drive ID',
    'Shared Drive Name',
    'Role',
    'Permission Type',
    'Source'
  ];
  
  const rows = [headers, ...externalSharingData.map(share => [
    share.userEmail,
    share.externalUser,
    share.externalDomain || '',
    share.documentId || '',
    share.documentName || '',
    share.documentType || '',
    share.sharedDriveId || '',
    share.sharedDriveName || '',
    share.role || '',
    share.permissionType || '',
    share.source
  ])];
  
  await sheetManager.writeData(SHEET_NAMES.EXTERNAL_SHARING, 'A1', rows);
  console.log(`External Sharing sheet created with ${externalSharingData.length} external user records`);
}

/**
 * Writes Orphaned Files sheet
 */
async function writeOrphanedFilesSheet(sheetManager, orphanedFilesData) {
  await sheetManager.getOrCreateSheet(SHEET_NAMES.ORPHANED_FILES);
  
  const headers = [
    'User Email',
    'File Name',
    'File ID',
    'MIME Type',
    'File Size (MB)',
    'File Size (Bytes)',
    'Created Time',
    'Modified Time',
    'Category',
    'Reason'
  ];
  
  const rows = [headers, ...orphanedFilesData.map(file => [
    file.userEmail,
    file.fileName,
    file.fileId,
    file.mimeType,
    file.fileSizeMB,
    file.fileSizeBytes,
    file.createdTime,
    file.modifiedTime,
    file.category,
    file.reason
  ])];
  
  await sheetManager.writeData(SHEET_NAMES.ORPHANED_FILES, 'A1', rows);
  console.log(`Orphaned Files sheet created with ${orphanedFilesData.length} file records`);
}

/**
 * Writes Cross-Tenant Shares sheet
 */
async function writeCrossTenantSharesSheet(sheetManager, crossTenantSharesData) {
  await sheetManager.getOrCreateSheet(SHEET_NAMES.CROSS_TENANT_SHARES);
  
  const headers = [
    'User Email',
    'File Name',
    'File ID',
    'MIME Type',
    'File Size (MB)',
    'File Size (Bytes)',
    'File Owners',
    'Parent Folder',
    'Parent Folder ID',
    'Created Time',
    'Modified Time',
    'Category',
    'Reason'
  ];
  
  const rows = [headers, ...crossTenantSharesData.map(file => [
    file.userEmail,
    file.fileName,
    file.fileId,
    file.mimeType,
    file.fileSizeMB,
    file.fileSizeBytes,
    file.owners,
    file.parentFolder || '',
    file.parentFolderId || '',
    file.createdTime,
    file.modifiedTime,
    file.category,
    file.reason
  ])];
  
  await sheetManager.writeData(SHEET_NAMES.CROSS_TENANT_SHARES, 'A1', rows);
  console.log(`Cross-Tenant Shares sheet created with ${crossTenantSharesData.length} file records`);
}

/**
 * Writes Drive Members sheet
 */
async function writeDriveMembersSheet(sheetManager, driveMembersData) {
  await sheetManager.getOrCreateSheet(SHEET_NAMES.DRIVE_MEMBERS);
  
  const headers = [
    'User Email',
    'Drive Name',
    'Drive ID',
    'Member Email',
    'Member Role',
    'Member Display Name',
    'Member Type',
    'Member Domain',
    'Is External'
  ];
  
  const rows = [headers, ...driveMembersData.map(member => [
    member.userEmail,
    member.driveName,
    member.driveId,
    member.memberEmail,
    member.memberRole,
    member.memberDisplayName,
    member.memberType,
    member.memberDomain,
    member.isExternal
  ])];
  
  await sheetManager.writeData(SHEET_NAMES.DRIVE_MEMBERS, 'A1', rows);
  console.log(`Drive Members sheet created with ${driveMembersData.length} member records`);
}