const Notification = require('../models/Notification');

/**
 * Create a new notification
 * POST /api/notifications
 */
exports.createNotification = async (req, res) => {
  try {
    const {
      user_id,
      type,
      alarm_id,
      alarm_name,
      device_id,
      device_name,
      title,
      message,
      trigger_reason,
      severity,
      triggered_values,
      metadata
    } = req.body;

    console.log(`[NotificationController] 📝 Creating notification for user: ${user_id}, title: ${title}`);

    if (!user_id || !title || !message) {
      console.warn('[NotificationController] ⚠️ Missing required fields');
      return res.status(400).json({
        success: false,
        message: 'Missing required fields: user_id, title, message'
      });
    }

    const notification = await Notification.createNotification({
      user_id,
      type: type || 'alarm',
      alarm_id,
      alarm_name,
      device_id,
      device_name,
      title,
      message,
      trigger_reason,
      severity: severity || 'warning',
      triggered_values: triggered_values || {},
      metadata: metadata || {}
    });

    console.log(`[NotificationController] ✅ Notification created: ${notification._id}`);

    res.status(201).json({
      success: true,
      message: 'Notification created successfully',
      notification
    });
  } catch (error) {
    console.error('[NotificationController] Error creating notification:', error);
    res.status(500).json({
      success: false,
      message: 'Error creating notification',
      error: error.message
    });
  }
};

/**
 * Get all notifications for a user
 * GET /api/notifications/user/:userId
 */
exports.getUserNotifications = async (req, res) => {
  try {
    const { userId } = req.params;
    const { limit = 100 } = req.query;

    console.log(`[NotificationController] 📡 GET /api/notifications/user/${userId}?limit=${limit}`);

    const notifications = await Notification.getUserNotifications(userId, parseInt(limit));

    console.log(`[NotificationController] ✅ Returning ${notifications.length} notifications`);

    res.status(200).json({
      success: true,
      count: notifications.length,
      notifications
    });
  } catch (error) {
    console.error('[NotificationController] Error fetching user notifications:', error);
    res.status(500).json({
      success: false,
      message: 'Error fetching notifications',
      error: error.message
    });
  }
};

/**
 * Get unread notifications for a user
 * GET /api/notifications/user/:userId/unread
 */
exports.getUnreadNotifications = async (req, res) => {
  try {
    const { userId } = req.params;
    const { limit = 50 } = req.query;

    const notifications = await Notification.getUnread(userId, parseInt(limit));

    res.status(200).json({
      success: true,
      count: notifications.length,
      notifications
    });
  } catch (error) {
    console.error('[NotificationController] Error fetching unread notifications:', error);
    res.status(500).json({
      success: false,
      message: 'Error fetching unread notifications',
      error: error.message
    });
  }
};

/**
 * Mark notification as read
 * PUT /api/notifications/:notificationId/read
 */
exports.markAsRead = async (req, res) => {
  try {
    const { notificationId } = req.params;

    const notification = await Notification.markAsRead(notificationId);

    res.status(200).json({
      success: true,
      message: 'Notification marked as read',
      notification
    });
  } catch (error) {
    console.error('[NotificationController] Error marking notification as read:', error);
    res.status(500).json({
      success: false,
      message: 'Error marking notification as read',
      error: error.message
    });
  }
};

/**
 * Mark all notifications as read for a user
 * PUT /api/notifications/user/:userId/read-all
 */
exports.markAllAsRead = async (req, res) => {
  try {
    const { userId } = req.params;

    const result = await Notification.markAllAsRead(userId);

    res.status(200).json({
      success: true,
      message: 'All notifications marked as read',
      modifiedCount: result.modifiedCount
    });
  } catch (error) {
    console.error('[NotificationController] Error marking all notifications as read:', error);
    res.status(500).json({
      success: false,
      message: 'Error marking all notifications as read',
      error: error.message
    });
  }
};

/**
 * Delete a notification
 * DELETE /api/notifications/:notificationId
 */
exports.deleteNotification = async (req, res) => {
  try {
    const { notificationId } = req.params;

    const result = await Notification.findByIdAndDelete(notificationId);

    if (!result) {
      return res.status(404).json({
        success: false,
        message: 'Notification not found'
      });
    }

    res.status(200).json({
      success: true,
      message: 'Notification deleted successfully'
    });
  } catch (error) {
    console.error('[NotificationController] Error deleting notification:', error);
    res.status(500).json({
      success: false,
      message: 'Error deleting notification',
      error: error.message
    });
  }
};

/**
 * Get notification count for a user
 * GET /api/notifications/user/:userId/count
 */
exports.getNotificationCount = async (req, res) => {
  try {
    const { userId } = req.params;

    const unreadCount = await Notification.countDocuments({
      user_id: userId,
      is_read: false
    });

    const totalCount = await Notification.countDocuments({
      user_id: userId
    });

    res.status(200).json({
      success: true,
      unreadCount,
      totalCount
    });
  } catch (error) {
    console.error('[NotificationController] Error getting notification count:', error);
    res.status(500).json({
      success: false,
      message: 'Error getting notification count',
      error: error.message
    });
  }
};
