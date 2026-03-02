/**
 * IMPROVED Migration script to fix event field in existing telemetry records
 * Version 2 - Handles all data structure variations
 */

const mongoose = require('mongoose');
const Telemetry = require('./models/telemetry');
require('dotenv').config();

async function migrateEventField() {
  try {
    console.log('🔄 Starting IMPROVED event field migration (v2)...\n');

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
    const dataStructures = new Set();

    // Process each record
    for (let i = 0; i < allRecords.length; i++) {
      const record = allRecords[i];
      
      try {
        // Extract actual event from data fields - try ALL possible locations
        let actualEvent = null;
        let dataStructureType = 'unknown';

        if (record.data) {
          // Handle Map data type
          if (record.data instanceof Map) {
            dataStructureType = 'Map';
            // Try all possible keys
            actualEvent = record.data.get('EVENT') || 
                         record.data.get('Event') || 
                         record.data.get('event') ||
                         record.data.get('MODE') ||
                         record.data.get('Mode') ||
                         record.data.get('mode');
          } else if (typeof record.data === 'object' && record.data !== null) {
            dataStructureType = 'Object';
            // Handle plain object - try all possible keys
            actualEvent = record.data.EVENT || 
                         record.data.Event || 
                         record.data.event ||
                         record.data.MODE ||
                         record.data.Mode ||
                         record.data.mode;
          } else {
            dataStructureType = typeof record.data;
          }
        } else {
          dataStructureType = 'null/undefined';
        }

        dataStructures.add(dataStructureType);

        // If we found an actual event and it's different from current event
        if (actualEvent && actualEvent !== record.event) {
          // Log first 5 updates
          if (updated < 5) {
            console.log(`[${i + 1}/${allRecords.length}] Updating record ${record._id}`);
            console.log(`  Data structure: ${dataStructureType}`);
            console.log(`  Before: event="${record.event}"`);
            console.log(`  After:  event="${actualEvent}"`);
          }
          
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

        // Log progress every 100 records
        if ((i + 1) % 100 === 0) {
          console.log(`   Progress: ${i + 1}/${allRecords.length} (${Math.round((i + 1) / allRecords.length * 100)}%) - Updated: ${updated}, Unchanged: ${unchanged}\n`);
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
    
    console.log('\n📋 Data structures found:');
    dataStructures.forEach(ds => console.log(`   - ${ds}`));
    
    console.log('\n📋 Event distribution after migration:');
    Object.entries(eventCounts)
      .sort((a, b) => b[1] - a[1])
      .forEach(([event, count]) => {
        console.log(`   ${event || '(null)'}: ${count} records`);
      });

    if (updated === 0) {
      console.log('\n⚠️  WARNING: No records were updated!');
      console.log('   This could mean:');
      console.log('   1. All records already have correct event values');
      console.log('   2. Event data is stored in a different location');
      console.log('   3. Event data doesn\'t exist in the data field');
      console.log('\n   Run: node checkDataStructure.js');
      console.log('   to diagnose the data structure');
    } else {
      console.log('\n✅ Migration successful!');
    }
    
  } catch (error) {
    console.error('❌ Migration failed:', error);
  } finally {
    await mongoose.connection.close();
    console.log('\n🔌 Database connection closed');
  }
}

// Run migration
migrateEventField();
