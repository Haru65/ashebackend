const express = require('express');
const router = express.Router();
const Telemetry = require('../models/telemetry');
const Device = require('../models/Device');
const { authenticateToken } = require('../middleware/auth');

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

// DEPRECATED: Reverse geocoding endpoint removed
// Use device's stored location instead of external API calls
router.get('/geolocation/reverse', async (req, res) => {
  res.json({
    success: false,
    error: 'Reverse geocoding service disabled. Use device location instead.'
  });
});

module.exports = router;