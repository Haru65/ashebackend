const mqttService = require('../services/mqttService');

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
}

module.exports = new DeviceConfigController();