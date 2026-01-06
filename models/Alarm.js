const mongoose = require('mongoose');
const { Schema } = mongoose;

/**
 * Alarm Schema
 * Stores alarm configurations tied to specific devices
 */

const DeviceParamsSchema = new Schema({
  ref_1_upper: { type: Number, default: 0 },
  ref_1_lower: { type: Number, default: 0 },
  ref_2_upper: { type: Number, default: 0 },
  ref_2_lower: { type: Number, default: 0 },
  ref_3_upper: { type: Number, default: 0 },
  ref_3_lower: { type: Number, default: 0 },
  dcv_upper: { type: Number, default: 0 },
  dcv_lower: { type: Number, default: 0 },
  dci_upper: { type: Number, default: 0 },
  dci_lower: { type: Number, default: 0 },
  acv_upper: { type: Number, default: 0 },
  acv_lower: { type: Number, default: 0 }
}, { _id: false });

const NotificationConfigSchema = new Schema({
  sms_numbers: [{ type: String }],
  email_ids: [{ type: String }]
}, { _id: false });

const AlarmSchema = new Schema({
  // Alarm Identity
  id: { type: Number, unique: true, sparse: true },
  name: { type: String, required: true, index: true },
  
  // Device Association - KEY FIELD: ties alarm to specific device
  device_name: { type: String, required: true, index: true },
  deviceId: { type: String, index: true },
  
  // Alarm Details
  parameter: { type: String, required: false },
  severity: { 
    type: String, 
    enum: ['critical', 'warning', 'info', 'ok', 'battery'],
    default: 'warning'
  },
  status: { 
    type: String, 
    enum: ['Active', 'Inactive'],
    default: 'Active',
    index: true
  },
  
  // Device Parameters for Alarm Thresholds
  device_params: { type: DeviceParamsSchema, default: {} },
  
  // Notification Configuration
  notification_config: { type: NotificationConfigSchema, default: {} },
  
  // Timestamps
  created_at: { type: Date, default: Date.now, index: true },
  last_modified: { type: Date, default: Date.now },
  
  // Alarm Trigger History
  last_triggered: { type: Date, default: null },
  trigger_count: { type: Number, default: 0 },
  
  // Flag to track if notification was sent
  notification_sent: { type: Boolean, default: false, index: true }
}, { 
  timestamps: true,
  collection: 'alarms'
});

// Index for efficient device-based queries
AlarmSchema.index({ device_name: 1, status: 1 });
AlarmSchema.index({ deviceId: 1, status: 1 });

// Static method to get alarms for a specific device
AlarmSchema.statics.getDeviceAlarms = async function(device_name, status = 'Active') {
  try {
    return await this.find({ device_name, status }).lean();
  } catch (error) {
    console.error(`Error fetching alarms for device ${device_name}:`, error);
    return [];
  }
};

// Instance method to record trigger
AlarmSchema.methods.recordTrigger = async function() {
  try {
    this.last_triggered = new Date();
    this.trigger_count += 1;
    this.notification_sent = true;
    await this.save();
  } catch (error) {
    console.error('Error recording alarm trigger:', error);
  }
};

const Alarm = mongoose.models.Alarm || mongoose.model('Alarm', AlarmSchema);

module.exports = Alarm;
