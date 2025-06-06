/**
 * Legacy Constants Module
 * 
 * @deprecated This file is deprecated. Use config.js for new code.
 * Keeping only for backward compatibility. Will be removed in future version.
 * 
 * All new constants should be added to config.js
 */

import { CONFIG } from './config.js';

// Re-export from new config for backward compatibility
export const SCOPES = CONFIG.API.SCOPES;
export const MAX_CELL_CHARACTERS = CONFIG.SHEETS.MAX_CELL_CHARACTERS;
export const SHEET_NAMES = CONFIG.SHEETS.NAMES;
export const ISSUE_TYPES = CONFIG.ISSUE_TYPES;
export const WORKSPACE_FILE_TYPES = CONFIG.FILE_TYPES.WORKSPACE;
export const CHART_CONFIG = CONFIG.CHART;
export const RETRY_CONFIG = CONFIG.API.RETRY;
export const SCAN_LIMITS = CONFIG.SCAN_LIMITS;

// Legacy alias
export const SUMMARY_SHEET_NAME = SHEET_NAMES.SUMMARY;
