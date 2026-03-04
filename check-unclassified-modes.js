#!/usr/bin/env node

/**
 * Check Unclassified Event Modes
 * Discovers what event values are in the "OTHER" category
 * Usage: node check-unclassified-modes.js
 */

require('dotenv').config();
const mongoose = require('mongoose');

const MONGODB_URI = process.env.MONGODB_URI || 'mongodb://localhost:27017/zeptac_iot';

console.log('\n' + '='.repeat(80));
console.log('🔍 UNCLASSIFIED EVENT MODES ANALYZER');
console.log('='.repeat(80));
console.log(`🔗 Connecting to MongoDB: ${MONGODB_URI.replace(/:[^:]*@/, ':***@')}\n`);

mongoose.connect(MONGODB_URI, {
  useNewUrlParser: true,
  useUnifiedTopology: true
})
  .then(async () => {
    console.log('✅ Connected to MongoDB\n');

    try {
      const Telemetry = require('./models/telemetry');

      // Define standard modes
      const standardModes = ['NORMAL', 'DPOL', 'INT', 'INST'];

      // Get all unique event values
      const allEvents = await Telemetry.distinct('event');
      const totalCount = await Telemetry.countDocuments();
      
      console.log(`📊 Total unique event values: ${allEvents.length}\n`);
      console.log('-'.repeat(80));
      console.log('ALL EVENT VALUES IN DATABASE:');
      console.log('-'.repeat(80));

      let eventStats = [];

      for (const eventValue of allEvents.sort()) {
        const count = await Telemetry.countDocuments({ event: eventValue });
        const isStandard = standardModes.some(mode => 
          eventValue.toString().toUpperCase().startsWith(mode)
        );

        eventStats.push({
          value: eventValue,
          count,
          isStandard,
          percentage: ((count / totalCount) * 100).toFixed(2)
        });
      }

      // Separate standard and non-standard
      const standardEvents = eventStats.filter(e => e.isStandard);
      const otherEvents = eventStats.filter(e => !e.isStandard);

      // Display standard events
      console.log('\n✅ STANDARD MODES:\n');
      for (const event of standardEvents) {
        const bar = '█'.repeat(Math.round(event.count / totalCount * 50 / 100));
        console.log(`  ${event.value.toString().padEnd(30)} │ ${bar.padEnd(40)} │ ${event.count.toLocaleString().padStart(10)} (${event.percentage}%)`);
      }

      // Display other events
      if (otherEvents.length > 0) {
        console.log('\n❓ UNCLASSIFIED/OTHER MODES:\n');
        for (const event of otherEvents) {
          const bar = '█'.repeat(Math.round(event.count / totalCount * 50 / 100));
          console.log(`  ${event.value.toString().padEnd(30)} │ ${bar.padEnd(40)} │ ${event.count.toLocaleString().padStart(10)} (${event.percentage}%)`);
        }
      }

      console.log('\n' + '-'.repeat(80));
      console.log('📈 DETAILED BREAKDOWN:\n');

      // Create summary table
      console.log(`| ${'Event Value'.padEnd(35)} | ${'Count'.padEnd(15)} | ${'Type'.padEnd(15)} |`);
      console.log('|' + '-'.repeat(37) + '|' + '-'.repeat(17) + '|' + '-'.repeat(17) + '|');

      eventStats.forEach(event => {
        const type = event.isStandard ? 'Standard' : 'Other';
        console.log(`| ${event.value.toString().padEnd(35)} | ${event.count.toLocaleString().padEnd(15)} | ${type.padEnd(15)} |`);
      });

      console.log('|' + '-'.repeat(37) + '|' + '-'.repeat(17) + '|' + '-'.repeat(17) + '|');

      // Get sample records from each "OTHER" event type
      if (otherEvents.length > 0) {
        console.log('\n' + '='.repeat(80));
        console.log('📋 SAMPLE RECORDS FROM "OTHER" MODES:');
        console.log('='.repeat(80));

        for (const event of otherEvents.slice(0, 5)) {
          console.log(`\n🔹 Event: "${event.value}" (${event.count} records)`);
          
          const sample = await Telemetry.findOne({ event: event.value }).lean();
          
          if (sample) {
            console.log(`   Sample Record ID: ${sample._id}`);
            console.log(`   Timestamp: ${sample.timestamp}`);
            console.log(`   Device ID: ${sample.deviceId}`);
            console.log(`   Event: ${sample.event}`);
            
            // Show first few data fields if available
            if (sample.data && typeof sample.data === 'object') {
              const dataObj = sample.data instanceof Map ? Object.fromEntries(sample.data) : sample.data;
              const dataKeys = Object.keys(dataObj).slice(0, 3);
              console.log(`   Data fields: ${dataKeys.join(', ')}${Object.keys(dataObj).length > 3 ? '...' : ''}`);
            }
          }
        }
      }

      console.log('\n' + '='.repeat(80) + '\n');

    } catch (error) {
      console.error('❌ Error:', error.message);
      console.error(error);
      process.exit(1);
    } finally {
      await mongoose.connection.close();
      console.log('🔌 Disconnected from MongoDB\n');
    }
  })
  .catch(error => {
    console.error('❌ Connection error:', error.message);
    process.exit(1);
  });
