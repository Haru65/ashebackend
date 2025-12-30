const mqttService = require('../services/mqttService');
const socketService = require('../services/socketService');
const alarmMonitoringService = require('../services/alarmMonitoringService');
const { secondsToHHMMSS, hhmmssToSeconds, ensureLoggingIntervalFormat } = require('../utils/timeConverter');
const Device = require('../models/Device');
const DeviceHistory = require('../models/DeviceHistory');

// Helper function to parse event type from event string
function parseEventType(eventString) {
  if (!eventString) return { type: 'NORMAL', state: '', raw: 'NORMAL' };
  const eventLower = String(eventString).toLowerCase();
  
  let type = 'NORMAL';
  if (eventLower.includes('dpol')) type = 'DPOL';
  else if (eventLower.includes('int')) type = 'INT';
  else if (eventLower.includes('inst')) type = 'INST';
  
  // Extract state (ON/OFF/OPEN/CLOSE etc)
  const state = eventString.replace(/[a-zA-Z:\/\s]/g, '').length > 0 
    ? eventString.split(/\s+/).pop() 
    : '';
  
  return {
    type: type,
    state: state,
    raw: String(eventString).toUpperCase()
  };
}

class DeviceController {
  // Get specific device by deviceId with historical data
  static async getDeviceById(req, res) {
    try {
      const { deviceId } = req.params;

      // Find device in MongoDB
      const device = await Device.findOne({ deviceId }).lean();

      if (!device) {
        return res.status(404).json({
          success: false,
          error: 'Device not found',
          message: `Device with ID ${deviceId} does not exist`
        });
      }

      // Get last 24 hours of historical data
      const oneDayAgo = new Date(Date.now() - 24 * 60 * 60 * 1000);
      const historicalData = await DeviceHistory.find({
        deviceId,
        timestamp: { $gte: oneDayAgo }
      })
      .sort({ timestamp: -1 })
      .limit(1000)
      .lean();

      // Transform device data
      // Handle both old string status and new object status format
      let statusValue = 'offline';
      let lastSeenValue = null;
      
      if (typeof device.status === 'object' && device.status?.state) {
        statusValue = device.status.state;
        lastSeenValue = device.status.lastSeen || null;
      } else if (typeof device.status === 'string') {
        // Old format: status was a string, migrate to offline
        statusValue = 'offline';
        lastSeenValue = null;
      }
      
      const deviceData = {
        deviceId: device.deviceId,
        name: device.deviceName || device.deviceId,
        location: device.location || 'N/A',
        status: statusValue,
        lastSeen: lastSeenValue,
        currentEvent: device.currentEvent || 'NORMAL',
        currentData: device.sensors || {},
        mqttConfig: {
          brokerUrl: device.mqtt?.brokerUrl || null,
          topicPrefix: device.mqtt?.topicPrefix || null,
          topics: {
            data: device.mqtt?.topics?.data || `devices/${device.deviceId}/data`,
            status: device.mqtt?.topics?.status || `devices/${device.deviceId}/status`,
            control: device.mqtt?.topics?.control || `devices/${device.deviceId}/control`
          }
        },
        metadata: {
          icon: device.metadata?.icon || null,
          color: device.metadata?.color || null,
          description: device.metadata?.description || null
        },
        configuration: device.configuration || null,
        historicalCollection: device.historicalCollection || null,
        createdAt: device.createdAt,
        updatedAt: device.updatedAt
      };

      res.json({
        success: true,
        device: deviceData,
        historicalData: {
          count: historicalData.length,
          timeRange: {
            from: oneDayAgo.toISOString(),
            to: new Date().toISOString()
          },
          data: historicalData
        }
      });
    } catch (error) {
      console.error('Error fetching device by ID:', error);
      res.status(500).json({
        success: false,
        error: 'Internal server error',
        message: error.message
      });
    }
  }

  // Post sensor data for a specific device
  static async postDeviceData(req, res) {
    try {
      const { deviceId } = req.params;
      const sensorData = req.body;

      // Validate that we have some data
      if (!sensorData || Object.keys(sensorData).length === 0) {
        return res.status(400).json({
          success: false,
          error: 'Bad request',
          message: 'Sensor data is required in request body'
        });
      }

      // Find or create device
      let device = await Device.findOne({ deviceId });

      if (!device) {
        // Create new device if it doesn't exist
        device = new Device({
          deviceId,
          deviceName: sensorData.name || deviceId,
          location: sensorData.location || 'N/A',
          sensors: {},
          status: {
            state: 'online',
            lastSeen: new Date()
          }
        });
      }

      // Update device's current sensor data
      device.sensors = {
        battery: sensorData.battery !== undefined ? sensorData.battery : device.sensors?.battery,
        signal: sensorData.signal !== undefined ? sensorData.signal : device.sensors?.signal,
        temperature: sensorData.temperature !== undefined ? sensorData.temperature : device.sensors?.temperature,
        humidity: sensorData.humidity !== undefined ? sensorData.humidity : device.sensors?.humidity,
        pressure: sensorData.pressure !== undefined ? sensorData.pressure : device.sensors?.pressure
      };

      // Update status to online and set lastSeen
      device.status = {
        state: 'online',
        lastSeen: new Date()
      };

      // Extract and store event type from incoming data
      const eventString = sensorData.event || sensorData.EVENT || 'NORMAL';
      device.currentEvent = parseEventType(eventString);

      // Save device
      await device.save();

      // Store in historical data collection
      const historyEntry = await DeviceHistory.create({
        deviceId,
        timestamp: new Date(),
        data: sensorData,
        topic: sensorData.topic || `devices/${deviceId}/data`
      });

      // Emit real-time update via Socket.IO
      socketService.emitToAll('deviceUpdate', {
        type: 'device',
        topic: `devices/${deviceId}/data`,
        data: {
          id: deviceId,
          ...sensorData,
          timestamp: historyEntry.timestamp
        }
      });

      // Check alarms for this device data
      const event = sensorData.EVENT || sensorData.event || 'NORMAL';
      await alarmMonitoringService.checkAlarmsForDevice(sensorData, deviceId, event);

      res.json({
        success: true,
        message: 'Device data updated successfully',
        device: {
          deviceId: device.deviceId,
          currentData: device.sensors,
          status: device.status,
          lastSeen: device.status.lastSeen
        },
        historyId: historyEntry._id
      });
    } catch (error) {
      console.error('Error posting device data:', error);
      res.status(500).json({
        success: false,
        error: 'Internal server error',
        message: error.message
      });
    }
  }

  // Get all devices from MongoDB
  static async getAllDevices(req, res) {
    try {
      const devices = await Device.find({})
        .select('deviceId deviceName location status sensors metadata mqtt configuration')
        .lean();

      // Transform the data to match the expected frontend format
      const transformedDevices = devices.map(device => {
        // Handle both old string status and new object status format
        let statusValue = 'offline';
        let lastSeenValue = null;
        
        if (typeof device.status === 'object' && device.status?.state) {
          statusValue = device.status.state;
          lastSeenValue = device.status.lastSeen || null;
        } else if (typeof device.status === 'string') {
          // Old format: status was a string, migrate to offline
          statusValue = 'offline';
          lastSeenValue = null;
        }
        
        return {
          deviceId: device.deviceId,
          name: device.deviceName || device.deviceId,
          location: device.location || 'N/A',
          status: statusValue,
          lastSeen: lastSeenValue,
          currentData: device.sensors || {},
          mqttTopic: device.mqtt?.topics?.data || `devices/${device.deviceId}/data`,
          icon: device.metadata?.icon || null,
          color: device.metadata?.color || null,
          description: device.metadata?.description || null,
          configuration: device.configuration || null
        };
      });

      res.json({
        success: true,
        count: transformedDevices.length,
        devices: transformedDevices
      });
    } catch (error) {
      console.error('Error fetching devices from MongoDB:', error);
      res.status(500).json({
        success: false,
        error: 'Internal server error',
        message: error.message
      });
    }
  }

  // Delete a device by deviceId
  static async deleteDevice(req, res) {
    try {
      const { deviceId } = req.params;

      // Check if device exists
      const device = await Device.findOne({ deviceId });
      if (!device) {
        return res.status(404).json({
          success: false,
          error: 'Device not found',
          message: `Device with ID ${deviceId} does not exist`
        });
      }

      // Remove device from database
      await Device.deleteOne({ deviceId });

      // Also remove any historical data for this device
      const DeviceHistory = require('../models/DeviceHistory');
      await DeviceHistory.deleteMany({ deviceId });

      console.log(`🗑️  Device deleted: ${device.deviceName || deviceId} (ID: ${deviceId})`);

      res.json({
        success: true,
        message: 'Device deleted successfully',
        deviceId: deviceId,
        deviceName: device.deviceName || deviceId
      });
    } catch (error) {
      console.error('Error deleting device:', error);
      res.status(500).json({
        success: false,
        error: 'Internal server error',
        message: error.message
      });
    }
  }

  // Get all devices data (legacy MQTT-based endpoint)
  static async getDevices(req, res) {
    try {
      const deviceData = mqttService.getDeviceData();
      const connectionStatus = mqttService.getConnectionStatus();
      const lastUpdate = mqttService.getLastTimestamp();

      res.json({
        success: true,
        data: { 
          device: deviceData.device,
          connectionStatus: connectionStatus.device,
          lastUpdate
        }
      });
    } catch (error) {
      console.error('Error getting devices:', error);
      res.status(500).json({
        success: false,
        error: 'Internal server error'
      });
    }
  }

  // Send message to device
  static async sendMessage(req, res) {
    try {
      const { text, type = 'individual' } = req.body;
      
      if (!text || !text.trim()) {
        return res.status(400).json({
          success: false,
          error: 'Message text is required'
        });
      }

      if (!mqttService.isDeviceConnected()) {
        return res.status(503).json({
          success: false,
          error: 'Device 123 is not connected'
        });
      }

      const messagePayload = {
        message: text.trim(),
        timestamp: new Date().toISOString(),
        sender: req.user ? req.user.username : 'api',
        senderId: req.user ? req.user.userId : 'anonymous',
        type: type
      };

      mqttService.publishMessage(messagePayload, (err) => {
        if (err) {
          console.error('❌ API: Error publishing to device 123:', err);
          res.status(500).json({
            success: false,
            error: `Failed to send message: ${err.message}`
          });
        } else {
          console.log('✅ API: Message published to device 123 successfully');
          res.json({
            success: true,
            messageId: `msg_${Date.now()}`,
            details: `Message sent to device 123 via API`
          });
          
          // Notify all connected Socket.io clients about the message
          socketService.emitToAll('messageNotification', {
            type: 'sent',
            message: messagePayload,
            targets: 'device-123',
            sender: messagePayload.sender
          });
        }
      });
    } catch (error) {
      console.error('Error sending message:', error);
      res.status(500).json({
        success: false,
        error: 'Internal server error'
      });
    }
  }

  // Set device to Interrupt mode
  static async setInterruptMode(req, res) {
    try {
      const { deviceId } = req.params;
      const config = req.body;

      if (!mqttService.isDeviceConnected()) {
        return res.status(503).json({
          success: false,
          error: `Device ${deviceId} is not connected`
        });
      }

      const result = await mqttService.setInterruptMode(deviceId, config);

      res.json({
        success: true,
        message: 'Interrupt mode configuration sent with acknowledgment tracking',
        commandId: result.commandId,
        data: result
      });

      // Notify clients about the configuration change
      socketService.emitToAll('deviceConfigurationSent', {
        deviceId,
        configType: 'Interrupt',
        commandId: result.commandId,
        timestamp: new Date().toISOString()
      });

    } catch (error) {
      console.error('Error setting interrupt mode:', error);
      res.status(500).json({
        success: false,
        error: error.message || 'Internal server error'
      });
    }
  }

  // Set device to Manual mode
  static async setManualMode(req, res) {
    try {
      const { deviceId } = req.params;
      const { action } = req.body;

      if (!action) {
        return res.status(400).json({
          success: false,
          error: 'Action is required for manual mode'
        });
      }

      if (!mqttService.isDeviceConnected()) {
        return res.status(503).json({
          success: false,
          error: `Device ${deviceId} is not connected`
        });
      }

      const result = await mqttService.setManualMode(deviceId, action);

      res.json({
        success: true,
        message: 'Manual mode configuration sent with acknowledgment tracking',
        commandId: result.commandId,
        data: result
      });

      // Notify clients about the configuration change
      socketService.emitToAll('deviceConfigurationSent', {
        deviceId,
        configType: 'Manual',
        commandId: result.commandId,
        action,
        timestamp: new Date().toISOString()
      });

    } catch (error) {
      console.error('Error setting manual mode:', error);
      res.status(500).json({
        success: false,
        error: error.message || 'Internal server error'
      });
    }
  }

  // Set device to Normal mode
  static async setNormalMode(req, res) {
    try {
      const { deviceId } = req.params;
      const config = req.body;

      if (!mqttService.isDeviceConnected()) {
        return res.status(503).json({
          success: false,
          error: `Device ${deviceId} is not connected`
        });
      }

      const result = await mqttService.setNormalMode(deviceId, config);

      res.json({
        success: true,
        message: 'Normal mode configuration sent with acknowledgment tracking',
        commandId: result.commandId,
        data: result
      });

      // Notify clients about the configuration change
      socketService.emitToAll('deviceConfigurationSent', {
        deviceId,
        configType: 'Normal',
        commandId: result.commandId,
        timestamp: new Date().toISOString()
      });

    } catch (error) {
      console.error('Error setting normal mode:', error);
      res.status(500).json({
        success: false,
        error: error.message || 'Internal server error'
      });
    }
  }

  // Set device to DPOL mode
  static async setDpolMode(req, res) {
    try {
      const { deviceId } = req.params;
      const config = req.body;

      if (!mqttService.isDeviceConnected()) {
        return res.status(503).json({
          success: false,
          error: `Device ${deviceId} is not connected`
        });
      }

      const result = await mqttService.setDpolMode(deviceId, config);

      res.json({
        success: true,
        message: 'DPOL mode configuration sent with acknowledgment tracking',
        commandId: result.commandId,
        data: result
      });

      // Notify clients about the configuration change
      socketService.emitToAll('deviceConfigurationSent', {
        deviceId,
        configType: 'DPOL',
        commandId: result.commandId,
        timestamp: new Date().toISOString()
      });

    } catch (error) {
      console.error('Error setting DPOL mode:', error);
      res.status(500).json({
        success: false,
        error: error.message || 'Internal server error'
      });
    }
  }

  // Set device to INST mode
  static async setInstMode(req, res) {
    try {
      const { deviceId } = req.params;
      const config = req.body;

      if (!mqttService.isDeviceConnected()) {
        return res.status(503).json({
          success: false,
          error: `Device ${deviceId} is not connected`
        });
      }

      const result = await mqttService.setInstMode(deviceId, config);

      res.json({
        success: true,
        message: 'INST mode configuration sent with acknowledgment tracking',
        commandId: result.commandId,
        data: result
      });

      // Notify clients about the configuration change
      socketService.emitToAll('deviceConfigurationSent', {
        deviceId,
        configType: 'INST',
        commandId: result.commandId,
        timestamp: new Date().toISOString()
      });

    } catch (error) {
      console.error('Error setting INST mode:', error);
      res.status(500).json({
        success: false,
        error: error.message || 'Internal server error'
      });
    }
  }

  // Set device settings configuration
  static async setSettingsMode(req, res) {
    try {
      const { deviceId } = req.params;
      const config = req.body;

      if (!mqttService.isDeviceConnected()) {
        return res.status(503).json({
          success: false,
          error: `Device ${deviceId} is not connected`
        });
      }

      const result = await mqttService.setSettingsConfiguration(deviceId, config);

      res.json({
        success: true,
        message: 'Settings configuration sent with acknowledgment tracking',
        commandId: result.commandId,
        data: result
      });

      // Notify clients about the configuration change
      socketService.emitToAll('deviceConfigurationSent', {
        deviceId,
        configType: 'settings',
        commandId: result.commandId,
        timestamp: new Date().toISOString()
      });

    } catch (error) {
      console.error('Error setting device settings:', error);
      res.status(500).json({
        success: false,
        error: error.message || 'Internal server error'
      });
    }
  }

  // Create a new device
  static async createDevice(req, res) {
    try {
      const { 
        deviceId, 
        deviceName, 
        location, 
        deviceType,
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
      if (!deviceId || !deviceName) {
        return res.status(400).json({ 
          success: false,
          error: 'deviceId and deviceName are required' 
        });
      }
      
      // Check if device already exists
      const existingDevice = await Device.findOne({ deviceId });
      if (existingDevice) {
        return res.status(409).json({ 
          success: false,
          error: `Device with ID ${deviceId} already exists` 
        });
      }
      
      // Create new device
      const newDevice = await Device.create({
        deviceId,
        deviceName,
        location: location || 'Unknown Location',
        mqtt: {
          brokerUrl: mqttBroker || process.env.MQTT_BROKER_URL,
          topicPrefix: topicPrefix || `devices/${deviceId}`,
          topics: {
            data: dataTopic || `devices/${deviceId}/data`,
            status: statusTopic || `devices/${deviceId}/status`,
            control: commandTopic || `devices/${deviceId}/commands`
          },
          credentials: {
            username: mqttUsername || process.env.MQTT_USERNAME,
            password: mqttPassword || process.env.MQTT_PASSWORD
          }
        },
        sensors: {
          battery: 0,
          signal: 0,
          temperature: 0
        },
        status: {
          state: 'offline',
          lastSeen: null
        },
        metadata: {
          icon: icon || 'bi-device',
          color: color || '#6c757d',
          description: description || '',
          deviceType: deviceType || 'IoT Sensor'
        }
      });
      
      console.log('✅ Created new device:', {
        deviceId: newDevice.deviceId,
        name: newDevice.deviceName,
        mqttBroker: newDevice.mqtt.brokerUrl,
        topics: newDevice.mqtt.topics
      });
      
      res.status(201).json({
        success: true,
        message: 'Device created successfully',
        device: {
          deviceId: newDevice.deviceId,
          name: newDevice.deviceName,
          location: newDevice.location,
          status: newDevice.status.state,
          route: `/devices/${newDevice.deviceId}`,
          mqtt: {
            brokerUrl: newDevice.mqtt.brokerUrl,
            topics: newDevice.mqtt.topics
          }
        }
      });
    } catch (error) {
      console.error('❌ Error creating device:', error);
      res.status(500).json({
        success: false,
        error: 'Failed to create device',
        message: error.message
      });
    }
  }

  // Health check endpoint
  static async getHealth(req, res) {
    try {
      const deviceData = mqttService.getDeviceData();
      const connectionStatus = mqttService.getConnectionStatus();

      res.json({
        status: 'ok',
        timestamp: new Date().toISOString(),
        device: deviceData.device ? 'connected' : 'no-data',
        connectionStatus: connectionStatus.device,
        user: req.user ? req.user.username : 'anonymous'
      });
    } catch (error) {
      console.error('Error getting health:', error);
      res.status(500).json({
        status: 'error',
        error: 'Internal server error'
      });
    }
  }

  // Get device settings/configuration
  static async getDeviceSettings(req, res) {
    try {
      const { deviceId } = req.params;

      const device = await Device.findOne({ deviceId })
        .select('deviceId deviceName configuration')
        .lean();

      if (!device) {
        return res.status(404).json({
          success: false,
          error: 'Device not found',
          message: `Device with ID ${deviceId} does not exist`
        });
      }

      res.json({
        success: true,
        deviceId: device.deviceId,
        deviceName: device.deviceName,
        configuration: device.configuration || {
          deviceSettings: {},
          lastUpdated: null,
          updatedBy: null
        }
      });
    } catch (error) {
      console.error('Error fetching device settings:', error);
      res.status(500).json({
        success: false,
        error: 'Internal server error',
        message: error.message
      });
    }
  }

  // Set logging interval for device
  static async setLoggingInterval(req, res) {
    try {
      const { deviceId } = req.params;
      const { commandType, parameters } = req.body;

      // Validate input
      if (!parameters || typeof parameters.interval !== 'number') {
        return res.status(400).json({
          success: false,
          error: 'Bad request',
          message: 'Logging interval (in seconds) is required'
        });
      }

      // Find device
      const device = await Device.findOne({ deviceId });
      if (!device) {
        return res.status(404).json({
          success: false,
          error: 'Device not found',
          message: `Device with ID ${deviceId} does not exist`
        });
      }

      console.log(`📤 [MQTT] Setting logging interval via complete settings frame for device ${deviceId}`);
      
      // Ensure both logging_interval and logging_interval_format are set
      let loggingInterval = parameters.logging_interval || parameters.interval;
      let loggingIntervalFormat = parameters.logging_interval_format;
      
      // If only numeric interval is provided, convert to hh:mm:ss
      if (typeof loggingInterval === 'number' && !loggingIntervalFormat) {
        loggingIntervalFormat = secondsToHHMMSS(loggingInterval);
        console.log(`🔄 Converted logging_interval ${loggingInterval}s to ${loggingIntervalFormat}`);
      }
      
      // If only hh:mm:ss format is provided, convert to seconds
      if (typeof loggingIntervalFormat === 'string' && typeof loggingInterval !== 'number') {
        loggingInterval = hhmmssToSeconds(loggingIntervalFormat);
        console.log(`🔄 Converted logging_interval_format ${loggingIntervalFormat} to ${loggingInterval}s`);
      }
      
      // Use the proper MQTT service method to send complete settings frame
      try {
        // Use logging_interval_format (hh:mm:ss) for the configuration
        const config = {
          loggingInterval: {
            value: loggingIntervalFormat || "00:30:00",
            enabled: true
          }
        };
        
        // This will send the complete settings frame with logging_interval and logging_interval_format
        const result = await mqttService.setLoggingConfiguration(device._id, config);
        console.log(`✅ [MQTT] Complete settings frame sent successfully to ${deviceId}`);
        
        // Update device configuration in database
        const updateData = {
          $set: {
            'configuration.loggingInterval': {
              logging_interval: loggingInterval,
              logging_interval_format: loggingIntervalFormat,
              description: parameters.description,
              lastUpdated: new Date(),
              updatedBy: req.user ? req.user.username : 'system'
            },
            'configuration.lastUpdated': new Date(),
            'configuration.updatedBy': req.user ? req.user.username : 'system'
          }
        };

        await Device.updateOne({ deviceId }, updateData);

        res.json({
          success: true,
          message: 'Logging interval updated successfully - complete settings frame sent',
          data: {
            deviceId,
            logging_interval: loggingInterval,
            logging_interval_format: loggingIntervalFormat,
            description: parameters.description,
            storedInDatabase: true,
            completeSettingsFrameSent: true,
            timestamp: new Date().toISOString()
          }
        });

      } catch (mqttError) {
        console.error(`❌ [MQTT] Failed to send complete settings frame:`, mqttError);
        
        // Still try to update database even if MQTT fails
        const updateData = {
          $set: {
            'configuration.loggingInterval': {
              logging_interval: loggingInterval,
              logging_interval_format: loggingIntervalFormat,
              description: parameters.description,
              lastUpdated: new Date(),
              updatedBy: req.user ? req.user.username : 'system'
            },
            'configuration.lastUpdated': new Date(),
            'configuration.updatedBy': req.user ? req.user.username : 'system'
          }
        };

        await Device.updateOne({ deviceId }, updateData);

        res.status(500).json({
          success: false,
          error: 'MQTT communication failed',
          message: 'Settings saved to database but could not send to device',
          data: {
            deviceId,
            storedInDatabase: true,
            completeSettingsFrameSent: false
          }
        });
      }

    } catch (error) {
      console.error('Error setting logging interval:', error);
      res.status(500).json({
        success: false,
        error: 'Internal server error',
        message: error.message
      });
    }
  }

  // Get device settings/configuration
  static async getDeviceSettings(req, res) {
    try {
      const { deviceId } = req.params;
      console.log(`📖 Getting settings for device ${deviceId}`);

      // Get device settings from MQTT service memory
      const settings = mqttService.getDeviceSettings(deviceId);

      if (!settings) {
        console.log(`❌ No settings found for device ${deviceId}`);
        return res.json({
          success: true,
          data: {
            deviceId,
            parameters: {},
            message: 'No settings configured for this device'
          }
        });
      }

      console.log(`✅ Found settings for device ${deviceId}:`, {
        'Shunt Voltage': settings['Shunt Voltage'],
        'Shunt Current': settings['Shunt Current'],
        totalParams: Object.keys(settings).length
      });

      res.json({
        success: true,
        data: {
          deviceId,
          parameters: settings,
          lastUpdated: new Date().toISOString()
        }
      });

    } catch (error) {
      console.error('Error getting device settings:', error);
      res.status(500).json({
        success: false,
        error: 'Internal server error',
        message: error.message
      });
    }
  }

  // Get event mappings for frontend use
  static async getEventMappings(req, res) {
    try {
      const eventMappings = mqttService.getEventMappings();
      
      res.json({
        success: true,
        data: {
          eventMappings: eventMappings,
          description: 'Event/Mode code to name mappings',
          usage: 'Use these mappings to display readable event names in the frontend'
        }
      });

    } catch (error) {
      console.error('Error getting event mappings:', error);
      res.status(500).json({
        success: false,
        error: 'Internal server error',
        message: error.message
      });
    }
  }

  // Get device parameters by device name for alarm creation
  static async getDeviceParametersByName(req, res) {
    try {
      const { deviceName } = req.params;

      // Find device by name
      const device = await Device.findOne({ 
        $or: [
          { deviceName: deviceName },
          { deviceId: deviceName }
        ] 
      }).lean();

      if (!device) {
        return res.status(404).json({
          success: false,
          message: 'Device not found',
          data: null
        });
      }

      // Extract device parameters
      const deviceParams = {
        deviceId: device.deviceId,
        deviceName: device.deviceName || device.deviceId,
        location: device.location || 'N/A',
        status: device.status?.state || 'offline',
        device_params: {
          ref_1: device.configuration?.deviceSettings?.referenceFail || 0,
          ref_2: device.configuration?.deviceSettings?.referenceUP || 0,
          ref_3: device.configuration?.deviceSettings?.referenceOP || 0,
          dcv: device.sensors?.voltage || 0, // DC Voltage from sensors
          dci: device.sensors?.current || 0, // DC Current from sensors
          acv: device.sensors?.acVoltage || 0  // AC Voltage from sensors
        },
        sensors: device.sensors || {},
        configuration: device.configuration?.deviceSettings || {}
      };

      res.json({
        success: true,
        data: deviceParams
      });
    } catch (error) {
      console.error('Error fetching device parameters:', error);
      res.status(500).json({
        success: false,
        message: 'Error fetching device parameters',
        error: error.message
      });
    }
  }
}

module.exports = DeviceController;