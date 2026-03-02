const mongoose = require('mongoose');
require('dotenv').config();

const Device = require('./models/Device');
const Telemetry = require('./models/telemetry');

async function debugLocationMismatch() {
  try {
    await mongoose.connect(process.env.MONGODB_URI || 'mongodb://localhost:27017/zeptac_iot');
    console.log('✅ Connected to MongoDB\n');

    // Get all devices
    const devices = await Device.find({}).lean();
    console.log(`📱 Found ${devices.length} devices\n`);

    for (const device of devices) {
      console.log(`\n${'='.repeat(60)}`);
      console.log(`Device: ${device.deviceId} (${device.deviceName})`);
      console.log(`${'='.repeat(60)}`);
      
      // Show Device model location
      console.log(`\n📍 Device Model Location: "${device.location}"`);
      
      // Get latest telemetry for this device
      const latestTelemetry = await Telemetry.findOne({ deviceId: device.deviceId })
        .sort({ timestamp: -1 })
        .lean();
      
      if (latestTelemetry) {
        console.log(`📍 Latest Telemetry Location: "${latestTelemetry.location}"`);
        console.log(`   Timestamp: ${latestTelemetry.timestamp}`);
        
        // Check if there are multiple telemetry records with different locations
        const recentTelemetry = await Telemetry.find({ deviceId: device.deviceId })
          .sort({ timestamp: -1 })
          .limit(5)
          .lean();
        
        console.log(`\n   Last 5 telemetry records:`);
        recentTelemetry.forEach((t, idx) => {
          console.log(`   ${idx + 1}. Location: "${t.location}" | Time: ${t.timestamp}`);
        });
      } else {
        console.log(`📍 Latest Telemetry Location: (no telemetry records)`);
      }
      
      // Check if locations match
      if (latestTelemetry && device.location !== latestTelemetry.location) {
        console.log(`\n⚠️  MISMATCH DETECTED!`);
        console.log(`   Device model has: "${device.location}"`);
        console.log(`   Telemetry has: "${latestTelemetry.location}"`);
      }
    }

    console.log(`\n${'='.repeat(60)}`);
    console.log('✅ Debug complete');
    process.exit(0);
  } catch (error) {
    console.error('❌ Error:', error);
    process.exit(1);
  }
}

debugLocationMismatch();
