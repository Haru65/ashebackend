/**
 * Migration script to fix event field in existing telemetry records
 * 
 * Problem: Existing records have event="NORMAL" for all records
 * because the event was not being extracted from Parameters.EVENT
 * 
 * Solution: Extract the actual event from the data.EVENT field and update the event field
 */

const mongoose = require('mongoose');
const Telemetry = require('./models/telemetry');
require('dotenv').config();

async function migrateEventField() {
  try {
    console.log('🔄 Starting event field migration...\n');

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

    // Process each record
    for (let i = 0; i < allRecords.length; i++) {
      const record = allRecords[i];
      
      try {
        // Extract actual event from data fields
        let actualEvent = null;
        
        if (record.data) {
          // Handle Map data type
          if (record.data instanceof Map) {
            actualEvent = record.data.get('EVENT') || record.data.get('Event');
          } else if (typeof record.data === 'object') {
            // Handle plain object
            actualEvent = record.data.EVENT || record.data.Event;
          }
        }

        // If we found an actual event and it's different from current event
        if (actualEvent && actualEvent !== record.event) {
          console.log(`[${i + 1}/${allRecords.length}] Updating record ${record._id}`);
          console.log(`  Before: event="${record.event}"`);
          console.log(`  After:  event="${actualEvent}"`);
          
          // Update the record
          record.event = actualEvent;
          await record.save();
          
          updated++;
          eventCounts[actualEvent] = (eventCounts[actualEvent] || 0) + 1;
        } else {
          unchanged++;
          if (record.event) {
            eventCounts[record.event] = (eventCounts[record.event] || 0) + 1;
          }
        }

        // Log progress every 10 records
        if ((i + 1) % 10 === 0) {
          console.log(`   Progress: ${i + 1}/${allRecords.length} (${Math.round((i + 1) / allRecords.length * 100)}%)\n`);
        }
      } catch (error) {
        console.error(`❌ Error processing record ${record._id}:`, error.message);
        errors++;
      }
    }

    console.log('\n' + '='.repeat(80));
    console.log('📊 MIGRATION SUMMARY');
    console.log('='.repeat(80));
    console.log(`✅ Updated records: ${updated}`);
    console.log(`⏭️  Unchanged records: ${unchanged}`);
    console.log(`❌ Errors: ${errors}`);
    console.log(`📈 Total processed: ${updated + unchanged + errors}/${allRecords.length}`);
    
    console.log('\n📋 Event distribution after migration:');
    Object.entries(eventCounts)
      .sort((a, b) => b[1] - a[1])
      .forEach(([event, count]) => {
        console.log(`   ${event}: ${count} records`);
      });

    console.log('\n✅ Migration complete!');
    
  } catch (error) {
    console.error('❌ Migration failed:', error);
  } finally {
    await mongoose.connection.close();
    console.log('\n🔌 Database connection closed');
  }
}

// Run migration
migrateEventField();
