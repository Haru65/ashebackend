#!/usr/bin/env node

require('dotenv').config();
const mongoose = require('mongoose');

const connectDB = async () => {
  try {
    await mongoose.connect(process.env.MONGODB_URI || 'mongodb://localhost:27017/ashecontrol', {
      useNewUrlParser: true,
      useUnifiedTopology: true,
    });
    console.log('✅ MongoDB connected');
  } catch (error) {
    console.error('❌ MongoDB connection failed:', error);
    process.exit(1);
  }
};

const checkTelemetryData = async () => {
  try {
    const Telemetry = require('./models/telemetry');

    console.log('\n📋 CHECKING RECENT INT OFF RECORD (without .lean()):');
    console.log('=====================================');
    
    const record = await Telemetry
      .findOne({ event: 'INT OFF' })
      .sort({ timestamp: -1 });

    if (record) {
      console.log(`\nEvent: "${record.event}" | Time: ${record.timestamp}`);
      
      console.log(`\nData field type: ${typeof record.data}`);
      console.log(`Is Map: ${record.data instanceof Map}`);
      
      if (record.data instanceof Map) {
        console.log(`Map size: ${record.data.size}`);
        console.log(`Map keys:`, Array.from(record.data.keys()).slice(0, 10));
        console.log(`Sample values:`, Array.from(record.data.entries()).slice(0, 3).map(([k, v]) => `${k}: ${v}`));
      } else {
        console.log(`Data keys: ${Object.keys(record.data).length}`);
        if (Object.keys(record.data).length > 0) {
          console.log(`Sample: ${JSON.stringify(Object.fromEntries(Object.entries(record.data).slice(0, 3)))}`);
        }
      }
    }

    console.log('\n📋 CHECKING RECENT NORMAL RECORD (without .lean()):');
    console.log('=====================================');
    
    const normalRecord = await Telemetry
      .findOne({ event: 'NORMAL' })
      .sort({ timestamp: -1 });

    if (normalRecord) {
      console.log(`\nEvent: "${normalRecord.event}" | Time: ${normalRecord.timestamp}`);
      console.log(`Data field type: ${typeof normalRecord.data}`);
      console.log(`Is Map: ${normalRecord.data instanceof Map}`);
      
      if (normalRecord.data instanceof Map) {
        console.log(`Map size: ${normalRecord.data.size}`);
        console.log(`Map keys:`, Array.from(normalRecord.data.keys()).slice(0, 10));
      }
    }

    console.log('\n✅ Diagnostic complete');
  } catch (error) {
    console.error('❌ Error:', error);
  } finally {
    await mongoose.connection.close();
    process.exit(0);
  }
};

(async () => {
  await connectDB();
  await checkTelemetryData();
})();
