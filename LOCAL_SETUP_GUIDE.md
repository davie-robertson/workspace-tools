# 🖥️ Local Setup Guide - Workspace Tools

This guide provides **step-by-step instructions** for running Workspace Tools locally. Each section explains exactly what to install, why it's needed, and what happens when you run each command.

## 🎯 What You'll Achieve

By following this guide, you'll have:
- ✅ A working Google Workspace file scanner running locally
- ✅ Understanding of how each component works together
- ✅ Ability to test with your real Workspace data
- ✅ Preparation for cloud deployment

## 📋 Prerequisites & Dependencies

### 1. Required Software (Install First)

These tools are **mandatory** for the project to work:

| Software | Minimum Version | Purpose | Where to Get |
|----------|----------------|---------|--------------|
| **Node.js** | 18.0+ | JavaScript runtime for the application | [nodejs.org](https://nodejs.org/) - Download LTS version |
| **npm** | 8.0+ | Package manager (included with Node.js) | Included with Node.js |
| **Git** | Any recent | Version control (to clone/manage code) | [git-scm.com](https://git-scm.com/) |

**Verify installation:**
```bash
node --version    # Should show v18.x.x or higher
npm --version     # Should show 8.x.x or higher
git --version     # Should show any recent version
```

### 2. Optional Software (For Advanced Features)

These tools enable additional features but aren't required for basic functionality:

| Software | Purpose | When Needed | Installation |
|----------|---------|-------------|-------------|
| **Google Cloud CLI** | Cloud deployment & BigQuery | Only for cloud deployment | [Install gcloud](https://cloud.google.com/sdk/docs/install) |
| **Docker** | Container building | Only for Cloud Run deployment | [Install Docker](https://docs.docker.com/get-docker/) |
| **Redis** | Local caching | Only for performance testing | `docker run -d -p 6379:6379 redis:alpine` |

### 3. JavaScript Dependencies

The project uses several Node.js packages. Run this command to install them:

```bash
cd /path/to/workspace-tools
npm install
```

**What gets installed:**

**Core Runtime Dependencies:**
- `googleapis` - Google Workspace API client (Drive, Docs, Sheets, etc.)
- `dotenv` - Loads configuration from .env files
- `express` - Web server framework for the API
- `ioredis` - Redis client for caching (optional)
- `@google-cloud/bigquery` - BigQuery client for data storage (optional)
- `compression` & `helmet` - Security and performance middleware

**Development & Testing Dependencies:**
- `jest` - Testing framework
- `supertest` - HTTP testing utilities
- `@jest/globals` - Jest with ES modules support

**Expected output:** Installation should complete without errors. If you see warnings about optional dependencies, that's normal.

## 📊 Caching Setup (Optional - For Production Performance)

**When do you need caching?**
- ❌ **NOT needed** for local development/testing with small user sets
- ❌ **NOT needed** for one-off scans of a few users 
- ✅ **Recommended** for production deployments scanning 100+ users
- ✅ **Required** for repeated scans or production workloads

### Option 1: Local Development (No Caching) - DEFAULT
```bash
# In your .env file
ENABLE_CACHING=false
```
**What you get:**
- ✅ Works immediately with no additional setup
- ✅ Perfect for testing and development  
- ❌ Slower scans (every API call made fresh)
- ❌ No persistent storage of results

### Option 2: Production Setup (With Caching)

**Requirements:**
- Redis server (for fast temporary storage)
- Google BigQuery dataset (for persistent analysis storage)

**Step 1: Set up Redis**
```bash
# Install Redis locally (Ubuntu/Debian)
sudo apt update && sudo apt install redis-server
sudo systemctl start redis-server

# Test Redis is working
redis-cli ping  # Should return "PONG"
```

**Step 2: Set up BigQuery**
1. Enable BigQuery API in Google Cloud Console
2. Grant permissions to your service account:
```bash
# Replace YOUR_PROJECT_ID and YOUR_SERVICE_ACCOUNT
gcloud projects add-iam-policy-binding YOUR_PROJECT_ID \
  --member="serviceAccount:YOUR_SERVICE_ACCOUNT@YOUR_PROJECT_ID.iam.gserviceaccount.com" \
  --role="roles/bigquery.dataEditor"
```

**Step 3: Update .env for caching:**
```bash
ENABLE_CACHING=true
REDIS_HOST=localhost
REDIS_PORT=6379
CACHE_DATASET=workspace_cache
```

## 🔧 Configuration Setup (Most Important Step)

### Step 1: Basic Environment Configuration

**Purpose:** Tell the application about your Google Workspace setup.

1. **Copy the environment template:**
```bash
cp env.example .env
```

2. **Edit `.env` with your specific settings:**

**Minimal Configuration (for basic testing):**
```bash
# Your Google Workspace admin email
ADMIN_USER=your-admin@yourdomain.com

# Your organization's primary domain
PRIMARY_DOMAIN=yourdomain.com

# Path to your Google service account key file (we'll create this next)
GOOGLE_APPLICATION_CREDENTIALS=./service-account-key.json

# Disable advanced features for simple testing
ENABLE_CACHING=false
ENABLE_CALENDAR_ANALYSIS=false

# Use smaller batches for testing
BATCH_SIZE=10
```

**What each setting does:**
- `ADMIN_USER`: The email address with admin privileges in your Google Workspace
- `PRIMARY_DOMAIN`: Your organization's domain (everything after @ in user emails)
- `GOOGLE_APPLICATION_CREDENTIALS`: Path to the JSON file containing Google API credentials
- `ENABLE_CACHING=false`: Disables Redis/BigQuery caching for simpler setup
- `BATCH_SIZE=10`: Processes fewer files at once during testing

**Note**: The Google Cloud Project ID is automatically extracted from your service account JSON file, so you don't need to set `GOOGLE_CLOUD_PROJECT` unless you want to override it.

### Step 2: Google Service Account Setup (Critical Step)

**Purpose:** Create credentials that allow the application to access your Google Workspace data.

**Why this is needed:** Google requires special authentication for applications that access user data across an entire organization. A service account provides this authentication.

#### Part A: Create the Service Account

1. **Go to Google Cloud Console:** [console.cloud.google.com](https://console.cloud.google.com/)
2. **Select or create a project:**
   - If you don't have a project: Click "New Project", give it a name
   - If you have projects: Select the one you want to use
3. **Navigate to service accounts:**
   - Go to "IAM & Admin" → "Service Accounts"
4. **Create the service account:**
   - Click "Create Service Account"
   - **Name**: `workspace-tools-scanner` (or any descriptive name)
   - **Description**: `Service account for workspace file scanning`
   - Click "Create and Continue"
   - **Skip** granting project roles (not needed for this step)
   - Click "Done"
5. **Download the key file:**
   - Click on the newly created service account
   - Go to "Keys" tab
   - Click "Add Key" → "Create new key"
   - Choose "JSON" format
   - Click "Create" - this downloads the key file
6. **Move the key file:**
   ```bash
   # Move the downloaded file to your project directory
   mv ~/Downloads/your-project-name-xxxxx.json ./service-account-key.json
   ```

#### Part B: Enable Domain-Wide Delegation

**Purpose:** Allow the service account to act on behalf of users in your organization.

1. **In the service account details page:**
   - Click "Advanced settings" or scroll down
   - Click "Enable Google Workspace Domain-wide Delegation"
   - **Product name**: `Workspace Tools`
   - Click "Save"
2. **Note the Client ID:**
   - Copy the "Client ID" value (it's a long number)
   - You'll need this for the next step

#### Part C: Authorize in Google Admin Console

**Purpose:** Give permission for the service account to access your organization's data.

1. **Go to Google Admin Console:** [admin.google.com](https://admin.google.com)
   - **Note:** You must be a Google Workspace admin to do this step
2. **Navigate to API Controls:**
   - Go to "Security" → "API Controls" → "Domain-wide Delegation"
3. **Add the service account:**
   - Click "Add new"
   - **Client ID**: Paste the Client ID from Part B
   - **OAuth Scopes**: Copy and paste this exact list:
   ```
   https://www.googleapis.com/auth/admin.directory.user.readonly,https://www.googleapis.com/auth/drive,https://www.googleapis.com/auth/documents,https://www.googleapis.com/auth/spreadsheets,https://www.googleapis.com/auth/presentations,https://www.googleapis.com/auth/calendar
   ```
   - Click "Authorize"

**What each scope allows:**
- `admin.directory.user.readonly`: List users in your organization
- `drive`: Access Google Drive files
- `documents`: Read Google Docs content
- `spreadsheets`: Read Google Sheets content and formulas
- `presentations`: Read Google Slides content
- `calendar`: Read calendar events (if calendar analysis is enabled)

### Step 3: Verify Configuration

**Purpose:** Make sure your `.env` file points to the correct credentials file.

1. **Check your file structure:**
```bash
ls -la
# You should see:
# - .env (your configuration file)
# - service-account-key.json (your credentials)
# - package.json (the project file)
```

2. **Verify .env content:**
```bash
cat .env
# Should show your ADMIN_USER, PRIMARY_DOMAIN, and 
# GOOGLE_APPLICATION_CREDENTIALS=./service-account-key.json
```

**Common issues at this stage:**
- File path wrong: Make sure `GOOGLE_APPLICATION_CREDENTIALS` matches your actual file name
- Missing .env file: Make sure you copied `env.example` to `.env`
- Wrong permissions: The service account file should be readable by your user

## 🚀 Local Execution & Testing

### Stage 1: Dependency Validation
**Purpose**: Verify Node.js and npm packages are working

```bash
# Test that all packages installed correctly
npm test
```

**What happens:**
- Loads and tests all JavaScript modules
- Verifies ES modules are working
- Runs basic unit tests
- Reports any missing dependencies

**Expected output:**
```
> workspace-tools@1.0.0 test
> node --experimental-vm-modules node_modules/.bin/jest

PASS tests/cache/file-cache-minimal.test.js
PASS tests/processing/file-processor.test.js
...
Tests: X passed, Y total
```

**⚠️ Some tests may fail** - this is normal if you haven't set up Redis or BigQuery yet. Look for successful module loading rather than 100% test pass rate.

### Stage 2: Google Workspace Authentication Test
**Purpose**: Verify your Google Workspace setup and credentials work

```bash
# Run the comprehensive setup validation
node test-setup.js
```

**What happens step-by-step:**
1. **Loads your `.env` configuration** and validates required fields
2. **Initializes the file processor** without external dependencies
3. **Tests Google Workspace authentication** using your service account
4. **Lists users in your domain** to confirm API access is working
5. **Reports connection status** for caching services (may show warnings if not configured)

**Expected successful output:**
```
🧪 Testing Workspace Tools v2.0 Architecture
=============================================
1. Testing environment configuration...
   ✅ Environment configuration valid
2. Testing file processor initialization...
   ✅ File processor initialized
3. Caching disabled - skipping cache tests
4. Testing Google APIs...
   ✅ Google APIs working - found 15 users
5. Testing file access for admin user...
   ✅ Can access admin user files
```

**Common failures and solutions:**
| Error Message | Cause | Solution |
|---------------|-------|----------|
| "Authentication failed" | Service account not properly authorized | Re-check domain-wide delegation setup |
| "Admin user not found" | Wrong email in ADMIN_USER | Verify email exists and is spelled correctly |
| "Permission denied" | Missing OAuth scopes | Add all required scopes in Admin Console |
| "Cannot find credentials" | Wrong file path | Check GOOGLE_APPLICATION_CREDENTIALS path |

### Stage 3: First File Scan (Basic CLI)
**Purpose**: Run your first actual file scan to see results

```bash
# Scan files for a specific user (replace with real email from your organization)
npm start -- --users your-email@yourdomain.com --no-calendars

# Alternative: Use legacy mode for simpler output
npm run legacy -- --users your-email@yourdomain.com
```

**What happens during the scan:**
1. **Authenticates with Google Workspace** using your service account
2. **Gets list of files** for the specified user from Google Drive
3. **Downloads and analyzes each file** for:
   - Links to other workspace files
   - Sharing permissions and external access
   - Google Sheets formulas and migration complexity
   - File organization and location analysis
4. **Outputs results** as JSON data showing all discovered information

**Expected output format:**
```json
{
  "user": "your-email@yourdomain.com",
  "totalFiles": 25,
  "scanResults": [
    {
      "fileId": "1abc...",
      "fileName": "Project Report.docx",
      "fileType": "document",
      "links": ["https://docs.google.com/spreadsheets/d/xyz..."],
      "sharing": {
        "isPublic": false,
        "externalShares": 0,
        "sharedWithDomain": true
      },
      "migrationComplexity": "low"
    }
  ]
}
```

**What to look for:**
- ✅ User email appears in results
- ✅ Files are being found and analyzed
- ✅ Links and sharing data are populated
- ✅ No authentication errors

**Troubleshooting:**
- If "No files found": User might not have any files, or permissions issue
- If "Rate limit exceeded": Reduce BATCH_SIZE in .env to 5 or lower
- If "Authentication error": Double-check service account setup

### Stage 4: API Server Mode (Web Interface)
**Purpose**: Run the web API server for HTTP-based access

```bash
# Start the API server locally
npm run dev

# Server starts on port 8080
```

**What happens when you start the server:**
1. **Loads configuration** from your .env file
2. **Initializes Express.js web server** on port 8080
3. **Sets up API endpoints** for file scanning and management
4. **Connects to caching services** (if enabled) or runs without cache
5. **Reports health status** showing what's working

**Expected output:**
```
Server starting on port 8080...
✅ File processor initialized
⚠️  Cache not available (running without cache)
🚀 Server running at http://localhost:8080
```

**Test the API server** (in a new terminal window):
```bash
# Check server health
curl http://localhost:8080/health

# Expected response:
{
  "status": "healthy",
  "timestamp": "2025-06-17T...",
  "uptime": 1.234,
  "version": "1.0.0",
  "cache": {
    "redis": "not_configured",
    "bigquery": "not_configured"
  }
}

# Test user listing
curl http://localhost:8080/api/users

# Test file scanning
curl -X POST http://localhost:8080/api/scan/files \
  -H "Content-Type: application/json" \
  -d '{"fileRequests":[{"userEmail":"your-email@yourdomain.com","analysisTypes":["links","sharing"]}]}'
```

**API endpoints available:**
- `GET /health` - Server status and configuration
- `GET /api/users` - List all users in your Workspace
- `POST /api/scan/files` - Scan specific files
- `POST /api/scan/workspace` - Scan entire workspace
- `GET /api/cache/stats` - Cache performance (if enabled)

### Stage 5: Advanced Setup with Caching (Optional)
**Purpose**: Enable high-performance caching for production-like testing

**⚠️ This stage is optional** - the application works fine without caching for development and testing.

#### Prerequisites for Caching:

**1. Redis Server (for fast in-memory caching):**
```bash
# Option A: Using Docker (recommended and easiest)
docker run -d --name redis-cache -p 6379:6379 redis:alpine

# Option B: Install Redis locally
# macOS: brew install redis && brew services start redis
# Ubuntu: sudo apt install redis-server && sudo systemctl start redis

# Verify Redis is running
redis-cli ping
# Should respond: PONG
```

**2. BigQuery Setup (for persistent storage):**
```bash
# Install Google Cloud CLI if not already installed
# Then create a dataset for caching
bq mk --location=US workspace_cache

# Verify dataset exists
bq ls
```

**3. Update .env for caching:**
```bash
# Edit your .env file to enable caching
ENABLE_CACHING=true
REDIS_HOST=localhost
REDIS_PORT=6379
CACHE_DATASET=workspace_cache
GOOGLE_CLOUD_PROJECT=your-project-id
```

#### Test Full Architecture with Caching:
```bash
# Start server with caching enabled
npm run dev

# Check cache connectivity
curl http://localhost:8080/health
# Should show cache connections as "connected"

# Run a scan to populate cache
curl -X POST http://localhost:8080/api/scan/files \
  -H "Content-Type: application/json" \
  -d '{"fileRequests":[{"userEmail":"your-email@yourdomain.com","analysisTypes":["links"]}]}'

# Run the same scan again - should be much faster from cache
curl -X POST http://localhost:8080/api/scan/files \
  -H "Content-Type: application/json" \
  -d '{"fileRequests":[{"userEmail":"your-email@yourdomain.com","analysisTypes":["links"]}]}'

# Check cache performance
curl http://localhost:8080/api/cache/stats
```

**What caching provides:**
- **90% reduction in API calls** for repeat scans
- **75% faster processing** of previously scanned files
- **Persistent storage** of all scan results in BigQuery
- **Production-like performance** characteristics

## 📊 Caching Setup (Optional - For Production Performance)

**When do you need caching?**
- ❌ **NOT needed** for local development/testing with small user sets
- ❌ **NOT needed** for one-off scans of a few users 
- ✅ **Recommended** for production deployments scanning 100+ users
- ✅ **Required** for repeated scans or production workloads

### Option 1: Local Development (No Caching)
```bash
# In your .env file
ENABLE_CACHING=false
```
**What you get:**
- ✅ Works immediately with no additional setup
- ✅ Perfect for testing and development
- ❌ Slower scans (every API call made fresh)
- ❌ No persistent storage of results

### Option 2: Production Setup (With Caching)

**Requirements:**
- Redis server (for fast temporary storage)
- Google BigQuery dataset (for persistent analysis storage)

**Step 1: Set up Redis**

For local development with Redis:
```bash
# Install Redis locally (Ubuntu/Debian)
sudo apt update
sudo apt install redis-server

# Start Redis
sudo systemctl start redis-server
sudo systemctl enable redis-server

# Test Redis is working
redis-cli ping  # Should return "PONG"
```

For production with managed Redis:
- Use Google Cloud Memorystore for Redis
- AWS ElastiCache
- Azure Cache for Redis

**Step 2: Set up BigQuery**

1. **Enable BigQuery API:**
   - Go to [Google Cloud Console](https://console.cloud.google.com)
   - Navigate to APIs & Services > Library
   - Search for "BigQuery API" and enable it

2. **Grant BigQuery permissions to your service account:**
   ```bash
   # Replace with your service account email and project ID
   gcloud projects add-iam-policy-binding YOUR_PROJECT_ID \
     --member="serviceAccount:YOUR_SERVICE_ACCOUNT@YOUR_PROJECT_ID.iam.gserviceaccount.com" \
     --role="roles/bigquery.dataEditor"
   
   gcloud projects add-iam-policy-binding YOUR_PROJECT_ID \
     --member="serviceAccount:YOUR_SERVICE_ACCOUNT@YOUR_PROJECT_ID.iam.gserviceaccount.com" \
     --role="roles/bigquery.jobUser"
   ```

**Step 3: Update your .env for caching:**
```bash
# Enable caching
ENABLE_CACHING=true

# BigQuery configuration  
CACHE_DATASET=workspace_cache  # Dataset will be created automatically

# Redis configuration
REDIS_HOST=localhost  # For local Redis
REDIS_PORT=6379
REDIS_PASSWORD=       # Leave empty for local Redis

# For production Redis, use:
# REDIS_URL=redis://your-redis-host:6379
```

**What you get with caching:**
- ✅ 90% fewer Google API calls
- ✅ 75% faster scan times for repeated operations  
- ✅ Persistent storage of analysis results
- ✅ Better performance for large organizations
- ✅ Automatic cache invalidation and refresh

### Caching Architecture Overview

**Redis (Fast Cache):**
- Stores file metadata temporarily (1-2 hours)
- Caches API responses to reduce Google API calls
- Automatically expires old data

**BigQuery (Persistent Storage):**
- Stores complete analysis results
- Enables historical tracking and reporting
- Supports complex queries across scan results

## 🔧 Configuration Setup (Most Important Step)

### Step 1: Basic Environment Configuration

**Purpose:** Tell the application about your Google Workspace setup.

1. **Copy the environment template:**
```bash
cp env.example .env
```

2. **Edit `.env` with your specific settings:**

**Minimal Configuration (for basic testing):**
```bash
# Your Google Workspace admin email
ADMIN_USER=your-admin@yourdomain.com

# Your organization's primary domain
PRIMARY_DOMAIN=yourdomain.com

# Path to your Google service account key file (we'll create this next)
GOOGLE_APPLICATION_CREDENTIALS=./service-account-key.json

# Disable advanced features for simple testing
ENABLE_CACHING=false
ENABLE_CALENDAR_ANALYSIS=false

# Use smaller batches for testing
BATCH_SIZE=10
```

**What each setting does:**
- `ADMIN_USER`: The email address with admin privileges in your Google Workspace
- `PRIMARY_DOMAIN`: Your organization's domain (everything after @ in user emails)
- `GOOGLE_APPLICATION_CREDENTIALS`: Path to the JSON file containing Google API credentials
- `ENABLE_CACHING=false`: Disables Redis/BigQuery caching for simpler setup
- `BATCH_SIZE=10`: Processes fewer files at once during testing

**Note**: The Google Cloud Project ID is automatically extracted from your service account JSON file, so you don't need to set `GOOGLE_CLOUD_PROJECT` unless you want to override it.

### Step 2: Google Service Account Setup (Critical Step)

**Purpose:** Create credentials that allow the application to access your Google Workspace data.

**Why this is needed:** Google requires special authentication for applications that access user data across an entire organization. A service account provides this authentication.

#### Part A: Create the Service Account

1. **Go to Google Cloud Console:** [console.cloud.google.com](https://console.cloud.google.com/)
2. **Select or create a project:**
   - If you don't have a project: Click "New Project", give it a name
   - If you have projects: Select the one you want to use
3. **Navigate to service accounts:**
   - Go to "IAM & Admin" → "Service Accounts"
4. **Create the service account:**
   - Click "Create Service Account"
   - **Name**: `workspace-tools-scanner` (or any descriptive name)
   - **Description**: `Service account for workspace file scanning`
   - Click "Create and Continue"
   - **Skip** granting project roles (not needed for this step)
   - Click "Done"
5. **Download the key file:**
   - Click on the newly created service account
   - Go to "Keys" tab
   - Click "Add Key" → "Create new key"
   - Choose "JSON" format
   - Click "Create" - this downloads the key file
6. **Move the key file:**
   ```bash
   # Move the downloaded file to your project directory
   mv ~/Downloads/your-project-name-xxxxx.json ./service-account-key.json
   ```

#### Part B: Enable Domain-Wide Delegation

**Purpose:** Allow the service account to act on behalf of users in your organization.

1. **In the service account details page:**
   - Click "Advanced settings" or scroll down
   - Click "Enable Google Workspace Domain-wide Delegation"
   - **Product name**: `Workspace Tools`
   - Click "Save"
2. **Note the Client ID:**
   - Copy the "Client ID" value (it's a long number)
   - You'll need this for the next step

#### Part C: Authorize in Google Admin Console

**Purpose:** Give permission for the service account to access your organization's data.

1. **Go to Google Admin Console:** [admin.google.com](https://admin.google.com)
   - **Note:** You must be a Google Workspace admin to do this step
2. **Navigate to API Controls:**
   - Go to "Security" → "API Controls" → "Domain-wide Delegation"
3. **Add the service account:**
   - Click "Add new"
   - **Client ID**: Paste the Client ID from Part B
   - **OAuth Scopes**: Copy and paste this exact list:
   ```
   https://www.googleapis.com/auth/admin.directory.user.readonly,https://www.googleapis.com/auth/drive,https://www.googleapis.com/auth/documents,https://www.googleapis.com/auth/spreadsheets,https://www.googleapis.com/auth/presentations,https://www.googleapis.com/auth/calendar
   ```
   - Click "Authorize"

**What each scope allows:**
- `admin.directory.user.readonly`: List users in your organization
- `drive`: Access Google Drive files
- `documents`: Read Google Docs content
- `spreadsheets`: Read Google Sheets content and formulas
- `presentations`: Read Google Slides content
- `calendar`: Read calendar events (if calendar analysis is enabled)

### Step 3: Verify Configuration

**Purpose:** Make sure your `.env` file points to the correct credentials file.

1. **Check your file structure:**
```bash
ls -la
# You should see:
# - .env (your configuration file)
# - service-account-key.json (your credentials)
# - package.json (the project file)
```

2. **Verify .env content:**
```bash
cat .env
# Should show your ADMIN_USER, PRIMARY_DOMAIN, and 
# GOOGLE_APPLICATION_CREDENTIALS=./service-account-key.json
```

**Common issues at this stage:**
- File path wrong: Make sure `GOOGLE_APPLICATION_CREDENTIALS` matches your actual file name
- Missing .env file: Make sure you copied `env.example` to `.env`
- Wrong permissions: The service account file should be readable by your user

## 🚀 Local Execution & Testing

### Stage 1: Dependency Validation
**Purpose**: Verify Node.js and npm packages are working

```bash
# Test that all packages installed correctly
npm test
```

**What happens:**
- Loads and tests all JavaScript modules
- Verifies ES modules are working
- Runs basic unit tests
- Reports any missing dependencies

**Expected output:**
```
> workspace-tools@1.0.0 test
> node --experimental-vm-modules node_modules/.bin/jest

PASS tests/cache/file-cache-minimal.test.js
PASS tests/processing/file-processor.test.js
...
Tests: X passed, Y total
```

**⚠️ Some tests may fail** - this is normal if you haven't set up Redis or BigQuery yet. Look for successful module loading rather than 100% test pass rate.

### Stage 2: Google Workspace Authentication Test
**Purpose**: Verify your Google Workspace setup and credentials work

```bash
# Run the comprehensive setup validation
node test-setup.js
```

**What happens step-by-step:**
1. **Loads your `.env` configuration** and validates required fields
2. **Initializes the file processor** without external dependencies
3. **Tests Google Workspace authentication** using your service account
4. **Lists users in your domain** to confirm API access is working
5. **Reports connection status** for caching services (may show warnings if not configured)

**Expected successful output:**
```
🧪 Testing Workspace Tools v2.0 Architecture
=============================================
1. Testing environment configuration...
   ✅ Environment configuration valid
2. Testing file processor initialization...
   ✅ File processor initialized
3. Caching disabled - skipping cache tests
4. Testing Google APIs...
   ✅ Google APIs working - found 15 users
5. Testing file access for admin user...
   ✅ Can access admin user files
```

**Common failures and solutions:**
| Error Message | Cause | Solution |
|---------------|-------|----------|
| "Authentication failed" | Service account not properly authorized | Re-check domain-wide delegation setup |
| "Admin user not found" | Wrong email in ADMIN_USER | Verify email exists and is spelled correctly |
| "Permission denied" | Missing OAuth scopes | Add all required scopes in Admin Console |
| "Cannot find credentials" | Wrong file path | Check GOOGLE_APPLICATION_CREDENTIALS path |

### Stage 3: First File Scan (Basic CLI)
**Purpose**: Run your first actual file scan to see results

```bash
# Scan files for a specific user (replace with real email from your organization)
npm start -- --users your-email@yourdomain.com --no-calendars

# Alternative: Use legacy mode for simpler output
npm run legacy -- --users your-email@yourdomain.com
```

**What happens during the scan:**
1. **Authenticates with Google Workspace** using your service account
2. **Gets list of files** for the specified user from Google Drive
3. **Downloads and analyzes each file** for:
   - Links to other workspace files
   - Sharing permissions and external access
   - Google Sheets formulas and migration complexity
   - File organization and location analysis
4. **Outputs results** as JSON data showing all discovered information

**Expected output format:**
```json
{
  "user": "your-email@yourdomain.com",
  "totalFiles": 25,
  "scanResults": [
    {
      "fileId": "1abc...",
      "fileName": "Project Report.docx",
      "fileType": "document",
      "links": ["https://docs.google.com/spreadsheets/d/xyz..."],
      "sharing": {
        "isPublic": false,
        "externalShares": 0,
        "sharedWithDomain": true
      },
      "migrationComplexity": "low"
    }
  ]
}
```

**What to look for:**
- ✅ User email appears in results
- ✅ Files are being found and analyzed
- ✅ Links and sharing data are populated
- ✅ No authentication errors

**Troubleshooting:**
- If "No files found": User might not have any files, or permissions issue
- If "Rate limit exceeded": Reduce BATCH_SIZE in .env to 5 or lower
- If "Authentication error": Double-check service account setup

### Stage 4: API Server Mode (Web Interface)
**Purpose**: Run the web API server for HTTP-based access

```bash
# Start the API server locally
npm run dev

# Server starts on port 8080
```

**What happens when you start the server:**
1. **Loads configuration** from your .env file
2. **Initializes Express.js web server** on port 8080
3. **Sets up API endpoints** for file scanning and management
4. **Connects to caching services** (if enabled) or runs without cache
5. **Reports health status** showing what's working

**Expected output:**
```
Server starting on port 8080...
✅ File processor initialized
⚠️  Cache not available (running without cache)
🚀 Server running at http://localhost:8080
```

**Test the API server** (in a new terminal window):
```bash
# Check server health
curl http://localhost:8080/health

# Expected response:
{
  "status": "healthy",
  "timestamp": "2025-06-17T...",
  "uptime": 1.234,
  "version": "1.0.0",
  "cache": {
    "redis": "not_configured",
    "bigquery": "not_configured"
  }
}

# Test user listing
curl http://localhost:8080/api/users

# Test file scanning
curl -X POST http://localhost:8080/api/scan/files \
  -H "Content-Type: application/json" \
  -d '{"fileRequests":[{"userEmail":"your-email@yourdomain.com","analysisTypes":["links","sharing"]}]}'
```

**API endpoints available:**
- `GET /health` - Server status and configuration
- `GET /api/users` - List all users in your Workspace
- `POST /api/scan/files` - Scan specific files
- `POST /api/scan/workspace` - Scan entire workspace
- `GET /api/cache/stats` - Cache performance (if enabled)

### Stage 5: Advanced Setup with Caching (Optional)
**Purpose**: Enable high-performance caching for production-like testing

**⚠️ This stage is optional** - the application works fine without caching for development and testing.

#### Prerequisites for Caching:

**1. Redis Server (for fast in-memory caching):**
```bash
# Option A: Using Docker (recommended and easiest)
docker run -d --name redis-cache -p 6379:6379 redis:alpine

# Option B: Install Redis locally
# macOS: brew install redis && brew services start redis
# Ubuntu: sudo apt install redis-server && sudo systemctl start redis

# Verify Redis is running
redis-cli ping
# Should respond: PONG
```

**2. BigQuery Setup (for persistent storage):**
```bash
# Install Google Cloud CLI if not already installed
# Then create a dataset for caching
bq mk --location=US workspace_cache

# Verify dataset exists
bq ls
```

**3. Update .env for caching:**
```bash
# Edit your .env file to enable caching
ENABLE_CACHING=true
REDIS_HOST=localhost
REDIS_PORT=6379
CACHE_DATASET=workspace_cache
GOOGLE_CLOUD_PROJECT=your-project-id
```

#### Test Full Architecture with Caching:
```bash
# Start server with caching enabled
npm run dev

# Check cache connectivity
curl http://localhost:8080/health
# Should show cache connections as "connected"

# Run a scan to populate cache
curl -X POST http://localhost:8080/api/scan/files \
  -H "Content-Type: application/json" \
  -d '{"fileRequests":[{"userEmail":"your-email@yourdomain.com","analysisTypes":["links"]}]}'

# Run the same scan again - should be much faster from cache
curl -X POST http://localhost:8080/api/scan/files \
  -H "Content-Type: application/json" \
  -d '{"fileRequests":[{"userEmail":"your-email@yourdomain.com","analysisTypes":["links"]}]}'

# Check cache performance
curl http://localhost:8080/api/cache/stats
```

**What caching provides:**
- **90% reduction in API calls** for repeat scans
- **75% faster processing** of previously scanned files
- **Persistent storage** of all scan results in BigQuery
- **Production-like performance** characteristics

## 📊 Caching Setup (Optional - For Production Performance)

**When do you need caching?**
- ❌ **NOT needed** for local development/testing with small user sets
- ❌ **NOT needed** for one-off scans of a few users 
- ✅ **Recommended** for production deployments scanning 100+ users
- ✅ **Required** for repeated scans or production workloads

### Option 1: Local Development (No Caching)
```bash
# In your .env file
ENABLE_CACHING=false
```
**What you get:**
- ✅ Works immediately with no additional setup
- ✅ Perfect for testing and development
- ❌ Slower scans (every API call made fresh)
- ❌ No persistent storage of results

### Option 2: Production Setup (With Caching)

**Requirements:**
- Redis server (for fast temporary storage)
- Google BigQuery dataset (for persistent analysis storage)

**Step 1: Set up Redis**

For local development with Redis:
```bash
# Install Redis locally (Ubuntu/Debian)
sudo apt update
sudo apt install redis-server

# Start Redis
sudo systemctl start redis-server
sudo systemctl enable redis-server

# Test Redis is working
redis-cli ping  # Should return "PONG"
```

For production with managed Redis:
- Use Google Cloud Memorystore for Redis
- AWS ElastiCache
- Azure Cache for Redis

**Step 2: Set up BigQuery**

1. **Enable BigQuery API:**
   - Go to [Google Cloud Console](https://console.cloud.google.com)
   - Navigate to APIs & Services > Library
   - Search for "BigQuery API" and enable it

2. **Grant BigQuery permissions to your service account:**
   ```bash
   # Replace with your service account email and project ID
   gcloud projects add-iam-policy-binding YOUR_PROJECT_ID \
     --member="serviceAccount:YOUR_SERVICE_ACCOUNT@YOUR_PROJECT_ID.iam.gserviceaccount.com" \
     --role="roles/bigquery.dataEditor"
   
   gcloud projects add-iam-policy-binding YOUR_PROJECT_ID \
     --member="serviceAccount:YOUR_SERVICE_ACCOUNT@YOUR_PROJECT_ID.iam.gserviceaccount.com" \
     --role="roles/bigquery.jobUser"
   ```

**Step 3: Update your .env for caching:**
```bash
# Enable caching
ENABLE_CACHING=true

# BigQuery configuration  
CACHE_DATASET=workspace_cache  # Dataset will be created automatically

# Redis configuration
REDIS_HOST=localhost  # For local Redis
REDIS_PORT=6379
REDIS_PASSWORD=       # Leave empty for local Redis

# For production Redis, use:
# REDIS_URL=redis://your-redis-host:6379
```

**What you get with caching:**
- ✅ 90% fewer Google API calls
- ✅ 75% faster scan times for repeated operations  
- ✅ Persistent storage of analysis results
- ✅ Better performance for large organizations
- ✅ Automatic cache invalidation and refresh

### Caching Architecture Overview

**Redis (Fast Cache):**
- Stores file metadata temporarily (1-2 hours)
- Caches API responses to reduce Google API calls
- Automatically expires old data

**BigQuery (Persistent Storage):**
- Stores complete analysis results
- Enables historical tracking and reporting
- Supports complex queries across scan results

## 🔧 Configuration Setup (Most Important Step)

### Step 1: Basic Environment Configuration

**Purpose:** Tell the application about your Google Workspace setup.

1. **Copy the environment template:**
```bash
cp env.example .env
```

2. **Edit `.env` with your specific settings:**

**Minimal Configuration (for basic testing):**
```bash
# Your Google Workspace admin email
ADMIN_USER=your-admin@yourdomain.com

# Your organization's primary domain
PRIMARY_DOMAIN=yourdomain.com

# Path to your Google service account key file (we'll create this next)
GOOGLE_APPLICATION_CREDENTIALS=./service-account-key.json

# Disable advanced features for simple testing
ENABLE_CACHING=false
ENABLE_CALENDAR_ANALYSIS=false

# Use smaller batches for testing
BATCH_SIZE=10
```

**What each setting does:**
- `ADMIN_USER`: The email address with admin privileges in your Google Workspace
- `PRIMARY_DOMAIN`: Your organization's domain (everything after @ in user emails)
- `GOOGLE_APPLICATION_CREDENTIALS`: Path to the JSON file containing Google API credentials
- `ENABLE_CACHING=false`: Disables Redis/BigQuery caching for simpler setup
- `BATCH_SIZE=10`: Processes fewer files at once during testing

**Note**: The Google Cloud Project ID is automatically extracted from your service account JSON file, so you don't need to set `GOOGLE_CLOUD_PROJECT` unless you want to override it.

### Step 2: Google Service Account Setup (Critical Step)

**Purpose:** Create credentials that allow the application to access your Google Workspace data.

**Why this is needed:** Google requires special authentication for applications that access user data across an entire organization. A service account provides this authentication.

#### Part A: Create the Service Account

1. **Go to Google Cloud Console:** [console.cloud.google.com](https://console.cloud.google.com/)
2. **Select or create a project:**
   - If you don't have a project: Click "New Project", give it a name
   - If you have projects: Select the one you want to use
3. **Navigate to service accounts:**
   - Go to "IAM & Admin" → "Service Accounts"
4. **Create the service account:**
   - Click "Create Service Account"
   - **Name**: `workspace-tools-scanner` (or any descriptive name)
   - **Description**: `Service account for workspace file scanning`
   - Click "Create and Continue"
   - **Skip** granting project roles (not needed for this step)
   - Click "Done"
5. **Download the key file:**
   - Click on the newly created service account
   - Go to "Keys" tab
   - Click "Add Key" → "Create new key"
   - Choose "JSON" format
   - Click "Create" - this downloads the key file
6. **Move the key file:**
   ```bash
   # Move the downloaded file to your project directory
   mv ~/Downloads/your-project-name-xxxxx.json ./service-account-key.json
   ```

#### Part B: Enable Domain-Wide Delegation

**Purpose:** Allow the service account to act on behalf of users in your organization.

1. **In the service account details page:**
   - Click "Advanced settings" or scroll down
   - Click "Enable Google Workspace Domain-wide Delegation"
   - **Product name**: `Workspace Tools`
   - Click "Save"
2. **Note the Client ID:**
   - Copy the "Client ID" value (it's a long number)
   - You'll need this for the next step

#### Part C: Authorize in Google Admin Console

**Purpose:** Give permission for the service account to access your organization's data.

1. **Go to Google Admin Console:** [admin.google.com](https://admin.google.com)
   - **Note:** You must be a Google Workspace admin to do this step
2. **Navigate to API Controls:**
   - Go to "Security" → "API Controls" → "Domain-wide Delegation"
3. **Add the service account:**
   - Click "Add new"
   - **Client ID**: Paste the Client ID from Part B
   - **OAuth Scopes**: Copy and paste this exact list:
   ```
   https://www.googleapis.com/auth/admin.directory.user.readonly,https://www.googleapis.com/auth/drive,https://www.googleapis.com/auth/documents,https://www.googleapis.com/auth/spreadsheets,https://www.googleapis.com/auth/presentations,https://www.googleapis.com/auth/calendar
   ```
   - Click "Authorize"

**What each scope allows:**
- `admin.directory.user.readonly`: List users in your organization
- `drive`: Access Google Drive files
- `documents`: Read Google Docs content
- `spreadsheets`: Read Google Sheets content and formulas
- `presentations`: Read Google Slides content
- `calendar`: Read calendar events (if calendar analysis is enabled)

### Step 3: Verify Configuration

**Purpose:** Make sure your `.env` file points to the correct credentials file.

1. **Check your file structure:**
```bash
ls -la
# You should see:
# - .env (your configuration file)
# - service-account-key.json (your credentials)
# - package.json (the project file)
```

2. **Verify .env content:**
```bash
cat .env
# Should show your ADMIN_USER, PRIMARY_DOMAIN, and 
# GOOGLE_APPLICATION_CREDENTIALS=./service-account-key.json
```

**Common issues at this stage:**
- File path wrong: Make sure `GOOGLE_APPLICATION_CREDENTIALS` matches your actual file name
- Missing .env file: Make sure you copied `env.example` to `.env`
- Wrong permissions: The service account file should be readable by your user

## 🚀 Local Execution & Testing

### Stage 1: Dependency Validation
**Purpose**: Verify Node.js and npm packages are working

```bash
# Test that all packages installed correctly
npm test
```

**What happens:**
- Loads and tests all JavaScript modules
- Verifies ES modules are working
- Runs basic unit tests
- Reports any missing dependencies

**Expected output:**
```
> workspace-tools@1.0.0 test
> node --experimental-vm-modules node_modules/.bin/jest

PASS tests/cache/file-cache-minimal.test.js
PASS tests/processing/file-processor.test.js
...
Tests: X passed, Y total
```

**⚠️ Some tests may fail** - this is normal if you haven't set up Redis or BigQuery yet. Look for successful module loading rather than 100% test pass rate.

### Stage 2: Google Workspace Authentication Test
**Purpose**: Verify your Google Workspace setup and credentials work

```bash
# Run the comprehensive setup validation
node test-setup.js
```

**What happens step-by-step:**
1. **Loads your `.env` configuration** and validates required fields
2. **Initializes the file processor** without external dependencies
3. **Tests Google Workspace authentication** using your service account
4. **Lists users in your domain** to confirm API access is working
5. **Reports connection status** for caching services (may show warnings if not configured)

**Expected successful output:**
```
🧪 Testing Workspace Tools v2.0 Architecture
=============================================
1. Testing environment configuration...
   ✅ Environment configuration valid
2. Testing file processor initialization...
   ✅ File processor initialized
3. Caching disabled - skipping cache tests
4. Testing Google APIs...
   ✅ Google APIs working - found 15 users
5. Testing file access for admin user...
   ✅ Can access admin user files
```

**Common failures and solutions:**
| Error Message | Cause | Solution |
|---------------|-------|----------|
| "Authentication failed" | Service account not properly authorized | Re-check domain-wide delegation setup |
| "Admin user not found" | Wrong email in ADMIN_USER | Verify email exists and is spelled correctly |
| "Permission denied" | Missing OAuth scopes | Add all required scopes in Admin Console |
| "Cannot find credentials" | Wrong file path | Check GOOGLE_APPLICATION_CREDENTIALS path |

### Stage 3: First File Scan (Basic CLI)
**Purpose**: Run your first actual file scan to see results

```bash
# Scan files for a specific user (replace with real email from your organization)
npm start -- --users your-email@yourdomain.com --no-calendars

# Alternative: Use legacy mode for simpler output
npm run legacy -- --users your-email@yourdomain.com
```

**What happens during the scan:**
1. **Authenticates with Google Workspace** using your service account
2. **Gets list of files** for the specified user from Google Drive
3. **Downloads and analyzes each file** for:
   - Links to other workspace files
   - Sharing permissions and external access
   - Google Sheets formulas and migration complexity
   - File organization and location analysis
4. **Outputs results** as JSON data showing all discovered information

**Expected output format:**
```json
{
  "user": "your-email@yourdomain.com",
  "totalFiles": 25,
  "scanResults": [
    {
      "fileId": "1abc...",
      "fileName": "Project Report.docx",
      "fileType": "document",
      "links": ["https://docs.google.com/spreadsheets/d/xyz..."],
      "sharing": {
        "isPublic": false,
        "externalShares": 0,
        "sharedWithDomain": true
      },
      "migrationComplexity": "low"
    }
  ]
}
```

**What to look for:**
- ✅ User email appears in results
- ✅ Files are being found and analyzed
- ✅ Links and sharing data are populated
- ✅ No authentication errors

**Troubleshooting:**
- If "No files found": User might not have any files, or permissions issue
- If "Rate limit exceeded": Reduce BATCH_SIZE in .env to 5 or lower
- If "Authentication error": Double-check service account setup

### Stage 4: API Server Mode (Web Interface)
**Purpose**: Run the web API server for HTTP-based access

```bash
# Start the API server locally
npm run dev

# Server starts on port 8080
```

**What happens when you start the server:**
1. **Loads configuration** from your .env file
2. **Initializes Express.js web server** on port 8080
3. **Sets up API endpoints** for file scanning and management
4. **Connects to caching services** (if enabled) or runs without cache
5. **Reports health status** showing what's working

**Expected output:**
```
Server starting on port 8080...
✅ File processor initialized
⚠️  Cache not available (running without cache)
🚀 Server running at http://localhost:8080
```

**Test the API server** (in a new terminal window):
```bash
# Check server health
curl http://localhost:8080/health

# Expected response:
{
  "status": "healthy",
  "timestamp": "2025-06-17T...",
  "uptime": 1.234,
  "version": "1.0.0",
  "cache": {
    "redis": "not_configured",
    "bigquery": "not_configured"
  }
}

# Test user listing
curl http://localhost:8080/api/users

# Test file scanning
curl -X POST http://localhost:8080/api/scan/files \
  -H "Content-Type: application/json" \
  -d '{"fileRequests":[{"userEmail":"your-email@yourdomain.com","analysisTypes":["links","sharing"]}]}'
```

**API endpoints available:**
- `GET /health` - Server status and configuration
- `GET /api/users` - List all users in your Workspace
- `POST /api/scan/files` - Scan specific files
- `POST /api/scan/workspace` - Scan entire workspace
- `GET /api/cache/stats` - Cache performance (if enabled)

### Stage 5: Advanced Setup with Caching (Optional)
**Purpose**: Enable high-performance caching for production-like testing

**⚠️ This stage is optional** - the application works fine without caching for development and testing.

#### Prerequisites for Caching:

**1. Redis Server (for fast in-memory caching):**
```bash
# Option A: Using Docker (recommended and easiest)
docker run -d --name redis-cache -p 6379:6379 redis:alpine

# Option B: Install Redis locally
# macOS: brew install redis && brew services start redis
# Ubuntu: sudo apt install redis-server && sudo systemctl start redis

# Verify Redis is running
redis-cli ping
# Should respond: PONG
```

**2. BigQuery Setup (for persistent storage):**
```bash
# Install Google Cloud CLI if not already installed
# Then create a dataset for caching
bq mk --location=US workspace_cache

# Verify dataset exists
bq ls
```

**3. Update .env for caching:**
```bash
# Edit your .env file to enable caching
ENABLE_CACHING=true
REDIS_HOST=localhost
REDIS_PORT=6379
CACHE_DATASET=workspace_cache
GOOGLE_CLOUD_PROJECT=your-project-id
```

#### Test Full Architecture with Caching:
```bash
# Start server with caching enabled
npm run dev

# Check cache connectivity
curl http://localhost:8080/health
# Should show cache connections as "connected"

# Run a scan to populate cache
curl -X POST http://localhost:8080/api/scan/files \
  -H "Content-Type: application/json" \
  -d '{"fileRequests":[{"userEmail":"your-email@yourdomain.com","analysisTypes":["links"]}]}'

# Run the same scan again - should be much faster from cache
curl -X POST http://localhost:8080/api/scan/files \
  -H "Content-Type: application/json" \
  -d '{"fileRequests":[{"userEmail":"your-email@yourdomain.com","analysisTypes":["links"]}]}'

# Check cache performance
curl http://localhost:8080/api/cache/stats
```

**What caching provides:**
- **90% reduction in API calls** for repeat scans
- **75% faster processing** of previously scanned files
- **Persistent storage** of all scan results in BigQuery
- **Production-like performance** characteristics

## 📊 Caching Setup (Optional - For Production Performance)

**When do you need caching?**
- ❌ **NOT needed** for local development/testing with small user sets
- ❌ **NOT needed** for one-off scans of a few users 
- ✅ **Recommended** for production deployments scanning 100+ users
- ✅ **Required** for repeated scans or production workloads

### Option 1: Local Development (No Caching)
```bash
# In your .env file
ENABLE_CACHING=false
```
**What you get:**
- ✅ Works immediately with no additional setup
- ✅ Perfect for testing and development
- ❌ Slower scans (every API call made fresh)
- ❌ No persistent storage of results

### Option 2: Production Setup (With Caching)

**Requirements:**
- Redis server (for fast temporary storage)
- Google BigQuery dataset (for persistent analysis storage)

**Step 1: Set up Redis**

For local development with Redis:
```bash
# Install Redis locally (Ubuntu/Debian)
sudo apt update
sudo apt install redis-server

# Start Redis
sudo systemctl start redis-server
sudo systemctl enable redis-server

# Test Redis is working
redis-cli ping  # Should return "PONG"
```

For production with managed Redis:
- Use Google Cloud Memorystore for Redis
- AWS ElastiCache
- Azure Cache for Redis

**Step 2: Set up BigQuery**

1. **Enable BigQuery API:**
   - Go to [Google Cloud Console](https://console.cloud.google.com)
   - Navigate to APIs & Services > Library
   - Search for "BigQuery API" and enable it

2. **Grant BigQuery permissions to your service account:**
   ```bash
   # Replace with your service account email and project ID
   gcloud projects add-iam-policy-binding YOUR_PROJECT_ID \
     --member="serviceAccount:YOUR_SERVICE_ACCOUNT@YOUR_PROJECT_ID.iam.gserviceaccount.com" \
     --role="roles/bigquery.dataEditor"
   
   gcloud projects add-iam-policy-binding YOUR_PROJECT_ID \
     --member="serviceAccount:YOUR_SERVICE_ACCOUNT@YOUR_PROJECT_ID.iam.gserviceaccount.com" \
     --role="roles/bigquery.jobUser"
   ```

**Step 3: Update your .env for caching:**
```bash
# Enable caching
ENABLE_CACHING=true

# BigQuery configuration  
CACHE_DATASET=workspace_cache  # Dataset will be created automatically

# Redis configuration
REDIS_HOST=localhost  # For local Redis
REDIS_PORT=6379
REDIS_PASSWORD=       # Leave empty for local Redis

# For production Redis, use:
# REDIS_URL=redis://your-redis-host:6379
```

**What you get with caching:**
- ✅ 90% fewer Google API calls
- ✅ 75% faster scan times for repeated operations  
- ✅ Persistent storage of analysis results
- ✅ Better performance for large organizations
- ✅ Automatic cache invalidation and refresh

### Caching Architecture Overview

**Redis (Fast Cache):**
- Stores file metadata temporarily (1-2 hours)
- Caches API responses to reduce Google API calls
- Automatically expires old data

**BigQuery (Persistent Storage):**
- Stores complete analysis results
- Enables historical tracking and reporting
- Supports complex queries across scan results

## 🔧 Configuration Setup (Most Important Step)

### Step 1: Basic Environment Configuration

**Purpose:** Tell the application about your Google Workspace setup.

1. **Copy the environment template:**
```bash
cp env.example .env
```

2. **Edit `.env` with your specific settings:**

**Minimal Configuration (for basic testing):**
```bash
# Your Google Workspace admin email
ADMIN_USER=your-admin@yourdomain.com

# Your organization's primary domain
PRIMARY_DOMAIN=yourdomain.com

# Path to your Google service account key file (we'll create this next)
GOOGLE_APPLICATION_CREDENTIALS=./service-account-key.json

# Disable advanced features for simple testing
ENABLE_CACHING=false
ENABLE_CALENDAR_ANALYSIS=false

# Use smaller batches for testing
BATCH_SIZE=10
```

**What each setting does:**
- `ADMIN_USER`: The email address with admin privileges in your Google Workspace
- `PRIMARY_DOMAIN`: Your organization's domain (everything after @ in user emails)
- `GOOGLE_APPLICATION_CREDENTIALS`: Path to the JSON file containing Google API credentials
- `ENABLE_CACHING=false`: Disables Redis/BigQuery caching for simpler setup
- `BATCH_SIZE=10`: Processes fewer files at once during testing

**Note**: The Google Cloud Project ID is automatically extracted from your service account JSON file, so you don't need to set `GOOGLE_CLOUD_PROJECT` unless you want to override it.

### Step 2: Google Service Account Setup (Critical Step)

**Purpose:** Create credentials that allow the application to access your Google Workspace data.

**Why this is needed:** Google requires special authentication for applications that access user data across an entire organization. A service account provides this authentication.

#### Part A: Create the Service Account

1. **Go to Google Cloud Console:** [console.cloud.google.com](https://console.cloud.google.com/)
2. **Select or create a project:**
   - If you don't have a project: Click "New Project", give it a name
   - If you have projects: Select the one you want to use
3. **Navigate to service accounts:**
   - Go to "IAM & Admin" → "Service Accounts"
4. **Create the service account:**
   - Click "Create Service Account"
   - **Name**: `workspace-tools-scanner` (or any descriptive name)
   - **Description**: `Service account for workspace file scanning`
   - Click "Create and Continue"
   - **Skip** granting project roles (not needed for this step)
   - Click "Done"
5. **Download the key file:**
   - Click on the newly created service account
   - Go to "Keys" tab
   - Click "Add Key" → "Create new key"
   - Choose "JSON" format
   - Click "Create" - this downloads the key file
6. **Move the key file:**
   ```bash
   # Move the downloaded file to your project directory
   mv ~/Downloads/your-project-name-xxxxx.json ./service-account-key.json
   ```

#### Part B: Enable Domain-Wide Delegation

**Purpose:** Allow the service account to act on behalf of users in your organization.

1. **In the service account details page:**
   - Click "Advanced settings" or scroll down
   - Click "Enable Google Workspace Domain-wide Delegation"
   - **Product name**: `Workspace Tools`
   - Click "Save"
2. **Note the Client ID:**
   - Copy the "Client ID" value (it's a long number)
   - You'll need this for the next step

#### Part C: Authorize in Google Admin Console

**Purpose:** Give permission for the service account to access your organization's data.

1. **Go to Google Admin Console:** [admin.google.com](https://admin.google.com)
   - **Note:** You must be a Google Workspace admin to do this step
2. **Navigate to API Controls:**
   - Go to "Security" → "API Controls" → "Domain-wide Delegation"
3. **Add the service account:**
   - Click "Add new"
   - **Client ID**: Paste the Client ID from Part B
   - **OAuth Scopes**: Copy and paste this exact list:
   ```
   https://www.googleapis.com/auth/admin.directory.user.readonly,https://www.googleapis.com/auth/drive,https://www.googleapis.com/auth/documents,https://www.googleapis.com/auth/spreadsheets,https://www.googleapis.com/auth/presentations,https://www.googleapis.com/auth/calendar
   ```
   - Click "Authorize"

**What each scope allows:**
- `admin.directory.user.readonly`: List users in your organization
- `drive`: Access Google Drive files
- `documents`: Read Google Docs content
- `spreadsheets`: Read Google Sheets content and formulas
- `presentations`: Read Google Slides content
- `calendar`: Read calendar events (if calendar analysis is enabled)

### Step 3: Verify Configuration

**Purpose:** Make sure your `.env` file points to the correct credentials file.

1. **Check your file structure:**
```bash
ls -la
# You should see:
# - .env (your configuration file)
# - service-account-key.json (your credentials)
# - package.json (the project file)
```

2. **Verify .env content:**
```bash
cat .env
# Should show your ADMIN_USER, PRIMARY_DOMAIN, and 
# GOOGLE_APPLICATION_CREDENTIALS=./service-account-key.json
```

**Common issues at this stage:**
- File path wrong: Make sure `GOOGLE_APPLICATION_CREDENTIALS` matches your actual file name
- Missing .env file: Make sure you copied `env.example` to `.env`
- Wrong permissions: The service account file should be readable by your user

## 🚀 Local Execution & Testing

### Stage 1: Dependency Validation
**Purpose**: Verify Node.js and npm packages are working

```bash
# Test that all packages installed correctly
npm test
```

**What happens:**
- Loads and tests all JavaScript modules
- Verifies ES modules are working
- Runs basic unit tests
- Reports any missing dependencies

**Expected output:**
```
> workspace-tools@1.0.0 test
> node --experimental-vm-modules node_modules/.bin/jest

PASS tests/cache/file-cache-minimal.test.js
PASS tests/processing/file-processor.test.js
...
Tests: X passed, Y total
```

**⚠️ Some tests may fail** - this is normal if you haven't set up Redis or BigQuery yet. Look for successful module loading rather than 100% test pass rate.

### Stage 2: Google Workspace Authentication Test
**Purpose**: Verify your Google Workspace setup and credentials work

```bash
# Run the comprehensive setup validation
node test-setup.js
```

**What happens step-by-step:**
1. **Loads your `.env` configuration** and validates required fields
2. **Initializes the file processor** without external dependencies
3. **Tests Google Workspace authentication** using your service account
4. **Lists users in your domain** to confirm API access is working
5. **Reports connection status** for caching services (may show warnings if not configured)

**Expected successful output:**
```
🧪 Testing Workspace Tools v2.0 Architecture
=============================================
1. Testing environment configuration...
   ✅ Environment configuration valid
2. Testing file processor initialization...
   ✅ File processor initialized
3. Caching disabled - skipping cache tests
4. Testing Google APIs...
   ✅ Google APIs working - found 15 users
5. Testing file access for admin user...
   ✅ Can access admin user files
```

**Common failures and solutions:**
| Error Message | Cause | Solution |
|---------------|-------|----------|
| "Authentication failed" | Service account not properly authorized | Re-check domain-wide delegation setup |
| "Admin user not found" | Wrong email in ADMIN_USER | Verify email exists and is spelled correctly |
| "Permission denied" | Missing OAuth scopes | Add all required scopes in Admin Console |
| "Cannot find credentials" | Wrong file path | Check GOOGLE_APPLICATION_CREDENTIALS path |

### Stage 3: First File Scan (Basic CLI)
**Purpose**: Run your first actual file scan to see results

```bash
# Scan files for a specific user (replace with real email from your organization)
npm start -- --users your-email@yourdomain.com --no-calendars

# Alternative: Use legacy mode for simpler output
npm run legacy -- --users your-email@yourdomain.com
```

**What happens during the scan:**
1. **Authenticates with Google Workspace** using your service account
2. **Gets list of files** for the specified user from Google Drive
3. **Downloads and analyzes each file** for:
   - Links to other workspace files
   - Sharing permissions and external access
   - Google Sheets formulas and migration complexity
   - File organization and location analysis
4. **Outputs results** as JSON data showing all discovered information

**Expected output format:**
```json
{
  "user": "your-email@yourdomain.com",
  "totalFiles": 25,
  "scanResults": [
    {
      "fileId": "1abc...",
      "fileName": "Project Report.docx",
      "fileType": "document",
      "links": ["https://docs.google.com/spreadsheets/d/xyz..."],
      "sharing": {
        "isPublic": false,
        "externalShares": 0,
        "sharedWithDomain": true
      },
      "migrationComplexity": "low"
    }
  ]
}
```

**What to look for:**
- ✅ User email appears in results
- ✅ Files are being found and analyzed
- ✅ Links and sharing data are populated
- ✅ No authentication errors

**Troubleshooting:**
- If "No files found": User might not have any files, or permissions issue
- If "Rate limit exceeded": Reduce BATCH_SIZE in .env to 5 or lower
- If "Authentication error": Double-check service account setup

### Stage 4: API Server Mode (Web Interface)
**Purpose**: Run the web API server for HTTP-based access

```bash
# Start the API server locally
npm run dev

# Server starts on port 8080
```

**What happens when you start the server:**
1. **Loads configuration** from your .env file
2. **Initializes Express.js web server** on port 8080
3. **Sets up API endpoints** for file scanning and management
4. **Connects to caching services** (if enabled) or runs without cache
5. **Reports health status** showing what's working

**Expected output:**
```
Server starting on port 8080...
✅ File processor initialized
⚠️  Cache not available (running without cache)
🚀 Server running at http://localhost:8080
```

**Test the API server** (in a new terminal window):
```bash
# Check server health
curl http://localhost:8080/health

# Expected response:
{
  "status": "healthy",
  "timestamp": "2025-06-17T...",
  "uptime": 1.234,
  "version": "1.0.0",
  "cache": {
    "redis": "not_configured",
    "bigquery": "not_configured"
  }
}

# Test user listing
curl http://localhost:8080/api/users

# Test file scanning
curl -X POST http://localhost:8080/api/scan/files \
  -H "Content-Type: application/json" \
  -d '{"fileRequests":[{"userEmail":"your-email@yourdomain.com","analysisTypes":["links","sharing"]}]}'
```

**API endpoints available:**
- `GET /health` - Server status and configuration
- `GET /api/users` - List all users in your Workspace
- `POST /api/scan/files` - Scan specific files
- `POST /api/scan/workspace` - Scan entire workspace
- `GET /api/cache/stats` - Cache performance (if enabled)

### Stage 5: Advanced Setup with Caching (Optional)
**Purpose**: Enable high-performance caching for production-like testing

**⚠️ This stage is optional** - the application works fine without caching for development and testing.

#### Prerequisites for Caching:

**1. Redis Server (for fast in-memory caching):**
```bash
# Option A: Using Docker (recommended and easiest)
docker run -d --name redis-cache -p 6379:6379 redis:alpine

# Option B: Install Redis locally
# macOS: brew install redis && brew services start redis
# Ubuntu: sudo apt install redis-server && sudo systemctl start redis

# Verify Redis is running
redis-cli ping
# Should respond: PONG
```

**2. BigQuery Setup (for persistent storage):**
```bash
# Install Google Cloud CLI if not already installed
# Then create a dataset for caching
bq mk --location=US workspace_cache

# Verify dataset exists
bq ls
```

**3. Update .env for caching:**
```bash
# Edit your .env file to enable caching
ENABLE_CACHING=true
REDIS_HOST=localhost
REDIS_PORT=6379
CACHE_DATASET=workspace_cache
GOOGLE_CLOUD_PROJECT=your-project-id
```

#### Test Full Architecture with Caching:
```bash
# Start server with caching enabled
npm run dev

# Check cache connectivity
curl http://localhost:8080/health
# Should show cache connections as "connected"

# Run a scan to populate cache
curl -X POST http://localhost:8080/api/scan/files \
  -H "Content-Type: application/json" \
  -d '{"fileRequests":[{"userEmail":"your-email@yourdomain.com","analysisTypes":["links"]}]}'

# Run the same scan again - should be much faster from cache
curl -X POST http://localhost:8080/api/scan/files \
  -H "Content-Type: application/json" \
  -d '{"fileRequests":[{"userEmail":"your-email@yourdomain.com","analysisTypes":["links"]}]}'

# Check cache performance
curl http://localhost:8080/api/cache/stats
```

**What caching provides:**
- **90% reduction in API calls** for repeat scans
- **75% faster processing** of previously scanned files
- **Persistent storage** of all scan results in BigQuery
- **Production-like performance** characteristics

## 📊 Caching Setup (Optional - For Production Performance)

**When do you need caching?**
- ❌ **NOT needed** for local development/testing with small user sets
- ❌ **NOT needed** for one-off scans of a few users 
- ✅ **Recommended** for production deployments scanning 100+ users
- ✅ **Required** for repeated scans or production workloads

### Option 1: Local Development (No Caching)
```bash
# In your .env file
ENABLE_CACHING=false
```
**What you get:**
- ✅ Works immediately with no additional setup
- ✅ Perfect for testing and development
- ❌ Slower scans (every API call made fresh)
- ❌ No persistent storage of results

### Option 2: Production Setup (With Caching)

**Requirements:**
- Redis server (for fast temporary storage)
- Google BigQuery dataset (for persistent analysis storage)

**Step 1: Set up Redis**

For local development with Redis:
```bash
# Install Redis locally (Ubuntu/Debian)
sudo apt update
sudo apt install redis-server

# Start Redis
sudo systemctl start redis-server
sudo systemctl enable redis-server

# Test Redis is working
redis-cli ping  # Should return "PONG"
```

For production with managed Redis:
- Use Google Cloud Memorystore for Redis
- AWS ElastiCache
- Azure Cache for Redis

**Step 2: Set up BigQuery**

1. **Enable BigQuery API:**
   - Go to [Google Cloud Console](https://console.cloud.google.com)
   - Navigate to APIs & Services > Library
   - Search for "BigQuery API" and enable it

2. **Grant BigQuery permissions to your service account:**
   ```bash
   # Replace with your service account email and project ID
   gcloud projects add-iam-policy-binding YOUR_PROJECT_ID \
     --member="serviceAccount:YOUR_SERVICE_ACCOUNT@YOUR_PROJECT_ID.iam.gserviceaccount.com" \
     --role="roles/bigquery.dataEditor"
   
   gcloud projects add-iam-policy-binding YOUR_PROJECT_ID \
     --member="serviceAccount:YOUR_SERVICE_ACCOUNT@YOUR_PROJECT_ID.iam.gserviceaccount.com" \
     --role="roles/bigquery.jobUser"
   ```

**Step 3: Update your .env for caching:**
```bash
# Enable caching
ENABLE_CACHING=true

# BigQuery configuration  
CACHE_DATASET=workspace_cache  # Dataset will be created automatically

# Redis configuration
REDIS_HOST=localhost  # For local Redis
REDIS_PORT=6379
REDIS_PASSWORD=       # Leave empty for local Redis

# For production Redis, use:
# REDIS_URL=redis://your-redis-host:6379
```

**What you get with caching:**
- ✅ 90% fewer Google API calls
- ✅ 75% faster scan times for repeated operations  
- ✅ Persistent storage of analysis results
- ✅ Better performance for large organizations
- ✅ Automatic cache invalidation and refresh

### Caching Architecture Overview

**Redis (Fast Cache):**
- Stores file metadata temporarily (1-2 hours)
- Caches API responses to reduce Google API calls
- Automatically expires old data

**BigQuery (Persistent Storage):**
- Stores complete analysis results
- Enables historical tracking and reporting
- Supports complex queries across scan results

## 🔧 Configuration Setup (Most Important Step)

### Step 1: Basic Environment Configuration

**Purpose:** Tell the application about your Google Workspace setup.

1. **Copy the environment template:**
```bash
cp env.example .env
```

2. **Edit `.env` with your specific settings:**

**Minimal Configuration (for basic testing):**
```bash
# Your Google Workspace admin email
ADMIN_USER=your-admin@yourdomain.com

# Your organization's primary domain
PRIMARY_DOMAIN=yourdomain.com

# Path to your Google service account key file (we'll create this next)
GOOGLE_APPLICATION_CREDENTIALS=./service-account-key.json

# Disable advanced features for simple testing
ENABLE_CACHING=false
ENABLE_CALENDAR_ANALYSIS=false

# Use smaller batches for testing
BATCH_SIZE=10
```

**What each setting does:**
- `ADMIN_USER`: The email address with admin privileges in your Google Workspace
- `PRIMARY_DOMAIN`: Your organization's domain (everything after @ in user emails)
- `GOOGLE_APPLICATION_CREDENTIALS`: Path to the JSON file containing Google API credentials
- `ENABLE_CACHING=false`: Disables Redis/BigQuery caching for simpler setup
- `BATCH_SIZE=10`: Processes fewer files at once during testing

**Note**: The Google Cloud Project ID is automatically extracted from your service account JSON file, so you don't need to set `GOOGLE_CLOUD_PROJECT` unless you want to override it.

### Step 2: Google Service Account Setup (Critical Step)

**Purpose:** Create credentials that allow the application to access your Google Workspace data.

**Why this is needed:** Google requires special authentication for applications that access user data across an entire organization. A service account provides this authentication.

#### Part A: Create the Service Account

1. **Go to Google Cloud Console:** [console.cloud.google.com](https://console.cloud.google.com/)
2. **Select or create a project:**
   - If you don't have a project: Click "New Project", give it a name
   - If you have projects: Select the one you want to use
3. **Navigate to service accounts:**
   - Go to "IAM & Admin" → "Service Accounts"
4. **Create the service account:**
   - Click "Create Service Account"
   - **Name**: `workspace-tools-scanner` (or any descriptive name)
   - **Description**: `Service account for workspace file scanning`
   - Click "Create and Continue"
   - **Skip** granting project roles (not needed for this step)
   - Click "Done"
5. **Download the key file:**
   - Click on the newly created service account
   - Go to "Keys" tab
   - Click "Add Key" → "Create new key"
   - Choose "JSON" format
   - Click "Create" - this downloads the key file
6. **Move the key file:**
   ```bash
   # Move the downloaded file to your project directory
   mv ~/Downloads/your-project-name-