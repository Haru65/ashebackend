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
  // Store all telemetry data fields - stored as plain object in MongoDB, not as Map
  data: {
    type: Map,
    of: mongoose.Schema.Types.Mixed, // can hold Number, String, Boolean, etc.
    default: new Map(),
    set: (value) => {
      // Ensure data is always stored as a proper Map
      if (!value) return new Map();
      if (value instanceof Map) return value;
      if (typeof value === 'object' && value !== null) {
        // Convert plain object to Map
        const map = new Map(Object.entries(value));
        console.log(`[Telemetry Model] Set hook converting object to Map with ${map.size} entries`);
        return map;
      }
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

// Ensure data is serialized properly when converting to JSON
telemetrySchema.pre('toJSON', function(next) {
  if (this.data && this.data instanceof Map) {
    this.data = Object.fromEntries(this.data);
  }
  next();
});

// Ensure data is converted to Map when retrieving from database
telemetrySchema.post(/^find/, function(docs) {
  if (!docs) return;
  
  // Handle both single document and array of documents
  const docArray = Array.isArray(docs) ? docs : [docs];
  
  docArray.forEach(doc => {
    if (doc && doc.data) {
      // If data is a plain object, convert it to a Map for consistency
      if (!(doc.data instanceof Map) && typeof doc.data === 'object') {
        console.log(`[Telemetry Post-Find] Converting plain object to Map for ${doc._id}`);
        doc.data = new Map(Object.entries(doc.data));
      }
    }
  });
});

// Export model, checking if it already exists to avoid overwrite errors
module.exports = mongoose.models.telemetry_data || mongoose.model("telemetry_data", telemetrySchema);