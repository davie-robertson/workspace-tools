/**
 * Sheet Manager Module
 * Handles common Google Sheets operations to reduce duplication
 */

import { apiClient } from "./api-client.js";

/**
 * Generic sheet manager class following SOLID principles
 */
export class SheetManager {
  constructor(sheets, spreadsheetId) {
    this.sheets = sheets;
    this.spreadsheetId = spreadsheetId;
    this.apiClient = apiClient;
  }

  /**
   * Get or create a sheet with the given name
   * @param {string} sheetName - Name of the sheet
   * @param {boolean} clearContent - Whether to clear existing content
   * @returns {Promise<number>} Sheet ID
   */
  async getOrCreateSheet(sheetName, clearContent = true) {
    try {
      const sp = await this.apiClient.callWithRetry(() => this.sheets.spreadsheets.get({
        spreadsheetId: this.spreadsheetId,
        fields: 'sheets.properties',
      }));

      // Check if sheet exists
      const existingSheet = sp.data.sheets.find(s => s.properties.title === sheetName);
      
      if (existingSheet) {
        const sheetId = existingSheet.properties.sheetId;
        
        if (clearContent) {
          await this.clearSheet(sheetName);
          console.log(`Cleared existing sheet: ${sheetName}`);
        } else {
          console.log(`Using existing sheet: ${sheetName}`);
        }
        
        return sheetId;
      } else {
        // Create new sheet
        const response = await this.apiClient.callWithRetry(() => this.sheets.spreadsheets.batchUpdate({
          spreadsheetId: this.spreadsheetId,
          resource: {
            requests: [{
              addSheet: {
                properties: { title: sheetName }
              }
            }]
          }
        }));
        
        const sheetId = response.data.replies[0].addSheet.properties.sheetId;
        console.log(`Created new sheet: ${sheetName}`);
        return sheetId;
      }
    } catch (error) {
      throw new Error(`Failed to manage sheet ${sheetName}: ${error.message}`);
    }
  }

  /**
   * Clear all content from a sheet
   * @param {string} sheetName - Name of the sheet to clear
   */
  async clearSheet(sheetName) {
    await this.apiClient.callWithRetry(() => this.sheets.spreadsheets.values.clear({
      spreadsheetId: this.spreadsheetId,
      range: `${sheetName}!A:Z`
    }));
  }

  /**
   * Write data to a sheet
   * @param {string} sheetName - Name of the sheet
   * @param {string} range - Range to write to (e.g., 'A1')
   * @param {Array<Array>} data - 2D array of data
   */
  async writeData(sheetName, range, data) {
    const result = await this.apiClient.callWithRetry(() => this.sheets.spreadsheets.values.update({
      spreadsheetId: this.spreadsheetId,
      range: `${sheetName}!${range}`,
      valueInputOption: 'RAW',
      resource: { values: data }
    }));
    return result;
  }

  /**
   * Read data from a sheet
   * @param {string} sheetName - Name of the sheet
   * @param {string} range - Range to read from (e.g., 'A:B')
   */
  async readData(sheetName, range) {
    const response = await this.apiClient.callWithRetry(() => this.sheets.spreadsheets.values.get({
      spreadsheetId: this.spreadsheetId,
      range: `${sheetName}!${range}`,
    }));
    return response.data.values || [];
  }

  /**
   * Delete all charts from a sheet
   * @param {number} sheetId - ID of the sheet
   */
  async deleteCharts(sheetId) {
    try {
      const sheetWithCharts = await this.apiClient.callWithRetry(() => this.sheets.spreadsheets.get({
        spreadsheetId: this.spreadsheetId,
        fields: 'sheets(properties.sheetId,charts.chartId)',
      }));
      
      const chartSheet = sheetWithCharts.data.sheets.find(s => s.properties && s.properties.sheetId === sheetId);
      if (chartSheet && chartSheet.charts && chartSheet.charts.length > 0) {
        const deleteRequests = chartSheet.charts.map(chart => ({
          deleteEmbeddedObject: {
            objectId: chart.chartId
          }
        }));
        
        await this.apiClient.callWithRetry(() => this.sheets.spreadsheets.batchUpdate({
          spreadsheetId: this.spreadsheetId,
          resource: { requests: deleteRequests }
        }));
        
        console.log(`Deleted ${chartSheet.charts.length} existing chart(s) to prevent duplicates`);
      }
    } catch (e) {
      console.warn('Error deleting existing charts:', e.message);
    }
  }

  /**
   * Create a chart on a sheet
   * @param {number} sheetId - ID of the sheet to place the chart on
   * @param {Object} chartSpec - Chart specification
   * @param {Object} position - Chart position
   */
  async createChart(sheetId, chartSpec, position) {
    await this.apiClient.callWithRetry(() => this.sheets.spreadsheets.batchUpdate({
      spreadsheetId: this.spreadsheetId,
      resource: {
        requests: [{
          addChart: {
            chart: {
              spec: chartSpec,
              position: position
            }
          }
        }]
      }
    }));
  }
}

/**
 * Factory function to create sheet manager instances
 */
export function createSheetManager(sheets, spreadsheetId) {
  return new SheetManager(sheets, spreadsheetId);
}
