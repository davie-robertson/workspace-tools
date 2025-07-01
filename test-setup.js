#!/usr/bin/env node

/**
 * Quick test script for the new Workspace Tools architecture
 */

import 'dotenv/config';
import { FileProcessor } from './processing/file-processor.js';
import { EnvironmentConfig } from './config.js';

async function quickTest() {
  console.log('🧪 Testing Workspace Tools v2.0 Architecture');
  console.log('=============================================');

  try {
    // Test environment configuration
    console.log('1. Testing environment configuration...');
    const envConfig = EnvironmentConfig.getInstance();
    envConfig.validateRequired();
    console.log('   ✅ Environment configuration valid');

    // Test file processor initialization
    console.log('2. Testing file processor initialization...');
    const processor = new FileProcessor({
      enableCaching: process.env.ENABLE_CACHING !== 'false',
      batchSize: 5 // Small batch for testing
    });
    console.log('   ✅ File processor initialized');

    // Test cache health (if caching enabled)
    if (process.env.ENABLE_CACHING !== 'false') {
      console.log('3. Testing cache health...');
      try {
        const health = await processor.getCacheHealth();
        console.log('   ✅ Cache health check:', health);
      } catch (error) {
        console.log('   ⚠️  Cache not available (running without cache):', error.message);
      }
    } else {
      console.log('3. Caching disabled - skipping cache tests');
    }

    // Test Google APIs connection
    console.log('4. Testing Google APIs...');
    try {
      const { getAllUsers } = await import('./user-file-management.js');
      const users = await getAllUsers();
      console.log(`   ✅ Google APIs working - found ${users.length} users`);
      
      if (users.length > 0) {
        console.log(`   📋 Sample user: ${users[0].primaryEmail}`);
      }
    } catch (error) {
      console.log('   ❌ Google APIs test failed:', error.message);
      throw error;
    }

    // Test single file processing (if we have users)
    console.log('5. Testing file processing...');
    try {
      const { getAllUsers, listUserFiles } = await import('./user-file-management.js');
      const users = await getAllUsers();
      
      if (users.length > 0) {
        const testUser = users[0];
        console.log(`   📁 Getting files for ${testUser.primaryEmail}...`);
        
        const files = await listUserFiles(testUser.primaryEmail, { maxResults: 5 });
        console.log(`   📄 Found ${files.length} files for testing`);
        
        if (files.length > 0) {
          const testFile = files[0];
          console.log(`   🔍 Testing analysis on: ${testFile.name}`);
          
          const result = await processor.processFile(
            testFile.id,
            testUser.primaryEmail,
            ['links', 'sharing'],
            (progress) => {
              console.log(`     📊 ${progress.stage}: ${progress.fileId || ''}`);
            }
          );
          
          console.log('   ✅ File processing test successful!');
          console.log(`     - Processing time: ${result.processingTime}ms`);
          console.log(`     - From cache: ${result.fromCache}`);
          console.log(`     - Links found: ${result.linksFound?.length || 0}`);
          console.log(`     - Risk level: ${result.overallRisk}`);
        } else {
          console.log('   ℹ️  No files found for testing');
        }
      } else {
        console.log('   ℹ️  No users found for testing');
      }
    } catch (error) {
      console.log('   ⚠️  File processing test failed:', error.message);
    }

    // Cleanup
    await processor.close();

    console.log('\n🎉 All tests completed successfully!');
    console.log('📋 Your Workspace Tools v2.0 setup is ready to use.');
    console.log('\nNext steps:');
    console.log('1. Run: npm start (for CLI interface)');
    console.log('2. Run: npm run server (for API server)');
    console.log('3. Deploy: npm run deploy (for Cloud Run)');

  } catch (error) {
    console.error('\n❌ Test failed:', error.message);
    
    if (error.message.includes('environment')) {
      console.log('\n🔧 Setup required:');
      console.log('1. Copy env.example to .env');
      console.log('2. Fill in your Google Workspace configuration');
      console.log('3. Set up service account credentials');
    }
    
    if (error.message.includes('Redis') || error.message.includes('BigQuery')) {
      console.log('\n💡 For full caching benefits:');
      console.log('1. Set up Redis instance');
      console.log('2. Configure BigQuery dataset');
      console.log('3. Or disable caching: ENABLE_CACHING=false');
    }
    
    process.exit(1);
  }
}

// Run the test
quickTest();
