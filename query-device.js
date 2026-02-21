const Device = require('./models/Device');
const Zone = require('./models/Zone');
const mongoose = require('mongoose');

const dbUri = require('./database.js');

async function main() {
  try {
    await mongoose.connect(dbUri);
    console.log('Connected to MongoDB');

    // Find the specific device
    const device = await Device.findOne({ deviceId: 'AAAA-BBBB-CCCC' }).lean();
    
    if (!device) {
      console.log('Device not found');
      process.exit(0);
    }

    console.log('\n=== DEVICE INFO ===');
    console.log('Device ID:', device.deviceId);
    console.log('Device Name:', device.deviceName);
    console.log('Zone ID:', device.zoneId);
    console.log('Location:', device.location);
    console.log('Status:', device.status);
    
    // Find the zone if available
    if (device.zoneId) {
      const zone = await Zone.findOne({ id: device.zoneId }).lean();
      console.log('\n=== ZONE INFO ===');
      console.log('Zone ID:', zone?.id);
      console.log('Zone Name:', zone?.name);
      console.log('Zone Color:', zone?.color);
    } else {
      console.log('\n⚠️  Device has NO zone assigned');
    }

    // Check all zones
    console.log('\n=== ALL ZONES ===');
    const allZones = await Zone.find({}).lean();
    allZones.forEach(z => {
      console.log(`- ${z.id}: ${z.name}`);
    });

    process.exit(0);
  } catch (error) {
    console.error('Error:', error.message);
    process.exit(1);
  }
}

main();
