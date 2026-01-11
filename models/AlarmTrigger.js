const mongoose = require('mongoose');
const { Schema } = mongoose;

/**
 * AlarmTrigger Schema
 * Stores detailed information about each time an alarm is triggered
 * Provides historical record of all alarm activations with full context
 */

const AlarmTriggerSchema = new Schema({
  // Alarm Reference
  alarm_id: { 
    type: Schema.Types.ObjectId, 
    required: true, 
    ref: 'Alarm',
    index: true
  },
  alarm_name: { 
    type: String, 
    required: true,
    index: true
  },
  
  // Device Reference
  device_id: { 
    type: String, 
    required: true, 
    index: true
  },
  device_name: { 
    type: String, 
    required: true,
    index: true
  },
  
  // Trigger Details
  trigger_reason: { 
    type: String, 
    required: true
    // Examples: "REF1 STS is 'OP' (valid status detected)", "DCV (10) out of bounds [0, 9]"
  },
  
  // Triggered Values - captured at the moment of alarm
  triggered_values: {
    type: Schema.Types.Mixed,
    default: {}
    // Examples: { 
    //   REF1_STS: 'OP', REF2_STS: '', REF3_STS: '',
    //   DCV: 10, DCI: 5, ACV: 1441.9,
    //   REF1: 5.00, REF2: 5.00, REF3: 5.00
    // }
  },
  
  // Alarm Configuration at time of trigger
  alarm_config: {
    severity: String,
    parameter: String,
    device_params: Schema.Types.Mixed
  },
  
  // Event Status
  event_status: {
    type: String,
    default: 'NORMAL'
  },
  
  // Timestamp
  triggered_at: { 
    type: Date, 
    required: true, 
    default: Date.now
  },
  
  // Notification Status
  notification_status: {
    type: String,
    enum: ['SENT', 'FAILED', 'PENDING', 'SKIPPED'],
    default: 'PENDING'
  },
  
  // Recipients that were notified
  notified_recipients: [{
    type: String,
    // Email addresses or phone numbers
  }],
  
  // Additional metadata
  metadata: {
    type: Schema.Types.Mixed,
    default: {}
  }
}, {
  timestamps: true,
  collection: 'alarmtriggers'
});

// Indexes for efficient queries
AlarmTriggerSchema.index({ alarm_id: 1, triggered_at: -1 });
AlarmTriggerSchema.index({ device_id: 1, triggered_at: -1 });
AlarmTriggerSchema.index({ alarm_name: 1, triggered_at: -1 });
AlarmTriggerSchema.index({ triggered_at: 1 }, { expireAfterSeconds: 7776000 }); // Auto-delete after 90 days

/**
 * Static method: Record an alarm trigger
 * @param {Object} params - Trigger parameters
 */
AlarmTriggerSchema.statics.recordTrigger = async function(params) {
  try {
    const trigger = new this({
      alarm_id: params.alarm_id,
      alarm_name: params.alarm_name,
      device_id: params.device_id,
      device_name: params.device_name,
      trigger_reason: params.trigger_reason,
      triggered_values: params.triggered_values || {},
      alarm_config: params.alarm_config || {},
      event_status: params.event_status || 'NORMAL',
      notification_status: params.notification_status || 'PENDING',
      notified_recipients: params.notified_recipients || [],
      metadata: params.metadata || {}
    });
    
    await trigger.save();
    console.log(`[AlarmTrigger] ✅ Recorded alarm trigger: ${params.alarm_name} for device ${params.device_name}`);
    return trigger;
  } catch (error) {
    console.error('[AlarmTrigger] Error recording trigger:', error);
    throw error;
  }
};

/**
 * Static method: Get alarm trigger history for a specific alarm
 * @param {String} alarmId - Alarm ID
 * @param {Number} limit - Max results
 */
AlarmTriggerSchema.statics.getAlarmHistory = async function(alarmId, limit = 50) {
  try {
    return await this.find({ alarm_id: alarmId })
      .sort({ triggered_at: -1 })
      .limit(limit)
      .lean();
  } catch (error) {
    console.error('[AlarmTrigger] Error fetching alarm history:', error);
    return [];
  }
};

/**
 * Static method: Get alarm triggers for a device
 * @param {String} deviceId - Device ID
 * @param {Number} limit - Max results
 */
AlarmTriggerSchema.statics.getDeviceAlarmHistory = async function(deviceId, limit = 50) {
  try {
    return await this.find({ device_id: deviceId })
      .sort({ triggered_at: -1 })
      .limit(limit)
      .lean();
  } catch (error) {
    console.error('[AlarmTrigger] Error fetching device alarm history:', error);
    return [];
  }
};

/**
 * Static method: Get recent alarm triggers
 * @param {Date} since - Fetch triggers since this date
 */
AlarmTriggerSchema.statics.getRecentTriggers = async function(since = null) {
  try {
    const filter = {};
    if (since) {
      filter.triggered_at = { $gte: since };
    }
    return await this.find(filter)
      .sort({ triggered_at: -1 })
      .limit(100)
      .lean();
  } catch (error) {
    console.error('[AlarmTrigger] Error fetching recent triggers:', error);
    return [];
  }
};

const AlarmTrigger = mongoose.models.AlarmTrigger || mongoose.model('AlarmTrigger', AlarmTriggerSchema);

module.exports = AlarmTrigger;
