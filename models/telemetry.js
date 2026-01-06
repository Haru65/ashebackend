const mongoose = require("mongoose")


const telemetrySchema = new mongoose.Schema({
  // 🔹 Fixed fields (always present)
  deviceId: {
    type: String,
    required: true,
    index: true
  },
  timestamp: {
    type: Date,
    default: Date.now,
    index: true
  },
  event: {
    type: String,
    default: "NORMAL"
  },
  status: {
    type: String,
    enum: ['online', 'offline', 'warning'],
    default: 'online',
    index: true
  },
  location: {
    type: String,
    default: null  // Format: "latitude, longitude"
  },

  // 🔹 Flexible fields (payload can vary per device/model)
  // Store all telemetry data fields in a Map for flexibility
  data: {
    type: Map,
    of: mongoose.Schema.Types.Mixed, // can hold Number, String, Boolean, etc.
    default: {},  // Ensure default is empty object, not undefined
    set: (value) => {
      // Ensure data is always a proper object/Map
      if (!value) return new Map();
      if (value instanceof Map) return value;
      if (typeof value === 'object') return new Map(Object.entries(value));
      return new Map();
    }
  }
}, {
  // Store as plain object in MongoDB, not as Map
  toJSON: {
    getters: true,
    virtuals: true
  },
  toObject: {
    getters: true,
    virtuals: true
  }
});

// Ensure data is serialized properly
telemetrySchema.pre('toJSON', function(next) {
  if (this.data && this.data instanceof Map) {
    this.data = Object.fromEntries(this.data);
  }
  next();
});

// Export model, checking if it already exists to avoid overwrite errors
module.exports = mongoose.models.telemetry_data || mongoose.model("telemetry_data", telemetrySchema);