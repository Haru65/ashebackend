const ExcelJS = require('exceljs');
const Telemetry = require('../models/telemetry');
const Device = require('../models/Device');

class ExcelExportService {
  /**
   * Export telemetry data to Excel - Matches report page UI exactly
   * Main telemetry sheet + separate sheets for each event type
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
        filename = `telemetry_export_${new Date().toISOString().split('T')[0]}.xlsx`,
        maxRecords = 5000 // Reduced to 5000 to prevent OOM issues on Render's limited memory
      } = options;

      // Build query with proper date handling
      const query = {
        timestamp: {
          $gte: startDate,
          $lte: endDate
        }
      };

      if (deviceId) {
        query.deviceId = deviceId;
      }

      console.log('📊 Exporting telemetry data with query:', {
        dateRange: {
          start: startDate instanceof Date ? startDate.toISOString() : startDate,
          end: endDate instanceof Date ? endDate.toISOString() : endDate,
          startType: typeof startDate,
          endType: typeof endDate
        },
        deviceId: deviceId || 'all devices',
        operator: '$gte and $lte (inclusive range)'
      });

      // Count total records first
      const totalCount = await Telemetry.countDocuments(query);
      console.log(`📈 Found ${totalCount} total telemetry records`);

      if (totalCount === 0) {
        throw new Error('No telemetry data found for the specified criteria');
      }

      // Warn if exceeding max records
      if (totalCount > maxRecords) {
        console.warn(`⚠️ WARNING: ${totalCount} records found, limiting to ${maxRecords} most recent records to prevent memory issues`);
      }

      // Fetch telemetry data with limit
      // Sort by ascending timestamp to get records from START of range (oldest first)
      // This ensures we get a proper date distribution instead of just the most recent records
      const telemetryData = await Telemetry.find(query)
        .sort({ timestamp: 1 }) // 1 = ascending (oldest first), not -1 (newest first)
        .limit(maxRecords)
        .lean();

      console.log(`📈 Loaded ${telemetryData.length} telemetry records for export`);
      console.log('📋 Date range:', {
        startDate: startDate.toISOString(),
        endDate: endDate.toISOString(),
        range: Math.round((endDate - startDate) / (1000 * 60 * 60 * 24)) + ' days'
      });

      // Log first and last records to verify date range
      if (telemetryData.length > 0) {
        const firstRecord = telemetryData[0];
        const lastRecord = telemetryData[telemetryData.length - 1];
        console.log('📝 First record:', {
          timestamp: firstRecord.timestamp instanceof Date ? firstRecord.timestamp.toISOString() : firstRecord.timestamp,
          event: firstRecord.event,
          deviceId: firstRecord.deviceId
        });
        console.log('📝 Last record:', {
          timestamp: lastRecord.timestamp instanceof Date ? lastRecord.timestamp.toISOString() : lastRecord.timestamp,
          event: lastRecord.event,
          deviceId: lastRecord.deviceId
        });
        
        // Check date distribution
        const dates = telemetryData.map(r => {
          const d = r.timestamp instanceof Date ? r.timestamp : new Date(r.timestamp);
          return d.toISOString().split('T')[0];
        });
        const uniqueDates = [...new Set(dates)].sort();
        console.log(`📅 Records span ${uniqueDates.length} unique dates:`, uniqueDates.join(', '));
      }

      // Create workbook and worksheet
      const workbook = new ExcelJS.Workbook();
      workbook.creator = 'ZEPTAC IoT Platform';
      workbook.lastModifiedBy = 'System';
      workbook.created = new Date();
      workbook.modified = new Date();

      console.log('✅ Workbook created successfully');

      // Define the exact columns shown in the report UI
      const reportColumns = [
        'deviceId',
        'location',
        'status',
        'logNo',
        'timestamp',
        'event',  // Mode from UI
        'acv',
        'aci',
        'dcv',
        'dci',
        'ref1',
        'ref2',
        'ref3',
        'di1',
        'di2',
        'di3',
        'di4',
        'do',
        'latitude',
        'longitude',
        'ref1Status',
        'ref2Status',
        'ref3Status'
      ];

      // Create main telemetry worksheet with report columns
      const worksheet = workbook.addWorksheet('Telemetry Data', {
        pageSetup: { paperSize: 9, orientation: 'landscape' }
      });

      console.log('✅ Worksheet added to workbook');

      // Fields to exclude from any dynamic field detection
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
        'LOGGING INTERVAL'
      ]);

      // Define columns matching the report UI exactly
      const baseColumns = [
        { header: 'Device ID', key: 'deviceId', width: 15 },
        { header: 'Location', key: 'location', width: 20 },
        { header: 'Status', key: 'status', width: 12 },
        { header: 'Log No', key: 'logNo', width: 12 },
        { header: 'Timestamp', key: 'timestamp', width: 20 },
        { header: 'Mode', key: 'event', width: 15 },
        { header: 'ACV', key: 'acv', width: 12 },
        { header: 'ACI', key: 'aci', width: 12 },
        { header: 'DCV', key: 'dcv', width: 12 },
        { header: 'DCI', key: 'dci', width: 12 },
        { header: 'Ref 1', key: 'ref1', width: 12 },
        { header: 'Ref 2', key: 'ref2', width: 12 },
        { header: 'Ref 3', key: 'ref3', width: 12 },
        { header: 'DI 1', key: 'di1', width: 12 },
        { header: 'DI 2', key: 'di2', width: 12 },
        { header: 'DI 3', key: 'di3', width: 12 },
        { header: 'DI 4', key: 'di4', width: 12 },
        { header: 'DO', key: 'do', width: 12 },
        { header: 'Ref Status 1', key: 'ref1Status', width: 15 },
        { header: 'Ref Status 2', key: 'ref2Status', width: 15 },
        { header: 'Ref Status 3', key: 'ref3Status', width: 15 }
      ];

      worksheet.columns = baseColumns;

      console.log(`📋 Columns configured: ${baseColumns.length} columns matching report UI`);

      // Style the header row
      const mainHeaderRow = worksheet.getRow(1);
      mainHeaderRow.font = { bold: true, color: { argb: 'FFFFFF' } };
      mainHeaderRow.fill = {
        type: 'pattern',
        pattern: 'solid',
        fgColor: { argb: '366092' }
      };
      // Center align header
      mainHeaderRow.eachCell((cell) => {
        cell.alignment = {
          horizontal: 'center',
          vertical: 'middle',
          wrapText: true
        };
      });

      // Helper function to get field value with multiple key variations
      const getFieldValue = (record, ...possibleKeys) => {
        // First check top level of record
        for (const key of possibleKeys) {
          if (record[key] !== undefined && record[key] !== null) {
            return record[key];
          }
        }
        
        // Then check inside data Map (where actual sensor data is stored)
        if (record.data) {
          const dataMap = record.data;
          
          // Try exact matches with the provided keys (case-insensitive)
          for (const key of possibleKeys) {
            // Try uppercase
            const upperKey = key.toUpperCase();
            if (dataMap.has(upperKey)) {
              return dataMap.get(upperKey);
            }
            // Try the key as-is
            if (dataMap.has(key)) {
              return dataMap.get(key);
            }
          }
        }
        
        return null;
      };

      // Add data rows
      try {
        telemetryData.forEach((record, index) => {
          // Extract location - use geo-reversed location name if available
          let locationDisplay = 'N/A';
          const locationField = getFieldValue(record, 'location');
          
          if (locationField) {
            // If location is a JSON string (from geo-reverse), parse it
            if (typeof locationField === 'string' && locationField.startsWith('{')) {
              try {
                const locObj = JSON.parse(locationField);
                locationDisplay = locObj.city_name || locObj.display_name || locationField;
              } catch (e) {
                locationDisplay = locationField;
              }
            } else {
              locationDisplay = locationField;
            }
          }

          const row = {
            deviceId: record.deviceId,
            location: locationDisplay,
            status: getFieldValue(record, 'status') || 'online',
            logNo: getFieldValue(record, 'logNo', 'log', 'LOG') || '',
            timestamp: record.timestamp instanceof Date ? record.timestamp.toISOString() : record.timestamp,
            event: record.event || 'NORMAL',
            acv: getFieldValue(record, 'ACV', 'acv') || '',
            aci: getFieldValue(record, 'ACI', 'aci') || '',
            dcv: getFieldValue(record, 'DCV', 'dcv') || '',
            dci: getFieldValue(record, 'DCI', 'dci') || '',
            ref1: getFieldValue(record, 'REF1', 'ref1') || '',
            ref2: getFieldValue(record, 'REF2', 'ref2') || '',
            ref3: getFieldValue(record, 'REF3', 'ref3') || '',
            di1: getFieldValue(record, 'DI1', 'di1', 'DIGITAL INPUT 1', 'Digital Input 1') || '',
            di2: getFieldValue(record, 'DI2', 'di2', 'DIGITAL INPUT 2', 'Digital Input 2') || '',
            di3: getFieldValue(record, 'DI3', 'di3', 'DIGITAL INPUT 3', 'Digital Input 3') || '',
            di4: getFieldValue(record, 'DI4', 'di4', 'DIGITAL INPUT 4', 'Digital Input 4') || '',
            do: getFieldValue(record, 'DO', 'do', 'DIGITAL OUTPUT', 'Digital Output') || '',
            ref1Status: getFieldValue(record, 'REF1Status', 'ref1Status', 'REF1 STS', 'REF1STATUS') || '',
            ref2Status: getFieldValue(record, 'REF2Status', 'ref2Status', 'REF2 STS', 'REF2STATUS') || '',
            ref3Status: getFieldValue(record, 'REF3Status', 'ref3Status', 'REF3 STS', 'REF3STATUS') || ''
          };

          const excelRow = worksheet.addRow(row);

          // Center align all cells in the row
          excelRow.eachCell((cell) => {
            cell.alignment = {
              horizontal: 'center',
              vertical: 'middle',
              wrapText: true
            };
          });

          // Add conditional formatting for alternate rows
          if (index % 2 === 1) {
            const rowNum = index + 2; // +2 because Excel is 1-indexed and we have header
            excelRow.fill = {
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

      // Skip event-specific worksheets to reduce memory usage
      // (On Render with limited memory, creating 4+ filtered copies caused OOM)
      console.log('📋 Event sheets disabled for memory optimization');

      // Extract event counts from main data for summary
      let eventCounts = {
        normal: 0,
        dpol: 0,
        int: 0,
        inst: 0
      };

      // Count events in main data
      telemetryData.forEach(record => {
        const evt = String(record.event || '').toUpperCase().trim();
        const eventNum = Number(record.event);
        
        if (eventNum === 0 || evt === 'NORMAL' || evt.startsWith('NORMAL')) eventCounts.normal++;
        else if (eventNum === 3 || evt === 'DPOL' || evt === 'DEPOL') eventCounts.dpol++;
        else if (eventNum === 1 || evt === 'INT' || evt === 'INTERRUPT') eventCounts.int++;
        else if (eventNum === 4 || evt === 'INST' || evt === 'INSTANT') eventCounts.inst++;
      });

      // Add summary worksheet
      const summarySheet = workbook.addWorksheet('Summary');
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
        { metric: 'NORMAL Events', value: eventCounts.normal },
        { metric: 'DPOL Events', value: eventCounts.dpol },
        { metric: 'INT Events', value: eventCounts.int },
        { metric: 'INST Events', value: eventCounts.inst }
      ]);

      summarySheet.addRow({ metric: '', value: '' });
      summarySheet.addRow({ metric: 'Records per Device:', value: '' });
      
      Object.entries(deviceCounts).forEach(([deviceId, count]) => {
        summarySheet.addRow({ metric: `  ${deviceId}`, value: count });
      });

      console.log('✅ Workbook creation complete');

      return {
        workbook,
        filename,
        recordCount: telemetryData.length,
        devices: Object.keys(deviceCounts).length,
        eventCounts: eventCounts
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

      // Generate buffer with streaming to reduce memory usage
      const buffer = await workbook.xlsx.writeBuffer();
      
      console.log(`✅ Excel buffer generated: ${(buffer.length / 1024 / 1024).toFixed(2)} MB`);
      return buffer;
    } catch (error) {
      console.error('❌ Error generating Excel buffer:', error.message);
      console.error('❌ Buffer error name:', error.name);
      console.error('❌ Buffer error code:', error.code);
      
      // If memory error, try to provide helpful guidance
      if (error.message.includes('heap') || error.message.includes('memory')) {
        console.error('💡 Suggestion: Reduce the number of records or increase Node.js heap size with: node --max-old-space-size=4096');
      }
      
      throw error;
    }
  }
}

module.exports = ExcelExportService;