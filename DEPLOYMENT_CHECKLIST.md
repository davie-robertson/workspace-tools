# 🚀 Deployment Guide - Workspace Tools v2.0

## 📋 Before You Start

**Complete local setup first**: Follow the [Local Setup Guide](./LOCAL_SETUP_GUIDE.md) to ensure everything works locally before deploying to cloud.

### Local Prerequisites Checklist
- [ ] ✅ Local setup completed successfully
- [ ] ✅ `npm install` completed without errors
- [ ] ✅ `node test-setup.js` passes authentication tests
- [ ] ✅ Basic file scanning works: `npm start -- --users your-email@domain.com`
- [ ] ✅ API server starts: `npm run dev` and health check responds

## 🏗️ Deployment Architecture Overview

### What Gets Deployed
```
Local Development  →  Google Cloud Run Deployment
├── Node.js App    →  Containerized Service
├── Redis (local)  →  Cloud Memorystore (Redis)
├── BigQuery       →  BigQuery Dataset & Tables
└── Credentials    →  Secret Manager
```

### Deployment Stages Explained

#### Stage 1: Infrastructure Setup (`npm run deploy:setup`)
**Duration**: 5-10 minutes  
**What happens**:
1. **Enables Google Cloud APIs** needed for the application:
   - Cloud Run API (for hosting the application)
   - Cloud Memorystore API (for Redis caching)
   - BigQuery API (for data storage)
   - Secret Manager API (for secure credential storage)
2. **Creates Redis instance** in Cloud Memorystore:
   - Allocates a managed Redis server in Google Cloud
   - Configures network access and security
   - Provides connection details for the application
3. **Creates BigQuery dataset** for persistent data storage:
   - Sets up database tables for file analysis results
   - Configures access permissions and retention policies
   - Establishes connection for the application
4. **Sets up Secret Manager** for secure credential storage:
   - Creates secret containers for sensitive data
   - Configures access permissions for Cloud Run
   - Prepares for manual secret upload in next stage
5. **Configures IAM roles** for service access:
   - Grants Cloud Run access to Redis and BigQuery
   - Sets up service account permissions
   - Ensures secure inter-service communication

**Output**: All cloud infrastructure ready for application deployment

#### Stage 2: Secrets Configuration (Manual Step)
**Duration**: 2-3 minutes  
**What you need to do manually**:
1. **Upload service account key** to Secret Manager:
   ```bash
   gcloud secrets versions add gcp-service-account-key \
     --data-file=./service-account-key.json
   ```
2. **Store configuration values**:
   ```bash
   # Your admin email
   echo "admin@yourdomain.com" | gcloud secrets versions add workspace-admin-user --data-file=-
   
   # Your primary domain
   echo "yourdomain.com" | gcloud secrets versions add workspace-primary-domain --data-file=-
   ```

**Why this is manual**: Sensitive credentials should never be stored in code or automated scripts for security reasons.

**Output**: All sensitive configuration securely stored in Google Cloud

#### Stage 3: Build & Deploy (`npm run deploy:build`)
**Duration**: 3-5 minutes  
**What happens**:
1. **Builds Docker container** with your application:
   - Packages Node.js application into a container image
   - Includes all dependencies and configuration
   - Optimizes image size and security
2. **Pushes image** to Google Container Registry:
   - Uploads container to Google's secure image storage
   - Tags image with version information
   - Makes image available for Cloud Run deployment
3. **Deploys to Cloud Run** with proper configuration:
   - Creates Cloud Run service from container image
   - Configures memory, CPU, and scaling settings
   - Links to Redis, BigQuery, and Secret Manager
4. **Sets up auto-scaling** and health checks:
   - Configures automatic scaling based on traffic
   - Sets up health monitoring and restart policies
   - Ensures high availability and performance
5. **Configures networking** and security:
   - Sets up HTTPS endpoint with SSL certificate
   - Configures firewall rules and access controls
   - Enables secure communication with other services

**Output**: Live application accessible via secure HTTPS URL

#### Stage 4: Validation & Testing
**Duration**: 2-3 minutes  
**What to test**:
1. **Basic connectivity**:
   ```bash
   curl https://your-service-url.run.app/health
   ```
2. **Authentication and API access**:
   ```bash
   curl https://your-service-url.run.app/api/users
   ```
3. **File scanning functionality**:
   ```bash
   curl -X POST https://your-service-url.run.app/api/scan/files \
     -H "Content-Type: application/json" \
     -d '{"fileRequests":[{"userEmail":"test@domain.com"}]}'
   ```

**What each test validates**:
- Health check: Basic service functionality and dependencies
- Users endpoint: Google Workspace authentication working
- File scan: End-to-end functionality including caching

## ✅ Pre-Deployment Checklist

### 1. Environment Setup
- [ ] Copy `env.example` to `.env`
- [ ] Configure Google Workspace settings:
  - [ ] `ADMIN_USER` - Your admin email
  - [ ] `PRIMARY_DOMAIN` - Your workspace domain
  - [ ] `GOOGLE_APPLICATION_CREDENTIALS` - Service account key path
- [ ] Google Cloud Project ID (automatically extracted from service account file)
- [ ] Configure caching settings (optional):
  - [ ] `ENABLE_CACHING=true`
  - [ ] `REDIS_HOST` and `REDIS_PORT`
  - [ ] `CACHE_DATASET` name

### 2. Google Cloud Prerequisites
- [ ] Google Cloud Project created
- [ ] Service Account created with domain-wide delegation
- [ ] Required APIs enabled:
  - [ ] Admin SDK API
  - [ ] Google Drive API
  - [ ] Google Docs API
  - [ ] Google Sheets API
  - [ ] Google Slides API
  - [ ] Google Calendar API
  - [ ] Cloud Run API
  - [ ] BigQuery API
  - [ ] Cloud Memorystore (Redis) API

### 3. Local Testing
- [ ] Dependencies installed: `npm install`
- [ ] Setup validation passed: `npm test`
- [ ] Legacy CLI works: `npm start -- --help`
- [ ] API server starts: `npm run server`
- [ ] Health check responds: `curl http://localhost:8080/health`

## 🏗 Deployment Steps

### Option A: Automated Deployment (Recommended)

```bash
# 1. Run complete deployment
npm run deploy

# 2. Follow prompts to configure secrets
# 3. Test deployed service
curl https://your-service-url.run.app/health
```

### Option B: Manual Step-by-Step Deployment

#### Step 1: Infrastructure Setup
```bash
npm run deploy:setup
```
- [ ] Redis instance created
- [ ] BigQuery dataset created
- [ ] Secrets created (need manual configuration)

#### Step 2: Configure Secrets
```bash
# Set admin user
gcloud secrets versions add workspace-tools-secrets \
  --data-file=<(echo 'admin@yourdomain.com')

# Set primary domain
gcloud secrets versions add workspace-tools-secrets \
  --data-file=<(echo 'yourdomain.com')

# Upload service account key
gcloud secrets versions add gcp-service-account-key \
  --data-file=path/to/service-account-key.json
```
- [ ] Admin user secret configured
- [ ] Primary domain secret configured
- [ ] Service account key uploaded
- [ ] Redis host IP configured

#### Step 3: Build and Deploy
```bash
npm run deploy:build
./deploy.sh deploy-only
```
- [ ] Docker image built and pushed
- [ ] Cloud Run service deployed
- [ ] IAM permissions configured

#### Step 4: Verification
```bash
# Get service URL
gcloud run services describe workspace-tools --region=us-central1 --format='value(status.url)'

# Test health endpoint
curl https://your-service-url.run.app/health
```
- [ ] Service URL accessible
- [ ] Health check returns status: "healthy"
- [ ] Cache connections working (if enabled)

## 🧪 Post-Deployment Testing

### 1. Basic Functionality
```bash
# Test user listing
curl https://your-service-url.run.app/api/users

# Test file scan
curl -X POST https://your-service-url.run.app/api/scan/files \
  -H "Content-Type: application/json" \
  -d '{"fileRequests":[{"fileId":"your_file_id","userEmail":"user@domain.com"}]}'
```
- [ ] Users endpoint returns data
- [ ] File scan completes successfully
- [ ] Results include expected analysis data

### 2. Cache Performance (if enabled)
```bash
# Check cache stats
curl https://your-service-url.run.app/api/cache/stats

# Run same scan twice to test caching
curl -X POST https://your-service-url.run.app/api/scan/files \
  -H "Content-Type: application/json" \
  -d '{"fileRequests":[{"fileId":"same_file_id","userEmail":"user@domain.com"}]}'
```
- [ ] Cache health shows Redis/BigQuery connected
- [ ] Second scan shows `fromCache: true`
- [ ] Processing time significantly reduced on cached scan

### 3. Workspace Scan
```bash
# Start comprehensive scan
curl -X POST https://your-service-url.run.app/api/scan/workspace \
  -H "Content-Type: application/json" \
  -d '{"users":["test-user@domain.com"],"analysisTypes":["links","sharing"]}'

# Check job status (replace JOB_ID with actual job ID)
curl https://your-service-url.run.app/api/scan/status/JOB_ID
```
- [ ] Workspace scan starts successfully
- [ ] Job status updates properly
- [ ] Results accessible via API

## 📊 Monitoring Setup

### 1. Cloud Run Monitoring
- [ ] CPU and memory usage within limits
- [ ] Request latency acceptable
- [ ] Error rate minimal
- [ ] Auto-scaling working properly

### 2. BigQuery Monitoring
- [ ] Tables created in dataset
- [ ] Data being inserted properly
- [ ] Query costs reasonable
- [ ] Storage growth tracked

### 3. Redis Monitoring
- [ ] Memory usage tracked
- [ ] Connection count monitored
- [ ] Hit rate optimized
- [ ] Eviction policy configured

## 🔧 Configuration Tuning

### Performance Optimization
```bash
# Adjust batch size for your workspace
gcloud run services update workspace-tools \
  --set-env-vars BATCH_SIZE=25 \
  --region us-central1

# Tune cache TTL values
gcloud run services update workspace-tools \
  --set-env-vars METADATA_TTL=7200,ANALYSIS_TTL=14400 \
  --region us-central1
```
- [ ] Batch size optimized for your data volume
- [ ] TTL values tuned for your update frequency
- [ ] Memory allocation sufficient for batch size

### Scaling Configuration
```bash
# Set concurrency and scaling limits
gcloud run services update workspace-tools \
  --concurrency 10 \
  --min-instances 0 \
  --max-instances 10 \
  --region us-central1
```
- [ ] Concurrency set appropriately
- [ ] Minimum instances for performance
- [ ] Maximum instances for cost control

## 🚨 Troubleshooting

### Common Issues and Solutions

#### Authentication Errors
- [ ] Service account has domain-wide delegation
- [ ] All required scopes authorized in Admin Console
- [ ] Service account key properly uploaded to secrets

#### Cache Connection Issues
- [ ] Redis instance running and accessible
- [ ] BigQuery dataset exists with proper permissions
- [ ] Network connectivity between Cloud Run and services

#### API Rate Limits
- [ ] Batch size reduced if hitting limits
- [ ] Retry delays configured appropriately
- [ ] Caching enabled to reduce API calls

#### Memory/Performance Issues
- [ ] Cloud Run memory allocation increased
- [ ] Batch size reduced for large files
- [ ] Concurrent processing limits set

## ✅ Deployment Complete!

Once all items are checked:

1. **Document your deployment**:
   - Service URL
   - Configuration settings
   - Performance baselines

2. **Train your team**:
   - Share API documentation
   - Provide usage examples
   - Set up monitoring alerts

3. **Plan maintenance**:
   - Regular cache cleanup
   - Performance monitoring
   - Cost optimization reviews

Your Workspace Tools v2.0 is now deployed and ready for production use! 🎉
