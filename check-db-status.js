const mongoose = require('mongoose');
const DB_URI = 'mongodb://localhost:27017/AsheTech';

async function checkDB() {
  try {
    await mongoose.connect(DB_URI);
    console.log('✓ Connected to MongoDB\n');

    const Telemetry = require('./models/telemetry');

    // Check total count
    const count = await Telemetry.countDocuments();
    console.log(`Total telemetry records: ${count}`);

    // Get event distribution
    const eventDistribution = await Telemetry.aggregate([
      {
        $group: {
          _id: '$event',
          count: { $sum: 1 }
        }
      },
      { $sort: { count: -1 } }
    ]);

    console.log('\nEvent distribution:');
    eventDistribution.forEach(item => {
      console.log(`  "${item._id}": ${item.count}`);
    });

    // Get a few random records
    console.log('\nSample records (any type):');
    const samples = await Telemetry.find().limit(5).exec();
    samples.forEach((record, idx) => {
      console.log(`  ${idx + 1}. event="${record.event}", dataSize=${record.data instanceof Map ? record.data.size : 0}`);
    });

    process.exit(0);
  } catch (error) {
    console.error('❌ Error:', error.message);
    process.exit(1);
  }
}

checkDB();
