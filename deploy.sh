#!/bin/bash

# Cloud Run Deployment Script
# This script builds and deploys the workspace tools application to Google Cloud Run

set -e  # Exit on any error

# Configuration
PROJECT_ID=${GOOGLE_CLOUD_PROJECT:-"your-project-id"}
REGION=${CLOUD_RUN_REGION:-"us-central1"}
SERVICE_NAME="workspace-tools"
IMAGE_NAME="gcr.io/${PROJECT_ID}/${SERVICE_NAME}"

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

echo -e "${GREEN}Starting deployment of Workspace Tools to Cloud Run...${NC}"

# Check if required tools are installed
check_tools() {
    echo "Checking required tools..."
    
    if ! command -v gcloud &> /dev/null; then
        echo -e "${RED}Error: gcloud CLI is not installed${NC}"
        exit 1
    fi
    
    if ! command -v docker &> /dev/null; then
        echo -e "${RED}Error: Docker is not installed${NC}"
        exit 1
    fi
    
    echo -e "${GREEN}✓ All required tools are available${NC}"
}

# Set up Google Cloud project
setup_project() {
    echo "Setting up Google Cloud project..."
    
    # Set the project
    gcloud config set project ${PROJECT_ID}
    
    # Enable required APIs
    echo "Enabling required APIs..."
    gcloud services enable \
        run.googleapis.com \
        cloudbuild.googleapis.com \
        artifactregistry.googleapis.com \
        redis.googleapis.com \
        bigquery.googleapis.com \
        admin.googleapis.com \
        drive.googleapis.com \
        docs.googleapis.com \
        slides.googleapis.com \
        sheets.googleapis.com \
        calendar.googleapis.com
    
    echo -e "${GREEN}✓ Project setup complete${NC}"
}

# Create necessary secrets
setup_secrets() {
    echo "Setting up secrets..."
    
    # Check if secrets exist, create them if they don't
    if ! gcloud secrets describe workspace-tools-secrets &> /dev/null; then
        echo "Creating workspace-tools-secrets..."
        gcloud secrets create workspace-tools-secrets
        
        echo -e "${YELLOW}Please set the following secret values:${NC}"
        echo "gcloud secrets versions add workspace-tools-secrets --data-file=<(echo 'admin-user@yourdomain.com') --secret-id=admin-user"
        echo "gcloud secrets versions add workspace-tools-secrets --data-file=<(echo 'yourdomain.com') --secret-id=primary-domain"
        echo "gcloud secrets versions add workspace-tools-secrets --data-file=<(echo 'redis-host-ip') --secret-id=redis-host"
    fi
    
    if ! gcloud secrets describe gcp-service-account-key &> /dev/null; then
        echo "Creating gcp-service-account-key secret..."
        gcloud secrets create gcp-service-account-key
        
        echo -e "${YELLOW}Please upload your service account key:${NC}"
        echo "gcloud secrets versions add gcp-service-account-key --data-file=path/to/your/service-account-key.json"
    fi
    
    echo -e "${GREEN}✓ Secrets setup complete${NC}"
}

# Set up Redis instance (Cloud Memorystore)
setup_redis() {
    echo "Setting up Redis instance..."
    
    REDIS_INSTANCE_NAME="workspace-cache"
    
    # Check if Redis instance exists
    if ! gcloud redis instances describe ${REDIS_INSTANCE_NAME} --region=${REGION} &> /dev/null; then
        echo "Creating Redis instance..."
        gcloud redis instances create ${REDIS_INSTANCE_NAME} \
            --size=1 \
            --region=${REGION} \
            --redis-version=redis_6_x \
            --tier=basic
        
        echo -e "${YELLOW}Waiting for Redis instance to be ready...${NC}"
        gcloud redis instances describe ${REDIS_INSTANCE_NAME} --region=${REGION}
    else
        echo -e "${GREEN}✓ Redis instance already exists${NC}"
    fi
}

# Set up BigQuery dataset
setup_bigquery() {
    echo "Setting up BigQuery dataset..."
    
    DATASET_NAME="workspace_cache"
    
    # Check if dataset exists
    if ! bq show --dataset ${PROJECT_ID}:${DATASET_NAME} &> /dev/null; then
        echo "Creating BigQuery dataset..."
        bq mk --dataset \
            --description="Workspace tools cache dataset" \
            --location=US \
            ${PROJECT_ID}:${DATASET_NAME}
    else
        echo -e "${GREEN}✓ BigQuery dataset already exists${NC}"
    fi
}

# Build and push Docker image
build_and_push() {
    echo "Building and pushing Docker image..."
    
    # Configure Docker to use gcloud as a credential helper
    gcloud auth configure-docker
    
    # Build the image
    echo "Building Docker image..."
    docker build -t ${IMAGE_NAME}:latest .
    
    # Push the image
    echo "Pushing Docker image..."
    docker push ${IMAGE_NAME}:latest
    
    echo -e "${GREEN}✓ Docker image built and pushed${NC}"
}

# Deploy to Cloud Run
deploy_service() {
    echo "Deploying to Cloud Run..."
    
    # Update the service YAML with the correct project ID
    sed "s/PROJECT_ID/${PROJECT_ID}/g" cloud-run-service.yaml > cloud-run-service-deployed.yaml
    
    # Deploy the service
    gcloud run services replace cloud-run-service-deployed.yaml \
        --region=${REGION}
    
    # Get the service URL
    SERVICE_URL=$(gcloud run services describe ${SERVICE_NAME} \
        --region=${REGION} \
        --format='value(status.url)')
    
    echo -e "${GREEN}✓ Deployment complete!${NC}"
    echo -e "${GREEN}Service URL: ${SERVICE_URL}${NC}"
    
    # Clean up temporary file
    rm -f cloud-run-service-deployed.yaml
}

# Set up IAM permissions
setup_iam() {
    echo "Setting up IAM permissions..."
    
    # Get the Cloud Run service account
    SERVICE_ACCOUNT=$(gcloud run services describe ${SERVICE_NAME} \
        --region=${REGION} \
        --format='value(spec.template.spec.serviceAccountName)' || echo "")
    
    if [ -z "$SERVICE_ACCOUNT" ]; then
        SERVICE_ACCOUNT="${PROJECT_ID}@appspot.gserviceaccount.com"
    fi
    
    # Grant necessary permissions
    gcloud projects add-iam-policy-binding ${PROJECT_ID} \
        --member="serviceAccount:${SERVICE_ACCOUNT}" \
        --role="roles/bigquery.dataEditor"
    
    gcloud projects add-iam-policy-binding ${PROJECT_ID} \
        --member="serviceAccount:${SERVICE_ACCOUNT}" \
        --role="roles/redis.editor"
    
    echo -e "${GREEN}✓ IAM permissions configured${NC}"
}

# Main deployment function
main() {
    echo -e "${GREEN}=== Workspace Tools Cloud Run Deployment ===${NC}"
    
    check_tools
    setup_project
    setup_secrets
    setup_redis
    setup_bigquery
    build_and_push
    deploy_service
    setup_iam
    
    echo -e "${GREEN}"
    echo "=================================="
    echo "🎉 Deployment completed successfully!"
    echo "=================================="
    echo -e "${NC}"
    echo "Next steps:"
    echo "1. Configure your secrets with actual values"
    echo "2. Upload your service account key"
    echo "3. Test the deployment at the service URL"
    echo ""
    echo "Health check: ${SERVICE_URL}/health"
    echo "API documentation: Check the cloud-run-server.js file for available endpoints"
}

# Handle command line arguments
case "${1:-deploy}" in
    "setup-only")
        check_tools
        setup_project
        setup_secrets
        setup_redis
        setup_bigquery
        ;;
    "build-only")
        check_tools
        build_and_push
        ;;
    "deploy-only")
        check_tools
        deploy_service
        setup_iam
        ;;
    "deploy"|"")
        main
        ;;
    *)
        echo "Usage: $0 [setup-only|build-only|deploy-only|deploy]"
        exit 1
        ;;
esac
