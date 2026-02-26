const mongoose = require('mongoose');
const Telemetry = require('./models/telemetry');
require('dotenv').config();

(async () => {
  try {
    await mongoose.connect(process.env.MONGODB_URI || 'mongodb://localhost:27017/zeptac_iot');
    
    const count = await Telemetry.countDocuments();
    console.log('📊 Total telemetry records:', count);
    
    const sample = await Telemetry.findOne().lean();
    if (sample) {
      console.log('📝 Sample record keys:', Object.keys(sample).sort());
      console.log('📝 Sample timestamp:', sample.timestamp);
      console.log('📝 Sample deviceId:', sample.deviceId);
      console.log('📝 Sample event:', sample.event);
    }
    
    // Check for device 123 specifically
    const device123Count = await Telemetry.countDocuments({ deviceId: '123' });
    console.log('📱 Records for device 123:', device123Count);
    
    // Check date range 2026-02-19 to 2026-02-26
    const startDate = new Date('2026-02-19');
    const endDate = new Date('2026-02-26');
    endDate.setHours(23, 59, 59, 999);
    
    const dateRangeCount = await Telemetry.countDocuments({
      timestamp: { $gte: startDate, $lte: endDate }
    });
    console.log(`📅 Records in date range (${startDate.toISOString()} to ${endDate.toISOString()}):`, dateRangeCount);
    
    // Check device 123 + date range
    const specificCount = await Telemetry.countDocuments({
      deviceId: '123',
      timestamp: { $gte: startDate, $lte: endDate }
    });
    console.log('🎯 Records for device 123 in date range:', specificCount);
    
    // Show sample of device 123 data
    if (specificCount > 0) {
      const sample123 = await Telemetry.findOne({ deviceId: '123' }).lean();
      if (sample123) {
        console.log('📝 Sample device 123 record:', JSON.stringify(sample123, null, 2).substring(0, 500));
      }
    } else {
      console.log('⚠️ No data for device 123 in that date range. Checking all device 123 data:');
      const allDevice123 = await Telemetry.find({ deviceId: '123' }).limit(1).lean();
      if (allDevice123.length > 0) {
        console.log('📝 Available device 123 record timestamp:', allDevice123[0].timestamp);
        console.log('📝 Available device 123 record deviceId:', allDevice123[0].deviceId);
      }
    }
    
    mongoose.connection.close();
    process.exit(0);
  } catch (err) {
    console.error('❌ Error:', err.message);
    process.exit(1);
  }
})();
