const express = require('express');
const router = express.Router();
const Telemetry = require('../models/telemetry');
const Device = require('../models/Device');
const { authenticateToken } = require('../middleware/auth');

// Simple in-memory cache for reverse geocoding results (24 hour TTL)
const geolocationCache = new Map();

function getCacheKey(lat, lon) {
  return `${Math.round(lat * 1000) / 1000},${Math.round(lon * 1000) / 1000}`;
}

function getCachedLocation(lat, lon) {
  const key = getCacheKey(lat, lon);
  const cached = geolocationCache.get(key);
  
  if (cached && Date.now() - cached.timestamp < 24 * 60 * 60 * 1000) {
    return cached.data;
  }
  
  return null;
}

function cacheLocation(lat, lon, data) {
  const key = getCacheKey(lat, lon);
  geolocationCache.set(key, {
    data: data,
    timestamp: Date.now()
  });
}

// Get telemetry data with filtering
router.get('/', authenticateToken, async (req, res) => {
  try {
    console.log('📊 Telemetry GET / route hit');
    console.log('   User:', req.user?.userId);
    console.log('   Permissions:', req.user?.permissions);
    
    const {
      deviceId,
      startDate,
      endDate,
      mode,
      limit = 100,
      offset = 0
    } = req.query;

    // Build query
    const query = {};
    
    if (deviceId) {
      query.deviceId = deviceId;
    }

    if (startDate || endDate) {
      query.timestamp = {};
      if (startDate) {
        query.timestamp.$gte = new Date(startDate);
      }
      if (endDate) {
        query.timestamp.$lte = new Date(endDate + 'T23:59:59.999Z');
      }
    }

    // Add mode/event filtering if specified
    if (mode && mode.trim() !== '') {
      const modeUpper = String(mode).toUpperCase().trim();
      let eventPatterns = [];
      let eventCodes = [];
      
      console.log(`🔍 Mode filter requested: "${mode}" (normalized: "${modeUpper}")`);
      
      if (modeUpper === 'NORMAL') {
        eventCodes = [0, '0'];
        eventPatterns = ['NORMAL'];
      } else if (modeUpper === 'INT') {
        eventCodes = [1, '1'];
        eventPatterns = ['INT', 'INTERRUPT'];
      } else if (modeUpper === 'DPOL') {
        // Accept both DPOL and DEPOL variants - critical for matching database values
        eventCodes = [3, '3'];
        eventPatterns = ['DPOL', 'DEPOL'];
      } else if (modeUpper === 'INST') {
        eventCodes = [4, '4'];
        eventPatterns = ['INST', 'INSTANT'];
      }
      
      if (eventCodes.length > 0 || eventPatterns.length > 0) {
        // Build flexible query to match both exact values and regex patterns
        // This handles: numeric codes (0,1,3,4), string codes ('0','1'), 
        // and full text values ('INT ON', 'DPOL', 'NORMAL', etc.)
        const conditions = [];
        
        // Match numeric or string codes
        if (eventCodes.length > 0) {
          conditions.push({ event: { $in: eventCodes } });
        }
        
        // Match text patterns (handles "INT ON", "DPOL", "INST OFF", etc.)
        if (eventPatterns.length > 0) {
          const regexStr = eventPatterns.map(p => p.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|');
          conditions.push({ event: { $regex: regexStr, $options: 'i' } });
        }
        
        // Combine all conditions with OR
        if (conditions.length === 1) {
          query.event = conditions[0].event;
        } else if (conditions.length > 1) {
          query.$or = conditions;
        }
        
        console.log(`✅ Mode filter applied: "${modeUpper}"`);
        console.log(`   Event codes to match: ${eventCodes.join(', ')}`);
        console.log(`   Event patterns to match: ${eventPatterns.join(', ')}`);
      }
    }

    console.log('📊 Telemetry query:', query);

    // Execute query
    const telemetryData = await Telemetry
      .find(query)
      .sort({ timestamp: -1 })
      .limit(parseInt(limit))
      .skip(parseInt(offset))
      .exec(); // Don't use .lean() so Mongoose applies schema methods properly

    // Enrich telemetry data with device metadata AND flatten data fields
    const enrichedTelemetryData = await Promise.all(
      telemetryData.map(async (telemetry) => {
        const device = await Device.findOne({ deviceId: telemetry.deviceId }).lean();
        const telemetryObj = telemetry.toObject ? telemetry.toObject() : telemetry;
        
        console.log(`🔍 Processing telemetry record ${telemetryObj._id}:`, {
          deviceId: telemetryObj.deviceId,
          dataType: typeof telemetryObj.data,
          isMap: telemetryObj.data instanceof Map,
          dataKeys: telemetryObj.data ? Object.keys(telemetryObj.data) : [],
          dataLength: telemetryObj.data ? Object.keys(telemetryObj.data).length : 0,
          rawData: telemetryObj.data
        });
        
        // Convert Map data to plain object and flatten all fields
        let dataObj = {};
        
        if (telemetryObj.data) {
          if (telemetryObj.data instanceof Map) {
            // Map case
            dataObj = Object.fromEntries(telemetryObj.data);
            console.log(`  ✓ Converted Map to object: ${Object.keys(dataObj).length} fields`);
            console.log(`    Map entries: ${Array.from(telemetryObj.data.keys()).join(', ')}`);
          } else if (typeof telemetryObj.data === 'object') {
            // Handle plain object (should be the case for new records)
            dataObj = telemetryObj.data;
            console.log(`  ✓ Using plain object: ${Object.keys(dataObj).length} fields`);
            console.log(`    Object keys: ${Object.keys(dataObj).join(', ')}`);
          }
        }
        
        // Log the final dataObj to debug
        if (Object.keys(dataObj).length > 0) {
          console.log(`  Sample data fields:`, Object.fromEntries(Object.entries(dataObj).slice(0, 5)));
        } else {
          console.warn(`  ⚠️ WARNING: No data fields found in record!`);
        }
        
        const enrichedRecord = {
          _id: telemetryObj._id,
          deviceId: telemetryObj.deviceId,
          timestamp: telemetryObj.timestamp,
          event: telemetryObj.event,
          status: 'online',  // ✅ Status is always 'online' when data exists in telemetry
          location: telemetryObj.location,
          // Include all data fields directly (flattened)
          ...dataObj,
          // Add device metadata fields
          name: device?.deviceName || telemetry.deviceId,
          type: 'IoT Sensor',
          lastSeen: device?.status?.lastSeen || telemetry.timestamp
        };
        
        // Explicitly remove the nested data field to avoid confusion
        delete enrichedRecord.data;
        
        console.log(`  ✓ Enriched record has ${Object.keys(enrichedRecord).length - 4} data fields (excluding _id, deviceId, timestamp, event)`);
        
        return enrichedRecord;
      })
    );

    // Get total count for pagination
    const totalCount = await Telemetry.countDocuments(query);

    console.log('✅ Telemetry results:', enrichedTelemetryData.length, 'records');
    if (enrichedTelemetryData.length > 0) {
      console.log('   First record fields count:', Object.keys(enrichedTelemetryData[0]).length);
      console.log('   First record sample:', JSON.stringify(enrichedTelemetryData[0], null, 2).substring(0, 300));
    }
    if (enrichedTelemetryData.length > 0) {
      console.log('   Sample record keys:', Object.keys(enrichedTelemetryData[0]));
      console.log('   Sample record (first 20 fields):', JSON.stringify(
        Object.fromEntries(Object.entries(enrichedTelemetryData[0]).slice(0, 20)),
        null,
        2
      ));
    }

    res.json({
      success: true,
      data: enrichedTelemetryData,
      meta: {
        total: totalCount,
        limit: parseInt(limit),
        offset: parseInt(offset),
        hasMore: totalCount > parseInt(offset) + parseInt(limit)
      }
    });

  } catch (error) {
    console.error('Error fetching telemetry data:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to fetch telemetry data'
    });
  }
});

// Get telemetry data for specific device
router.get('/device/:deviceId', authenticateToken, async (req, res) => {
  try {
    const { deviceId } = req.params;
    const {
      startDate,
      endDate,
      limit = 100
    } = req.query;

    const query = { deviceId };
    
    if (startDate || endDate) {
      query.timestamp = {};
      if (startDate) {
        query.timestamp.$gte = new Date(startDate);
      }
      if (endDate) {
        query.timestamp.$lte = new Date(endDate + 'T23:59:59.999Z');
      }
    }

    const telemetryData = await Telemetry
      .find(query)
      .sort({ timestamp: -1 })
      .limit(parseInt(limit));

    // Get device metadata once
    const device = await Device.findOne({ deviceId }).lean();

    // Enrich all telemetry records with device metadata and flatten data fields
    const enrichedTelemetryData = telemetryData.map(telemetry => {
      const telemetryObj = telemetry.toObject ? telemetry.toObject() : telemetry;
      
      // Convert Map data to plain object and flatten all fields
      const dataObj = telemetryObj.data instanceof Map 
        ? Object.fromEntries(telemetryObj.data)
        : telemetryObj.data || {};
      
      const enrichedRecord = {
        _id: telemetryObj._id,
        deviceId: telemetryObj.deviceId,
        timestamp: telemetryObj.timestamp,
        event: telemetryObj.event,
        status: telemetryObj.status,
        location: telemetryObj.location,
        // Include all data fields directly (flattened)
        ...dataObj,
        // Add device metadata fields
        name: device?.deviceName || deviceId,
        type: 'IoT Sensor',
        lastSeen: device?.status?.lastSeen || telemetry.timestamp
      };
      
      // Explicitly remove the nested data field to avoid confusion
      delete enrichedRecord.data;
      
      return enrichedRecord;
    });

    res.json({
      success: true,
      data: enrichedTelemetryData
    });

  } catch (error) {
    console.error('Error fetching device telemetry:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to fetch device telemetry data'
    });
  }
});

// Get latest telemetry for all devices
router.get('/latest', authenticateToken, async (req, res) => {
  try {
    const latestData = await Telemetry.aggregate([
      {
        $sort: { timestamp: -1 }
      },
      {
        $group: {
          _id: '$deviceId',
          latestRecord: { $first: '$$ROOT' }
        }
      },
      {
        $replaceRoot: { newRoot: '$latestRecord' }
      }
    ]);

    // Enrich with device metadata and flatten data fields
    const enrichedLatestData = await Promise.all(
      latestData.map(async (telemetry) => {
        const device = await Device.findOne({ deviceId: telemetry.deviceId }).lean();
        
        // Convert Map data to plain object and flatten all fields
        const dataObj = telemetry.data instanceof Map 
          ? Object.fromEntries(telemetry.data)
          : telemetry.data || {};
        
        const enrichedRecord = {
          _id: telemetry._id,
          deviceId: telemetry.deviceId,
          timestamp: telemetry.timestamp,
          event: telemetry.event,
          status: telemetry.status,
          location: telemetry.location,
          // Include all data fields directly (flattened)
          ...dataObj,
          name: device?.deviceName || telemetry.deviceId,
          type: 'IoT Sensor',
          lastSeen: device?.status?.lastSeen || telemetry.timestamp
        };
        
        // Explicitly remove the nested data field to avoid confusion
        delete enrichedRecord.data;
        
        return enrichedRecord;
      })
    );

    res.json({
      success: true,
      data: enrichedLatestData
    });

  } catch (error) {
    console.error('Error fetching latest telemetry:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to fetch latest telemetry data'
    });
  }
});

// Get recent telemetry with device parameters (ref1, ref2, ref3, dcv, dci, acv)
router.get('/recent', authenticateToken, async (req, res) => {
  try {
    const { 
      deviceId, 
      limit = 100,
      timePeriod = '24h'
    } = req.query;

    // Calculate time range based on period
    const now = new Date();
    let startDate = new Date();
    
    switch (timePeriod) {
      case '24h':
        startDate.setHours(now.getHours() - 24);
        break;
      case '7d':
        startDate.setDate(now.getDate() - 7);
        break;
      case '30d':
        startDate.setDate(now.getDate() - 30);
        break;
      default:
        startDate.setHours(now.getHours() - 24);
    }

    const query = {
      timestamp: { $gte: startDate }
    };

    if (deviceId) {
      query.deviceId = deviceId;
    }

    const telemetryData = await Telemetry
      .find(query)
      .sort({ timestamp: 1 })
      .limit(parseInt(limit));

    // Extract parameters from data map
    const formattedData = telemetryData.map(item => {
      const dataObj = item.data ? Object.fromEntries(item.data) : {};
      return {
        deviceId: item.deviceId,
        timestamp: item.timestamp,
        ref1: dataObj.ref1 || dataObj.REF1 || 0,
        ref2: dataObj.ref2 || dataObj.REF2 || 0,
        ref3: dataObj.ref3 || dataObj.REF3 || 0,
        dcv: dataObj.dcv || dataObj.DCV || 0,
        dci: dataObj.dci || dataObj.DCI || 0,
        acv: dataObj.acv || dataObj.ACV || 0
      };
    });

    res.json({
      success: true,
      data: formattedData,
      meta: {
        count: formattedData.length,
        timePeriod
      }
    });

  } catch (error) {
    console.error('Error fetching recent telemetry:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to fetch recent telemetry data'
    });
  }
});

// Reverse geocoding endpoint - converts coordinates to location names
// PUBLIC ENDPOINT - No authentication required
// Gracefully falls back to coordinates if geocoding services unavailable
router.get('/geolocation/reverse', async (req, res) => {
  try {
    const { lat, lon } = req.query;
    
    if (!lat || !lon) {
      return res.status(400).json({
        success: false,
        error: 'Missing latitude or longitude parameters'
      });
    }
    
    const latitude = parseFloat(lat);
    const longitude = parseFloat(lon);
    
    if (isNaN(latitude) || isNaN(longitude)) {
      return res.status(400).json({
        success: false,
        error: 'Invalid latitude or longitude values'
      });
    }
    
    // ⚡ CHECK CACHE FIRST - Return instantly if we've seen these coordinates before
    const cachedResult = getCachedLocation(latitude, longitude);
    if (cachedResult) {
      return res.json(cachedResult);
    }
    
    console.log(`🌐 [REVERSE GEOCODE] Request: lat=${latitude}, lon=${longitude}`);
    
    // Pre-defined common locations as instant fallback (works even when APIs fail)
    const commonLocations = [
      // Mumbai areas and neighborhoods
      { lat: 19.076, lon: 72.877, name: 'Sion, Mumbai, Maharashtra, India', tolerance: 0.01 },
      { lat: 19.055, lon: 72.872, name: 'Currey Road, Mumbai, Maharashtra, India', tolerance: 0.01 },
      { lat: 19.015, lon: 72.856, name: 'Worli, Mumbai, Maharashtra, India', tolerance: 0.01 },
      { lat: 19.047, lon: 72.821, name: 'Fort, Mumbai, Maharashtra, India', tolerance: 0.01 },
      { lat: 19.089, lon: 72.836, name: 'Kala Ghoda, Mumbai, Maharashtra, India', tolerance: 0.01 },
      { lat: 19.118, lon: 72.829, name: 'Fort District, Mumbai, Maharashtra, India', tolerance: 0.01 },
      { lat: 19.050, lon: 72.870, name: 'Mumbai, Maharashtra, India', tolerance: 0.05 },  // General Mumbai fallback
      
      // Other major cities
      { lat: 28.70, lon: 77.10, name: 'New Delhi, India', tolerance: 0.05 },
      { lat: 13.34, lon: 74.74, name: 'Mangalore, Karnataka, India', tolerance: 0.05 },
      { lat: 15.50, lon: 73.83, name: 'Goa, India', tolerance: 0.05 },
      { lat: 12.97, lon: 77.59, name: 'Bangalore, Karnataka, India', tolerance: 0.05 },
      { lat: 18.52, lon: 73.86, name: 'Pune, Maharashtra, India', tolerance: 0.05 },
    ];
    
    // Check if matches pre-defined location first (instant, no API call)
    for (const location of commonLocations) {
      if (Math.abs(latitude - location.lat) < location.tolerance && 
          Math.abs(longitude - location.lon) < location.tolerance) {
        console.log(`✅ [REVERSE GEOCODE] Matched pre-defined location: ${location.name}`);
        const result = {
          success: true,
          data: {
            display_name: location.name,
            address: {
              city_name: location.name,
              latitude: latitude,
              longitude: longitude
            }
          },
          preDefinedMatch: true,
          cached: false
        };
        cacheLocation(latitude, longitude, result);
        return res.json(result);
      }
    }
    
    // Try Nominatim ONLY if not in pre-defined locations (to avoid blocking)
    try {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 8000); // 8 second timeout
      
      try {
        const nominatimUrl = `https://nominatim.openstreetmap.org/reverse?format=json&lat=${latitude}&lon=${longitude}&zoom=18&addressdetails=1`;
        
        const response = await fetch(nominatimUrl, {
          headers: {
            'Accept': 'application/json',
            'User-Agent': 'Zeptac-IoT-Platform/1.0'
          },
          signal: controller.signal
        });
        
        clearTimeout(timeoutId);
        
        if (response.ok) {
          const data = await response.json();
          if (data && data.display_name) {
            console.log(`✅ [REVERSE GEOCODE] Success:`, data.display_name);
            const result = {
              success: true,
              data: data,
              address: data.address,
              cached: false
            };
            cacheLocation(latitude, longitude, result);
            return res.json(result);
          }
        }
      } catch (fetchErr) {
        clearTimeout(timeoutId);
        throw fetchErr;
      }
    } catch (nominatimError) {
      console.warn(`⚠️ [REVERSE GEOCODE] Nominatim failed:`, nominatimError.message);
    }
    
    // If Nominatim fails, return coordinates with success=true (graceful fallback)
    // Frontend will display coordinates instead of error
    console.log(`ℹ️ [REVERSE GEOCODE] Returning coordinates as fallback`);
    const fallbackResult = {
      success: true,
      data: {
        display_name: `${latitude}, ${longitude}`,
        address: {
          latitude: latitude,
          longitude: longitude
        }
      },
      fallback: true,
      cached: false
    };
    cacheLocation(latitude, longitude, fallbackResult);
    return res.json(fallbackResult);
  } catch (error) {
    console.error('❌ [REVERSE GEOCODE] Error:', error.message);
    res.status(500).json({
      success: false,
      error: 'Internal server error during reverse geocoding'
    });
  }
});

// Delete telemetry data with filtering
router.delete('/', authenticateToken, async (req, res) => {
  try {
    console.log('🗑️ Telemetry DELETE / route hit');
    console.log('   User:', req.user?.userId);
    console.log('   Raw Query Object:', JSON.stringify(req.query, null, 2));
    console.log('   Query Keys:', Object.keys(req.query));

    const {
      deviceId,
      startDate,
      endDate,
      mode,
      confirmDelete
    } = req.query;

    // Log each parameter individually  
    console.log(`   deviceId: "${deviceId}" (type: ${typeof deviceId}, empty: ${!deviceId})`);
    console.log(`   startDate: "${startDate}" (type: ${typeof startDate}, empty: ${!startDate})`);
    console.log(`   endDate: "${endDate}" (type: ${typeof endDate}, empty: ${!endDate})`);
    console.log(`   mode: "${mode}" (type: ${typeof mode}, empty: ${!mode})`);
    console.log(`   confirmDelete: "${confirmDelete}" (type: ${typeof confirmDelete})`);

    // Require explicit confirmation for deletion
    if (!confirmDelete || confirmDelete !== 'true') {
      return res.status(400).json({
        success: false,
        error: 'Deletion must be explicitly confirmed with confirmDelete=true'
      });
    }

    // Build query filter
    const query = {};

    // Filter by device ID if provided - CRITICAL: Must match database format
    if (deviceId && deviceId.trim() !== '') {
      query.deviceId = deviceId;
      console.log(`✅ ADDING deviceId to query: "${deviceId}"`);
      console.log(`   Query now contains deviceId: ${JSON.stringify(query)}`);
    } else {
      console.log(`⚠️ WARNING: deviceId not added to query!`);
      console.log(`   deviceId value: ${deviceId}`);
      console.log(`   deviceId type: ${typeof deviceId}`);
      console.log(`   deviceId is falsy: ${!deviceId}`);
    }

    // Filter by date range if provided
    if (startDate || endDate) {
      query.timestamp = {};
      if (startDate) {
        query.timestamp.$gte = new Date(startDate);
        console.log(`📅 Filtering from: ${startDate}`);
      }
      if (endDate) {
        query.timestamp.$lte = new Date(endDate + 'T23:59:59.999Z');
        console.log(`📅 Filtering to: ${endDate}`);
      }
    }

    // Filter by event/mode type if provided
    if (mode && mode.trim() !== '') {
      const modeUpper = String(mode).toUpperCase().trim();
      let eventPatterns = [];
      let eventCodes = [];

      console.log(`🔍 Mode filter for deletion: "${mode}" (normalized: "${modeUpper}")`);

      if (modeUpper === 'NORMAL') {
        eventCodes = [0, '0'];
        eventPatterns = ['NORMAL'];
      } else if (modeUpper === 'INT') {
        eventCodes = [1, '1'];
        eventPatterns = ['INT', 'INTERRUPT'];
      } else if (modeUpper === 'DPOL') {
        eventCodes = [3, '3'];
        eventPatterns = ['DPOL', 'DEPOL'];
      } else if (modeUpper === 'INST') {
        eventCodes = [4, '4'];
        eventPatterns = ['INST', 'INSTANT'];
      } else {
        console.warn(`⚠️ Unknown mode value: "${mode}" (normalized: "${modeUpper}")`);
      }

      if (eventCodes.length > 0 || eventPatterns.length > 0) {
        const conditions = [];

        if (eventCodes.length > 0) {
          conditions.push({ event: { $in: eventCodes } });
          console.log(`   Added numeric code condition: $in [${eventCodes.join(', ')}]`);
        }

        if (eventPatterns.length > 0) {
          const regexStr = eventPatterns.map(p => p.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|');
          conditions.push({ event: { $regex: regexStr, $options: 'i' } });
          console.log(`   Added regex condition: /${regexStr}/i`);
        }

        if (conditions.length === 1) {
          query.event = conditions[0].event;
          console.log(`   Single condition, applied directly to query.event`);
        } else if (conditions.length > 1) {
          query.$or = conditions;
          console.log(`   Multiple conditions, using $or`);
        }

        console.log(`✅ Mode filter applied: "${modeUpper}"`);
        console.log(`   Event codes to match: ${eventCodes.join(', ')}`);
        console.log(`   Event patterns to match: ${eventPatterns.join(', ')}`);
      } else {
        console.warn(`⚠️ No event codes or patterns defined for mode: "${modeUpper}"`);
      }
    } else {
      console.log(`⚠️ Mode filter was empty or not provided`);
    }

    // Validate that at least SOME filter is provided (safety check)
    if (Object.keys(query).length === 0) {
      return res.status(400).json({
        success: false,
        error: 'At least one filter parameter (deviceId, startDate, endDate, or mode) must be provided to prevent accidental deletion of all data'
      });
    }

    // ADDITIONAL SAFETY CHECK: Require more restrictive filters
    // Do NOT allow deletion with ONLY date range (too risky - could delete all devices)
    const hasDeviceFilter = deviceId && deviceId.trim() !== '';
    const hasModeFilter = mode && mode.trim() !== '';
    const hasDateFilter = startDate || endDate;
    
    if (hasDateFilter && !hasDeviceFilter && !hasModeFilter) {
      return res.status(400).json({
        success: false,
        error: '⚠️ Safety check: Cannot delete using ONLY date range. Please also select a Device filter OR a Mode filter to specify exactly which data to delete. This prevents accidental deletion of all devices in a date range.',
        details: {
          reason: 'Date range alone is too broad',
          suggestion: 'Select at least one of: Specific Device ID or Specific Mode (INT, NORMAL, DPOL, INST)',
          example: 'Delete only Device-01 records in this date range, or only INT events in this date range'
        }
      });
    }

    // Log validation passed
    console.log('✅ Safety validation passed:');
    console.log(`   Has Device Filter: ${hasDeviceFilter}`);
    console.log(`   Has Mode Filter: ${hasModeFilter}`);
    console.log(`   Has Date Filter: ${hasDateFilter}`);

    console.log('🗑️ Telemetry deletion query:', JSON.stringify(query, null, 2));
    console.log('📋 DELETION FILTERS (same as display sorting):');
    console.log(`   Date Range: ${startDate || 'No date filter'} to ${endDate || 'No date filter'}`);
    console.log(`   Device: ${deviceId || 'All Devices'}`);
    console.log(`   Mode: ${mode || 'All Modes'}`);
    console.log(`   Sort: -timestamp (most recent first)`);

    // Count records before deletion
    const countBefore = await Telemetry.countDocuments(query);
    console.log(`📊 Records matching deletion criteria: ${countBefore}`);
    
    // SAFETY: Warn if trying to delete too many records at once
    const MAX_DELETE_LIMIT = 5000; // Maximum records to delete in one operation
    if (countBefore > MAX_DELETE_LIMIT) {
      return res.status(400).json({
        success: false,
        error: `⚠️ Too many records to delete: ${countBefore} records match your criteria (max: ${MAX_DELETE_LIMIT})`,
        details: {
          recordsToDelete: countBefore,
          maxAllowed: MAX_DELETE_LIMIT,
          suggestion: 'Apply stricter filters (more specific device or mode, narrower date range) to reduce the number of records'
        }
      });
    }
    
    // Show some sample records that will be deleted (for debugging)
    if (countBefore > 0) {
      const sampleRecords = await Telemetry.find(query).limit(3);
      console.log(`📋 Sample of ${Math.min(3, countBefore)} records to be deleted:`);
      sampleRecords.forEach((record, idx) => {
        console.log(`   [${idx + 1}] ID: ${record._id}, Device: ${record.deviceId}, Event: ${record.event}, Timestamp: ${record.timestamp}`);
      });
      
      // Additional debug: Show counts with different filter combinations
      console.log(`📊 DEBUG: Record count analysis for Device: ${deviceId || 'All'}:`);
      
      // Count all records for this device
      if (deviceId && deviceId.trim() !== '') {
        const countAllForDevice = await Telemetry.countDocuments({ deviceId });
        console.log(`   - All records for device: ${countAllForDevice}`);
        
        // Count by date range only for this device
        if (startDate || endDate) {
          const dateOnlyQuery = { deviceId };
          if (startDate || endDate) {
            dateOnlyQuery.timestamp = {};
            if (startDate) dateOnlyQuery.timestamp.$gte = new Date(startDate);
            if (endDate) dateOnlyQuery.timestamp.$lte = new Date(endDate + 'T23:59:59.999Z');
          }
          const countDateRangeForDevice = await Telemetry.countDocuments(dateOnlyQuery);
          console.log(`   - Records in date range for device: ${countDateRangeForDevice}`);
        }
        
        // Count by mode only for this device
        if (mode && mode.trim() !== '') {
          const modeOnlyQuery = { deviceId };
          const modeUpper = String(mode).toUpperCase().trim();
          let modePatterns = [];
          if (modeUpper === 'INT') modePatterns = ['INT', 'INTERRUPT'];
          else if (modeUpper === 'DPOL') modePatterns = ['DPOL', 'DEPOL'];
          else if (modeUpper === 'INST') modePatterns = ['INST', 'INSTANT'];
          else if (modeUpper === 'NORMAL') modePatterns = ['NORMAL'];
          
          const regexStr = modePatterns.map(p => p.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|');
          modeOnlyQuery.event = { $regex: regexStr, $options: 'i' };
          const countModeForDevice = await Telemetry.countDocuments(modeOnlyQuery);
          console.log(`   - Records for mode "${mode}" in device: ${countModeForDevice}`);
        }
      }
    }

    // FINAL VERIFICATION: Log the exact query being used for deletion
    console.log('\n========== CRITICAL: FINAL QUERY BEFORE DELETION ==========');
    console.log('📋 Query object keys:', Object.keys(query));
    console.log('📋 deviceId in query?', 'deviceId' in query);
    if ('deviceId' in query) {
      console.log(`    ✅ YES - deviceId value: "${query.deviceId}"`);
    } else {
      console.log(`    ❌ NO - deviceId NOT in query!`);
    }
    console.log('📋 mode filter in query?', query.event !== undefined || query.$or !== undefined);
    console.log('📋 timestamp filter in query?', query.timestamp !== undefined);
    console.log('📋 Full query object:', JSON.stringify(query, null, 2));
    console.log('=========================================================\n');

    // Perform deletion
    const result = await Telemetry.deleteMany(query);

    console.log(`✅ Deletion successful:`);
    console.log(`   Deleted: ${result.deletedCount} records`);
    console.log(`   Acknowledged: ${result.acknowledged}`);

    res.json({
      success: true,
      message: `Successfully deleted ${result.deletedCount} telemetry record(s)`,
      data: {
        deletedCount: result.deletedCount,
        filters: {
          deviceId: deviceId || null,
          startDate: startDate || null,
          endDate: endDate || null,
          mode: mode || null
        },
        timestamp: new Date().toISOString()
      }
    });

  } catch (error) {
    console.error('❌ Error deleting telemetry data:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to delete telemetry data',
      details: error.message
    });
  }
});

// Delete telemetry data for specific device
router.delete('/device/:deviceId', authenticateToken, async (req, res) => {
  try {
    const { deviceId } = req.params;
    const { startDate, endDate, confirmDelete } = req.query;

    console.log(`🗑️ DELETE /device/${deviceId} route hit`);
    console.log('   User:', req.user?.userId);

    // Require explicit confirmation
    if (!confirmDelete || confirmDelete !== 'true') {
      return res.status(400).json({
        success: false,
        error: 'Deletion must be explicitly confirmed with confirmDelete=true'
      });
    }

    const query = { deviceId };

    if (startDate || endDate) {
      query.timestamp = {};
      if (startDate) {
        query.timestamp.$gte = new Date(startDate);
      }
      if (endDate) {
        query.timestamp.$lte = new Date(endDate + 'T23:59:59.999Z');
      }
    }

    console.log(`🗑️ Deletion query for device ${deviceId}:`, query);

    const result = await Telemetry.deleteMany(query);

    console.log(`✅ Deleted ${result.deletedCount} records for device ${deviceId}`);

    res.json({
      success: true,
      message: `Successfully deleted ${result.deletedCount} records for device ${deviceId}`,
      data: {
        deviceId,
        deletedCount: result.deletedCount,
        dateRange: {
          startDate: startDate || null,
          endDate: endDate || null
        },
        timestamp: new Date().toISOString()
      }
    });

  } catch (error) {
    console.error('❌ Error deleting device telemetry:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to delete device telemetry data',
      details: error.message
    });
  }
});

module.exports = router;