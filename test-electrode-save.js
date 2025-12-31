const mongoose = require('mongoose');
const Device = require('./models/Device');

async function testElectrodeSave() {
  try {
    await mongoose.connect(process.env.MONGODB_URI || 'mongodb://localhost:27017/zeptac_iot', {
      useNewUrlParser: true,
      useUnifiedTopology: true
    });

    console.log('Connected to MongoDB');

    // Test data
    const deviceId = '123';
    const settings = {
      'Electrode': 2,  // Ag/AgCl
      'Reference Fail': 0.30
    };

    console.log('\n📥 Attempting to save settings:', JSON.stringify(settings, null, 2));

    const Device = require('./models/Device');
    const mqttService = require('./services/mqttService');

    const result = await mqttService.mergeAndSaveDeviceSettings(deviceId, settings, 'test');
    console.log('\n✅ Success:', JSON.stringify(result, null, 2));

  } catch (error) {
    console.error('\n❌ Error:', error.message);
    console.error('Stack:', error.stack);
    if (error.errors) {
      console.error('Validation errors:', JSON.stringify(error.errors, null, 2));
    }
  } finally {
    await mongoose.connection.close();
    process.exit(0);
  }
}

testElectrodeSave();
