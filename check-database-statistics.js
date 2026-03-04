#!/usr/bin/env node

/**
 * Database Statistics Script
 * Checks total records in database and breaks down by event mode
 * Usage: node check-database-statistics.js
 */

require('dotenv').config();
const mongoose = require('mongoose');

// MongoDB connection
const MONGODB_URI = process.env.MONGODB_URI || 'mongodb://localhost:27017/zeptac_iot';

console.log('\n' + '='.repeat(80));
console.log('📊 DATABASE STATISTICS CHECKER');
console.log('='.repeat(80));
console.log(`🔗 Connecting to MongoDB: ${MONGODB_URI.replace(/:[^:]*@/, ':***@')}`);

mongoose.connect(MONGODB_URI, {
  useNewUrlParser: true,
  useUnifiedTopology: true
})
  .then(async () => {
    console.log('✅ Connected to MongoDB\n');

    try {
      const Telemetry = require('./models/telemetry');

      // Get total count
      const totalCount = await Telemetry.countDocuments();
      console.log(`📈 TOTAL RECORDS: ${totalCount.toLocaleString()}`);

      if (totalCount === 0) {
        console.log('\n⚠️  No records found in database');
        process.exit(0);
      }

      console.log('\n' + '-'.repeat(80));
      console.log('📋 RECORDS BY EVENT MODE:');
      console.log('-'.repeat(80));

      // Define modes to check
      const modes = ['NORMAL', 'DPOL', 'INT', 'INST'];

      let modeStats = [];
      let totalByModes = 0;

      for (const mode of modes) {
        // Count exact matches
        const count = await Telemetry.countDocuments({
          event: { $regex: `^${mode}`, $options: 'i' }
        });

        modeStats.push({
          mode,
          count,
          percentage: ((count / totalCount) * 100).toFixed(2)
        });

        totalByModes += count;

        const bar = '█'.repeat(Math.round(count / (totalCount / 50)));
        console.log(`  ${mode.padEnd(10)} │ ${bar.padEnd(50)} │ ${count.toLocaleString().padStart(10)} (${(parseFloat(modeStats[modeStats.length - 1].percentage)).toFixed(1)}%)`);
      }

      // Check for unclassified records
      const unclassified = totalCount - totalByModes;
      if (unclassified > 0) {
        console.log(`  ${'OTHER'.padEnd(10)} │ ${('█'.repeat(Math.round(unclassified / (totalCount / 50)))).padEnd(50)} │ ${unclassified.toLocaleString().padStart(10)} (${((unclassified / totalCount) * 100).toFixed(1)}%)`);
      }

      console.log('-'.repeat(80));

      // Get date range
      const oldestRecord = await Telemetry.findOne().sort({ timestamp: 1 });
      const newestRecord = await Telemetry.findOne().sort({ timestamp: -1 });

      if (oldestRecord && newestRecord) {
        console.log('\n📅 DATE RANGE:');
        console.log(`  Oldest record: ${new Date(oldestRecord.timestamp).toISOString()}`);
        console.log(`  Newest record: ${new Date(newestRecord.timestamp).toISOString()}`);

        const daysDiff = Math.round((newestRecord.timestamp - oldestRecord.timestamp) / (1000 * 60 * 60 * 24));
        console.log(`  Time span: ${daysDiff} days`);
      }

      // Get device count
      const deviceCount = await Telemetry.distinct('deviceId');
      console.log(`\n🔧 DEVICE COUNT: ${deviceCount.length}`);
      if (deviceCount.length > 0) {
        console.log(`   Devices: ${deviceCount.join(', ')}`);
      }

      // Get storage stats
      try {
        const db = mongoose.connection.db;
        const stats = await db.collection('telemetries').stats();
        const sizeInMB = (stats.size / 1024 / 1024).toFixed(2);
        const avgDocSize = ((stats.size / totalCount) / 1024).toFixed(2);

        console.log(`\n💾 STORAGE INFORMATION:`);
        console.log(`  Total size: ${sizeInMB} MB`);
        console.log(`  Average document size: ${avgDocSize} KB`);
        console.log(`  Number of documents: ${stats.count.toLocaleString()}`);
      } catch (statsError) {
        console.log(`\n💾 STORAGE INFORMATION: (unavailable)`);
      }

      // Summary table
      console.log('\n' + '='.repeat(80));
      console.log('📊 SUMMARY TABLE:');
      console.log('='.repeat(80));
      console.log(`| ${'Mode'.padEnd(12)} | ${'Count'.padEnd(15)} | ${'Percentage'.padEnd(15)} |`);
      console.log('|' + '-'.repeat(12) + '|' + '-'.repeat(17) + '|' + '-'.repeat(17) + '|');
      
      modeStats.forEach(stat => {
        console.log(`| ${stat.mode.padEnd(12)} | ${stat.count.toLocaleString().padEnd(15)} | ${stat.percentage.padEnd(13)}% |`);
      });

      if (unclassified > 0) {
        console.log(`| ${'OTHER'.padEnd(12)} | ${unclassified.toLocaleString().padEnd(15)} | ${((unclassified / totalCount) * 100).toFixed(2).padEnd(13)}% |`);
      }

      console.log('|' + '-'.repeat(12) + '|' + '-'.repeat(17) + '|' + '-'.repeat(17) + '|');
      console.log(`| ${'TOTAL'.padEnd(12)} | ${totalCount.toLocaleString().padEnd(15)} | ${'100.00'.padEnd(13)}% |`);
      console.log('='.repeat(80) + '\n');

    } catch (error) {
      console.error('❌ Error:', error.message);
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
