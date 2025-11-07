/**
 * Device Status Monitor
 * Periodically checks device status based on lastSeen timestamp
 * Updates device status to online/warning/offline
 */

const Device = require('../models/Device');

class DeviceStatusMonitor {
  constructor() {
    this.interval = null;
    this.checkIntervalMs = 2 * 60 * 1000; // 2 minutes
    this.warningThresholdMs = 3 * 60 * 1000; // 3 minutes
    this.offlineThresholdMs = 5 * 60 * 1000; // 5 minutes
  }

  /**
   * Start the monitoring service
   */
  start() {
    console.log('[Device Monitor] 🚀 Starting device status monitor...');
    console.log(`[Device Monitor] Check interval: ${this.checkIntervalMs / 1000}s`);
    console.log(`[Device Monitor] Warning threshold: ${this.warningThresholdMs / 1000}s`);
    console.log(`[Device Monitor] Offline threshold: ${this.offlineThresholdMs / 1000}s`);

    // Run initial check
    this.checkDeviceStatus();

    // Schedule periodic checks
    this.interval = setInterval(() => {
      this.checkDeviceStatus();
    }, this.checkIntervalMs);
  }

  /**
   * Stop the monitoring service
   */
  stop() {
    if (this.interval) {
      console.log('[Device Monitor] 🛑 Stopping device status monitor...');
      clearInterval(this.interval);
      this.interval = null;
    }
  }

  /**
   * Check all devices and update their status
   */
  async checkDeviceStatus() {
    try {
      console.log('[Device Monitor] 🔍 Checking device status...');

      const now = new Date();
      
      // Query all devices from MongoDB
      const devices = await Device.find({}).lean();
      
      if (devices.length === 0) {
        console.log('[Device Monitor] ℹ️ No devices found in database');
        return;
      }

      console.log(`[Device Monitor] Found ${devices.length} device(s) to check`);

      const bulkUpdates = [];
      const statusChanges = [];

      // Check each device
      for (const device of devices) {
        const lastSeen = device.status?.lastSeen;
        const currentStatus = device.status?.state || 'offline';
        
        if (!lastSeen) {
          // No lastSeen timestamp, mark as offline
          if (currentStatus !== 'offline') {
            bulkUpdates.push({
              updateOne: {
                filter: { _id: device._id },
                update: { $set: { 'status.state': 'offline' } }
              }
            });
            statusChanges.push({
              deviceId: device.deviceId,
              oldStatus: currentStatus,
              newStatus: 'offline',
              reason: 'No lastSeen timestamp'
            });
          }
          continue;
        }

        const timeSinceLastSeen = now.getTime() - new Date(lastSeen).getTime();
        let newStatus = currentStatus;

        // Determine new status based on lastSeen
        if (timeSinceLastSeen > this.offlineThresholdMs) {
          // Offline: lastSeen > 5 minutes
          newStatus = 'offline';
        } else if (timeSinceLastSeen > this.warningThresholdMs) {
          // Warning: lastSeen between 3-5 minutes
          newStatus = 'warning';
        } else {
          // Online: lastSeen < 3 minutes
          newStatus = 'online';
        }

        // Only update if status has changed
        if (newStatus !== currentStatus) {
          bulkUpdates.push({
            updateOne: {
              filter: { _id: device._id },
              update: { $set: { 'status.state': newStatus } }
            }
          });

          statusChanges.push({
            deviceId: device.deviceId,
            deviceName: device.deviceName || device.deviceId,
            oldStatus: currentStatus,
            newStatus: newStatus,
            lastSeen: lastSeen,
            timeSinceLastSeen: Math.round(timeSinceLastSeen / 1000) + 's'
          });
        }
      }

      // Perform bulk update if there are changes
      if (bulkUpdates.length > 0) {
        const result = await Device.bulkWrite(bulkUpdates);
        console.log(`[Device Monitor] 📝 Updated ${result.modifiedCount} device(s)`);

        // Log status changes
        statusChanges.forEach(change => {
          const emoji = change.newStatus === 'online' ? '✅' : 
                       change.newStatus === 'warning' ? '⚠️' : '❌';
          console.log(
            `[Device Monitor] ${emoji} ${change.deviceName} (${change.deviceId}): ` +
            `${change.oldStatus} → ${change.newStatus} ` +
            `(Last seen: ${change.timeSinceLastSeen} ago)`
          );
        });
      } else {
        console.log('[Device Monitor] ✓ No status changes detected');
      }

      // Summary
      const statusSummary = await this.getStatusSummary();
      console.log(
        `[Device Monitor] 📊 Summary: ` +
        `${statusSummary.online} online, ` +
        `${statusSummary.warning} warning, ` +
        `${statusSummary.offline} offline`
      );

    } catch (error) {
      console.error('[Device Monitor] ❌ Error checking device status:', error);
    }
  }

  /**
   * Get status summary of all devices
   */
  async getStatusSummary() {
    try {
      const summary = await Device.aggregate([
        {
          $group: {
            _id: '$status.state',
            count: { $sum: 1 }
          }
        }
      ]);

      const result = {
        online: 0,
        warning: 0,
        offline: 0
      };

      summary.forEach(item => {
        if (item._id === 'online') result.online = item.count;
        else if (item._id === 'warning') result.warning = item.count;
        else if (item._id === 'offline') result.offline = item.count;
      });

      return result;
    } catch (error) {
      console.error('[Device Monitor] ❌ Error getting status summary:', error);
      return { online: 0, warning: 0, offline: 0 };
    }
  }

  /**
   * Force immediate status check (useful for testing)
   */
  async forceCheck() {
    await this.checkDeviceStatus();
  }
}

// Export singleton instance
module.exports = new DeviceStatusMonitor();
