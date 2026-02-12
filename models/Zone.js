const mongoose = require('mongoose');
const { Schema } = mongoose;

/**
 * Zone Schema
 * - id: unique zone identifier (string)
 * - name: zone name (string)
 * - description: zone description (string)
 * - color: hex color for zone visualization (string)
 * - deviceCount: number of devices in the zone (number)
 * - createdAt: creation timestamp
 * - updatedAt: last update timestamp
 */

const ZoneSchema = new Schema({
  id: { 
    type: String, 
    required: true, 
    unique: true, 
    index: true,
    default: () => `zone-${Date.now()}`
  },
  name: { 
    type: String, 
    required: true, 
    trim: true,
    index: true
  },
  description: { 
    type: String, 
    default: '',
    trim: true
  },
  color: { 
    type: String, 
    default: '#007bff',
    validate: {
      validator: (v) => /^#[0-9A-Fa-f]{6}$/.test(v),
      message: 'Color must be a valid hex code'
    }
  },
  deviceCount: { 
    type: Number, 
    default: 0,
    min: 0
  },
  createdAt: { 
    type: Date, 
    default: Date.now,
    index: true
  },
  updatedAt: { 
    type: Date, 
    default: Date.now
  }
}, { 
  timestamps: true,
  collection: 'zones'
});

// Pre-save hook to update timestamp
ZoneSchema.pre('save', function(next) {
  this.updatedAt = Date.now();
  next();
});

// Index for common queries
ZoneSchema.index({ createdAt: -1 });
ZoneSchema.index({ name: 'text', description: 'text' });

module.exports = mongoose.model('Zone', ZoneSchema);
