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

    console.log('\n📋 RECORDS WITH DATA (has measurements):');
    console.log('=====================================');
    const withData = await Telemetry
      .find({ data: { $exists: true, $ne: {} } })
      .sort({ timestamp: -1 })
      .limit(5)
      .lean();

    withData.forEach((record, index) => {
      const dataKeys = record.data ? Object.keys(record.data) : [];
      console.log(`\n${index + 1}. Event: "${record.event}" | Time: ${record.timestamp}`);
      console.log(`   Data fields: ${dataKeys.length}`);
      if (dataKeys.length > 0) {
        console.log(`   Fields: ${dataKeys.join(', ')}`);
      }
    });

    console.log('\n📋 RECORDS WITHOUT DATA (empty data field):');
    console.log('=====================================');
    const noData = await Telemetry
      .find({ $or: [{ data: {} }, { data: null }, { data: undefined }] })
      .sort({ timestamp: -1 })
      .limit(5)
      .lean();

    noData.forEach((record, index) => {
      console.log(`\n${index + 1}. Event: "${record.event}" | Time: ${record.timestamp}`);
      console.log(`   Data: ${JSON.stringify(record.data)}`);
    });

    // Check if there's a pattern - do NORMAL events have data and others don't?
    console.log('\n🔍 DATA AVAILABILITY BY EVENT TYPE:');
    console.log('=====================================');
    
    const stats = await Telemetry.aggregate([
      {
        $facet: {
          withData: [
            { $match: { data: { $exists: true, $ne: {} } } },
            { $group: { _id: '$event', count: { $sum: 1 } } },
            { $sort: { count: -1 } }
          ],
          withoutData: [
            { $match: { $or: [{ data: {} }, { data: null }, { data: undefined }] } },
            { $group: { _id: '$event', count: { $sum: 1 } } },
            { $sort: { count: -1 } }
          ]
        }
      }
    ]);

    console.log('\nEvents WITH data:');
    stats[0].withData.forEach(item => {
      console.log(`  ${item._id}: ${item.count}`);
    });

    console.log('\nEvents WITHOUT data:');
    stats[0].withoutData.forEach(item => {
      console.log(`  ${item._id}: ${item.count}`);
    });

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
