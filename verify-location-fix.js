#!/usr/bin/env node

/**
 * Verify Location Fix - Check actual location values
 */

require('dotenv').config();
const mongoose = require('mongoose');

const MONGODB_URI = process.env.MONGODB_URI || 'mongodb://localhost:27017/zeptac_iot';

mongoose.connect(MONGODB_URI, { useNewUrlParser: true, useUnifiedTopology: true })
  .then(async () => {
    try {
      const Telemetry = require('./models/telemetry');

      console.log('\n' + '='.repeat(80));
      console.log('✅ LOCATION FIX VERIFICATION');
      console.log('='.repeat(80) + '\n');

      const modes = ['DPOL', 'INT ON', 'INT OFF', 'INST ON', 'INST OFF'];

      for (const mode of modes) {
        const samples = await Telemetry.find({ event: mode })
          .select('location timestamp')
          .limit(3)
          .lean();

        console.log(`\n📌 ${mode.padEnd(12)} (samples):`);
        samples.forEach((sample, idx) => {
          console.log(`   ${(idx + 1)}. Location: "${sample.location}"`);
        });
      }

      // Summary
      console.log('\n' + '='.repeat(80));
      console.log('Location Distribution Summary:\n');

      const nullCount = await Telemetry.countDocuments({ location: 'null, null' });
      const mumbaiCount = await Telemetry.countDocuments({ location: 'Mumbai, India' });
      const coordCount = await Telemetry.countDocuments({
        location: { $regex: '^-?\\d+\\.?\\d*,\\s*-?\\d+\\.?\\d*$' }
      });

      console.log(`Records with "null, null": ${nullCount}`);
      console.log(`Records with "Mumbai, India": ${mumbaiCount}`);
      console.log(`Records with coordinates: ${coordCount}`);
      console.log(`\n✅ Total fixed: ${nullCount === 0 ? '✓ All fixed!' : `Need to fix ${nullCount} more`}`);

      console.log('\n' + '='.repeat(80) + '\n');

    } catch (error) {
      console.error('❌ Error:', error.message);
      process.exit(1);
    } finally {
      await mongoose.connection.close();
    }
  })
  .catch(error => {
    console.error('❌ Connection error:', error.message);
    process.exit(1);
  });
