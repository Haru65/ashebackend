/**
 * Check exact event values in database
 */
require('dotenv').config({ path: '.env' });
const mongoose = require('mongoose');
const Telemetry = require('./models/telemetry');

async function checkEvents() {
  try {
    const mongoUri = process.env.MONGO_URI || 'mongodb://localhost:27017/ashecontrol';
    await mongoose.connect(mongoUri);
    
    // Get first 20 records
    const records = await Telemetry.find().sort({ timestamp: -1 }).limit(20);
    
    console.log('📊 FIRST 20 RECORDS - Event Field Values:\n');
    console.log('Index | Event Value | Type | String Representation');
    console.log('------|-------------|------|------------------------');
    
    records.forEach((record, idx) => {
      const event = record.event;
      const eventStr = String(event || '').toUpperCase();
      const eventNum = Number(event);
      console.log(`${idx.toString().padEnd(5)} | ${String(event).padEnd(11)} | ${typeof event} | "${eventStr}"`);
    });
    
    // Count by exact event value
    console.log('\n\n📊 COUNT BY EXACT EVENT VALUE:\n');
    const pipeline = [
      {
        $group: {
          _id: '$event',
          count: { $sum: 1 }
        }
      },
      { $sort: { count: -1 } }
    ];
    
    const grouped = await Telemetry.aggregate(pipeline);
    grouped.forEach(item => {
      console.log(`  "${item._id}" → ${item.count} records`);
    });
    
    await mongoose.disconnect();
  } catch (error) {
    console.error('Error:', error.message);
    process.exit(1);
  }
}

checkEvents();
