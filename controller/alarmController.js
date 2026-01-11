const Alarm = require('../models/Alarm');
const NotificationService = require('../services/notificationService');

class AlarmController {
  constructor() {
    this.notificationService = new NotificationService();
  }

  /**
   * Get all alarms (can be filtered by device_name)
   */
  async getAllAlarms(req, res) {
    try {
      const { device_name, status, severity } = req.query;
      
      // Build filter
      const filter = {};
      if (device_name) filter.device_name = device_name;
      if (status) filter.status = status;
      if (severity) filter.severity = severity;

      // Fetch from database with pagination
      const page = req.query.page || 1;
      const limit = req.query.limit || 10;
      const skip = (page - 1) * limit;

      const alarms = await Alarm.find(filter)
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(limit)
        .lean();

      const total = await Alarm.countDocuments(filter);

      res.json({
        success: true,
        data: alarms,
        total: total,
        page: page,
        pages: Math.ceil(total / limit)
      });
    } catch (error) {
      console.error('Error fetching alarms:', error);
      res.status(500).json({
        success: false,
        message: 'Error fetching alarms',
        error: error.message
      });
    }
  }

  /**
   * Get alarm by ID
   */
  async getAlarmById(req, res) {
    try {
      const { id } = req.params;
      const alarm = await Alarm.findById(id);
      
      if (!alarm) {
        return res.status(404).json({
          success: false,
          message: 'Alarm not found'
        });
      }

      res.json({
        success: true,
        data: alarm
      });
    } catch (error) {
      console.error('Error fetching alarm:', error);
      res.status(500).json({
        success: false,
        message: 'Error fetching alarm',
        error: error.message
      });
    }
  }

  /**
   * Get alarms for a specific device
   */
  async getAlarmsByDevice(req, res) {
    try {
      const { deviceName } = req.params;
      
      // Get active alarms for this device
      const alarms = await Alarm.getDeviceAlarms(deviceName, 'Active');
      
      res.json({
        success: true,
        data: alarms,
        total: alarms.length,
        message: `Found ${alarms.length} active alarm(s) for device ${deviceName}`
      });
    } catch (error) {
      console.error('Error fetching device alarms:', error);
      res.status(500).json({
        success: false,
        message: 'Error fetching device alarms',
        error: error.message
      });
    }
  }

  /**
   * Create new alarm - PERSISTED TO DATABASE
   * Only alarms created for a specific device will be monitored
   */
  async createAlarm(req, res) {
    try {
      const { 
        name, 
        device_name, 
        deviceId,
        parameter,
        severity,
        status,
        device_params,
        notification_config 
      } = req.body;

      // Validate required fields
      if (!name || !device_name) {
        return res.status(400).json({
          success: false,
          message: 'name and device_name are required'
        });
      }

      // Validate that lower bounds don't exceed upper bounds
      if (device_params) {
        const boundErrors = [];
        if (device_params.ref_1_lower && device_params.ref_1_upper && device_params.ref_1_lower > device_params.ref_1_upper) {
          boundErrors.push("Ref 1: Lower bound cannot exceed upper bound");
        }
        if (device_params.ref_2_lower && device_params.ref_2_upper && device_params.ref_2_lower > device_params.ref_2_upper) {
          boundErrors.push("Ref 2: Lower bound cannot exceed upper bound");
        }
        if (device_params.ref_3_lower && device_params.ref_3_upper && device_params.ref_3_lower > device_params.ref_3_upper) {
          boundErrors.push("Ref 3: Lower bound cannot exceed upper bound");
        }
        if (device_params.dcv_lower && device_params.dcv_upper && device_params.dcv_lower > device_params.dcv_upper) {
          boundErrors.push("DCV: Lower bound cannot exceed upper bound");
        }
        if (device_params.dci_lower && device_params.dci_upper && device_params.dci_lower > device_params.dci_upper) {
          boundErrors.push("DCI: Lower bound cannot exceed upper bound");
        }
        if (device_params.acv_lower && device_params.acv_upper && device_params.acv_lower > device_params.acv_upper) {
          boundErrors.push("ACV: Lower bound cannot exceed upper bound");
        }

        if (boundErrors.length > 0) {
          return res.status(400).json({
            success: false,
            message: 'Bound validation failed',
            errors: boundErrors
          });
        }
      }

      // Create alarm in database
      const alarm = new Alarm({
        name,
        device_name,
        deviceId,
        parameter: parameter || 'Device Parameter',
        severity: severity || 'warning',
        status: status || 'Active',
        device_params: device_params || {
          ref_1_upper: 0,
          ref_1_lower: 0,
          ref_2_upper: 0,
          ref_2_lower: 0,
          ref_3_upper: 0,
          ref_3_lower: 0,
          dcv_upper: 0,
          dcv_lower: 0,
          dci_upper: 0,
          dci_lower: 0,
          acv_upper: 0,
          acv_lower: 0
        },
        notification_config: notification_config || {
          email_ids: [],
          sms_numbers: []
        }
      });

      await alarm.save();

      console.log(`✅ Alarm '${name}' created for device '${device_name}' - ID: ${alarm._id}`);

      // Send notifications if alarm is active and critical/warning
      if (alarm.status === 'Active' && ['critical', 'warning'].includes(alarm.severity)) {
        try {
          await this.notificationService.sendAlarmNotifications(alarm);
        } catch (notifError) {
          console.error('Error sending notifications:', notifError.message);
        }
      }

      res.status(201).json({
        success: true,
        message: `Alarm '${name}' created successfully for device '${device_name}'`,
        data: alarm
      });
    } catch (error) {
      console.error('Error creating alarm:', error);
      res.status(500).json({
        success: false,
        message: 'Error creating alarm',
        error: error.message
      });
    }
  }

  /**
   * Update alarm
   */
  async updateAlarm(req, res) {
    try {
      const { id } = req.params;
      
      const alarm = await Alarm.findByIdAndUpdate(
        id,
        {
          ...req.body,
          updatedAt: new Date()
        },
        { new: true }
      );

      if (!alarm) {
        return res.status(404).json({
          success: false,
          message: 'Alarm not found'
        });
      }

      console.log(`✏️ Alarm '${alarm.name}' updated`);

      res.json({
        success: true,
        message: 'Alarm updated successfully',
        data: alarm
      });
    } catch (error) {
      console.error('Error updating alarm:', error);
      res.status(500).json({
        success: false,
        message: 'Error updating alarm',
        error: error.message
      });
    }
  }

  /**
   * Delete alarm - ONLY deletes specific alarm
   */
  async deleteAlarm(req, res) {
    try {
      const { id } = req.params;
      
      const alarm = await Alarm.findByIdAndDelete(id);

      if (!alarm) {
        return res.status(404).json({
          success: false,
          message: 'Alarm not found'
        });
      }

      console.log(`🗑️ Alarm '${alarm.name}' deleted`);

      res.json({
        success: true,
        message: `Alarm '${alarm.name}' deleted successfully`
      });
    } catch (error) {
      console.error('Error deleting alarm:', error);
      res.status(500).json({
        success: false,
        message: 'Error deleting alarm',
        error: error.message
      });
    }
  }

  /**
   * Send SMS notification for specific alarm
   */
  async sendSMSNotification(req, res) {
    try {
      const { id } = req.params;
      const alarm = await Alarm.findById(id);
      
      if (!alarm) {
        return res.status(404).json({
          success: false,
          message: 'Alarm not found'
        });
      }

      if (!alarm.notification_config.sms_numbers || alarm.notification_config.sms_numbers.length === 0) {
        return res.status(400).json({
          success: false,
          message: 'No SMS numbers configured for this alarm'
        });
      }

      const results = await this.notificationService.sendSMSNotification(
        alarm, 
        alarm.notification_config.sms_numbers
      );

      res.json({
        success: true,
        message: 'SMS notifications sent',
        data: results
      });
    } catch (error) {
      console.error('Error sending SMS notification:', error);
      res.status(500).json({
        success: false,
        message: 'Error sending SMS notification',
        error: error.message
      });
    }
  }

  /**
   * Send email notification for specific alarm
   */
  async sendEmailNotification(req, res) {
    try {
      const { id } = req.params;
      const alarm = await Alarm.findById(id);
      
      if (!alarm) {
        return res.status(404).json({
          success: false,
          message: 'Alarm not found'
        });
      }

      if (!alarm.notification_config.email_ids || alarm.notification_config.email_ids.length === 0) {
        return res.status(400).json({
          success: false,
          message: 'No email addresses configured for this alarm'
        });
      }

      const results = await this.notificationService.sendEmailNotification(
        alarm, 
        alarm.notification_config.email_ids
      );

      res.json({
        success: true,
        message: 'Email notifications sent',
        data: results
      });
    } catch (error) {
      console.error('Error sending email notification:', error);
      res.status(500).json({
        success: false,
        message: 'Error sending email notification',
        error: error.message
      });
    }
  }

  /**
   * Get device status summary for dashboard
   */
  async getDeviceStatusSummary(req, res) {
    try {
      // Get all devices
      const Device = require('../models/Device');
      const devices = await Device.find({}).lean();

      // Get alarm counts per device
      const summary = [];

      for (const device of devices) {
        const alarmCount = await Alarm.countDocuments({
          device_name: device.deviceName,
          status: 'Active'
        });

        summary.push({
          id: device.deviceId,
          name: device.deviceName,
          unit_no: device.unitNo || 'N/A',
          location: device.location || 'Unknown',
          alarm_count: alarmCount,
          status: this.getDeviceStatus(alarmCount),
          device_type: device.deviceType || 'sensor',
          last_update: device.updatedAt || new Date().toISOString(),
          pv_preview: [
            device.dcv || 0,
            device.dci || 0,
            device.acv || 0
          ]
        });
      }

      res.json({
        success: true,
        data: summary,
        total: summary.length
      });
    } catch (error) {
      console.error('Error fetching device status:', error);
      res.status(500).json({
        success: false,
        message: 'Error fetching device status',
        error: error.message
      });
    }
  }

  /**
   * Get device status based on alarm count
   */
  getDeviceStatus(alarmCount) {
    if (alarmCount >= 3) return 'critical';
    if (alarmCount === 2) return 'warning';
    if (alarmCount === 1) return 'info';
    return 'ok';
  }

  /**
   * Delete all alarms for a specific device
   */
  async deleteDeviceAlarms(req, res) {
    try {
      const { deviceName } = req.params;

      const result = await Alarm.deleteMany({ device_name: deviceName });

      console.log(`🗑️ Deleted ${result.deletedCount} alarms for device '${deviceName}'`);

      res.json({
        success: true,
        message: `Deleted ${result.deletedCount} alarm(s) for device '${deviceName}'`,
        deletedCount: result.deletedCount
      });
    } catch (error) {
      console.error('Error deleting device alarms:', error);
      res.status(500).json({
        success: false,
        message: 'Error deleting device alarms',
        error: error.message
      });
    }
  }

  /**
   * Clear all alarms (admin only)
   */
  async clearAllAlarms(req, res) {
    try {
      const result = await Alarm.deleteMany({});

      console.log(`🗑️ Cleared all ${result.deletedCount} alarms`);

      res.json({
        success: true,
        message: `All ${result.deletedCount} alarms cleared successfully`,
        deletedCount: result.deletedCount
      });
    } catch (error) {
      console.error('Error clearing alarms:', error);
      res.status(500).json({
        success: false,
        message: 'Error clearing alarms',
        error: error.message
      });
    }
  }

  /**
   * Trigger alarm notification (for testing purposes)
   */
  async triggerAlarmNotification(req, res) {
    try {
      const { id } = req.params;
      const alarm = await Alarm.findById(id);
      
      if (!alarm) {
        return res.status(404).json({
          success: false,
          message: 'Alarm not found'
        });
      }

      const results = await this.notificationService.sendAlarmNotifications(alarm);

      res.json({
        success: true,
        message: 'Alarm notifications triggered',
        data: results
      });
    } catch (error) {
      console.error('Error triggering alarm notification:', error);
      res.status(500).json({
        success: false,
        message: 'Error triggering alarm notification',
        error: error.message
      });
    }
  }

  /**
   * Get alarm history/log for all devices
   * Fetches historical alarm trigger records from DeviceHistory
   */
  async getAlarmHistory(req, res) {
    try {
      const { device_name, limit = 50, page = 1, days = 30 } = req.query;
      
      const DeviceHistory = require('../models/DeviceHistory');
      
      // Calculate date range (default: last 30 days)
      const startDate = new Date();
      startDate.setDate(startDate.getDate() - parseInt(days));
      
      // Build filter
      const filter = {
        'data.type': 'ALARM_TRIGGER',
        timestamp: { $gte: startDate }
      };

      // Filter by device if specified
      if (device_name) {
        // Get the device to find its deviceId
        const Device = require('../models/Device');
        const device = await Device.findOne({ name: device_name });
        if (device) {
          filter.deviceId = device.deviceId;
        } else {
          return res.json({
            success: true,
            data: [],
            total: 0,
            message: 'Device not found'
          });
        }
      }

      // Pagination
      const skip = (page - 1) * limit;

      // Fetch alarm history
      const alarmHistory = await DeviceHistory.find(filter)
        .sort({ timestamp: -1 })
        .skip(skip)
        .limit(parseInt(limit))
        .lean();

      const total = await DeviceHistory.countDocuments(filter);

      // Enrich alarm data with device info
      const Device = require('../models/Device');
      const enrichedHistory = await Promise.all(
        alarmHistory.map(async (entry) => {
          const device = await Device.findOne({ deviceId: entry.deviceId });
          return {
            _id: entry._id,
            timestamp: entry.timestamp,
            alarm_type: entry.data.alarmName || 'Unknown',
            device_name: device?.name || entry.deviceId,
            device_id: entry.deviceId,
            location: device?.location || 'Unknown',
            alarm_id: entry.data.alarmId,
            reason: entry.data.reason,
            triggered_values: entry.data.triggered_values || {}
          };
        })
      );

      res.json({
        success: true,
        data: enrichedHistory,
        total: total,
        page: page,
        pages: Math.ceil(total / limit),
        message: `Found ${enrichedHistory.length} alarm history record(s)`
      });
    } catch (error) {
      console.error('Error fetching alarm history:', error);
      res.status(500).json({
        success: false,
        message: 'Error fetching alarm history',
        error: error.message
      });
    }
  }

  /**
   * Get recent alarm triggers
   * Returns the most recent alarm triggers across all alarms
   */
  async getRecentAlarmTriggers(req, res) {
    try {
      const AlarmTrigger = require('../models/AlarmTrigger');
      const limit = parseInt(req.query.limit) || 50;
      const sinceHours = parseInt(req.query.hours) || 24;
      
      // Calculate since time
      const since = new Date();
      since.setHours(since.getHours() - sinceHours);
      
      const triggers = await AlarmTrigger.getRecentTriggers(since);
      
      res.json({
        success: true,
        data: triggers,
        total: triggers.length,
        timeRange: `Last ${sinceHours} hours`,
        message: `Found ${triggers.length} recent alarm trigger(s)`
      });
    } catch (error) {
      console.error('Error fetching recent alarm triggers:', error);
      res.status(500).json({
        success: false,
        message: 'Error fetching recent alarm triggers',
        error: error.message
      });
    }
  }

  /**
   * Get alarm trigger history for a specific alarm
   * Shows all times this alarm has been triggered
   */
  async getAlarmTriggerHistory(req, res) {
    try {
      const AlarmTrigger = require('../models/AlarmTrigger');
      const { alarmId } = req.params;
      const limit = parseInt(req.query.limit) || 50;
      const page = parseInt(req.query.page) || 1;
      const skip = (page - 1) * limit;
      
      // Get trigger history
      const triggers = await AlarmTrigger.find({ alarm_id: alarmId })
        .sort({ triggered_at: -1 })
        .skip(skip)
        .limit(limit)
        .lean();
      
      // Get total count
      const total = await AlarmTrigger.countDocuments({ alarm_id: alarmId });
      
      res.json({
        success: true,
        data: triggers,
        total: total,
        page: page,
        pages: Math.ceil(total / limit),
        message: `Found ${triggers.length} trigger record(s) for this alarm`
      });
    } catch (error) {
      console.error('Error fetching alarm trigger history:', error);
      res.status(500).json({
        success: false,
        message: 'Error fetching alarm trigger history',
        error: error.message
      });
    }
  }

  /**
   * Get all alarm triggers for a specific device
   * Shows all alarms that have been triggered for this device
   */
  async getDeviceTriggerHistory(req, res) {
    try {
      const AlarmTrigger = require('../models/AlarmTrigger');
      const { deviceId } = req.params;
      const limit = parseInt(req.query.limit) || 50;
      const page = parseInt(req.query.page) || 1;
      const skip = (page - 1) * limit;
      
      // Get trigger history
      const triggers = await AlarmTrigger.find({ device_id: deviceId })
        .sort({ triggered_at: -1 })
        .skip(skip)
        .limit(limit)
        .lean();
      
      // Get total count
      const total = await AlarmTrigger.countDocuments({ device_id: deviceId });
      
      res.json({
        success: true,
        data: triggers,
        total: total,
        page: page,
        pages: Math.ceil(total / limit),
        message: `Found ${triggers.length} alarm trigger(s) for device ${deviceId}`
      });
    } catch (error) {
      console.error('Error fetching device alarm trigger history:', error);
      res.status(500).json({
        success: false,
        message: 'Error fetching device alarm trigger history',
        error: error.message
      });
    }
  }
}

module.exports = new AlarmController();