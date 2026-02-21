const express = require('express');
const router = express.Router();
const Device = require('../models/Device');
const axios = require('axios');

// Cache for reverse geocoding results to avoid repeated API calls
const geoCache = new Map();

/**
 * Reverse geocode coordinates to location name using Nominatim
 * @param {number} lat - Latitude
 * @param {number} lon - Longitude
 * @returns {Promise<string>} - Location name or coordinates as fallback
 */
const reverseGeocode = async (lat, lon) => {
  const cacheKey = `${lat},${lon}`;
  
  // Check cache first
  if (geoCache.has(cacheKey)) {
    console.log(`✅ Using cached location for ${cacheKey}`);
    return geoCache.get(cacheKey);
  }

  try {
    console.log(`🌐 Reverse geocoding ${cacheKey}...`);
    const response = await axios.get('https://nominatim.openstreetmap.org/reverse', {
      params: {
        format: 'json',
        lat: lat,
        lon: lon,
        zoom: 18,
        addressdetails: 1
      },
      headers: {
        'User-Agent': 'AsheControl-IoT'
      },
      timeout: 5000
    });

    if (response.data && response.data.address) {
      // Try to get the most relevant address part
      const addr = response.data.address;
      const location = addr.city || addr.town || addr.village || addr.suburb || addr.county || response.data.display_name;
      
      console.log(`📍 Geocoded ${cacheKey} to: ${location}`);
      geoCache.set(cacheKey, location);
      return location;
    }
  } catch (error) {
    console.warn(`⚠️ Reverse geocoding failed for ${cacheKey}:`, error.message);
  }

  // Fallback to coordinates
  const fallback = `${lat.toFixed(4)}, ${lon.toFixed(4)}`;
  geoCache.set(cacheKey, fallback);
  return fallback;
};

/**
 * POST /api/devices
 * Create a new MQTT device with complete configuration
 */
router.post('/devices', async (req, res) => {
  try {
    const { 
      deviceId, 
      deviceName, 
      location, 
      deviceType,
      zoneId,
      clusterName,
      icon, 
      color, 
      description,
      mqttBroker,
      mqttUsername,
      mqttPassword,
      topicPrefix,
      dataTopic,
      statusTopic,
      commandTopic
    } = req.body;
    
    // Validate required fields
    if (!deviceId || !deviceName || !mqttBroker || !mqttUsername || !mqttPassword) {
      return res.status(400).json({ 
        error: 'deviceId, deviceName, mqttBroker, mqttUsername, and mqttPassword are required' 
      });
    }
    
    // Check if device already exists
    const existingDevice = await Device.findOne({ deviceId });
    if (existingDevice) {
      return res.status(409).json({ error: `Device with ID ${deviceId} already exists` });
    }
    
    // Create new MQTT device with complete configuration
    const newDevice = await Device.create({
      deviceId,
      deviceName,
      location: location || 'Unknown Location',
      deviceType: deviceType || 'IoT Sensor',
      zoneId: zoneId || null,
      clusterName: clusterName || null,
      mqtt: {
        brokerUrl: mqttBroker,
        topicPrefix: topicPrefix || `devices/${deviceId}`,
        topics: {
          data: dataTopic || `devices/${deviceId}/data`,
          status: statusTopic || `devices/${deviceId}/status`,
          control: commandTopic || `devices/${deviceId}/commands`
        },
        credentials: {
          username: mqttUsername,
          password: mqttPassword
        }
      },
      sensors: {
        battery: null,
        signal: null,
        temperature: null,
        humidity: null,
        pressure: null
      },
      status: {
        state: 'offline',
        lastSeen: null
      },
      metadata: {
        icon: icon || 'bi-device',
        color: color || '#6c757d',
        description: description || `${deviceType || 'IoT Device'} - ${deviceId}`
      }
    });
    
    console.log(`✅ Created new MQTT device: ${deviceName} (ID: ${deviceId})`);
    console.log(`   📡 MQTT Broker: ${mqttBroker}`);
    console.log(`   📥 Data Topic: ${dataTopic || `devices/${deviceId}/data`}`);
    console.log(`   📤 Command Topic: ${commandTopic || `devices/${deviceId}/commands`}`);
    console.log(`   🔐 Username: ${mqttUsername}`);
    if (zoneId) console.log(`   🗂️ Zone ID: ${zoneId}`);
    if (clusterName) console.log(`   📍 Cluster: ${clusterName}`);
    
    res.status(201).json({
      success: true,
      message: 'MQTT device created successfully',
      device: {
        id: newDevice.deviceId,
        name: newDevice.deviceName,
        location: newDevice.location,
        status: newDevice.status.state,
        zoneId: newDevice.zoneId,
        clusterName: newDevice.clusterName,
        route: `/devices/${newDevice.deviceId}`,
        mqtt: {
          broker: newDevice.mqtt.brokerUrl,
          dataTopic: newDevice.mqtt.topics.data,
          commandTopic: newDevice.mqtt.topics.control,
          username: mqttUsername
        }
      }
    });
  } catch (error) {
    console.error('Error creating MQTT device:', error);
    res.status(500).json({ error: 'Failed to create MQTT device', details: error.message });
  }
});

/**
 * DELETE /api/devices/:deviceId
 * Delete a device
 */
router.delete('/devices/:deviceId', async (req, res) => {
  try {
    const device = await Device.findOneAndDelete({ deviceId: req.params.deviceId });
    
    if (!device) {
      return res.status(404).json({ error: 'Device not found' });
    }
    
    console.log(`🗑️  Deleted device: ${device.deviceName} (ID: ${device.deviceId})`);
    
    res.json({
      success: true,
      message: 'Device deleted successfully',
      deviceId: device.deviceId
    });
  } catch (error) {
    console.error('Error deleting device:', error);
    res.status(500).json({ error: 'Failed to delete device' });
  }
});

/**
 * GET /api/devices
 * Get all devices with their current status
 */
router.get('/devices', async (req, res) => {
  try {
    const Telemetry = require('../models/telemetry');
    
    const devices = await Device.find({})
      .select('deviceId deviceName location zoneId clusterName deviceType mqtt sensors status metadata')
      .sort({ 'status.lastSeen': -1 })
      .lean();
    
    console.log(`📋 GET /api/devices - Found ${devices.length} devices in database`);
    console.log('📋 Device IDs:', devices.map(d => d.deviceId));
    
    // Fetch latest telemetry for each device to get fresh location data and sensor readings
    const formattedDevices = await Promise.all(devices.map(async (device) => {
      let location = device.location || 'N/A';
      let status = 'offline';
      let lastSeen = 'Never';
      let currentData = {};
      
      try {
        // Get device status from Device document first
        const fullDevice = await Device.findOne({ deviceId: device.deviceId }).select('status.state status.lastSeen');
        if (fullDevice) {
          status = fullDevice.status?.state || 'offline';
          lastSeen = fullDevice.status?.lastSeen ? new Date(fullDevice.status.lastSeen).toLocaleString() : 'Never';
        }
        
        // Get latest telemetry for location and sensor data
        const latestTelemetry = await Telemetry.findOne({ deviceId: device.deviceId })
          .select('location status timestamp data event')
          .sort({ timestamp: -1 });
        
        if (latestTelemetry) {
          // Update location if available from telemetry
          if (latestTelemetry.location) {
            location = latestTelemetry.location;
          }
          // Update status if available from telemetry
          if (latestTelemetry.status) {
            status = latestTelemetry.status;
          }
          // Update lastSeen to latest telemetry timestamp
          if (latestTelemetry.timestamp) {
            lastSeen = new Date(latestTelemetry.timestamp).toLocaleString();
          }
          
          // Extract sensor data from telemetry - CRITICAL: Ensure data is properly extracted
          if (latestTelemetry.data) {
            console.log(`🔍 Device ${device.deviceId} telemetry data type:`, {
              isMap: latestTelemetry.data instanceof Map,
              typeOf: typeof latestTelemetry.data,
              keys: latestTelemetry.data instanceof Map 
                ? Array.from(latestTelemetry.data.keys()).length 
                : Object.keys(latestTelemetry.data || {}).length
            });
            
            if (latestTelemetry.data instanceof Map) {
              currentData = Object.fromEntries(latestTelemetry.data);
            } else if (typeof latestTelemetry.data === 'object' && latestTelemetry.data !== null) {
              // If it's a plain object, use it directly
              currentData = latestTelemetry.data;
            }
            
            const dataKeys = Object.keys(currentData);
            console.log(`📊 Device ${device.deviceId} has ${dataKeys.length} sensor fields: ${dataKeys.slice(0, 10).join(', ')}${dataKeys.length > 10 ? '...' : ''}`);
          }
        }
      } catch (err) {
        console.warn(`⚠️ Error fetching telemetry for ${device.deviceId}:`, err.message);
      }
      
      // Reverse geocode if location is coordinates
      const coordMatch = location.match(/^(-?\d+\.?\d*)\s*,\s*(-?\d+\.?\d*)$/);
      if (coordMatch) {
        const lat = parseFloat(coordMatch[1]);
        const lon = parseFloat(coordMatch[2]);
        location = await reverseGeocode(lat, lon);
      }
      
      return {
        id: device.deviceId,
        deviceId: device.deviceId,
        sensorId: device.deviceId,
        name: device.deviceName || `Device ${device.deviceId}`,
        icon: device.metadata?.icon || 'bi-device',
        type: device.deviceType || 'IoT Sensor',
        location: location,
        status: status,
        lastSeen: lastSeen,
        currentData: currentData,
        zoneId: device.zoneId || null,
        clusterName: device.clusterName || null,
        metrics: [
          { type: 'battery', value: device.sensors?.battery || 0, icon: 'bi-battery-full' },
          { type: 'signal', value: device.sensors?.signal || 0, icon: 'bi-wifi' },
          { type: 'temperature', value: device.sensors?.temperature || 0, icon: 'bi-thermometer' },
        ]
      };
    }));
    
    console.log(`✅ Returning ${formattedDevices.length} formatted devices`);
    res.json({
      success: true,
      count: formattedDevices.length,
      devices: formattedDevices
    });
  } catch (error) {
    console.error('Error fetching devices:', error);
    res.status(500).json({ error: 'Failed to fetch devices' });
  }
});

/**
 * GET /api/devices/:deviceId
 * Get single device by deviceId
 */
router.get('/devices/:deviceId', async (req, res) => {
  try {
    const device = await Device.findOne({ deviceId: req.params.deviceId }).lean();
    
    if (!device) {
      return res.status(404).json({ error: 'Device not found' });
    }
    
    // Transform to match frontend expectations
    const formattedDevice = {
      id: device.deviceId,
      name: device.deviceName || `Device ${device.deviceId}`,
      icon: device.metadata?.icon || 'bi-device',
      type: 'IoT Sensor',
      location: device.location || 'N/A',
      status: device.status?.state || 'offline',
      lastSeen: device.status?.lastSeen ? new Date(device.status.lastSeen).toISOString() : 'Never',
      mqtt: device.mqtt,
      sensors: device.sensors,
      metadata: device.metadata
    };
    
    res.json(formattedDevice);
  } catch (error) {
    console.error('Error fetching device:', error);
    res.status(500).json({ error: 'Failed to fetch device' });
  }
});

/**
 * GET /api/devices/:deviceId/status
 * Get device status summary
 */
router.get('/devices/:deviceId/status', async (req, res) => {
  try {
    const device = await Device.findOne({ deviceId: req.params.deviceId })
      .select('deviceId deviceName status')
      .lean();
    
    if (!device) {
      return res.status(404).json({ error: 'Device not found' });
    }
    
    res.json({
      deviceId: device.deviceId,
      name: device.deviceName,
      status: device.status?.state || 'offline',
      lastSeen: device.status?.lastSeen,
      isOnline: device.status?.state === 'online'
    });
  } catch (error) {
    console.error('Error fetching device status:', error);
    res.status(500).json({ error: 'Failed to fetch device status' });
  }
});

module.exports = router;
