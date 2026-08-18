const mongoose = require('mongoose');
const DB_URI = 'mongodb://localhost:27017/AsheTech';

async function checkEvents() {
  try {
    await mongoose.connect(DB_URI);
    console.log('✓ Connected to MongoDB\n');

    const Telemetry = require('./models/telemetry');

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

    console.log('📊 Event distribution in database:');
    console.log('='.repeat(60));
    eventDistribution.forEach(item => {
      console.log(`  "${item._id}": ${item.count} records`);
    });

    // Get sample records for each event type
    console.log('\n📋 Sample records:');
    console.log('='.repeat(60));

    for (const eventDist of eventDistribution) {
      const event = eventDist._id;
      const sample = await Telemetry.findOne({ event }).lean();
      
      if (sample) {
        console.log(`\n▶ Event: "${event}"`);
        console.log(`  Type of event field: ${typeof sample.event}`);
        console.log(`  Event value: "${sample.event}"`);
        console.log(`  Event value (JSON): ${JSON.stringify(sample.event)}`);
        console.log(`  Length: ${String(sample.event).length}`);
        console.log(`  Has data fields: ${sample.data ? 'Yes' : 'No'}`);
        if (sample.data && typeof sample.data === 'object') {
          console.log(`  Data field keys: ${Object.keys(sample.data).slice(0, 5).join(', ')}`);
        }
      }
    }

    console.log('\n✅ Check complete');
    process.exit(0);
  } catch (error) {
    console.error('❌ Error:', error.message);
    process.exit(1);
  }
}

checkEvents();
