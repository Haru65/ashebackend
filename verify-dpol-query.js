/**
 * Verify that DPOL and INST events can be queried from database
 * Usage: node verify-dpol-query.js
 */

require('dotenv').config({ path: '.env' });
const mongoose = require('mongoose');
const Telemetry = require('./models/telemetry');

async function verifyDpolQuery() {
  try {
    const mongoUri = process.env.MONGO_URI || 'mongodb://localhost:27017/ashecontrol';
    console.log('🔗 Connecting to MongoDB:', mongoUri);
    
    await mongoose.connect(mongoUri);
    console.log('✅ Connected\n');
    
    // Get total count
    const totalCount = await Telemetry.countDocuments();
    console.log(`📊 Total telemetry records: ${totalCount}\n`);
    
    // Test each filter
    const filters = [
      {
        name: 'NORMAL',
        conditions: [
          { event: { $in: [0, '0'] } },
          { event: { $regex: 'NORMAL', $options: 'i' } }
        ]
      },
      {
        name: 'INT',
        conditions: [
          { event: { $in: [1, '1'] } },
          { event: { $regex: 'INT|INTERRUPT', $options: 'i' } }
        ]
      },
      {
        name: 'DPOL',
        conditions: [
          { event: { $in: [3, '3'] } },
          { event: { $regex: 'DPOL|DEPOL', $options: 'i' } }
        ]
      },
      {
        name: 'INST',
        conditions: [
          { event: { $in: [4, '4'] } },
          { event: { $regex: 'INST|INSTANT', $options: 'i' } }
        ]
      }
    ];
    
    for (const filter of filters) {
      // Build query like the backend does
      const query = {
        $or: filter.conditions
      };
      
      const count = await Telemetry.countDocuments(query);
      console.log(`🔍 Filter "${filter.name}": ${count} records`);
      
      if (count > 0) {
        // Get a sample
        const sample = await Telemetry.findOne(query);
        console.log(`   Sample event: "${sample.event}"`);
      }
    }
    
    console.log('\n✅ Verification complete');
    
  } catch (error) {
    console.error('❌ Error:', error.message);
    process.exit(1);
  } finally {
    await mongoose.disconnect();
  }
}

verifyDpolQuery();
