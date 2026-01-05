const mqttService = require('../services/mqttService');

/**
 * Map human-readable electrode type names to device codes
 */
const ELECTRODE_TYPE_TO_CODE = {
  'Cu/cuso4': 0,
  'CuCuSO4': 0,
  'Zinc': 1,
  'Ag/AgCl': 2,
  'AgAgSO4': 2
};

/**
 * Get default Reference Fail value based on electrode type
 * Ensures consistent Reference Fail value for each electrode type
 */
function getDefaultRefFailForElectrode(electrodeValue) {
  let electrodeCode = electrodeValue;
  
  // Convert electrode name to code if needed
  if (typeof electrodeValue === 'string') {
    const code = ELECTRODE_TYPE_TO_CODE[electrodeValue];
    if (code !== undefined) {
      electrodeCode = code;
    }
  }
  
  // Return Reference Fail value based on electrode code
  switch (parseInt(electrodeCode)) {
    case 0:  // Cu/CuSO4
      return 0.30;
    case 1:  // Zinc
      return -0.80;
    case 2:  // Ag/AgCl
      return 0.30;
    default:
      return 0.30;  // Default to Cu/CuSO4
  }
}

/**
 * Helper function: Format Shunt Voltage for MQTT device
 * Input: 50 (number) or "50" (string) 
 * Output: "050" (3-digit zero-padded string)
 */
function formatShuntVoltageForDevice(value) {
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
    const intVal = Math.round(numVal);
    return intVal.toString().padStart(3, '0');
  }
  return value;
}

/**
 * Helper function: Format Shunt Current for MQTT device
 * Input: 16800 (already scaled) or 168 (to be used as-is)
 * Output: numeric value (may be scaled by 10 if small)
 */
function formatShuntCurrentForDevice(value) {
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
    if (numVal > 100) {
      return Math.round(numVal);
    } else {
      // Otherwise multiply by 10 (16.8 * 10 = 168)
      return Math.round(numVal * 10);
    }
  }
  return value;
}

/**
 * Helper function: Format Reference values (Fail, UP, OP) for MQTT device
 * Input: 0.65 (number) or "-0.8" (string)
 * Output: "065" or "-080" (3-digit zero-padded string with optional sign)
 * 
 * Logic: Multiplies by 100 to convert decimal values to integer codes
 * Handles both already-scaled values (>100) and decimal values
 */
function formatRefValueForDevice(value) {
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
    let intVal;
    // If value is already large (>100), assume it's been scaled and just use it
    // Otherwise multiply by 100 (0.30 * 100 = 30 → "030", 1.24 * 100 = 124 → "124")
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
}

/**
 * Helper function to transform cache format to device dataframe format
 * 
 * IMPORTANT: The cache already stores values in CORRECT device format from the database!
 * This function primarily:
 * 1. Handles UI selections that were staged (e.g., electrode type as string)
 * 2. Validates and passes through database values as-is
 * 3. Ensures all parameters are in the correct format for MQTT transmission
 * 4. Auto-calculates Reference Fail based on Electrode type
 */
function transformParametersToDeviceFormat(cacheParams) {
  const transformed = {};

  // Map cache keys and apply transformations only where needed
  // Most values pass through as-is since they're already in correct device format
  const mappings = {
    // Electrode: Handle both numeric codes (from DB) and human-readable names (from UI)
    'Electrode': {
      key: 'Electrode',
      transform: (v) => {
        if (typeof v === 'number') return v; // Already numeric code
        if (typeof v === 'string') {
          // Try mapping human-readable name to code
          const code = ELECTRODE_TYPE_TO_CODE[v];
          if (code !== undefined) return code;
          // If it's a numeric string, parse it
          const num = parseInt(v);
          return isNaN(num) ? 0 : num;
        }
        return 0;
      }
    },
    
    // Integer values - pass through or safely parse
    'Event': {
      key: 'Event',
      transform: (v) => {
        if (typeof v === 'number') return v;
        const num = parseInt(v);
        return isNaN(num) ? 0 : num;
      }
    },
    'Manual Mode Action': {
      key: 'Manual Mode Action',
      transform: (v) => {
        if (typeof v === 'number') return v;
        const num = parseInt(v);
        return isNaN(num) ? 0 : num;
      }
    },
    'Instant Mode': {
      key: 'Instant Mode',
      transform: (v) => {
        if (typeof v === 'number') return v;
        const num = parseInt(v);
        return isNaN(num) ? 0 : num;
      }
    },
    
    // CRITICAL: Voltage formatting - use proper function
    // 50 → "050", 100 → "100"
    'Shunt Voltage': {
      key: 'Shunt Voltage',
      transform: (v) => formatShuntVoltageForDevice(v) || "025"
    },
    
    // CRITICAL: Current formatting - use proper function with scaling logic
    // 16800 stays 16800, 168 stays 168, etc.
    'Shunt Current': {
      key: 'Shunt Current',
      transform: (v) => formatShuntCurrentForDevice(v) || 999
    },
    
    // CRITICAL: Reference values formatting - use proper function
    // 0.65 → "065", -0.8 → "-080", 124 → "124"
    'Reference Fail': {
      key: 'Reference Fail',
      transform: (v) => formatRefValueForDevice(v) || "030"
    },
    'Reference UP': {
      key: 'Reference UP',
      transform: (v) => formatRefValueForDevice(v) || "030"
    },
    'Reference OP': {
      key: 'Reference OP',
      transform: (v) => formatRefValueForDevice(v) || "070"
    },
    
    // CRITICAL: Interrupt times - multiply by 10
    // 600 → 6000, 5 → 50
    'Interrupt ON Time': {
      key: 'Interrupt ON Time',
      transform: (v) => {
        const num = typeof v === 'number' ? v : parseInt(v) || 0;
        return num * 10; // Scale by 10 for device
      }
    },
    'Interrupt OFF Time': {
      key: 'Interrupt OFF Time',
      transform: (v) => {
        const num = typeof v === 'number' ? v : parseInt(v) || 0;
        return num * 10; // Scale by 10 for device
      }
    },
    
    // Timestamp values - pass through as strings
    'Interrupt Start TimeStamp': { key: 'Interrupt Start TimeStamp', transform: (v) => String(v) },
    'Interrupt Stop TimeStamp': { key: 'Interrupt Stop TimeStamp', transform: (v) => String(v) },
    'Depolarization Start TimeStamp': { key: 'Depolarization Start TimeStamp', transform: (v) => String(v) },
    'Depolarization Stop TimeStamp': { key: 'Depolarization Stop TimeStamp', transform: (v) => String(v) },
    
    // Time format strings - pass through as-is
    'Depolarization_interval': { key: 'Depolarization_interval', transform: (v) => String(v) },
    'Instant Start TimeStamp': { key: 'Instant Start TimeStamp', transform: (v) => String(v) },
    'Instant End TimeStamp': { key: 'Instant End TimeStamp', transform: (v) => String(v) },
    'logging_interval': { key: 'logging_interval', transform: (v) => String(v) },
    // EXCLUDE: logging_interval_format is only used for UI and should NOT be sent to device
    'logging_interval_format': { key: null, transform: (v) => undefined }
  };

  // Transform parameters according to mappings
  Object.entries(cacheParams).forEach(([key, value]) => {
    if (mappings[key]) {
      const mapping = mappings[key];
      // Skip if mapping key is null (explicitly excluded parameters)
      if (mapping.key === null) {
        console.log(`⏭️  [EXCLUDE] Skipping excluded parameter: ${key}`);
        return;
      }
      try {
        transformed[mapping.key] = mapping.transform(value);
      } catch (error) {
        console.warn(`⚠️ Error transforming parameter ${key}:`, error);
        transformed[mapping.key] = value;
      }
    } else {
      // Pass through any unmapped parameters as-is
      transformed[key] = value;
    }
  });

  // AUTO-CALCULATE: If Electrode is being sent and Reference Fail is not explicitly set,
  // automatically set Reference Fail based on electrode type
  if (transformed['Electrode'] !== undefined && cacheParams['Reference Fail'] === undefined) {
    const electrodeCode = transformed['Electrode'];
    const autoRefFail = getDefaultRefFailForElectrode(electrodeCode);
    transformed['Reference Fail'] = formatRefValueForDevice(autoRefFail);
    console.log(`🔄 [AUTO-SET] Reference Fail automatically set to ${autoRefFail} for electrode code ${electrodeCode}`);
  }

  console.log(`✨ [TRANSFORM] Complete parameter transformation:`, {
    before: cacheParams,
    after: transformed
  });

  return transformed;
}

class DeviceConfigController {
  // Configure interrupt mode
  async configureInterruptMode(req, res) {
    try {
      const { deviceId } = req.params;
      const {
        startDate,
        startTime,
        stopDate,
        stopTime,
        onTime,
        offTime,
        dateFormat
      } = req.body;

      console.log(`🔧 Configuring interrupt mode for device ${deviceId}:`, req.body);

      // Validate required fields
      if (!startDate || !startTime || !stopDate || !stopTime || !onTime || !offTime) {
        return res.status(400).json({
          success: false,
          message: 'Missing required fields for interrupt mode configuration'
        });
      }

      const config = {
        startDate,
        startTime,
        stopDate,
        stopTime,
        onTime: parseInt(onTime),
        offTime: parseInt(offTime),
        dateFormat: dateFormat || {}
      };

      // Publish command and respond immediately (don't wait for device ack)
      mqttService.setInterruptMode(deviceId, config).catch(err => {
        console.error('Background interrupt mode command failed:', err);
      });
      
      res.json({
        success: true,
        message: 'Interrupt mode configuration sent to device'
      });

    } catch (error) {
      console.error('Error configuring interrupt mode:', error);
      res.status(500).json({
        success: false,
        message: error.message || 'Failed to configure interrupt mode'
      });
    }
  }

  // Configure manual mode
  async configureManualMode(req, res) {
    try {
      const { deviceId } = req.params;
      const { action } = req.body; // 'start' or 'stop'

      console.log(`🔧 Configuring manual mode for device ${deviceId}: ${action}`);

      if (!action || !['start', 'stop'].includes(action)) {
        return res.status(400).json({
          success: false,
          message: 'Invalid action. Must be "start" or "stop"'
        });
      }

      // Publish command and respond immediately (don't wait for device ack)
      mqttService.setManualMode(deviceId, action).catch(err => {
        console.error('Background manual mode command failed:', err);
      });
      
      res.json({
        success: true,
        message: `Manual mode ${action} command sent to device`
      });

    } catch (error) {
      console.error('Error configuring manual mode:', error);
      res.status(500).json({
        success: false,
        message: error.message || 'Failed to configure manual mode'
      });
    }
  }

  // Configure normal mode
  async configureNormalMode(req, res) {
    try {
      const { deviceId } = req.params;
      const config = req.body || {};

      console.log(`🔧 Configuring normal mode for device ${deviceId}:`, config);

      // Publish command and respond immediately (don't wait for device ack)
      mqttService.setNormalMode(deviceId, config).catch(err => {
        console.error('Background normal mode command failed:', err);
      });
      
      res.json({
        success: true,
        message: 'Normal mode configuration sent to device'
      });

    } catch (error) {
      console.error('Error configuring normal mode:', error);
      res.status(500).json({
        success: false,
        message: error.message || 'Failed to configure normal mode'
      });
    }
  }

  // Configure DPOL mode
  async configureDpolMode(req, res) {
    try {
      const { deviceId } = req.params;
      const { startDate, startTime, endDate, endTime, dateFormat, interval, intervalFormat } = req.body;

      console.log(`🔧 Configuring DPOL mode for device ${deviceId}:`, req.body);

      const config = {
        startDate,
        startTime,
        endDate,
        endTime,
        dateFormat: dateFormat || {},
        interval,
        intervalFormat
      };

      // Publish command and respond immediately (don't wait for device ack)
      mqttService.setDpolMode(deviceId, config).catch(err => {
        console.error('Background DPOL mode command failed:', err);
      });
      
      res.json({
        success: true,
        message: 'DPOL mode configuration sent to device'
      });

    } catch (error) {
      console.error('Error configuring DPOL mode:', error);
      res.status(500).json({
        success: false,
        message: error.message || 'Failed to configure DPOL mode'
      });
    }
  }

  // Configure INST mode
  async configureInstMode(req, res) {
    try {
      const { deviceId } = req.params;
      const { startTime, frequency } = req.body;

      console.log(`🔧 Configuring INST mode for device ${deviceId}:`, req.body);

      const config = {
        startTime,
        frequency
      };

      // Publish command and respond immediately (don't wait for device ack)
      mqttService.setInstMode(deviceId, config).catch(err => {
        console.error('Background INST mode command failed:', err);
      });
      
      res.json({
        success: true,
        message: 'INST mode configuration sent to device'
      });

    } catch (error) {
      console.error('Error configuring INST mode:', error);
      res.status(500).json({
        success: false,
        message: error.message || 'Failed to configure INST mode'
      });
    }
  }

  // Configure timer settings
  async configureTimer(req, res) {
    try {
      const { deviceId } = req.params;
      const { ton, toff } = req.body;

      console.log(`🔧 Configuring timer for device ${deviceId}:`, req.body);

      const timerConfig = { ton, toff };
      // Publish command and respond immediately (don't wait for device ack)
      mqttService.setTimerConfiguration(deviceId, timerConfig).catch(err => {
        console.error('Background timer configuration command failed:', err);
      });
      
      res.json({
        success: true,
        message: 'Timer configuration sent to device'
      });

    } catch (error) {
      console.error('Error configuring timer:', error);
      res.status(500).json({
        success: false,
        message: error.message || 'Failed to configure timer'
      });
    }
  }

  // Configure electrode
  async configureElectrode(req, res) {
    try {
      const { deviceId } = req.params;
      const { electrodeType } = req.body;

      console.log(`🔧 Configuring electrode for device ${deviceId}: ${electrodeType}`);

      if (!electrodeType) {
        return res.status(400).json({
          success: false,
          message: 'Electrode type is required'
        });
      }

      // Publish command and respond immediately (don't wait for device ack)
      mqttService.setElectrodeConfiguration(deviceId, electrodeType).catch(err => {
        console.error('Background electrode configuration command failed:', err);
      });
      
      res.json({
        success: true,
        message: 'Electrode configuration sent to device'
      });

    } catch (error) {
      console.error('Error configuring electrode:', error);
      res.status(500).json({
        success: false,
        message: error.message || 'Failed to configure electrode'
      });
    }
  }

  // Get device status
  async getDeviceStatus(req, res) {
    try {
      const { deviceId } = req.params;
      
      const status = {
        connected: mqttService.isDeviceConnected(),
        lastTimestamp: mqttService.getLastTimestamp(),
        deviceData: mqttService.getDeviceData()
      };

      res.json({
        success: true,
        data: status
      });

    } catch (error) {
      console.error('Error getting device status:', error);
      res.status(500).json({
        success: false,
        message: error.message || 'Failed to get device status'
      });
    }
  }

  // Get current device settings in the requested format
  async getDeviceSettings(req, res) {
    try {
      const { deviceId } = req.params;
      
      // ALWAYS get from database service, not memory cache
      // This ensures we have the persistent, authoritative values
      const deviceManagementService = require('../services/deviceManagementService');
      const settings = await deviceManagementService.getDeviceSettings(deviceId);
      
      res.json({
        success: true,
        data: settings
      });

    } catch (error) {
      console.error('Error getting device settings:', error);
      res.status(error.message?.includes('not found') ? 404 : 500).json({
        success: false,
        message: error.message || 'Failed to get device settings'
      });
    }
  }

  // Update complete device settings (sends entire payload)
  async updateDeviceSettings(req, res) {
    try {
      const { deviceId } = req.params;
      const settingsData = req.body;

      console.log(`🔧 Updating complete device settings for device ${deviceId}:`, settingsData);

      if (!settingsData || !settingsData.Parameters) {
        return res.status(400).json({
          success: false,
          message: 'Settings Parameters are required'
        });
      }

      // Send complete settings via MQTT service
      const result = await mqttService.setSettingsConfiguration(deviceId, settingsData.Parameters);
      
      res.json({
        success: true,
        message: 'Complete device settings sent to device',
        commandId: result.commandId,
        status: result.status
      });

    } catch (error) {
      console.error('Error updating device settings:', error);
      res.status(500).json({
        success: false,
        message: error.message || 'Failed to update device settings'
      });
    }
  }

  // Update single setting (sends entire payload with changed setting)
  async updateSingleSetting(req, res) {
    try {
      const { deviceId } = req.params;
      const { setting, value } = req.body;

      console.log(`🔧 Updating single setting for device ${deviceId}: ${setting} = ${value}`);

      if (!setting || value === undefined) {
        return res.status(400).json({
          success: false,
          message: 'Setting name and value are required'
        });
      }

      // Get current settings from MQTT service
      const currentSettings = mqttService.getDeviceSettings(deviceId) || {};
      
      // Update the single setting
      const updatedSettings = {
        ...currentSettings,
        [setting]: value
      };

      // Send complete settings with the changed setting highlighted
      const result = await mqttService.setSettingsConfiguration(deviceId, updatedSettings);
      
      res.json({
        success: true,
        message: `Setting '${setting}' updated and complete settings sent to device`,
        commandId: result.commandId,
        status: result.status,
        updatedSetting: { [setting]: value }
      });

    } catch (error) {
      console.error('Error updating single setting:', error);
      res.status(500).json({
        success: false,
        message: error.message || 'Failed to update single setting'
      });
    }
  }

  // Configure SET mV (voltage setting in millivolts)
  async configureSetVoltage(req, res) {
    try {
      const { deviceId } = req.params;
      const { voltage } = req.body; // expects voltage in mV

      console.log(`🔧 Configuring SET mV for device ${deviceId}: ${voltage}mV`);

      if (voltage === undefined || voltage === null) {
        return res.status(400).json({
          success: false,
          message: 'Voltage value in mV is required'
        });
      }

      const config = { voltage: parseFloat(voltage) };

      // Publish command and respond immediately
      mqttService.setVoltageConfiguration(deviceId, config).catch(err => {
        console.error('Background voltage configuration command failed:', err);
      });
      
      res.json({
        success: true,
        message: `SET mV configuration sent to device: ${voltage}mV`
      });

    } catch (error) {
      console.error('Error configuring SET mV:', error);
      res.status(500).json({
        success: false,
        message: error.message || 'Failed to configure SET mV'
      });
    }
  }

  // Configure Set Shunt (current setting in A)
  async configureSetShunt(req, res) {
    try {
      const { deviceId } = req.params;
      const { current } = req.body; // expects current in A

      console.log(`🔧 Configuring Set Shunt for device ${deviceId}: ${current}A`);

      if (current === undefined || current === null) {
        return res.status(400).json({
          success: false,
          message: 'Current value in A is required'
        });
      }

      const config = { current: parseFloat(current) };

      // Publish command and respond immediately
      mqttService.setShuntConfiguration(deviceId, config).catch(err => {
        console.error('Background shunt configuration command failed:', err);
      });
      
      res.json({
        success: true,
        message: `Set Shunt configuration sent to device: ${current}A`
      });

    } catch (error) {
      console.error('Error configuring Set Shunt:', error);
      res.status(500).json({
        success: false,
        message: error.message || 'Failed to configure Set Shunt'
      });
    }
  }

  // Configure logging interval
  async configureLoggingInterval(req, res) {
    try {
      const { deviceId } = req.params;
      const { interval } = req.body; // expects format "HH:MM:SS"

      console.log(`🔧 Configuring Logging Interval for device ${deviceId}: ${interval}`);

      if (!interval || !interval.match(/^\d{2}:\d{2}:\d{2}$/)) {
        return res.status(400).json({
          success: false,
          message: 'Logging interval in HH:MM:SS format is required'
        });
      }

      const config = { loggingInterval: interval };

      // Publish command and respond immediately
      mqttService.setLoggingConfiguration(deviceId, config).catch(err => {
        console.error('Background logging configuration command failed:', err);
      });
      
      res.json({
        success: true,
        message: `Logging interval configuration sent to device: ${interval}`
      });

    } catch (error) {
      console.error('Error configuring logging interval:', error);
      res.status(500).json({
        success: false,
        message: error.message || 'Failed to configure logging interval'
      });
    }
  }

  // Configure alarm/set values (REF UP, OP, FAIL) with acknowledgment tracking
  async configureAlarm(req, res) {
    try {
      const { deviceId } = req.params;
      const { setup, setop, reffail } = req.body;

      console.log(`🔧 Configuring alarm/set values for device ${deviceId}:`, req.body);

      // Validate input ranges: 0.00 to 9.99V (range for Reference UP/OP/Fail)
      if (setup && setup.value !== undefined && setup.value !== null) {
        if (setup.value < 0.0 || setup.value > 9.99) {
          return res.status(400).json({
            success: false,
            message: 'SET UP value must be between 0.00 and 9.99V'
          });
        }
      }

      if (setop && setop.value !== undefined && setop.value !== null) {
        if (setop.value < 0.0 || setop.value > 9.99) {
          return res.status(400).json({
            success: false,
            message: 'SET OP value must be between 0.00 and 9.99V'
          });
        }
      }

      const config = {
        setup: setup && setup.value !== undefined ? {
          value: setup.value
        } : null,
        setop: setop && setop.value !== undefined ? {
          value: setop.value
        } : null,
        reffail: reffail && reffail.value !== undefined ? {
          value: reffail.value
        } : null
      };

      // Send command with acknowledgment tracking
      const result = await mqttService.setAlarmConfiguration(deviceId, config);
      
      // Check if validation failed
      if (!result.success) {
        return res.status(400).json({
          success: false,
          error: result.error,
          validation: result.validation,
          message: result.error
        });
      }
      
      res.json({
        success: true,
        message: 'Set values configuration sent to device',
        commandId: result.commandId,
        data: {
          deviceId: deviceId,
          commandId: result.commandId,
          configType: 'set_values',
          timestamp: new Date().toISOString(),
          waitingForAcknowledgment: true
        }
      });

    } catch (error) {
      console.error('Error configuring alarm:', error);
      res.status(500).json({
        success: false,
        message: error.message || 'Failed to configure alarm'
      });
    }
  }

  // Configure Set UP value individually with acknowledgment tracking
  async configureSetUP(req, res) {
    try {
      const { deviceId } = req.params;
      const { setUP } = req.body;

      console.log(`🔧 Configuring Set UP value for device ${deviceId}:`, setUP);

      // Validate voltage range (-4.00V to +4.00V)
      if (setUP < -4.00 || setUP > 4.00) {
        return res.status(400).json({
          success: false,
          message: 'Set UP voltage must be between -4.0V and +4.0V'
        });
      }

      const config = { setUP };

      // Send command with acknowledgment tracking
      const result = await mqttService.setAlarmSetUP(deviceId, config);
      
      res.json({
        success: true,
        message: `Set UP value ${setUP}V configured and sent to device`,
        commandId: result.commandId,
        data: {
          deviceId: deviceId,
          commandId: result.commandId,
          configType: 'set_up',
          setValue: setUP,
          timestamp: new Date().toISOString(),
          waitingForAcknowledgment: true
        }
      });

    } catch (error) {
      console.error('Error configuring Set UP:', error);
      res.status(500).json({
        success: false,
        message: error.message || 'Failed to configure Set UP value'
      });
    }
  }

  // Configure Set OP value individually with acknowledgment tracking
  async configureSetOP(req, res) {
    try {
      const { deviceId } = req.params;
      const { setOP } = req.body;

      console.log(`🔧 Configuring Set OP value for device ${deviceId}:`, setOP);

      // Validate voltage range (-4.00V to +4.00V)
      if (setOP < -4.00 || setOP > 4.00) {
        return res.status(400).json({
          success: false,
          message: 'Set OP voltage must be between -4.0V and +4.0V'
        });
      }

      const config = { setOP };

      // Send command with acknowledgment tracking
      const result = await mqttService.setAlarmSetOP(deviceId, config);
      
      res.json({
        success: true,
        message: `Set OP value ${setOP}V configured and sent to device`,
        commandId: result.commandId,
        data: {
          deviceId: deviceId,
          commandId: result.commandId,
          configType: 'set_op',
          setValue: setOP,
          timestamp: new Date().toISOString(),
          waitingForAcknowledgment: true
        }
      });

    } catch (error) {
      console.error('Error configuring Set OP:', error);
      res.status(500).json({
        success: false,
        message: error.message || 'Failed to configure Set OP value'
      });
    }
  }

  // Configure Ref Fail value individually with acknowledgment tracking
  async configureRefFail(req, res) {
    try {
      const { deviceId } = req.params;
      const { refFail } = req.body;

      console.log(`🔧 Configuring Ref Fail value for device ${deviceId}:`, refFail);

      // Validate voltage range (-4.00V to +4.00V)
      if (refFail < -4.00 || refFail > 4.00) {
        return res.status(400).json({
          success: false,
          message: 'Ref Fail voltage must be between -4.0V and +4.0V'
        });
      }

      const config = { refFail };

      // Send command with acknowledgment tracking
      const result = await mqttService.setRefFail(deviceId, config);
      
      res.json({
        success: true,
        message: `Ref Fail value ${refFail}V configured and sent to device`,
        commandId: result.commandId,
        data: {
          deviceId: deviceId,
          commandId: result.commandId,
          configType: 'ref_fail',
          setValue: refFail,
          timestamp: new Date().toISOString(),
          waitingForAcknowledgment: true
        }
      });

    } catch (error) {
      console.error('Error configuring Ref Fail:', error);
      res.status(500).json({
        success: false,
        message: error.message || 'Failed to configure Ref Fail value'
      });
    }
  }

  // Configure Shunt Voltage (maps to "Shunt Voltage": 25 in data frame) 
  async configureShuntVoltage(req, res) {
    try {
      const { deviceId } = req.params;
      const { shuntVoltage } = req.body;

      console.log(`🔧 Configuring Shunt Voltage for device ${deviceId}:`, shuntVoltage);

      // Parse voltage value
      const voltage = parseFloat(shuntVoltage);
      
      // Validate voltage value - for dropdown it will be 25, 50, 75, or 100
      if (isNaN(voltage) || voltage < 0 || voltage > 100) {
        return res.status(400).json({
          success: false,
          message: 'Shunt voltage must be a valid number (25, 50, 75, or 100)'
        });
      }

      // Store the value as-is (no formatting for dropdown values)
      const config = { shuntVoltage: voltage.toString() };

      // Send command with acknowledgment tracking
      const result = await mqttService.setShuntVoltage(deviceId, config);
      
      res.json({
        success: true,
        message: `Shunt voltage ${shuntVoltage} configured and sent to device`,
        commandId: result.commandId,
        data: {
          deviceId: deviceId,
          commandId: result.commandId,
          configType: 'shunt_voltage',
          setValue: shuntVoltage,
          timestamp: new Date().toISOString(),
          waitingForAcknowledgment: true
        }
      });

    } catch (error) {
      console.error('Error configuring Shunt Voltage:', error);
      res.status(500).json({
        success: false,
        message: error.message || 'Failed to configure shunt voltage'
      });
    }
  }

  // Configure Shunt Current (maps to "Shunt Current": 999 in data frame)
  async configureShuntCurrent(req, res) {
    try {
      const { deviceId } = req.params;
      const { shuntCurrent } = req.body;

      console.log(`🔧 Configuring Shunt Current for device ${deviceId}:`, shuntCurrent);

      // Parse and validate current range (0.00 to 99.99)
      const current = parseFloat(shuntCurrent);
      if (current < 0.00 || current > 99.99) {
        return res.status(400).json({
          success: false,
          message: 'Shunt current must be between 0.00 and 99.99'
        });
      }

      // Convert decimal format (68.9) to device format (689)
      // Device expects values 0-999 where 999 = 99.9A
      const deviceFormatValue = Math.round(current * 10);
      
      const config = { shuntCurrent: deviceFormatValue };

      // Send command with acknowledgment tracking
      const result = await mqttService.setShuntCurrent(deviceId, config);
      
      res.json({
        success: true,
        message: `Shunt current ${shuntCurrent} configured and sent to device`,
        commandId: result.commandId,
        data: {
          deviceId: deviceId,
          commandId: result.commandId,
          configType: 'shunt_current',
          setValue: shuntCurrent,
          deviceFormatValue: deviceFormatValue,
          timestamp: new Date().toISOString(),
          waitingForAcknowledgment: true
        }
      });

    } catch (error) {
      console.error('Error configuring Shunt Current:', error);
      res.status(500).json({
        success: false,
        message: error.message || 'Failed to configure shunt current'
      });
    }
  }

  /**
   * Send complete settings payload (used after staging updates in cache)
   * This endpoint accepts a complete payload with all device settings
   * and sends them to the device as a single MQTT message
   */
  async sendCompleteSettingsPayload(req, res) {
    try {
      const { deviceId } = req.params;
      const completePayload = req.body;

      // Validate inputs
      if (!deviceId || !completePayload || Object.keys(completePayload).length === 0) {
        return res.status(400).json({
          success: false,
          message: 'Device ID and complete settings payload required'
        });
      }

      console.log(`📤 [SETTINGS] Sending complete settings payload to device ${deviceId}`);
      console.log(`   Fields: ${Object.keys(completePayload).join(', ')}`);
      console.log(`   Payload:`, completePayload);

      // Check device connection status (log warning if not connected, but continue anyway)
      const isConnected = mqttService.isDeviceConnected(deviceId);
      if (!isConnected) {
        console.warn(`⚠️ Device ${deviceId} appears to be offline. Settings will be published and device will receive them when it reconnects.`);
      }

      // Transform parameters from cache format to device dataframe format
      const transformedParameters = transformParametersToDeviceFormat(completePayload);

      console.log(`✨ Transformed parameters:`);
      console.log(`   Before:`, completePayload);
      console.log(`   After:`, transformedParameters);

      // Generate command ID
      const { v4: uuidv4 } = require('uuid');
      const commandId = uuidv4();

      // Build complete MQTT message with correct format
      // Topic: devices/{deviceId}/commands (use commands topic for settings updates)
      // Format: { "Device ID": "...", "Message Type": "settings", "sender": "Server", "Parameters": {...} }
      const settingsMessage = {
        'Device ID': deviceId,
        'Message Type': 'settings',
        'sender': 'Server',
        'Parameters': transformedParameters
      };

      console.log(`📡 MQTT Message (topic: devices/${deviceId}/commands):`, JSON.stringify(settingsMessage, null, 2));

      // Send via MQTT using commands topic (not settings topic)
      // Note: MQTT broker will queue messages if device is offline
      const result = await mqttService.publishCompleteSettingsCommand(deviceId, settingsMessage);

      if (!result.success) {
        console.warn(`⚠️ MQTT publish failed for device ${deviceId}:`, result.error);
        console.log(`ℹ️ Will save settings to database for delivery on next connection`);
      } else {
        console.log(`✅ Settings published via MQTT to device ${deviceId}`);
      }

      // Save settings to database (store original cache format + transformed format)
      // This ensures settings are persisted regardless of MQTT publish success
      try {
        const Device = require('../models/Device');
        const device = await Device.findOne({ deviceId });

        if (device) {
          // Merge settings into device configuration
          if (!device.configuration) {
            device.configuration = {};
          }
          if (!device.configuration.deviceSettings) {
            device.configuration.deviceSettings = {};
          }

          // Update each setting field with transformed values
          Object.assign(device.configuration.deviceSettings, transformedParameters);

          // Also track the original cache format for reference
          if (!device.configuration.deviceSettingsCacheFormat) {
            device.configuration.deviceSettingsCacheFormat = {};
          }
          Object.assign(device.configuration.deviceSettingsCacheFormat, completePayload);

          // Track that settings were sent
          device.lastSettingsSent = new Date();
          device.settingsSentCount = (device.settingsSentCount || 0) + 1;

          await device.save();
          console.log(`✅ Settings saved to database for device ${deviceId}`);
        }
      } catch (dbError) {
        console.warn(`⚠️ Failed to save settings to database (non-critical):`, dbError);
        // Continue - settings were still sent to device
      }

      // Return success response
      res.json({
        success: true,
        message: `Sent ${Object.keys(transformedParameters).length} settings to device`,
        commandId,
        data: {
          deviceId,
          settingsCount: Object.keys(transformedParameters).length,
          fields: Object.keys(transformedParameters),
          sentAt: new Date().toISOString()
        }
      });

      // Notify connected clients via Socket.IO
      try {
        const socketService = require('../services/socketService');
        socketService.emitToAll('deviceSettingsSent', {
          deviceId,
          commandId,
          settingsCount: Object.keys(completePayload).length,
          timestamp: new Date().toISOString()
        });
      } catch (socketError) {
        console.warn('Socket notification failed (non-critical):', socketError);
      }

    } catch (error) {
      console.error('❌ Error sending complete settings payload:', error);
      res.status(500).json({
        success: false,
        message: error.message || 'Failed to send complete settings'
      });
    }
  }

  /**
   * Batch update settings - accepts multiple updates, merges with current settings,
   * and sends as complete payload
   */
  async batchUpdateSettings(req, res) {
    try {
      const { deviceId } = req.params;
      const { updates } = req.body;

      // Validate inputs
      if (!deviceId || !updates || Object.keys(updates).length === 0) {
        return res.status(400).json({
          success: false,
          message: 'Device ID and updates required'
        });
      }

      console.log(`📝 [BATCH] Batch updating settings for device ${deviceId}`);
      console.log(`   Updates: ${Object.keys(updates).join(', ')}`);
      console.log(`   Values:`, updates);

      // Check if device is connected
      if (!mqttService.isDeviceConnected(deviceId)) {
        return res.status(503).json({
          success: false,
          message: `Device ${deviceId} is not connected`
        });
      }

      // Get device and current settings
      const Device = require('../models/Device');
      const device = await Device.findOne({ deviceId });

      if (!device) {
        return res.status(404).json({
          success: false,
          message: 'Device not found'
        });
      }

      // Get current settings
      const currentSettings = device.configuration?.deviceSettings || {};

      console.log(`   Current settings count: ${Object.keys(currentSettings).length}`);

      // Build complete payload by merging updates with current settings
      const completePayload = {
        ...currentSettings,
        ...updates
      };

      console.log(`   Complete payload count: ${Object.keys(completePayload).length}`);

      // Generate command ID
      const { v4: uuidv4 } = require('uuid');
      const commandId = uuidv4();

      // Transform parameters from cache format to device dataframe format
      const transformedParameters = transformParametersToDeviceFormat(completePayload);

      console.log(`✨ Transformed parameters:`);
      console.log(`   Before:`, completePayload);
      console.log(`   After:`, transformedParameters);

      // Build MQTT message with correct format
      // Topic: devices/{deviceId}/settings
      const settingsMessage = {
        'Device ID': deviceId,
        'Message Type': 'settings',
        'sender': 'Server',
        'Parameters': transformedParameters
      };

      console.log(`📡 MQTT Message (topic: devices/${deviceId}/settings):`, JSON.stringify(settingsMessage, null, 2));

      // Send via MQTT
      const result = await mqttService.publishSettingsToDevice(deviceId, settingsMessage);

      if (!result.success) {
        console.warn(`⚠️ MQTT publish failed:`, result.error);
        return res.status(503).json({
          success: false,
          message: 'Failed to publish settings to device',
          error: result.error
        });
      }

      // Update database with merged settings (store transformed values)
      device.configuration.deviceSettings = transformedParameters;
      
      // Also track cache format for reference
      if (!device.configuration.deviceSettingsCacheFormat) {
        device.configuration.deviceSettingsCacheFormat = {};
      }
      Object.assign(device.configuration.deviceSettingsCacheFormat, completePayload);
      
      device.lastSettingsSent = new Date();
      device.settingsSentCount = (device.settingsSentCount || 0) + 1;
      await device.save();

      console.log(`✅ Batch update sent and saved for device ${deviceId}`);

      res.json({
        success: true,
        message: `Applied ${Object.keys(updates).length} updates`,
        commandId,
        data: {
          deviceId,
          updated: Object.keys(updates),
          totalFields: Object.keys(transformedParameters).length,
          sentAt: new Date().toISOString()
        }
      });

      // Notify clients
      try {
        const socketService = require('../services/socketService');
        socketService.emitToAll('deviceBatchSettingsUpdate', {
          deviceId,
          commandId,
          updates: Object.keys(updates),
          timestamp: new Date().toISOString()
        });
      } catch (socketError) {
        console.warn('Socket notification failed (non-critical):', socketError);
      }

    } catch (error) {
      console.error('❌ Error batch updating settings:', error);
      res.status(500).json({
        success: false,
        message: error.message || 'Failed to batch update settings'
      });
    }
  }
}

module.exports = new DeviceConfigController();