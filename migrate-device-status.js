/**
 * Migration script to fix device status field
 * Converts old string status values to new object format
 * Usage: node migrate-device-status.js
 */

const mongoose = require('mongoose');
const Device = require('./models/Device');

async function migrateDeviceStatus() {
  try {
    // Connect to MongoDB
    const mongoUri = process.env.MONGODB_URI || 'mongodb://localhost:27017/iot-platform';
    await mongoose.connect(mongoUri);
    
    console.log('Connected to MongoDB');
    console.log('Starting device status migration...\n');

    // Find all devices with string status (old format)
    const devices = await Device.find({});
    
    let migratedCount = 0;
    let skippedCount = 0;

    for (const device of devices) {
      if (typeof device.status === 'string') {
        // Old format - convert to offline
        console.log(`Migrating device ${device.deviceId}: "${device.status}" → "offline"`);
        device.status = {
          state: 'offline',
          lastSeen: null
        };
        await device.save();
        migratedCount++;
      } else if (typeof device.status === 'object' && device.status?.state) {
        // Already in new format
        skippedCount++;
      } else {
        // Unknown format - set to offline
        console.log(`Fixing device ${device.deviceId}: unknown status format → "offline"`);
        device.status = {
          state: 'offline',
          lastSeen: null
        };
        await device.save();
        migratedCount++;
      }
    }

    console.log(`\n✓ Migration complete!`);
    console.log(`  - Migrated: ${migratedCount} devices`);
    console.log(`  - Skipped: ${skippedCount} devices (already correct)`);
    console.log(`  - Total: ${devices.length} devices processed`);

    await mongoose.connection.close();
  } catch (error) {
    console.error('Migration failed:', error);
    process.exit(1);
  }
}

migrateDeviceStatus();
