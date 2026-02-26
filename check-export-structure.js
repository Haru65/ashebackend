const mongoose = require('mongoose');
const Telemetry = require('./models/telemetry');
require('dotenv').config();

(async () => {
  try {
    await mongoose.connect(process.env.MONGODB_URI);
    const records = await Telemetry.find({ deviceId: '123' }).limit(3).lean();
    console.log('📊 Sample records with full data:');
    records.forEach((r, i) => {
      console.log(`\n=== Record ${i+1} ===`);
      console.log(`Timestamp: ${r.timestamp}`);
      console.log(`Device: ${r.deviceId}`);
      console.log(`Event: ${r.event}`);
      console.log(`Data field type: ${typeof r.data}`);
      console.log(`Data field content:`, r.data);
      console.log(`Record keys:`, Object.keys(r));
    });
    mongoose.connection.close();
  } catch (err) {
    console.error('Error:', err.message);
    process.exit(1);
  }
})();
