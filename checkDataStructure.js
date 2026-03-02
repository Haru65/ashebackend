/**
 * Check the actual data structure of telemetry records
 * to understand why migration isn't working
 */

const mongoose = require('mongoose');
const Telemetry = require('./models/telemetry');
require('dotenv').config();

async function checkDataStructure() {
  try {
    console.log('🔍 Checking telemetry data structure...\n');

    // Connect to MongoDB
    await mongoose.connect(process.env.MONGODB_URI || 'mongodb://localhost:27017/zeptac-iot');
    console.log('✅ Connected to MongoDB\n');

    // Get a sample record
    const sample = await Telemetry.findOne({});
    
    if (!sample) {
      console.log('❌ No records found in database');
      await mongoose.connection.close();
      return;
    }

    console.log('📋 SAMPLE RECORD STRUCTURE:');
    console.log('='.repeat(80));
    
    // Show top-level fields
    console.log('\n🔹 Top-level fields:');
    Object.keys(sample.toObject()).forEach(key => {
      const value = sample[key];
      const type = typeof value;
      console.log(`   ${key}: ${type}`);
    });

    // Show event field
    console.log('\n🔹 Event field:');
    console.log(`   Value: "${sample.event}"`);
    console.log(`   Type: ${typeof sample.event}`);

    // Show data field structure
    console.log('\n🔹 Data field:');
    if (sample.data) {
      console.log(`   Type: ${sample.data.constructor.name}`);
      console.log(`   Is Map: ${sample.data instanceof Map}`);
      
      if (sample.data instanceof Map) {
        console.log(`   Size: ${sample.data.size}`);
        console.log(`   Keys: ${Array.from(sample.data.keys()).join(', ')}`);
        
        // Show first few entries
        console.log('\n   First 5 entries:');
        let count = 0;
        for (const [key, value] of sample.data) {
          if (count >= 5) break;
          console.log(`     ${key}: ${value}`);
          count++;
        }
        
        // Check for EVENT field
        console.log('\n   Looking for EVENT field:');
        console.log(`     Has EVENT: ${sample.data.has('EVENT')}`);
        console.log(`     Has Event: ${sample.data.has('Event')}`);
        console.log(`     Has event: ${sample.data.has('event')}`);
        
        if (sample.data.has('EVENT')) {
          console.log(`     EVENT value: "${sample.data.get('EVENT')}"`);
        }
        if (sample.data.has('Event')) {
          console.log(`     Event value: "${sample.data.get('Event')}"`);
        }
      } else if (typeof sample.data === 'object') {
        console.log(`   Type: Plain Object`);
        console.log(`   Keys: ${Object.keys(sample.data).join(', ')}`);
        
        // Show first few entries
        console.log('\n   First 5 entries:');
        Object.entries(sample.data).slice(0, 5).forEach(([key, value]) => {
          console.log(`     ${key}: ${value}`);
        });
        
        // Check for EVENT field
        console.log('\n   Looking for EVENT field:');
        console.log(`     Has EVENT: ${sample.data.EVENT !== undefined}`);
        console.log(`     Has Event: ${sample.data.Event !== undefined}`);
        console.log(`     Has event: ${sample.data.event !== undefined}`);
        
        if (sample.data.EVENT !== undefined) {
          console.log(`     EVENT value: "${sample.data.EVENT}"`);
        }
        if (sample.data.Event !== undefined) {
          console.log(`     Event value: "${sample.data.Event}"`);
        }
      } else {
        console.log(`   Type: ${typeof sample.data}`);
        console.log(`   Value: ${sample.data}`);
      }
    } else {
      console.log('   Data field is empty/null');
    }

    // Show full record as JSON
    console.log('\n🔹 Full record (first 1000 chars):');
    console.log('='.repeat(80));
    const recordJson = JSON.stringify(sample.toObject(), null, 2);
    console.log(recordJson.substring(0, 1000));
    if (recordJson.length > 1000) {
      console.log('... (truncated)');
    }

    // Count records by event type
    console.log('\n\n📊 RECORD COUNT BY EVENT TYPE:');
    console.log('='.repeat(80));
    
    const eventCounts = await Telemetry.aggregate([
      { $group: { _id: '$event', count: { $sum: 1 } } },
      { $sort: { count: -1 } }
    ]);

    eventCounts.forEach(item => {
      console.log(`   ${item._id || '(null)'}: ${item.count} records`);
    });

    console.log('\n✅ Data structure check complete!');
    
  } catch (error) {
    console.error('❌ Error:', error.message);
    console.error(error);
  } finally {
    await mongoose.connection.close();
    console.log('\n🔌 Database connection closed');
  }
}

// Run check
checkDataStructure();
