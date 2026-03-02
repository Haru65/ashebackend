/**
 * CORRECTIVE Migration - Fix event field by extracting from data.EVENT
 * 
 * Problem: event field is wrong, but data.EVENT has the correct value
 * Solution: Copy data.EVENT to event field for ALL records
 */

const mongoose = require('mongoose');
const Telemetry = require('./models/telemetry');
require('dotenv').config();

async function fixEventField() {
  try {
    console.log('🔧 Starting CORRECTIVE event field fix...\n');

    // Connect to MongoDB
    await mongoose.connect(process.env.MONGODB_URI || 'mongodb://localhost:27017/zeptac-iot');
    console.log('✅ Connected to MongoDB\n');

    // Get all telemetry records
    const allRecords = await Telemetry.find({});
    console.log(`📊 Total records to process: ${allRecords.length}\n`);

    if (allRecords.length === 0) {
      console.log('ℹ️ No records to migrate');
      await mongoose.connection.close();
      return;
    }

    // Track statistics
    let updated = 0;
    let unchanged = 0;
    let errors = 0;
    const eventCounts = {};
    const beforeCounts = {};

    // Process each record
    for (let i = 0; i < allRecords.length; i++) {
      const record = allRecords[i];
      
      try {
        // Get current event value
        const currentEvent = record.event;
        beforeCounts[currentEvent] = (beforeCounts[currentEvent] || 0) + 1;

        // Extract EVENT from data (this is the CORRECT value)
        let correctEvent = null;
        
        if (record.data && record.data instanceof Map) {
          correctEvent = record.data.get('EVENT');
        } else if (record.data && typeof record.data === 'object') {
          correctEvent = record.data.EVENT;
        }

        // If we found a correct event, update the record
        if (correctEvent) {
          // Log first 10 updates
          if (updated < 10) {
            console.log(`[${i + 1}/${allRecords.length}] Fixing record ${record._id}`);
            console.log(`  Before: event="${currentEvent}"`);
            console.log(`  After:  event="${correctEvent}"`);
            console.log(`  From:   data.EVENT="${correctEvent}"`);
          }
          
          // Update the record
          record.event = correctEvent;
          await record.save();
          
          updated++;
          eventCounts[correctEvent] = (eventCounts[correctEvent] || 0) + 1;
        } else {
          unchanged++;
          eventCounts[currentEvent] = (eventCounts[currentEvent] || 0) + 1;
        }

        // Log progress every 500 records
        if ((i + 1) % 500 === 0) {
          const percent = Math.round((i + 1) / allRecords.length * 100);
          console.log(`   Progress: ${i + 1}/${allRecords.length} (${percent}%) - Updated: ${updated}, Unchanged: ${unchanged}\n`);
        }
      } catch (error) {
        console.error(`❌ Error processing record ${record._id}:`, error.message);
        errors++;
      }
    }

    console.log('\n' + '='.repeat(80));
    console.log('📊 CORRECTION SUMMARY');
    console.log('='.repeat(80));
    console.log(`✅ Fixed records: ${updated}`);
    console.log(`⏭️  Unchanged records: ${unchanged}`);
    console.log(`❌ Errors: ${errors}`);
    console.log(`📈 Total processed: ${updated + unchanged + errors}/${allRecords.length}`);
    
    console.log('\n📋 BEFORE (Incorrect event values):');
    Object.entries(beforeCounts)
      .sort((a, b) => b[1] - a[1])
      .forEach(([event, count]) => {
        console.log(`   ${event || '(null)'}: ${count} records`);
      });

    console.log('\n📋 AFTER (Correct event values from data.EVENT):');
    Object.entries(eventCounts)
      .sort((a, b) => b[1] - a[1])
      .forEach(([event, count]) => {
        console.log(`   ${event || '(null)'}: ${count} records`);
      });

    if (updated === 0) {
      console.log('\n⚠️  WARNING: No records were fixed!');
      console.log('   This could mean:');
      console.log('   1. data.EVENT field is empty/null');
      console.log('   2. data field doesn\'t exist');
      console.log('   3. All records already have correct values');
    } else {
      console.log('\n✅ Correction successful!');
      console.log(`   ${updated} records have been fixed`);
      console.log('   Event field now matches data.EVENT');
    }
    
  } catch (error) {
    console.error('❌ Correction failed:', error);
  } finally {
    await mongoose.connection.close();
    console.log('\n🔌 Database connection closed');
  }
}

// Run correction
fixEventField();
