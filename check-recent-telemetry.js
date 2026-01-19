// Direct MongoDB check - no lean(), show raw Map data
const mongoose = require('mongoose');
const DB_URI = 'mongodb://localhost:27017/AsheTech';

async function checkTelemetry() {
  try {
    await mongoose.connect(DB_URI);
    console.log('✓ Connected to MongoDB\n');

    const Telemetry = require('./models/telemetry');

    // Get the most recent 20 records of each event type
    const eventTypes = ['INT OFF', 'INT ON', 'DPOL', 'DEPOL', 'INST ON', 'INST OFF', 'NORMAL'];
    
    for (const eventType of eventTypes) {
      console.log(`\n${'='.repeat(80)}`);
      console.log(`📊 Recent records with event: "${eventType}"`);
      console.log(`${'='.repeat(80)}`);
      
      const records = await Telemetry.find({ event: eventType })
        .sort({ timestamp: -1 })
        .limit(3)
        .exec(); // Using exec() instead of lean() to get real data
      
      if (records.length === 0) {
        console.log('   No records found');
        continue;
      }
      
      records.forEach((record, idx) => {
        console.log(`\n  Record ${idx + 1} (ID: ${record._id})`);
        console.log(`    timestamp: ${record.timestamp}`);
        console.log(`    event: "${record.event}"`);
        console.log(`    location: ${record.location}`);
        
        // Check data field
        if (record.data) {
          console.log(`    data type: ${typeof record.data}`);
          console.log(`    is Map: ${record.data instanceof Map}`);
          console.log(`    data size: ${record.data instanceof Map ? record.data.size : Object.keys(record.data).length}`);
          
          if (record.data instanceof Map) {
            console.log(`    Map keys: ${Array.from(record.data.keys()).slice(0, 10).join(', ')}`);
            if (record.data.size > 10) console.log(`    ... and ${record.data.size - 10} more keys`);
            
            // Show sample values
            const entries = Array.from(record.data.entries()).slice(0, 3);
            console.log(`    Sample values:`);
            entries.forEach(([key, val]) => {
              const valStr = typeof val === 'object' ? JSON.stringify(val) : String(val);
              console.log(`      ${key}: ${valStr.substring(0, 50)}`);
            });
          } else if (typeof record.data === 'object') {
            const keys = Object.keys(record.data);
            console.log(`    Object keys: ${keys.slice(0, 10).join(', ')}`);
            if (keys.length > 10) console.log(`    ... and ${keys.length - 10} more keys`);
          } else {
            console.log(`    ⚠️ data is not a Map or object, type is: ${typeof record.data}`);
            console.log(`    value: ${JSON.stringify(record.data)}`);
          }
        } else {
          console.log(`    ❌ NO DATA FIELD!`);
        }
      });
    }
    
    // Also check what the API returns
    console.log(`\n\n${'='.repeat(80)}`);
    console.log(`📡 Simulating API response (.lean() behavior)`);
    console.log(`${'='.repeat(80)}`);
    
    // This simulates what the API endpoint does
    const leanRecords = await Telemetry.find({ event: 'DEPOL' })
      .sort({ timestamp: -1 })
      .limit(2)
      .lean();
    
    console.log(`\nLean records (as API returns):`);
    leanRecords.forEach((record, idx) => {
      console.log(`\n  Record ${idx + 1} (ID: ${record._id})`);
      console.log(`    event: "${record.event}"`);
      console.log(`    data type: ${typeof record.data}`);
      console.log(`    data keys: ${record.data ? Object.keys(record.data).length : 0}`);
      if (record.data && typeof record.data === 'object') {
        console.log(`    Object.keys(record.data): ${Object.keys(record.data).join(', ')}`);
      }
    });
    
    console.log('\n✅ Check complete');
    process.exit(0);
  } catch (error) {
    console.error('❌ Error:', error.message);
    console.error(error.stack);
    process.exit(1);
  }
}

checkTelemetry();
