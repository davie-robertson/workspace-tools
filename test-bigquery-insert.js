#!/usr/bin/env node

/**
 * Test BigQuery data insertion
 */

import 'dotenv/config';
import { FileProcessor } from './processing/file-processor.js';
import { getAllUsers } from './user-file-management.js';

async function testBigQueryInsert() {
  console.log('🧪 Testing BigQuery Data Insertion');
  console.log('==================================');

  try {
    // Get users
    const users = await getAllUsers();
    if (users.length === 0) {
      console.log('No users found');
      return;
    }

    const testUser = users[0];
    console.log(`Testing with user: ${testUser.primaryEmail}`);

    // Initialize processor
    const processor = new FileProcessor({
      enableCaching: true,
      batchSize: 3
    });

    // Process a few files for this user
    console.log('Processing files...');
    const result = await processor.processUserFiles(testUser.primaryEmail, {
      analysisTypes: ['sharing'],
      maxFiles: 2
    });

    console.log('✅ Processing completed');
    console.log(`Files processed: ${result.totalFiles}`);
    console.log(`Cache hits: ${result.cacheHits}`);

    // Cleanup
    await processor.close();

    // Check BigQuery data
    console.log('\n📊 Checking BigQuery data...');
    
  } catch (error) {
    console.error('❌ Test failed:', error.message);
  }
}

testBigQueryInsert();
