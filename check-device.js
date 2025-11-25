require('dotenv').config();
const mongoose = require('mongoose');
const Device = require('./models/Device');

async function checkDevices() {
  try {
    await mongoose.connect(process.env.MONGODB_URI);
    console.log('✅ Connected to MongoDB');
    
    const devices = await Device.find({});
    console.log('\n📱 All Devices:');
    console.log('═══════════════════════════════════════════════');
    
    devices.forEach((device, index) => {
      console.log(`\nDevice ${index + 1}:`);
      console.log(`  MongoDB _id: ${device._id}`);
      console.log(`  deviceId (for MQTT): ${device.deviceId}`);
      console.log(`  name: ${device.name}`);
      console.log(`  status: ${device.status?.state || 'unknown'}`);
      console.log(`  lastSeen: ${device.status?.lastSeen || 'never'}`);
      console.log('  ---');
      console.log(`  📡 Should subscribe to: devices/${device.deviceId}/data`);
      console.log(`  📤 Should publish commands to: devices/${device.deviceId}/commands`);
    });
    
    console.log('\n═══════════════════════════════════════════════');
    console.log(`\nTotal devices: ${devices.length}`);
    
    process.exit(0);
  } catch (error) {
    console.error('❌ Error:', error);
    process.exit(1);
  }
}

checkDevices();
