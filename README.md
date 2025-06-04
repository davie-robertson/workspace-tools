# Google Workspace File Scanner

This Node.js (ESM) project is designed for Google Workspace administrators to audit and analyze Google Workspace files (Docs, Sheets, Slides) across their domain. It scans files for links, compatibility issues, and metadata, and outputs results to a Google Sheet or JSON file for further analysis.

## Features
- **Comprehensive File Scanning**: Scans Google Docs, Sheets, and Slides for all users in your domain.
- **Link Extraction**: Identifies and lists links to other Workspace files, including hyperlinks, embedded object links, and formula references.
- **Google Sheets Compatibility Analysis**: Detects Google Workspace-specific functions in Sheets that may cause compatibility issues with other platforms.
- **Flexible Output Options**:
  - **Google Sheets**: Writes results directly to a specified Google Sheet, including a detailed summary tab.
  - **JSON File**: Outputs results to a JSON file, with options to overwrite or append to existing data.
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
# Run a full scan of all users and output to Google Sheets
npm start
# or
node index.js

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
- `--json-output <path>` - Output results to JSON file (optional)
- `--json-output-mode <mode>` - JSON output mode: overwrite|append (default: overwrite)
- `--help, -h` - Show help message

### Examples

```bash
# Scan all users and output to Google Sheet
node index.js

# Scan specific user only
node index.js --users alice@domain.com

# Scan multiple users
node index.js --users alice@domain.com,bob@domain.com

# Scan only specific file types
node index.js --types sheet,doc

# Scan specific user for only Google Sheets
node index.js --users alice@domain.com --types sheet

# Scan a single file by ID
node index.js --file 1abc...xyz

# Output to JSON file instead of Google Sheets
node index.js --json-output ./results.json

# Output to JSON and append to existing file
node index.js --json-output ./results.json --json-output-mode append

# Combine options
node index.js --users alice@domain.com --types doc,sheet --json-output ./alice-scan.json
```

### What the Tool Collects
- **File metadata and sharing permissions**
- **Drive and Gmail quota information (in MB)**
- **External links and incompatible functions**
- **Data transfer statistics**

Results include both summary statistics and detailed file information.

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
