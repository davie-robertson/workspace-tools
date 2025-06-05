# Google Workspace Migration Analysis Tool

This Node.js (ESM) project is designed for Google Workspace administrators to audit and analyze Google Workspace files (Docs, Sheets, Slides) across their domain. It scans files for links, compatibility issues, and metadata, and outputs results to a Google Sheet or JSON file for further analysis.

**🚀 NEW: Enhanced Migration Analysis Features**
- **File Sharing Analysis**: Identifies external shares, public links, and cross-tenant permissions
- **Drive Location Detection**: Distinguishes personal drives vs shared drives and folder structures  
- **Calendar Migration Planning**: Scans future events, recurring meetings, and external attendees
- **Migration Risk Assessment**: Automatically categorizes files and events by migration complexity

## Features
- **Comprehensive File Scanning**: Scans Google Docs, Sheets, and Slides for all users in your domain.
- **Link Extraction**: Identifies and lists links to other Workspace files, including hyperlinks, embedded object links, and formula references.
- **Google Sheets Compatibility Analysis**: Detects Google Workspace-specific functions in Sheets that may cause compatibility issues with other platforms.
- **🆕 Migration Analysis**: 
  - **File Sharing Analysis**: Detects external shares, public links, domain-wide sharing, and cross-tenant permissions
  - **Drive Location Detection**: Identifies personal drives vs shared drives, folder structures, and orphaned files
  - **Migration Risk Assessment**: Automatically categorizes files by migration complexity (low/medium/high)
- **🆕 Calendar Migration Planning**:
  - **Future Events Analysis**: Scans upcoming events and recurring meetings
  - **External Dependencies**: Identifies external attendees and cross-tenant meetings
  - **Meeting Room Resources**: Detects Google Workspace meeting room bookings
  - **Migration Complexity Assessment**: Categorizes events by migration difficulty
- **🆕 Drive Analysis**: 
  - **My Drive Analysis**: Scans user's personal Drive for file counts, sharing patterns, and storage usage
  - **Shared Drive Discovery**: Identifies all Shared Drives accessible to users
  - **External User Detection**: Finds users outside your domain with access to drives and files
  - **Orphaned File Identification**: Discovers files without proper folder organization
  - **Drive Member Analysis**: Analyzes Shared Drive membership and roles
  - **Risk Assessment**: Categorizes drives by security and migration risk levels
- **🆕 Comprehensive External Sharing Analysis**:
  - **Cross-Domain Sharing**: Identifies files and drives shared with external domains
  - **Public Link Detection**: Finds files with public or "anyone with link" access
  - **Drive-Level Permissions**: Analyzes Shared Drive member permissions and restrictions
- **Streaming-First Architecture**: Always creates streaming logs during scan for real-time monitoring and data safety.
- **Flexible Output Options**:
  - **Streaming Logs**: Always created (JSONL format) and automatically cleaned up after processing.
  - **Google Sheets**: Optional export directly to a specified Google Sheet with detailed tabs.
  - **JSON File**: Optional consolidated JSON export with overwrite or append modes.
- **Batch Processing**: Processes users and files in batches to optimize API usage and avoid quota limits.
- **Error Handling and Retry Logic**: Implements exponential backoff for API retries and logs detailed error messages for debugging.
- **CLI Argument Validation**: Ensures correctness of all CLI arguments before execution.
- **Environment Variable Validation**: Verifies that all required environment variables are set before running the script.
- **Modular Design**: Organized into reusable modules for API calls, link extraction, and Google Sheets operations.

## Additional Features

### File Metadata Retrieval
- Retrieves detailed metadata for each file, including:
  - File ID, name, and MIME type
  - Web view link for easy access
  - Owners' email addresses
  - Creation and modification timestamps
  - File size (for non-Google Workspace files)
  - Permissions and sharing status

### JSON Output Enhancements
- Supports appending new scan results to an existing JSON file, merging statistics and file lists.
- Includes detailed summaries of:
  - Total files scanned by type (Docs, Sheets, Slides, etc.)
  - Files containing links
  - Google Sheets with incompatible functions

### Debugging and Logging
- Provides detailed console logs for each step of the process.
- Warns about skipped files (e.g., the output Google Sheet itself).

## Data Transfer and Bandwidth Usage

This tool is designed to be **bandwidth-efficient** and does **not download actual files** during scanning. Instead, it uses Google's export APIs to retrieve structured data:

### What Gets Transferred
- **Google Docs**: Structured JSON containing document text, links, and metadata (via Google Docs API)
- **Google Sheets**: Cell values, formulas, and formatting data (via Google Sheets API)  
- **Google Slides**: Slide content, text, and embedded links (via Google Slides API)
- **File Metadata**: Name, size, permissions, sharing status (via Google Drive API)
- **User Information**: Email addresses, quota data (via Admin SDK and Gmail API)

### Bandwidth Efficiency
- **No file downloads**: The tool never downloads .docx, .xlsx, or .pptx files
- **Small API responses**: Typically 1-10 KB per file (vs. MB for actual files)
- **Quota information**: Drive and Gmail usage data in minimal JSON format
- **Structured data only**: Only the content needed for analysis is retrieved

### Data Transfer Monitoring
The tool includes built-in monitoring that tracks and reports:
- **Total API calls** made during the scan
- **Data transferred** (requests sent + responses received) 
- **Average response size** per API call
- **Scan duration** and efficiency metrics
- **Breakdown by service** (Drive, Docs, Sheets, Slides, Admin, Gmail APIs)

Example output from a typical scan:
```
DATA TRANSFER REPORT
============================================================
Scan Duration: 5.2 seconds
Total API Calls: 15
Total Data Transfer: 47.3 KB
  ↑ Requests Sent: 8.1 KB
  ↓ Responses Received: 39.2 KB
Average Response Size: 2.6 KB

API Calls by Service:
  DRIVE: 8 calls
  DOCS: 3 calls  
  SHEETS: 2 calls
  ADMIN: 1 calls
  GMAIL: 1 calls
```

This approach allows the tool to scan hundreds or thousands of files while using only a few MB of bandwidth total, making it suitable for large-scale audits without significant network impact.

### Streaming Output for Large Scans

For large-scale scans (1000+ files), the tool uses a **streaming-first architecture** to prevent memory issues and provide real-time progress visibility:

- **Scan Log** (`scan-log.jsonl`): JSONL format file where each file's data is written immediately after processing
- **Summary Log** (`summary-log.jsonl`): JSONL format file tracking user progress, quota data, and scan events  
- **Automatic Cleanup**: Streaming log files are automatically cleaned up after processing is complete
- **Consolidated JSON**: Optional export generated from streaming logs at the end (use `--json-output`)
- **Real-time Monitoring**: View progress by watching the log files during long scans

Benefits of streaming approach:
- ✅ **Memory efficient**: No risk of running out of RAM on large datasets
- ✅ **Progress visibility**: Monitor scan progress in real-time  
- ✅ **Data safety**: Partial results preserved if scan is interrupted
- ✅ **Flexible output**: Can generate traditional JSON or Google Sheets from streaming logs
- ✅ **Clean filesystem**: Log files automatically cleaned up when processing completes

Example streaming output files:
```bash
# Real-time file processing log
scan-log.jsonl          # Each line = one processed file
summary-log.jsonl       # Each line = progress/quota/user event
consolidated-output.json # Final traditional JSON format
```

## Prerequisites
1. **Google Cloud Project**: Create a project in the [Google Cloud Console](https://console.cloud.google.com/).
2. **Enable APIs**: Enable these APIs for your project:
   - Admin SDK
   - Google Drive API
   - Google Docs API
   - Google Sheets API
   - Google Slides API
3. **Service Account**:
   - Create a service account and download the JSON key.
   - Grant domain-wide delegation to the service account.
   - In your Google Admin console, add the required OAuth scopes to the service account:
     - `https://www.googleapis.com/auth/admin.directory.user.readonly`
     - `https://www.googleapis.com/auth/drive.readonly`
     - `https://www.googleapis.com/auth/documents.readonly`
     - `https://www.googleapis.com/auth/presentations.readonly`
     - `https://www.googleapis.com/auth/spreadsheets` // required for writing to the Google Sheet
4. **Google Sheet**: Create a Google Sheet to store the output. Share it with the service account email.

## Setup
1. **Get the project files**
   - If you have Git installed:
     ```bash
     git clone https://github.com/davie-robertson/workspace-tools.git
     cd workspace-tools
     ```
   - If you do **not** have Git installed:
     1. Go to your repository page on GitHub (or your hosting platform).
     2. Click the green **Code** button and select **Download ZIP**.
     3. Extract the ZIP file to your desired location.
     4. Open a terminal and `cd` into the extracted `workspace-tools` directory.
2. **Install Node.js (if not already installed)**
   - This project requires Node.js v18 or newer. You can check your version with:
     ```bash
     node --version
     ```
   - [Download Node.js here](https://nodejs.org/en/download/) or use a version manager like [nvm](https://github.com/nvm-sh/nvm):
     ```bash
     nvm install 18
     nvm use 18
     ```
3. **Install dependencies**
   ```bash
   npm install
   ```
3. **Add your service account credentials JSON file**
   - Download the service account JSON key from the Google Cloud Console.
   - Save it in your project directory (for example, as `workspace-scanner-credentials.json`).
   - Set the `GOOGLE_APPLICATION_CREDENTIALS` environment variable to the path of this file. You can do this in your `.env` file or in your shell before running the script:
     ```env
     GOOGLE_APPLICATION_CREDENTIALS=./workspace-scanner-credentials.json
     ADMIN_USER=admin@yourdomain.com
     OUTPUT_SHEET_ID=your_google_sheet_id
     ```
   - Only the following variables are required in your `.env` file:
     - `GOOGLE_APPLICATION_CREDENTIALS` (path to your service account JSON file)
     - `ADMIN_USER` (the super admin email for your domain)
     - `OUTPUT_SHEET_ID` (the ID from your Google Sheet's URL)
   - The service account's email and private key are read automatically from the JSON file; you do **not** need to copy them into the `.env` file.
   - If you do not want to use a `.env` file, you can set the environment variable in your shell:
     ```bash
     export GOOGLE_APPLICATION_CREDENTIALS=./workspace-scanner-credentials.json
     export ADMIN_USER=admin@yourdomain.com
     export OUTPUT_SHEET_ID=your_google_sheet_id
     ```

## Usage

### Basic Usage
```bash
# Run a full scan of all users (streaming logs only)
npm start
# or
node index.js

# Run a full scan and export to Google Sheets  
node index.js --sheets-output

# Show help and available options
node index.js --help
```

### Command Line Options

```bash
node index.js [options]
```

**Available Options:**
- `--users <emails>` - Comma-separated list of user emails to scan (optional)
- `--types <types>` - Comma-separated list of file types: doc,sheet,slide (optional)  
- `--file <fileId>` - Scan a single file by its ID (optional)
- `--json-output <path>` - Export consolidated JSON file (optional - streaming logs always created)
- `--json-output-mode <mode>` - JSON export mode: overwrite|append (default: overwrite)
- `--sheets-output` - Export to Google Sheets (requires OUTPUT_SHEET_ID env var)
- `--help, -h` - Show help message

**Important Notes:**
- **Streaming logs are always created** during the scan (`scan-log.jsonl`, `summary-log.jsonl`) for real-time monitoring
- **Streaming logs are automatically cleaned up** after processing completes
- **`--json-output` is only needed** if you want a consolidated JSON file in addition to the streaming logs
- **`--sheets-output` is only needed** if you want to export results to Google Sheets

### Examples

```bash
# Scan all users (streaming logs only)
node index.js

# Scan all users and export to Google Sheets
node index.js --sheets-output

# Scan specific user only
node index.js --users alice@domain.com

# Scan multiple users and export to Google Sheets
node index.js --users alice@domain.com,bob@domain.com --sheets-output

# Scan only specific file types
node index.js --types sheet,doc

# Scan specific user for only Google Sheets and export consolidated JSON
node index.js --users alice@domain.com --types sheet --json-output ./results.json

# Scan a single file by ID
node index.js --file 1abc...xyz

# Export consolidated JSON file (in addition to streaming logs)
node index.js --json-output ./results.json

# Export consolidated JSON and append to existing file
node index.js --json-output ./results.json --json-output-mode append

# Export to both Google Sheets and consolidated JSON
node index.js --sheets-output --json-output ./results.json

# Combine multiple options
node index.js --users alice@domain.com --types doc,sheet --sheets-output --json-output ./alice-scan.json
```

### Migration Analysis Usage

**🆕 Enhanced features for workspace migration planning:**

```bash
# Enable migration analysis for all files (sharing + location analysis)
node index.js --migration-analysis

# Include calendar analysis for migration planning  
node index.js --include-calendars --users alice@domain.com

# Full migration analysis (files + calendars)
node index.js --migration-analysis --include-calendars

# Migration analysis for specific users only
node index.js --migration-analysis --users alice@domain.com,bob@domain.com

# Export complete migration analysis to JSON
node index.js --migration-analysis --include-calendars --json-output migration-report.json

# Google Workspace to Microsoft 365 migration assessment
node index.js --migration-analysis --include-calendars --users alice@domain.com --json-output m365-migration.json
```

**Migration Analysis Features:**
- `--migration-analysis` - Enables file sharing and location analysis for migration planning
- `--include-calendars` - Adds calendar scanning for meeting dependencies and external attendees

**Migration Analysis Output:**
- **File Sharing Risks**: External shares, public links, cross-tenant permissions
- **Location Complexity**: Personal drives, shared drives, folder depth analysis  
- **Calendar Dependencies**: Future events, recurring meetings, external attendees, meeting rooms
- **Risk Assessment**: Automatic categorization by migration complexity (low/medium/high)

**Required Environment Variables for Migration Analysis:**
```bash
PRIMARY_DOMAIN=yourdomain.com  # Your workspace domain for external share detection
```

## Migration Analysis Features

### File Sharing Analysis
- **External Share Detection**: Identifies files shared with users outside your primary domain
- **Public Link Detection**: Finds files with public or "anyone with link" sharing
- **Cross-Tenant Analysis**: Maps sharing relationships across different Google Workspace tenants
- **Permission Complexity Assessment**: Categorizes sharing by migration risk level
- **Domain-Wide Sharing**: Identifies files shared with entire domains

### Drive Location Analysis  
- **Personal vs Shared Drives**: Distinguishes between individual user drives and shared team drives
- **Folder Structure Mapping**: Captures full folder paths for migration planning
- **Orphaned File Detection**: Identifies files without proper folder organization
- **Migration Complexity Scoring**: Assesses difficulty of moving files based on location and structure

### Calendar Migration Planning
- **Future Events Scanning**: Analyzes upcoming events up to 2 years in advance
- **Recurring Meeting Analysis**: Identifies complex recurring patterns that may need special handling
- **External Attendee Detection**: Maps external meeting participants across domains
- **Google Meet Integration**: Identifies meetings using Google Meet vs external platforms
- **Meeting Room Resources**: Detects Google Workspace meeting room bookings
- **Migration Risk Assessment**: Categorizes events by migration complexity

### Migration Risk Categories
- **Low Risk**: Simple files with minimal sharing, basic calendar events
- **Medium Risk**: Files with some external sharing, recurring meetings with external attendees
- **High Risk**: Complex sharing patterns, shared drive content, public files
- **Critical Risk**: Extensive cross-tenant dependencies, complex recurring meetings with many externals

## Usage Examples

### Basic Migration Analysis
```bash
# Enable migration analysis for all users
node index.js --migration-analysis

# Analyze specific users with calendar data
node index.js --migration-analysis --include-calendars --users alice@domain.com,bob@domain.com

# Full migration assessment with JSON export
node index.js --migration-analysis --include-calendars --json-output migration-report.json
```

### Targeted Analysis
```bash
# Analyze only Google Sheets for formula compatibility
node index.js --migration-analysis --types sheet --json-output sheets-analysis.json

# Calendar-only analysis for meeting planning
node index.js --include-calendars --users alice@domain.com --json-output calendar-analysis.json

# Single file migration assessment
node index.js --migration-analysis --file 1abc123def456ghi789
```

### Export Options
```bash
# Export to Google Sheets with migration data
node index.js --migration-analysis --sheets-output

# Comprehensive report with all features
node index.js --migration-analysis --include-calendars --sheets-output --json-output full-report.json
```

### Drive Analysis
```bash
# Enable comprehensive Drive analysis
node index.js --drive-analysis

# Include Shared Drive analysis
node index.js --drive-analysis --include-shared-drives

# Include Drive member analysis
node index.js --drive-analysis --include-shared-drives --include-drive-members

# Combine with migration analysis for complete audit
node index.js --migration-analysis --drive-analysis --include-shared-drives

# Export Drive analysis to JSON
node index.js --drive-analysis --json-output ./drive-audit.json
```

## Viewing Results
- **Google Sheets**: Open your configured Google Sheet. The script will create multiple tabs with summary and detailed information.
- **JSON Files**: Open the generated JSON file to view structured data that can be processed by other tools.

## Deployment Notes
- This script is intended for use by Google Workspace administrators.
- Make sure the service account has domain-wide delegation and access to the required APIs and users.
- The script processes users and files in batches to avoid API limits - warning messages will be shown if you hit the API quota limits and the script will pause for a few seconds before retrying.

## Troubleshooting
- If you see permission errors, check that:
  - The service account is shared on the output Google Sheet.
  - The service account has domain-wide delegation and the correct OAuth scopes.
  - The `ADMIN_USER` is a super admin in your domain.
- If you see API quota errors, try reducing the batch size or running the script less frequently.

## License
MIT
