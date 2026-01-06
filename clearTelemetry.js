const mongoose = require('mongoose');
require('dotenv').config();

const clearTelemetryData = async () => {
  try {
    await mongoose.connect(process.env.MONGODB_URL);
    
    const Telemetry = require('./models/telemetry');
    
    // Delete all telemetry records
    const result = await Telemetry.deleteMany({});
    
    console.log('✅ Successfully cleared telemetry data');
    console.log(`   Deleted ${result.deletedCount} records`);
    
    process.exit(0);
  } catch (error) {
    console.error('❌ Error clearing telemetry:', error.message);
    process.exit(1);
  }
};

clearTelemetryData();
