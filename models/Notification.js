const mongoose = require('mongoose');
const { Schema } = mongoose;

/**
 * Notification Schema
 * Stores user notifications for alarm triggers and other system events
 * Provides persistent notification history that users can view in the UI
 */

const NotificationSchema = new Schema({
  // User Reference (optional for broadcast notifications)
  user_id: { 
    type: Schema.Types.ObjectId, 
    index: true,
    sparse: true
  },
  
  // Notification Type
  type: {
    type: String,
    enum: ['alarm', 'calibration', 'maintenance', 'system'],
    default: 'alarm',
    index: true
  },
  
  // Alarm Reference (if type is 'alarm')
  alarm_id: { 
    type: Schema.Types.ObjectId, 
    ref: 'Alarm',
    index: true,
    sparse: true
  },
  alarm_name: { 
    type: String,
    sparse: true
  },
  
  // Device Reference
  device_id: { 
    type: String,
    sparse: true,
    index: true
  },
  device_name: { 
    type: String,
    sparse: true
  },
  
  // Notification Content
  title: { 
    type: String, 
    required: true
  },
  message: { 
    type: String, 
    required: true
  },
  trigger_reason: { 
    type: String,
    sparse: true
  },
  
  // Severity Level
  severity: {
    type: String,
    enum: ['critical', 'high', 'warning', 'info'],
    default: 'warning'
  },
  
  // Status
  is_read: {
    type: Boolean,
    default: false,
    index: true
  },
  
  // Triggered Values (for alarm notifications)
  triggered_values: {
    type: Schema.Types.Mixed,
    default: {}
  },
  
  // Timestamp
  created_at: { 
    type: Date, 
    required: true, 
    default: Date.now,
    index: true
  },
  read_at: {
    type: Date,
    sparse: true
  },
  
  // Metadata
  metadata: {
    type: Schema.Types.Mixed,
    default: {}
  }
}, {
  timestamps: true,
  collection: 'notifications'
});

// Indexes for efficient queries
NotificationSchema.index({ user_id: 1, created_at: -1 });
NotificationSchema.index({ user_id: 1, is_read: 1, created_at: -1 });
NotificationSchema.index({ user_id: 1, type: 1, created_at: -1 });
NotificationSchema.index({ created_at: 1 }, { expireAfterSeconds: 2592000 }); // Auto-delete after 30 days

/**
 * Static method: Create a notification
 * @param {Object} params - Notification parameters
 */
NotificationSchema.statics.createNotification = async function(params) {
  try {
    const mongoose = require('mongoose');
    
    // Ensure user_id is an ObjectId (if provided)
    let userId = params.user_id;
    if (userId && typeof userId === 'string') {
      userId = new mongoose.Types.ObjectId(userId);
    }
    
    console.log('[Notification] 📝 Creating notification with user_id:', userId || '(broadcast)');
    
    const notification = new this({
      user_id: userId || null, // Allow null for broadcast notifications
      type: params.type || 'alarm',
      alarm_id: params.alarm_id,
      alarm_name: params.alarm_name,
      device_id: params.device_id,
      device_name: params.device_name,
      title: params.title,
      message: params.message,
      trigger_reason: params.trigger_reason,
      severity: params.severity || 'warning',
      triggered_values: params.triggered_values || {},
      metadata: params.metadata || {}
    });
    
    await notification.save();
    console.log(`[Notification] ✅ Created notification for user ${userId}: ${params.title}`);
    return notification;
  } catch (error) {
    console.error('[Notification] Error creating notification:', error);
    throw error;
  }
};

/**
 * Static method: Get unread notifications for a user
 * @param {String} userId - User ID
 * @param {Number} limit - Max results
 */
NotificationSchema.statics.getUnread = async function(userId, limit = 50) {
  try {
    const mongoose = require('mongoose');
    const objectId = mongoose.Types.ObjectId.isValid(userId) ? new mongoose.Types.ObjectId(userId) : userId;
    
    console.log(`[Notification] 🔍 Fetching unread for user: ${userId} (converted: ${objectId})`);
    
    return await this.find({ 
      user_id: objectId, 
      is_read: false 
    })
      .sort({ created_at: -1 })
      .limit(limit)
      .lean();
  } catch (error) {
    console.error('[Notification] Error fetching unread notifications:', error);
    return [];
  }
};

/**
 * Static method: Get all notifications for a user
 * @param {String} userId - User ID
 * @param {Number} limit - Max results
 */
NotificationSchema.statics.getUserNotifications = async function(userId, limit = 100) {
  try {
    const mongoose = require('mongoose');
    const objectId = mongoose.Types.ObjectId.isValid(userId) ? new mongoose.Types.ObjectId(userId) : userId;
    
    console.log(`[Notification] 🔍 Fetching all for user: ${userId} (converted: ${objectId})`);
    
    const results = await this.find({ user_id: objectId })
      .sort({ created_at: -1 })
      .limit(limit)
      .lean();
    
    console.log(`[Notification] ✅ Found ${results.length} notifications for user ${userId}`);
    return results;
  } catch (error) {
    console.error('[Notification] Error fetching user notifications:', error);
    return [];
  }
};

/**
 * Static method: Mark notification as read
 * @param {String} notificationId - Notification ID
 */
NotificationSchema.statics.markAsRead = async function(notificationId) {
  try {
    const mongoose = require('mongoose');
    
    console.log(`[Notification] 🔍 markAsRead: Looking for ID: ${notificationId}`);
    
    // Ensure notificationId is a valid ObjectId
    if (!mongoose.Types.ObjectId.isValid(notificationId)) {
      console.error(`[Notification] ❌ Invalid ObjectId format: ${notificationId}`);
      throw new Error(`Invalid notification ID format: ${notificationId}`);
    }
    
    const objectId = new mongoose.Types.ObjectId(notificationId);
    console.log(`[Notification] 🔧 Converted to ObjectId: ${objectId}`);
    
    const result = await this.findByIdAndUpdate(
      objectId,
      { 
        is_read: true,
        read_at: new Date()
      },
      { new: true }
    );
    
    if (!result) {
      console.warn(`[Notification] ⚠️ No notification found with ID: ${objectId}`);
      // Try to list a few notifications to debug
      const count = await this.countDocuments({});
      console.log(`[Notification] 📊 Total notifications in DB: ${count}`);
      if (count <= 10) {
        const all = await this.find({}).select('_id user_id title is_read').limit(10);
        console.log(`[Notification] 📋 Sample notifications:`, all);
      }
    } else {
      console.log(`[Notification] ✅ Successfully marked as read: ${objectId}`);
    }
    
    return result;
  } catch (error) {
    console.error(`[Notification] ❌ Error marking notification as read:`, error);
    throw error;
  }
};

/**
 * Static method: Mark all notifications as read for a user
 * @param {String} userId - User ID
 */
NotificationSchema.statics.markAllAsRead = async function(userId) {
  try {
    const mongoose = require('mongoose');
    const objectId = mongoose.Types.ObjectId.isValid(userId) ? new mongoose.Types.ObjectId(userId) : userId;
    
    return await this.updateMany(
      { user_id: objectId, is_read: false },
      { 
        is_read: true,
        read_at: new Date()
      }
    );
  } catch (error) {
    console.error('[Notification] Error marking all notifications as read:', error);
    throw error;
  }
};

/**
 * Static method: Delete old notifications
 * @param {Number} daysOld - Delete notifications older than this many days
 */
NotificationSchema.statics.deleteOld = async function(daysOld = 30) {
  try {
    const cutoffDate = new Date(Date.now() - daysOld * 24 * 60 * 60 * 1000);
    return await this.deleteMany({ created_at: { $lt: cutoffDate } });
  } catch (error) {
    console.error('[Notification] Error deleting old notifications:', error);
    throw error;
  }
};

const Notification = mongoose.models.Notification || mongoose.model('Notification', NotificationSchema);

module.exports = Notification;
