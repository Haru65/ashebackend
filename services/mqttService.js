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
          
          // DEVICE SETTINGS EXTRACTION: Extract and store the 18 device parameters if present
          await this.extractAndStoreDeviceSettings(deviceId, payload);
          
          // Update device status in MongoDB
          // await this.updateDeviceStatus(deviceId, payload); // COMMENTED OUT - causing timestamp override
          
          // Save telemetry data to database  
          // await this.saveTelemetryData(deviceId, payload); // COMMENTED OUT - causing timestamp override
          
          // ISSUE: These methods were overriding the device timestamps with current server time
          // The device sends specific timestamps like "Interrupt Start TimeStamp": "2025-12-10 15:45:55"
          // But these methods were replacing them with new Date(), causing continuous timestamp changes
          
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
      "SET mV": 0, // Voltage setting in millivolts
      "Set Shunt": 0, // Current setting in Amperes (not mA)
      "Shunt Voltage": 25,
      "Shunt Current": 999,
      "Reference Fail": 30,
      "Reference UP": 300,
      "Reference OV": 60,
      // Digital inputs that were missing from frame
      "DI1": 0,
      "DI2": 0,
      "DI3": 0,
      "DI4": 0,
      "Interrupt ON Time": 86400,
      "Interrupt OFF Time": 86400,
      "Interrupt Start TimeStamp": "2025-02-20 19:04:00",
      "Interrupt Stop TimeStamp": "2025-02-20 19:05:00",
      "Depolarization Start TimeStamp": "2025-02-20 19:04:00",
      "Depolarization Stop TimeStamp": "2025-02-20 19:05:00",
      "Instant Mode": 0,
      "Instant Start TimeStamp": "19:04:00",
      "Instant End TimeStamp": "00:00:00",
      "Logging Interval": "00:00:10" // Default 10 seconds logging
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
    
    // CRITICAL FIX: Ensure proper time resolution (convert to seconds if needed)
    // The test report indicates 10 sec saves as 1 sec, so we need proper conversion
    const onTimeSeconds = parseInt(config.onTime) || 0;
    const offTimeSeconds = parseInt(config.offTime) || 0;
    
    console.log(`🕐 Time resolution fix: ON=${onTimeSeconds}s, OFF=${offTimeSeconds}s`);
    
    const updatedSettings = {
      ...currentSettings,
      "Event": 1, // Interrupt mode
      "Interrupt Start TimeStamp": `${config.startDate} ${startTime}`,
      "Interrupt Stop TimeStamp": `${config.stopDate} ${stopTime}`,
      "Interrupt ON Time": onTimeSeconds,
      "Interrupt OFF Time": offTimeSeconds
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
      "Depolarization Stop TimeStamp": `${config.endDate} ${endTime}`
    };
    
    // Store updated settings
    this.deviceSettings.set(deviceId, updatedSettings);

    // Create commandId and track then send complete payload
    const commandId = uuidv4();
    const changedDpol = {
      "Event": 3,
      "Depolarization Start TimeStamp": updatedSettings["Depolarization Start TimeStamp"],
      "Depolarization Stop TimeStamp": updatedSettings["Depolarization Stop TimeStamp"]
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
    
    const updatedSettings = {
      ...currentSettings,
      "Event": 4, // Instant mode
      "Instant Mode": instantModeValue,
      "Instant Start TimeStamp": config.startTime || "00:00:00"
    };
    
    console.log('💾 Storing in memory - Instant Start TimeStamp:', updatedSettings["Instant Start TimeStamp"]);
    
    // Store updated settings in memory
    this.deviceSettings.set(deviceId, updatedSettings);

    // Update in database via device management service
    if (this.deviceManagementService) {
      try {
        const dbParams = {
          "Instant Mode": instantModeValue,
          "Event": 4,
          "Instant Start TimeStamp": config.startTime || "00:00:00"
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
      "Instant Start TimeStamp": updatedSettings["Instant Start TimeStamp"]
    };
    if (this.deviceManagementService) {
      try { await this.deviceManagementService.trackCommand(deviceId, commandId, 'complete_settings', changedInst); } catch (e) { /* ignore */ }
    }
    return await this.sendCompleteSettingsPayload(deviceId, commandId);
  }

  async setTimerConfiguration(deviceId, timerConfig) {
    console.log('🔧 Setting timer configuration - will send complete settings...');
    
    // CRITICAL FIX: Ensure proper time resolution (values should be in seconds)
    const onTimeSeconds = parseInt(timerConfig.ton) || 0;
    const offTimeSeconds = parseInt(timerConfig.toff) || 0;
    
    console.log(`🕐 Timer resolution fix: TON=${onTimeSeconds}s, TOFF=${offTimeSeconds}s`);
    
    // Get current settings and update timer fields
    const currentSettings = this.ensureDeviceSettings(deviceId);
    const updatedSettings = {
      ...currentSettings,
      "Interrupt ON Time": onTimeSeconds,
      "Interrupt OFF Time": offTimeSeconds
    };
    
    // Store updated settings
    this.deviceSettings.set(deviceId, updatedSettings);

    // Create commandId and track then send complete payload
    const commandId = uuidv4();
    const changedTimer = {
      "Interrupt ON Time": onTimeSeconds,
      "Interrupt OFF Time": offTimeSeconds
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
    console.log('📥 Received alarm config:', JSON.stringify(alarmConfig, null, 2));
    
    // Get current settings and update alarm fields
    const currentSettings = this.ensureDeviceSettings(deviceId);
    const updatedSettings = {
      ...currentSettings,
      // Handle old reference parameter names
      "Reference Fail": alarmConfig.referenceFail || alarmConfig["Reference Fail"] || currentSettings["Reference Fail"],
      "Reference UP": alarmConfig.referenceUP || alarmConfig["Reference UP"] || currentSettings["Reference UP"],
      "Reference OV": alarmConfig.referenceOV || alarmConfig["Reference OV"] || currentSettings["Reference OV"],
      "Shunt Voltage": alarmConfig.shuntVoltage || alarmConfig["Shunt Voltage"] || currentSettings["Shunt Voltage"],
      "Shunt Current": alarmConfig.shuntCurrent || alarmConfig["Shunt Current"] || currentSettings["Shunt Current"],
      // Handle new alarm set values (setup, setop, reffcal) with nested object structure
      "Set UP": (() => {
        console.log(`🔧 Set UP: input type=${typeof alarmConfig.setup}, value=`, alarmConfig.setup);
        
        // Handle nested object format: { value: 0.05, enabled: true }
        let inputValue = null;
        if (alarmConfig.setup && typeof alarmConfig.setup === 'object' && alarmConfig.setup.value !== undefined) {
          inputValue = alarmConfig.setup.value;
          console.log(`🔧 Set UP: extracted from object - value=${inputValue}, enabled=${alarmConfig.setup.enabled}`);
        } else if (alarmConfig.setup !== null && alarmConfig.setup !== undefined && typeof alarmConfig.setup !== 'object') {
          inputValue = alarmConfig.setup;
          console.log(`🔧 Set UP: direct value=${inputValue}`);
        }
        
        if (inputValue !== null && inputValue !== undefined && inputValue !== "") {
          const value = parseFloat(inputValue);
          console.log(`🔧 Set UP: parsing "${inputValue}" → ${value}`);
          return isNaN(value) ? currentSettings["Set UP"] : value;
        }
        
        console.log(`🔧 Set UP: keeping current value=${currentSettings["Set UP"]}`);
        return currentSettings["Set UP"];
      })(),
      "Set OP": (() => {
        console.log(`🔧 Set OP: input type=${typeof alarmConfig.setop}, value=`, alarmConfig.setop);
        
        // Handle nested object format: { value: X, enabled: true }
        let inputValue = null;
        if (alarmConfig.setop && typeof alarmConfig.setop === 'object' && alarmConfig.setop.value !== undefined) {
          inputValue = alarmConfig.setop.value;
          console.log(`🔧 Set OP: extracted from object - value=${inputValue}, enabled=${alarmConfig.setop.enabled}`);
        } else if (alarmConfig.setop !== null && alarmConfig.setop !== undefined && typeof alarmConfig.setop !== 'object') {
          inputValue = alarmConfig.setop;
          console.log(`🔧 Set OP: direct value=${inputValue}`);
        }
        
        if (inputValue !== null && inputValue !== undefined && inputValue !== "") {
          const value = parseFloat(inputValue);
          console.log(`🔧 Set OP: parsing "${inputValue}" → ${value}`);
          return isNaN(value) ? currentSettings["Set OP"] : value;
        }
        
        console.log(`🔧 Set OP: keeping current value=${currentSettings["Set OP"]}`);
        return currentSettings["Set OP"];
      })(),
      "Ref Fcal": (() => {
        console.log(`🔧 Ref Fcal: input type=${typeof alarmConfig.reffcal}, value=`, alarmConfig.reffcal);
        
        // Handle nested object format: { value: X, enabled: true }
        let inputValue = null;
        if (alarmConfig.reffcal && typeof alarmConfig.reffcal === 'object' && alarmConfig.reffcal.value !== undefined) {
          inputValue = alarmConfig.reffcal.value;
          console.log(`🔧 Ref Fcal: extracted from object - value=${inputValue}, enabled=${alarmConfig.reffcal.enabled}`);
        } else if (alarmConfig.reffcal !== null && alarmConfig.reffcal !== undefined && typeof alarmConfig.reffcal !== 'object') {
          inputValue = alarmConfig.reffcal;
          console.log(`🔧 Ref Fcal: direct value=${inputValue}`);
        }
        
        if (inputValue !== null && inputValue !== undefined && inputValue !== "") {
          const value = parseFloat(inputValue);
          console.log(`🔧 Ref Fcal: parsing "${inputValue}" → ${value}`);
          return isNaN(value) ? currentSettings["Ref Fcal"] : value;
        }
        
        console.log(`🔧 Ref Fcal: keeping current value=${currentSettings["Ref Fcal"]}`);
        return currentSettings["Ref Fcal"];
      })()
    };
    
    // Validate voltage ranges for Set UP, Set OP, Ref Fcal (-4.00V to +4.00V)
    if (updatedSettings["Set UP"] < -4.00 || updatedSettings["Set UP"] > 4.00) {
      throw new Error('Set UP voltage must be between -4.00V and +4.00V');
    }
    if (updatedSettings["Set OP"] < -4.00 || updatedSettings["Set OP"] > 4.00) {
      throw new Error('Set OP voltage must be between -4.00V and +4.00V');
    }
    if (updatedSettings["Ref Fcal"] < -4.00 || updatedSettings["Ref Fcal"] > 4.00) {
      throw new Error('Ref Fcal voltage must be between -4.00V and +4.00V');
    }
    
    console.log('💾 Updated settings:', JSON.stringify(updatedSettings, null, 2));
    
    // Store updated settings
    this.deviceSettings.set(deviceId, updatedSettings);

    // Send complete settings payload with tracking
    const changedFields = {};
    Object.keys(alarmConfig).forEach(key => {
      const mappedKey = key === 'referenceFail' ? 'Reference Fail' : 
                       key === 'referenceUP' ? 'Reference UP' :
                       key === 'referenceOV' ? 'Reference OV' :
                       key === 'shuntVoltage' ? 'Shunt Voltage' :
                       key === 'shuntCurrent' ? 'Shunt Current' :
                       key === 'setup' ? 'Set UP' :
                       key === 'setop' ? 'Set OP' :
                       key === 'reffcal' ? 'Ref Fcal' : key;
      changedFields[mappedKey] = updatedSettings[mappedKey];
    });

    const commandId = uuidv4();
    if (this.deviceManagementService) {
      try { await this.deviceManagementService.trackCommand(deviceId, commandId, 'complete_settings', changedFields); } catch (e) { /* ignore */ }
    }
    return await this.sendCompleteSettingsPayload(deviceId, commandId);
  }

  // Configure SET mV (voltage setting in millivolts)
  async setVoltageConfiguration(deviceId, config) {
    console.log('🔧 Setting voltage configuration - will send complete settings...');
    
    // Get current settings and update voltage field
    const currentSettings = this.ensureDeviceSettings(deviceId);
    const updatedSettings = {
      ...currentSettings,
      "SET mV": config.voltage || 0
    };
    
    // Store updated settings
    this.deviceSettings.set(deviceId, updatedSettings);

    // Create commandId and track then send complete payload
    const commandId = uuidv4();
    const changedVoltage = { "SET mV": updatedSettings["SET mV"] };
    if (this.deviceManagementService) {
      try { await this.deviceManagementService.trackCommand(deviceId, commandId, 'complete_settings', changedVoltage); } catch (e) { /* ignore */ }
    }
    return await this.sendCompleteSettingsPayload(deviceId, commandId);
  }

  // Configure Set Shunt (current setting in Amperes)
  async setShuntConfiguration(deviceId, config) {
    console.log('🔧 Setting shunt configuration - will send complete settings...');
    
    // Get current settings and update shunt field
    const currentSettings = this.ensureDeviceSettings(deviceId);
    const updatedSettings = {
      ...currentSettings,
      "Set Shunt": config.current || 0
    };
    
    // Store updated settings
    this.deviceSettings.set(deviceId, updatedSettings);

    // Create commandId and track then send complete payload
    const commandId = uuidv4();
    const changedShunt = { "Set Shunt": updatedSettings["Set Shunt"] };
    if (this.deviceManagementService) {
      try { await this.deviceManagementService.trackCommand(deviceId, commandId, 'complete_settings', changedShunt); } catch (e) { /* ignore */ }
    }
    return await this.sendCompleteSettingsPayload(deviceId, commandId);
  }

  // Configure logging interval
  async setLoggingConfiguration(deviceId, config) {
    console.log('🔧 Setting logging configuration - will send complete settings...');
    console.log('📥 Received logging config:', JSON.stringify(config, null, 2));
    
    // Get current settings and update interval fields
    const currentSettings = this.ensureDeviceSettings(deviceId);
    
    // Handle nested object format for logging interval
    const { interval, intervalFormatted } = (() => {
      console.log(`🔧 Logging: input type=${typeof config.loggingInterval}, value=`, config.loggingInterval);
      
      // Handle nested object format: { value: "00:01:30", enabled: true }
      let inputValue = null;
      if (config.loggingInterval && typeof config.loggingInterval === 'object' && config.loggingInterval.value !== undefined) {
        inputValue = config.loggingInterval.value;
        console.log(`🔧 Logging: extracted from object - value="${inputValue}", enabled=${config.loggingInterval.enabled}`);
      } else if (config.loggingInterval !== null && config.loggingInterval !== undefined && typeof config.loggingInterval !== 'object') {
        inputValue = config.loggingInterval;
        console.log(`🔧 Logging: direct value="${inputValue}"`);
      }
      
      if (inputValue !== null && inputValue !== undefined && inputValue !== "") {
        console.log(`🔧 Logging: using "${inputValue}"`);
        // Parse HH:MM:SS to seconds
        const timeParts = inputValue.split(':');
        const seconds = parseInt(timeParts[0]) * 3600 + parseInt(timeParts[1]) * 60 + parseInt(timeParts[2]);
        return { interval: seconds, intervalFormatted: inputValue };
      }
      
      console.log(`🔧 Logging: keeping current values - interval=${currentSettings["interval"]}, intervalFormatted="${currentSettings["intervalFormatted"]}"`);
      return { 
        interval: currentSettings["interval"] || 1800, 
        intervalFormatted: currentSettings["intervalFormatted"] || "00:30:00" 
      };
    })();
    
    const updatedSettings = {
      ...currentSettings,
      "interval": interval,
      "intervalFormatted": intervalFormatted
    };
    
    console.log('💾 Updated logging settings:', JSON.stringify(updatedSettings, null, 2));
    
    // Store updated settings
    this.deviceSettings.set(deviceId, updatedSettings);

    // Create commandId and track then send complete payload
    const commandId = uuidv4();
    const changedLogging = { "interval": updatedSettings["interval"], "intervalFormatted": updatedSettings["intervalFormatted"] };
    if (this.deviceManagementService) {
      try { await this.deviceManagementService.trackCommand(deviceId, commandId, 'complete_settings', changedLogging); } catch (e) { /* ignore */ }
    }
    return await this.sendCompleteSettingsPayload(deviceId, commandId);
  }

  // Configure Set UP (alarm set value - range: -4.00V to +4.00V)
  async setAlarmSetUP(deviceId, config) {
    console.log('🔧 Setting Set UP alarm configuration - will send complete settings...');
    
    // Validate voltage range (-4.00V to +4.00V)
    const voltage = parseFloat(config.setUP || 0);
    if (voltage < -4.00 || voltage > 4.00) {
      throw new Error('Set UP voltage must be between -4.00V and +4.00V');
    }
    
    // Get current settings and update Set UP field
    const currentSettings = this.ensureDeviceSettings(deviceId);
    const updatedSettings = {
      ...currentSettings,
      "Set UP": voltage
    };
    
    // Store updated settings
    this.deviceSettings.set(deviceId, updatedSettings);

    // Create commandId and track then send complete payload
    const commandId = uuidv4();
    const changedSetUP = { "Set UP": voltage };
    if (this.deviceManagementService) {
      try { await this.deviceManagementService.trackCommand(deviceId, commandId, 'complete_settings', changedSetUP); } catch (e) { /* ignore */ }
    }
    return await this.sendCompleteSettingsPayload(deviceId, commandId);
  }

  // Configure Set OP (alarm set value - range: -4.00V to +4.00V)
  async setAlarmSetOP(deviceId, config) {
    console.log('🔧 Setting Set OP alarm configuration - will send complete settings...');
    
    // Validate voltage range (-4.00V to +4.00V)
    const voltage = parseFloat(config.setOP || 0);
    if (voltage < -4.00 || voltage > 4.00) {
      throw new Error('Set OP voltage must be between -4.00V and +4.00V');
    }
    
    // Get current settings and update Set OP field
    const currentSettings = this.ensureDeviceSettings(deviceId);
    const updatedSettings = {
      ...currentSettings,
      "Set OP": voltage
    };
    
    // Store updated settings
    this.deviceSettings.set(deviceId, updatedSettings);

    // Create commandId and track then send complete payload
    const commandId = uuidv4();
    const changedSetOP = { "Set OP": voltage };
    if (this.deviceManagementService) {
      try { await this.deviceManagementService.trackCommand(deviceId, commandId, 'complete_settings', changedSetOP); } catch (e) { /* ignore */ }
    }
    return await this.sendCompleteSettingsPayload(deviceId, commandId);
  }

  // Configure Ref Fcal (reference calibration - range: -4.00V to +4.00V)
  async setRefFcal(deviceId, config) {
    console.log('🔧 Setting Ref Fcal configuration - will send complete settings...');
    
    // Validate voltage range (-4.00V to +4.00V)
    const voltage = parseFloat(config.refFcal || 0);
    if (voltage < -4.00 || voltage > 4.00) {
      throw new Error('Ref Fcal voltage must be between -4.00V and +4.00V');
    }
    
    // Get current settings and update Ref Fcal field
    const currentSettings = this.ensureDeviceSettings(deviceId);
    const updatedSettings = {
      ...currentSettings,
      "Ref Fcal": voltage
    };
    
    // Store updated settings
    this.deviceSettings.set(deviceId, updatedSettings);

    // Create commandId and track then send complete payload
    const commandId = uuidv4();
    const changedRefFcal = { "Ref Fcal": voltage };
    if (this.deviceManagementService) {
      try { await this.deviceManagementService.trackCommand(deviceId, commandId, 'complete_settings', changedRefFcal); } catch (e) { /* ignore */ }
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
      
      // Get current settings for the device
      const currentSettings = this.ensureDeviceSettings(deviceId);
      
      // Create payload in the exact format requested
      let payload = {
        "Device ID": actualDeviceId,
        "Message Type": "settings",
        "sender": "Server",
        "Parameters": {
          "Electrode": currentSettings["Electrode"],
          "Shunt Voltage": currentSettings["Shunt Voltage"],
          "Shunt Current": currentSettings["Shunt Current"],
          "Reference Fail": currentSettings["Reference Fail"],
          "Reference UP": currentSettings["Reference UP"],
          "Reference OV": currentSettings["Reference OV"],
          "Set UP": currentSettings["Set UP"],
          "Set OP": currentSettings["Set OP"],
          "Ref Fcal": currentSettings["Ref Fcal"],
          "Interrupt ON Time": currentSettings["Interrupt ON Time"],
          "Interrupt OFF Time": currentSettings["Interrupt OFF Time"],
          "Interrupt Start TimeStamp": currentSettings["Interrupt Start TimeStamp"],
          "Interrupt Stop TimeStamp": currentSettings["Interrupt Stop TimeStamp"],
          "Depolarization Start TimeStamp": currentSettings["Depolarization Start TimeStamp"],
          "Depolarization Stop TimeStamp": currentSettings["Depolarization Stop TimeStamp"],
          "Instant Mode": currentSettings["Instant Mode"],
          "Instant Start TimeStamp": currentSettings["Instant Start TimeStamp"],
          "Instant End TimeStamp": currentSettings["Instant End TimeStamp"],
          "interval": currentSettings["interval"],
          "intervalFormatted": currentSettings["intervalFormatted"]
        }
      };
      
      console.log(`📤 Sending settings payload for device ${actualDeviceId}`);
      console.log(`📦 Settings payload:`, JSON.stringify(payload, null, 2));

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

            // Settings are already saved via individual setting methods
            // Complete data frame sent to device via MQTT

            // Track command in device management service if available
            if (this.deviceManagementService) {
              try {
                await this.deviceManagementService.trackCommand(
                  actualDeviceId,  // Use actual device ID instead of MongoDB ObjectId
                  commandId, 
                  'complete_data_frame', 
                  payload
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
        "Set UP": 0.00,
        "Set OP": 0.00,
        "Ref Fcal": 0.00,
        "Interrupt ON Time": 86400,
        "Interrupt OFF Time": 86400,
        "Interrupt Start TimeStamp": new Date().toISOString().replace('T', ' ').substring(0, 19),
        "Interrupt Stop TimeStamp": new Date().toISOString().replace('T', ' ').substring(0, 19),
        "Depolarization Start TimeStamp": new Date().toISOString().replace('T', ' ').substring(0, 19),
        "Depolarization Stop TimeStamp": new Date().toISOString().replace('T', ' ').substring(0, 19),
        "Instant Mode": 0,
        "Instant Start TimeStamp": "19:04:00",
        "Instant End TimeStamp": "00:00:00",
        "interval": 1800,
        "intervalFormatted": "00:30:00"
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
      
      // Extract all data fields from payload, including Parameters if nested
      const dataFields = {};
      
      // Handle nested Parameters structure (real device format)
      if (payload.Parameters && typeof payload.Parameters === 'object') {
        Object.keys(payload.Parameters).forEach(key => {
          dataFields[key] = payload.Parameters[key];
        });
        console.log('📦 Extracted nested Parameters for telemetry');
      }
      
      // Also include root-level fields (simulator format)
      Object.keys(payload).forEach(key => {
        // Skip meta fields, keep actual telemetry data
        if (!['Device ID', 'Message Type', 'sender', 'CommandId', 'Parameters'].includes(key)) {
          dataFields[key] = payload[key];
        }
      });

      // Ensure critical REF values are properly captured
      ['REF/OP', 'REF/UP', 'REF FAIL', 'REF_OP', 'REF_UP', 'REF_FAIL', 
       'DI1', 'DI2', 'DI3', 'DI4', 'REF1', 'REF2', 'REF3'].forEach(field => {
        if (payload[field] !== undefined) {
          dataFields[field] = payload[field];
        }
        if (payload.Parameters && payload.Parameters[field] !== undefined) {
          dataFields[field] = payload.Parameters[field];
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
      console.log(`✅ Saved telemetry data for device ${deviceId} with ${Object.keys(dataFields).length} data fields`);
      console.log('📊 Saved fields:', Object.keys(dataFields).join(', '));
      
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
      
      // Check if payload contains any settings fields (including new ones)
      const hasSettings = settingsPayload.Electrode !== undefined ||
                         settingsPayload.Event !== undefined ||
                         settingsPayload['Manual Mode Action'] !== undefined ||
                         settingsPayload['Shunt Voltage'] !== undefined ||
                         settingsPayload['Instant Mode'] !== undefined ||
                         settingsPayload['SET mV'] !== undefined ||
                         settingsPayload['Set Shunt'] !== undefined ||
                         settingsPayload['Logging Interval'] !== undefined ||
                         settingsPayload.DI1 !== undefined ||
                         settingsPayload.DI2 !== undefined ||
                         settingsPayload.DI3 !== undefined ||
                         settingsPayload.DI4 !== undefined;
      
      if (!hasSettings) {
        return; // No settings in this payload
      }

      const device = await Device.findOne({ deviceId });
      if (!device) {
        console.log(`⚠️ Device ${deviceId} not found, cannot save settings`);
        return;
      }

      // Extract settings from payload (preserve existing if not in payload) - ENHANCED
      const currentSettings = device.configuration?.deviceSettings || {};
      const settings = {
        electrode: settingsPayload.Electrode !== undefined ? settingsPayload.Electrode : currentSettings.electrode || 0,
        event: settingsPayload.Event !== undefined ? settingsPayload.Event : currentSettings.event || 0,
        manualModeAction: settingsPayload['Manual Mode Action'] !== undefined ? settingsPayload['Manual Mode Action'] : currentSettings.manualModeAction || 0,
        shuntVoltage: settingsPayload['Shunt Voltage'] !== undefined ? settingsPayload['Shunt Voltage'] : currentSettings.shuntVoltage || 0,
        shuntCurrent: settingsPayload['Shunt Current'] !== undefined ? settingsPayload['Shunt Current'] : currentSettings.shuntCurrent || 0,
        // New fields from GSM test report
        setVoltage: settingsPayload['SET mV'] !== undefined ? settingsPayload['SET mV'] : currentSettings.setVoltage || 0,
        setShunt: settingsPayload['Set Shunt'] !== undefined ? settingsPayload['Set Shunt'] : currentSettings.setShunt || 0,
        referenceFail: settingsPayload['Reference Fail'] !== undefined ? settingsPayload['Reference Fail'] : currentSettings.referenceFail || 0,
        referenceUP: settingsPayload['Reference UP'] !== undefined ? settingsPayload['Reference UP'] : currentSettings.referenceUP || 0,
        referenceOV: settingsPayload['Reference OV'] !== undefined ? settingsPayload['Reference OV'] : currentSettings.referenceOV || 0,
        // Digital inputs
        di1: settingsPayload.DI1 !== undefined ? settingsPayload.DI1 : currentSettings.di1 || 0,
        di2: settingsPayload.DI2 !== undefined ? settingsPayload.DI2 : currentSettings.di2 || 0,
        di3: settingsPayload.DI3 !== undefined ? settingsPayload.DI3 : currentSettings.di3 || 0,
        di4: settingsPayload.DI4 !== undefined ? settingsPayload.DI4 : currentSettings.di4 || 0,
        interruptOnTime: settingsPayload['Interrupt ON Time'] !== undefined ? settingsPayload['Interrupt ON Time'] : currentSettings.interruptOnTime || 0,
        interruptOffTime: settingsPayload['Interrupt OFF Time'] !== undefined ? settingsPayload['Interrupt OFF Time'] : currentSettings.interruptOffTime || 0,
        interruptStartTimestamp: settingsPayload['Interrupt Start TimeStamp'] !== undefined ? settingsPayload['Interrupt Start TimeStamp'] : currentSettings.interruptStartTimestamp || '',
        interruptStopTimestamp: settingsPayload['Interrupt Stop TimeStamp'] !== undefined ? settingsPayload['Interrupt Stop TimeStamp'] : currentSettings.interruptStopTimestamp || '',
        depolarizationStartTimestamp: settingsPayload['Depolarization Start TimeStamp'] !== undefined ? settingsPayload['Depolarization Start TimeStamp'] : currentSettings.depolarizationStartTimestamp || '',
        depolarizationStopTimestamp: settingsPayload['Depolarization Stop TimeStamp'] !== undefined ? settingsPayload['Depolarization Stop TimeStamp'] : currentSettings.depolarizationStopTimestamp || '',
        instantMode: settingsPayload['Instant Mode'] !== undefined ? settingsPayload['Instant Mode'] : currentSettings.instantMode || 0,
        instantStartTimestamp: settingsPayload['Instant Start TimeStamp'] !== undefined ? settingsPayload['Instant Start TimeStamp'] : currentSettings.instantStartTimestamp || '',
        instantEndTimestamp: settingsPayload['Instant End TimeStamp'] !== undefined ? settingsPayload['Instant End TimeStamp'] : currentSettings.instantEndTimestamp || '',
        // Logging configuration
        loggingInterval: settingsPayload['Logging Interval'] !== undefined ? settingsPayload['Logging Interval'] : currentSettings.loggingInterval || '00:00:10'
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
        "Interrupt ON Time": settingsPayload['Interrupt ON Time'] !== undefined ? settingsPayload['Interrupt ON Time'] : currentSettings.interruptOnTime || 86400,
        "Interrupt OFF Time": settingsPayload['Interrupt OFF Time'] !== undefined ? settingsPayload['Interrupt OFF Time'] : currentSettings.interruptOffTime || 86400,
        "Interrupt Start TimeStamp": settingsPayload['Interrupt Start TimeStamp'] !== undefined ? settingsPayload['Interrupt Start TimeStamp'] : currentSettings.interruptStartTimestamp || new Date().toISOString().replace('T', ' ').substring(0, 19),
        "Interrupt Stop TimeStamp": settingsPayload['Interrupt Stop TimeStamp'] !== undefined ? settingsPayload['Interrupt Stop TimeStamp'] : currentSettings.interruptStopTimestamp || new Date().toISOString().replace('T', ' ').substring(0, 19),
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

  /**
   * Extract and store device settings from incoming MQTT data
   * This preserves the original timestamps sent by the device
   */
  async extractAndStoreDeviceSettings(deviceId, payload) {
    try {
      console.log(`🔍 Extracting device settings for device ${deviceId}`);
      
      // List of the 18 device parameters to look for
      const DEVICE_PARAMETERS = [
        'Electrode', 'Event', 'Manual Mode Action', 'Shunt Voltage', 'Shunt Current',
        'Reference Fail', 'Reference UP', 'Reference OV', 'Interrupt ON Time', 'Interrupt OFF Time',
        'Interrupt Start TimeStamp', 'Interrupt Stop TimeStamp', 'DPOL Interval',
        'Depolarization Start TimeStamp', 'Depolarization Stop TimeStamp', 'Instant Mode',
        'Instant Start TimeStamp', 'Instant End TimeStamp'
      ];
      
      // Extract device parameters from payload (preserve original values)
      const deviceSettings = {};
      let foundParameters = 0;
      
      for (const param of DEVICE_PARAMETERS) {
        if (payload[param] !== undefined) {
          deviceSettings[param] = payload[param];
          foundParameters++;
          console.log(`📋 Found parameter: ${param} = ${payload[param]}`);
        }
      }
      
      if (foundParameters > 0) {
        console.log(`✅ Found ${foundParameters} device parameters, storing in database`);
        
        // Store settings using device management service (preserving original timestamps)
        if (this.deviceManagementService) {
          // Map to internal field names for database storage
          const mappedSettings = this.deviceManagementService.mapParametersToInternalFields(deviceSettings);
          await this.deviceManagementService.storeDeviceSettings(deviceId, mappedSettings, 'mqtt_incoming');
          console.log(`💾 Device settings stored in database for device ${deviceId}`);
          
          // Store BOTH formats in memory - mapped for backend use, original for MQTT
          const currentMemorySettings = this.deviceSettings.get(deviceId) || {};
          const updatedMemorySettings = { ...currentMemorySettings, ...deviceSettings };
          this.deviceSettings.set(deviceId, updatedMemorySettings);
          console.log(`💾 Device settings stored in memory for device ${deviceId}`);
          
          // Emit real-time update to frontend with original parameter names
          if (this.socketIO) {
            this.socketIO.emit('deviceSettingsUpdate', {
              deviceId,
              settings: deviceSettings,
              source: 'device',
              timestamp: new Date().toISOString()
            });
            console.log(`📡 Sent real-time device settings update to frontend`);
          }
        }
      } else {
        console.log(`ℹ️ No device parameters found in payload for device ${deviceId}`);
      }
      
    } catch (error) {
      console.error(`❌ Error extracting device settings for device ${deviceId}:`, error.message);
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