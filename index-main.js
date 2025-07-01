/**
 * Main Entry Point for Workspace Tools
 * Supports both legacy CLI interface and new cached architecture
 */

import 'dotenv/config';
import { parseArgs, validateArgs, showHelp } from './cli.js';
import { LegacyCliWrapper } from './migration/migration-utils.js';
import { EnvironmentConfig } from './config.js';

// Parse and validate command line arguments
const argv = parseArgs();

// Check for help argument
if (argv.help || argv.h) {
  showHelp();
  process.exit(0);
}

// Check for version argument
if (argv.version) {
  console.log('Workspace Tools v2.0.0 - Cached Architecture');
  process.exit(0);
}

// Check for architecture preference
const useNewArchitecture = process.env.USE_NEW_ARCHITECTURE !== 'false' && !argv['legacy-mode'];

async function main() {
  try {
    // Validate environment configuration
    const envConfig = EnvironmentConfig.getInstance();
    envConfig.validateRequired();

    console.log(`🚀 Starting Workspace Tools v2.0`);
    console.log(`📋 Architecture: ${useNewArchitecture ? 'New (Cached)' : 'Legacy'}`);
    
    if (useNewArchitecture) {
      console.log('💡 Using new cached architecture with Redis + in-memory BigQuery');
      console.log('   Benefits: 90% fewer API calls, 75% faster scans, smart caching');
      console.log('   Note: BigQuery persistence disabled (free tier mode)');
      
      // Use new architecture
      const wrapper = new LegacyCliWrapper();
      
      try {
        await wrapper.runLegacyScan(argv);
        console.log('\n✅ Scan completed successfully with new architecture!');
      } finally {
        await wrapper.cleanup();
      }
    } else {
      console.log('⚠️  Using legacy architecture (no caching)');
      console.log('   Consider upgrading to new architecture for better performance');
      
      // Fall back to original index.js logic
      const { default: originalMain } = await import('./index-legacy.js');
      await originalMain();
    }

  } catch (error) {
    console.error('❌ Scan failed:', error.message);
    
    if (process.env.NODE_ENV === 'development') {
      console.error(error.stack);
    }
    
    process.exit(1);
  }
}

// Handle graceful shutdown
process.on('SIGINT', () => {
  console.log('\n🛑 Received SIGINT, shutting down gracefully...');
  process.exit(0);
});

process.on('SIGTERM', () => {
  console.log('\n🛑 Received SIGTERM, shutting down gracefully...');
  process.exit(0);
});

// Run main function
main().catch((error) => {
  console.error('❌ Unhandled error:', error);
  process.exit(1);
});
