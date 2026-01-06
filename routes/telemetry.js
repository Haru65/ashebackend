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
          dataLength: telemetryObj.data ? Object.keys(telemetryObj.data).length : 0
        });
        
        // Convert Map data to plain object and flatten all fields
        let dataObj = {};
        
        if (telemetryObj.data) {
          if (telemetryObj.data instanceof Map) {
            dataObj = Object.fromEntries(telemetryObj.data);
            console.log(`  ✓ Converted Map to object: ${Object.keys(dataObj).length} fields`);
          } else if (typeof telemetryObj.data === 'object') {
            // Handle plain object (should be the case for new records)
            dataObj = telemetryObj.data;
            console.log(`  ✓ Using plain object: ${Object.keys(dataObj).length} fields`);
          }
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

module.exports = router;