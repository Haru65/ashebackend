const ExcelJS = require('exceljs');
const Telemetry = require('../models/telemetry');
const Device = require('../models/Device');

class ExcelExportService {
  static buildEventFilter(modes = []) {
    const normalizedModes = modes.map(m => String(m).toUpperCase().trim()).filter(Boolean);
    const modeQueries = [];

    if (normalizedModes.includes('NORMAL')) {
      modeQueries.push({ event: { $in: [0, '0', 'NORMAL', 'NORMAL_MODE', 'normal'] } });
    }

    if (normalizedModes.includes('DPOL')) {
      modeQueries.push({
        event: {
          $in: [
            3,
            '3',
            'DPOL',
            'DEPOL',
            'DPOL_MODE',
            'DPOL ON',
            'DPOL OFF',
            'DEPOL ON',
            'DEPOL OFF'
          ]
        }
      });
    }

    if (normalizedModes.includes('INT')) {
      modeQueries.push({
        event: {
          $in: [
            1,
            '1',
            'INT',
            'INT ON',
            'INT OFF',
            'INTERRUPT',
            'INTERRUPT ON',
            'INTERRUPT OFF',
            'INT_MODE'
          ]
        }
      });
    }

    if (normalizedModes.includes('INST')) {
      modeQueries.push({
        event: {
          $in: [
            4,
            '4',
            'INST',
            'INST ON',
            'INST OFF',
            'INSTANT',
            'INSTANT ON',
            'INSTANT OFF',
            'INST_MODE'
          ]
        }
      });
    }

    return modeQueries;
  }

  static getDataField(data, key) {
    if (!data) return undefined;

    if (data instanceof Map) {
      return data.get(key);
    }

    if (typeof data === 'object') {
      return data[key];
    }

    return undefined;
  }

  static getEventType(event) {
    const evt = String(event ?? '').toUpperCase().trim();
    const normalizedEvent = evt.includes('/') ? evt.split('/').pop().trim() : evt;
    const eventNum = Number(normalizedEvent);

    if (eventNum === 0 || normalizedEvent === 'NORMAL' || normalizedEvent.startsWith('NORMAL')) return 'normal';
    if (eventNum === 3 || normalizedEvent === 'DPOL' || normalizedEvent === 'DEPOL' || normalizedEvent.startsWith('DPOL') || normalizedEvent.startsWith('DEPOL')) return 'dpol';
    if (eventNum === 1 || normalizedEvent === 'INT' || normalizedEvent === 'INTERRUPT' || normalizedEvent.startsWith('INT') || normalizedEvent.startsWith('INTERRUPT')) return 'int';
    if (eventNum === 4 || normalizedEvent === 'INST' || normalizedEvent === 'INSTANT' || normalizedEvent.startsWith('INST') || normalizedEvent.startsWith('INSTANT')) return 'inst';

    return null;
  }

  static buildTelemetryQuery({ deviceId, startDate, endDate, modes = [] } = {}) {
    const query = {
      timestamp: {
        $gte: startDate,
        $lte: endDate
      }
    };

    if (deviceId) {
      query.deviceId = deviceId;
    }

    if (modes && modes.length > 0) {
      const modeQueries = ExcelExportService.buildEventFilter(modes);
      if (modeQueries.length > 0) {
        query.$or = modeQueries;
      }
    }

    return query;
  }

  static async getDeviceDiLabels(deviceId) {
    const defaults = {
      DI1: 'DI 1',
      DI2: 'DI 2',
      DI3: 'DI 3',
      DI4: 'DI 4'
    };

    if (!deviceId) {
      return defaults;
    }

    try {
      const device = await Device.findOne({ deviceId })
        .select('metadata.diNames')
        .lean();
      const names = device?.metadata?.diNames || {};

      return {
        DI1: typeof names.DI1 === 'string' && names.DI1.trim() ? names.DI1.trim() : defaults.DI1,
        DI2: typeof names.DI2 === 'string' && names.DI2.trim() ? names.DI2.trim() : defaults.DI2,
        DI3: typeof names.DI3 === 'string' && names.DI3.trim() ? names.DI3.trim() : defaults.DI3,
        DI4: typeof names.DI4 === 'string' && names.DI4.trim() ? names.DI4.trim() : defaults.DI4
      };
    } catch (error) {
      console.warn(`⚠️ Could not load DI labels for ${deviceId}:`, error.message);
      return defaults;
    }
  }

  static getBaseColumns(diLabels = {}) {
    const labels = {
      DI1: diLabels.DI1 || 'DI 1',
      DI2: diLabels.DI2 || 'DI 2',
      DI3: diLabels.DI3 || 'DI 3',
      DI4: diLabels.DI4 || 'DI 4'
    };

    return [
      { header: 'Device ID', key: 'deviceId', width: 15 },
      { header: 'Location', key: 'location', width: 30 },
      { header: 'Status', key: 'status', width: 12 },
      { header: 'Log No', key: 'logNo', width: 12 },
      { header: 'Timestamp', key: 'timestamp', width: 25 },
      { header: 'Mode', key: 'event', width: 15 },
      { header: 'ACV', key: 'acv', width: 12 },
      { header: 'ACI', key: 'aci', width: 12 },
      { header: 'DCV', key: 'dcv', width: 12 },
      { header: 'DCI', key: 'dci', width: 12 },
      { header: 'Ref 1', key: 'ref1', width: 12 },
      { header: 'Ref 2', key: 'ref2', width: 12 },
      { header: 'Ref 3', key: 'ref3', width: 12 },
      { header: labels.DI1, key: 'di1', width: 12 },
      { header: labels.DI2, key: 'di2', width: 12 },
      { header: labels.DI3, key: 'di3', width: 12 },
      { header: labels.DI4, key: 'di4', width: 12 },
      { header: 'DO', key: 'do', width: 12 },
      { header: 'Ref Status 1', key: 'ref1Status', width: 15 },
      { header: 'Ref Status 2', key: 'ref2Status', width: 15 },
      { header: 'Ref Status 3', key: 'ref3Status', width: 15 }
    ];
  }

  static getFieldValue(record, ...possibleKeys) {
    for (const key of possibleKeys) {
      if (record[key] !== undefined && record[key] !== null) {
        return record[key];
      }
    }

    if (record.data) {
      for (const key of possibleKeys) {
        const upperValue = ExcelExportService.getDataField(record.data, key.toUpperCase());
        if (upperValue !== undefined && upperValue !== null) {
          return upperValue;
        }

        const exactValue = ExcelExportService.getDataField(record.data, key);
        if (exactValue !== undefined && exactValue !== null) {
          return exactValue;
        }
      }
    }

    return null;
  }

  static buildTelemetryRow(record) {
    let locationDisplay = 'N/A';
    const locationField = ExcelExportService.getFieldValue(record, 'location');

    if (locationField) {
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

    return {
      deviceId: record.deviceId,
      location: locationDisplay,
      status: ExcelExportService.getFieldValue(record, 'status') || 'online',
      logNo: ExcelExportService.getFieldValue(record, 'logNo', 'log', 'LOG') || '',
      timestamp: ExcelExportService.formatDate(record.timestamp),
      event: record.event || 'NORMAL',
      acv: ExcelExportService.getFieldValue(record, 'ACV', 'acv') || '',
      aci: ExcelExportService.getFieldValue(record, 'ACI', 'aci') || '',
      dcv: ExcelExportService.getFieldValue(record, 'DCV', 'dcv') || '',
      dci: ExcelExportService.getFieldValue(record, 'DCI', 'dci') || '',
      ref1: ExcelExportService.getFieldValue(record, 'REF1', 'ref1') || '',
      ref2: ExcelExportService.getFieldValue(record, 'REF2', 'ref2') || '',
      ref3: ExcelExportService.getFieldValue(record, 'REF3', 'ref3') || '',
      di1: ExcelExportService.getFieldValue(record, 'DI1', 'di1', 'DIGITAL INPUT 1', 'Digital Input 1') || '',
      di2: ExcelExportService.getFieldValue(record, 'DI2', 'di2', 'DIGITAL INPUT 2', 'Digital Input 2') || '',
      di3: ExcelExportService.getFieldValue(record, 'DI3', 'di3', 'DIGITAL INPUT 3', 'Digital Input 3') || '',
      di4: ExcelExportService.getFieldValue(record, 'DI4', 'di4', 'DIGITAL INPUT 4', 'Digital Input 4') || '',
      do: ExcelExportService.getFieldValue(record, 'DO', 'do', 'DIGITAL OUTPUT', 'Digital Output') || '',
      ref1Status: ExcelExportService.getFieldValue(record, 'REF1Status', 'ref1Status', 'REF1 STS', 'REF1STATUS') || '',
      ref2Status: ExcelExportService.getFieldValue(record, 'REF2Status', 'ref2Status', 'REF2 STS', 'REF2STATUS') || '',
      ref3Status: ExcelExportService.getFieldValue(record, 'REF3Status', 'ref3Status', 'REF3 STS', 'REF3STATUS') || ''
    };
  }

  /**
   * Format date as YYYY/MM/DD  HH:MM:SS (standardized timestamp)
   * Handles both Date objects and ISO strings
   * @param {Date|string} date - The date to format
   * @returns {string} Formatted timestamp as YYYY/MM/DD  HH:MM:SS
   */
  static formatDate(date) {
    if (!date) return '';
    
    // If already a formatted string, return it
    if (typeof date === 'string' && /^\d{4}\/\d{2}\/\d{2}\s{2}\d{2}:\d{2}:\d{2}$/.test(date)) {
      return date;
    }
    
    let d;
    if (date instanceof Date) {
      d = date;
    } else if (typeof date === 'string') {
      d = new Date(date);
    } else {
      d = new Date();
    }
    
    if (isNaN(d.getTime())) return '';
    
    // Pad numbers with leading zeros
    const year = d.getFullYear();
    const month = String(d.getMonth() + 1).padStart(2, '0');
    const day = String(d.getDate()).padStart(2, '0');
    const hours = String(d.getHours()).padStart(2, '0');
    const minutes = String(d.getMinutes()).padStart(2, '0');
    const seconds = String(d.getSeconds()).padStart(2, '0');
    
    return `${year}/${month}/${day}  ${hours}:${minutes}:${seconds}`;
  }

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
        modes = [], // Event mode filter: NORMAL, DPOL, INT, INST
        maxRecords = 10000 // Increased to 10000 since filtered data is smaller
      } = options;
      const diLabels = await ExcelExportService.getDeviceDiLabels(deviceId);

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

      // Add event mode filter if provided
      if (modes && modes.length > 0) {
        const modeQueries = ExcelExportService.buildEventFilter(modes);

        // Use $or to match any of the selected modes
        if (modeQueries.length > 0) {
          query.$or = modeQueries;
        }
      }

      console.log('📊 Exporting telemetry data with query:', {
        dateRange: {
          start: startDate instanceof Date ? startDate.toISOString() : startDate,
          end: endDate instanceof Date ? endDate.toISOString() : endDate,
          startType: typeof startDate,
          endType: typeof endDate
        },
        deviceId: deviceId || 'all devices',
        modes: modes.length > 0 ? modes : 'all modes',
        operator: '$gte and $lte (inclusive range), mode filtering with $or'
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
      // Sort by descending timestamp to show newest records first (most recent at top)
      const telemetryData = await Telemetry.find(query)
        .sort({ timestamp: -1 }) // -1 = descending (newest first, appears at top of Excel)
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
        'REF U/P',
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
      const baseColumns = ExcelExportService.getBaseColumns(diLabels);

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
            const upperValue = ExcelExportService.getDataField(dataMap, upperKey);
            if (upperValue !== undefined && upperValue !== null) {
              return upperValue;
            }
            // Try the key as-is
            const exactValue = ExcelExportService.getDataField(dataMap, key);
            if (exactValue !== undefined && exactValue !== null) {
              return exactValue;
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
            timestamp: ExcelExportService.formatDate(record.timestamp), // This will be set as text explicitly
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

          // Center align all data cells for better readability
          excelRow.eachCell((cell, colNumber) => {
            cell.alignment = {
              horizontal: 'center',
              vertical: 'middle',
              wrapText: false
            };
            
            // CRITICAL: Set timestamp column as TEXT to prevent Excel auto-formatting
            // Column 5 = Timestamp (Device ID, Location, Status, Log No, Timestamp)
            if (colNumber === 5) {
              // Force as text to preserve "YYYY/MM/DD  HH:MM:SS" format
              cell.dataType = 'string'; // ExcelJS dataType for text
              cell.numFmt = '@'; // Excel format code for text
              // Also set the value directly to ensure it's a string
              cell.value = String(cell.value);
            }
          });
          
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

      // Auto-fit columns and set text format for numeric columns to preserve leading zeros
      worksheet.columns.forEach(column => {
        column.alignment = {
          horizontal: 'center',
          vertical: 'middle',
          wrapText: false
        };
      });


      // Event sheets disabled for performance optimization on Render (30-second timeout)
      // Creating multiple worksheets with large datasets was causing exports to timeout
      // Event statistics are still tracked and shown in Summary sheet
      console.log('ℹ️  Event-specific worksheets disabled for performance. Summary sheet includes event type counts.');

      let eventCounts = {
        normal: 0,
        dpol: 0,
        int: 0,
        inst: 0
      };

      // Count events in main data during single pass
      telemetryData.forEach(record => {
        const eventType = ExcelExportService.getEventType(record.event);
        if (eventType && eventCounts[eventType] !== undefined) {
          eventCounts[eventType]++;
        }
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

  static async streamTelemetryToExcel(options = {}, outputStream) {
    const {
      deviceId,
      startDate = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000),
      endDate = new Date(),
      filename = `telemetry_export_${new Date().toISOString().split('T')[0]}.xlsx`,
      modes = [],
      maxRecords = 10000
    } = options;

    const query = ExcelExportService.buildTelemetryQuery({ deviceId, startDate, endDate, modes });
    const diLabels = await ExcelExportService.getDeviceDiLabels(deviceId);

    console.log('📊 Streaming telemetry Excel export with query:', {
      start: startDate instanceof Date ? startDate.toISOString() : startDate,
      end: endDate instanceof Date ? endDate.toISOString() : endDate,
      deviceId: deviceId || 'all devices',
      modes: modes.length > 0 ? modes : 'all modes'
    });

    const totalCount = await Telemetry.countDocuments(query);
    console.log(`📈 Found ${totalCount} total telemetry records`);

    if (totalCount === 0) {
      throw new Error('No telemetry data found for the specified criteria');
    }

    if (totalCount > maxRecords) {
      console.warn(`⚠️ WARNING: ${totalCount} records found, streaming latest ${maxRecords} records to protect server memory`);
    }

    const workbook = new ExcelJS.stream.xlsx.WorkbookWriter({
      stream: outputStream,
      useStyles: false,
      useSharedStrings: false
    });

    workbook.creator = 'ZEPTAC IoT Platform';
    workbook.created = new Date();
    workbook.modified = new Date();

    const worksheet = workbook.addWorksheet('Telemetry Data', {
      pageSetup: { paperSize: 9, orientation: 'landscape' }
    });
    worksheet.columns = ExcelExportService.getBaseColumns(diLabels);
    worksheet.getRow(1).commit();

    const eventCounts = {
      normal: 0,
      dpol: 0,
      int: 0,
      inst: 0
    };
    const deviceCounts = {};

    let recordCount = 0;
    const cursor = Telemetry.find(query)
      .sort({ timestamp: -1 })
      .limit(maxRecords)
      .lean()
      .cursor({ batchSize: 250 });

    try {
      for await (const record of cursor) {
        const row = worksheet.addRow(ExcelExportService.buildTelemetryRow(record));
        row.getCell(5).numFmt = '@';
        row.commit();

        recordCount++;
        deviceCounts[record.deviceId] = (deviceCounts[record.deviceId] || 0) + 1;

        const eventType = ExcelExportService.getEventType(record.event);
        if (eventType && eventCounts[eventType] !== undefined) {
          eventCounts[eventType]++;
        }

        if (recordCount % 1000 === 0) {
          console.log(`   Streamed ${recordCount} Excel rows...`);
        }
      }
    } finally {
      await cursor.close().catch(() => {});
    }

    worksheet.commit();

    const summarySheet = workbook.addWorksheet('Summary');
    summarySheet.columns = [
      { header: 'Metric', key: 'metric', width: 25 },
      { header: 'Value', key: 'value', width: 20 }
    ];
    summarySheet.getRow(1).commit();

    [
      { metric: 'Export Date', value: new Date().toISOString() },
      { metric: 'Date Range', value: `${startDate.toISOString().split('T')[0]} to ${endDate.toISOString().split('T')[0]}` },
      { metric: 'Matching Records', value: totalCount },
      { metric: 'Exported Records', value: recordCount },
      { metric: 'Unique Devices', value: Object.keys(deviceCounts).length },
      { metric: 'NORMAL Events', value: eventCounts.normal },
      { metric: 'DPOL Events', value: eventCounts.dpol },
      { metric: 'INT Events', value: eventCounts.int },
      { metric: 'INST Events', value: eventCounts.inst }
    ].forEach(item => summarySheet.addRow(item).commit());

    summarySheet.addRow({ metric: '', value: '' }).commit();
    summarySheet.addRow({ metric: 'Records per Device:', value: '' }).commit();
    Object.entries(deviceCounts).forEach(([summaryDeviceId, count]) => {
      summarySheet.addRow({ metric: `  ${summaryDeviceId}`, value: count }).commit();
    });
    summarySheet.commit();

    await workbook.commit();
    console.log(`✅ Streaming Excel export completed: ${recordCount} records`);

    return {
      filename,
      recordCount,
      totalCount,
      devices: Object.keys(deviceCounts).length,
      eventCounts
    };
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
