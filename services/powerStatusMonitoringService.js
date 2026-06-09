/**
 * Power Status Monitoring Service
 * Monitors POWER_STATUS and BATTERY_STATUS changes for devices.
 *
 * Sends notifications when:
 * - Power changes from Mains/OK to OnBattery
 * - Power changes from OnBattery to Mains/OK
 * - Battery status changes to LOW
 */

const EmailService = require('./emailService');
const NotificationService = require('./notificationService');
const Alarm = require('../models/Alarm');

class PowerStatusMonitoringService {
  constructor() {
    this.emailService = new EmailService();
    this.notificationService = new NotificationService();

    // { deviceId: { POWER_STATUS, RAW_POWER_STATUS, BATTERY_STATUS, lastEmailByType } }
    this.devicePowerStatus = new Map();

    // Email throttle: 30 minutes per device per alert type.
    this.emailThrottleTime = 30 * 60 * 1000;

    this.io = null;
  }

  initializeIO(io) {
    this.io = io;
    console.log('[Power Status Monitor] WebSocket initialized for real-time power status notifications');
  }

  normalizePowerStatus(value) {
    if (value === undefined || value === null) return null;

    const normalized = String(value).trim().toLowerCase().replace(/[\s_-]+/g, '');

    if (['ok', 'main', 'mains', 'mainspower', 'ac', 'acpower'].includes(normalized)) {
      return 'MAINS';
    }

    if (['onbattery', 'battery', 'batterypower', 'bat'].includes(normalized)) {
      return 'BATTERY';
    }

    return normalized.toUpperCase();
  }

  getPowerStatusValue(deviceData = {}) {
    const params = deviceData.Parameters || deviceData.parameters || {};

    return deviceData.POWER_STATUS ||
      deviceData.POWER ||
      deviceData['POWER STATUS'] ||
      params.POWER_STATUS ||
      params.POWER ||
      params['POWER STATUS'];
  }

  getBatteryStatusValue(deviceData = {}) {
    const params = deviceData.Parameters || deviceData.parameters || {};

    return deviceData.BATTERY_STATUS ||
      deviceData['Battery STATUS'] ||
      params.BATTERY_STATUS ||
      params['Battery STATUS'];
  }

  async checkPowerStatus(deviceId, deviceData, device) {
    try {
      const powerStatus = this.getPowerStatusValue(deviceData);
      const batteryStatus = this.getBatteryStatusValue(deviceData);
      const normalizedPowerStatus = this.normalizePowerStatus(powerStatus);
      const previousStatus = this.devicePowerStatus.get(deviceId) || {};
      const previousPowerStatus = previousStatus.POWER_STATUS;

      let alert = null;

      if (normalizedPowerStatus && previousPowerStatus && previousPowerStatus !== normalizedPowerStatus) {
        if (previousPowerStatus === 'MAINS' && normalizedPowerStatus === 'BATTERY') {
          alert = {
            type: 'power_failure',
            subject: `Power Failure: ${device.deviceName || deviceId}`,
            reason: 'Power Failure. Device is on battery',
            severity: 'warning'
          };
        } else if (previousPowerStatus === 'BATTERY' && normalizedPowerStatus === 'MAINS') {
          alert = {
            type: 'power_restored',
            subject: `Power Restored: ${device.deviceName || deviceId}`,
            reason: 'Power Restored. Device is on Mains power',
            severity: 'ok'
          };
        } else {
          alert = {
            type: 'power_status_change',
            subject: `Power Status Alert: ${device.deviceName || deviceId}`,
            reason: `Device power status changed from ${previousPowerStatus} to ${normalizedPowerStatus}`,
            severity: 'warning'
          };
        }

        console.log(`[Power Monitor] Power status changed for device ${deviceId}: ${previousPowerStatus} -> ${normalizedPowerStatus}`);
      } else if (batteryStatus && String(batteryStatus).toUpperCase() === 'LOW' && previousStatus.BATTERY_STATUS !== 'LOW') {
        alert = {
          type: 'battery_low',
          subject: `Battery Low: ${device.deviceName || deviceId}`,
          reason: 'Device battery status is LOW (30%)',
          severity: 'battery'
        };

        console.log(`[Power Monitor] Battery LOW for device ${deviceId}`);
      }

      this.devicePowerStatus.set(deviceId, {
        POWER_STATUS: normalizedPowerStatus,
        RAW_POWER_STATUS: powerStatus,
        BATTERY_STATUS: batteryStatus,
        lastEmailByType: previousStatus.lastEmailByType || {}
      });

      if (alert) {
        await this.sendPowerStatusNotification(deviceId, device, deviceData, alert, previousStatus);
      }
    } catch (error) {
      console.error('[Power Monitor] Error checking power status:', error);
    }
  }

  async sendPowerStatusNotification(deviceId, device, deviceData, alert, previousStatus) {
    try {
      console.log(`[Power Monitor] Sending power status notification for device ${deviceId}: ${alert.reason}`);

      const powerStatus = this.getPowerStatusValue(deviceData);
      const batteryStatus = this.getBatteryStatusValue(deviceData);
      const currentTime = Date.now();
      const lastEmailByType = previousStatus.lastEmailByType || {};
      const lastEmailTime = lastEmailByType[alert.type] || 0;
      const timeSinceLastEmail = currentTime - lastEmailTime;

      let shouldSendEmail = true;
      if (timeSinceLastEmail < this.emailThrottleTime) {
        const timeRemaining = Math.ceil((this.emailThrottleTime - timeSinceLastEmail) / 1000);
        const minutes = Math.floor(timeRemaining / 60);
        const seconds = timeRemaining % 60;

        console.log(`[Power Monitor] ${alert.type} email already sent recently, skipping (retry in ${minutes}m ${seconds}s)`);
        shouldSendEmail = false;
      }

      if (this.io) {
        this.io.emit('power:statusChanged', {
          device_id: deviceId,
          device_name: device.deviceName || deviceId,
          notification_type: alert.type,
          reason: alert.reason,
          power_status: powerStatus,
          battery_status: batteryStatus,
          timestamp: new Date().toISOString()
        });
        console.log('[Power Monitor] Power status change event emitted via WebSocket');
      }

      const emailAddresses = await this.getNotificationRecipients(device);

      if (emailAddresses.length > 0 && shouldSendEmail) {
        const emailData = {
          alarmName: alert.subject,
          severity: alert.severity,
          deviceName: device.deviceName || deviceId,
          deviceId,
          reason: alert.reason,
          powerStatus,
          batteryStatus,
          timestamp: this.emailService.formatISTTimestamp()
        };

        let emailsSent = 0;
        for (const email of emailAddresses) {
          try {
            await this.emailService.sendEmail({
              to: email,
              subject: alert.subject,
              template: 'alarm',
              data: emailData
            });
            console.log(`[Power Monitor] Power status email sent to ${email} for device ${deviceId}`);
            emailsSent++;
          } catch (emailError) {
            console.error(`[Power Monitor] Failed to send email to ${email}:`, emailError.message);
          }
        }

        if (emailsSent > 0) {
          this.devicePowerStatus.set(deviceId, {
            POWER_STATUS: this.normalizePowerStatus(powerStatus),
            RAW_POWER_STATUS: powerStatus,
            BATTERY_STATUS: batteryStatus,
            lastEmailByType: {
              ...lastEmailByType,
              [alert.type]: currentTime
            }
          });
          console.log(`[Power Monitor] Email throttle timer set for ${alert.type} on device ${deviceId}`);
        }
      } else if (emailAddresses.length === 0) {
        console.log(`[Power Monitor] No email addresses found for device ${deviceId}`);
      }
    } catch (error) {
      console.error('[Power Monitor] Error sending power status notification:', error);
    }
  }

  async getNotificationRecipients(device) {
    try {
      const deviceName = device.deviceName || device.deviceId;
      const alarms = await Alarm.find({
        status: 'Active',
        $or: [
          { deviceId: device.deviceId },
          { device_name: deviceName }
        ]
      })
        .select('name notification_config.email_ids')
        .lean();

      const emailAddresses = new Set();

      alarms.forEach(alarm => {
        const configuredEmails = alarm.notification_config?.email_ids || [];
        configuredEmails.forEach(email => {
          const normalizedEmail = String(email || '').trim();
          if (normalizedEmail) {
            emailAddresses.add(normalizedEmail);
          }
        });
      });

      const recipients = Array.from(emailAddresses);
      console.log(`[Power Monitor] Found ${recipients.length} alarm-configured email recipient(s) for device ${deviceName}`);
      return recipients;
    } catch (error) {
      console.error('[Power Monitor] Error fetching alarm-configured email recipients:', error);
      return [];
    }
  }

  getPowerStatus(deviceId) {
    return this.devicePowerStatus.get(deviceId) || null;
  }

  clearPowerStatus(deviceId) {
    this.devicePowerStatus.delete(deviceId);
  }
}

module.exports = new PowerStatusMonitoringService();
