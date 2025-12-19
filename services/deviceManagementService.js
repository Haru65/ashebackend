const Device = require('../models/Device');
const { v4: uuidv4 } = require('uuid');

/**
 * Core Device Management Service
 * Handles device creation, configuration storage, and settings management
 */
class DeviceManagementService {
  
  /**
   * Register a new device in the database
   * @param {Object} deviceData - Device information
   * @returns {Object} Created device object
   */
  async registerDevice(deviceData) {
    try {
      const {
        deviceId,
        name,
        type = 'sensor',
        brokerUrl = 'mqtt://localhost:1883',
        topics = [],
        location = {},
        initialSettings = {}
      } = deviceData;

      // Check if device already exists
      const existingDevice = await Device.findByDeviceId(deviceId);
      if (existingDevice) {
        throw new Error(`Device with ID ${deviceId} already exists`);
      }

      // Create new device with default settings
      const newDevice = new Device({
        deviceId,
        name,
        type,
        mqtt: {
          brokerUrl,
          topics: topics.length > 0 ? topics : [`devices/${deviceId}/telemetry`, `devices/${deviceId}/settings`],
          options: {
            qos: 1,
            keepalive: 60,
            clientId: `server_${deviceId}`,
            clean: true
          }
        },
        location,
        status: 'inactive',
        configuration: {
          currentMode: 'Unknown',
          deviceSettings: this.getDefaultDeviceSettings(),
          ...initialSettings,
          lastConfigUpdate: new Date(),
          source: 'manual_entry'
        },
        syncStatus: {
          isOnline: false,
          pendingRequests: [],
          syncErrors: []
        }
      });

      const savedDevice = await newDevice.save();
      console.log(`✅ Device registered successfully: ${deviceId}`);
      
      return savedDevice;
    } catch (error) {
      console.error('❌ Error registering device:', error);
      throw error;
    }
  }

  /**
   * Store complete device settings in database
   * @param {String} deviceId - Device identifier
   * @param {Object} settings - Complete device settings
   * @param {String} source - Source of the settings update
   * @returns {Object} Updated device object
   */
  async storeDeviceSettings(deviceId, settings, source = 'command_sent') {
    try {
      const device = await Device.findByDeviceId(deviceId);
      if (!device) {
        throw new Error(`Device ${deviceId} not found`);
      }

      // Merge new settings with existing ones
      const updatedSettings = {
        ...device.configuration.deviceSettings,
        ...settings
      };

      // Update device configuration
      device.configuration.deviceSettings = updatedSettings;
      device.configuration.lastConfigUpdate = new Date();
      device.configuration.source = source;

      // Log the configuration change
      if (!device.configuration.configHistory) {
        device.configuration.configHistory = [];
      }

      device.configuration.configHistory.push({
        timestamp: new Date(),
        settings: { ...updatedSettings },
        source,
        changedFields: Object.keys(settings)
      });

      // Keep only last 50 configuration history entries
      if (device.configuration.configHistory.length > 50) {
        device.configuration.configHistory = device.configuration.configHistory.slice(-50);
      }

      const savedDevice = await device.save();
      console.log(`✅ Device settings stored for ${deviceId}`);
      
      return savedDevice;
    } catch (error) {
      console.error('❌ Error storing device settings:', error);
      throw error;
    }
  }

  /**
   * Get complete device settings
   * @param {String} deviceId - Device identifier
   * @returns {Object} Device settings in standardized format (without CommandId)
   */
  async getDeviceSettings(deviceId) {
    try {
      const device = await Device.findByDeviceId(deviceId);
      if (!device) {
        throw new Error(`Device ${deviceId} not found`);
      }

      const settings = device.configuration.deviceSettings || this.getDefaultDeviceSettings();
      
      console.log(`📖 Loading device settings from database for device ${deviceId}:`, settings);
      
      return {
        "Device ID": deviceId,
        "Message Type": "settings",
        "sender": "Server",
        "Parameters": {
          "Electrode": settings.electrode !== undefined ? settings.electrode : 0,
          "Event": settings.event !== undefined ? settings.event : 0,
          "Manual Mode Action": settings.manualModeAction !== undefined ? settings.manualModeAction : 0,
          "Shunt Voltage": settings.shuntVoltage !== undefined ? settings.shuntVoltage : 25.00,
          "Shunt Current": settings.shuntCurrent !== undefined ? settings.shuntCurrent : 99.00,
          "Reference Fail": settings.referenceFail !== undefined ? settings.referenceFail : 30,
          "Reference UP": settings.referenceUP !== undefined ? settings.referenceUP : 0.30,
          "Reference OP": settings.referenceOP !== undefined ? settings.referenceOP : 0.60,
          "Interrupt ON Time": settings.interruptOnTime !== undefined ? settings.interruptOnTime : 86400,
          "Interrupt OFF Time": settings.interruptOffTime !== undefined ? settings.interruptOffTime : 86400,
          "Interrupt Start TimeStamp": settings.interruptStartTimeStamp || settings.interruptStartTimestamp || "2025-02-20 19:04:00",
          "Interrupt Stop TimeStamp": settings.interruptStopTimeStamp || settings.interruptStopTimestamp || "2025-02-20 19:05:00",
          "Depolarization Start TimeStamp": settings.depolarizationStartTimeStamp || settings.depolarizationStartTimestamp || "2025-02-20 19:04:00",
          "Depolarization Stop TimeStamp": settings.depolarizationStopTimeStamp || settings.depolarizationStopTimestamp || "2025-02-20 19:05:00",
          "Instant Mode": settings.instantMode !== undefined ? settings.instantMode : 0,
          "Instant Start TimeStamp": settings.instantStartTimeStamp || settings.instantStartTimestamp || "19:04:00",
          "Instant End TimeStamp": settings.instantEndTimeStamp || settings.instantEndTimestamp || "00:00:00",
          "logging_interval": settings.logging_interval !== undefined ? settings.logging_interval : 600,
          "logging_interval_format": settings.logging_interval_format || "00:10:00"
        }
      };
    } catch (error) {
      console.error('❌ Error getting device settings:', error);
      throw error;
    }
  }

  /**
   * Get complete device settings WITH CommandId (for MQTT commands)
   * @param {String} deviceId - Device identifier
   * @param {String} commandId - Command tracking ID
   * @returns {Object} Device settings with CommandId for MQTT
   */
  async getDeviceSettingsWithCommandId(deviceId, commandId) {
    try {
      const device = await Device.findByDeviceId(deviceId);
      if (!device) {
        throw new Error(`Device ${deviceId} not found`);
      }

      const settings = device.configuration.deviceSettings || this.getDefaultDeviceSettings();
      
      // Return with CommandId ABOVE Parameters
      return {
        "Device ID": deviceId,
        "Message Type": "settings",
        "sender": "Server",
        "CommandId": commandId,
        "Parameters": {
          "Electrode": settings.electrode || 0,
          "Event": settings.event || 0,
          "Manual Mode Action": settings.manualModeAction || 0,
          "Shunt Voltage": settings.shuntVoltage || 25,
          "Shunt Current": settings.shuntCurrent || 999,
          "Reference Fail": settings.referenceFail || 30,
          "Reference UP": settings.referenceUP || 300,
          "Reference OV": settings.referenceOV || 60,
          "Interrupt ON Time": settings.interruptOnTime || 86400,
          "Interrupt OFF Time": settings.interruptOffTime || 86400,
          "Interrupt Start TimeStamp": settings.interruptStartTimestamp || new Date().toISOString().replace('T', ' ').substring(0, 19),
          "Interrupt Stop TimeStamp": settings.interruptStopTimestamp || new Date().toISOString().replace('T', ' ').substring(0, 19),
          "Depolarization Start TimeStamp": settings.depolarizationStartTimestamp || new Date().toISOString().replace('T', ' ').substring(0, 19),
          "Depolarization Stop TimeStamp": settings.depolarizationStopTimestamp || new Date().toISOString().replace('T', ' ').substring(0, 19),
          "Instant Mode": settings.instantMode || 0,
          "Instant Start TimeStamp": settings.instantStartTimestamp || "19:04:00",
          "Instant End TimeStamp": settings.instantEndTimestamp || "00:00:00"
        }
      };
    } catch (error) {
      console.error('❌ Error getting device settings with CommandId:', error);
      throw error;
    }
  }

  /**
   * Update specific device parameters and store complete settings
   * @param {String} deviceId - Device identifier
   * @param {Object} parameters - Parameters to update
   * @param {String} commandId - Optional command tracking ID
   * @returns {Object} Complete updated settings
   */
  async updateDeviceParameters(deviceId, parameters, commandId = null) {
    try {
      const device = await Device.findByDeviceId(deviceId);
      if (!device) {
        throw new Error(`Device ${deviceId} not found`);
      }

      // Get current settings
      const currentSettings = device.configuration.deviceSettings || this.getDefaultDeviceSettings();
      
      // Map incoming parameters to internal field names
      const mappedParameters = this.mapParametersToInternalFields(parameters);
      
      // Update specific parameters
      const updatedSettings = {
        ...currentSettings,
        ...mappedParameters
      };

      // Store complete updated settings
      await this.storeDeviceSettings(deviceId, updatedSettings, 'command_sent');

      // Track command if provided
      if (commandId) {
        await this.trackCommand(deviceId, commandId, 'parameter_update', parameters);
      }

      // Return complete settings in standardized format
      return await this.getDeviceSettings(deviceId);
    } catch (error) {
      console.error('❌ Error updating device parameters:', error);
      throw error;
    }
  }

  /**
   * Get all devices with their current settings
   * @returns {Array} Array of devices with settings
   */
  async getAllDevicesWithSettings() {
    try {
      const devices = await Device.find({})
        .select('deviceId name type status configuration.deviceSettings configuration.lastConfigUpdate syncStatus.isOnline')
        .lean();

      return devices.map(device => ({
        deviceId: device.deviceId,
        name: device.name,
        type: device.type,
        status: device.status,
        isOnline: device.syncStatus?.isOnline || false,
        settings: device.configuration?.deviceSettings || this.getDefaultDeviceSettings(),
        lastUpdate: device.configuration?.lastConfigUpdate
      }));
    } catch (error) {
      console.error('❌ Error getting all devices:', error);
      throw error;
    }
  }

  /**
   * Delete device and all its settings
   * @param {String} deviceId - Device identifier
   * @returns {Boolean} Success status
   */
  async deleteDevice(deviceId) {
    try {
      const result = await Device.deleteOne({ deviceId });
      if (result.deletedCount === 0) {
        throw new Error(`Device ${deviceId} not found`);
      }

      console.log(`✅ Device ${deviceId} deleted successfully`);
      return true;
    } catch (error) {
      console.error('❌ Error deleting device:', error);
      throw error;
    }
  }

  /**
   * Track command execution
   * @param {String} deviceId - Device identifier
   * @param {String} commandId - Command tracking ID
   * @param {String} commandType - Type of command
   * @param {Object} commandData - Command data
   */
  async trackCommand(deviceId, commandId, commandType, commandData) {
    try {
      const device = await Device.findByDeviceId(deviceId);
      if (!device) {
        throw new Error(`Device ${deviceId} not found`);
      }

      device.configuration.lastCommand = {
        type: commandType,
        data: commandData,
        timestamp: new Date()
      };

      await device.save();
      console.log(`✅ Command tracked for device ${deviceId}: ${commandId}`);
    } catch (error) {
      console.error('❌ Error tracking command:', error);
      throw error;
    }
  }

  /**
   * Mark command as successful
   * @param {String} deviceId - Device identifier
   * @param {String} commandId - Command tracking ID
   */
  async markCommandSuccess(deviceId, commandId) {
    try {
      const device = await Device.findByDeviceId(deviceId);
      if (!device) {
        throw new Error(`Device ${deviceId} not found`);
      }

      await device.markConfigRequestSuccess(commandId);
      console.log(`✅ Command marked as successful: ${commandId}`);
    } catch (error) {
      console.error('❌ Error marking command success:', error);
      throw error;
    }
  }

  /**
   * Get device synchronization status
   * @param {String} deviceId - Device identifier
   * @returns {Object} Sync status information
   */
  async getDeviceSyncStatus(deviceId) {
    try {
      const device = await Device.findByDeviceId(deviceId);
      if (!device) {
        throw new Error(`Device ${deviceId} not found`);
      }

      return {
        deviceId,
        isOnline: device.syncStatus.isOnline,
        lastSyncAttempt: device.syncStatus.lastSyncAttempt,
        lastSuccessfulSync: device.syncStatus.lastSuccessfulSync,
        pendingRequests: device.syncStatus.pendingRequests,
        errorCount: device.syncStatus.syncErrors.length,
        lastError: device.syncStatus.syncErrors.slice(-1)[0],
        configLastUpdate: device.configuration.lastConfigUpdate
      };
    } catch (error) {
      console.error('❌ Error getting sync status:', error);
      throw error;
    }
  }

  /**
   * Get default device settings structure
   * @returns {Object} Default settings object
   */
  getDefaultDeviceSettings() {
    const defaultTimestamp = new Date().toISOString().replace('T', ' ').substring(0, 19);
    return {
      electrode: 0,
      event: 0,
      manualModeAction: 0,
      shuntVoltage: 25,
      shuntCurrent: 999,
      referenceFail: 30,
      referenceUP: 300,
      referenceOV: 60,
      interruptOnTime: 86400,
      interruptOffTime: 86400,
      interruptStartTimeStamp: defaultTimestamp,
      interruptStopTimeStamp: defaultTimestamp,
      dpolInterval: "00:00:00",
      depolarizationStartTimeStamp: defaultTimestamp,
      depolarizationStopTimeStamp: defaultTimestamp,
      instantMode: 0,
      instantStartTimeStamp: "19:04:00",
      instantEndTimeStamp: "00:00:00"
    };
  }

  /**
   * Map external parameter names to internal field names
   * @param {Object} parameters - External parameters
   * @returns {Object} Mapped internal parameters
   */
  mapParametersToInternalFields(parameters) {
    const mapping = {
      "Electrode": "electrode",
      "Event": "event",
      "Manual Mode Action": "manualModeAction",
      "Shunt Voltage": "shuntVoltage",
      "Shunt Current": "shuntCurrent",
      "Reference Fail": "referenceFail",
      "Reference UP": "referenceUP",
      "Reference OV": "referenceOV",
      "Interrupt ON Time": "interruptOnTime",
      "Interrupt OFF Time": "interruptOffTime",
      "Interrupt Start TimeStamp": "interruptStartTimeStamp",
      "Interrupt Stop TimeStamp": "interruptStopTimeStamp",

      "Depolarization Start TimeStamp": "depolarizationStartTimeStamp",
      "Depolarization Stop TimeStamp": "depolarizationStopTimeStamp",
      "Instant Mode": "instantMode",
      "Instant Start TimeStamp": "instantStartTimeStamp",
      "Instant End TimeStamp": "instantEndTimeStamp"
    };

    const mapped = {};
    for (const [key, value] of Object.entries(parameters)) {
      const internalKey = mapping[key] || key;
      mapped[internalKey] = value;
    }

    console.log(`🗺️ Mapped ${Object.keys(parameters).length} parameters to internal format`);
    return mapped;
  }

  /**
   * Initialize database with sample devices (for testing)
   * @returns {Array} Created sample devices
   */
  async initializeSampleDevices() {
    try {
      const sampleDevices = [
        {
          deviceId: "ZEPTAC001",
          name: "Primary Sensor Unit",
          type: "sensor",
          location: { latitude: 40.7128, longitude: -74.0060 }
        },
        {
          deviceId: "ZEPTAC002", 
          name: "Secondary Sensor Unit",
          type: "sensor",
          location: { latitude: 40.7589, longitude: -73.9851 }
        },
        {
          deviceId: "GATEWAY001",
          name: "Main Gateway",
          type: "gateway",
          location: { latitude: 40.7505, longitude: -73.9934 }
        }
      ];

      const createdDevices = [];
      for (const deviceData of sampleDevices) {
        try {
          const device = await this.registerDevice(deviceData);
          createdDevices.push(device);
        } catch (error) {
          if (error.message.includes('already exists')) {
            console.log(`ℹ️ Device ${deviceData.deviceId} already exists, skipping...`);
          } else {
            throw error;
          }
        }
      }

      console.log(`✅ Sample devices initialized: ${createdDevices.length} devices`);
      return createdDevices;
    } catch (error) {
      console.error('❌ Error initializing sample devices:', error);
      throw error;
    }
  }

  /**
   * Alias for backward compatibility - GET device settings for frontend
   */
  async getDeviceSettingsForFrontend(deviceId) {
    return await this.getDeviceSettings(deviceId);
  }

  /**
   * Store device settings (preserving original timestamps from device)
   * @param {string} deviceId - Device identifier
   * @param {Object} settings - Device settings to store
   * @param {string} source - Source of the settings (e.g., 'mqtt_incoming', 'api_request')
   * @returns {Object} Updated device object
   */

  /**
   * Get default device settings with proper parameter names
   * @returns {Object} Default device settings
   */
  getDefaultDeviceSettings() {
    return {
      "Electrode": 0,
      "Event": 0,
      "Manual Mode Action": 0,
      "Shunt Voltage": 25.00,
      "Shunt Current": 99.00,
      "Reference Fail": 30,
      "Reference UP": 0.30,
      "Reference OP": 0.60,
      "Reference Fail": 0,
      "Interrupt ON Time": 86400,
      "Interrupt OFF Time": 86400,
      "Interrupt Start TimeStamp": "2025-02-20 19:04:00",
      "Interrupt Stop TimeStamp": "2025-02-20 19:05:00",
      "Depolarization Start TimeStamp": "2025-02-20 19:04:00",
      "Depolarization Stop TimeStamp": "2025-02-20 19:05:00",
      "Instant Mode": 0,
      "Instant Start TimeStamp": "19:04:00",
      "Instant End TimeStamp": "00:00:00",
      "logging_interval": 600,
      "logging_interval_format": "00:10:00"
    };
  }

  /**
   * Convert camelCase parameters to Title Case for frontend display
   * @param {Object} camelCaseParams - Parameters in camelCase format
   * @returns {Object} Parameters in Title Case format
   */
  convertToTitleCaseParameters(camelCaseParams) {
    const mapping = {
      'electrode': 'Electrode',
      'event': 'Event',
      'manualModeAction': 'Manual Mode Action',
      'shuntVoltage': 'Shunt Voltage',
      'shuntCurrent': 'Shunt Current',
      'referenceFail': 'Reference Fail',
      'referenceUP': 'Reference UP',
      'referenceOV': 'Reference OV',
      'interruptOnTime': 'Interrupt ON Time',
      'interruptOffTime': 'Interrupt OFF Time',
      'interruptStartTimeStamp': 'Interrupt Start TimeStamp',
      'interruptStopTimeStamp': 'Interrupt Stop TimeStamp',

      'depolarizationStartTimeStamp': 'Depolarization Start TimeStamp',
      'depolarizationStopTimeStamp': 'Depolarization Stop TimeStamp',
      'instantMode': 'Instant Mode',
      'instantStartTimeStamp': 'Instant Start TimeStamp',
      'instantEndTimeStamp': 'Instant End TimeStamp'
    };

    const titleCaseParams = {};
    
    // Convert known camelCase keys to Title Case
    Object.keys(camelCaseParams).forEach(key => {
      const titleCaseKey = mapping[key] || key;
      titleCaseParams[titleCaseKey] = camelCaseParams[key];
    });

    return titleCaseParams;
  }

  /**
   * Convert Title Case parameters to camelCase for consistent storage
   * @param {Object} titleCaseParams - Parameters in Title Case format
   * @returns {Object} Parameters in camelCase format
   */
  convertToCamelCaseParameters(titleCaseParams) {
    const mapping = {
      'Electrode': 'electrode',
      'Event': 'event',
      'Manual Mode Action': 'manualModeAction',
      'Shunt Voltage': 'shuntVoltage',
      'Shunt Current': 'shuntCurrent',
      'Reference Fail': 'referenceFail',
      'Reference UP': 'referenceUP',
      'Reference OV': 'referenceOV',
      'Interrupt ON Time': 'interruptOnTime',
      'Interrupt OFF Time': 'interruptOffTime',
      'Interrupt Start TimeStamp': 'interruptStartTimeStamp',
      'Interrupt Stop TimeStamp': 'interruptStopTimeStamp',

      'Depolarization Start TimeStamp': 'depolarizationStartTimeStamp',
      'Depolarization Stop TimeStamp': 'depolarizationStopTimeStamp',
      'Instant Mode': 'instantMode',
      'Instant Start TimeStamp': 'instantStartTimeStamp',
      'Instant End TimeStamp': 'instantEndTimeStamp'
    };

    const camelCaseParams = {};
    
    // Convert Title Case keys to camelCase, preserve values as-is if no mapping exists
    Object.keys(titleCaseParams).forEach(key => {
      const camelCaseKey = mapping[key] || key;
      camelCaseParams[camelCaseKey] = titleCaseParams[key];
    });

    return camelCaseParams;
  }

  /**
   * Extract and store device settings from incoming MQTT message
   * @param {Object} incomingData - Raw MQTT message from device
   * @returns {Object} Processed settings object
   */
  async extractAndStoreDeviceSettings(incomingData) {
    try {
      console.log('📦 Processing device settings from MQTT');
      console.log('📋 Raw incoming data:', JSON.stringify(incomingData, null, 2));

      const deviceId = incomingData['Device ID'] || incomingData.deviceId;
      if (!deviceId) {
        throw new Error('Device ID not found in incoming data');
      }

      // Extract Parameters object - this is the key settings data
      const parameters = incomingData.Parameters || incomingData.parameters || {};
      console.log('🔧 Extracted parameters:', JSON.stringify(parameters, null, 2));

      // Store the complete parameters object as deviceSettings
      // The parameters should be stored AS-IS to preserve the exact format
      await this.storeDeviceSettings(deviceId, parameters, 'mqtt_incoming');
      
      console.log(`✅ Device settings extracted and stored for device ${deviceId}`);
      
      return {
        deviceId,
        parameters,
        timestamp: new Date()
      };

    } catch (error) {
      console.error('❌ Error extracting device settings:', error);
      throw error;
    }
  }
}

module.exports = new DeviceManagementService();