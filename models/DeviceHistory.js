const mongoose = require('mongoose');
const { Schema } = mongoose;

/**
 * DeviceHistory Schema
 * Stores time-series telemetry data for IoT devices
 * - deviceId: reference to the device
 * - timestamp: when the data was recorded
 * - data: flexible object for sensor readings (battery, signal, temperature, etc.)
 * - topic: MQTT topic that sent this data
 * - TTL: auto-delete after 30 days
 */

const DeviceHistorySchema = new Schema({
  deviceId: { 
    type: String, 
    required: true, 
    index: true,
    ref: 'Device'
  },
  timestamp: { 
    type: Date, 
    required: true, 
    default: Date.now,
    index: true
  },
  data: {
    type: Schema.Types.Mixed,
    default: {},
    // Common sensor fields (flexible structure allows any additional fields)
    // Example: { battery: 85, signal: 90, temperature: 22.5, humidity: 45, pressure: 1013 }
  },
  topic: {
    type: String,
    required: false,
    index: true
    // Example: 'devices/123/data' or 'sensor/DEVICE_123/telemetry'
  }
}, {
  timestamps: false, // We use our own timestamp field
  collection: 'devicehistory'
});

// Compound index for efficient device + time range queries
DeviceHistorySchema.index({ deviceId: 1, timestamp: -1 });

// Compound index for topic-based queries
DeviceHistorySchema.index({ topic: 1, timestamp: -1 });

// TTL index: automatically delete documents older than 30 days (2592000 seconds)
DeviceHistorySchema.index({ timestamp: 1 }, { expireAfterSeconds: 2592000 });

/**
 * Static method: Record telemetry data
 * @param {String} deviceId - device identifier
 * @param {Object} data - sensor readings object
 * @param {String} [topic] - optional MQTT topic
 * @param {Date} [timestamp] - optional timestamp (defaults to now)
 */
DeviceHistorySchema.statics.recordTelemetry = async function(deviceId, data, topic = null, timestamp = null) {
  return await this.create({
    deviceId,
    timestamp: timestamp || new Date(),
    data,
    topic
  });
};

/**
 * Static method: Query telemetry for a device within a time range
 * @param {String} deviceId - device identifier
 * @param {Date} startTime - start of range
 * @param {Date} endTime - end of range
 * @param {Number} [limit] - max results (default 1000)
 */
DeviceHistorySchema.statics.queryByTimeRange = async function(deviceId, startTime, endTime, limit = 1000) {
  return await this.find({
    deviceId,
    timestamp: { $gte: startTime, $lte: endTime }
  })
  .sort({ timestamp: -1 })
  .limit(limit)
  .lean();
};

/**
 * Static method: Get latest telemetry for a device
 * @param {String} deviceId - device identifier
 * @param {Number} [limit] - number of records (default 1)
 */
DeviceHistorySchema.statics.getLatest = async function(deviceId, limit = 1) {
  return await this.find({ deviceId })
    .sort({ timestamp: -1 })
    .limit(limit)
    .lean();
};

module.exports = mongoose.models.DeviceHistory || mongoose.model('DeviceHistory', DeviceHistorySchema);
