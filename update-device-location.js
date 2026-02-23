const mongoose = require('mongoose');
const Device = require('./models/Device');

const MONGO_URI = process.env.MONGO_URI || 'mongodb://localhost:27017/ashecontrol';

async function updateDeviceLocation() {
  try {
    // Connect to MongoDB
    await mongoose.connect(MONGO_URI, {
      useNewUrlParser: true,
      useUnifiedTopology: true
    });
    console.log('✅ Connected to MongoDB');

    // Update Device-123 location to Karjat
    const result = await Device.updateOne(
      { deviceId: 'Device-123' },
      { 
        $set: { 
          location: 'Karjat',
          deviceName: 'Karjat'
        }
      }
    );

    console.log('📝 Update result:', result);

    if (result.modifiedCount > 0) {
      console.log('✅ Device location updated successfully to Karjat');
    } else {
      console.log('⚠️ No device found or no changes made');
    }

    // Verify the update
    const updatedDevice = await Device.findOne({ deviceId: 'Device-123' });
    console.log('📍 Updated device info:');
    console.log('   Device ID:', updatedDevice.deviceId);
    console.log('   Name:', updatedDevice.deviceName);
    console.log('   Location:', updatedDevice.location);

    process.exit(0);
  } catch (error) {
    console.error('❌ Error:', error.message);
    process.exit(1);
  }
}

updateDeviceLocation();
