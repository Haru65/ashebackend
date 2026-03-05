/**
 * Check all telemetry records and their location data
 */

require('dotenv').config();
const mongoose = require('mongoose');
const Telemetry = require('./models/telemetry');

async function checkData() {
  try {
    await mongoose.connect(process.env.MONGODB_URI || 'mongodb+srv://admin:ashecontrol@cluster0.v2hyu.mongodb.net/ashecontrol?retryWrites=true&w=majority', {
      serverSelectionTimeoutMS: 15000
    });

    console.log('\n=== ALL EVENT TYPES (Recent Records) ===\n');
    
    const eventTypes = ['DPOL', 'INT', 'INST', 'NORMAL'];
    
    for (const type of eventTypes) {
      const records = await Telemetry.find({ event: type })
        .sort({ timestamp: -1 })
        .limit(5)
        .lean();
      
      console.log(`${type}:`);
      
      if (records.length === 0) {
        console.log('  NO RECORDS');
      } else {
        records.forEach((r, i) => {
          const ts = r.timestamp ? new Date(r.timestamp).toISOString().substring(0, 10) : 'null';
          console.log(`  [${i+1}] ${ts} | Location: "${r.location || 'null'}"`);
        });
      }
      console.log('');
    }

    await mongoose.connection.close();
  } catch (error) {
    console.error('Error:', error.message);
  }
}

checkData();
