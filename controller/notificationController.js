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
 * Fetches both user-specific and broadcast (system-wide) notifications
 */
exports.getUserNotifications = async (req, res) => {
  try {
    const { userId } = req.params;
    const { limit = 100 } = req.query;

    console.log(`[NotificationController] 📡 GET /api/notifications/user/${userId}?limit=${limit}`);
    console.log(`[NotificationController] 🔄 Fetching both user-specific and broadcast notifications`);

    // Fetch both user-specific notifications AND broadcast notifications (user_id: null)
    const notifications = await Notification.find({
      $or: [
        { user_id: userId },           // User-specific notifications
        { user_id: null, type: 'alarm' } // Broadcast alarm notifications
      ]
    })
      .sort({ created_at: -1 })
      .limit(parseInt(limit))
      .lean();

    console.log(`[NotificationController] ✅ Returning ${notifications.length} notifications (users-specific + broadcast)`);

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
 * Includes both user-specific and broadcast notifications
 */
exports.getUnreadNotifications = async (req, res) => {
  try {
    const { userId } = req.params;
    const { limit = 50 } = req.query;

    console.log(`[NotificationController] 📬 GET /api/notifications/user/${userId}/unread?limit=${limit}`);

    const notifications = await Notification.find({
      $or: [
        { user_id: userId, is_read: false },           // Unread user-specific notifications
        { user_id: null, type: 'alarm', is_read: false } // Unread broadcast notifications
      ]
    })
      .sort({ created_at: -1 })
      .limit(parseInt(limit))
      .lean();

    console.log(`[NotificationController] ✅ Found ${notifications.length} unread notifications`);

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

    console.log(`[NotificationController] 📝 markAsRead called for notificationId: ${notificationId}`);

    if (!notificationId) {
      console.error('[NotificationController] ❌ Missing notificationId');
      return res.status(400).json({
        success: false,
        message: 'Missing notificationId parameter'
      });
    }

    // Clean up the notificationId if it has extra characters (e.g., "-timestamp" appended)
    // Format: ObjectId-Timestamp where ObjectId is 24 hex chars
    let cleanId = notificationId;
    
    if (notificationId.includes('-')) {
      // Split by hyphen
      const parts = notificationId.split('-');
      
      // If first part is 24 hex chars (valid ObjectId), use it
      if (parts[0].length === 24 && /^[a-f0-9]{24}$/i.test(parts[0])) {
        cleanId = parts[0];
        if (cleanId !== notificationId) {
          console.log(`[NotificationController] 🔧 Extracted ObjectId from ${notificationId} to ${cleanId}`);
        }
      }
    }

    console.log(`[NotificationController] 🔍 Looking up notification with ID: ${cleanId}`);
    
    const notification = await Notification.markAsRead(cleanId);

    if (!notification) {
      console.error(`[NotificationController] ❌ Notification not found with ID: ${cleanId}`);
      console.log(`[NotificationController] 📝 Original ID was: ${notificationId}`);
      return res.status(404).json({
        success: false,
        message: 'Notification not found',
        searchedId: cleanId
      });
    }

    console.log(`[NotificationController] ✅ Notification marked as read: ${cleanId}`);

    res.status(200).json({
      success: true,
      message: 'Notification marked as read',
      notification
    });
  } catch (error) {
    console.error('[NotificationController] ❌ Error marking notification as read:', error);
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

/**
 * Get all broadcast (system-wide) notifications
 * GET /api/notifications/broadcast/all
 * Returns notifications with null user_id (sent to all users)
 */
exports.getBroadcastNotifications = async (req, res) => {
  try {
    console.log(`[NotificationController] 🚀 getBroadcastNotifications called`);
    const { limit = 100 } = req.query;

    console.log(`[NotificationController] 📡 GET /api/notifications/broadcast/all?limit=${limit}`);
    console.log(`[NotificationController] 📡 Querying for notifications with user_id: null`);

    const notifications = await Notification.find({
      user_id: null,
      type: 'alarm'
    })
      .sort({ created_at: -1 })
      .limit(parseInt(limit))
      .lean();

    console.log(`[NotificationController] ✅ Query completed. Found ${notifications.length} broadcast notifications`);

    const responseData = {
      success: true,
      count: notifications.length,
      notifications,
      message: `Found ${notifications.length} broadcast alarm notifications`
    };
    
    console.log(`[NotificationController] 📤 Sending response:`, { success: true, count: responseData.count });
    res.status(200).json(responseData);
  } catch (error) {
    console.error('[NotificationController] ❌ Error in getBroadcastNotifications:', error);
    res.status(500).json({
      success: false,
      message: 'Error fetching broadcast notifications',
      error: error.message
    });
  }
};

/**
 * Get unread broadcast notifications
 * GET /api/notifications/broadcast/unread
 * Returns unread broadcast notifications with null user_id
 */
exports.getUnreadBroadcastNotifications = async (req, res) => {
  try {
    const { limit = 50 } = req.query;

    console.log(`[NotificationController] 📬 GET /api/notifications/broadcast/unread?limit=${limit}`);

    const notifications = await Notification.find({
      user_id: null,
      type: 'alarm',
      is_read: false
    })
      .sort({ created_at: -1 })
      .limit(parseInt(limit))
      .lean();

    console.log(`[NotificationController] ✅ Returning ${notifications.length} unread broadcast notifications`);

    res.status(200).json({
      success: true,
      count: notifications.length,
      notifications,
      message: `Found ${notifications.length} unread broadcast alarm notifications`
    });
  } catch (error) {
    console.error('[NotificationController] Error fetching unread broadcast notifications:', error);
    res.status(500).json({
      success: false,
      message: 'Error fetching unread broadcast notifications',
      error: error.message
    });
  }
};
