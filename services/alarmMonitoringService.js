const Device = require('../models/Device');
const DeviceHistory = require('../models/DeviceHistory');
const Alarm = require('../models/Alarm');
const EmailService = require('./emailService');
const NotificationService = require('./notificationService');

class AlarmMonitoringService {
  constructor() {
    this.emailService = new EmailService();
    this.notificationService = new NotificationService();
    this.triggeredAlarms = new Map(); // Track which alarms have been triggered
  }

  /**
   * Check device data against alarms ONLY for that specific device
   * @param {Object} deviceData - Device data with parameters
   * @param {String} deviceId - Device ID
   * @param {String} event - Device event status
   */
  async checkAlarmsForDevice(deviceData, deviceId, event = 'NORMAL') {
    try {
      // Get the device to access its information
      const device = await Device.findOne({ deviceId }).lean();
      if (!device) {
        console.log(`[Alarm Monitor] Device ${deviceId} not found`);
        return;
      }

      // IMPORTANT: Fetch ONLY alarms configured for THIS specific device
      const deviceName = device.deviceName || device.deviceId;
      const alarms = await Alarm.getDeviceAlarms(deviceName, 'Active');

      if (alarms.length === 0) {
        // No alarms configured for this device, nothing to check
        return;
      }

      console.log(`[Alarm Monitor] 🔍 Checking ${alarms.length} alarm(s) for device ${deviceName}`);

      // Check each alarm for this device
      for (const alarm of alarms) {
        await this.checkAlarmCondition(alarm, device, deviceData, event);
      }

    } catch (error) {
      console.error('[Alarm Monitor] Error checking alarms:', error);
    }
  }

  /**
   * Check if a specific alarm condition is triggered
   * @param {Object} alarm - Alarm configuration from database
   * @param {Object} device - Device object
   * @param {Object} deviceData - Current device data
   * @param {String} event - Device event status
   */
  async checkAlarmCondition(alarm, device, deviceData, event) {
    try {
      const alarmKey = `${alarm._id.toString()}`;
      let shouldTrigger = false;
      let triggerReason = '';

      // Check 1: Event status is abnormal
      if (event && event !== 'NORMAL') {
        shouldTrigger = true;
        triggerReason = `EVENT status is ${event} (expected NORMAL)`;
      }

      // Check 2: Check device parameters against alarm thresholds (INDEPENDENT)
      // Each parameter has its own user-set threshold
      // Incoming value > threshold = TRIGGER
      if (!shouldTrigger && alarm.device_params) {
        // Handle nested Parameters structure from MQTT payload
        const params = deviceData.Parameters || deviceData;
        
        // Extract incoming parameter values from device data
        // Prefer REF1/REF2/REF3 (actual device measurements), fall back to DCV/DCI/ACV
        const ref1 = parseFloat(params.REF1 || params.ref1 || params.DCV || params.dcv || 0);
        const ref2 = parseFloat(params.REF2 || params.ref2 || params.DCI || params.dci || 0);
        const ref3 = parseFloat(params.REF3 || params.ref3 || params.ACV || params.acv || 0);

        // Get user-set thresholds from alarm (stored as dcv, dci, acv but apply to ref1, ref2, ref3)
        const ref1_threshold = alarm.device_params.dcv;  // Use dcv threshold for REF1
        const ref2_threshold = alarm.device_params.dci;  // Use dci threshold for REF2
        const ref3_threshold = alarm.device_params.acv;  // Use acv threshold for REF3

        console.log(`[Alarm Monitor] 📊 Checking alarm '${alarm.name}' independent thresholds:`, {
          'Incoming REF1': ref1,
          'REF1 Threshold': ref1_threshold,
          'Trigger REF1?': `${ref1} > ${ref1_threshold} = ${ref1_threshold !== 0 && ref1 > ref1_threshold}`,
          'Incoming REF2': ref2,
          'REF2 Threshold': ref2_threshold,
          'Trigger REF2?': `${ref2} > ${ref2_threshold} = ${ref2_threshold !== 0 && ref2 > ref2_threshold}`,
          'Incoming REF3': ref3,
          'REF3 Threshold': ref3_threshold,
          'Trigger REF3?': `${ref3} > ${ref3_threshold} = ${ref3_threshold !== 0 && ref3 > ref3_threshold}`
        });

        // INDEPENDENT CHECK 1: REF1 threshold
        // Trigger if: threshold is set (not 0) AND incoming REF1 > threshold
        if (ref1_threshold && ref1_threshold > 0 && ref1 > ref1_threshold) {
          shouldTrigger = true;
          triggerReason = `REF1 (${ref1}) exceeded threshold (${ref1_threshold})`;
        }

        // INDEPENDENT CHECK 2: REF2 threshold
        // Trigger if: threshold is set (not 0) AND incoming REF2 > threshold
        if (!shouldTrigger && ref2_threshold && ref2_threshold > 0 && ref2 > ref2_threshold) {
          shouldTrigger = true;
          triggerReason = `REF2 (${ref2}) exceeded threshold (${ref2_threshold})`;
        }

        // INDEPENDENT CHECK 3: REF3 threshold
        // Trigger if: threshold is set (not 0) AND incoming REF3 > threshold
        if (!shouldTrigger && ref3_threshold && ref3_threshold > 0 && ref3 > ref3_threshold) {
          shouldTrigger = true;
          triggerReason = `REF3 (${ref3}) exceeded threshold (${ref3_threshold})`;
        }
      }

      // Only trigger if condition is met
      if (shouldTrigger) {
        console.log(`[Alarm Monitor] ⚠️ Alarm '${alarm.name}' triggered for device ${device.deviceName}: ${triggerReason}`);
        await this.sendAlarmNotification(alarm, device, deviceData, triggerReason);
        
        // Record trigger in database
        // Note: alarm is fetched with .lean(), so we need to fetch the full document
        const fullAlarm = await Alarm.findById(alarm._id);
        if (fullAlarm) {
          await fullAlarm.recordTrigger();
        }
      } else {
        console.log(`[Alarm Monitor] ✅ Alarm '${alarm.name}' conditions not met for device ${device.deviceName}`);
      }

    } catch (error) {
      console.error('[Alarm Monitor] Error checking alarm condition:', error);
    }
  }

  /**
   * Send notification for triggered alarm
   * @param {Object} alarm - Alarm object from database
   * @param {Object} device - Device object
   * @param {Object} deviceData - Current device data
   * @param {String} reason - Reason for alarm trigger
   */
  async sendAlarmNotification(alarm, device, deviceData, reason) {
    try {
      const alarmKey = `${alarm._id.toString()}`;

      // Prevent duplicate notifications within 5 minutes
      if (this.triggeredAlarms.has(alarmKey)) {
        const lastTrigger = this.triggeredAlarms.get(alarmKey);
        const timeSinceLastTrigger = Date.now() - lastTrigger;
        if (timeSinceLastTrigger < 5 * 60 * 1000) { // 5 minutes
          console.log(`[Alarm Monitor] ℹ️ Alarm '${alarm.name}' already triggered recently, skipping notification`);
          return;
        }
      }

      // Record this alarm trigger
      this.triggeredAlarms.set(alarmKey, Date.now());

      // Get email addresses from alarm configuration
      const emailAddresses = alarm.notification_config?.email_ids || [];

      if (emailAddresses.length === 0) {
        console.log(`[Alarm Monitor] ⚠️ No email addresses configured for alarm '${alarm.name}'`);
        return;
      }

      // Prepare email data
      const emailData = {
        alarmName: alarm.name,
        deviceName: device.deviceName || device.deviceId,
        parameter: alarm.parameter || 'N/A',
        severity: alarm.severity,
        reason: reason,
        timestamp: new Date().toLocaleString(),
        device_params: {
          ref_1: alarm.device_params?.ref_1 || 0,
          ref_2: alarm.device_params?.ref_2 || 0,
          ref_3: alarm.device_params?.ref_3 || 0,
          dcv: deviceData.dcv || deviceData.voltage || 0,
          dci: deviceData.dci || deviceData.current || 0,
          acv: deviceData.acv || deviceData.acVoltage || 0
        }
      };

      // Send emails to all configured recipients
      for (const email of emailAddresses) {
        try {
          await this.emailService.sendEmail({
            to: email,
            subject: `🚨 ALARM: ${alarm.name} - ${device.deviceName}`,
            template: 'alarm',
            data: emailData
          });
          console.log(`[Alarm Monitor] ✉️ Email sent to ${email} for alarm '${alarm.name}'`);
        } catch (emailError) {
          console.error(`[Alarm Monitor] ❌ Failed to send email to ${email}:`, emailError.message);
        }
      }

      // Log alarm trigger to database
      await this.logAlarmTrigger(alarm, device, deviceData, reason);

    } catch (error) {
      console.error('[Alarm Monitor] Error sending alarm notification:', error);
    }
  }

  /**
   * Log alarm trigger to database for history
   * @param {Object} alarm - Alarm from database
   * @param {Object} device - Device object
   * @param {Object} deviceData - Device data
   * @param {String} reason - Trigger reason
   */
  async logAlarmTrigger(alarm, device, deviceData, reason) {
    try {
      const historyEntry = new DeviceHistory({
        deviceId: device.deviceId,
        timestamp: new Date(),
        data: {
          type: 'ALARM_TRIGGER',
          alarmId: alarm._id,
          alarmName: alarm.name,
          reason: reason,
          device_params: alarm.device_params,
          triggered_values: {
            dcv: deviceData.dcv || deviceData.voltage,
            dci: deviceData.dci || deviceData.current,
            acv: deviceData.acv || deviceData.acVoltage
          }
        },
        topic: `devices/${device.deviceId}/alarm`
      });
      await historyEntry.save();
      console.log(`[Alarm Monitor] 📝 Alarm trigger logged for alarm '${alarm.name}'`);
    } catch (error) {
      console.error('[Alarm Monitor] Error logging alarm trigger:', error);
    }
  }

  /**
   * Clear triggered alarms that are older than the timeout
   */
  clearExpiredAlarms() {
    const now = Date.now();
    const timeout = 5 * 60 * 1000; // 5 minutes

    for (const [key, timestamp] of this.triggeredAlarms.entries()) {
      if (now - timestamp > timeout) {
        this.triggeredAlarms.delete(key);
      }
    }
  }
}

module.exports = new AlarmMonitoringService();

