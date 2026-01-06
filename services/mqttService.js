const mqtt = require('mqtt');
const { deviceBroker } = require('../config/mqtt');
const { transformDeviceData, createThrottledEmit, mapEventCode } = require('../utils/dataTransform');
const { secondsToHHMMSS, hhmmssToSeconds, ensureLoggingIntervalFormat } = require('../utils/timeConverter');
const { v4: uuidv4 } = require('uuid');
const Device = require('../models/Device');
const alarmMonitoringService = require('./alarmMonitoringService');

// Helper function to convert degree format coordinates to decimal
// Format: "19°03'N" or "072°52'E" -> 19.05 or -72.87
function convertDegreesToDecimal(degreeStr) {
  try {
    if (!degreeStr || typeof degreeStr !== 'string') return null;
    
    // Match pattern: degrees°minutes'[seconds"]direction
    const match = degreeStr.match(/(\d+)°(\d+)['′](\d+)?["″]?([NSEW])/i);
    if (!match) return null;
    
    const degrees = parseInt(match[1]);
    const minutes = parseInt(match[2]);
    const seconds = match[3] ? parseInt(match[3]) : 0;
    const direction = match[4].toUpperCase();
    
    // Convert to decimal: degrees + minutes/60 + seconds/3600
    let decimal = degrees + (minutes / 60) + (seconds / 3600);
    
    // Apply direction (S and W are negative)
    if (direction === 'S' || direction === 'W') {
      decimal = -decimal;
    }
    
    return decimal;
  } catch (e) {
    return null;
  }
}

// Helper function to parse location string and extract latitude/longitude
// Supports formats: "12.34, 56.78" or "19°03'N, 072°52'E"
function parseLocationString(locationStr) {
  try {
    if (!locationStr || typeof locationStr !== 'string') return null;
    
    let lat = null;
    let lon = null;
    
    // Check if location is in decimal format (e.g., "12.34, 56.78")
    if (/^-?\d+\.?\d*,\s*-?\d+\.?\d*$/.test(locationStr.trim())) {
      const parts = locationStr.split(',').map(s => parseFloat(s.trim()));
      if (parts.length === 2 && !isNaN(parts[0]) && !isNaN(parts[1])) {
        lat = parts[0];
        lon = parts[1];
      }
    }
    // Check if location is in degree format (e.g., "19°03'N, 072°52'E")
    else if (/^\d+°\d+['′][NSEW],\s*\d+°\d+['′][NSEW]/i.test(locationStr.trim())) {
      const parts = locationStr.split(',').map(s => s.trim());
      if (parts.length === 2) {
        lat = convertDegreesToDecimal(parts[0]);
        lon = convertDegreesToDecimal(parts[1]);
      }
    }
    
    // Return null if coordinates are 0,0 or invalid
    if (lat !== null && lon !== null && (lat !== 0 || lon !== 0)) {
      return { latitude: lat, longitude: lon };
    }
    
    return null;
  } catch (e) {
    console.warn('Error parsing location string:', e.message);
    return null;
  }
}

class MQTTService {
  constructor() {
    this.client = null;
    this.throttledEmit = null;
    this.socketIO = null;
    this.deviceData = { device: null };
    this.lastDeviceTimestamp = 0;
    this.connectionStatus = { device: false };
    
    // Device activity tracking - keep connected for 40 seconds after last message
    // Device sends every 10 seconds, so 40 seconds = 4x the interval (allows 3 missed messages for network delays)
    this.deviceLastActivity = new Map(); // deviceId -> timestamp
    this.DEVICE_TIMEOUT = 40000; // 40 seconds - handles network jitter
    
    // Memory-based acknowledgment tracking
    this.pendingCommands = new Map(); // commandId -> command details
    this.acknowledgmentTimeouts = new Map(); // commandId -> timeout handler
    this.commandHistory = []; // Array of completed commands (limited size)
    this.maxHistorySize = 100; // Keep last 100 commands
    
    // Store current device settings per deviceId
    this.deviceSettings = new Map(); // deviceId -> settings object
    
    // Store device logging intervals for dynamic timeout calculation
    this.deviceLoggingIntervals = new Map(); // deviceId -> loggingIntervalSeconds
    
    // Device Management Service Integration
    this.deviceManagementService = null;
    
    // Location tracking
    this.lastLocationSummaryEmit = 0;
    this.deviceLocations = new Map(); // deviceId -> {name, latitude, longitude}
    this.locationCache = {}; // Coordinate-based location cache
  }

  initialize(io) {
    this.throttledEmit = createThrottledEmit(io, this);
    this.socketIO = io;
    this.client = mqtt.connect(deviceBroker.url, deviceBroker.options);
    this.setupEventHandlers(io);
    
    // Start periodic connection status broadcaster (every 3 seconds for smooth updates)
    setInterval(() => {
      if (this.socketIO) {
        const connectionStatus = this.getConnectionStatus();
        this.socketIO.emit('connectionStatus', connectionStatus);
      }
    }, 3000); // 3 seconds - balanced for real-time updates without flooding
    
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
          
          // Save telemetry data FIRST to perform reverse geocoding
          await this.saveTelemetryData(deviceId, payload); // ✅ Save first to get location from geocoding
          
          // Fetch the just-saved telemetry record to get the reverse-geocoded location
          const Telemetry = require('../models/Telemetry');
          const latestTelemetry = await Telemetry.findOne({ deviceId: deviceId }).sort({ timestamp: -1 });
          if (latestTelemetry && latestTelemetry.location) {
            console.log(`📍 Updated device location from telemetry: ${latestTelemetry.location}`);
            deviceInfo.location = latestTelemetry.location;
          }
          
          this.deviceData.device = deviceInfo;
          this.lastDeviceTimestamp = Date.now();
          this.throttledEmit(deviceInfo);
          
          // DEVICE SETTINGS EXTRACTION: Extract and store the 18 device parameters if present
          await this.extractAndStoreDeviceSettings(deviceId, payload);
          
          // DEVICE LOCATION MAPPING: Emit active device locations for map display
          await this.emitActiveDeviceLocations(deviceId, payload);
          
          // Update device status in MongoDB
          await this.updateDeviceStatus(deviceId, payload); // ✅ RE-ENABLED - Keep MongoDB in sync with current status
          
          // Note: saveTelemetryData is called earlier (above) to get reverse-geocoded location
          // before emitting device data to frontend
          
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
    let lastConnectionTime = Date.now();

    this.client.on('close', () => {
      const connectionDuration = Date.now() - lastConnectionTime;
      // Log all closure events to understand pattern
      console.log(`⚠️ MQTT broker connection closed after ${(connectionDuration/1000).toFixed(1)}s (reconnect attempt: ${reconnectAttempts})`);
      // This is normal behavior - mqtt.js will auto-reconnect based on reconnectPeriod
    });

    this.client.on('error', err => {
      // Log all errors to understand what's happening
      const errorMsg = err.message || err.toString();
      console.error('❌ MQTT client error:', errorMsg);
      if (err.code) console.error('   Error code:', err.code);
    });

    this.client.on('offline', () => {
      // Reduce noise - only log if we haven't already logged reconnect
      // This event often fires along with 'close'
    });

    this.client.on('reconnect', () => {
      reconnectAttempts++;
      if (reconnectAttempts <= MAX_RECONNECT_LOGS) {
        console.log(`🔄 MQTT reconnection attempt ${reconnectAttempts}...`);
      } else if (reconnectAttempts === MAX_RECONNECT_LOGS + 1) {
        console.log(`🔇 Suppressing further reconnection logs...`);
      }
    });
    
    this.client.on('connect', () => {
      // Reset reconnect counter and update connection time
      if (reconnectAttempts > 0) {
        console.log(`✅ MQTT reconnected successfully after ${reconnectAttempts} attempts`);
      }
      reconnectAttempts = 0;
      lastConnectionTime = Date.now();
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

    // Notify frontend with enhanced set value information
    const acknowledgmentData = {
      commandId,
      deviceId: pendingCommand.deviceId,
      command: pendingCommand.originalCommand,
      status: pendingCommand.status,
      responseTime: pendingCommand.responseTime,
      deviceResponse: pendingCommand.deviceResponse,
      acknowledgedAt: pendingCommand.acknowledgedAt
    };

    // Add specific information for set value commands
    if (pendingCommand.originalCommand === 'complete_settings' && pendingCommand.commandPayload?.Parameters) {
      const params = pendingCommand.commandPayload.Parameters;
      const setValue = {};
      
      if (params['Reference Fail'] !== undefined) setValue.referenceFail = params['Reference Fail'];
      
      if (Object.keys(setValue).length > 0) {
        acknowledgmentData.setValues = setValue;
        acknowledgmentData.isSetValueCommand = true;
      }
    }

    this.socketIO?.emit('deviceCommandAcknowledged', acknowledgmentData);
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

  // Force broadcast updated device settings to frontend
  broadcastDeviceSettings(deviceId) {
    const settings = this.deviceSettings.get(deviceId);
    if (settings && this.socketIO) {
      const broadcastData = {
        deviceId,
        settings,
        timestamp: new Date().toISOString()
      };
      console.log('📡 Broadcasting device settings update:', broadcastData);
      this.socketIO.emit('deviceSettingsUpdate', broadcastData);
    }
  }

  // Get default device settings
  getDefaultDeviceSettings() {
    return {
      "Electrode": 0,
      "Event": 0,
      "Manual Mode Action": 0,
      "Shunt Voltage": 25.00,
      "Shunt Current": 99.00,
      "Reference Fail": 0.90,
      "Reference UP": 0.90,
      "Reference OP": 0.70,
      "Interrupt ON Time": 86400,
      "Interrupt OFF Time": 86400,
      "Interrupt Start TimeStamp": "2025-02-20 19:04:00",
      "Interrupt Stop TimeStamp": "2025-02-20 19:05:00",
      "Depolarization Start TimeStamp": "2025-02-20 19:04:00",
      "Depolarization Stop TimeStamp": "2025-02-20 19:05:00",
      "Depolarization_interval": "00:10:00",
      "Instant Mode": 0,
      "Instant Start TimeStamp": "19:04:00",
      "Instant End TimeStamp": "00:00:00",
      "logging_interval": "00:10:00"
    };
  }

  // Initialize device settings if not exists
  async ensureDeviceSettings(deviceId) {
    if (!this.deviceSettings.has(deviceId)) {
      // Try to load from database first
      if (this.deviceManagementService) {
        try {
          const dbSettings = await this.deviceManagementService.getDeviceSettings(deviceId);
          if (dbSettings && dbSettings.Parameters) {
            console.log(`📥 Loaded device settings from database for ${deviceId}`);
            
            // Normalize Reference values to formatted strings with 2 decimals
            const normalizedSettings = { ...dbSettings.Parameters };
            const refFields = ['Reference Fail', 'Reference UP', 'Reference OP'];
            refFields.forEach(field => {
              if (normalizedSettings[field] !== undefined && normalizedSettings[field] !== null) {
                const numVal = typeof normalizedSettings[field] === 'string' 
                  ? parseFloat(normalizedSettings[field]) 
                  : normalizedSettings[field];
                if (!isNaN(numVal)) {
                  normalizedSettings[field] = numVal.toFixed(2);  // Ensure "3.80" format
                }
              }
            });
            
            this.deviceSettings.set(deviceId, normalizedSettings);
            return normalizedSettings;
          }
        } catch (error) {
          console.warn(`⚠️ Could not load settings from database for ${deviceId}, using defaults:`, error.message);
        }
      }
      // Fall back to defaults if database load fails
      this.deviceSettings.set(deviceId, this.getDefaultDeviceSettings());
    }
    return this.deviceSettings.get(deviceId);
  }

  // Synchronous version for cases where async is not possible
  ensureDeviceSettingsSync(deviceId) {
    if (!this.deviceSettings.has(deviceId)) {
      this.deviceSettings.set(deviceId, this.getDefaultDeviceSettings());
    }
    return this.deviceSettings.get(deviceId);
  }

  // Specific configuration methods - ALL now send complete settings payload
  async setInterruptMode(deviceId, config) {
    console.log('🔧 Setting interrupt mode configuration - will send complete settings...');
    
    // Get current settings and update interrupt-related fields
    const currentSettings = await this.ensureDeviceSettings(deviceId);
    
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
    const currentSettings = await this.ensureDeviceSettings(deviceId);
    
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
    const currentSettings = await this.ensureDeviceSettings(deviceId);
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
    const currentSettings = await this.ensureDeviceSettings(deviceId);
    
    // Ensure timestamps include seconds (HH:MM:SS format)
    const startTime = config.startTime && config.startTime.includes(':') && config.startTime.split(':').length === 2 
      ? `${config.startTime}:00` 
      : config.startTime;
    const endTime = config.endTime && config.endTime.includes(':') && config.endTime.split(':').length === 2 
      ? `${config.endTime}:00` 
      : config.endTime;
    
    // Depolarization_interval now uses hh:mm:ss format only
    let dpolIntervalFormat = config.intervalFormat || currentSettings["Depolarization_interval"] || "00:10:00";
    
    if (config.interval && typeof config.interval === 'string' && config.interval.includes(':')) {
      dpolIntervalFormat = config.interval;
    }
    
    const updatedSettings = {
      ...currentSettings,
      "Event": 3, // DPOL mode
      "Depolarization Start TimeStamp": `${config.startDate} ${startTime}`,
      "Depolarization Stop TimeStamp": `${config.endDate} ${endTime}`,
      "Depolarization_interval": dpolIntervalFormat
    };
    
    // Store updated settings
    this.deviceSettings.set(deviceId, updatedSettings);

    // Create commandId and track then send complete payload
    const commandId = uuidv4();
    const changedDpol = {
      "Event": 3,
      "Depolarization Start TimeStamp": updatedSettings["Depolarization Start TimeStamp"],
      "Depolarization Stop TimeStamp": updatedSettings["Depolarization Stop TimeStamp"],
      "Depolarization_interval": updatedSettings["Depolarization_interval"]
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
    const currentSettings = await this.ensureDeviceSettings(deviceId);
    
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
    const currentSettings = await this.ensureDeviceSettings(deviceId);
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
    const currentSettings = await this.ensureDeviceSettings(deviceId);
    
    // Determine Reference Fail default value based on electrode type
    let refFailValue = 0.30;  // Default for Cu/CuSO4 (0) and Ag/AgCl (2)
    if (electrodeType === 1) {  // Zinc
      refFailValue = -0.80;
      console.log('⚡ Zinc electrode detected - auto-setting Reference Fail to -0.80V');
    } else if (electrodeType === 2) {  // Ag/AgCl
      refFailValue = 0.30;
    } else {  // Cu/CuSO4 (0)
      refFailValue = 0.30;
    }
    
    const updatedSettings = {
      ...currentSettings,
      "Electrode": electrodeType,
      "Reference Fail": refFailValue
    };
    
    // Store updated settings in memory
    this.deviceSettings.set(deviceId, updatedSettings);
    console.log(`💾 Memory cache updated for ${deviceId}: Electrode=${electrodeType}, Reference Fail=${updatedSettings["Reference Fail"]}`);

    // Save to database immediately to persist the change
    if (this.deviceManagementService) {
      try {
        const mappedSettings = this.deviceManagementService.mapParametersToInternalFields({ 
          "Electrode": electrodeType,
          "Reference Fail": refFailValue.toString()
        });
        await this.deviceManagementService.storeDeviceSettings(deviceId, mappedSettings, 'user_config');
        console.log('💾 Electrode configuration and Reference Fail saved to database immediately');
      } catch (e) {
        console.warn('⚠️ Database save failed (non-critical):', e.message);
      }
    }

    // Create commandId and track then send complete payload
    const commandId = uuidv4();
    const changedElectrode = { "Electrode": electrodeType, "Reference Fail": refFailValue };
    if (this.deviceManagementService) {
      try { await this.deviceManagementService.trackCommand(deviceId, commandId, 'complete_settings', changedElectrode); } catch (e) { /* ignore */ }
    }
    return await this.sendCompleteSettingsPayload(deviceId, commandId);
  }

  async setAlarmConfiguration(deviceId, alarmConfig) {
    console.log('🔧 Setting alarm configuration - will send complete settings...');
    console.log('📥 Received alarm config:', JSON.stringify(alarmConfig, null, 2));
    
    // Get current settings and update alarm fields
    const currentSettings = await this.ensureDeviceSettings(deviceId);
    
    // Extract Reference value updates from alarm config - PRESERVE STRING FORMAT WITH 2 DECIMALS
    const extractSetValue = (config, fieldName) => {
      if (config && typeof config === 'object' && config.value !== undefined) {
        const value = config.value;
        // If it's a string, format it to 2 decimals
        if (typeof value === 'string') {
          const numValue = parseFloat(value);
          if (!isNaN(numValue)) {
            return numValue.toFixed(2);  // Return as formatted string "3.80" not "3.8"
          }
        }
        // If it's already a number, convert to 2 decimal string
        if (typeof value === 'number') {
          return value.toFixed(2);
        }
        return value;
      } else if (config !== null && config !== undefined && typeof config !== 'object') {
        const numValue = parseFloat(config);
        if (!isNaN(numValue)) {
          return numValue.toFixed(2);  // Return as formatted string
        }
        return config;
      }
      return null;
    };

    // Electrode-based validation for Set UP values
    const validateSetUpByElectrode = (setupValue, electrode) => {
      if (setupValue === null || setupValue === undefined) {
        return { valid: true, value: setupValue, message: null };
      }

      const numValue = parseFloat(setupValue);
      const electrodeType = currentSettings["Electrode"] || electrode || 0;

      // Mapping: Electrode 0 (Cu/CuSO4) and 2 (Ag/AgCl) → range 0.6 to 1.0
      // Mapping: Electrode 1 (Zinc) → range -0.5 to 0.0
      
      if (electrodeType === 0 || electrodeType === 2) {
        // Cu/CuSO4 or Ag/AgCl: 0.6 to 1.0
        if (numValue < 0.6 || numValue > 1.0) {
          return {
            valid: false,
            value: setupValue,
            message: `❌ Set UP value ${numValue} is out of range for electrode ${electrodeType}. Required range: 0.6 to 1.0 for Cu/CuSO4 or Ag/AgCl electrodes.`,
            electrode: electrodeType,
            minValue: 0.6,
            maxValue: 1.0
          };
        }
      } else if (electrodeType === 1) {
        // Zinc: -0.5 to 0.0
        if (numValue < -0.5 || numValue > 0.0) {
          return {
            valid: false,
            value: setupValue,
            message: `❌ Set UP value ${numValue} is out of range for electrode ${electrodeType}. Required range: -0.5 to 0.0 for Zinc electrode.`,
            electrode: electrodeType,
            minValue: -0.5,
            maxValue: 0.0
          };
        }
      }

      return { valid: true, value: setupValue, message: null };
    };

    // Electrode-based validation for Set OP values
    const validateSetOpByElectrode = (setopValue, electrode) => {
      if (setopValue === null || setopValue === undefined) {
        return { valid: true, value: setopValue, message: null };
      }

      const numValue = parseFloat(setopValue);
      const electrodeType = currentSettings["Electrode"] || electrode || 0;

      // Mapping: Electrode 0 (Cu/CuSO4) and 2 (Ag/AgCl) → range 1.20 to 3.00
      // Mapping: Electrode 1 (Zinc) → range 0.10 to 1.90
      
      if (electrodeType === 0 || electrodeType === 2) {
        // Cu/CuSO4 or Ag/AgCl: 1.20 to 3.00
        if (numValue < 1.20 || numValue > 3.00) {
          return {
            valid: false,
            value: setopValue,
            message: `❌ Set OP value ${numValue} is out of range for electrode ${electrodeType}. Required range: 1.20 to 3.00 for Cu/CuSO4 or Ag/AgCl electrodes.`,
            electrode: electrodeType,
            minValue: 1.20,
            maxValue: 3.00
          };
        }
      } else if (electrodeType === 1) {
        // Zinc: 0.10 to 1.90
        if (numValue < 0.10 || numValue > 1.90) {
          return {
            valid: false,
            value: setopValue,
            message: `❌ Set OP value ${numValue} is out of range for electrode ${electrodeType}. Required range: 0.10 to 1.90 for Zinc electrode.`,
            electrode: electrodeType,
            minValue: 0.10,
            maxValue: 1.90
          };
        }
      }

      return { valid: true, value: setopValue, message: null };
    };

    // Static validation for Reference Fail (Set Fail) - fixed values per electrode type
    const validateSetFailByElectrode = (setfailValue, electrode) => {
      if (setfailValue === null || setfailValue === undefined) {
        return { valid: true, value: setfailValue, message: null };
      }

      const numValue = parseFloat(setfailValue);
      const electrodeType = currentSettings["Electrode"] || electrode || 0;

      // Static values: Cu/CuSO4 and Ag/AgCl → 0.3, Zinc → -0.8
      const staticValues = {
        0: 0.3,   // Cu/CuSO4
        2: 0.3,   // Ag/AgCl
        1: -0.8   // Zinc
      };

      const expectedValue = staticValues[electrodeType] !== undefined ? staticValues[electrodeType] : 0.3;

      // Allow a small tolerance for floating point comparison (e.g., 0.30 vs 0.3)
      const tolerance = 0.001;
      if (Math.abs(numValue - expectedValue) > tolerance) {
        return {
          valid: false,
          value: setfailValue,
          message: `❌ Set Fail value ${numValue} is not allowed for electrode ${electrodeType}. This value is FIXED and cannot be changed: ${expectedValue} for this electrode type.`,
          electrode: electrodeType,
          staticValue: expectedValue
        };
      }

      return { valid: true, value: setfailValue, message: null };
    };

    const setupValue = extractSetValue(alarmConfig.setup, 'setup');
    const setopValue = extractSetValue(alarmConfig.setop, 'setop');
    const reffailValue = extractSetValue(alarmConfig.reffail, 'reffail');

    // Validate Set UP value against electrode constraints
    const setupValidation = validateSetUpByElectrode(setupValue, currentSettings["Electrode"]);
    
    if (!setupValidation.valid) {
      console.warn(setupValidation.message);
      return {
        success: false,
        error: setupValidation.message,
        validation: {
          field: 'Set UP',
          providedValue: setupValidation.value,
          electrode: setupValidation.electrode,
          allowedMin: setupValidation.minValue,
          allowedMax: setupValidation.maxValue
        }
      };
    }

    // Validate Set OP value against electrode constraints
    const setopValidation = validateSetOpByElectrode(setopValue, currentSettings["Electrode"]);
    
    if (!setopValidation.valid) {
      console.warn(setopValidation.message);
      return {
        success: false,
        error: setopValidation.message,
        validation: {
          field: 'Set OP',
          providedValue: setopValidation.value,
          electrode: setopValidation.electrode,
          allowedMin: setopValidation.minValue,
          allowedMax: setopValidation.maxValue
        }
      };
    }

    // Validate Set Fail (Reference Fail) - static value per electrode
    const setfailValidation = validateSetFailByElectrode(reffailValue, currentSettings["Electrode"]);
    
    if (!setfailValidation.valid) {
      console.warn(setfailValidation.message);
      return {
        success: false,
        error: setfailValidation.message,
        validation: {
          field: 'Set Fail',
          providedValue: setfailValidation.value,
          electrode: setfailValidation.electrode,
          staticValue: setfailValidation.staticValue
        }
      };
    }

    const updatedSettings = {
      ...currentSettings,
      // Only update Reference Fail if explicitly provided, otherwise keep current value
      "Reference Fail": reffailValue !== null ? reffailValue : currentSettings["Reference Fail"],
      // Set UP maps to Reference UP - only update if explicitly provided
      "Reference UP": setupValue !== null ? setupValue : currentSettings["Reference UP"],
      // Set OP maps to Reference OP - only update if explicitly provided
      "Reference OP": setopValue !== null ? setopValue : currentSettings["Reference OP"],
      "Shunt Voltage": alarmConfig.shuntVoltage || alarmConfig["Shunt Voltage"] || currentSettings["Shunt Voltage"],
      "Shunt Current": alarmConfig.shuntCurrent || alarmConfig["Shunt Current"] || currentSettings["Shunt Current"]
    };

    console.log(`🔧 Set UP (${setupValue}) → Reference UP (${updatedSettings["Reference UP"]}) [Electrode: ${currentSettings["Electrode"]}]`);
    console.log(`🔧 Set OP (${setopValue}) → Reference OP (${updatedSettings["Reference OP"]})`);
    console.log(`🔧 Set Fail (${reffailValue}) → Reference Fail (${updatedSettings["Reference Fail"]})`);
    
    // Add display names for frontend consistency (Set UP, Set OP, Set Fail for alarm modal display)
    updatedSettings["Set UP"] = updatedSettings["Reference UP"];
    updatedSettings["Set OP"] = updatedSettings["Reference OP"];
    updatedSettings["Set Fail"] = updatedSettings["Reference Fail"];
    
    // Store updated settings in memory
    this.deviceSettings.set(deviceId, updatedSettings);

    // Save to database immediately to persist the changes
    if (this.deviceManagementService) {
      try {
        const settingsToSave = {};
        // ✅ CRITICAL: Save Reference values as NUMERIC values (parseFloat), not formatted strings
        // The database should store 0.16 not "016", only format "016" for MQTT transmission
        if (updatedSettings["Reference Fail"] !== undefined) settingsToSave["Reference Fail"] = parseFloat(updatedSettings["Reference Fail"]);
        if (updatedSettings["Reference UP"] !== undefined) settingsToSave["Reference UP"] = parseFloat(updatedSettings["Reference UP"]);
        if (updatedSettings["Reference OP"] !== undefined) settingsToSave["Reference OP"] = parseFloat(updatedSettings["Reference OP"]);
        // Save Shunt values if they're part of alarm config
        if (updatedSettings["Shunt Voltage"] !== undefined) settingsToSave["Shunt Voltage"] = updatedSettings["Shunt Voltage"];
        if (updatedSettings["Shunt Current"] !== undefined) settingsToSave["Shunt Current"] = updatedSettings["Shunt Current"];
        
        if (Object.keys(settingsToSave).length > 0) {
          const mappedSettings = this.deviceManagementService.mapParametersToInternalFields(settingsToSave);
          await this.deviceManagementService.storeDeviceSettings(deviceId, mappedSettings, 'user_config');
          console.log('💾 Alarm configuration values saved to database immediately:', Object.keys(settingsToSave));
        }
      } catch (e) {
        console.warn('⚠️ Database save failed (non-critical):', e.message);
      }
    }

    // Send complete settings payload with tracking
    const changedFields = {};
    Object.keys(alarmConfig).forEach(key => {
      // Map Set UP to Reference UP, Set OP to Reference OP
      const mappedKey = key === 'referenceFail' ? 'Reference Fail' : 
                       key === 'referenceUP' ? 'Reference UP' :
                       key === 'referenceOP' ? 'Reference OP' :
                       key === 'shuntVoltage' ? 'Shunt Voltage' :
                       key === 'shuntCurrent' ? 'Shunt Current' :
                       key === 'setup' ? 'Reference UP' :  // Set UP maps to Reference UP
                       key === 'setop' ? 'Reference OP' :  // Set OP maps to Reference OP
                       key === 'reffail' ? 'Reference Fail' : key;
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
    const currentSettings = await this.ensureDeviceSettings(deviceId);
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

  // Configure Set Shunt (current setting in A)
  async setShuntConfiguration(deviceId, config) {
    console.log('🔧 Setting shunt configuration - will send complete settings...');
    
    // Get current settings and update shunt field
    const currentSettings = await this.ensureDeviceSettings(deviceId);
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

  // Configure Shunt Voltage (maps to "Shunt Voltage": 25 mV in data frame)
  async setShuntVoltage(deviceId, config) {
    console.log('🔧 Setting shunt voltage - will send complete settings...');
    
    // Get current settings and update shunt voltage field
    const currentSettings = await this.ensureDeviceSettings(deviceId);
    const updatedSettings = {
      ...currentSettings,
      "Shunt Voltage": config.shuntVoltage || "25.00"
    };
    
    // Store updated settings in memory immediately
    this.deviceSettings.set(deviceId, updatedSettings);

    // Save to database immediately to persist the change
    if (this.deviceManagementService) {
      try {
        const mappedSettings = this.deviceManagementService.mapParametersToInternalFields({ "Shunt Voltage": updatedSettings["Shunt Voltage"] });
        await this.deviceManagementService.storeDeviceSettings(deviceId, mappedSettings, 'user_config');
        console.log('💾 Shunt voltage saved to database immediately');
      } catch (e) {
        console.warn('⚠️ Database save failed (non-critical):', e.message);
      }
    }

    // Create commandId and track then send complete payload
    const commandId = uuidv4();
    const changedVoltage = { "Shunt Voltage": config.shuntVoltage || 25 };
    if (this.deviceManagementService) {
      try { 
        await this.deviceManagementService.trackCommand(deviceId, commandId, 'complete_settings', changedVoltage); 
      } catch (e) { 
        console.warn('⚠️ Device tracking failed (non-critical):', e.message);
      }
    }
    const result = await this.sendCompleteSettingsPayload(deviceId, commandId);
    
    // Broadcast updated settings to frontend
    this.broadcastDeviceSettings(deviceId);
    
    return result;
  }

  // Configure Shunt Current (maps to "Shunt Current": 999 A in data frame)
  async setShuntCurrent(deviceId, config) {
    console.log('🔧 Setting shunt current - will send complete settings...');
    
    // Get current settings and update shunt current field
    const currentSettings = await this.ensureDeviceSettings(deviceId);
    const updatedSettings = {
      ...currentSettings,
      "Shunt Current": config.shuntCurrent || "999.00"
    };
    
    // Store updated settings in memory immediately
    this.deviceSettings.set(deviceId, updatedSettings);

    // Save to database immediately to persist the change
    if (this.deviceManagementService) {
      try {
        const mappedSettings = this.deviceManagementService.mapParametersToInternalFields({ "Shunt Current": updatedSettings["Shunt Current"] });
        await this.deviceManagementService.storeDeviceSettings(deviceId, mappedSettings, 'user_config');
        console.log('💾 Shunt current saved to database immediately');
      } catch (e) {
        console.warn('⚠️ Database save failed (non-critical):', e.message);
      }
    }

    // Create commandId and track then send complete payload
    const commandId = uuidv4();
    const changedCurrent = { "Shunt Current": config.shuntCurrent || 999 };
    if (this.deviceManagementService) {
      try { 
        await this.deviceManagementService.trackCommand(deviceId, commandId, 'complete_settings', changedCurrent); 
      } catch (e) { 
        console.warn('⚠️ Device tracking failed (non-critical):', e.message);
      }
    }
    const result = await this.sendCompleteSettingsPayload(deviceId, commandId);
    
    // Broadcast updated settings to frontend  
    this.broadcastDeviceSettings(deviceId);
    
    return result;
  }

  // Configure logging interval
  async setLoggingConfiguration(deviceId, config) {
    console.log('🔧 Setting logging configuration - will send complete settings...');
    console.log('📥 Received logging config:', JSON.stringify(config, null, 2));
    
    // Get current settings - PRIORITIZE memory cache (most recent from device)
    // Fall back to database if memory cache is empty
    let currentSettings = null;
    
    // First, try to get from memory cache (has latest device data)
    if (this.deviceSettings.has(deviceId)) {
      currentSettings = { ...this.deviceSettings.get(deviceId) };
      console.log(`📥 Using MEMORY CACHE settings for device ${deviceId} (most recent from device)`);
    }
    
    // If memory cache is empty, try loading from database
    if (!currentSettings && this.deviceManagementService) {
      try {
        const dbSettings = await this.deviceManagementService.getDeviceSettings(deviceId);
        if (dbSettings && dbSettings.Parameters) {
          currentSettings = { ...dbSettings.Parameters };
          console.log(`📥 Using DATABASE settings for device ${deviceId} (memory cache was empty)`);
        }
      } catch (error) {
        console.warn(`⚠️ Could not load settings from database for ${deviceId}:`, error.message);
      }
    }
    
    // Final fallback - use defaults
    if (!currentSettings) {
      currentSettings = await this.ensureDeviceSettings(deviceId);
      console.log(`⚠️ Using DEFAULT settings for device ${deviceId} (neither cache nor database had values)`);
    }
    
    // Handle nested object format for logging interval
    const { logging_interval, logging_interval_format } = (() => {
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
        return { logging_interval: seconds, logging_interval_format: inputValue };
      }
      
      console.log(`🔧 Logging: keeping current values - logging_interval=${currentSettings["logging_interval"]}, logging_interval_format="${currentSettings["logging_interval_format"]}"`);
      return { 
        logging_interval: currentSettings["logging_interval"] || 1800, 
        logging_interval_format: currentSettings["logging_interval_format"] || "00:30:00" 
      };
    })();
    
    const updatedSettings = {
      ...currentSettings,
      "logging_interval": logging_interval,
      "logging_interval_format": logging_interval_format
    };
    
    console.log('💾 Updated logging settings:', JSON.stringify(updatedSettings, null, 2));
    
    // Store updated settings in memory cache
    this.deviceSettings.set(deviceId, updatedSettings);

    // Create commandId and track then send complete payload
    const commandId = uuidv4();
    const changedLogging = { "logging_interval": updatedSettings["logging_interval"], "logging_interval_format": updatedSettings["logging_interval_format"] };
    if (this.deviceManagementService) {
      try { await this.deviceManagementService.trackCommand(deviceId, commandId, 'complete_settings', changedLogging); } catch (e) { /* ignore */ }
    }
    return await this.sendCompleteSettingsPayload(deviceId, commandId);
  }

  // Configure Set UP (alarm set value - range: -4.0V to +4.0V)
  async setAlarmSetUP(deviceId, config) {
    console.log('🔧 Setting Set UP alarm configuration - will send complete settings...');
    
    // Validate voltage range (-4.0V to +4.0V)
    const voltage = parseFloat(config.setUP || 0);
    if (voltage < -4.0 || voltage > 4.0) {
      throw new Error('Set UP voltage must be between -4.0V and +4.0V');
    }
    
    // Get current settings and update both "Set UP" and "Reference UP" with the same value
    const currentSettings = await this.ensureDeviceSettings(deviceId);
    const updatedSettings = {
      ...currentSettings,
      "Set UP": voltage,
      "Reference UP": voltage  // ✅ CRITICAL: Also update Reference UP since device uses Reference UP
    };
    
    // Store updated settings
    this.deviceSettings.set(deviceId, updatedSettings);

    // ✅ CRITICAL: Save to database immediately to persist the changes
    // Only save "Reference UP" - "Set UP" is display-only alias
    if (this.deviceManagementService) {
      try {
        const mappedSettings = this.deviceManagementService.mapParametersToInternalFields({
          "Reference UP": voltage
        });
        await this.deviceManagementService.storeDeviceSettings(deviceId, mappedSettings, 'user_config');
        console.log('💾 Set UP configuration saved to database - Reference UP:', voltage);
      } catch (e) {
        console.warn('⚠️ Database save failed (non-critical):', e.message);
      }
    }

    // Create commandId and track then send complete payload
    const commandId = uuidv4();
    const changedSetUP = { "Set UP": voltage, "Reference UP": voltage };
    if (this.deviceManagementService) {
      try { await this.deviceManagementService.trackCommand(deviceId, commandId, 'complete_settings', changedSetUP); } catch (e) { /* ignore */ }
    }
    return await this.sendCompleteSettingsPayload(deviceId, commandId);
  }

  // Configure Set OP (alarm set value - range: -4.0V to +4.0V)
  async setAlarmSetOP(deviceId, config) {
    console.log('🔧 Setting Set OP alarm configuration - will send complete settings...');
    
    // Validate voltage range (-4.0V to +4.0V)
    const voltage = parseFloat(config.setOP || 0);
    if (voltage < -4.0 || voltage > 4.0) {
      throw new Error('Set OP voltage must be between -4.0V and +4.0V');
    }
    
    // Get current settings and update both "Set OP" and "Reference OP" with the same value
    const currentSettings = await this.ensureDeviceSettings(deviceId);
    const updatedSettings = {
      ...currentSettings,
      "Set OP": voltage,
      "Reference OP": voltage  // ✅ CRITICAL: Also update Reference OP since device uses Reference OP
    };
    
    // Store updated settings
    this.deviceSettings.set(deviceId, updatedSettings);

    // ✅ CRITICAL: Save to database immediately to persist the changes
    // Only save "Reference OP" - "Set OP" is display-only alias
    if (this.deviceManagementService) {
      try {
        const mappedSettings = this.deviceManagementService.mapParametersToInternalFields({
          "Reference OP": voltage
        });
        await this.deviceManagementService.storeDeviceSettings(deviceId, mappedSettings, 'user_config');
        console.log('💾 Set OP configuration saved to database - Reference OP:', voltage);
      } catch (e) {
        console.warn('⚠️ Database save failed (non-critical):', e.message);
      }
    }

    // Create commandId and track then send complete payload
    const commandId = uuidv4();
    const changedSetOP = { "Set OP": voltage, "Reference OP": voltage };
    if (this.deviceManagementService) {
      try { await this.deviceManagementService.trackCommand(deviceId, commandId, 'complete_settings', changedSetOP); } catch (e) { /* ignore */ }
    }
    return await this.sendCompleteSettingsPayload(deviceId, commandId);
  }

  // Configure Reference Fail (reference calibration - range: -4.0V to +4.0V)
  async setRefFail(deviceId, config) {
    console.log('🔧 Setting Reference Fail configuration - will send complete settings...');
    
    // Validate voltage range (-4.00V to +4.00V)
    const voltage = parseFloat(config.refFail || 0);
    if (voltage < -4.0 || voltage > 4.0) {
      throw new Error('Reference Fail voltage must be between -4.0V and +4.0V');
    }
    
    // Get current settings and update Reference Fail field
    const currentSettings = await this.ensureDeviceSettings(deviceId);
    const updatedSettings = {
      ...currentSettings,
      "Reference Fail": voltage
    };
    
    // Store updated settings
    this.deviceSettings.set(deviceId, updatedSettings);

    // Create commandId and track then send complete payload
    const commandId = uuidv4();
    const changedRefFail = { "Reference Fail": voltage };
    if (this.deviceManagementService) {
      try { await this.deviceManagementService.trackCommand(deviceId, commandId, 'complete_settings', changedRefFail); } catch (e) { /* ignore */ }
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
        'INST': 4,
        0: 0,
        1: 1,
        2: 2,
        3: 3,
        4: 4
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
    
    // Shunt values are already formatted as 3-digit padded strings (e.g., "075", "099")
    // They are sent as-is to the device (no further conversion needed)
    // The padding format is: 75 → "075", 100 → "100", 50 → "050"
    
    // Apply mappings to specific fields (these remain as numeric codes)
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

  // Get readable event name from code (for displaying received data)
  getEventName(eventCode) {
    return mapEventCode(eventCode);
  }

  // Get all available event mappings for frontend reference
  getEventMappings() {
    return {
      0: 'Normal',
      1: 'Interrupt', 
      2: 'Manual',
      3: 'DEPOL',
      4: 'Instant'
    };
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
      const currentSettings = await this.ensureDeviceSettings(deviceId);
      
      // Ensure logging_interval_format is set based on logging_interval
      if (currentSettings["logging_interval"]) {
        if (typeof currentSettings["logging_interval"] === 'number') {
          // Convert seconds to hh:mm:ss if not already converted
          currentSettings["logging_interval_format"] = secondsToHHMMSS(currentSettings["logging_interval"]);
        }
      }
      
      // Create parameters object from current settings - ALL 20 CORE PARAMETERS
      // Using OLD RESOLUTION HANDLER LOGIC:
      // Shunt Voltage: 75 → "075" (3-digit padded, no multiplication)
      // Shunt Current: 16.8 → "168" (multiply by 10)
      // Reference values: 0.30 → "030", 1.24 → "124" (multiply by 100, pad 3 digits)
      // Interrupt times: 50.0 → 500 (multiply by 10)

      const formatShuntVoltageForDevice = (value) => {
        if (value === undefined || value === null) return undefined;
        let numVal;
        if (typeof value === 'string') {
          numVal = parseFloat(value);
        } else if (typeof value === 'number') {
          numVal = value;
        } else {
          return value;
        }
        if (!isNaN(numVal)) {
          // Pad to 3 digits with leading zeros (75 -> "075", 100 -> "100")
          const intVal = Math.round(numVal);
          return intVal.toString().padStart(3, '0');
        }
        return value;
      };

      const formatShuntCurrentForDevice = (value) => {
        if (value === undefined || value === null) return undefined;
        let numVal;
        if (typeof value === 'string') {
          numVal = parseFloat(value);
        } else if (typeof value === 'number') {
          numVal = value;
        } else {
          return value;
        }
        if (!isNaN(numVal)) {
          // If value is already large (>100), assume it's been scaled and just return it
          // Otherwise multiply by 10 (16.8 * 10 = 168)
          if (numVal > 100) {
            return Math.round(numVal);
          } else {
            return Math.round(numVal * 10);
          }
        }
        return value;
      };

      const formatRefValueForDevice = (value) => {
        if (value === undefined || value === null) return undefined;
        let numVal;
        if (typeof value === 'string') {
          numVal = parseFloat(value);
        } else if (typeof value === 'number') {
          numVal = value;
        } else {
          return value;
        }
        if (!isNaN(numVal)) {
          // If value is already large (>100), assume it's been scaled and just pad it
          // Otherwise multiply by 100 (0.30 * 100 = 30 → "030", 1.24 * 100 = 124 → "124")
          let intVal;
          if (Math.abs(numVal) > 100) {
            intVal = Math.round(numVal);
          } else {
            intVal = Math.round(numVal * 100);
          }
          
          if (intVal < 0) {
            return '-' + Math.abs(intVal).toString().padStart(3, '0');
          } else {
            return intVal.toString().padStart(3, '0');
          }
        }
        return value;
      };

      // Build logging_interval - handle both string (time format) and numeric (seconds) values
      let loggingIntervalValue = currentSettings["logging_interval"] || "00:10:00";
      if (typeof loggingIntervalValue === 'number') {
        // If it's numeric, convert to HH:MM:SS format
        loggingIntervalValue = secondsToHHMMSS(loggingIntervalValue);
      }
      // If it's already a string, use as-is

      const parameters = {
        "Electrode": currentSettings["Electrode"] || 0,
        "Event": currentSettings["Event"] || 0,
        "Manual Mode Action": currentSettings["Manual Mode Action"] !== undefined ? currentSettings["Manual Mode Action"] : 0,
        "Shunt Voltage": formatShuntVoltageForDevice(currentSettings["Shunt Voltage"]) || "025",
        "Shunt Current": formatShuntCurrentForDevice(currentSettings["Shunt Current"]) || 99,
        "Reference Fail": formatRefValueForDevice(currentSettings["Reference Fail"]) || "030",
        "Reference UP": formatRefValueForDevice(currentSettings["Reference UP"]) || "030",
        "Reference OP": formatRefValueForDevice(currentSettings["Reference OP"]) || "070",
        "Interrupt ON Time": (currentSettings["Interrupt ON Time"] || 86400) * 10,
        "Interrupt OFF Time": (currentSettings["Interrupt OFF Time"] || 86400) * 10,
        "Interrupt Start TimeStamp": currentSettings["Interrupt Start TimeStamp"] || "2025-02-20 19:04:00",
        "Interrupt Stop TimeStamp": currentSettings["Interrupt Stop TimeStamp"] || "2025-02-20 19:05:00",
        "Depolarization Start TimeStamp": currentSettings["Depolarization Start TimeStamp"] || "2025-02-20 19:04:00",
        "Depolarization Stop TimeStamp": currentSettings["Depolarization Stop TimeStamp"] || "2025-02-20 19:05:00",
        "Depolarization_interval": currentSettings["Depolarization_interval"] || "00:10:00",
        "Instant Mode": currentSettings["Instant Mode"] !== undefined ? currentSettings["Instant Mode"] : 0,
        "Instant Start TimeStamp": currentSettings["Instant Start TimeStamp"] || "19:04:00",
        "Instant End TimeStamp": currentSettings["Instant End TimeStamp"] || "00:00:00",
        "logging_interval": loggingIntervalValue
      };
      
      // Debug log for electrode changes
      if (currentSettings["Electrode"] !== undefined || currentSettings["Reference Fail"] !== undefined) {
        console.log(`📊 Building MQTT payload - Electrode=${currentSettings["Electrode"]}, Reference Fail raw=${currentSettings["Reference Fail"]}, formatted=${parameters["Reference Fail"]}`);
        // NOTE: Do NOT include "Set UP", "Set OP", "Set Fail" - these are display-only aliases for frontend
        // Only send "Reference UP", "Reference OP", "Reference Fail" to device
      };
      
      // Note: Set UP and Set OP were UI-only labels that map to Reference UP and Reference OP
      // These deprecated fields have been consolidated into the Reference fields
      // Depolarization_interval and logging_interval now use hh:mm:ss format only (no numeric versions)

      // Apply value mappings to convert string values to numeric codes
      const mappedParameters = this.applyValueMappings(parameters);

      // Create payload in the exact format requested
      let payload = {
        "Device ID": actualDeviceId,
        "Message Type": "settings",
        "sender": "Server",
        "Parameters": mappedParameters
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

            // Notify frontend that command was sent with set value info
            const commandSentData = {
              commandId,
              deviceId,
              command: 'settings',
              sentAt: new Date(),
              status: 'PENDING',
              topic
            };

            // Add specific information for set value commands
            if (payload?.Parameters) {
              const params = payload.Parameters;
              const setValue = {};
              
              if (params['Reference UP'] !== undefined) setValue.setUP = params['Reference UP'];
              if (params['Reference OP'] !== undefined) setValue.setOP = params['Reference OP'];
              if (params['Reference Fail'] !== undefined) setValue.refFail = params['Reference Fail'];
              
              if (Object.keys(setValue).length > 0) {
                commandSentData.setValues = setValue;
                commandSentData.isSetValueCommand = true;
              }
            }

            this.socketIO?.emit('deviceCommandSent', commandSentData);

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
    const currentSettings = this.ensureDeviceSettingsSync(deviceId);
    
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
      const currentSettings = await this.ensureDeviceSettings(deviceId);
      
      // Convert input settings to the proper parameter format
      const newSettings = {
        "Electrode": settingsConfig.Electrode !== undefined ? settingsConfig.Electrode : (settingsConfig.electrode !== undefined ? settingsConfig.electrode : currentSettings["Electrode"]),
        "Shunt Voltage": settingsConfig["Shunt Voltage"] !== undefined ? settingsConfig["Shunt Voltage"] : (settingsConfig.shuntVoltage !== undefined ? settingsConfig.shuntVoltage : currentSettings["Shunt Voltage"]),
        "Shunt Current": settingsConfig["Shunt Current"] !== undefined ? settingsConfig["Shunt Current"] : (settingsConfig.shuntCurrent !== undefined ? settingsConfig.shuntCurrent : currentSettings["Shunt Current"]),
        "Reference Fail": settingsConfig["Reference Fail"] !== undefined ? settingsConfig["Reference Fail"] : (settingsConfig.referenceFail !== undefined ? settingsConfig.referenceFail : currentSettings["Reference Fail"]),
        "Reference UP": settingsConfig["Reference UP"] !== undefined ? settingsConfig["Reference UP"] : (settingsConfig.referenceUP !== undefined ? settingsConfig.referenceUP : currentSettings["Reference UP"]),
        "Reference OP": settingsConfig["Reference OP"] !== undefined ? settingsConfig["Reference OP"] : (settingsConfig["Reference OV"] !== undefined ? settingsConfig["Reference OV"] : (settingsConfig.referenceOP !== undefined ? settingsConfig.referenceOP : currentSettings["Reference OP"])),
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
    const settings = this.deviceSettings.get(deviceId) || null;
    console.log(`📖 Getting device settings for device ${deviceId}:`, settings ? 'Found' : 'Not found');
    if (settings) {
      console.log(`📖 Device ${deviceId} current settings:`, {
        'Shunt Voltage': settings['Shunt Voltage'],
        'Shunt Current': settings['Shunt Current'],
        totalParams: Object.keys(settings).length
      });
    }
    return settings;
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
    
    // Use dynamic timeout based on device's logging interval if available
    const deviceLoggingData = this.deviceLoggingIntervals.get(deviceId);
    const timeout = deviceLoggingData ? deviceLoggingData.timeout : this.DEVICE_TIMEOUT;
    
    return timeSinceActivity < timeout;
  }
  
  // Check if any device is active
  isAnyDeviceActive() {
    const now = Date.now();
    for (const [deviceId, lastActivity] of this.deviceLastActivity.entries()) {
      // Use dynamic timeout based on device's logging interval if available
      const deviceLoggingData = this.deviceLoggingIntervals.get(deviceId);
      const timeout = deviceLoggingData ? deviceLoggingData.timeout : this.DEVICE_TIMEOUT;
      
      if (now - lastActivity < timeout) {
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

  // Helper function to convert DMS (Degrees Minutes Seconds) to decimal format
  // Input: "19°03'N" or "072°52'E"
  // Output: "19.05" or "72.87"
  convertDMSToDecimal(dmsString) {
    if (!dmsString) return null;
    
    try {
      const dmsStr = String(dmsString).trim();
      
      // Pattern: 19°03'N or 072°52'E
      const pattern = /(\d+)°(\d+)'([NSEW])/i;
      const match = dmsStr.match(pattern);
      
      if (!match) return null;
      
      const degrees = parseInt(match[1]);
      const minutes = parseInt(match[2]);
      const direction = match[3].toUpperCase();
      
      let decimal = degrees + (minutes / 60);
      
      // Apply direction (S and W are negative)
      if (direction === 'S' || direction === 'W') {
        decimal = -decimal;
      }
      
      return parseFloat(decimal.toFixed(4));
    } catch (error) {
      console.warn(`⚠️ Could not parse DMS coordinate: ${dmsString}`);
      return null;
    }
  }

  async saveTelemetryData(deviceId, payload) {
    try {
      const Telemetry = require('../models/telemetry');
      
      console.log(`\n${'='.repeat(80)}`);
      console.log(`📥 TELEMETRY SAVE START for device ${deviceId}`);
      console.log(`${'='.repeat(80)}`);
      console.log('📦 Incoming payload keys:', Object.keys(payload));
      console.log('📦 Full payload:', JSON.stringify(payload, null, 2).substring(0, 500) + '...');
      
      // Extract all data fields from payload, including Parameters if nested
      const dataFields = {};
      
      // Handle nested Parameters structure (real device format)
      if (payload.Parameters && typeof payload.Parameters === 'object') {
        console.log(`✓ Found nested Parameters object with ${Object.keys(payload.Parameters).length} fields`);
        Object.keys(payload.Parameters).forEach(key => {
          dataFields[key] = payload.Parameters[key];
        });
        console.log('📦 Extracted nested Parameters for telemetry');
        console.log('   Keys extracted:', Object.keys(dataFields).join(', '));
      } else {
        console.log('⚠️ No nested Parameters object found');
      }
      
      // Extract LATITUDE and LONGITUDE BEFORE they are excluded from dataFields
      // These will be used for reverse geocoding
      // Check both root level and nested Parameters
      const rawLatitude = payload.LATITUDE || (payload.Parameters && payload.Parameters.LATITUDE);
      const rawLongitude = payload.LONGITUDE || (payload.Parameters && payload.Parameters.LONGITUDE);
      console.log(`🔍 DEBUG - Raw coordinates from payload:`, {
        rawLatitude,
        rawLongitude,
        latitudeType: typeof rawLatitude,
        longitudeType: typeof rawLongitude,
        latitudeExists: rawLatitude !== undefined,
        longitudeExists: rawLongitude !== undefined,
        fromRoot: !!payload.LATITUDE,
        fromParameters: !!(payload.Parameters && payload.Parameters.LATITUDE)
      });
      
      // Also include root-level fields (simulator format)
      const beforeRootCount = Object.keys(dataFields).length;
      Object.keys(payload).forEach(key => {
        // Skip meta fields and location fields (handled separately), keep actual telemetry data
        if (!['Device ID', 'Message Type', 'sender', 'CommandId', 'Parameters', 'sn', 'SN', 'LATITUDE', 'LONGITUDE'].includes(key)) {
          dataFields[key] = payload[key];
        }
      });
      
      if (Object.keys(dataFields).length > beforeRootCount) {
        console.log(`✓ Added ${Object.keys(dataFields).length - beforeRootCount} root-level fields`);
      }

      // Ensure critical REF values are properly captured (but NOT latitude/longitude which are handled as location)
      const criticalFields = ['REF/OP', 'REF/UP', 'REF FAIL', 'REF_OP', 'REF_UP', 'REF_FAIL', 
       'DI1', 'DI2', 'DI3', 'DI4', 'DO1', 'REF1', 'REF2', 'REF3',
       'Digital Input 1', 'Digital Input 2', 'Digital Input 3', 'Digital Input 4', 'Digital Output'];
      
      let criticalAdded = 0;
      criticalFields.forEach(field => {
        if (payload[field] !== undefined) {
          dataFields[field] = payload[field];
          criticalAdded++;
        }
        if (payload.Parameters && payload.Parameters[field] !== undefined) {
          dataFields[field] = payload.Parameters[field];
          criticalAdded++;
        }
      });
      
      if (criticalAdded > 0) {
        console.log(`✓ Added ${criticalAdded} critical fields`);
      }

      console.log(`\n📊 FINAL DATA FIELDS SUMMARY:`);
      console.log(`   Total fields extracted: ${Object.keys(dataFields).length}`);
      console.log(`   Fields: ${Object.keys(dataFields).join(', ')}`);
      console.log(`   Sample values:`, Object.fromEntries(Object.entries(dataFields).slice(0, 5)));

      // Format location field if latitude and longitude are present
      let location = null;
      console.log(`📍 Location processing:`, {
        hasRawLatitude: !!rawLatitude,
        hasRawLongitude: !!rawLongitude,
        rawLatitude,
        rawLongitude
      });
      
      if (rawLatitude && rawLongitude && 
          rawLatitude !== '' && rawLongitude !== '') {
        
        console.log(`✓ Raw coordinates found, attempting conversion...`);
        
        // Convert DMS format to decimal if needed
        const lat = typeof rawLatitude === 'string' && rawLatitude.includes('°') 
          ? this.convertDMSToDecimal(rawLatitude)
          : parseFloat(rawLatitude);
        
        const lon = typeof rawLongitude === 'string' && rawLongitude.includes('°')
          ? this.convertDMSToDecimal(rawLongitude)
          : parseFloat(rawLongitude);
        
        console.log(`📐 Conversion result:`, {
          lat,
          lon,
          latIsNaN: isNaN(lat),
          lonIsNaN: isNaN(lon),
          latIsZero: lat === 0,
          lonIsZero: lon === 0
        });
        
        // Only set location if both are valid decimal numbers AND not zero/null coordinates
        if (!isNaN(lat) && !isNaN(lon) && (lat !== 0 || lon !== 0)) {
          console.log(`📍 Converted coordinates - Original: ${rawLatitude}, ${rawLongitude} → Decimal: ${lat}, ${lon}`);
          
          // Perform reverse geocoding to get human-readable location name
          try {
            console.log(`🌐 Calling reverseGeocodeLocation with lat=${lat}, lon=${lon}...`);
            const locationName = await this.reverseGeocodeLocation(lat, lon);
            console.log(`🌐 Reverse geocoding returned:`, locationName);
            
            if (locationName) {
              location = locationName;
              console.log(`✅ Reverse geocoding successful: ${locationName}`);
            } else {
              // Fallback to coordinates if reverse geocoding returns null
              location = `${lat}, ${lon}`;
              console.log(`⚠️ Reverse geocoding returned null, using coordinates: ${location}`);
            }
          } catch (geocodingError) {
            console.warn(`⚠️ Error during reverse geocoding: ${geocodingError.message}, using coordinates as fallback`);
            console.warn(`   Full error:`, geocodingError);
            location = `${lat}, ${lon}`;
          }
        } else {
          console.log(`❌ Coordinates are invalid (NaN or both zero), setting location to null`);
          location = null;
        }
      } else {
        console.log(`❌ Missing coordinates - lat: ${!!rawLatitude}, lon: ${!!rawLongitude}`);
        location = null;
      }

      console.log(`📝 Data fields to be saved (${Object.keys(dataFields).length} fields):`, dataFields);

      // Create telemetry record with explicit data assignment
      const telemetryRecord = new Telemetry({
        deviceId: deviceId,
        timestamp: new Date(),
        event: payload.EVENT || payload.Event || 'NORMAL',
        location: location  // Add location field for easy access in frontend
      });
      
      // Assign data field separately to ensure it's properly set
      telemetryRecord.data = new Map(Object.entries(dataFields));
      
      console.log(`🔍 Telemetry record before save:`, {
        deviceId: telemetryRecord.deviceId,
        timestamp: telemetryRecord.timestamp,
        event: telemetryRecord.event,
        data: telemetryRecord.data,
        location: telemetryRecord.location,
        dataFieldsCount: telemetryRecord.data.size
      });

      console.log(`\n💾 SAVING TO DATABASE...`);
      console.log(`   dataFields before save: ${JSON.stringify(dataFields).substring(0, 200)}...`);
      
      const saveResult = await telemetryRecord.save();
      
      console.log(`✅ Save completed successfully`);
      console.log(`   Document ID: ${saveResult._id}`);
      console.log(`   Data field type after save: ${typeof saveResult.data}`);
      console.log(`   Data field instanceof Map: ${saveResult.data instanceof Map}`);
      console.log(`   Saved telemetry data for device ${deviceId} with ${Object.keys(dataFields).length} data fields`);
      console.log('📊 Saved fields:', Object.keys(dataFields).join(', '));
      if (location) {
        console.log(`📍 Saved location: ${location}`);
      }
      
      // Verify the saved record by fetching it back IMMEDIATELY using raw query first
      console.log(`\n🔍 VERIFICATION PHASE:`);
      console.log(`   Fetching saved record from DB using findById...`);
      
      const savedRecord = await Telemetry.findById(telemetryRecord._id);
      console.log(`   Record fetched, data type: ${typeof savedRecord.data}`);
      console.log(`   Data is Map: ${savedRecord.data instanceof Map}`);
      console.log(`   Raw data value:`, savedRecord.data);
      
      const savedDataObj = savedRecord.data instanceof Map 
        ? Object.fromEntries(savedRecord.data)
        : (savedRecord.data || {});
      
      console.log(`\n📊 VERIFICATION RESULTS:`);
      console.log(`   recordId: ${savedRecord._id}`);
      console.log(`   dataFieldsCount: ${Object.keys(savedDataObj).length}`);
      console.log(`   dataKeys: ${Object.keys(savedDataObj).join(', ') || '(EMPTY)'}`);
      
      if (Object.keys(savedDataObj).length > 0) {
        console.log(`   ✅ Data was properly saved!`);
        console.log(`   Sample data:`, Object.fromEntries(Object.entries(savedDataObj).slice(0, 5)));
      } else {
        console.log(`   ❌ WARNING: Saved data is EMPTY! Check if dataFields was populated correctly`);
      }
      
      // Check alarms for this device data
      const event = payload.EVENT || payload.Event || 'NORMAL';
      await alarmMonitoringService.checkAlarmsForDevice(payload, deviceId, event);
      
      // Check if payload contains device settings and save them
      await this.saveDeviceSettings(deviceId, payload, 'system');
      
      console.log(`${'='.repeat(80)}\n`);
      
    } catch (error) {
      console.error(`${'='.repeat(80)}`);
      console.error(`❌ ERROR SAVING TELEMETRY DATA`);
      console.error(`   Device: ${deviceId}`);
      console.error(`   Error message: ${error.message}`);
      console.error(`   Error code: ${error.code}`);
      console.error(`   Stack: ${error.stack}`);
      console.error(`   Full error object:`, error);
      console.error(`${'='.repeat(80)}\n`);
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
                         settingsPayload['logging_interval'] !== undefined ||
                         settingsPayload['Depolarization_interval'] !== undefined ||
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
        referenceOP: settingsPayload['Reference OP'] !== undefined ? settingsPayload['Reference OP'] : (settingsPayload['Reference OV'] !== undefined ? settingsPayload['Reference OV'] : currentSettings.referenceOP || 0),
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
        // Logging and Depolarization configuration
        logging_Interval: settingsPayload['logging_interval'] !== undefined ? settingsPayload['logging_interval'] : (settingsPayload['Logging Interval'] !== undefined ? settingsPayload['Logging Interval'] : currentSettings.loggingInterval || '00:00:10'),
        dpolInterval: settingsPayload['Depolarization_interval'] !== undefined ? settingsPayload['Depolarization_interval'] : currentSettings.dpolInterval || '00:00:00'
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
        "Reference Fail": settingsPayload['Reference Fail'] !== undefined ? settingsPayload['Reference Fail'] : currentSettings.referenceFail || 0.30,
        "Reference UP": settingsPayload['Reference UP'] !== undefined ? settingsPayload['Reference UP'] : currentSettings.referenceUP || 0.30,
        "Reference OP": settingsPayload['Reference OP'] !== undefined ? settingsPayload['Reference OP'] : (settingsPayload['Reference OV'] !== undefined ? settingsPayload['Reference OV'] : currentSettings.referenceOP || 0.70),
        "Interrupt ON Time": settingsPayload['Interrupt ON Time'] !== undefined ? settingsPayload['Interrupt ON Time'] : currentSettings.interruptOnTime || 86400,
        "Interrupt OFF Time": settingsPayload['Interrupt OFF Time'] !== undefined ? settingsPayload['Interrupt OFF Time'] : currentSettings.interruptOffTime || 86400,
        "Interrupt Start TimeStamp": settingsPayload['Interrupt Start TimeStamp'] !== undefined ? settingsPayload['Interrupt Start TimeStamp'] : currentSettings.interruptStartTimestamp || new Date().toISOString().replace('T', ' ').substring(0, 19),
        "Interrupt Stop TimeStamp": settingsPayload['Interrupt Stop TimeStamp'] !== undefined ? settingsPayload['Interrupt Stop TimeStamp'] : currentSettings.interruptStopTimestamp || new Date().toISOString().replace('T', ' ').substring(0, 19),
        "Depolarization_interval": settingsPayload['Depolarization_interval'] !== undefined ? settingsPayload['Depolarization_interval'] : currentSettings.dpolInterval || "00:00:00",
        "logging_interval": settingsPayload['logging_interval'] !== undefined ? settingsPayload['logging_interval'] : currentSettings.loggingInterval || "00:10:00",
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
  /**
   * Normalize parameter keys from capitalized format (from device/frontend) to camelCase (for storage)
   * Maps frontend keys like "Electrode", "Event" to backend keys like "electrode", "event"
   */
  normalizeParameterKeys(settings) {
    const keyMapping = {
      'Electrode': 'electrode',
      'Event': 'event',
      'Manual Mode Action': 'manualModeAction',
      'Shunt Voltage': 'shuntVoltage',
      'Shunt Current': 'shuntCurrent',
      'Reference Fail': 'referenceFail',
      'Reference UP': 'referenceUP',
      'Reference OP': 'referenceOP',
      'Reference OV': 'referenceOP', // Handle both OP and OV variants
      'DI1': 'di1',
      'DI2': 'di2',
      'DI3': 'di3',
      'DI4': 'di4',
      'Interrupt ON Time': 'interruptOnTime',
      'Interrupt OFF Time': 'interruptOffTime',
      'Interrupt Start TimeStamp': 'interruptStartTimestamp',
      'Interrupt Stop TimeStamp': 'interruptStopTimestamp',
      'Depolarization Interval': 'dpolInterval',
      'DPOL Interval': 'dpolInterval',
      'Depolarization_interval': 'dpolInterval',
      'Depolarization Start TimeStamp': 'depolarizationStartTimestamp',
      'Depolarization Stop TimeStamp': 'depolarizationStopTimestamp',
      'Instant Mode': 'instantMode',
      'Instant Start TimeStamp': 'instantStartTimestamp',
      'Instant End TimeStamp': 'instantEndTimestamp',
      'logging_interval': 'loggingInterval'
    };

    const normalized = {};
    
    for (const [key, value] of Object.entries(settings)) {
      // Check if this key needs mapping
      const mappedKey = keyMapping[key];
      if (mappedKey) {
        normalized[mappedKey] = value;
        console.log(`  📝 Mapped "${key}" → "${mappedKey}": ${value}`);
      } else {
        // Keep unmapped keys as-is (already camelCase or unknown)
        normalized[key] = value;
      }
    }
    
    return normalized;
  }

  async mergeAndSaveDeviceSettings(deviceId, newSettings, updatedBy = 'user') {
    try {
      const Device = require('../models/Device');
      
      console.log(`🔄 Merging settings for device ${deviceId}`);
      console.log(`📥 New settings from ${updatedBy} (before normalization):`, JSON.stringify(newSettings, null, 2));

      // Normalize parameter keys from capitalized to camelCase
      const normalizedSettings = this.normalizeParameterKeys(newSettings);
      console.log(`✅ Normalized settings:`, JSON.stringify(normalizedSettings, null, 2));

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
        ...normalizedSettings
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
      console.error(`❌ Stack trace:`, error.stack);
      if (error.errors) {
        console.error(`❌ Validation errors:`, JSON.stringify(error.errors, null, 2));
      }
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
      console.log(`📦 Full payload keys:`, Object.keys(payload));
      
      // List of the 18+ device parameters to look for (including both MQTT format variations)
      const DEVICE_PARAMETERS = [
        'Electrode', 'Event', 'Manual Mode Action', 'Shunt Voltage', 'Shunt Current',
        'Reference Fail', 'Reference UP', 'Reference OP', 'Reference OV', 'Interrupt ON Time', 'Interrupt OFF Time',
        'Interrupt Start TimeStamp', 'Interrupt Stop TimeStamp', 'DPOL Interval',
        'Depolarization_interval', 'logging_interval',  // Device sends these with underscores
        'Depolarization Start TimeStamp', 'Depolarization Stop TimeStamp', 'Instant Mode',
        'Instant Start TimeStamp', 'Instant End TimeStamp'
      ];
      
      console.log(`🔎 Looking for these parameters:`, DEVICE_PARAMETERS);
      
      // Extract device parameters from payload and convert Reference/Set values from integer to decimal format
      const deviceSettings = {};
      let foundParameters = 0;
      
      // List of parameter name variations that need integer-to-decimal conversion
      const REFERENCE_PARAMS = [
        'Reference Fail', 'Reference UP', 'Reference OP',
        'Set Fail', 'Set UP', 'Set OP',
        'Ref Fail', 'RefFail', 'SetFail'
      ];
      
      for (const param of DEVICE_PARAMETERS) {
        if (payload[param] !== undefined) {
          let value = payload[param];
          
          // Convert all Reference/Set values from integer format back to decimal format
          // Examples: 380 → 3.80, 160 → 1.60, 030 → 0.30
          // If value is already in decimal range (< 5), it's already decimal format - don't convert
          if (REFERENCE_PARAMS.includes(param) && typeof value === 'number') {
            // If already in decimal range (< 5), it's already formatted - just toFixed
            if (value < 5) {
              value = parseFloat(value).toFixed(2);
              console.log(`🔄 ${param} already in decimal format: ${payload[param]} → ${value}`);
            } else {
              // Convert from integer to decimal: 380 → 3.80
              value = (value / 100).toFixed(2);
              console.log(`🔄 Converted ${param} from device format ${payload[param]} to ${value}`);
            }
          } else if (REFERENCE_PARAMS.includes(param) && typeof value === 'string') {
            // If it's already a string, check if it needs conversion
            const numVal = parseFloat(value);
            if (!isNaN(numVal)) {
              if (numVal < 5) {
                // Already in decimal format
                value = numVal.toFixed(2);
                console.log(`🔄 ${param} already in decimal format: ${payload[param]} → ${value}`);
              } else {
                // Integer format - divide by 100
                value = (numVal / 100).toFixed(2);
                console.log(`🔄 Converted ${param} from device string format ${payload[param]} to ${value}`);
              }
            }
          }
          
          deviceSettings[param] = value;
          foundParameters++;
          console.log(`📋 Found parameter: ${param} = ${value}`);
        }
      }
      
      if (foundParameters > 0) {
        console.log(`✅ Found ${foundParameters} device parameters, storing in database`);
        console.log(`📋 Extracted settings object:`, JSON.stringify(deviceSettings, null, 2));
        
        // Map Reference/Set field names for frontend display consistency
        // Frontend expects: 'Set UP', 'Set OP', 'Set Fail'
        const displaySettings = { ...deviceSettings };
        
        // Add display names - explicitly check for null/undefined, not truthiness (0.70 is falsy in some contexts)
        if ('Reference UP' in displaySettings && displaySettings['Reference UP'] !== null && displaySettings['Reference UP'] !== undefined) {
          displaySettings['Set UP'] = displaySettings['Reference UP'];
        }
        if ('Reference OP' in displaySettings && displaySettings['Reference OP'] !== null && displaySettings['Reference OP'] !== undefined) {
          displaySettings['Set OP'] = displaySettings['Reference OP'];
        }
        if ('Reference Fail' in displaySettings && displaySettings['Reference Fail'] !== null && displaySettings['Reference Fail'] !== undefined) {
          displaySettings['Set Fail'] = displaySettings['Reference Fail'];
        }
        
        // Store settings using device management service (preserving original timestamps)
        if (this.deviceManagementService) {
          // Map to internal field names for database storage
          const mappedSettings = this.deviceManagementService.mapParametersToInternalFields(deviceSettings);
          console.log(`🗺️ Mapped settings for database:`, JSON.stringify(mappedSettings, null, 2));
          await this.deviceManagementService.storeDeviceSettings(deviceId, mappedSettings, 'mqtt_incoming');
          console.log(`💾 Device settings stored in database for device ${deviceId}`);
          
          // Store BOTH formats in memory - original parameter names AND display names for frontend
          const currentMemorySettings = this.deviceSettings.get(deviceId) || {};
          const updatedMemorySettings = { ...currentMemorySettings, ...displaySettings };
          this.deviceSettings.set(deviceId, updatedMemorySettings);
          console.log(`💾 Device settings stored in memory for device ${deviceId}`);
          console.log(`📝 Memory cache now contains:`, JSON.stringify(updatedMemorySettings, null, 2));
          
          // Emit real-time update to frontend with display names
          if (this.socketIO) {
            this.socketIO.emit('deviceSettingsUpdate', {
              deviceId,
              settings: displaySettings,
              source: 'device',
              timestamp: new Date().toISOString()
            });
            console.log(`📡 Sent real-time device settings update to frontend`);
          }
        }
      } else {
        console.log(`ℹ️ No device parameters found in payload for device ${deviceId}`);
      }

      // Extract and store logging interval for dynamic timeout calculation
      const loggingInterval = payload.logging_interval || payload.loggingInterval;
      if (loggingInterval) {
        let intervalSeconds = 0;
        
        if (typeof loggingInterval === 'number') {
          // If it's already in seconds, use it directly
          intervalSeconds = loggingInterval;
        } else if (typeof loggingInterval === 'string' && loggingInterval.includes(':')) {
          // If it's in HH:MM:SS format, convert to seconds
          intervalSeconds = hhmmssToSeconds(loggingInterval);
        }
        
        if (intervalSeconds > 0) {
          // Store the interval with 4x multiplier for timeout (allows 3 missed messages)
          const dynamicTimeout = intervalSeconds * 4 * 1000; // Convert to milliseconds
          this.deviceLoggingIntervals.set(deviceId, { intervalSeconds, timeout: dynamicTimeout });
          console.log(`⏱️ Device ${deviceId} logging interval: ${intervalSeconds}s → dynamic timeout: ${(dynamicTimeout / 1000).toFixed(1)}s`);
        }
      }
      
    } catch (error) {
      console.error(`❌ Error extracting device settings for device ${deviceId}:`, error.message);
    }
  }

  // Function to reverse geocode coordinates to location name
  // Uses free APIs with timeout fallback to coordinate-based names
  async reverseGeocodeLocation(lat, lon) {
    try {
      // Try local geocoding cache first (for frequently accessed locations)
      const localLocationName = this.getLocalLocationName(lat, lon);
      if (localLocationName) {
        console.log(`📍 Found location in local cache: ${localLocationName}`);
        return localLocationName;
      }
      
      // Primary: Nominatim with high zoom for precise city-level location
      console.log(`🌐 Attempting Nominatim reverse geocoding for ${lat}, ${lon}...`);
      
      // Retry logic for Nominatim (timeout issues are common on cloud platforms like Render)
      let nominatimResp = null;
      for (let attempt = 1; attempt <= 2; attempt++) {
        try {
          const controller = new AbortController();
          const timeoutId = setTimeout(() => controller.abort(), 12000); // 12 second timeout (increased for Render)
          
          try {
            nominatimResp = await fetch(
              `https://nominatim.openstreetmap.org/reverse?format=json&lat=${lat}&lon=${lon}&zoom=18&addressdetails=1`,
              {
                headers: {
                  'Accept': 'application/json',
                  'User-Agent': 'ASHECONTROL-IoT-Device-Service/1.0'
                },
                signal: controller.signal
              }
            );
            
            clearTimeout(timeoutId);
            break; // Success, exit retry loop
          } catch (fetchError) {
            clearTimeout(timeoutId);
            if (attempt < 2) {
              console.log(`  ⚠️ Nominatim attempt ${attempt} failed, retrying...`);
              await new Promise(resolve => setTimeout(resolve, 500)); // 500ms delay before retry
            } else {
              throw fetchError;
            }
          }
        } catch (err) {
          if (attempt === 2) throw err;
        }
      }
  
      if (nominatimResp && nominatimResp.ok) {
        const data = await nominatimResp.json();
        if (data && data.address) {
          const parts = [];
          
          // Add detailed address components in order of specificity (most specific first)
          // Zone/Area/Neighbourhood
          if (data.address.neighbourhood) parts.push(data.address.neighbourhood);
          else if (data.address.suburb) parts.push(data.address.suburb);
          else if (data.address.city_district) parts.push(data.address.city_district);
          
          // City/Town/Village
          if (data.address.city) parts.push(data.address.city);
          else if (data.address.town) parts.push(data.address.town);
          else if (data.address.village) parts.push(data.address.village);
          else if (data.address.hamlet) parts.push(data.address.hamlet);
          
          // District/County level
          if (data.address.county) parts.push(data.address.county);
          else if (data.address.state_district) parts.push(data.address.state_district);
          
          // State/Province
          if (data.address.state) parts.push(data.address.state);
          
          // Country (optional - only add if not already in parts)
          if (data.address.country && parts.length < 4) parts.push(data.address.country);
          
          if (parts.length > 0) {
            // Remove duplicates while preserving order
            const locationName = Array.from(new Set(parts)).join(', ');
            this.cacheLocalLocation(lat, lon, locationName);
            console.log(`✅ Nominatim reverse geocoding successful: ${locationName}`);
            return locationName;
          }
        }
      }
      
      console.log(`⚠️ Nominatim failed or returned empty result, trying fallback methods...`);
      // Fallback: Pre-defined common locations (works even when all APIs fail)
      const commonLocationName = this.getCommonLocation(lat, lon);
      if (commonLocationName) {
        console.log(`📍 Using pre-defined location: ${commonLocationName}`);
        this.cacheLocalLocation(lat, lon, commonLocationName);
        return commonLocationName;
      }
      
      // Fallback: OpenWeather (completely free, no API key)
      console.log(`🌐 Trying OpenWeather as final fallback...`);
      return await this.reverseGeocodeLocationOpenWeather(lat, lon);
    } catch (error) {
      console.warn(`⚠️ Reverse geocoding error for ${lat}, ${lon}:`, error.message);
      // Try pre-defined locations as last resort
      const commonLocationName = this.getCommonLocation(lat, lon);
      if (commonLocationName) {
        console.log(`📍 Using pre-defined location (error fallback): ${commonLocationName}`);
        return commonLocationName;
      }
      console.warn(`⚠️ All geocoding methods failed for ${lat}, ${lon}`);
      return null;
    }
  }

  // Fallback: OpenWeather - Free, no API key required
  async reverseGeocodeLocationOpenWeather(lat, lon) {
    try {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 8000); // 8 second timeout (increased for Render)
      
      try {
        console.log(`🌐 Attempting OpenWeather reverse geocoding for ${lat}, ${lon}...`);
        const response = await fetch(
          `https://api.openweathermap.org/geo/1.0/reverse?lat=${lat}&lon=${lon}&limit=1`,
          {
            headers: {
              'Accept': 'application/json',
              'User-Agent': 'ASHECONTROL-IoT-Device-Service/1.0'
            },
            signal: controller.signal
          }
        );
        
        if (!response.ok) {
          console.warn(`⚠️ OpenWeather API error: ${response.status}`);
          return null;
        }
        
        const data = await response.json();
        
        if (data && data.length > 0) {
          const result = data[0];
          const parts = [];
          
          // Extract meaningful location parts in priority order
          if (result.name) parts.push(result.name);
          if (result.state) parts.push(result.state);
          if (result.country) parts.push(result.country);
          
          if (parts.length > 0) {
            const locationName = Array.from(new Set(parts)).join(', ');
            this.cacheLocalLocation(lat, lon, locationName);
            console.log(`✅ OpenWeather resolved location: ${locationName}`);
            return locationName;
          }
        }
        
        console.log(`⚠️ OpenWeather returned no address data`);
        return null;
      } finally {
        clearTimeout(timeoutId);
      }
    } catch (error) {
      console.warn(`⚠️ OpenWeather reverse geocoding failed for ${lat}, ${lon}:`, error.message);
      return null;
    }
  }

  // Simple location caching for frequently accessed coordinates
  getLocalLocationName(lat, lon) {
    // First check runtime cache (coordinates rounded to 2 decimals)
    const cacheKey = `${Math.round(lat * 100) / 100},${Math.round(lon * 100) / 100}`;
    
    if (this.locationCache && this.locationCache[cacheKey]) {
      const cached = this.locationCache[cacheKey];
      // Check if cache is less than 24 hours old
      if (Date.now() - cached.timestamp < 24 * 60 * 60 * 1000) {
        console.log(`📍 Using cached location: ${cached.name}`);
        return cached.name;
      }
    }
    
    return null;
  }

  // Get pre-defined common locations as fallback when APIs fail
  getCommonLocation(lat, lon) {
    const commonLocations = [
      { lat: 19.05, lon: 72.87, name: 'Mumbai, Maharashtra, India', tolerance: 0.05 },  // Mumbai
      { lat: 28.70, lon: 77.10, name: 'Delhi, India', tolerance: 0.05 },                 // Delhi
      { lat: 13.34, lon: 74.74, name: 'Mangalore, Karnataka, India', tolerance: 0.05 },  // Mangalore
      { lat: 15.50, lon: 73.83, name: 'Goa, India', tolerance: 0.05 },                   // Goa
      { lat: 12.97, lon: 77.59, name: 'Bangalore, Karnataka, India', tolerance: 0.05 },  // Bangalore
      { lat: 18.52, lon: 73.86, name: 'Pune, Maharashtra, India', tolerance: 0.05 },    // Pune
    ];
    
    // Check if coordinates match any common location (within tolerance)
    for (const location of commonLocations) {
      if (Math.abs(lat - location.lat) < location.tolerance && Math.abs(lon - location.lon) < location.tolerance) {
        console.log(`📍 Matched pre-defined location: ${location.name}`);
        return location.name;
      }
    }
    
    return null;

  // Cache resolved locations for 24 hours
  cacheLocalLocation(lat, lon, name) {
    // Round to 2 decimal places for caching
    const key = `${Math.round(lat * 100) / 100},${Math.round(lon * 100) / 100}`;
    
    if (!this.locationCache) {
      this.locationCache = {};
    }
    
    this.locationCache[key] = {
      name,
      timestamp: Date.now()
    };
    
    console.log(`💾 Cached location: ${key} → ${name}`);
  }

  // Function to emit active device locations for map display
  async emitActiveDeviceLocations(deviceId, payload) {
    try {
      let latitude = null;
      let longitude = null;
      let deviceName = payload.API || `Device ${deviceId}`;
      let locationName = null;
      
      // Get latitude/longitude from MQTT payload
      if (payload.LATITUDE && payload.LONGITUDE && 
          (payload.LATITUDE !== 0 || payload.LONGITUDE !== 0) &&
          typeof payload.LATITUDE === 'number' && 
          typeof payload.LONGITUDE === 'number') {
        latitude = payload.LATITUDE;
        longitude = payload.LONGITUDE;
        
        // Perform reverse geocoding to get location name
        locationName = await this.reverseGeocodeLocation(latitude, longitude);
        console.log(`📍 Device ${deviceId} coordinates: ${latitude}, ${longitude} → ${locationName || 'Unknown'}`);
      } else {
        console.log(`⚠️ Device ${deviceId} has invalid or missing LATITUDE/LONGITUDE in payload`);
        return;
      }
      
      // Only emit if we have valid coordinates
      if (latitude !== null && longitude !== null) {
        const deviceLocationData = {
          deviceId: deviceId,
          name: deviceName,
          latitude: latitude,
          longitude: longitude,
          location: locationName,
          timestamp: payload.TimeStamp || new Date().toISOString(),
          isActive: true,
          lastSeen: Date.now()
        };
        
        // Store device location for summary emission
        this.deviceLocations.set(deviceId, {
          name: deviceLocationData.name,
          latitude: deviceLocationData.latitude,
          longitude: deviceLocationData.longitude,
          location: locationName
        });
        
        console.log(`📍 Device ${deviceId} location data:`, deviceLocationData);
        
        // Emit to frontend for real-time map updates
        if (this.socketIO) {
          this.socketIO.emit('deviceLocationUpdate', deviceLocationData);
          console.log(`🗺️ Sent device location update to frontend for device ${deviceId}`);
        }
        
        // Emit consolidated active devices locations periodically (every 10 seconds)
        this.emitActiveDevicesLocationsSummary();
      }
    } catch (error) {
      console.error(`❌ Error processing device location for device ${deviceId}:`, error.message);
    }
  }

  // Function to emit summary of all active device locations
  emitActiveDevicesLocationsSummary() {
    try {
      // Throttle this emission to avoid spam - only emit every 10 seconds
      const now = Date.now();
      if (this.lastLocationSummaryEmit && (now - this.lastLocationSummaryEmit) < 10000) {
        return; // Skip if called within last 10 seconds
      }
      this.lastLocationSummaryEmit = now;
      
      const activeDevices = [];
      const activeDeviceTimeout = 15000; // 15 seconds timeout for active devices
      
      // Store device locations temporarily for summary
      if (!this.deviceLocations) {
        this.deviceLocations = new Map();
      }
      
      // Check which devices are still active based on last activity
      for (const [deviceId, lastActivity] of this.deviceLastActivity.entries()) {
        if (now - lastActivity <= activeDeviceTimeout) {
          const deviceLocation = this.deviceLocations.get(deviceId);
          
          if (deviceLocation && 
              deviceLocation.latitude && deviceLocation.longitude &&
              (deviceLocation.latitude !== 0 || deviceLocation.longitude !== 0)) {
            
            activeDevices.push({
              deviceId: deviceId,
              name: deviceLocation.name || `Device ${deviceId}`,
              latitude: deviceLocation.latitude,
              longitude: deviceLocation.longitude,
              lastSeen: lastActivity,
              isActive: true
            });
          }
        }
      }
      
      if (activeDevices.length > 0) {
        console.log(`🗺️ Emitting ${activeDevices.length} active device locations to frontend`);
        
        // Emit to frontend
        if (this.socketIO) {
          this.socketIO.emit('activeDevicesLocations', {
            devices: activeDevices,
            timestamp: new Date().toISOString(),
            count: activeDevices.length
          });
        }
      }
    } catch (error) {
      console.error('❌ Error emitting active devices locations summary:', error.message);
    }
  }

  /**
   * Publish settings directly to device via MQTT
   * Used by the new settings caching endpoints
   * Topic: devices/{deviceId}/settings (not /command)
   */
  publishSettingsToDevice(deviceId, settingsMessage) {
    return new Promise((resolve) => {
      try {
        if (!this.client || !this.client.connected) {
          console.warn(`⚠️ MQTT client not connected`);
          return resolve({
            success: false,
            error: 'MQTT client not connected'
          });
        }

        // Use correct topic: devices/{deviceId}/settings
        const topic = `devices/${deviceId}/settings`;
        console.log(`📤 Publishing to topic: ${topic}`);
        console.log(`   Message:`, JSON.stringify(settingsMessage, null, 2));

        this.client.publish(topic, JSON.stringify(settingsMessage), { qos: 1 }, (error) => {
          if (error) {
            console.error(`❌ MQTT publish error:`, error);
            resolve({
              success: false,
              error: error.message
            });
          } else {
            console.log(`✅ Settings published to device ${deviceId}`);
            resolve({
              success: true,
              message: 'Settings published successfully'
            });
          }
        });
      } catch (error) {
        console.error('❌ Error publishing settings:', error);
        resolve({
          success: false,
          error: error.message
        });
      }
    });
  }

  /**
   * Publish complete settings command to device via MQTT commands topic
   * Used for bulk settings updates with proper command format
   * Topic: devices/{deviceId}/commands
   * Will wait up to 5 seconds for MQTT connection if not ready
   */
  publishCompleteSettingsCommand(deviceId, settingsMessage) {
    return new Promise((resolve) => {
      try {
        // If client is not ready, try to wait for it
        if (!this.client || !this.client.connected) {
          console.warn(`⚠️ MQTT client not connected, waiting for connection...`);
          
          // Wait up to 5 seconds for connection
          let waitAttempts = 0;
          const maxAttempts = 50; // 50 * 100ms = 5 seconds
          
          const waitForConnection = () => {
            if (this.client && this.client.connected) {
              console.log(`✅ MQTT connection established, publishing message...`);
              this.publishCompleteSettingsCommand(deviceId, settingsMessage).then(resolve);
              return;
            }
            
            waitAttempts++;
            if (waitAttempts < maxAttempts) {
              setTimeout(waitForConnection, 100);
            } else {
              console.error(`❌ MQTT client did not connect within 5 seconds`);
              resolve({
                success: false,
                error: 'MQTT client not connected (timeout after 5 seconds)'
              });
            }
          };
          
          waitForConnection();
          return;
        }

        // Use commands topic for bulk settings updates
        const topic = `devices/${deviceId}/commands`;
        console.log(`📤 Publishing settings command to topic: ${topic}`);
        console.log(`   Message:`, JSON.stringify(settingsMessage, null, 2));

        this.client.publish(topic, JSON.stringify(settingsMessage), { qos: 1 }, (error) => {
          if (error) {
            console.error(`❌ MQTT publish error:`, error);
            resolve({
              success: false,
              error: error.message
            });
          } else {
            console.log(`✅ Settings command published to device ${deviceId}`);
            resolve({
              success: true,
              message: 'Settings command published successfully'
            });
          }
        });
      } catch (error) {
        console.error('❌ Error publishing settings command:', error);
        resolve({
          success: false,
          error: error.message
        });
      }
    });
  }

  /**
   * Update device settings in memory cache
   * Used by controller to sync staged changes before sending via MQTT
   */
  updateDeviceSettingsCache(deviceId, settingsUpdate) {
    try {
      const currentSettings = this.deviceSettings.get(deviceId) || {};
      const updatedSettings = {
        ...currentSettings,
        ...settingsUpdate  // Merge new settings over existing
      };
      this.deviceSettings.set(deviceId, updatedSettings);
      console.log(`✅ Updated MQTT cache for device ${deviceId} with new settings`);
      return { success: true, updatedSettings };
    } catch (error) {
      console.error(`❌ Error updating device settings cache for ${deviceId}:`, error.message);
      return { success: false, error: error.message };
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