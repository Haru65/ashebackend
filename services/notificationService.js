const Notification = require('../models/Notification');

/**
 * NotificationService
 * Handles creation and management of user notifications
 */
class NotificationService {
  constructor() {
    this.notificationCache = new Map(); // Cache for quick lookups
  }

  /**
   * Create a notification for an alarm trigger
   * @param {Object} params - Notification parameters
   */
  async createAlarmNotification(params) {
    try {
      const {
        user_id,
        alarm_id,
        alarm_name,
        device_id,
        device_name,
        trigger_reason,
        severity,
        triggered_values
      } = params;

      // Allow user_id to be null (for broadcast notifications), but must be defined
      if (user_id === undefined) {
        console.warn('[NotificationService] ⚠️ Cannot create notification: user_id must be defined (can be null for broadcast)');
        return null;
      }

      console.log('[NotificationService] 📝 Creating alarm notification:', {
        user_id: user_id ? (user_id.toString ? user_id.toString() : user_id) : '(broadcast)',
        alarm_name,
        device_name
      });

      const notification = await Notification.createNotification({
        user_id, // Pass as-is (can be ObjectId or string)
        type: 'alarm',
        alarm_id,
        alarm_name,
        device_id,
        device_name,
        title: `🚨 ALARM: ${alarm_name}`,
        message: `Alarm triggered on device ${device_name || device_id}`,
        trigger_reason,
        severity: severity || 'warning',
        triggered_values: triggered_values || {},
        metadata: {
          notification_type: 'alarm_trigger'
        }
      });

      if (!notification || !notification._id) {
        console.error('[NotificationService] ❌ Failed to create notification - returned null or invalid');
        return null;
      }

      console.log(`[NotificationService] ✅ Created alarm notification: ${notification._id}`);
      return notification;
    } catch (error) {
      console.error('[NotificationService] Error creating alarm notification:', error);
      return null;
    }
  }

  /**
   * Create a calibration notification
   * @param {Object} params - Notification parameters
   */
  async createCalibrationNotification(params) {
    try {
      const {
        user_id,
        device_id,
        device_name,
        calibration_due_date
      } = params;

      if (!user_id) {
        console.warn('[NotificationService] ⚠️ Cannot create notification: user_id is required');
        return null;
      }

      const notification = await Notification.createNotification({
        user_id,
        type: 'calibration',
        device_id,
        device_name,
        title: `📋 Calibration Due: ${device_name}`,
        message: `Calibration is due on ${calibration_due_date}`,
        severity: 'info',
        metadata: {
          notification_type: 'calibration_due',
          calibration_due_date
        }
      });

      console.log(`[NotificationService] ✅ Created calibration notification for user ${user_id}`);
      return notification;
    } catch (error) {
      console.error('[NotificationService] Error creating calibration notification:', error);
      return null;
    }
  }

  /**
   * Create a maintenance notification
   * @param {Object} params - Notification parameters
   */
  async createMaintenanceNotification(params) {
    try {
      const {
        user_id,
        device_id,
        device_name,
        maintenance_due_date
      } = params;

      if (!user_id) {
        console.warn('[NotificationService] ⚠️ Cannot create notification: user_id is required');
        return null;
      }

      const notification = await Notification.createNotification({
        user_id,
        type: 'maintenance',
        device_id,
        device_name,
        title: `🔧 Maintenance Due: ${device_name}`,
        message: `Maintenance is due on ${maintenance_due_date}`,
        severity: 'warning',
        metadata: {
          notification_type: 'maintenance_due',
          maintenance_due_date
        }
      });

      console.log(`[NotificationService] ✅ Created maintenance notification for user ${user_id}`);
      return notification;
    } catch (error) {
      console.error('[NotificationService] Error creating maintenance notification:', error);
      return null;
    }
  }

  /**
   * Get unread notifications for a user
   * @param {String} userId - User ID
   */
  async getUnreadNotifications(userId) {
    try {
      return await Notification.getUnread(userId);
    } catch (error) {
      console.error('[NotificationService] Error fetching unread notifications:', error);
      return [];
    }
  }

  /**
   * Get all notifications for a user
   * @param {String} userId - User ID
   */
  async getUserNotifications(userId, limit = 100) {
    try {
      return await Notification.getUserNotifications(userId, limit);
    } catch (error) {
      console.error('[NotificationService] Error fetching user notifications:', error);
      return [];
    }
  }

  /**
   * Mark notification as read
   * @param {String} notificationId - Notification ID
   */
  async markAsRead(notificationId) {
    try {
      return await Notification.markAsRead(notificationId);
    } catch (error) {
      console.error('[NotificationService] Error marking notification as read:', error);
      return null;
    }
  }

  /**
   * Mark all notifications as read for a user
   * @param {String} userId - User ID
   */
  async markAllAsRead(userId) {
    try {
      return await Notification.markAllAsRead(userId);
    } catch (error) {
      console.error('[NotificationService] Error marking all notifications as read:', error);
      return null;
    }
  }

  /**
   * Delete a notification
   * @param {String} notificationId - Notification ID
   */
  async deleteNotification(notificationId) {
    try {
      return await Notification.findByIdAndDelete(notificationId);
    } catch (error) {
      console.error('[NotificationService] Error deleting notification:', error);
      return null;
    }
  }

  /**
   * Get notification count for a user
   * @param {String} userId - User ID
   */
  async getNotificationCount(userId) {
    try {
      const unreadCount = await Notification.countDocuments({
        user_id: userId,
        is_read: false
      });

      const totalCount = await Notification.countDocuments({
        user_id: userId
      });

      return { unreadCount, totalCount };
    } catch (error) {
      console.error('[NotificationService] Error getting notification count:', error);
      return { unreadCount: 0, totalCount: 0 };
    }
  }
}

module.exports = NotificationService;
