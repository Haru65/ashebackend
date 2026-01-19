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

    // Get count by event type
    const eventCounts = await Telemetry.aggregate([
      {
        $group: {
          _id: '$event',
          count: { $sum: 1 }
        }
      },
      { $sort: { count: -1 } }
    ]);

    console.log('\n📊 TELEMETRY RECORDS BY EVENT TYPE:');
    console.log('=====================================');
    eventCounts.forEach(item => {
      console.log(`  ${item._id}: ${item.count} records`);
    });

    // Get recent records
    const recentRecords = await Telemetry
      .find({})
      .sort({ timestamp: -1 })
      .limit(10)
      .lean();

    console.log('\n📋 LAST 10 RECORDS:');
    console.log('=====================================');
    recentRecords.forEach((record, index) => {
      const dataKeys = record.data ? Object.keys(record.data) : [];
      console.log(`\n${index + 1}. Event: "${record.event}" | Time: ${record.timestamp}`);
      console.log(`   Data fields: ${dataKeys.length} (${dataKeys.slice(0, 3).join(', ')}${dataKeys.length > 3 ? '...' : ''})`);
      console.log(`   Has measurements: ${record.data && Object.keys(record.data).length > 0 ? '✅' : '❌'}`);
      
      if (record.data && dataKeys.length > 0) {
        const measurements = {};
        ['ACV', 'ACI', 'DCV', 'DCI', 'REF1', 'REF2', 'REF3'].forEach(key => {
          if (record.data[key] !== undefined) {
            measurements[key] = record.data[key];
          }
        });
        if (Object.keys(measurements).length > 0) {
          console.log(`   Measurements: ${JSON.stringify(measurements)}`);
        }
      }
    });

    // Check for empty data fields
    const emptyDataRecords = await Telemetry
      .find({ $or: [{ data: null }, { data: {} }] })
      .countDocuments();

    console.log(`\n⚠️  Records with empty data: ${emptyDataRecords}`);

    // Check data field type
    const firstRecord = await Telemetry.findOne({});
    if (firstRecord) {
      console.log(`\n🔍 Sample record data field type: ${firstRecord.data instanceof Map ? 'Map' : typeof firstRecord.data}`);
      console.log(`   Data size/keys: ${firstRecord.data instanceof Map ? firstRecord.data.size : Object.keys(firstRecord.data).length}`);
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
