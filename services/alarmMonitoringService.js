const Device = require('../models/Device');
const DeviceHistory = require('../models/DeviceHistory');
const Alarm = require('../models/Alarm');
const AlarmTrigger = require('../models/AlarmTrigger');
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

      // Check 0: Check REF Status values (OP, UP, FAIL)
      // REF status values are string enums that indicate reference probe status
      const params = deviceData.Parameters || deviceData;
      const ref1Status = params['REF1 STS'] || params['ref1_sts'] || '';
      const ref2Status = params['REF2 STS'] || params['ref2_sts'] || '';
      const ref3Status = params['REF3 STS'] || params['ref3_sts'] || '';
      
      // Valid REF status values that should trigger alarm
      const validRefStatuses = ['OP', 'UP', 'FAIL'];
      
      // Check if any REF status has a valid value (OP, UP, or FAIL)
      if (validRefStatuses.includes(ref1Status.toUpperCase?.() || ref1Status)) {
        shouldTrigger = true;
        triggerReason = `REF1 STS is '${ref1Status}' (valid status detected)`;
      }
      
      if (!shouldTrigger && validRefStatuses.includes(ref2Status.toUpperCase?.() || ref2Status)) {
        shouldTrigger = true;
        triggerReason = `REF2 STS is '${ref2Status}' (valid status detected)`;
      }
      
      if (!shouldTrigger && validRefStatuses.includes(ref3Status.toUpperCase?.() || ref3Status)) {
        shouldTrigger = true;
        triggerReason = `REF3 STS is '${ref3Status}' (valid status detected)`;
      }

      // Check 1: Event status is abnormal
      if (!shouldTrigger && event && event !== 'NORMAL') {
        shouldTrigger = true;
        triggerReason = `EVENT status is ${event} (expected NORMAL)`;
      }

      // Check 2: Check device parameters against alarm thresholds (INDEPENDENT)
      // Each parameter has its own user-set threshold with upper and lower bounds
      // Alarm triggers if value exceeds upper bound or falls below lower bound
      if (!shouldTrigger && alarm.device_params) {
        // Handle nested Parameters structure from MQTT payload
        const params = deviceData.Parameters || deviceData;
        
        // Extract incoming parameter values from device data
        // Prefer REF1/REF2/REF3 (actual device measurements), fall back to DCV/DCI/ACV
        const ref1 = parseFloat(params.REF1 || params.ref1 || params.DCV || params.dcv || 0);
        const ref2 = parseFloat(params.REF2 || params.ref2 || params.DCI || params.dci || 0);
        const ref3 = parseFloat(params.REF3 || params.ref3 || params.ACV || params.acv || 0);
        const dcv = parseFloat(params.DCV || params.dcv || 0);
        const dci = parseFloat(params.DCI || params.dci || 0);
        const acv = parseFloat(params.ACV || params.acv || 0);

        // Get user-set thresholds from alarm with upper and lower bounds
        const ref1_upper = alarm.device_params.ref_1_upper || 0;
        const ref1_lower = alarm.device_params.ref_1_lower || 0;
        const ref2_upper = alarm.device_params.ref_2_upper || 0;
        const ref2_lower = alarm.device_params.ref_2_lower || 0;
        const ref3_upper = alarm.device_params.ref_3_upper || 0;
        const ref3_lower = alarm.device_params.ref_3_lower || 0;
        const dcv_upper = alarm.device_params.dcv_upper || 0;
        const dcv_lower = alarm.device_params.dcv_lower || 0;
        const dci_upper = alarm.device_params.dci_upper || 0;
        const dci_lower = alarm.device_params.dci_lower || 0;
        const acv_upper = alarm.device_params.acv_upper || 0;
        const acv_lower = alarm.device_params.acv_lower || 0;

        console.log(`[Alarm Monitor] 📊 Checking alarm '${alarm.name}' with upper/lower bounds:`, {
          'REF1': { value: ref1, upper: ref1_upper, lower: ref1_lower },
          'REF2': { value: ref2, upper: ref2_upper, lower: ref2_lower },
          'REF3': { value: ref3, upper: ref3_upper, lower: ref3_lower },
          'REF1 STS': ref1Status,
          'REF2 STS': ref2Status,
          'REF3 STS': ref3Status,
          'DCV': { value: dcv, upper: dcv_upper, lower: dcv_lower },
          'DCI': { value: dci, upper: dci_upper, lower: dci_lower },
          'ACV': { value: acv, upper: acv_upper, lower: acv_lower }
        });

        // INDEPENDENT CHECK 1: REF1 bounds
        // Trigger if: value > upper bound OR value < lower bound
        if ((ref1_upper && ref1 > ref1_upper) || (ref1_lower && ref1 < ref1_lower)) {
          shouldTrigger = true;
          triggerReason = `REF1 (${ref1}) out of bounds [${ref1_lower}, ${ref1_upper}]`;
        }

        // INDEPENDENT CHECK 2: REF2 bounds
        // Trigger if: value > upper bound OR value < lower bound
        if (!shouldTrigger && ((ref2_upper && ref2 > ref2_upper) || (ref2_lower && ref2 < ref2_lower))) {
          shouldTrigger = true;
          triggerReason = `REF2 (${ref2}) out of bounds [${ref2_lower}, ${ref2_upper}]`;
        }

        // INDEPENDENT CHECK 3: REF3 bounds
        // Trigger if: value > upper bound OR value < lower bound
        if (!shouldTrigger && ((ref3_upper && ref3 > ref3_upper) || (ref3_lower && ref3 < ref3_lower))) {
          shouldTrigger = true;
          triggerReason = `REF3 (${ref3}) out of bounds [${ref3_lower}, ${ref3_upper}]`;
        }

        // INDEPENDENT CHECK 4: DCV bounds
        if (!shouldTrigger && ((dcv_upper && dcv > dcv_upper) || (dcv_lower && dcv < dcv_lower))) {
          shouldTrigger = true;
          triggerReason = `DCV (${dcv}) out of bounds [${dcv_lower}, ${dcv_upper}]`;
        }

        // INDEPENDENT CHECK 5: DCI bounds
        if (!shouldTrigger && ((dci_upper && dci > dci_upper) || (dci_lower && dci < dci_lower))) {
          shouldTrigger = true;
          triggerReason = `DCI (${dci}) out of bounds [${dci_lower}, ${dci_upper}]`;
        }

        // INDEPENDENT CHECK 6: ACV bounds
        if (!shouldTrigger && ((acv_upper && acv > acv_upper) || (acv_lower && acv < acv_lower))) {
          shouldTrigger = true;
          triggerReason = `ACV (${acv}) out of bounds [${acv_lower}, ${acv_upper}]`;
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
      // ALWAYS log alarm trigger to database history (regardless of throttling)
      // This ensures every trigger is recorded for audit trail
      await this.logAlarmTrigger(alarm, device, deviceData, reason);

      const alarmKey = `${alarm._id.toString()}`;

      // Check if this is the first trigger for this alarm
      if (!this.triggeredAlarms.has(alarmKey)) {
        // First trigger - send email immediately without any wait
        console.log(`[Alarm Monitor] 📧 First trigger for alarm '${alarm.name}', sending email immediately`);
      } else {
        // Not first trigger - apply 30-minute throttle
        const lastTrigger = this.triggeredAlarms.get(alarmKey);
        const timeSinceLastTrigger = Date.now() - lastTrigger;
        if (timeSinceLastTrigger < 30 * 60 * 1000) { // 30 minutes
          const minutesRemaining = 30 - Math.floor(timeSinceLastTrigger / 60 / 1000);
          console.log(`[Alarm Monitor] ℹ️ Alarm '${alarm.name}' throttled, next email in ${minutesRemaining} mins`);
          return;
        }
      }

      // Record this alarm trigger (for next throttle check)
      this.triggeredAlarms.set(alarmKey, Date.now());

      // Get email addresses from alarm configuration
      const emailAddresses = alarm.notification_config?.email_ids || [];

      if (emailAddresses.length === 0) {
        console.log(`[Alarm Monitor] ⚠️ No email addresses configured for alarm '${alarm.name}'`);
        return;
      }

      // Prepare email data
      const params = deviceData.Parameters || deviceData;
      const emailData = {
        alarmName: alarm.name,
        deviceName: device.deviceName || device.deviceId,
        parameter: alarm.parameter || 'N/A',
        severity: alarm.severity,
        reason: reason,
        timestamp: new Date().toLocaleString(),
        device_params: {
          ref_1: { upper: alarm.device_params?.ref_1_upper || 0, lower: alarm.device_params?.ref_1_lower || 0, value: params.REF1 || params.ref1 || 0 },
          ref_2: { upper: alarm.device_params?.ref_2_upper || 0, lower: alarm.device_params?.ref_2_lower || 0, value: params.REF2 || params.ref2 || 0 },
          ref_3: { upper: alarm.device_params?.ref_3_upper || 0, lower: alarm.device_params?.ref_3_lower || 0, value: params.REF3 || params.ref3 || 0 },
          dcv: { upper: alarm.device_params?.dcv_upper || 0, lower: alarm.device_params?.dcv_lower || 0, value: params.DCV || params.dcv || 0 },
          dci: { upper: alarm.device_params?.dci_upper || 0, lower: alarm.device_params?.dci_lower || 0, value: params.DCI || params.dci || 0 },
          acv: { upper: alarm.device_params?.acv_upper || 0, lower: alarm.device_params?.acv_lower || 0, value: params.ACV || params.acv || 0 },
          di1: params.DI1 || params.di1 || 'N/A',
          di2: params.DI2 || params.di2 || 'N/A',
          di3: params.DI3 || params.di3 || 'N/A',
          di4: params.DI4 || params.di4 || 'N/A',
          do1: params.DO || params.do || 'N/A',
          event: params.EVENT || params.Event || 'NORMAL',
          mode: params.MODE || params.mode || 'N/A'
        }
      };

      // Send emails to all configured recipients
      for (const email of emailAddresses) {
        try {
          console.log(`[Alarm Monitor] 📧 Attempting to send email to ${email}...`);
          await this.emailService.sendEmail({
            to: email,
            subject: `🚨 ALARM: ${alarm.name} - ${device.deviceName}`,
            template: 'alarm',
            data: emailData
          });
          console.log(`[Alarm Monitor] ✉️ Email successfully sent to ${email} for alarm '${alarm.name}'`);
        } catch (emailError) {
          console.error(`[Alarm Monitor] ❌ FAILED to send email to ${email}:`, emailError.message);
          // Log the full error stack for debugging
          console.error(`[Alarm Monitor] Error details:`, emailError.stack);
        }
      }

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
      // Extract all relevant parameters from device data
      const params = deviceData.Parameters || deviceData;
      const triggeredValues = {
        'REF1 STS': params['REF1 STS'] || '',
        'REF2 STS': params['REF2 STS'] || '',
        'REF3 STS': params['REF3 STS'] || '',
        'REF1': params.REF1 || params.ref1 || '',
        'REF2': params.REF2 || params.ref2 || '',
        'REF3': params.REF3 || params.ref3 || '',
        'DCV': params.DCV || params.dcv || 0,
        'DCI': params.DCI || params.dci || 0,
        'ACV': params.ACV || params.acv || 0,
        'EVENT': params.EVENT || params.Event || 'NORMAL'
      };

      // Save to DeviceHistory (existing behavior)
      const historyEntry = new DeviceHistory({
        deviceId: device.deviceId,
        timestamp: new Date(),
        data: {
          type: 'ALARM_TRIGGER',
          alarmId: alarm._id,
          alarmName: alarm.name,
          reason: reason,
          device_params: alarm.device_params,
          triggered_values: triggeredValues
        },
        topic: `devices/${device.deviceId}/alarm`
      });
      await historyEntry.save();
      console.log(`[Alarm Monitor] 📝 Alarm trigger logged to DeviceHistory for alarm '${alarm.name}'`);

      // Save to AlarmTrigger model (new detailed logging)
      await AlarmTrigger.recordTrigger({
        alarm_id: alarm._id,
        alarm_name: alarm.name,
        device_id: device.deviceId,
        device_name: device.deviceName || device.deviceId,
        trigger_reason: reason,
        triggered_values: triggeredValues,
        alarm_config: {
          severity: alarm.severity,
          parameter: alarm.parameter,
          device_params: alarm.device_params
        },
        event_status: params.EVENT || params.Event || 'NORMAL',
        notification_status: 'SENT'
      });

      console.log(`[Alarm Monitor] 💾 Alarm trigger saved to AlarmTrigger for alarm '${alarm.name}'`);
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

