const mqtt = require('mqtt');
const { deviceBroker } = require('../config/mqtt');
const { transformDeviceData, createThrottledEmit } = require('../utils/dataTransform');
const { v4: uuidv4 } = require('uuid');
const Device = require('../models/Device');

class MQTTService {
  constructor() {
    this.client = null;
    this.throttledEmit = null;
    this.socketIO = null;
    this.deviceData = { device: null };
    this.lastDeviceTimestamp = 0;
    this.connectionStatus = { device: false };
    
    // Device activity tracking - keep connected for 15 seconds after last message
    // Device sends every 5 seconds, so 15 seconds = 3x the interval (allows 2 missed messages)
    this.deviceLastActivity = new Map(); // deviceId -> timestamp
    this.DEVICE_TIMEOUT = 15000; // 15 seconds
    
    // Memory-based acknowledgment tracking
    this.pendingCommands = new Map(); // commandId -> command details
    this.acknowledgmentTimeouts = new Map(); // commandId -> timeout handler
    this.commandHistory = []; // Array of completed commands (limited size)
    this.maxHistorySize = 100; // Keep last 100 commands
    
    // Store current device settings per deviceId
    this.deviceSettings = new Map(); // deviceId -> settings object
    
    // Device Management Service Integration
    this.deviceManagementService = null;
  }

  initialize(io) {
    this.throttledEmit = createThrottledEmit(io, this);
    this.socketIO = io;
    this.client = mqtt.connect(deviceBroker.url, deviceBroker.options);
    this.setupEventHandlers(io);
    
    // Start periodic connection status broadcaster (every 5 seconds to match device data rate)
    setInterval(() => {
      if (this.socketIO) {
        const connectionStatus = this.getConnectionStatus();
        this.socketIO.emit('connectionStatus', connectionStatus);
      }
    }, 5000); // Changed from 2000ms to 5000ms
    
    // Initialize device management service
    try {
      this.deviceManagementService = require('./deviceManagementService');
      console.log('✅ Device Management Service integrated with MQTT');
    } catch (error) {
      console.warn('⚠️ Device Management Service not available:', error.message);
    }
  }

  setupEventHandlers(io) {
    this.client.on('connect', () => {
      this.connectionStatus.device = true;
      console.log('✅ Connected to MQTT broker (broker.zeptac.com)');
      console.log('📡 MQTT Configuration:', {
        broker: deviceBroker.url,
        clientId: deviceBroker.options.clientId,
        username: deviceBroker.options.username
      });
      
      // Subscribe to all device data topics using wildcard
      this.client.subscribe('devices/+/data', { qos: 0 }, err => {
        if (!err) {
          console.log(`📥 Subscribed to all device data topics: devices/+/data`);
        } else {
          console.error('❌ Data topic subscription error:', err);
        }
      });

      // Subscribe to all device commands topics (for acknowledgments)
      this.client.subscribe('devices/+/commands', { qos: 1 }, err => {
        if (!err) {
          console.log(`📥 Subscribed to all device commands topics: devices/+/commands`);
          console.log('🔔 Waiting for MQTT messages from all devices...');
        } else {
          console.error('❌ Commands topic subscription error:', err);
        }
      });
    });

    this.client.on('message', async (topic, message) => {
      // Extract device ID from topic (e.g., 'devices/123/data' -> '123')
      const topicParts = topic.split('/');
      const deviceId = topicParts[1] || 'unknown';
      const topicType = topicParts[2] || 'unknown';
      
      console.log(`\n🔥 DEVICE ${deviceId.toUpperCase()} MESSAGE RECEIVED:`);
      console.log('📍 Topic:', topic);
      console.log('📄 Raw Message:', message.toString());
      console.log('📏 Message Length:', message.length);
      console.log('⏰ Timestamp:', new Date().toISOString());
      
      try {
        const payload = JSON.parse(message.toString());
        console.log('✅ Parsed JSON Payload:', JSON.stringify(payload, null, 2));
        
        // Handle different topic types
        if (topicType === 'data') {
          console.log(`📈 Data message received from device ${deviceId} - processing telemetry`);
          
          // Track device activity - mark as active
          this.deviceLastActivity.set(deviceId, Date.now());
          this.connectionStatus.device = true; // Mark MQTT broker connection as active
          
          const deviceInfo = transformDeviceData(payload, topic);
          console.log('🔄 Transformed Device Info:', JSON.stringify(deviceInfo, null, 2));
          
          this.deviceData.device = deviceInfo;
          this.lastDeviceTimestamp = Date.now();
          this.throttledEmit(deviceInfo);
          
          // Update device status in MongoDB
          await this.updateDeviceStatus(deviceId, payload);
          
          // Save telemetry data to database
          await this.saveTelemetryData(deviceId, payload);
          
          console.log('💾 Updated device data and notified frontend');
        } else if (topicType === 'commands') {
          console.log(`📋 Commands message received from device ${deviceId} - checking for acknowledgments`);
          
          // Track device activity for command acknowledgments too
          this.deviceLastActivity.set(deviceId, Date.now());
          
          this.handleCommandMessage(payload);
        }
        
        console.log(''); // Add spacing
      } catch (err) {
        console.error('❌ Error parsing device message:', err);
        console.error('📄 Original message:', message.toString());
        console.error('🔍 Error details:', err.message);
      }
    });

    let reconnectAttempts = 0;
    const MAX_RECONNECT_LOGS = 3; // Only log first 3 reconnect attempts

    this.client.on('close', () => {
      // Don't set connectionStatus to false - rely on device activity timeout instead
      if (reconnectAttempts < MAX_RECONNECT_LOGS) {
        console.log('⚠️ MQTT broker connection closed, will auto-reconnect...');
      }
    });

    this.client.on('error', err => {
      // Don't set connectionStatus to false - rely on device activity timeout instead
      if (reconnectAttempts < MAX_RECONNECT_LOGS) {
        console.error('❌ MQTT client error:', err.message || err);
      }
    });

    this.client.on('offline', () => {
      if (reconnectAttempts < MAX_RECONNECT_LOGS) {
        console.log('📱 MQTT client is offline, reconnecting...');
      }
    });

    this.client.on('reconnect', () => {
      reconnectAttempts++;
      if (reconnectAttempts <= MAX_RECONNECT_LOGS) {
        console.log(`🔄 MQTT reconnection attempt ${reconnectAttempts}...`);
      }
    });
    
    this.client.on('connect', () => {
      // Reset reconnect counter on successful connection
      reconnectAttempts = 0;
    });
  }

  publishMessage(messagePayload, callback) {
    this.client.publish(deviceBroker.commandTopic, JSON.stringify(messagePayload), { qos: 1 }, callback);
  }

  // Send device configuration WITH memory-based acknowledgment tracking
  async sendDeviceConfigurationWithAck(deviceId, configType, configData, timeout = 30000) {
    const commandId = uuidv4();
    
    // Use the complete payload format requested by user
    const payload = {
      "Device ID": deviceId,
      "Message Type": configType.toLowerCase(),
      "sender": "Server",
      "CommandId": commandId,  // Keep for tracking
      "Parameters": configData
    };

    console.log(`📤 Sending ${configType} command to device ${deviceId} with ACK tracking:`, JSON.stringify(payload, null, 2));
    
    // Store command in memory
    const commandRecord = {
      commandId,
      deviceId,
      originalCommand: configType,
      commandPayload: configData,
      status: 'PENDING',
      sentAt: new Date(),
      timeout,
      acknowledgedAt: null,
      deviceResponse: null,
      responseTime: null
    };
    
    this.pendingCommands.set(commandId, commandRecord);

    // Set up timeout handler
    const timeoutHandler = setTimeout(() => {
      const pendingCommand = this.pendingCommands.get(commandId);
      
      if (pendingCommand && pendingCommand.status === 'PENDING') {
        pendingCommand.status = 'TIMEOUT';
        pendingCommand.acknowledgedAt = new Date();
        
        // Move to history
        this.addToHistory(pendingCommand);
        this.pendingCommands.delete(commandId);
        
        console.log(`⏰ Command ${commandId} timed out after ${timeout}ms`);
        
        // Notify frontend of timeout
        this.socketIO?.emit('deviceCommandTimeout', {
          commandId,
          deviceId,
          command: configType,
          message: 'Device did not respond within timeout period'
        });
      }
      
      this.acknowledgmentTimeouts.delete(commandId);
    }, timeout);

    this.acknowledgmentTimeouts.set(commandId, timeoutHandler);

    // Publish the command
    return new Promise((resolve, reject) => {
      this.client.publish('devices/123/commands', JSON.stringify(payload), { qos: 1 }, (error) => {
        if (error) {
          console.error('❌ Failed to send command:', error);
          // Clean up on send failure
          this.acknowledgmentTimeouts.delete(commandId);
          clearTimeout(timeoutHandler);
          this.pendingCommands.delete(commandId);
          reject(error);
        } else {
          console.log(`✅ Command sent successfully: ${configType}, waiting for ACK...`);
          
          // Notify frontend that command was sent
          this.socketIO?.emit('deviceCommandSent', {
            commandId,
            deviceId,
            command: configType,
            sentAt: new Date(),
            status: 'PENDING'
          });
          
          resolve({ 
            success: true, 
            command: configType, 
            commandId,
            status: 'PENDING',
            message: 'Command sent, waiting for device acknowledgment'
          });
        }
      });
    });
  }

  // Handle command messages from devices (including acknowledgments)
  handleCommandMessage(payload) {
    try {
      const { CommandId, status, message, error, response } = payload;

      console.log(`🔔 Processing command message:`, JSON.stringify(payload, null, 2));

      // Check if this is an acknowledgment (has CommandId)
      if (CommandId) {
        this.handleAcknowledgment(CommandId, payload);
      } else {
        console.log('📋 Regular command message (not an acknowledgment)');
      }
    } catch (error) {
      console.error('Error handling command message:', error);
    }
  }

  // Handle acknowledgment responses
  handleAcknowledgment(commandId, payload) {
    const { status, message, error, response } = payload;

    console.log(`🔔 Processing ACK for command ${commandId}`);

    // Find the pending command
    const pendingCommand = this.pendingCommands.get(commandId);

    if (!pendingCommand) {
      console.warn(`⚠️ No pending command found for CommandId ${commandId}`);
      return;
    }

    // Clear timeout
    const timeoutHandler = this.acknowledgmentTimeouts.get(commandId);
    if (timeoutHandler) {
      clearTimeout(timeoutHandler);
      this.acknowledgmentTimeouts.delete(commandId);
    }

    // Update command record
    pendingCommand.status = status === 'SUCCESS' || status === 'OK' ? 'SUCCESS' : 'FAILED';
    pendingCommand.acknowledgedAt = new Date();
    pendingCommand.responseTime = pendingCommand.acknowledgedAt.getTime() - pendingCommand.sentAt.getTime();
    pendingCommand.deviceResponse = {
      status,
      message: message || 'No message provided',
      error: error || null,
      response: response || null,
      fullPayload: payload
    };

    console.log(`✅ Command ${commandId} acknowledged with status: ${pendingCommand.status}`);
    console.log(`⏱️ Response time: ${pendingCommand.responseTime}ms`);

    // Move to history and remove from pending
    this.addToHistory(pendingCommand);
    this.pendingCommands.delete(commandId);

    // Notify frontend
    this.socketIO?.emit('deviceCommandAcknowledged', {
      commandId,
      deviceId: pendingCommand.deviceId,
      command: pendingCommand.originalCommand,
      status: pendingCommand.status,
      responseTime: pendingCommand.responseTime,
      deviceResponse: pendingCommand.deviceResponse,
      acknowledgedAt: pendingCommand.acknowledgedAt
    });
  }

  // Add command to history (with size limit)
  addToHistory(commandRecord) {
    this.commandHistory.unshift(commandRecord);
    
    // Keep only the last maxHistorySize commands
    if (this.commandHistory.length > this.maxHistorySize) {
      this.commandHistory = this.commandHistory.slice(0, this.maxHistorySize);
    }
  }

  // Get command status (pending or from history)
  getCommandStatus(commandId) {
    // Check pending commands first
    const pendingCommand = this.pendingCommands.get(commandId);
    if (pendingCommand) {
      return pendingCommand;
    }

    // Check history
    return this.commandHistory.find(cmd => cmd.commandId === commandId) || null;
  }

  // Get all commands for a device
  getDeviceCommands(deviceId, status = null) {
    const allCommands = [
      ...Array.from(this.pendingCommands.values()),
      ...this.commandHistory
    ];

    let deviceCommands = allCommands.filter(cmd => cmd.deviceId === deviceId);

    if (status) {
      deviceCommands = deviceCommands.filter(cmd => cmd.status === status);
    }

    // Sort by sentAt descending (newest first)
    return deviceCommands.sort((a, b) => b.sentAt.getTime() - a.sentAt.getTime());
  }

  // Get pending commands for a device
  getPendingCommands(deviceId) {
    return Array.from(this.pendingCommands.values())
      .filter(cmd => cmd.deviceId === deviceId);
  }

  // Get command statistics
  getCommandStatistics(deviceId, fromDate = null) {
    const allCommands = [
      ...Array.from(this.pendingCommands.values()),
      ...this.commandHistory
    ];

    let deviceCommands = allCommands.filter(cmd => cmd.deviceId === deviceId);

    if (fromDate) {
      deviceCommands = deviceCommands.filter(cmd => cmd.sentAt >= fromDate);
    }

    const stats = {
      total: deviceCommands.length,
      pending: deviceCommands.filter(cmd => cmd.status === 'PENDING').length,
      success: deviceCommands.filter(cmd => cmd.status === 'SUCCESS').length,
      failed: deviceCommands.filter(cmd => cmd.status === 'FAILED').length,
      timeout: deviceCommands.filter(cmd => cmd.status === 'TIMEOUT').length,
      avgResponseTime: 0,
      successRate: 0
    };

    // Calculate average response time for completed commands
    const completedCommands = deviceCommands.filter(cmd => 
      cmd.responseTime && cmd.responseTime > 0
    );

    if (completedCommands.length > 0) {
      stats.avgResponseTime = Math.round(
        completedCommands.reduce((sum, cmd) => sum + cmd.responseTime, 0) / completedCommands.length
      );
    }

    // Calculate success rate
    if (stats.total > 0) {
      stats.successRate = Math.round((stats.success / stats.total) * 100);
    }

    return stats;
  }

  // Start cleanup process for expired acknowledgments
  startAcknowledgmentCleanup() {
    setInterval(async () => {
      try {
        const expiredAcks = await DeviceAcknowledgment.find({
          status: 'PENDING',
          sentAt: { $lt: new Date(Date.now() - 60000) } // 1 minute old
        });

        for (const ack of expiredAcks) {
          if (ack.isTimedOut()) {
            await ack.markAsTimeout();
            console.log(`🧹 Marked command ${ack.commandId} as timed out during cleanup`);
          }
        }
      } catch (error) {
        console.error('Error during acknowledgment cleanup:', error);
      }
    }, 30000); // Run every 30 seconds
  }

  // Get acknowledgment status for a command
  async getAcknowledgmentStatus(commandId) {
    return await DeviceAcknowledgment.findOne({ commandId });
  }

  // Get device acknowledgment statistics
  async getDeviceAckStats(deviceId, fromDate) {
    return await DeviceAcknowledgment.getStats(deviceId, fromDate);
  }

  // Handle status messages
  handleStatusMessage(payload) {
    if (payload.status === 'offline') {
      console.log('⚠️ Device 123 went offline');
    } else if (payload.status === 'online') {
      console.log('✅ Device 123 came online');
    }
    
    // Emit status update to frontend
    if (this.throttledEmit) {
      this.throttledEmit({ type: 'status', data: payload });
    }
  }

  // Get default device settings
  getDefaultDeviceSettings() {
    return {
      "Electrode": 0,
      "Shunt Voltage": 25,
      "Shunt Current": 999,
      "Reference Fail": 30,
      "Reference UP": 300,
      "Reference OV": 60,
      "Interrupt ON Time": 100,
      "Interrupt OFF Time": 100,
      "Interrupt Start TimeStamp": "2025-02-20 19:04:00",
      "Interrupt Stop TimeStamp": "2025-02-20 19:05:00",
      "DPOL Interval": "00:00:00",
      "Depolarization Start TimeStamp": "2025-02-20 19:04:00",
      "Depolarization Stop TimeStamp": "2025-02-20 19:05:00",
      "Instant Mode": 0,
      "Instant Start TimeStamp": "19:04:00",
      "Instant End TimeStamp": "00:00:00"
    };
  }

  // Initialize device settings if not exists
  ensureDeviceSettings(deviceId) {
    if (!this.deviceSettings.has(deviceId)) {
      this.deviceSettings.set(deviceId, this.getDefaultDeviceSettings());
    }
    return this.deviceSettings.get(deviceId);
  }

  // Specific configuration methods - ALL now send complete settings payload
  async setInterruptMode(deviceId, config) {
    console.log('🔧 Setting interrupt mode configuration - will send complete settings...');
    
    // Get current settings and update interrupt-related fields
    const currentSettings = this.ensureDeviceSettings(deviceId);
    
    // Ensure timestamps include seconds (HH:MM:SS format)
    const startTime = config.startTime.includes(':') && config.startTime.split(':').length === 2 
      ? `${config.startTime}:00` 
      : config.startTime;
    const stopTime = config.stopTime.includes(':') && config.stopTime.split(':').length === 2 
      ? `${config.stopTime}:00` 
      : config.stopTime;
    
    const updatedSettings = {
      ...currentSettings,
      "Event": 1, // Interrupt mode
      "Interrupt Start TimeStamp": `${config.startDate} ${startTime}`,
      "Interrupt Stop TimeStamp": `${config.stopDate} ${stopTime}`,
      "Interrupt ON Time": parseInt(config.onTime),
      "Interrupt OFF Time": parseInt(config.offTime)
    };
    
    // Store updated settings
    this.deviceSettings.set(deviceId, updatedSettings);

    // Create commandId and track then send complete payload
    const commandId = uuidv4();
    const changed = {
      "Event": 1,
      "Interrupt Start TimeStamp": updatedSettings["Interrupt Start TimeStamp"],
      "Interrupt Stop TimeStamp": updatedSettings["Interrupt Stop TimeStamp"],
      "Interrupt ON Time": updatedSettings["Interrupt ON Time"],
      "Interrupt OFF Time": updatedSettings["Interrupt OFF Time"]
    };
    if (this.deviceManagementService) {
      try { await this.deviceManagementService.trackCommand(deviceId, commandId, 'complete_settings', changed); } catch (e) { /* ignore */ }
    }
    return await this.sendCompleteSettingsPayload(deviceId, commandId);
  }

  async setManualMode(deviceId, action) {
    console.log(`🔧 Setting manual mode action: ${action} - will send complete settings with latest timers...`);
    
    // Get current settings and update manual mode related fields
    const currentSettings = this.ensureDeviceSettings(deviceId);
    
    // Get the latest settings from database to include any timer updates
    let latestTimers = {};
    if (this.deviceManagementService) {
      try {
        const dbSettings = await this.deviceManagementService.getDeviceSettings(deviceId);
        if (dbSettings && dbSettings.Parameters) {
          latestTimers = {
            "Interrupt ON Time": dbSettings.Parameters["Interrupt ON Time"] || currentSettings["Interrupt ON Time"] || 0,
            "Interrupt OFF Time": dbSettings.Parameters["Interrupt OFF Time"] || currentSettings["Interrupt OFF Time"] || 0,
          };
          console.log('📊 Retrieved latest timer values from DB:', latestTimers);
        }
      } catch (e) {
        console.warn('⚠️ Could not get latest timers from DB, using memory:', e.message);
      }
    }
    
    const updatedSettings = {
      ...currentSettings,
      ...latestTimers, // Include latest timer values
      "Event": 2, // Manual mode
      "Manual Mode Action": action,
      "Instant Mode": action === 'start' ? 1 : 0
    };
    
    // Store updated settings
    this.deviceSettings.set(deviceId, updatedSettings);

    // Create commandId and track then send complete payload
    const commandId = uuidv4();
    const changedManual = {
      "Event": 2,
      "Manual Mode Action": action,
      "Instant Mode": updatedSettings["Instant Mode"],
      ...latestTimers // Include timer changes in tracking
    };
    if (this.deviceManagementService) {
      try { await this.deviceManagementService.trackCommand(deviceId, commandId, 'complete_settings', changedManual); } catch (e) { /* ignore */ }
    }
    return await this.sendCompleteSettingsPayload(deviceId, commandId);
  }

  async setNormalMode(deviceId, config = {}) {
    console.log('🔧 Setting normal mode configuration - will send complete settings...');
    
    // Get current settings and update normal mode fields
    const currentSettings = this.ensureDeviceSettings(deviceId);
    const updatedSettings = {
      ...currentSettings,
      "Event": 0, // Normal mode
      ...config,
      "Instant Mode": 0
    };
    
    // Store updated settings
    this.deviceSettings.set(deviceId, updatedSettings);

    // Create commandId and track then send complete payload
    const commandId = uuidv4();
    const changedNormal = {
      "Event": 0,
      "Instant Mode": 0,
      ...config
    };
    if (this.deviceManagementService) {
      try { await this.deviceManagementService.trackCommand(deviceId, commandId, 'complete_settings', changedNormal); } catch (e) { /* ignore */ }
    }
    return await this.sendCompleteSettingsPayload(deviceId, commandId);
  }

  async setDpolMode(deviceId, config) {
    console.log('🔧 Setting DPOL mode configuration - will send complete settings...');
    
    // Get current settings and update DPOL-related fields
    const currentSettings = this.ensureDeviceSettings(deviceId);
    
    // Ensure timestamps include seconds (HH:MM:SS format)
    const startTime = config.startTime && config.startTime.includes(':') && config.startTime.split(':').length === 2 
      ? `${config.startTime}:00` 
      : config.startTime;
    const endTime = config.endTime && config.endTime.includes(':') && config.endTime.split(':').length === 2 
      ? `${config.endTime}:00` 
      : config.endTime;
    
    const updatedSettings = {
      ...currentSettings,
      "Event": 3, // DPOL mode
      "Depolarization Start TimeStamp": `${config.startDate} ${startTime}`,
      "Depolarization Stop TimeStamp": `${config.endDate} ${endTime}`,
      "DPOL Interval": config.interval || "00:00:00"
    };
    
    // Store updated settings
    this.deviceSettings.set(deviceId, updatedSettings);

    // Create commandId and track then send complete payload
    const commandId = uuidv4();
    const changedDpol = {
      "Event": 3,
      "Depolarization Start TimeStamp": updatedSettings["Depolarization Start TimeStamp"],
      "Depolarization Stop TimeStamp": updatedSettings["Depolarization Stop TimeStamp"],
      "DPOL Interval": updatedSettings["DPOL Interval"]
    };
    if (this.deviceManagementService) {
      try { await this.deviceManagementService.trackCommand(deviceId, commandId, 'complete_settings', changedDpol); } catch (e) { /* ignore */ }
    }
    return await this.sendCompleteSettingsPayload(deviceId, commandId);
  }

  async setInstMode(deviceId, config) {
    console.log('🔧 Setting INST mode configuration - will send complete settings...');
    console.log('📥 Received config:', JSON.stringify(config, null, 2));
    
    // Get current settings and update instant mode fields
    const currentSettings = this.ensureDeviceSettings(deviceId);
    
    // Map frequency (daily/weekly) to Instant Mode value (0=daily, 1=weekly)
    const instantModeValue = config.frequency === 'weekly' ? 1 : 0;
    console.log(`🔄 Mapping frequency "${config.frequency}" to Instant Mode value: ${instantModeValue}`);
    
    // Validate and log the received times
    console.log('📍 Instant Start TimeStamp received:', config.startTime);
    console.log('📍 Instant End TimeStamp received:', config.endTime);
    
    const updatedSettings = {
      ...currentSettings,
      "Event": 4, // Instant mode
      "Instant Mode": instantModeValue,
      "Instant Start TimeStamp": config.startTime || "00:00:00",
      "Instant End TimeStamp": config.endTime || "00:00:00"
    };
    
    console.log('💾 Storing in memory - Instant Start TimeStamp:', updatedSettings["Instant Start TimeStamp"]);
    console.log('💾 Storing in memory - Instant End TimeStamp:', updatedSettings["Instant End TimeStamp"]);
    
    // Store updated settings in memory
    this.deviceSettings.set(deviceId, updatedSettings);

    // Update in database via device management service
    if (this.deviceManagementService) {
      try {
        const dbParams = {
          "Instant Mode": instantModeValue,
          "Event": 4,
          "Instant Start TimeStamp": config.startTime || "00:00:00",
          "Instant End TimeStamp": config.endTime || "00:00:00"
        };
        console.log('💿 Updating database with:', JSON.stringify(dbParams, null, 2));
        await this.deviceManagementService.updateDeviceParameters(deviceId, dbParams);
        console.log('✅ Updated Instant Mode in database');
      } catch (error) {
        console.warn('⚠️ Could not update database:', error.message);
      }
    }

    // Create commandId and track then send complete payload
    const commandId = uuidv4();
    const changedInst = {
      "Event": 4,
      "Instant Mode": instantModeValue,
      "Instant Start TimeStamp": updatedSettings["Instant Start TimeStamp"],
      "Instant End TimeStamp": updatedSettings["Instant End TimeStamp"]
    };
    if (this.deviceManagementService) {
      try { await this.deviceManagementService.trackCommand(deviceId, commandId, 'complete_settings', changedInst); } catch (e) { /* ignore */ }
    }
    return await this.sendCompleteSettingsPayload(deviceId, commandId);
  }

  async setTimerConfiguration(deviceId, timerConfig) {
    console.log('🔧 Setting timer configuration - will send complete settings...');
    
    // Get current settings and update timer fields
    const currentSettings = this.ensureDeviceSettings(deviceId);
    const updatedSettings = {
      ...currentSettings,
      "Interrupt ON Time": timerConfig.ton || currentSettings["Interrupt ON Time"],
      "Interrupt OFF Time": timerConfig.toff || currentSettings["Interrupt OFF Time"]
    };
    
    // Store updated settings
    this.deviceSettings.set(deviceId, updatedSettings);

    // Create commandId and track then send complete payload
    const commandId = uuidv4();
    const changedTimer = {
      "Interrupt ON Time": updatedSettings["Interrupt ON Time"],
      "Interrupt OFF Time": updatedSettings["Interrupt OFF Time"]
    };
    if (this.deviceManagementService) {
      try { await this.deviceManagementService.trackCommand(deviceId, commandId, 'complete_settings', changedTimer); } catch (e) { /* ignore */ }
    }
    return await this.sendCompleteSettingsPayload(deviceId, commandId);
  }

  async setElectrodeConfiguration(deviceId, electrodeType) {
    console.log('🔧 Setting electrode configuration - will send complete settings...');
    
    // Get current settings and update electrode field
    const currentSettings = this.ensureDeviceSettings(deviceId);
    const updatedSettings = {
      ...currentSettings,
      "Electrode": electrodeType
    };
    
    // Store updated settings
    this.deviceSettings.set(deviceId, updatedSettings);

    // Create commandId and track then send complete payload
    const commandId = uuidv4();
    const changedElectrode = { "Electrode": electrodeType };
    if (this.deviceManagementService) {
      try { await this.deviceManagementService.trackCommand(deviceId, commandId, 'complete_settings', changedElectrode); } catch (e) { /* ignore */ }
    }
    return await this.sendCompleteSettingsPayload(deviceId, commandId);
  }

  async setAlarmConfiguration(deviceId, alarmConfig) {
    console.log('🔧 Setting alarm configuration - will send complete settings...');
    
    // Get current settings and update alarm fields
    const currentSettings = this.ensureDeviceSettings(deviceId);
    const updatedSettings = {
      ...currentSettings,
      "Reference Fail": alarmConfig.referenceFail || alarmConfig["Reference Fail"] || currentSettings["Reference Fail"],
      "Reference UP": alarmConfig.referenceUP || alarmConfig["Reference UP"] || currentSettings["Reference UP"],
      "Reference OV": alarmConfig.referenceOV || alarmConfig["Reference OV"] || currentSettings["Reference OV"],
      "Shunt Voltage": alarmConfig.shuntVoltage || alarmConfig["Shunt Voltage"] || currentSettings["Shunt Voltage"],
      "Shunt Current": alarmConfig.shuntCurrent || alarmConfig["Shunt Current"] || currentSettings["Shunt Current"]
    };
    
    // Store updated settings
    this.deviceSettings.set(deviceId, updatedSettings);

    // Send complete settings payload with tracking
    const changedFields = {};
    Object.keys(alarmConfig).forEach(key => {
      const mappedKey = key === 'referenceFail' ? 'Reference Fail' : 
                       key === 'referenceUP' ? 'Reference UP' :
                       key === 'referenceOV' ? 'Reference OV' :
                       key === 'shuntVoltage' ? 'Shunt Voltage' :
                       key === 'shuntCurrent' ? 'Shunt Current' : key;
      changedFields[mappedKey] = updatedSettings[mappedKey];
    });

    const commandId = uuidv4();
    if (this.deviceManagementService) {
      try { await this.deviceManagementService.trackCommand(deviceId, commandId, 'complete_settings', changedFields); } catch (e) { /* ignore */ }
    }
    return await this.sendCompleteSettingsPayload(deviceId, commandId);
  }

  // Send complete settings payload - this is the main method used by all configuration changes
  // Value mappings - Convert display values to integer codes for device compatibility
  mapValueToCode(fieldName, value) {
    // Skip if value is already a number
    if (typeof value === 'number') return value;
    
    const mappings = {
      'Electrode': {
        'Cu/cuso4': 0,
        'CuCuSO4': 0,
        'Zinc': 1,
        'Ag/AgCl': 2,
        'AgAgSO4': 2,
        'Custom': 3
      },
      'Event': {
        'Normal': 0,
        'Interrupt': 1,
        'Manual': 2,
        'DEPOL': 3,
        'DPOL': 3,
        'Instant': 4,
        'INST': 4
      },
      'Manual Mode Action': {
        'off': 1,
        'stop': 1,
        'On': 0,
        'start': 0
      },
      'Instant Mode': {
        'Daily': 0,
        'daily': 0,
        'Weekly': 1,
        'weekly': 1,
        0: 0,
        1: 1
      }
    };

    if (mappings[fieldName] && mappings[fieldName][value] !== undefined) {
      console.log(`🔄 Mapped ${fieldName}: "${value}" → ${mappings[fieldName][value]}`);
      return mappings[fieldName][value];
    }
    
    return value; // Return original if no mapping exists
  }

  // Apply value mappings to entire payload Parameters object
  applyValueMappings(parameters) {
    const mapped = { ...parameters };
    
    // Apply mappings to specific fields
    if (mapped['Electrode'] !== undefined) {
      mapped['Electrode'] = this.mapValueToCode('Electrode', mapped['Electrode']);
    }
    if (mapped['Event'] !== undefined) {
      mapped['Event'] = this.mapValueToCode('Event', mapped['Event']);
    }
    if (mapped['Manual Mode Action'] !== undefined) {
      mapped['Manual Mode Action'] = this.mapValueToCode('Manual Mode Action', mapped['Manual Mode Action']);
    }
    if (mapped['Instant Mode'] !== undefined) {
      mapped['Instant Mode'] = this.mapValueToCode('Instant Mode', mapped['Instant Mode']);
    }
    
    return mapped;
  }

  async sendCompleteSettingsPayload(deviceId, commandId = null, timeout = 30000) {
    try {
      // CRITICAL FIX: deviceId parameter is MongoDB _id, need to get actual device.deviceId for MQTT topic
      let actualDeviceId = deviceId;
      let device = null;
      
      try {
        device = await Device.findById(deviceId);
        if (device && device.deviceId) {
          actualDeviceId = device.deviceId;
          console.log(`🔍 Resolved MongoDB _id "${deviceId}" to actual deviceId "${actualDeviceId}" for MQTT topic`);
        } else {
          console.warn(`⚠️ Device with _id "${deviceId}" not found or missing deviceId field, using _id as fallback`);
        }
      } catch (error) {
        console.warn(`⚠️ Could not fetch device for _id "${deviceId}": ${error.message}, using _id as fallback`);
      }
      
      // CRITICAL FIX: Always use memory-based settings to avoid stale database reads
      // Memory is updated immediately before this function is called
      let payload = this.createSettingsPayloadFromMemory(deviceId, commandId);
      console.log(`📤 Using MEMORY-based settings (most up-to-date) for device ${actualDeviceId}`);

      // Update payload to use actual deviceId
      if (payload && payload["Device ID"]) {
        payload["Device ID"] = actualDeviceId;
      }

      // 🔄 CRITICAL: Apply value mappings to convert display values to integer codes
      if (payload && payload.Parameters) {
        payload.Parameters = this.applyValueMappings(payload.Parameters);
        console.log(`✅ Value mappings applied to payload Parameters`);
      }

      console.log(`📦 Complete settings payload:`, JSON.stringify(payload, null, 2));

      // Store command in memory for acknowledgment tracking
      const commandRecord = {
        commandId,
        deviceId,
        actualDeviceId, // Store both for tracking
        originalCommand: 'settings',
        commandPayload: payload,
        status: 'PENDING',
        sentAt: new Date(),
        timeout,
        acknowledgedAt: null,
        deviceResponse: null,
        responseTime: null
      };

      this.pendingCommands.set(commandId, commandRecord);

      // Set up timeout handler
      const timeoutHandler = setTimeout(() => {
        const pendingCommand = this.pendingCommands.get(commandId);

        if (pendingCommand && pendingCommand.status === 'PENDING') {
          pendingCommand.status = 'TIMEOUT';
          pendingCommand.acknowledgedAt = new Date();

          // Move to history
          this.addToHistory(pendingCommand);
          this.pendingCommands.delete(commandId);

          console.log(`⏰ Command ${commandId} timed out after ${timeout}ms`);

          // Notify frontend of timeout
          this.socketIO?.emit('deviceCommandTimeout', {
            commandId,
            deviceId,
            command: 'settings',
            message: 'Device did not respond within timeout period'
          });
        }

        this.acknowledgmentTimeouts.delete(commandId);
      }, timeout);

      this.acknowledgmentTimeouts.set(commandId, timeoutHandler);

      // Publish the complete settings payload using ACTUAL deviceId for MQTT topic
      return new Promise((resolve, reject) => {
        const topic = `devices/${actualDeviceId}/commands`;
        this.client.publish(topic, JSON.stringify(payload), { qos: 1 }, async (error) => {
          if (error) {
            console.error('❌ Failed to send complete settings command:', error);
            // Clean up on send failure
            this.acknowledgmentTimeouts.delete(commandId);
            clearTimeout(timeoutHandler);
            this.pendingCommands.delete(commandId);
            reject(error);
          } else {
            console.log(`✅ Complete settings command sent successfully to topic: ${topic}`);

            // Save settings to database
            if (payload && payload.Parameters) {
              await this.saveDeviceSettings(actualDeviceId, payload.Parameters, 'user');
            }

            // Track command in device management service if available
            if (this.deviceManagementService) {
              try {
                await this.deviceManagementService.trackCommand(
                  deviceId, 
                  commandId, 
                  'complete_settings', 
                  payload.Parameters
                );
              } catch (error) {
                console.warn('⚠️ Could not track command in device management service:', error.message);
              }
            }

            // Notify frontend that command was sent
            this.socketIO?.emit('deviceCommandSent', {
              commandId,
              deviceId,
              command: 'settings',
              sentAt: new Date(),
              status: 'PENDING',
              topic
            });

            resolve({
              success: true,
              command: 'settings',
              commandId,
              status: 'PENDING',
              message: 'Complete settings sent, waiting for device acknowledgment',
              topic
            });
          }
        });
      });

    } catch (error) {
      console.error('❌ Error in sendCompleteSettingsPayload:', error);
      throw error;
    }
  }

  // Helper method to create settings payload from memory (fallback)
  createSettingsPayloadFromMemory(deviceId, commandId) {
    const currentSettings = this.ensureDeviceSettings(deviceId);
    
    if (!commandId) {
      commandId = uuidv4();
    }

    return {
      "Device ID": deviceId,
      "Message Type": "settings",
      "sender": "Server", 
      "CommandId": commandId,
      "Parameters": currentSettings
    };
  }

  async setSettingsConfiguration(deviceId, settingsConfig, commandId = null) {
    try {
      console.log('🔧 Setting device settings configuration - will send complete settings...');
      
      // Use device management service to update settings if available
      if (this.deviceManagementService) {
        try {
          // Update device parameters in database
          await this.deviceManagementService.updateDeviceParameters(
            deviceId, 
            settingsConfig, 
            commandId
          );
          
          // Send complete settings payload from database
          return await this.sendCompleteSettingsPayload(deviceId, commandId);
          
        } catch (error) {
          console.warn(`⚠️ Device management service error: ${error.message}, falling back to memory`);
          // Fall back to memory-based approach
        }
      }
      
      // Fallback: Update memory-based settings and send
      const currentSettings = this.ensureDeviceSettings(deviceId);
      
      // Convert input settings to the proper parameter format
      const newSettings = {
        "Electrode": settingsConfig.Electrode !== undefined ? settingsConfig.Electrode : (settingsConfig.electrode !== undefined ? settingsConfig.electrode : currentSettings["Electrode"]),
        "Shunt Voltage": settingsConfig["Shunt Voltage"] !== undefined ? settingsConfig["Shunt Voltage"] : (settingsConfig.shuntVoltage !== undefined ? settingsConfig.shuntVoltage : currentSettings["Shunt Voltage"]),
        "Shunt Current": settingsConfig["Shunt Current"] !== undefined ? settingsConfig["Shunt Current"] : (settingsConfig.shuntCurrent !== undefined ? settingsConfig.shuntCurrent : currentSettings["Shunt Current"]),
        "Reference Fail": settingsConfig["Reference Fail"] !== undefined ? settingsConfig["Reference Fail"] : (settingsConfig.referenceFail !== undefined ? settingsConfig.referenceFail : currentSettings["Reference Fail"]),
        "Reference UP": settingsConfig["Reference UP"] !== undefined ? settingsConfig["Reference UP"] : (settingsConfig.referenceUP !== undefined ? settingsConfig.referenceUP : currentSettings["Reference UP"]),
        "Reference OV": settingsConfig["Reference OV"] !== undefined ? settingsConfig["Reference OV"] : (settingsConfig.referenceOV !== undefined ? settingsConfig.referenceOV : currentSettings["Reference OV"]),
        "Interrupt ON Time": settingsConfig["Interrupt ON Time"] !== undefined ? settingsConfig["Interrupt ON Time"] : (settingsConfig.interruptOnTime !== undefined ? settingsConfig.interruptOnTime : currentSettings["Interrupt ON Time"]),
        "Interrupt OFF Time": settingsConfig["Interrupt OFF Time"] !== undefined ? settingsConfig["Interrupt OFF Time"] : (settingsConfig.interruptOffTime !== undefined ? settingsConfig.interruptOffTime : currentSettings["Interrupt OFF Time"]),
        "Interrupt Start TimeStamp": settingsConfig["Interrupt Start TimeStamp"] !== undefined ? settingsConfig["Interrupt Start TimeStamp"] : (settingsConfig.interruptStartTimestamp !== undefined ? settingsConfig.interruptStartTimestamp : currentSettings["Interrupt Start TimeStamp"]),
        "Interrupt Stop TimeStamp": settingsConfig["Interrupt Stop TimeStamp"] !== undefined ? settingsConfig["Interrupt Stop TimeStamp"] : (settingsConfig.interruptStopTimestamp !== undefined ? settingsConfig.interruptStopTimestamp : currentSettings["Interrupt Stop TimeStamp"]),
        "DPOL Interval": settingsConfig["DPOL Interval"] !== undefined ? settingsConfig["DPOL Interval"] : (settingsConfig.dpolInterval !== undefined ? settingsConfig.dpolInterval : currentSettings["DPOL Interval"]),
        "Depolarization Start TimeStamp": settingsConfig["Depolarization Start TimeStamp"] !== undefined ? settingsConfig["Depolarization Start TimeStamp"] : (settingsConfig.depolarizationStartTimestamp !== undefined ? settingsConfig.depolarizationStartTimestamp : currentSettings["Depolarization Start TimeStamp"]),
        "Depolarization Stop TimeStamp": settingsConfig["Depolarization Stop TimeStamp"] !== undefined ? settingsConfig["Depolarization Stop TimeStamp"] : (settingsConfig.depolarizationStopTimestamp !== undefined ? settingsConfig.depolarizationStopTimestamp : currentSettings["Depolarization Stop TimeStamp"]),
        "Instant Mode": settingsConfig["Instant Mode"] !== undefined ? settingsConfig["Instant Mode"] : (settingsConfig.instantMode !== undefined ? settingsConfig.instantMode : currentSettings["Instant Mode"]),
        "Instant Start TimeStamp": settingsConfig["Instant Start TimeStamp"] !== undefined ? settingsConfig["Instant Start TimeStamp"] : (settingsConfig.instantStartTimestamp !== undefined ? settingsConfig.instantStartTimestamp : currentSettings["Instant Start TimeStamp"]),
        "Instant End TimeStamp": settingsConfig["Instant End TimeStamp"] !== undefined ? settingsConfig["Instant End TimeStamp"] : (settingsConfig.instantEndTimestamp !== undefined ? settingsConfig.instantEndTimestamp : currentSettings["Instant End TimeStamp"])
      };

      // Update memory-based settings storage
      this.deviceSettings.set(deviceId, newSettings);

      console.log(`✅ Updated settings for device ${deviceId} in memory:`, newSettings);

      // Send complete settings to device
      return await this.sendCompleteSettingsPayload(deviceId, commandId);
      
    } catch (error) {
      console.error('❌ Error in setSettingsConfiguration:', error);
      throw error;
    }
  }

  // Helper method to ensure device settings exist
  ensureDeviceSettings(deviceId) {
    if (!this.deviceSettings.has(deviceId)) {
      this.deviceSettings.set(deviceId, {
        "Electrode": 0,
        "Shunt Voltage": 25,
        "Shunt Current": 999,
        "Reference Fail": 30,
        "Reference UP": 300,
        "Reference OV": 60,
        "Interrupt ON Time": 100,
        "Interrupt OFF Time": 100,
        "Interrupt Start TimeStamp": new Date().toISOString().replace('T', ' ').substring(0, 19),
        "Interrupt Stop TimeStamp": new Date().toISOString().replace('T', ' ').substring(0, 19),
        "DPOL Interval": "00:00:00",
        "Depolarization Start TimeStamp": new Date().toISOString().replace('T', ' ').substring(0, 19),
        "Depolarization Stop TimeStamp": new Date().toISOString().replace('T', ' ').substring(0, 19),
        "Instant Mode": 0,
        "Instant Start TimeStamp": "19:04:00",
        "Instant End TimeStamp": "00:00:00"
      });
    }
    return this.deviceSettings.get(deviceId);
  }

  // Helper method to add command to history
  addToHistory(command) {
    this.commandHistory.push(command);
    if (this.commandHistory.length > this.maxHistorySize) {
      this.commandHistory.shift();
    }
  }

  getDeviceData() {
    return this.deviceData;
  }

  // Get current device settings from memory
  getDeviceSettings(deviceId) {
    return this.deviceSettings.get(deviceId) || null;
  }

  // Get all device settings (for debugging/admin purposes)
  getAllDeviceSettings() {
    const allSettings = {};
    this.deviceSettings.forEach((settings, deviceId) => {
      allSettings[deviceId] = settings;
    });
    return allSettings;
  }

  getConnectionStatus() {
    // Only check if we have recent device activity
    // Don't rely on MQTT broker status as it can be unreliable
    const deviceActive = this.isAnyDeviceActive();
    
    return {
      device: deviceActive
    };
  }

  getLastTimestamp() {
    return this.lastDeviceTimestamp;
  }

  isDeviceConnected(deviceId = null) {
    // If checking MQTT broker connection
    if (!deviceId) {
      return this.connectionStatus.device;
    }
    
    // If checking specific device activity
    const lastActivity = this.deviceLastActivity.get(deviceId);
    if (!lastActivity) return false;
    
    const timeSinceActivity = Date.now() - lastActivity;
    return timeSinceActivity < this.DEVICE_TIMEOUT;
  }
  
  // Check if any device is active
  isAnyDeviceActive() {
    const now = Date.now();
    for (const [deviceId, lastActivity] of this.deviceLastActivity.entries()) {
      if (now - lastActivity < this.DEVICE_TIMEOUT) {
        return true;
      }
    }
    return false;
  }

  // Update device status in MongoDB when data is received
  async updateDeviceStatus(deviceId, payload) {
    try {
      const Device = require('../models/Device');
      
      const updateData = {
        'status.state': 'online',
        'status.lastSeen': new Date(),
      };
      
      // Update sensor data if available
      if (payload.DCV !== undefined) updateData['sensors.battery'] = parseFloat(payload.DCV) || 0;
      if (payload.REF1 !== undefined) updateData['sensors.signal'] = Math.abs(parseFloat(payload.REF1) || 0) * 100;
      if (payload.REF2 !== undefined) updateData['sensors.temperature'] = parseFloat(payload.REF2) || 0;
      
      const result = await Device.findOneAndUpdate(
        { deviceId: deviceId },
        { $set: updateData },
        { new: true, upsert: false }
      );
      
      if (result) {
        console.log(`✅ Updated device ${deviceId} status to ONLINE in MongoDB`);
      } else {
        console.warn(`⚠️ Device ${deviceId} not found in MongoDB`);
      }
    } catch (error) {
      console.error(`❌ Error updating device ${deviceId} status:`, error.message);
    }
  }

  async saveTelemetryData(deviceId, payload) {
    try {
      const Telemetry = require('../models/telemetry');
      
      // Extract all data fields from payload
      const dataFields = {};
      Object.keys(payload).forEach(key => {
        // Skip meta fields, keep actual telemetry data
        if (!['Device ID', 'Message Type', 'sender', 'CommandId', 'Parameters'].includes(key)) {
          dataFields[key] = payload[key];
        }
      });

      // Create telemetry record
      const telemetryRecord = new Telemetry({
        deviceId: deviceId,
        timestamp: new Date(),
        event: payload.EVENT || payload.Event || 'NORMAL',
        data: dataFields
      });

      await telemetryRecord.save();
      console.log(`✅ Saved telemetry data for device ${deviceId}`);
      
      // Check if payload contains device settings and save them
      await this.saveDeviceSettings(deviceId, payload, 'system');
      
    } catch (error) {
      console.error(`❌ Error saving telemetry data for device ${deviceId}:`, error.message);
    }
  }

  // Save device settings to database
  async saveDeviceSettings(deviceId, payload, updatedBy = 'system') {
    try {
      // Handle both formats: flat settings or nested under "Parameters"
      let settingsPayload = payload;
      
      // If the payload has "Parameters" object (real device format), use that
      if (payload.Parameters && typeof payload.Parameters === 'object') {
        settingsPayload = payload.Parameters;
        console.log('📦 Using nested Parameters format (real device)');
      } else {
        console.log('📄 Using flat format (simulator)');
      }
      
      // Check if payload contains any settings fields
      const hasSettings = settingsPayload.Electrode !== undefined ||
                         settingsPayload.Event !== undefined ||
                         settingsPayload['Manual Mode Action'] !== undefined ||
                         settingsPayload['Shunt Voltage'] !== undefined ||
                         settingsPayload['Instant Mode'] !== undefined;
      
      if (!hasSettings) {
        return; // No settings in this payload
      }

      const device = await Device.findOne({ deviceId });
      if (!device) {
        console.log(`⚠️ Device ${deviceId} not found, cannot save settings`);
        return;
      }

      // Extract settings from payload (preserve existing if not in payload)
      const currentSettings = device.configuration?.deviceSettings || {};
      const settings = {
        electrode: settingsPayload.Electrode !== undefined ? settingsPayload.Electrode : currentSettings.electrode || 0,
        event: settingsPayload.Event !== undefined ? settingsPayload.Event : currentSettings.event || 0,
        manualModeAction: settingsPayload['Manual Mode Action'] !== undefined ? settingsPayload['Manual Mode Action'] : currentSettings.manualModeAction || 0,
        shuntVoltage: settingsPayload['Shunt Voltage'] !== undefined ? settingsPayload['Shunt Voltage'] : currentSettings.shuntVoltage || 0,
        shuntCurrent: settingsPayload['Shunt Current'] !== undefined ? settingsPayload['Shunt Current'] : currentSettings.shuntCurrent || 0,
        referenceFail: settingsPayload['Reference Fail'] !== undefined ? settingsPayload['Reference Fail'] : currentSettings.referenceFail || 0,
        referenceUP: settingsPayload['Reference UP'] !== undefined ? settingsPayload['Reference UP'] : currentSettings.referenceUP || 0,
        referenceOV: settingsPayload['Reference OV'] !== undefined ? settingsPayload['Reference OV'] : currentSettings.referenceOV || 0,
        interruptOnTime: settingsPayload['Interrupt ON Time'] !== undefined ? settingsPayload['Interrupt ON Time'] : currentSettings.interruptOnTime || 0,
        interruptOffTime: settingsPayload['Interrupt OFF Time'] !== undefined ? settingsPayload['Interrupt OFF Time'] : currentSettings.interruptOffTime || 0,
        interruptStartTimestamp: settingsPayload['Interrupt Start TimeStamp'] !== undefined ? settingsPayload['Interrupt Start TimeStamp'] : currentSettings.interruptStartTimestamp || '',
        interruptStopTimestamp: settingsPayload['Interrupt Stop TimeStamp'] !== undefined ? settingsPayload['Interrupt Stop TimeStamp'] : currentSettings.interruptStopTimestamp || '',
        dpolInterval: settingsPayload['DPOL Interval'] !== undefined ? settingsPayload['DPOL Interval'] : currentSettings.dpolInterval || '00:00:00',
        depolarizationStartTimestamp: settingsPayload['Depolarization Start TimeStamp'] !== undefined ? settingsPayload['Depolarization Start TimeStamp'] : currentSettings.depolarizationStartTimestamp || '',
        depolarizationStopTimestamp: settingsPayload['Depolarization Stop TimeStamp'] !== undefined ? settingsPayload['Depolarization Stop TimeStamp'] : currentSettings.depolarizationStopTimestamp || '',
        instantMode: settingsPayload['Instant Mode'] !== undefined ? settingsPayload['Instant Mode'] : currentSettings.instantMode || 0,
        instantStartTimestamp: settingsPayload['Instant Start TimeStamp'] !== undefined ? settingsPayload['Instant Start TimeStamp'] : currentSettings.instantStartTimestamp || '',
        instantEndTimestamp: settingsPayload['Instant End TimeStamp'] !== undefined ? settingsPayload['Instant End TimeStamp'] : currentSettings.instantEndTimestamp || ''
      };

      // Update device configuration in database
      device.configuration = {
        deviceSettings: settings,
        lastUpdated: new Date(),
        updatedBy: updatedBy
      };

      await device.save();
      console.log(`💾 Saved device settings for device ${deviceId} to DATABASE (updated by: ${updatedBy})`);
      
      // CRITICAL: Also update memory cache with device's current settings
      // This ensures when we send commands, we use device's actual current state as baseline
      const memorySettings = {
        "Electrode": settingsPayload.Electrode !== undefined ? settingsPayload.Electrode : currentSettings.electrode || 0,
        "Event": settingsPayload.Event !== undefined ? settingsPayload.Event : currentSettings.event || 0,
        "Manual Mode Action": settingsPayload['Manual Mode Action'] !== undefined ? settingsPayload['Manual Mode Action'] : currentSettings.manualModeAction || 0,
        "Shunt Voltage": settingsPayload['Shunt Voltage'] !== undefined ? settingsPayload['Shunt Voltage'] : currentSettings.shuntVoltage || 25,
        "Shunt Current": settingsPayload['Shunt Current'] !== undefined ? settingsPayload['Shunt Current'] : currentSettings.shuntCurrent || 999,
        "Reference Fail": settingsPayload['Reference Fail'] !== undefined ? settingsPayload['Reference Fail'] : currentSettings.referenceFail || 30,
        "Reference UP": settingsPayload['Reference UP'] !== undefined ? settingsPayload['Reference UP'] : currentSettings.referenceUP || 300,
        "Reference OV": settingsPayload['Reference OV'] !== undefined ? settingsPayload['Reference OV'] : currentSettings.referenceOV || 60,
        "Interrupt ON Time": settingsPayload['Interrupt ON Time'] !== undefined ? settingsPayload['Interrupt ON Time'] : currentSettings.interruptOnTime || 100,
        "Interrupt OFF Time": settingsPayload['Interrupt OFF Time'] !== undefined ? settingsPayload['Interrupt OFF Time'] : currentSettings.interruptOffTime || 100,
        "Interrupt Start TimeStamp": settingsPayload['Interrupt Start TimeStamp'] !== undefined ? settingsPayload['Interrupt Start TimeStamp'] : currentSettings.interruptStartTimestamp || new Date().toISOString().replace('T', ' ').substring(0, 19),
        "Interrupt Stop TimeStamp": settingsPayload['Interrupt Stop TimeStamp'] !== undefined ? settingsPayload['Interrupt Stop TimeStamp'] : currentSettings.interruptStopTimestamp || new Date().toISOString().replace('T', ' ').substring(0, 19),
        "DPOL Interval": settingsPayload['DPOL Interval'] !== undefined ? settingsPayload['DPOL Interval'] : currentSettings.dpolInterval || "00:00:00",
        "Depolarization Start TimeStamp": settingsPayload['Depolarization Start TimeStamp'] !== undefined ? settingsPayload['Depolarization Start TimeStamp'] : currentSettings.depolarizationStartTimestamp || new Date().toISOString().replace('T', ' ').substring(0, 19),
        "Depolarization Stop TimeStamp": settingsPayload['Depolarization Stop TimeStamp'] !== undefined ? settingsPayload['Depolarization Stop TimeStamp'] : currentSettings.depolarizationStopTimestamp || new Date().toISOString().replace('T', ' ').substring(0, 19),
        "Instant Mode": settingsPayload['Instant Mode'] !== undefined ? settingsPayload['Instant Mode'] : currentSettings.instantMode || 0,
        "Instant Start TimeStamp": settingsPayload['Instant Start TimeStamp'] !== undefined ? settingsPayload['Instant Start TimeStamp'] : currentSettings.instantStartTimestamp || "19:04:00",
        "Instant End TimeStamp": settingsPayload['Instant End TimeStamp'] !== undefined ? settingsPayload['Instant End TimeStamp'] : currentSettings.instantEndTimestamp || "00:00:00"
      };
      
      this.deviceSettings.set(deviceId, memorySettings);
      console.log(`🧠 Updated MEMORY cache for device ${deviceId} with device's current settings`);
      console.log(`📋 Memory Settings:`, JSON.stringify(memorySettings, null, 2));
      
      // Emit real-time settings update to frontend
      if (this.socketIO) {
        this.socketIO.to(deviceId).emit('deviceSettingsUpdate', {
          deviceId,
          settings: memorySettings,
          timestamp: new Date().toISOString(),
          updatedBy
        });
        console.log(`📡 Emitted deviceSettingsUpdate to room: ${deviceId}`);
      }
    } catch (error) {
      console.error(`❌ Error saving device settings for device ${deviceId}:`, error.message);
    }
  }

  /**
   * Merge and save device settings from user/API updates
   * This function:
   * 1. Retrieves current settings from database
   * 2. Merges new settings with existing ones (preserves unchanged fields)
   * 3. Saves to database with tracking info
   * 4. Returns complete merged settings
   */
  async mergeAndSaveDeviceSettings(deviceId, newSettings, updatedBy = 'user') {
    try {
      const Device = require('../models/Device');
      
      console.log(`🔄 Merging settings for device ${deviceId}`);
      console.log(`📥 New settings from ${updatedBy}:`, JSON.stringify(newSettings, null, 2));

      // Find or create device
      let device = await Device.findOne({ deviceId });
      
      if (!device) {
        console.log(`⚠️ Device ${deviceId} not found, creating new device with settings`);
        device = new Device({
          deviceId,
          deviceName: `Device ${deviceId}`,
          configuration: {
            deviceSettings: {},
            lastUpdated: new Date(),
            updatedBy: updatedBy
          }
        });
      }

      // Get current settings
      const currentSettings = device.configuration?.deviceSettings || {};
      console.log(`📋 Current settings:`, JSON.stringify(currentSettings, null, 2));

      // Merge: new settings override current, but preserve existing fields
      const mergedSettings = {
        // Preserve all existing settings
        ...currentSettings,
        // Override with new settings (only the fields provided)
        ...newSettings
      };

      console.log(`✅ Merged settings:`, JSON.stringify(mergedSettings, null, 2));

      // Update device
      device.configuration = {
        deviceSettings: mergedSettings,
        lastUpdated: new Date(),
        updatedBy: updatedBy
      };

      await device.save();
      console.log(`💾 Saved merged settings for device ${deviceId} (updated by: ${updatedBy})`);
      
      return {
        success: true,
        deviceId,
        mergedSettings,
        lastUpdated: device.configuration.lastUpdated,
        updatedBy: updatedBy,
        message: `Settings merged and saved successfully for device ${deviceId}`
      };

    } catch (error) {
      console.error(`❌ Error merging settings for device ${deviceId}:`, error.message);
      throw error;
    }
  }

  /**
   * Get current device settings from database
   */
  async getDeviceSettingsFromDB(deviceId) {
    try {
      const Device = require('../models/Device');
      const device = await Device.findOne({ deviceId });
      
      if (!device) {
        throw new Error(`Device ${deviceId} not found`);
      }

      const settings = device.configuration?.deviceSettings || {};
      
      return {
        success: true,
        deviceId,
        settings,
        lastUpdated: device.configuration?.lastUpdated,
        updatedBy: device.configuration?.updatedBy
      };

    } catch (error) {
      console.error(`❌ Error getting settings for device ${deviceId}:`, error.message);
      throw error;
    }
  }

  disconnect() {
    if (this.client) {
      this.client.end(true);
    }
  }
}

// Export singleton instance
const mqttService = new MQTTService();
module.exports = mqttService;