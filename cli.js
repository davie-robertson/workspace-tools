/**
 * CLI Module
 * Handles command line argument parsing, validation, and help display
 */

// --- CLI PARAMS ---
// Parses command-line arguments provided to the script.
// All scans are enabled by default for comprehensive analysis.
// Supports argument abbreviations for convenience.
export function parseArgs() {
  const args = process.argv.slice(2); // Skip 'node' and script path
  const result = {};
  
  // Argument mappings for abbreviations
  const argMappings = {
    'h': 'help',
    'u': 'users',
    't': 'types', 
    'f': 'file',
    'j': 'json-output',
    's': 'sheets-output'
  };
  
  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--no' && i + 1 < args.length) {
      // Handle --no with comma-separated list of features to disable
      const disableList = args[i + 1].split(',').map(item => item.trim());
      for (const feature of disableList) {
        // Map feature names to internal argument names
        const featureMap = {
          'sharing-analysis': 'sharing-analysis',
          'sharing': 'sharing-analysis',
          'drive-analysis': 'drive-analysis', 
          'drive': 'drive-analysis',
          'calendars': 'include-calendars',
          'include-calendars': 'include-calendars',
          'shared-drives': 'include-shared-drives',
          'include-shared-drives': 'include-shared-drives',
          'drive-members': 'include-drive-members',
          'include-drive-members': 'include-drive-members'
        };
        
        const mappedFeature = featureMap[feature];
        if (mappedFeature) {
          result[mappedFeature] = false;
        } else {
          console.warn(`Warning: Unknown feature '${feature}' in --no list. Valid options: ${Object.keys(featureMap).join(', ')}`);
        }
      }
      i++; // Skip the value argument
    } else if (args[i].startsWith('--no-')) {
      // Handle legacy --no- prefix for backward compatibility
      const key = args[i].substring(5); // Remove '--no-'
      result[key] = false;
    } else if (args[i].startsWith('--')) {
      const key = args[i].substring(2);
      // Check if next argument exists and is not another option
      if (i + 1 < args.length && !args[i + 1].startsWith('--') && !args[i + 1].startsWith('-')) {
        result[key] = args[i + 1];
        i++; // Skip the value argument
      } else {
        result[key] = true; // For boolean flags without explicit values
      }
    } else if (args[i].startsWith('-') && !args[i].startsWith('--')) {
      // Handle single dash abbreviations
      const abbrev = args[i].substring(1);
      const fullKey = argMappings[abbrev] || abbrev;
      
      // Check if next argument exists and is not another option
      if (i + 1 < args.length && !args[i + 1].startsWith('--') && !args[i + 1].startsWith('-')) {
        result[fullKey] = args[i + 1];
        i++; // Skip the value argument
      } else {
        result[fullKey] = true; // For boolean flags without explicit values
      }
    }
  }
  
  // Set defaults for comprehensive scanning
  if (!result.file) { // Only apply defaults if not scanning a single file
    result['sharing-analysis'] = result['sharing-analysis'] !== undefined ? result['sharing-analysis'] : true;
    result['drive-analysis'] = result['drive-analysis'] !== undefined ? result['drive-analysis'] : true;
    result['include-calendars'] = result['include-calendars'] !== undefined ? result['include-calendars'] : true;
    result['include-shared-drives'] = result['include-shared-drives'] !== undefined ? result['include-shared-drives'] : true;
    result['include-drive-members'] = result['include-drive-members'] !== undefined ? result['include-drive-members'] : true;
  }
  
  return result;
}

// Added validation for CLI arguments
export function validateArgs(argv) {
  // Validate json-output-mode
  if (
    argv['json-output-mode'] &&
    !['overwrite', 'append'].includes(argv['json-output-mode'])
  ) {
    throw new Error(
      "Invalid value for '--json-output-mode'. Allowed values are 'overwrite' or 'append'."
    );
  }

  // Validate file types
  if (argv.types) {
    const validTypes = ['doc', 'sheet', 'slide'];
    const invalidTypes = argv.types
      .split(',')
      .map((t) => t.trim().toLowerCase())
      .filter((t) => !validTypes.includes(t));
    if (invalidTypes.length > 0) {
      throw new Error(
        `Invalid file types specified in '--types' or '-t': ${invalidTypes.join(
          ', '
        )}. Allowed types are ${validTypes.join(', ')}.`
      );
    }
  }

  // Validate file ID
  if (argv.file && typeof argv.file !== 'string') {
    throw new Error(
      "Invalid value for '--file' or '-f'. It must be a valid file ID string."
    );
  }

  // Validate users
  if (argv.users && typeof argv.users !== 'string') {
    throw new Error(
      "Invalid value for '--users' or '-u'. It must be a comma-separated string of user emails."
    );
  }

  // Validate json-output path
  if (argv['json-output'] && typeof argv['json-output'] !== 'string') {
    throw new Error(
      "Invalid value for '--json-output' or '-j'. It must be a valid file path string."
    );
  }

  // Warn about conflicting options
  if (argv.file && (argv.users || argv.types)) {
    console.warn(
      "Warning: When using '--file' or '-f', the '--users' and '--types' options are ignored."
    );
  }
}

export function showHelp() {
  console.log(`
Google Workspace Audit Tool
============================

Usage: node index.js [options]

By default, all scans are enabled for comprehensive analysis. Use flags to modify behavior or output.

Options:
  -h, --help                    Show this help message
  -u, --users <emails>          Comma-separated list of user emails to scan (default: all users)
  -t, --types <types>           Comma-separated list of file types: doc,sheet,slide (default: all types)
  -f, --file <fileId>           Scan a single file by its ID (disables other scans)
  -j, --json-output <path>      Export consolidated JSON file (default: streaming logs only)
  --json-output-mode <mode>     JSON export mode: overwrite|append (default: overwrite)
  -s, --sheets-output           Export to Google Sheets (requires OUTPUT_SHEET_ID env var)
  --no <features>               Disable specific features (comma-separated list)
  
Available features for --no:
  sharing-analysis (or 'sharing')        File sharing and permission analysis
  drive-analysis (or 'drive')            Drive analysis  
  calendars (or 'include-calendars')     Calendar analysis
  shared-drives (or 'include-shared-drives')  Shared Drive analysis
  drive-members (or 'include-drive-members')  Drive member analysis

Legacy options (still supported):
  --no-sharing-analysis         Disable file sharing and permission analysis
  --no-drive-analysis           Disable Drive analysis  
  --no-include-calendars        Disable calendar analysis
  --no-include-shared-drives    Disable Shared Drive analysis
  --no-include-drive-members    Disable Drive member analysis

Examples:
  node index.js                                    # Full comprehensive scan (all features enabled)
  node index.js -s                                 # Full scan + export to Google Sheets  
  node index.js -u alice@domain.com                # Scan specific user (all features)
  node index.js -j ./results.json                  # Full scan + export consolidated JSON
  node index.js -s -j ./results.json               # Export to both Sheets and JSON
  node index.js -t sheet,doc                       # Scan only Sheets and Docs (all other features)
  node index.js -f 1abc...xyz                      # Scan single file only
  node index.js --no drive-analysis                # Exclude Drive analysis (new syntax)
  node index.js --no sharing,calendars             # Disable sharing and calendar analysis
  node index.js --no drive,shared-drives -u alice@domain.com  # Basic scan for specific user
  node index.js --no-drive-analysis                # Exclude Drive analysis (legacy syntax)

Output formats:
- Streaming logs: Always created for real-time monitoring (automatically cleaned up)
- Google Sheets: Use -s/--sheets-output (requires OUTPUT_SHEET_ID environment variable)  
- JSON export: Use -j/--json-output <path> for consolidated traditional JSON format

Data collected by default:
- File metadata and sharing permissions
- Drive and Gmail quota information  
- External links and incompatible functions
- Sharing analysis: file sharing patterns, external permissions, public links
- Drive analysis: ownership, external sharing, Shared Drive settings/members, orphaned files, cross-tenant shares
- Calendar analysis: events, external meetings, recurring patterns
- Data transfer statistics
`);
}
