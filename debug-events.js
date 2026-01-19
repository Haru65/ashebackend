/**
 * Debug script to check what event types are in the telemetry database
 * Usage: node debug-events.js
 */

require('dotenv').config({ path: '.env' });
const mongoose = require('mongoose');
const Telemetry = require('./models/telemetry');

async function debugEvents() {
  try {
    // Connect to MongoDB
    const mongoUri = process.env.MONGO_URI || 'mongodb://localhost:27017/ashecontrol';
    console.log('🔗 Connecting to MongoDB:', mongoUri);
    
    await mongoose.connect(mongoUri);
    console.log('✅ Connected to MongoDB\n');
    
    // Get all unique event values
    const uniqueEvents = await Telemetry.aggregate([
      {
        $group: {
          _id: '$event',
          count: { $sum: 1 },
          sample: { $first: '$_id' }
        }
      },
      {
        $sort: { count: -1 }
      }
    ]);
    
    console.log('📊 UNIQUE EVENTS IN TELEMETRY DATABASE:\n');
    console.log('Event Value | Type | Count');
    console.log('------------|------|-------');
    
    uniqueEvents.forEach(item => {
      const eventValue = item._id;
      const eventType = typeof eventValue;
      const count = item.count;
      
      // Classify the event
      let classification = '';
      if (eventValue === 0 || eventValue === '0') {
        classification = '(NORMAL)';
      } else if (eventValue === 1 || eventValue === '1') {
        classification = '(INT)';
      } else if (eventValue === 3 || eventValue === '3') {
        classification = '(DPOL/DEPOL)';
      } else if (eventValue === 4 || eventValue === '4') {
        classification = '(INST)';
      } else if (String(eventValue).toUpperCase().includes('NORMAL')) {
        classification = '(NORMAL-STR)';
      } else if (String(eventValue).toUpperCase().includes('INT')) {
        classification = '(INT-STR)';
      } else if (String(eventValue).toUpperCase().includes('DPOL') || String(eventValue).toUpperCase().includes('DEPOL')) {
        classification = '(DPOL-STR)';
      } else if (String(eventValue).toUpperCase().includes('INST')) {
        classification = '(INST-STR)';
      }
      
      console.log(`${String(eventValue).padEnd(11)} | ${eventType.padEnd(4)} | ${count} ${classification}`);
    });
    
    console.log('\n');
    
    // Get sample records for each event type
    console.log('📋 SAMPLE RECORDS BY EVENT TYPE:\n');
    
    for (const eventItem of uniqueEvents) {
      const eventValue = eventItem._id;
      const sample = await Telemetry.findById(eventItem.sample);
      
      if (sample) {
        console.log(`\nEvent: ${eventValue}`);
        console.log('  Device:', sample.deviceId);
        console.log('  Timestamp:', sample.timestamp);
        console.log('  Data fields count:', sample.data ? Object.keys(sample.data).length : 0);
        if (sample.data && Object.keys(sample.data).length > 0) {
          const keys = Object.keys(sample.data).slice(0, 5);
          console.log('  Sample data keys:', keys.join(', '));
        }
      }
    }
    
    // Count total records
    const totalCount = await Telemetry.countDocuments();
    console.log(`\n\n✅ Total telemetry records: ${totalCount}`);
    
    // Count by mode
    console.log('\n📊 RECORDS BY MODE TYPE:');
    const normalCount = await Telemetry.countDocuments({ 
      event: { $in: [0, '0', 'NORMAL'] } 
    });
    const intCount = await Telemetry.countDocuments({ 
      event: { $in: [1, '1', 'INT', 'INTERRUPT'] } 
    });
    const dpolCount = await Telemetry.countDocuments({ 
      $or: [
        { event: { $in: [3, '3'] } },
        { event: { $regex: 'DPOL|DEPOL', $options: 'i' } }
      ]
    });
    const instCount = await Telemetry.countDocuments({ 
      $or: [
        { event: { $in: [4, '4'] } },
        { event: { $regex: 'INST|INSTANT', $options: 'i' } }
      ]
    });
    
    console.log(`  NORMAL: ${normalCount}`);
    console.log(`  INT:    ${intCount}`);
    console.log(`  DPOL:   ${dpolCount}`);
    console.log(`  INST:   ${instCount}`);
    console.log(`  Other:  ${totalCount - normalCount - intCount - dpolCount - instCount}`);
    
    console.log('\n');
    
  } catch (error) {
    console.error('❌ Error:', error.message);
    process.exit(1);
  } finally {
    await mongoose.disconnect();
    console.log('✅ Disconnected from MongoDB');
  }
}

debugEvents();
