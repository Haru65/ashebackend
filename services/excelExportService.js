const ExcelJS = require('exceljs');
const Telemetry = require('../models/telemetry');
const Device = require('../models/Device');

class ExcelExportService {
  /**
   * Export telemetry data to Excel
   * @param {Object} options - Export options
   * @param {String} options.deviceId - Device ID to export (optional, exports all if not provided)
   * @param {Date} options.startDate - Start date for data range
   * @param {Date} options.endDate - End date for data range
   * @param {String} options.filename - Custom filename (optional)
   */
  static async exportTelemetryToExcel(options = {}) {
    try {
      const {
        deviceId,
        startDate = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000), // Default: last 30 days
        endDate = new Date(),
        filename = `telemetry_export_${new Date().toISOString().split('T')[0]}.xlsx`
      } = options;

      // Build query
      const query = {
        timestamp: {
          $gte: startDate,
          $lte: endDate
        }
      };

      if (deviceId) {
        query.deviceId = deviceId;
      }

      console.log('📊 Exporting telemetry data with query:', JSON.stringify(query, null, 2));

      // Fetch telemetry data
      const telemetryData = await Telemetry.find(query)
        .sort({ timestamp: -1 })
        .lean();

      console.log(`📈 Found ${telemetryData.length} telemetry records`);
      console.log('📋 Date range:', {
        startDate: startDate.toISOString(),
        endDate: endDate.toISOString(),
        range: Math.round((endDate - startDate) / (1000 * 60 * 60 * 24)) + ' days'
      });

      // Log first few records for debugging
      if (telemetryData.length > 0) {
        console.log('📝 First record sample:', JSON.stringify(telemetryData[0], null, 2));
      }

      if (telemetryData.length === 0) {
        throw new Error('No telemetry data found for the specified criteria');
      }

      // Create workbook and worksheet
      const workbook = new ExcelJS.Workbook();
      workbook.creator = 'ZEPTAC IoT Platform';
      workbook.lastModifiedBy = 'System';
      workbook.created = new Date();
      workbook.modified = new Date();

      console.log('✅ Workbook created successfully');

      // Create main telemetry worksheet
      const worksheet = workbook.addWorksheet('Telemetry Data', {
        pageSetup: { paperSize: 9, orientation: 'landscape' }
      });

      console.log('✅ Worksheet added to workbook');

      // Get all unique data keys for dynamic columns
      // These now come from flattened top-level fields (ref1, ref2, aci, acv, etc.)
      const allDataKeys = new Set();
      const fixedFields = ['deviceId', 'timestamp', 'event', 'status', 'location', 'name', 'type', 'lastSeen', '_id'];
      
      // Fields to exclude from report generation
      const excludedFields = new Set([
        // Depolarization fields
        'DEPOLARIZATION START TIMESTAMP',
        'DEPOLARIZATION STOP TIMESTAMP',
        'DEPOLARIZATION INTERVAL',
        'DEPOLARIZATIONSTARTTIMESTAMP',
        'DEPOLARIZATIONSTOPTIMESTAMP',
        'DPOLINTERVAL',
        // Instant fields
        'INSTANT END TIMESTAMP',
        'INSTANT MODE',
        'INSTANT START TIMESTAMP',
        'INSTANTENDTIMESTAMP',
        'INSTANTMODE',
        'INSTANTSTARTTIMESTAMP',
        // Interrupt fields
        'INTERRUPT OFF TIME',
        'INTERRUPT ON TIME',
        'INTERRUPT START TIMESTAMP',
        'INTERRUPT STOP TIMESTAMP',
        'INTERRUPTOFFTIME',
        'INTERRUPTONTIME',
        'INTERRUPTSTARTTIMESTAMP',
        'INTERRUPTSTOPTIMESTAMP',
        // Location fields
        'LATITUDE',
        'LONGITUDE',
        'LOG',
        // Mode and action fields
        'MANUAL MODE ACTION',
        'MANUALMODEACTION',
        // Calibration fields - ALL TO BE REMOVED
        'REFFCAL CALIBRATION',
        'REFFCAL ENABLED',
        'REFFCAL VALUE',
        'REF FCAL',
        'REF OP',
        'REF UP',
        // Reference fields - ALL TO BE REMOVED
        'REFERENCE FAIL',
        'REFERENCE OP',
        'REFERENCE UP',
        'REFERENCEOV',
        'REFERENCEFAIL',
        'REFERENCEUP',
        // Setup fields - ALL TO BE REMOVED
        'SETOP ENABLED',
        'SETOP VALUE',
        'SETUP ENABLED',
        'SETUP VALUE',
        // Shunt fields - ALL TO BE REMOVED
        'SHUNT CURRENT',
        'SHUNT VOLTAGE',
        'SHUNTCURRENT',
        'SHUNTVOLTAGE',
        // Other redundant fields
        'SN',
        'SENDER',
        'V',
        'DATA',
        'ELECTRODE',
        'LOGGINGINTERVAL',
        'LOGGINGINTERVALFORMATTED',
        'LOGGING INTERVAL',
        'DI1',
        'DI2',
        'DI3',
        'DI4'
      ]);
      
      telemetryData.forEach(record => {
        Object.keys(record).forEach(key => {
          // Include all fields except the fixed metadata ones and excluded fields
          if (!fixedFields.includes(key) && !excludedFields.has(key.toUpperCase())) {
            allDataKeys.add(key);
          }
        });
      });

      // Also check if data still exists as a Map/Object (for backward compatibility)
      telemetryData.forEach(record => {
        if (record.data && typeof record.data === 'object') {
          if (record.data instanceof Map) {
            // Handle Map data type
            record.data.forEach((value, key) => {
              if (!allDataKeys.has(key) && !excludedFields.has(key.toUpperCase())) {
                allDataKeys.add(key);
              }
            });
          } else {
            // Handle regular object
            Object.keys(record.data).forEach(key => {
              if (!allDataKeys.has(key) && !excludedFields.has(key.toUpperCase())) {
                allDataKeys.add(key);
              }
            });
          }
        }
      });

      // Define columns
      const baseColumns = [
        { header: 'Device ID', key: 'deviceId', width: 15 },
        { header: 'Timestamp', key: 'timestamp', width: 20 },
        { header: 'Event', key: 'event', width: 15 },
        { header: 'Status', key: 'status', width: 12 },
        { header: 'Location', key: 'location', width: 15 }
      ];

      // Add dynamic data columns (sorted for consistency)
      const dataColumns = Array.from(allDataKeys).sort().map(key => ({
        header: key.toUpperCase().replace(/_/g, ' '),
        key: key,
        width: 15
      }));

      worksheet.columns = [...baseColumns, ...dataColumns];

      console.log(`📋 Columns configured: ${baseColumns.length + dataColumns.length} total (${baseColumns.length} base + ${dataColumns.length} data)`);
      console.log('📋 Dynamic data fields:', Array.from(allDataKeys).sort());

      // Style the header row
      worksheet.getRow(1).font = { bold: true, color: { argb: 'FFFFFF' } };
      worksheet.getRow(1).fill = {
        type: 'pattern',
        pattern: 'solid',
        fgColor: { argb: '366092' }
      };

      // Add data rows
      try {
        telemetryData.forEach((record, index) => {
          const row = {
            deviceId: record.deviceId,
            timestamp: record.timestamp instanceof Date ? record.timestamp.toISOString() : record.timestamp,
            event: record.event || 'NORMAL',
            status: record.status || 'online',
            location: record.location || 'N/A'
          };

          // Extract all dynamic fields directly from the flattened record
          Array.from(allDataKeys).forEach(key => {
            let value = undefined;
            
            // First check if field exists directly in record
            if (record[key] !== undefined) {
              value = record[key];
            }
            // Fall back to checking data object (backward compatibility)
            else if (record.data) {
              const dataObj = record.data instanceof Map ? 
                Object.fromEntries(record.data) : record.data;
              
              value = dataObj[key];
            }

            // Ensure the value is serializable
            if (value !== undefined && value !== null) {
              if (value instanceof Date) {
                row[key] = value.toISOString();
              } else if (typeof value === 'object') {
                row[key] = JSON.stringify(value);
              } else {
                row[key] = value;
              }
            } else {
              row[key] = value; // Keep null/undefined as is
            }
          });

          worksheet.addRow(row);

          // Add conditional formatting for alternate rows
          if (index % 2 === 1) {
            const rowNum = index + 2; // +2 because Excel is 1-indexed and we have header
            worksheet.getRow(rowNum).fill = {
              type: 'pattern',
              pattern: 'solid',
              fgColor: { argb: 'F8F9FA' }
            };
          }

          // Log progress every 500 rows
          if ((index + 1) % 500 === 0) {
            console.log(`   Added ${index + 1} rows to worksheet...`);
          }
        });
        console.log(`✅ All ${telemetryData.length} data rows added successfully`);
      } catch (rowError) {
        console.error('❌ Error adding rows to worksheet:', rowError.message);
        console.error('❌ Row error:', rowError);
        throw rowError;
      }

      // Auto-fit columns
      worksheet.columns.forEach(column => {
        if (column.header === 'Timestamp') {
          column.numFmt = 'yyyy-mm-dd hh:mm:ss';
        }
      });

      // Add summary worksheet
      const summarySheet = workbook.addWorksheet('Summary');
      
      // Summary data
      const deviceCounts = {};
      telemetryData.forEach(record => {
        deviceCounts[record.deviceId] = (deviceCounts[record.deviceId] || 0) + 1;
      });

      summarySheet.columns = [
        { header: 'Metric', key: 'metric', width: 25 },
        { header: 'Value', key: 'value', width: 20 }
      ];

      summarySheet.getRow(1).font = { bold: true };

      summarySheet.addRows([
        { metric: 'Export Date', value: new Date().toISOString() },
        { metric: 'Date Range', value: `${startDate.toISOString().split('T')[0]} to ${endDate.toISOString().split('T')[0]}` },
        { metric: 'Total Records', value: telemetryData.length },
        { metric: 'Unique Devices', value: Object.keys(deviceCounts).length },
        { metric: 'Data Fields', value: allDataKeys.size }
      ]);

      // Add device breakdown
      summarySheet.addRow({ metric: '', value: '' }); // Empty row
      summarySheet.addRow({ metric: 'Records per Device:', value: '' });
      
      Object.entries(deviceCounts).forEach(([deviceId, count]) => {
        summarySheet.addRow({ metric: `  ${deviceId}`, value: count });
      });

      return {
        workbook,
        filename,
        recordCount: telemetryData.length,
        devices: Object.keys(deviceCounts).length
      };

    } catch (error) {
      console.error('❌ Excel export error:', error);
      throw error;
    }
  }

  /**
   * Save Excel workbook to file
   */
  static async saveExcelFile(workbook, filename, outputPath = './exports') {
    try {
      const fs = require('fs');
      const path = require('path');

      // Ensure exports directory exists
      if (!fs.existsSync(outputPath)) {
        fs.mkdirSync(outputPath, { recursive: true });
      }

      const fullPath = path.join(outputPath, filename);
      await workbook.xlsx.writeFile(fullPath);
      
      console.log(`✅ Excel file saved: ${fullPath}`);
      return fullPath;
    } catch (error) {
      console.error('❌ Error saving Excel file:', error);
      throw error;
    }
  }

  /**
   * Generate Excel buffer for download
   */
  static async getExcelBuffer(workbook) {
    try {
      console.log('📝 Starting Excel buffer generation...');
      console.log('📊 Workbook info:', {
        worksheetCount: workbook.worksheets.length,
        worksheets: workbook.worksheets.map(ws => ({
          name: ws.name,
          rowCount: ws.actualRowCount,
          columnCount: ws.actualColumnCount
        }))
      });

      // Clear any potential circular references in the workbook
      workbook.worksheets.forEach(worksheet => {
        worksheet.eachRow({ includeEmpty: false }, (row) => {
          row.eachCell((cell) => {
            // Ensure cell values are serializable
            if (cell.value && typeof cell.value === 'object') {
              if (!(cell.value instanceof Date)) {
                console.warn(`⚠️ Non-Date object in cell ${cell.address}:`, typeof cell.value);
                cell.value = String(cell.value);
              }
            }
          });
        });
      });

      console.log('✅ Workbook sanitized');

      const buffer = await workbook.xlsx.writeBuffer();
      
      console.log(`✅ Excel buffer generated: ${buffer.length} bytes`);
      return buffer;
    } catch (error) {
      console.error('❌ Error generating Excel buffer:', error.message);
      console.error('❌ Buffer error name:', error.name);
      console.error('❌ Buffer error code:', error.code);
      console.error('❌ Buffer error stack:', error.stack);
      
      // Try alternative approach if primary fails
      try {
        console.log('🔄 Attempting alternative buffer generation...');
        return await workbook.xlsx.writeBuffer();
      } catch (retryError) {
        console.error('❌ Retry failed:', retryError.message);
        throw error;
      }
    }
  }
}

module.exports = ExcelExportService;