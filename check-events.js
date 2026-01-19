const mongoose = require('mongoose');
const Telemetry = require('./models/telemetry');

mongoose.connect('mongodb://localhost:27017/ashe-control', {
  useNewUrlParser: true,
  useUnifiedTopology: true
}).then(async () => {
  console.log('✅ Connected to MongoDB');
  
  const allEvents = await Telemetry.distinct('event');
  console.log('\n📊 All unique event values in database:');
  console.log(allEvents);
  
  const eventCounts = await Telemetry.aggregate([
    {
      $group: {
        _id: '$event',
        count: { $sum: 1 }
      }
    },
    { $sort: { count: -1 } }
  ]);
  
  console.log('\n📈 Event value distribution:');
  eventCounts.forEach(item => {
    console.log(`  "${item._id}" : ${item.count} records`);
  });
  
  // Get sample records for each event type
  console.log('\n📋 Sample records by event type:');
  for (const event of allEvents) {
    const sample = await Telemetry.findOne({ event: event });
    if (sample) {
      console.log(`\n  Event: "${event}"`);
      console.log(`    _id: ${sample._id}`);
      console.log(`    deviceId: ${sample.deviceId}`);
      console.log(`    timestamp: ${sample.timestamp}`);
      console.log(`    event type: ${typeof sample.event}`);
      console.log(`    event value: ${JSON.stringify(sample.event)}`);
    }
  }
  
  // Check if records have the data field and how many records exist
  const totalRecords = await Telemetry.countDocuments();
  console.log(`\n📊 Total telemetry records: ${totalRecords}`);
  
  const sampleRecord = await Telemetry.findOne();
  if (sampleRecord) {
    console.log('\n📋 Sample telemetry record structure:');
    console.log(`  _id: ${sampleRecord._id}`);
    console.log(`  deviceId: ${sampleRecord.deviceId}`);
    console.log(`  timestamp: ${sampleRecord.timestamp}`);
    console.log(`  event: ${sampleRecord.event}`);
    console.log(`  status: ${sampleRecord.status}`);
    console.log(`  data type: ${typeof sampleRecord.data}`);
    console.log(`  data is Map: ${sampleRecord.data instanceof Map}`);
    if (sampleRecord.data instanceof Map) {
      console.log(`  data keys: ${Array.from(sampleRecord.data.keys()).join(', ')}`);
    } else if (typeof sampleRecord.data === 'object') {
      console.log(`  data keys: ${Object.keys(sampleRecord.data || {}).join(', ')}`);
    }
  }
  
  process.exit(0);
}).catch(err => {
  console.error('❌ MongoDB connection error:', err.message);
  process.exit(1);
});
