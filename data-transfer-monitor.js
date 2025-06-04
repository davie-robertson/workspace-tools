/**
 * Data Transfer Monitor
 * Tracks API usage and estimated data transfer for Google Workspace scanning
 */

export class DataTransferMonitor {
  constructor() {
    this.reset();
  }

  reset() {
    this.stats = {
      apiCalls: {
        drive: 0,
        gmail: 0,
        admin: 0,
        sheets: 0
      },
      dataTransfer: {
        requests: 0, // Total bytes sent in requests
        responses: 0, // Total bytes received in responses
        total: 0 // Total bytes transferred
      },
      operations: {
        fileMetadata: 0,
        fileContent: 0,
        userList: 0,
        quotaCheck: 0,
        gmailProfile: 0,
        sheetWrite: 0
      },
      startTime: new Date(),
      endTime: null
    };
  }

  // Track an API call with request and response size estimation
  trackApiCall(service, operation, requestSize = 0, responseSize = 0) {
    if (this.stats.apiCalls.hasOwnProperty(service)) {
      this.stats.apiCalls[service]++;
    }
    
    if (this.stats.operations.hasOwnProperty(operation)) {
      this.stats.operations[operation]++;
    }

    this.stats.dataTransfer.requests += requestSize;
    this.stats.dataTransfer.responses += responseSize;
    this.stats.dataTransfer.total += requestSize + responseSize;
  }

  // Estimate request size based on parameters
  estimateRequestSize(url, params = {}) {
    let size = url.length;
    
    // Add parameter sizes
    for (const [key, value] of Object.entries(params)) {
      if (value !== null && value !== undefined) {
        size += key.length + String(value).length + 2; // +2 for = and &
      }
    }
    
    // Add base HTTP headers estimate (typical headers are ~200-500 bytes)
    size += 300;
    
    return size;
  }

  // Estimate response size based on content
  estimateResponseSize(data) {
    if (!data) return 0;
    
    try {
      // For JSON responses, estimate size
      if (typeof data === 'object') {
        return JSON.stringify(data).length;
      }
      return String(data).length;
    } catch (error) {
      // Fallback estimation
      return 1024; // 1KB default estimate
    }
  }

  // Track file metadata retrieval
  trackFileMetadata(fileId, responseData) {
    const requestSize = this.estimateRequestSize(
      `https://www.googleapis.com/drive/v3/files/${fileId}`,
      { fields: 'id,name,mimeType,size,createdTime,modifiedTime,owners' }
    );
    const responseSize = this.estimateResponseSize(responseData);
    
    this.trackApiCall('drive', 'fileMetadata', requestSize, responseSize);
  }

  // Track file content download
  trackFileContent(fileId, responseData) {
    const requestSize = this.estimateRequestSize(
      `https://www.googleapis.com/drive/v3/files/${fileId}/export`
    );
    const responseSize = this.estimateResponseSize(responseData);
    
    this.trackApiCall('drive', 'fileContent', requestSize, responseSize);
  }

  // Track user list retrieval
  trackUserList(responseData) {
    const requestSize = this.estimateRequestSize(
      'https://admin.googleapis.com/admin/directory/v1/users',
      { domain: 'domain.com', maxResults: 500 }
    );
    const responseSize = this.estimateResponseSize(responseData);
    
    this.trackApiCall('admin', 'userList', requestSize, responseSize);
  }

  // Track quota information retrieval
  trackQuotaCheck(userEmail, driveResponse, gmailResponse = null) {
    // Track Drive quota API call
    const driveRequestSize = this.estimateRequestSize(
      'https://www.googleapis.com/drive/v3/about',
      { fields: 'storageQuota' }
    );
    const driveResponseSize = this.estimateResponseSize(driveResponse);
    this.trackApiCall('drive', 'quotaCheck', driveRequestSize, driveResponseSize);

    // Track Gmail profile API call if available
    if (gmailResponse) {
      const gmailRequestSize = this.estimateRequestSize(
        'https://gmail.googleapis.com/gmail/v1/users/me/profile'
      );
      const gmailResponseSize = this.estimateResponseSize(gmailResponse);
      this.trackApiCall('gmail', 'gmailProfile', gmailRequestSize, gmailResponseSize);
    }
  }

  // Track Google Sheets write operations
  trackSheetWrite(range, data) {
    const requestSize = this.estimateRequestSize(
      'https://sheets.googleapis.com/v4/spreadsheets/ID/values/range',
      { range, valueInputOption: 'RAW' }
    ) + this.estimateResponseSize(data);
    
    this.trackApiCall('sheets', 'sheetWrite', requestSize, 100); // Small response for write operations
  }

  // Convert bytes to human-readable format
  formatBytes(bytes) {
    if (bytes === 0) return '0 Bytes';
    
    const k = 1024;
    const sizes = ['Bytes', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    
    return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
  }

  // Get current statistics
  getStats() {
    this.stats.endTime = new Date();
    const duration = this.stats.endTime - this.stats.startTime;
    
    return {
      ...this.stats,
      duration: {
        milliseconds: duration,
        seconds: Math.round(duration / 1000),
        formatted: this.formatDuration(duration)
      },
      summary: this.getSummary()
    };
  }

  // Format duration in human-readable format
  formatDuration(ms) {
    const seconds = Math.floor(ms / 1000);
    const minutes = Math.floor(seconds / 60);
    const hours = Math.floor(minutes / 60);

    if (hours > 0) {
      return `${hours}h ${minutes % 60}m ${seconds % 60}s`;
    } else if (minutes > 0) {
      return `${minutes}m ${seconds % 60}s`;
    } else {
      return `${seconds}s`;
    }
  }

  // Get summary report
  getSummary() {
    const totalApiCalls = Object.values(this.stats.apiCalls).reduce((a, b) => a + b, 0);
    const totalOperations = Object.values(this.stats.operations).reduce((a, b) => a + b, 0);

    return {
      totalApiCalls,
      totalOperations,
      totalDataTransfer: this.formatBytes(this.stats.dataTransfer.total),
      requestData: this.formatBytes(this.stats.dataTransfer.requests),
      responseData: this.formatBytes(this.stats.dataTransfer.responses),
      averageResponseSize: totalApiCalls > 0 
        ? this.formatBytes(this.stats.dataTransfer.responses / totalApiCalls)
        : '0 Bytes',
      topServices: this.getTopServices(),
      topOperations: this.getTopOperations()
    };
  }

  // Get services sorted by usage
  getTopServices() {
    return Object.entries(this.stats.apiCalls)
      .sort(([,a], [,b]) => b - a)
      .filter(([,count]) => count > 0);
  }

  // Get operations sorted by usage
  getTopOperations() {
    return Object.entries(this.stats.operations)
      .sort(([,a], [,b]) => b - a)
      .filter(([,count]) => count > 0);
  }

  // Print detailed report
  printReport() {
    const stats = this.getStats();
    
    console.log('\n' + '='.repeat(60));
    console.log('DATA TRANSFER REPORT');
    console.log('='.repeat(60));
    
    console.log(`\nScan Duration: ${stats.duration.formatted}`);
    console.log(`Total API Calls: ${stats.summary.totalApiCalls}`);
    console.log(`Total Data Transfer: ${stats.summary.totalDataTransfer}`);
    console.log(`  ↑ Requests Sent: ${stats.summary.requestData}`);
    console.log(`  ↓ Responses Received: ${stats.summary.responseData}`);
    console.log(`Average Response Size: ${stats.summary.averageResponseSize}`);
    
    console.log('\nAPI Calls by Service:');
    stats.summary.topServices.forEach(([service, count]) => {
      console.log(`  ${service.toUpperCase()}: ${count} calls`);
    });
    
    console.log('\nOperations Breakdown:');
    stats.summary.topOperations.forEach(([operation, count]) => {
      console.log(`  ${operation}: ${count}`);
    });
    
    console.log('\n' + '='.repeat(60));
  }

  // Export stats to JSON
  exportStats() {
    return JSON.stringify(this.getStats(), null, 2);
  }
}

// Create global instance
export const dataTransferMonitor = new DataTransferMonitor();
