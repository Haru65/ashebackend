const mongoose = require('mongoose');
const { Schema } = mongoose;

/**
 * Device Schema
 * - deviceId: unique device identifier (string)
 * - deviceName: human-friendly name
 * - location: string (could be address or coords)
 * - mqtt: nested object containing broker and topics
 * - sensors: current sensor snapshot
 * - status: online/offline/warning and lastSeen
 * - metadata: icon, color, description
 * - historicalCollection: optional string to indicate where historical data is stored
 */

const SensorSchema = new Schema({
  battery: { type: Number, min: 0, max: 100, default: null },
  signal: { type: Number, min: 0, default: null }, // No max limit - can be raw MQTT signal values
  temperature: { type: Number, default: null },
  humidity: { type: Number, default: null },
  pressure: { type: Number, default: null }
}, { _id: false });

const MqttConfigSchema = new Schema({
  brokerUrl: { type: String, required: false },
  topicPrefix: { type: String, required: false },
  topics: {
    data: { type: String, required: false },
    status: { type: String, required: false },
    control: { type: String, required: false }
  },
  credentials: {
    username: { type: String, required: false },
    password: { type: String, required: false }
  }
}, { _id: false });

const DeviceSchema = new Schema({
  deviceId: { type: String, required: true, unique: true, index: true },
  deviceName: { type: String, required: false, index: true },
  location: { type: String, required: false },
  mqtt: { type: MqttConfigSchema, default: {} },
  sensors: { type: SensorSchema, default: {} },
  status: {
    state: { type: String, enum: ['online', 'offline', 'warning'], default: 'offline', index: true },
    lastSeen: { type: Date, default: null, index: true }
  },
  currentEvent: {
    type: String,
    default: 'NORMAL',
    enum: ['NORMAL', 'DPOL', 'INT', 'INST']
  },
  metadata: {
    icon: { type: String, default: null },
    color: { type: String, default: null },
    description: { type: String, default: null }
  },
  // Device configuration/settings (expanded with missing parameters)
  configuration: {
    deviceSettings: {
      electrode: { type: Number, default: 0 },
      event: { type: Number, default: 0 },
      manualModeAction: { type: Number, default: 0 },
      // Fixed units: mV instead of V, A instead of mA
      shuntVoltage: { type: Number, default: 0 }, // in mV
      shuntCurrent: { type: Number, default: 0 }, // in A (not mA)
      // REF values that should reflect to webpage and save to server
      referenceFail: { type: Number, default: 0 },
      referenceUP: { type: Number, default: 0 },
      referenceOP: { type: Number, default: 0 },
      // Digital inputs that were missing from frame
      di1: { type: Number, default: 0 },
      di2: { type: Number, default: 0 },
      di3: { type: Number, default: 0 },
      di4: { type: Number, default: 0 },
      // Time-related settings - STANDARDIZED NAMING: all use camelCase with "TimeStamp"
      interruptOnTime: { type: Number, default: 0 },
      interruptOffTime: { type: Number, default: 0 },
      interruptStartTimeStamp: { type: String, default: '' },  // StandardCamelCase
      interruptStopTimeStamp: { type: String, default: '' },   // StandardCamelCase
      dpolInterval: { type: String, default: '00:00:00' },
      depolarizationStartTimeStamp: { type: String, default: '' },  // StandardCamelCase
      depolarizationStopTimeStamp: { type: String, default: '' },   // StandardCamelCase
      instantMode: { type: Number, default: 0 },
      instantStartTimeStamp: { type: String, default: '' },  // StandardCamelCase
      instantEndTimeStamp: { type: String, default: '' },    // StandardCamelCase
      // Logging settings - SINGLE FIELD ONLY (time string in hh:mm:ss format)
      loggingInterval: { type: String, default: '00:00:10' }  // hh:mm:ss format

    },
    lastUpdated: { type: Date, default: null },
    updatedBy: { type: String, default: 'system' } // 'system' or 'user'
  },
  // optional name of the collection where historical telemetry for this device is stored
  historicalCollection: { type: String, required: false, default: null }
}, {
  timestamps: true,
  toJSON: { virtuals: true },
  toObject: { virtuals: true }
});

// Compound indexes for common queries
DeviceSchema.index({ deviceId: 1 });
DeviceSchema.index({ 'mqtt.topicPrefix': 1 });
DeviceSchema.index({ 'status.state': 1, 'status.lastSeen': -1 });

/**
 * Find device by deviceId
 * @param {String} deviceId - Device identifier
 * @returns {Promise<Document|null>} Device document or null
 */
DeviceSchema.statics.findByDeviceId = async function findByDeviceId(deviceId) {
  return await this.findOne({ deviceId });
};

/**
 * Get or create a Mongoose model for historical data collection for a device.
 * This allows storing time-series telemetry in per-device collections or shared collections.
 *
 * @param {String} collectionName - explicit collection name to use for historical data
 * @param {mongoose.Connection} [connection] - optional mongoose connection to register the model on
 */
DeviceSchema.statics.getHistoricalModel = function getHistoricalModel(collectionName, connection) {
  const conn = connection || mongoose;
  const name = `Telemetry_${collectionName}`;

  // If model already exists, return it
  if (conn.models[name]) return conn.models[name];

  const TelemetrySchema = new Schema({
    deviceId: { type: String, required: true, index: true },
    timestamp: { type: Date, required: true, index: true },
    data: { type: Schema.Types.Mixed }
  }, { timestamps: false });

  // Create indexes optimized for time-range queries per device
  TelemetrySchema.index({ deviceId: 1, timestamp: -1 });

  return conn.model(name, TelemetrySchema, collectionName);
};

/**
 * Virtual: numericId - extracts digits from deviceId when present
 */
DeviceSchema.virtual('numericId').get(function () {
  if (!this.deviceId) return null;
  const m = String(this.deviceId).match(/(\d+)/);
  return m ? m[1] : null;
});

module.exports = mongoose.model('Device', DeviceSchema);
