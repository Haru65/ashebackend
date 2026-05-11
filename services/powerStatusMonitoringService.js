/**
 * Power Status Monitoring Service
 * Monitors POWER_STATUS and BATTERY_STATUS changes for devices
 * Sends email notifications when:
 * - Power changes from Mains to Battery or vice versa
 * - Battery status changes to LOW
 */

const EmailService = require('./emailService');
const NotificationService = require('./notificationService');
const User = require('../models/User');

class PowerStatusMonitoringService {
  constructor() {
    this.emailService = new EmailService();
    this.notificationService = new NotificationService();
    
    // Track previous power status for each device
    this.devicePowerStatus = new Map(); // { deviceId: { POWER_STATUS, BATTERY_STATUS, lastEmailTime } }
    
    // Email throttle: 30 minutes per device
    this.emailThrottleTime = 30 * 60 * 1000; // 30 minutes
    
    this.io = null;
  }

  /**
   * Initialize with Socket.IO instance for real-time notifications
   */
  initializeIO(io) {
    this.io = io;
    console.log('✅ [Power Status Monitor] WebSocket initialized for real-time power status notifications');
  }

  /**
   * Check power status changes for a device
   * @param {string} deviceId - Device ID
   * @param {object} deviceData - Current device data from MQTT
   * @param {object} device - Device object from database
   */
  async checkPowerStatus(deviceId, deviceData, device) {
    try {
      const powerStatus = deviceData.POWER_STATUS || deviceData.POWER;
      const batteryStatus = deviceData.BATTERY_STATUS;
      const timestamp = new Date();

      // Get previous status
      const previousStatus = this.devicePowerStatus.get(deviceId) || {};
      
      let emailTrigger = false;
      let emailReason = '';

      // Check for POWER_STATUS change
      if (powerStatus && previousStatus.POWER_STATUS && previousStatus.POWER_STATUS !== powerStatus) {
        const statusText = powerStatus.toLowerCase() === 'ok' ? 'Mains' : 'Battery';
        const previousStatusText = previousStatus.POWER_STATUS.toLowerCase() === 'ok' ? 'Mains' : 'Battery';
        
        emailTrigger = true;
        emailReason = `Device power changed from ${previousStatusText} to ${statusText}`;
        
        console.log(`[Power Monitor] ⚡ Power status changed for device ${deviceId}: ${previousStatusText} → ${statusText}`);
      }

      // Check for BATTERY_STATUS = LOW
      if (batteryStatus && batteryStatus.toUpperCase() === 'LOW') {
        if (previousStatus.BATTERY_STATUS !== 'LOW') {
          emailTrigger = true;
          emailReason = `Device battery status is LOW (30%)`;
          
          console.log(`[Power Monitor] 🔋 Battery LOW for device ${deviceId}`);
        }
      }

      // Update stored status
      this.devicePowerStatus.set(deviceId, {
        POWER_STATUS: powerStatus,
        BATTERY_STATUS: batteryStatus,
        lastEmailTime: previousStatus.lastEmailTime || 0
      });

      // Send notification if triggered
      if (emailTrigger) {
        await this.sendPowerStatusNotification(deviceId, device, deviceData, emailReason, previousStatus);
      }

    } catch (error) {
      console.error('[Power Monitor] Error checking power status:', error);
    }
  }

  /**
   * Send notification for power status change
   * @param {string} deviceId - Device ID
   * @param {object} device - Device object
   * @param {object} deviceData - Current device data
   * @param {string} reason - Reason for notification
   * @param {object} previousStatus - Previous status object
   */
  async sendPowerStatusNotification(deviceId, device, deviceData, reason, previousStatus) {
    try {
      console.log(`[Power Monitor] 📢 Sending power status notification for device ${deviceId}: ${reason}`);

      // Check email throttle (30 minutes per device)
      const throttleKey = `${deviceId}_power_email`;
      const currentTime = Date.now();
      const lastEmailTime = previousStatus.lastEmailTime || 0;
      const timeSinceLastEmail = currentTime - lastEmailTime;

      let shouldSendEmail = true;
      if (timeSinceLastEmail < this.emailThrottleTime) {
        const timeRemaining = Math.ceil((this.emailThrottleTime - timeSinceLastEmail) / 1000);
        const minutes = Math.floor(timeRemaining / 60);
        const seconds = timeRemaining % 60;
        
        console.log(`[Power Monitor] ℹ️ Power status email already sent recently, skipping (retry in ${minutes}m ${seconds}s)`);
        shouldSendEmail = false;
      }

      // Emit WebSocket notification (no throttle for UI updates)
      if (this.io) {
        const notificationData = {
          device_id: deviceId,
          device_name: device.deviceName || deviceId,
          notification_type: 'power_status_change',
          reason: reason,
          power_status: deviceData.POWER_STATUS || deviceData.POWER,
          battery_status: deviceData.BATTERY_STATUS,
          timestamp: new Date().toISOString()
        };

        this.io.emit('power:statusChanged', notificationData);
        console.log(`[Power Monitor] ✅ Power status change event emitted via WebSocket`);
      }

      // Get all admin/owner users for email notification
      let emailAddresses = [];
      try {
        // Get device owner if available
        if (device.createdBy) {
          const owner = await User.findById(device.createdBy).select('email');
          if (owner && owner.email) {
            emailAddresses.push(owner.email);
          }
        }

        // Get all admin users
        const admins = await User.find({ role: 'admin' }).select('email');
        admins.forEach(admin => {
          if (admin.email && !emailAddresses.includes(admin.email)) {
            emailAddresses.push(admin.email);
          }
        });
      } catch (userError) {
        console.error('[Power Monitor] Error fetching user emails:', userError);
      }

      // Send emails
      if (emailAddresses.length > 0 && shouldSendEmail) {
        const powerStatus = deviceData.POWER_STATUS || deviceData.POWER;
        const batteryStatus = deviceData.BATTERY_STATUS;
        
        const emailData = {
          deviceName: device.deviceName || deviceId,
          deviceId: deviceId,
          reason: reason,
          powerStatus: powerStatus,
          batteryStatus: batteryStatus,
          timestamp: new Date().toLocaleString()
        };

        let emailsSent = 0;
        for (const email of emailAddresses) {
          try {
            await this.emailService.sendEmail({
              to: email,
              subject: `⚡ Power Status Alert: ${device.deviceName || deviceId}`,
              template: 'alarm', // Reuse alarm template for consistency
              data: emailData
            });
            console.log(`[Power Monitor] ✉️ Power status email sent to ${email} for device ${deviceId}`);
            emailsSent++;
          } catch (emailError) {
            console.error(`[Power Monitor] ❌ Failed to send email to ${email}:`, emailError.message);
          }
        }

        // Update throttle timer
        if (emailsSent > 0) {
          this.devicePowerStatus.set(deviceId, {
            POWER_STATUS: deviceData.POWER_STATUS || deviceData.POWER,
            BATTERY_STATUS: deviceData.BATTERY_STATUS,
            lastEmailTime: currentTime
          });
          console.log(`[Power Monitor] ⏱️ Email throttle timer set for device ${deviceId} (30 minutes)`);
        }
      } else if (emailAddresses.length === 0) {
        console.log(`[Power Monitor] ⚠️ No email addresses found for device ${deviceId}`);
      }

    } catch (error) {
      console.error('[Power Monitor] Error sending power status notification:', error);
    }
  }

  /**
   * Get current power status for a device
   */
  getPowerStatus(deviceId) {
    return this.devicePowerStatus.get(deviceId) || null;
  }

  /**
   * Clear power status tracking for a device
   */
  clearPowerStatus(deviceId) {
    this.devicePowerStatus.delete(deviceId);
  }
}

module.exports = new PowerStatusMonitoringService();
