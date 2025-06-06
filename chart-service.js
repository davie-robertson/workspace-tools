/**
 * Chart Service Module
 * Handles chart creation and management
 */

import { SheetManager } from './sheet-manager.js';

/**
 * Service for creating and managing charts
 */
export class ChartService {
  constructor(sheets, spreadsheetId) {
    this.sheetManager = new SheetManager(sheets, spreadsheetId);
  }

  /**
   * Create an issue chart based on Issues tab data
   * @param {string} issuesSheetName - Name of the Issues sheet
   * @param {string} chartSheetName - Name of the Chart sheet
   */
  async createIssueChart(issuesSheetName = 'Issues', chartSheetName = 'Issue Chart') {
    try {
      // Get Issues sheet ID and data count
      const issuesData = await this.sheetManager.readData(issuesSheetName, 'A:A');
      const issuesDataRowCount = issuesData.length;
      
      if (issuesDataRowCount <= 1) {
        return;
      }

      // Create or get chart sheet
      const chartSheetId = await this.sheetManager.getOrCreateSheet(chartSheetName, false);
      
      // Delete existing charts to prevent duplicates
      await this.sheetManager.deleteCharts(chartSheetId);

      // Create aggregated data from Issues tab
      const aggregatedData = await this.createAggregatedIssueData(issuesSheetName, issuesDataRowCount);
      
      // Write aggregated data to chart sheet
      await this.sheetManager.writeData(chartSheetName, 'A1', aggregatedData);
      
      // Calculate the number of data rows (excluding header) for logging
      const numDataRows = aggregatedData.length > 0 ? aggregatedData.length - 1 : 0;
      
      // For buildIssueChartSpec, pass the total number of rows in aggregatedData
      // as its 'dataRowCount' parameter (which is used for endRowIndex exclusive)
      const chartSpec = this.buildIssueChartSpec(chartSheetId, aggregatedData.length);
      const chartPosition = this.buildChartPosition(chartSheetId);
      
      await this.sheetManager.createChart(chartSheetId, chartSpec, chartPosition);
      
    } catch (error) {
      console.error(`Failed to create issue chart: ${error.message}`);
    }
  }

  /**
   * Create aggregated issue data for charting
   * @private
   */
  async createAggregatedIssueData(issuesSheetName, issuesDataRowCount) {
    // Read raw issues data (skip header)
    const range = `A2:A${issuesDataRowCount}`;
    const issueData = await this.sheetManager.readData(issuesSheetName, range);
    
    // Count occurrences of each issue type
    const issueCounts = {};
    issueData.forEach(row => {
      if (row && row[0]) {
        const issueType = row[0];
        issueCounts[issueType] = (issueCounts[issueType] || 0) + 1;
      }
    });
    
    // Create aggregated data table
    const aggregatedData = [
      ['Issue Type', 'Count'],
      ...Object.entries(issueCounts).map(([type, count]) => [type, count])
    ];
    
    return aggregatedData;
  }

  /**
   * Build chart specification for issue chart
   * @private
   */
  buildIssueChartSpec(chartSheetId, dataRowCount) {
    return {
      title: 'Issues Found by Type',
      basicChart: {
        chartType: 'COLUMN',
        legendPosition: 'BOTTOM_LEGEND',
        stackedType: 'NOT_STACKED',
        axis: [
          {
            position: 'BOTTOM_AXIS',
            title: 'Issue Type'
          },
          {
            position: 'LEFT_AXIS', 
            title: 'Count'
          }
        ],
        domains: [{
          domain: {
            sourceRange: {
              sources: [{
                sheetId: chartSheetId,
                startRowIndex: 0, // Corrected: Start from actual data, not header
                endRowIndex: dataRowCount, // Corrected: endRowIndex is exclusive
                startColumnIndex: 0, // Column A (Issue Type)
                endColumnIndex: 1
              }]
            }
          },
          reversed: false
        }],
        series: [{
          series: {
            sourceRange: {
              sources: [{
                sheetId: chartSheetId,
                startRowIndex: 0, // Corrected: Start from actual data, not header
                endRowIndex: dataRowCount, // Corrected: endRowIndex is exclusive
                startColumnIndex: 1, // Column B (Count)
                endColumnIndex: 2
              }]
            }
          },
          type: 'COLUMN',
          targetAxis: 'LEFT_AXIS'
        }],
        headerCount: 1 // Specifies that the first row is a header
      }
    };
  }

  /**
   * Build chart position specification
   * @private
   */
  buildChartPosition(chartSheetId) {
    return {
      overlayPosition: {
        anchorCell: {
          sheetId: chartSheetId,
          rowIndex: 2,
          columnIndex: 1
        },
        widthPixels: 600,
        heightPixels: 400
      }
    };
  }
}

/**
 * Factory function to create chart service instances
 */
export function createChartService(sheets, spreadsheetId) {
  return new ChartService(sheets, spreadsheetId);
}
