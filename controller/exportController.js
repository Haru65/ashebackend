const ExcelExportService = require('../services/excelExportService');
const Telemetry = require('../models/telemetry');

class ExportController {
  // Export telemetry data to Excel and download
  static async exportTelemetryExcel(req, res) {
    try {
      const {
        deviceId,
        startDate,
        endDate,
        format = 'download', // 'download' or 'save'
        modes // Comma-separated or array of event modes: NORMAL, DPOL, INT, INST
      } = req.query;

      // Parse modes parameter - can be array or comma-separated string
      let modeFilter = [];
      if (modes) {
        if (Array.isArray(modes)) {
          modeFilter = modes;
        } else if (typeof modes === 'string') {
          modeFilter = modes.split(',').map(m => m.trim().toUpperCase());
        }
      }

      console.log('📊 Export request:', { deviceId, startDate, endDate, format, modeFilter });

      // Parse and validate date range with proper timezone handling
      let start, end;
      
      if (startDate) {
        // Parse YYYY-MM-DD format - treat as local midnight start
        const [year, month, day] = startDate.split('-');
        start = new Date(year, month - 1, day, 0, 0, 0, 0); // Local timezone midnight
      } else {
        // Default: 30 days ago from today
        start = new Date();
        start.setDate(start.getDate() - 30);
        start.setHours(0, 0, 0, 0); // Set to start of day
      }
      
      if (endDate) {
        // Parse YYYY-MM-DD format - treat as local midnight + 23:59:59
        const [year, month, day] = endDate.split('-');
        end = new Date(year, month - 1, day, 23, 59, 59, 999); // Local timezone end of day
      } else {
        // Default: today at 23:59:59
        end = new Date();
        end.setHours(23, 59, 59, 999);
      }

      if (isNaN(start.getTime()) || isNaN(end.getTime())) {
        return res.status(400).json({
          success: false,
          error: 'Invalid date format. Use YYYY-MM-DD format.'
        });
      }

      if (start > end) {
        return res.status(400).json({
          success: false,
          error: 'Start date cannot be after end date.'
        });
      }

      console.log('📅 Date range after processing:', {
        originalStart: startDate,
        originalEnd: endDate,
        processedStart: start.toISOString(),
        processedEnd: end.toISOString(),
        daysSpan: Math.round((end - start) / (1000 * 60 * 60 * 24)),
        note: 'Using local timezone for date boundaries'
      });

      // Warn if trying to export a very large date range (on Render, this might timeout)
      const daySpan = Math.round((end - start) / (1000 * 60 * 60 * 24));
      if (daySpan > 60) {
        console.warn(`⚠️ WARNING: Exporting ${daySpan} days of data. On Render (30s timeout), consider reducing to under 60 days for better reliability.`);
      }

      // Set a longer timeout for this request (for Render deployment)
      // NOTE: Render hard timeout is 30 seconds
      // Streaming approach keeps us under this limit by not buffering
      
      console.log('⏱️ Export initiated within Render 30s window');

      // Generate Excel file
      const exportResult = await ExcelExportService.exportTelemetryToExcel({
        deviceId,
        startDate: start,
        endDate: end,
        modes: modeFilter
      });

      if (format === 'save') {
        // Save to server file system
        const filePath = await ExcelExportService.saveExcelFile(
          exportResult.workbook,
          exportResult.filename
        );

        res.json({
          success: true,
          data: {
            message: 'Excel file generated successfully',
            filename: exportResult.filename,
            filePath: filePath,
            recordCount: exportResult.recordCount,
            devices: exportResult.devices
          }
        });
      } else {
        // Send as download using ExcelJS native streaming
        try {
          console.log(`📊 Preparing to stream ${exportResult.recordCount} records...`);
          
          // Set CORS headers explicitly for file downloads (ensure they're applied even during streaming)
          res.setHeader('Access-Control-Allow-Origin', '*');
          res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
          res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization, Accept');
          
          // Set all headers BEFORE sending data
          res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
          res.setHeader('Content-Disposition', `attachment; filename="${exportResult.filename}"`);
          res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
          res.setHeader('Pragma', 'no-cache');
          res.setHeader('Expires', '0');

          console.log('📤 Starting streaming Excel export...');
          console.log(`📊 Workbook has ${exportResult.workbook.worksheets.length} sheets`);

          // Use ExcelJS native write() method which streams directly
          // This prevents memory buffering and respects Render's 30-second timeout
          console.log('⏳ Writing workbook to response stream...');
          const writePromise = exportResult.workbook.xlsx.write(res);
          
          // Monitor the write operation
          writePromise.then(() => {
            console.log(`✅ Excel file streamed successfully: ${exportResult.filename}`);
          }).catch((writeError) => {
            console.error('❌ Write promise rejected:', writeError.message);
            if (!res.headersSent) {
              try {
                res.status(500).json({
                  success: false,
                  error: 'Failed during Excel write operation',
                  details: writeError.message
                });
              } catch (e) {
                // Response already sent, nothing we can do
              }
            }
          });

          // Handle response errors
          res.on('error', (resError) => {
            console.error('❌ Response error during streaming:', resError.message);
          });

        } catch (streamError) {
          console.error('❌ Error setting up streaming export:', {
            message: streamError.message,
            name: streamError.name,
            code: streamError.code
          });
          
          // Only send error if headers haven't been sent yet
          if (!res.headersSent) {
            res.status(500).json({
              success: false,
              error: 'Failed to stream Excel file',
              details: streamError.message,
              suggestion: 'Try exporting fewer records (max 3000) or shorter date range (max 7 days)'
            });
          } else {
            console.log('Headers already sent, cannot send error response');
            res.end();
          }
        }
      }

    } catch (error) {
      console.error('❌ Export error:', error.message);
      console.error('❌ Error name:', error.name);
      console.error('❌ Error code:', error.code);
      console.error('❌ Error stack:', error.stack);
      console.error('❌ Full error object:', JSON.stringify({
        message: error.message,
        name: error.name,
        code: error.code,
        statusCode: error.statusCode,
        toString: error.toString()
      }, null, 2));
      
      res.status(500).json({
        success: false,
        error: error.message || 'Failed to export data',
        errorName: error.name,
        errorCode: error.code,
        details: process.env.NODE_ENV === 'development' ? error.stack : undefined
      });
    }
  }

  // Get export statistics
  static async getExportStats(req, res) {
    try {
      const { deviceId, startDate, endDate } = req.query;

      // Build query
      const query = {};
      if (deviceId) query.deviceId = deviceId;
      
      if (startDate || endDate) {
        query.timestamp = {};
        if (startDate) query.timestamp.$gte = new Date(startDate);
        if (endDate) query.timestamp.$lte = new Date(endDate);
      }

      // Get statistics
      const [totalRecords, uniqueDevices, dateRange] = await Promise.all([
        Telemetry.countDocuments(query),
        Telemetry.distinct('deviceId', query),
        Telemetry.aggregate([
          { $match: query },
          {
            $group: {
              _id: null,
              minDate: { $min: '$timestamp' },
              maxDate: { $max: '$timestamp' }
            }
          }
        ])
      ]);

      // Get records per device
      const recordsPerDevice = await Telemetry.aggregate([
        { $match: query },
        {
          $group: {
            _id: '$deviceId',
            count: { $sum: 1 },
            lastRecord: { $max: '$timestamp' },
            firstRecord: { $min: '$timestamp' }
          }
        }
      ]);

      res.json({
        success: true,
        data: {
          totalRecords,
          uniqueDevices: uniqueDevices.length,
          devicesList: uniqueDevices,
          dateRange: dateRange[0] || { minDate: null, maxDate: null },
          recordsPerDevice: recordsPerDevice.reduce((acc, item) => {
            acc[item._id] = {
              count: item.count,
              firstRecord: item.firstRecord,
              lastRecord: item.lastRecord
            };
            return acc;
          }, {}),
          query: query
        }
      });

    } catch (error) {
      console.error('❌ Export stats error:', error);
      res.status(500).json({
        success: false,
        error: 'Failed to get export statistics'
      });
    }
  }

  // Preview export data (first 10 records)
  static async previewExportData(req, res) {
    try {
      const { deviceId, startDate, endDate } = req.query;

      // Build query
      const query = {};
      if (deviceId) query.deviceId = deviceId;
      
      if (startDate || endDate) {
        query.timestamp = {};
        if (startDate) query.timestamp.$gte = new Date(startDate);
        if (endDate) query.timestamp.$lte = new Date(endDate);
      }

      // Get preview data
      const previewData = await Telemetry.find(query)
        .sort({ timestamp: -1 })
        .limit(10)
        .lean();

      // Fields to exclude from preview
      const excludedFields = new Set([
        'DEPOLARIZATION START TIMESTAMP', 'DEPOLARIZATION STOP TIMESTAMP', 'DEPOLARIZATION INTERVAL',
        'DEPOLARIZATIONSTARTTIMESTAMP', 'DEPOLARIZATIONSTOPTIMESTAMP', 'DPOLINTERVAL',
        'INSTANT END TIMESTAMP', 'INSTANT MODE', 'INSTANT START TIMESTAMP',
        'INSTANTENDTIMESTAMP', 'INSTANTMODE', 'INSTANTSTARTTIMESTAMP',
        'INTERRUPT OFF TIME', 'INTERRUPT ON TIME', 'INTERRUPT START TIMESTAMP', 'INTERRUPT STOP TIMESTAMP',
        'INTERRUPTOFFTIME', 'INTERRUPTONTIME', 'INTERRUPTSTARTTIMESTAMP', 'INTERRUPTSTOPTIMESTAMP',
        'LATITUDE', 'LONGITUDE', 'LOG', 'MANUAL MODE ACTION', 'MANUALMODEACTION',
        'REFFCAL CALIBRATION', 'REFFCAL ENABLED', 'REFFCAL VALUE', 'REF FCAL',
        'REF OP', 'REF UP', 'REFERENCE FAIL', 'REFERENCE OP', 'REFERENCE UP',
        'REFERENCEOV', 'REFERENCEFAIL', 'REFERENCEUP',
        'SETOP ENABLED', 'SETOP VALUE', 'SETUP ENABLED', 'SETUP VALUE',
        'SHUNT CURRENT', 'SHUNT VOLTAGE', 'SHUNTCURRENT', 'SHUNTVOLTAGE',
        'SN', 'SENDER', 'V', 'DATA', 'ELECTRODE', 'LOGGINGINTERVAL', 'LOGGINGINTERVALFORMATTED',
        'LOGGING INTERVAL', 'DI1', 'DI2', 'DI3', 'DI4'
      ]);

      // Transform data for preview
      const transformedData = previewData.map(record => {
        const result = {
          deviceId: record.deviceId,
          timestamp: record.timestamp,
          event: record.event
        };

        // Extract data fields (excluding unwanted fields)
        if (record.data) {
          const dataObj = record.data instanceof Map ? 
            Object.fromEntries(record.data) : record.data;
          
          Object.entries(dataObj).forEach(([key, value]) => {
            if (!excludedFields.has(key.toUpperCase())) {
              result[key] = value;
            }
          });
        }

        // Also extract flattened fields from record (excluding unwanted fields)
        Object.entries(record).forEach(([key, value]) => {
          if (!['deviceId', 'timestamp', 'event', 'status', 'location', 'name', 'type', 'lastSeen', '_id', 'data', '__v'].includes(key) &&
              !excludedFields.has(key.toUpperCase())) {
            result[key] = value;
          }
        });

        return result;
      });

      res.json({
        success: true,
        data: {
          preview: transformedData,
          totalCount: previewData.length,
          query: query
        }
      });

    } catch (error) {
      console.error('❌ Preview error:', error);
      res.status(500).json({
        success: false,
        error: 'Failed to preview export data'
      });
    }
  }

  // Diagnostic endpoint to check telemetry data in database
  static async getDatabaseDiagnostics(req, res) {
    try {
      // Get total count
      const totalCount = await Telemetry.countDocuments();

      // Get unique device IDs
      const uniqueDevices = await Telemetry.distinct('deviceId');

      // Get date range
      const dateRange = await Telemetry.aggregate([
        {
          $group: {
            _id: null,
            minDate: { $min: '$timestamp' },
            maxDate: { $max: '$timestamp' }
          }
        }
      ]);

      // Get recent records (last 5)
      const recentRecords = await Telemetry.find()
        .sort({ timestamp: -1 })
        .limit(5)
        .lean();

      // Get records per device
      const recordsPerDevice = await Telemetry.aggregate([
        {
          $group: {
            _id: '$deviceId',
            count: { $sum: 1 },
            lastRecord: { $max: '$timestamp' }
          }
        }
      ]);

      res.json({
        success: true,
        diagnostics: {
          totalRecords: totalCount,
          uniqueDevices: uniqueDevices,
          dateRange: dateRange[0] || { minDate: null, maxDate: null },
          recordsPerDevice: recordsPerDevice,
          recentRecords: recentRecords.slice(0, 3),
          timestamp: new Date().toISOString(),
          nodeEnv: process.env.NODE_ENV
        }
      });

    } catch (error) {
      console.error('❌ Diagnostics error:', error);
      res.status(500).json({
        success: false,
        error: error.message
      });
    }
  }
}

module.exports = ExportController;