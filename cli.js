/**
 * CLI Module
 * Handles command line argument parsing, validation, and help display
 */

// --- CLI PARAMS ---
// Parses command-line arguments provided to the script.
// Supports:
// --users: Comma-separated list of user emails to filter scans by.
// --types: Comma-separated list of file types (doc, sheet, slide) to filter scans by.
// --file: A single file ID to scan, bypassing the multi-user/multi-file scan.
// --json-output <filepath>: Path to a file where JSON output should be written.
// --json-output-mode <overwrite|append>: Mode for JSON output if the file exists. Defaults to 'overwrite'.
export function parseArgs() {
  const args = process.argv.slice(2); // Skip 'node' and script path
  const result = {};
  for (let i = 0; i < args.length; i++) {
    if (args[i].startsWith('--')) {
      const key = args[i].substring(2);
      // Check if next argument exists and is not another option
      if (i + 1 < args.length && !args[i + 1].startsWith('--')) {
        result[key] = args[i + 1];
        i++; // Skip the value argument
      } else {
        result[key] = true; // For boolean flags without explicit values
      }
    }
  }
  return result;
}

// Added validation for CLI arguments
export function validateArgs(argv) {
  if (
    argv['json-output-mode'] &&
    !['overwrite', 'append'].includes(argv['json-output-mode'])
  ) {
    throw new Error(
      "Invalid value for '--json-output-mode'. Allowed values are 'overwrite' or 'append'."
    );
  }

  if (argv.types) {
    const validTypes = ['doc', 'sheet', 'slide'];
    const invalidTypes = argv.types
      .split(',')
      .map((t) => t.trim().toLowerCase())
      .filter((t) => !validTypes.includes(t));
    if (invalidTypes.length > 0) {
      throw new Error(
        `Invalid file types specified in '--types': ${invalidTypes.join(
          ', '
        )}. Allowed types are ${validTypes.join(', ')}.`
      );
    }
  }

  if (argv.file && typeof argv.file !== 'string') {
    throw new Error(
      "Invalid value for '--file'. It must be a valid file ID string."
    );
  }

  if (argv.users && typeof argv.users !== 'string') {
    throw new Error(
      "Invalid value for '--users'. It must be a comma-separated string of user emails."
    );
  }
}

export function showHelp() {
  console.log(`
Google Workspace Audit Tool
============================

Usage: node index.js [options]

Options:
  --users <emails>              Comma-separated list of user emails to scan (optional)
  --types <types>               Comma-separated list of file types: doc,sheet,slide (optional)
  --file <fileId>               Scan a single file by its ID (optional)
  --json-output <path>          Export consolidated JSON file (optional - streaming logs are always created)
  --json-output-mode <mode>     JSON export mode: overwrite|append (default: overwrite)
  --sheets-output               Export to Google Sheets (requires OUTPUT_SHEET_ID env var)
  --include-calendars           Include calendar analysis for migration planning
  --migration-analysis          Enable enhanced migration analysis (sharing, location, calendars)
  --drive-analysis              Enable comprehensive Drive analysis (My Drive & Shared Drives)
  --include-shared-drives       Include Shared Drive analysis (requires --drive-analysis)
  --include-drive-members       Include Drive member analysis (requires --drive-analysis)
  --help, -h                    Show this help message

Examples:
  node index.js                                    # Scan all users (streaming logs only)
  node index.js --sheets-output                    # Scan and export to Google Sheets  
  node index.js --users alice@domain.com          # Scan specific user
  node index.js --json-output ./results.json      # Scan and export consolidated JSON
  node index.js --sheets-output --json-output ./results.json  # Export to both formats
  node index.js --types sheet,doc                 # Scan only Sheets and Docs
  node index.js --file 1abc...xyz                 # Scan single file
  node index.js --migration-analysis              # Enable enhanced migration analysis
  node index.js --drive-analysis                  # Enable comprehensive Drive analysis
  node index.js --drive-analysis --include-shared-drives  # Include Shared Drive analysis
  node index.js --include-calendars --users alice@domain.com  # Include calendar analysis

The tool always creates streaming logs (scan-log.jsonl, summary-log.jsonl) during the scan for
real-time monitoring and data safety. These files are automatically cleaned up after processing.

Output formats:
- Streaming logs: Always created for real-time monitoring (automatically cleaned up)
- Google Sheets: Use --sheets-output (requires OUTPUT_SHEET_ID environment variable)  
- JSON export: Use --json-output <path> for consolidated traditional JSON format

Data collected:
- File metadata and sharing permissions
- Drive and Gmail quota information (in MB)
- External links and incompatible functions (one row per issue in Sheets)
- Data transfer statistics
- Migration analysis: sharing patterns, file locations, calendar dependencies (when enabled)
- Drive analysis: ownership, external sharing, Shared Drive settings/members, orphaned files (when enabled)
`);
}
