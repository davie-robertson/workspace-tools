/**
 * Configuration Module
 * Centralised configuration and environment variable management
 */

/**
 * Environment Configuration
 * Validates and exports all environment variables with proper defaults
 */
export class EnvironmentConfig {
  static #instance = null;
  
  constructor() {
    if (EnvironmentConfig.#instance) {
      return EnvironmentConfig.#instance;
    }
    
    // Don't validate during construction to allow dotenv to load first
    EnvironmentConfig.#instance = this;
  }
  
  static getInstance() {
    if (!EnvironmentConfig.#instance) {
      EnvironmentConfig.#instance = new EnvironmentConfig();
    }
    return EnvironmentConfig.#instance;
  }
  
  // Required environment variables
  get adminUser() {
    return process.env.ADMIN_USER;
  }
  
  get googleApplicationCredentials() {
    return process.env.GOOGLE_APPLICATION_CREDENTIALS;
  }
  
  get outputSheetId() {
    return process.env.OUTPUT_SHEET_ID;
  }
  
  get primaryDomain() {
    return process.env.PRIMARY_DOMAIN;
  }
  
  // Caching Configuration
  get enableCaching() {
    return process.env.ENABLE_CACHING !== 'false';
  }
  
  get redisUrl() {
    return process.env.REDIS_URL;
  }
  
  get redisHost() {
    return process.env.REDIS_HOST || 'localhost';
  }
  
  get redisPort() {
    return parseInt(process.env.REDIS_PORT) || 6379;
  }
  
  get redisPassword() {
    return process.env.REDIS_PASSWORD;
  }
  
  get cacheDataset() {
    return process.env.CACHE_DATASET || 'workspace_cache';
  }
  
  get metadataTtl() {
    return parseInt(process.env.METADATA_TTL) || 3600;
  }
  
  get analysisTtl() {
    return parseInt(process.env.ANALYSIS_TTL) || 7200;
  }
  
  get batchSize() {
    return parseInt(process.env.BATCH_SIZE) || 50;
  }
  
  get googleCloudProject() {
    // First check if explicitly set in environment
    if (process.env.GOOGLE_CLOUD_PROJECT) {
      return process.env.GOOGLE_CLOUD_PROJECT;
    }
    
    // Otherwise, try to extract from service account JSON file
    try {
      const credentialsPath = process.env.GOOGLE_APPLICATION_CREDENTIALS;
      if (credentialsPath) {
        const fs = require('fs');
        const credentials = JSON.parse(fs.readFileSync(credentialsPath, 'utf8'));
        return credentials.project_id;
      }
    } catch (error) {
      console.warn('Could not extract project ID from service account file:', error.message);
    }
    
    return undefined;
  }

  // Validation methods
  validateRequired() {
    const requiredVars = ['ADMIN_USER', 'GOOGLE_APPLICATION_CREDENTIALS'];
    const missing = requiredVars.filter(varName => !process.env[varName]);
    
    if (missing.length > 0) {
      throw new Error(`Missing required environment variables: ${missing.join(', ')}`);
    }
  }
  
  validateForSheetsOutput() {
    if (!this.outputSheetId) {
      throw new Error('OUTPUT_SHEET_ID is required when using --sheets-output');
    }
  }
  
  validateForAnalysis() {
    if (!this.primaryDomain) {
      throw new Error('PRIMARY_DOMAIN is required for migration and drive analysis');
    }
  }
}

/**
 * Application Configuration Constants
 * Centralised location for all application constants
 */
export const CONFIG = {
  // API Configuration
  API: {
    SCOPES: [
      'https://www.googleapis.com/auth/admin.directory.user.readonly',
      'https://www.googleapis.com/auth/drive.readonly',
      'https://www.googleapis.com/auth/documents.readonly',
      'https://www.googleapis.com/auth/presentations.readonly',
      'https://www.googleapis.com/auth/spreadsheets',
      'https://www.googleapis.com/auth/gmail.readonly',
      'https://www.googleapis.com/auth/calendar.readonly',
    ],
    RETRY: {
      maxRetries: 3,
      baseDelay: 1000,
      maxDelay: 10000,
    },
  },
  
  // File Type Constants
  FILE_TYPES: {
    WORKSPACE: {
      DOCUMENT: 'application/vnd.google-apps.document',
      SPREADSHEET: 'application/vnd.google-apps.spreadsheet',
      PRESENTATION: 'application/vnd.google-apps.presentation',
      FORM: 'application/vnd.google-apps.form',
      DRAWING: 'application/vnd.google-apps.drawing',
    },
    DISPLAY_NAMES: {
      'application/vnd.google-apps.document': 'Google Doc',
      'application/vnd.google-apps.spreadsheet': 'Google Sheet',
      'application/vnd.google-apps.presentation': 'Google Slide',
    },
  },
  
  // Sheet Configuration
  SHEETS: {
    MAX_CELL_CHARACTERS: 49500,
    NAMES: {
      SUMMARY: 'Summary',
      ISSUES: 'Issues',
      QUOTA: 'UserQuota',
      CHART: 'Issue Chart',
      DRIVES: 'Drive Analysis',
      SHARED_DRIVES: 'Shared Drives',
      EXTERNAL_SHARING: 'External Sharing',
      ORPHANED_FILES: 'Orphaned Files',
      CROSS_TENANT_SHARES: 'Cross-Tenant Shares',
      DRIVE_MEMBERS: 'Drive Members',
    },
  },
  
  // Issue Types
  ISSUE_TYPES: {
    EXTERNAL_LINK: 'External Link',
    INCOMPATIBLE_FUNCTION: 'Incompatible Function',
    NO_ISSUES: 'No Issues',
  },
  
  // Scanning Limits
  SCAN_LIMITS: {
    maxFilesPerUser: 1000,
    maxUsersToScan: 100,
  },
  
  // Chart Configuration
  CHART: {
    width: 600,
    height: 400,
    position: {
      row: 2,
      column: 1,
    },
  },
  
  // Streaming Log Configuration
  STREAMING: {
    scanLogFile: 'scan-log.jsonl',
    summaryLogFile: 'summary-log.jsonl',
  },
  
  // Google Sheets Configuration
  googleSheets: {
    get outputSheetId() {
      return EnvironmentConfig.getInstance().outputSheetId;
    }
  },
};

/**
 * Feature Flags Configuration
 * Manages which features are enabled/disabled based on CLI arguments
 */
export class FeatureConfig {
  constructor(args) {
    this.args = args;
    this.singleFileMode = !!args.file;
    
    // All features enabled by default unless explicitly disabled or in single file mode
    this.enabledFeatures = this.calculateEnabledFeatures();
  }
  
  calculateEnabledFeatures() {
    const features = {
      sharingAnalysis: true,
      driveAnalysis: true,
      calendars: true,
      sharedDrives: true,
      driveMembers: true,
    };
    
    // Disable all advanced features in single file mode
    if (this.singleFileMode) {
      return {
        sharingAnalysis: false,
        driveAnalysis: false,
        calendars: false,
        sharedDrives: false,
        driveMembers: false,
      };
    }
    
    // Apply --no flag overrides
    const disabledFeatures = this.args.no || [];
    const legacyDisableFlags = {
      'no-sharing-analysis': 'sharingAnalysis',
      'no-drive-analysis': 'driveAnalysis',
      'no-include-calendars': 'calendars',
      'no-include-shared-drives': 'sharedDrives',
      'no-include-drive-members': 'driveMembers',
    };
    
    // Handle legacy disable flags
    Object.entries(legacyDisableFlags).forEach(([flag, feature]) => {
      if (this.args[flag] === false) {
        features[feature] = false;
      }
    });
    
    // Handle new --no flag with feature list
    disabledFeatures.forEach(feature => {
      const normalisedFeature = this.normaliseFeatureName(feature);
      if (normalisedFeature && features.hasOwnProperty(normalisedFeature)) {
        features[normalisedFeature] = false;
      }
    });
    
    return features;
  }
  
  normaliseFeatureName(feature) {
    const featureMap = {
      'sharing': 'sharingAnalysis',
      'sharing-analysis': 'sharingAnalysis',
      'drive': 'driveAnalysis', 
      'drive-analysis': 'driveAnalysis',
      'calendars': 'calendars',
      'include-calendars': 'calendars',
      'shared-drives': 'sharedDrives',
      'include-shared-drives': 'sharedDrives',
      'drive-members': 'driveMembers',
      'include-drive-members': 'driveMembers',
    };
    
    return featureMap[feature.toLowerCase()];
  }
  
  isEnabled(feature) {
    return this.enabledFeatures[feature] === true;
  }
  
  getEnabledFeatures() {
    return Object.entries(this.enabledFeatures)
      .filter(([_, enabled]) => enabled)
      .map(([feature, _]) => feature);
  }
}
