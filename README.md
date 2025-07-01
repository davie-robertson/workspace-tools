# Workspace Tools - Google Workspace File Scanner & Analyzer

A comprehensive solution for scanning, analyzing, and monitoring Google Workspace files with advanced caching, consolidated analysis, and Cloud Run deployment capabilities.

## 🚀 New Architecture (v2.0) Features

### Core Capabilities
- **Consolidated File Scanning**: Single pipeline for processing all Google Workspace file types
- **Advanced Caching**: Redis + BigQuery dual-layer caching for optimal performance  
- **Link Analysis**: Detect and analyze links between workspace files
- **Sharing Analysis**: Comprehensive sharing and permission analysis
- **Migration Analysis**: Assess migration complexity and compatibility
- **Location Analysis**: Analyze file placement and organization

### Architecture Improvements
- **90% Reduction in API Calls**: Smart caching eliminates redundant file scans
- **75% Faster Scan Times**: Redis caching for active scans, BigQuery for persistence
- **Scalable Design**: Built for Google Cloud Run with auto-scaling
- **Persistent Storage**: BigQuery for long-term analysis and reporting
- **Batch Processing**: Optimized batch processing for large workspaces

## 🚀 Quick Start

### 📖 **New to this project? Start here: [Quick Start Guide](./QUICK_START.md)**

**Want to get running fast?** Our [Quick Start Guide](./QUICK_START.md) gets you from zero to scanning files in 10 minutes with just the essential setup.

### 🖥️ **Complete Setup: [Local Setup Guide](./LOCAL_SETUP_GUIDE.md)**

**Need full configuration?** Follow our comprehensive [Local Setup Guide](./LOCAL_SETUP_GUIDE.md) which explains:
- Exactly what to install and configure
- Step-by-step Google Workspace setup
- What happens at each stage of execution
- Progressive testing from basic to full features
- **When and how to set up Redis/BigQuery** (optional for production performance)

### 🖥️ Local Development (After Setup)

```bash
# 1. Install dependencies
npm install

# 2. Configure environment (see guides above for details)
cp env.example .env
# Edit .env with your Google Workspace settings

# 3. Test your setup
node test-setup.js

# 4. Run basic scan (works without Redis/BigQuery)
npm start -- --users your-email@yourdomain.com

# 5. Run API server
npm run dev
```

**📝 Note:** The system works immediately with just Google Workspace credentials. Redis and BigQuery are optional performance enhancements for production use.

### ☁️ Cloud Deployment (After Local Success)

```bash
# Automated deployment
npm run deploy

# Or step-by-step (see Deployment Guide)
npm run deploy:setup    # Setup infrastructure
# Configure secrets manually
npm run deploy:build    # Build and deploy
```

**📚 Complete Documentation:**
- **[⚡ Quick Start Guide](./QUICK_START.md)** - Get running in 10 minutes
- **[🖥️ Local Setup Guide](./LOCAL_SETUP_GUIDE.md)** - Complete local installation and configuration
- **[🚀 Deployment Guide](./DEPLOYMENT_CHECKLIST.md)** - Cloud deployment step-by-step
- **[📋 Implementation Summary](./IMPLEMENTATION_SUMMARY.md)** - Architecture and feature overview

## 📋 Prerequisites

Before starting, ensure you have:
- **Node.js 18+** and npm installed
- **Google Workspace admin access** (for API authorization)
- **Google Cloud Project** (for Cloud Run deployment)
- **Service Account** with domain-wide delegation

*See the [Local Setup Guide](./LOCAL_SETUP_GUIDE.md) for detailed prerequisites and installation instructions.*
- **Comprehensive File Scanning**: Scans Google Docs, Sheets, and Slides for all users in your domain
- **Link Extraction**: Identifies and lists links to other Workspace files, including hyperlinks, embedded objects, and formula references
- **Google Sheets Compatibility Analysis**: Detects Google Workspace-specific functions that may cause compatibility issues
- **File Sharing Analysis**: 
  - Detects external shares, public links, domain-wide sharing, and cross-tenant permissions
  - Identifies security risks and sharing complexity patterns
  - Maps external domain dependencies and access patterns
- **Drive Structure Analysis**: 
  - Distinguishes personal drives vs shared drives and folder structures
  - Identifies orphaned files without proper folder organisation
  - Maps drive ownership and access patterns
  - Analyses Shared Drive membership, roles, and permissions
- **Calendar Migration Planning**:
  - Scans future events and recurring meetings (up to 2 years ahead)
  - Identifies external attendees and cross-tenant meeting dependencies
  - Detects Google Meet integration and meeting room resource bookings
  - Categorises events by migration complexity
- **Migration Risk Assessment**: 
  - Automatically categorises all content by migration complexity (low/medium/high/critical)
  - Identifies potential blockers and security concerns
  - Provides actionable insights for migration planning

### Modern CLI Interface
- **All Scans Enabled by Default**: Runs comprehensive analysis without requiring configuration
- **Argument Abbreviations**: Use `-u` for users, `-t` for types, `-j` for JSON output, etc.
- **Flexible Disable Options**: Use `--no sharing,drive,calendars` to disable specific features
- **Legacy Support**: Maintains compatibility with older `--no-<option>` flag syntax
- **Smart Validation**: Validates all arguments and environment variables before execution

### Output & Export Options
- **Streaming-First Architecture**: Always creates streaming logs during scan for real-time monitoring and data safety
- **Multiple Export Formats**:
  - **Streaming Logs**: Always created (JSONL format) and automatically cleaned up after processing
  - **Google Sheets**: Optional export directly to a specified Google Sheet with detailed tabs
  - **JSON File**: Optional consolidated JSON export with overwrite or append modes
- **Flexible Output Control**: Export to one or multiple formats simultaneously

### Performance & Reliability
- **Batch Processing**: Processes users and files in batches to optimise API usage and avoid quota limits
- **Error Handling and Retry Logic**: Implements exponential backoff for API retries and detailed error logging
- **Bandwidth Efficient**: Uses structured API calls instead of downloading actual files
- **Data Transfer Monitoring**: Tracks and reports API usage and bandwidth consumption
- **Modular Design**: Organised into reusable modules for maintainability and extensibility

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
# Run a comprehensive scan of all users (all features enabled by default)
npm start
# or
node index.js

# Comprehensive scan and export to Google Sheets  
node index.js --sheets-output
# or using abbreviation
node index.js -s

# Show help and available options
node index.js --help
# or using abbreviation  
node index.js -h
```

### Command Line Options

```bash
node index.js [options]
```

**🆕 All scans are enabled by default for comprehensive analysis.** Use options to filter, export, or disable specific features.

**Core Options:**
- `-h, --help` - Show help message
- `-u, --users <emails>` - Comma-separated list of user emails to scan (default: all users)
- `-t, --types <types>` - Comma-separated list of file types: doc,sheet,slide (default: all types)  
- `-f, --file <fileId>` - Scan a single file by its ID (disables other scans)
- `-j, --json-output <path>` - Export consolidated JSON file (default: streaming logs only)
- `--json-output-mode <mode>` - JSON export mode: overwrite|append (default: overwrite)
- `-s, --sheets-output` - Export to Google Sheets (requires OUTPUT_SHEET_ID env var)

**Disable Options:**
- `--no <features>` - Disable specific features (comma-separated list)
  
  Available features for `--no`:
  - `sharing-analysis` (or `sharing`) - File sharing and permission analysis
  - `drive-analysis` (or `drive`) - Drive analysis  
  - `calendars` (or `include-calendars`) - Calendar analysis
  - `shared-drives` (or `include-shared-drives`) - Shared Drive analysis
  - `drive-members` (or `include-drive-members`) - Drive member analysis

**Legacy Options (still supported):**
- `--no-sharing-analysis` - Disable file sharing and permission analysis
- `--no-drive-analysis` - Disable Drive analysis  
- `--no-include-calendars` - Disable calendar analysis
- `--no-include-shared-drives` - Disable Shared Drive analysis
- `--no-include-drive-members` - Disable Drive member analysis

**Important Notes:**
- **All scan types are enabled by default** for comprehensive workspace analysis
- **Use abbreviations** for faster command entry (e.g., `-u` instead of `--users`)
- **Streaming logs are always created** during the scan (`scan-log.jsonl`, `summary-log.jsonl`) for real-time monitoring
- **Streaming logs are automatically cleaned up** after processing completes
- **`-j/--json-output` is only needed** if you want a consolidated JSON file in addition to the streaming logs
- **`-s/--sheets-output` is only needed** if you want to export results to Google Sheets

### Examples

```bash
# Comprehensive scan with all features enabled (default behavior)
node index.js

# Comprehensive scan and export to Google Sheets
node index.js -s

# Scan specific user with all features 
node index.js -u alice@domain.com

# Scan multiple users with all features and export to Google Sheets
node index.js -u alice@domain.com,bob@domain.com -s

# Scan only specific file types (all other features still enabled)
node index.js -t sheet,doc

# Scan specific user for only Google Sheets, export consolidated JSON
node index.js -u alice@domain.com -t sheet -j ./results.json

# Scan a single file by ID (disables other scans)
node index.js -f 1abc...xyz

# Export consolidated JSON file (in addition to streaming logs)
node index.js -j ./results.json

# Export consolidated JSON and append to existing file
node index.js -j ./results.json --json-output-mode append

# Export to both Google Sheets and consolidated JSON
node index.js -s -j ./results.json

# Disable specific features using the new --no flag
node index.js --no sharing,drive

# Disable multiple features with aliases
node index.js --no sharing-analysis,calendars,shared-drives

# Disable specific features while keeping others (legacy syntax still works)
node index.js --no-sharing-analysis --no-drive-analysis

# Scan specific users with only basic file analysis (disable enhanced features)
node index.js -u alice@domain.com --no sharing,calendars,drive

# Combine multiple options with abbreviations
node index.js -u alice@domain.com -t doc,sheet -s -j ./alice-scan.json
```

### Migration Analysis Usage

**🆕 Migration analysis is now enabled by default** as part of the comprehensive scan. No additional flags needed unless you want to disable specific features.

```bash
# Comprehensive analysis (includes all migration features by default)
node index.js

# Comprehensive analysis exported to Google Sheets
node index.js -s

# Focus on specific users (all migration features included)
node index.js -u alice@domain.com,bob@domain.com

# Export consolidated JSON file
node index.js -j migration-report.json

# Disable specific migration features using new --no flag
node index.js --no sharing                    # Disable sharing analysis
node index.js --no calendars                  # Disable calendar analysis  
node index.js --no drive                      # Disable Drive analysis
node index.js --no sharing,calendars,drive    # Disable multiple features

# Legacy disable flags (still supported)
node index.js --no-sharing-analysis  # Disable sharing analysis
node index.js --no-include-calendars   # Disable calendar analysis  
node index.js --no-drive-analysis      # Disable Drive analysis

# Classic file-only scan (disable all enhanced features)
node index.js --no sharing-analysis,calendars,drive-analysis

```bash
# Google Workspace to Microsoft 365 migration assessment
node index.js -u alice@domain.com -j m365-migration.json
```

**Migration Analysis Features (enabled by default):**
- **File Sharing Analysis**: External shares, public links, cross-tenant permissions
- **Drive Location Analysis**: Personal drives, shared drives, folder structures
- **Calendar Dependencies**: Future events, recurring meetings, external attendees, meeting rooms
- **Drive Analysis**: My Drive & Shared Drive scanning, external user detection, orphaned files
- **Risk Assessment**: Automatic categorisation by migration complexity (low/medium/high)

**Required Environment Variables for Comprehensive Analysis:**
```bash
PRIMARY_DOMAIN=yourdomain.com  # Your workspace domain for external share detection
```

## Migration Analysis Features

### File Sharing Analysis
- **External Share Detection**: Identifies files shared with users outside your primary domain
- **Public Link Detection**: Finds files with public or "anyone with link" sharing
- **Cross-Tenant Analysis**: Maps sharing relationships across different Google Workspace tenants
- **Permission Complexity Assessment**: Categorises sharing by migration risk level
- **Domain-Wide Sharing**: Identifies files shared with entire domains

### Drive Location Analysis  
- **Personal vs Shared Drives**: Distinguishes between individual user drives and shared team drives
- **Folder Structure Mapping**: Captures full folder paths for migration planning
- **Orphaned File Detection**: Identifies files without proper folder organisation
- **Migration Complexity Scoring**: Assesses difficulty of moving files based on location and structure

### Calendar Migration Planning
- **Future Events Scanning**: Analyses upcoming events up to 2 years in advance
- **Recurring Meeting Analysis**: Identifies complex recurring patterns that may need special handling
- **External Attendee Detection**: Maps external meeting participants across domains
- **Google Meet Integration**: Identifies meetings using Google Meet vs external platforms
- **Meeting Room Resources**: Detects Google Workspace meeting room bookings
- **Migration Risk Assessment**: Categorises events by migration complexity

### Migration Risk Categories
- **Low Risk**: Simple files with minimal sharing, basic calendar events
- **Medium Risk**: Files with some external sharing, recurring meetings with external attendees
- **High Risk**: Complex sharing patterns, shared drive content, public files
- **Critical Risk**: Extensive cross-tenant dependencies, complex recurring meetings with many externals

## Usage Examples

### Basic Comprehensive Analysis
```bash
# Full workspace analysis (all features enabled by default)
node index.js

# Export results to Google Sheets
node index.js -s

# Export results to JSON file
node index.js -j workspace-analysis.json

# Scan specific users with full analysis
node index.js -u alice@domain.com,bob@domain.com

# Scan specific file types only
node index.js -t doc,sheet
```

### Selective Analysis
```bash
# Disable calendar analysis using new --no flag
node index.js --no calendars

# Disable sharing and permission analysis
node index.js --no sharing

# Disable multiple features at once
node index.js --no sharing,calendars,drive

# Basic file scan only (disable all enhanced features)
node index.js --no sharing-analysis,calendars,drive-analysis

# Focus on Drive analysis only
node index.js --no sharing,calendars

# Legacy syntax (still supported)
node index.js --no-include-calendars
node index.js --no-sharing-analysis
node index.js --no-sharing-analysis --no-include-calendars
```

### Export and Output Options
```bash
# Export to both Sheets and JSON
node index.js -s -j ./complete-analysis.json

# Append to existing JSON file
node index.js -j ./existing-results.json --json-output-mode append

# Single file analysis
node index.js -f 1abc...xyz
```

### Modern Disable Syntax Examples
```bash
# Use new --no flag with feature names or aliases
node index.js --no sharing                    # Disable sharing analysis
node index.js --no drive                      # Disable drive analysis  
node index.js --no calendars                  # Disable calendar analysis
node index.js --no shared-drives              # Disable shared drive analysis
node index.js --no drive-members              # Disable drive member analysis

# Disable multiple features at once
node index.js --no sharing,drive,calendars    # Multiple features
node index.js --no sharing-analysis,calendars # Mix full names and aliases

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
