const mongoose = require('mongoose');
const Telemetry = require('./models/telemetry');

async function checkEvents() {
  try {
    await mongoose.connect('mongodb://localhost:27017/ashecontrol');
    
    const totalCount = await Telemetry.countDocuments();
    console.log(`\n📊 Total telemetry records: ${totalCount}\n`);
    
    // Get distinct event values
    const events = await Telemetry.collection.distinct('event');
    console.log('Distinct event values in database:', events);
    
    // Count by event type
    for (const event of events) {
      const count = await Telemetry.countDocuments({ event });
      console.log(`  event: "${event}" (type: ${typeof event}) = ${count} records`);
    }
    
    // Show sample records for each event type
    console.log('\n🔍 Sample records:\n');
    for (const event of events) {
      const sample = await Telemetry.findOne({ event }).lean();
      if (sample) {
        console.log(`Event "${event}":`);
        console.log(`  _id: ${sample._id}`);
        console.log(`  event: ${sample.event} (type: ${typeof sample.event})`);
        console.log(`  timestamp: ${sample.timestamp}`);
        console.log();
      }
    }
    
    process.exit(0);
  } catch (error) {
    console.error('Error:', error.message);
    process.exit(1);
  }
}

checkEvents();
