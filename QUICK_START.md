# ⚡ Quick Start Guide - Workspace Tools

**Get up and running in 10 minutes with the essential setup (no Redis/BigQuery required).**

## 🎯 Prerequisites (Install These First)

1. **Node.js 18+**: Download from [nodejs.org](https://nodejs.org/)
2. **Google Workspace Admin Access**: You need admin rights to authorize the application

## 🚀 5-Step Setup (No External Dependencies)

### Step 1: Install Dependencies
```bash
git clone <your-repo-url>  # or download the project
cd workspace-tools
npm install
```

### Step 2: Create Google Service Account

1. Go to [Google Cloud Console](https://console.cloud.google.com/)
2. Create/select a project
3. Go to IAM & Admin → Service Accounts → Create Service Account
4. Name: `workspace-scanner`, click Create
5. Skip roles, click Done
6. Click on the service account → Keys → Add Key → Create New Key → JSON
7. Download the JSON file and save it as `service-account-key.json` in your project folder

### Step 3: Enable Domain-Wide Delegation

1. In the service account page, enable "Domain-wide Delegation"
2. Copy the Client ID (long number)
3. Go to [admin.google.com](https://admin.google.com) → Security → API Controls → Domain-wide Delegation
4. Click Add New:
   - **Client ID**: Paste the copied Client ID
   - **OAuth Scopes**: 
   ```
   https://www.googleapis.com/auth/admin.directory.user.readonly,https://www.googleapis.com/auth/drive,https://www.googleapis.com/auth/documents,https://www.googleapis.com/auth/spreadsheets,https://www.googleapis.com/auth/presentations
   ```
5. Click Authorize

### Step 4: Configure Environment
```bash
# Copy the example configuration
cp env.example .env

# Edit .env with your details:
ADMIN_USER=your-admin@yourdomain.com
PRIMARY_DOMAIN=yourdomain.com
GOOGLE_APPLICATION_CREDENTIALS=./service-account-key.json
ENABLE_CACHING=false
```

**Note**: The Google Cloud Project ID is automatically read from your service account JSON file, so you don't need to set `GOOGLE_CLOUD_PROJECT` manually.

### Step 5: Test Your Setup
```bash
# 1. Test Google Workspace connection first
node test-setup.js

# 2. Run your first scan to verify core functionality
npm start -- --users your-email@yourdomain.com

# 3. Start the API server (after basic functionality is confirmed)
npm run dev
```

## ✅ Success Indicators

After each step, you should see:
- ✅ **Step 1**: `node test-setup.js` shows "Google APIs working - found X users"
- ✅ **Step 2**: CLI scan produces JSON results with file data
- ✅ **Step 3**: API server starts and responds to `curl http://localhost:8080/health`

**Important**: Test each step in order. Don't start the API server until the basic CLI functionality works!

## 🚨 Common Issues

| Problem | Solution |
|---------|----------|
| "Authentication failed" | Check domain-wide delegation setup |
| "Admin user not found" | Verify ADMIN_USER email is correct |
| "No such file" | Make sure service account JSON file path is correct |

## 🎯 When Do You Need Redis/BigQuery?

**Short Answer:** You don't need them for getting started!

### ❌ You DON'T need Redis/BigQuery for:
- Local development and testing
- Scanning a few users (< 50)
- One-off analysis tasks
- Learning how the tool works

### ✅ You DO need Redis/BigQuery for:
- Production deployments
- Scanning large organizations (100+ users)
- Repeated scans with caching benefits
- 90% faster performance

**To enable caching later:** See the [Full Local Setup Guide](./LOCAL_SETUP_GUIDE.md#caching-setup) for Redis and BigQuery setup instructions.

## 📚 Next Steps

Once the quick start works:
- **[Full Local Setup Guide](./LOCAL_SETUP_GUIDE.md)** - Complete configuration options and caching setup
- **[Deployment Guide](./DEPLOYMENT_CHECKLIST.md)** - Deploy to Google Cloud Run
- **[API Documentation](./README.md#api-endpoints)** - Use the REST API

**Questions?** Check the troubleshooting sections in the full guides!
