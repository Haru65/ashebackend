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
      .skip(parseInt(offset));

    // Enrich telemetry data with device metadata
    const enrichedTelemetryData = await Promise.all(
      telemetryData.map(async (telemetry) => {
        const device = await Device.findOne({ deviceId: telemetry.deviceId }).lean();
        const telemetryObj = telemetry.toObject ? telemetry.toObject() : telemetry;
        
        return {
          ...telemetryObj,
          // Add device metadata fields
          name: device?.deviceName || telemetry.deviceId,
          type: 'IoT Sensor', // Default type - can be extended in Device model if needed
          lastSeen: device?.status?.lastSeen || telemetry.timestamp
        };
      })
    );

    // Get total count for pagination
    const totalCount = await Telemetry.countDocuments(query);

    console.log('✅ Telemetry results:', enrichedTelemetryData.length, 'records');

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

    // Enrich all telemetry records with device metadata
    const enrichedTelemetryData = telemetryData.map(telemetry => {
      const telemetryObj = telemetry.toObject ? telemetry.toObject() : telemetry;
      
      return {
        ...telemetryObj,
        // Add device metadata fields
        name: device?.deviceName || deviceId,
        type: 'IoT Sensor',
        lastSeen: device?.status?.lastSeen || telemetry.timestamp
      };
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

    // Enrich with device metadata
    const enrichedLatestData = await Promise.all(
      latestData.map(async (telemetry) => {
        const device = await Device.findOne({ deviceId: telemetry.deviceId }).lean();
        
        return {
          ...telemetry,
          name: device?.deviceName || telemetry.deviceId,
          type: 'IoT Sensor',
          lastSeen: device?.status?.lastSeen || telemetry.timestamp
        };
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

module.exports = router;