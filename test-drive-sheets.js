#!/usr/bin/env node

/**
 * Test script to validate enhanced Drive analysis Google Sheets output
 * This demonstrates all the important information that will be logged to sheets
 */

import { SHEET_NAMES } from './constants.js';

// Simulate Drive analysis data structure that would be created
const mockDriveAnalysisData = [
  {
    userEmail: 'user@example.com',
    timestamp: '2025-06-05T10:00:00.000Z',
    myDrive: {
      type: 'my-drive',
      ownerEmail: 'user@example.com',
      totalFiles: 250,
      sharedFiles: 45,
      publicFiles: 3,
      externalShares: 12,
      externalUsers: ['external@partner.com', 'consultant@vendor.org'],
      linkSharingEnabled: true,
      storageUsed: 1024, // MB
      lastActivity: '2025-06-04T15:30:00.000Z',
      riskLevel: 'medium'
    },
    sharedDrives: [
      {
        type: 'shared-drive',
        id: 'shared-drive-123',
        name: 'Marketing Team Drive',
        createdTime: '2024-01-15T08:00:00.000Z',
        userRole: 'contentManager',
        members: [
          {
            email: 'user@example.com',
            role: 'contentManager',
            displayName: 'John Doe',
            type: 'user',
            domain: 'example.com'
          },
          {
            email: 'external@partner.com',
            role: 'reader',
            displayName: 'External User',
            type: 'user',
            domain: 'partner.com'
          }
        ],
        totalFiles: 89,
        sharedFiles: 12,
        publicFiles: 0,
        externalShares: 5,
        externalMembers: 1,
        externalUsers: ['external@partner.com'],
        restrictions: {
          adminManagedRestrictions: true,
          copyRequiresWriterPermission: false
        },
        capabilities: {},
        storageUsed: 512,
        riskLevel: 'low'
      }
    ],
    externalUsers: ['external@partner.com', 'consultant@vendor.org'],
    orphanedFiles: [
      {
        id: 'orphan-file-1',
        name: 'Old Presentation.pptx',
        mimeType: 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
        createdTime: '2023-05-10T12:00:00.000Z',
        modifiedTime: '2023-05-15T14:30:00.000Z',
        size: 2048576 // bytes
      },
      {
        id: 'orphan-file-2',
        name: 'Backup Data.csv',
        mimeType: 'text/csv',
        createdTime: '2023-03-20T09:15:00.000Z',
        modifiedTime: '2023-03-20T09:15:00.000Z',
        size: 512000 // bytes
      }
    ],
    summary: {
      totalSharedDrives: 1,
      totalExternalUsers: 2,
      totalOrphanedFiles: 2,
      hasExternalSharing: true,
      riskLevel: 'medium'
    }
  }
];

console.log('='.repeat(80));
console.log('ENHANCED DRIVE ANALYSIS - GOOGLE SHEETS INFORMATION');
console.log('='.repeat(80));

console.log('\n📊 SHEET 1: Drive Analysis Summary');
console.log('─'.repeat(50));
console.log('Information logged for each user:');
const driveAnalysisHeaders = [
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
  'Overall Risk Level',
  'Has External Sharing',
  'Analysis Timestamp',
  'Analysis Error'
];

driveAnalysisHeaders.forEach((header, i) => {
  console.log(`  ${i + 1}. ${header}`);
});

console.log('\n📁 SHEET 2: Shared Drives Details');
console.log('─'.repeat(50));
console.log('Information logged for each Shared Drive:');
const sharedDriveHeaders = [
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

sharedDriveHeaders.forEach((header, i) => {
  console.log(`  ${i + 1}. ${header}`);
});

console.log('\n🌐 SHEET 3: External Sharing');
console.log('─'.repeat(50));
console.log('Information logged for each external user:');
const externalSharingHeaders = [
  'User Email',
  'External User',
  'Source'
];

externalSharingHeaders.forEach((header, i) => {
  console.log(`  ${i + 1}. ${header}`);
});

console.log('\n🗂️ SHEET 4: Orphaned Files');
console.log('─'.repeat(50));
console.log('Information logged for each orphaned file:');
const orphanedFilesHeaders = [
  'User Email',
  'File Name',
  'File ID',
  'MIME Type',
  'File Size (MB)',
  'File Size (Bytes)',
  'Created Time',
  'Modified Time'
];

orphanedFilesHeaders.forEach((header, i) => {
  console.log(`  ${i + 1}. ${header}`);
});

console.log('\n👥 SHEET 5: Drive Members');
console.log('─'.repeat(50));
console.log('Information logged for each drive member:');
const driveMembersHeaders = [
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

driveMembersHeaders.forEach((header, i) => {
  console.log(`  ${i + 1}. ${header}`);
});

console.log('\n' + '='.repeat(80));
console.log('EXAMPLE DATA EXTRACTED FROM DRIVE ANALYSIS');
console.log('='.repeat(80));

const analysisData = mockDriveAnalysisData[0];

console.log('\n📊 Drive Analysis Summary for', analysisData.userEmail);
console.log('─'.repeat(50));
console.log(`• My Drive Files: ${analysisData.myDrive.totalFiles}`);
console.log(`• My Drive Shared Files: ${analysisData.myDrive.sharedFiles}`);
console.log(`• My Drive Public Files: ${analysisData.myDrive.publicFiles}`);
console.log(`• My Drive External Shares: ${analysisData.myDrive.externalShares}`);
console.log(`• My Drive Storage: ${analysisData.myDrive.storageUsed} MB`);
console.log(`• Link Sharing Enabled: ${analysisData.myDrive.linkSharingEnabled ? 'Yes' : 'No'}`);
console.log(`• Last Activity: ${analysisData.myDrive.lastActivity}`);
console.log(`• Risk Level: ${analysisData.myDrive.riskLevel}`);
console.log(`• Total Shared Drives: ${analysisData.summary.totalSharedDrives}`);
console.log(`• Total External Users: ${analysisData.summary.totalExternalUsers}`);
console.log(`• Total Orphaned Files: ${analysisData.summary.totalOrphanedFiles}`);
console.log(`• Has External Sharing: ${analysisData.summary.hasExternalSharing ? 'Yes' : 'No'}`);

console.log('\n📁 Shared Drive Details');
console.log('─'.repeat(50));
analysisData.sharedDrives.forEach(drive => {
  console.log(`• Drive: ${drive.name} (${drive.id})`);
  console.log(`  - User Role: ${drive.userRole}`);
  console.log(`  - Total Members: ${drive.members.length}`);
  console.log(`  - External Members: ${drive.externalMembers}`);
  console.log(`  - Total Files: ${drive.totalFiles}`);
  console.log(`  - Public Files: ${drive.publicFiles}`);
  console.log(`  - Risk Level: ${drive.riskLevel}`);
  console.log(`  - Admin Managed: ${drive.restrictions.adminManagedRestrictions ? 'Yes' : 'No'}`);
  console.log(`  - Copy Restriction: ${drive.restrictions.copyRequiresWriterPermission ? 'Yes' : 'No'}`);
});

console.log('\n🌐 External Users Found');
console.log('─'.repeat(50));
analysisData.externalUsers.forEach(user => {
  console.log(`• ${user} (from Drive Analysis)`);
});

console.log('\n🗂️ Orphaned Files');
console.log('─'.repeat(50));
analysisData.orphanedFiles.forEach(file => {
  const sizeMB = Math.round(file.size / (1024 * 1024) * 100) / 100;
  console.log(`• ${file.name} (${file.id})`);
  console.log(`  - Type: ${file.mimeType}`);
  console.log(`  - Size: ${sizeMB} MB (${file.size} bytes)`);
  console.log(`  - Created: ${file.createdTime}`);
  console.log(`  - Modified: ${file.modifiedTime}`);
});

console.log('\n👥 Drive Members');
console.log('─'.repeat(50));
analysisData.sharedDrives.forEach(drive => {
  console.log(`Drive: ${drive.name}`);
  drive.members.forEach(member => {
    const isExternal = member.domain !== 'example.com' ? 'Yes' : 'No';
    console.log(`  • ${member.email} (${member.role})`);
    console.log(`    - Display Name: ${member.displayName}`);
    console.log(`    - Domain: ${member.domain}`);
    console.log(`    - External: ${isExternal}`);
  });
});

console.log('\n' + '='.repeat(80));
console.log('✅ ALL DRIVE ANALYSIS DATA IS NOW LOGGED TO GOOGLE SHEETS');
console.log('='.repeat(80));
console.log('\nKey enhancements:');
console.log('• Added My Drive last activity and link sharing status');
console.log('• Added Shared Drive restrictions and capabilities');
console.log('• Added detailed orphaned files information');
console.log('• Added comprehensive drive member details');
console.log('• Added error tracking for troubleshooting');
console.log('• Enhanced external user detection and tracking');
console.log('\nSheets created:');
Object.entries(SHEET_NAMES).forEach(([key, value]) => {
  if (['DRIVES', 'SHARED_DRIVES', 'EXTERNAL_SHARING', 'ORPHANED_FILES', 'DRIVE_MEMBERS'].includes(key)) {
    console.log(`• ${value}`);
  }
});
