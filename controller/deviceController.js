const mqttService = require('../services/mqttService');
const socketService = require('../services/socketService');
const Device = require('../models/Device');
const DeviceHistory = require('../models/DeviceHistory');

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
      const deviceData = {
        deviceId: device.deviceId,
        name: device.deviceName || device.deviceId,
        location: device.location || 'N/A',
        status: device.status?.state || 'offline',
        lastSeen: device.status?.lastSeen || null,
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
      const transformedDevices = devices.map(device => ({
        deviceId: device.deviceId,
        name: device.deviceName || device.deviceId,
        location: device.location || 'N/A',
        status: device.status?.state || 'offline',
        lastSeen: device.status?.lastSeen || null,
        currentData: device.sensors || {},
        mqttTopic: device.mqtt?.topics?.data || `devices/${device.deviceId}/data`,
        icon: device.metadata?.icon || null,
        color: device.metadata?.color || null,
        description: device.metadata?.description || null,
        configuration: device.configuration || null
      }));

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
}

module.exports = DeviceController;