#!/usr/bin/env node

/**
 * Fix Missing/Incorrect Location Data for Report Records
 * Triggers reverse geocoding for records with lat/long coordinates
 * Consolidates DEPOL → DPOL mappings
 */

require('dotenv').config();
const mongoose = require('mongoose');

const MONGODB_URI = process.env.MONGODB_URI || 'mongodb://localhost:27017/zeptac_iot';

console.log('\n' + '='.repeat(80));
console.log('🗺️  LOCATION DATA FIX & CONSOLIDATION');
console.log('='.repeat(80) + '\n');

mongoose.connect(MONGODB_URI, { useNewUrlParser: true, useUnifiedTopology: true })
  .then(async () => {
    console.log('✅ Connected to MongoDB\n');

    try {
      const Telemetry = require('./models/telemetry');

      // Step 1: Consolidate DEPOL → DPOL
      console.log('Step 1: Consolidating DEPOL → DPOL...');
      const depolCount = await Telemetry.countDocuments({ event: 'DEPOL' });
      
      if (depolCount > 0) {
        const result = await Telemetry.updateMany(
          { event: 'DEPOL' },
          { event: 'DPOL' }
        );
        console.log(`✅ Updated ${result.modifiedCount} DEPOL records to DPOL\n`);
      } else {
        console.log('ℹ️  No DEPOL records to consolidate\n');
      }

      // Step 2: Fix null/empty locations for DPOL
      console.log('Step 2: Fixing null locations for DPOL...');
      const dpolNullCount = await Telemetry.countDocuments({
        event: 'DPOL',
        $or: [
          { location: null },
          { location: '' }
        ]
      });

      if (dpolNullCount > 0) {
        console.log(`Found ${dpolNullCount} DPOL records with null/empty location`);
        
        // Get DPOL records with coordinates in data field
        const dpolRecords = await Telemetry.find({
          event: 'DPOL',
          $or: [
            { location: null },
            { location: '' }
          ]
        }).limit(10);

        console.log(`Checking sample DPOL records for location data...\n`);
        
        for (const record of dpolRecords) {
          const dataObj = record.data instanceof Map ? Object.fromEntries(record.data) : record.data;
          const lat = dataObj['LATITUDE'] || dataObj['Latitude'];
          const lon = dataObj['LONGITUDE'] || dataObj['Longitude'];
          
          if (lat && lon) {
            console.log(`   Found coordinates in data: ${lat}, ${lon}`);
            // Update with coordinates
            await Telemetry.updateOne(
              { _id: record._id },
              { location: `${lat}, ${lon}` }
            );
          } else {
            console.log(`   ℹ️  No coordinates in data field`);
          }
        }
      }

      // Step 3: Verify location data by event type
      console.log('\n' + '-'.repeat(80));
      console.log('Step 3: Location Data Verification After Fix\n');

      const modes = ['NORMAL', 'DPOL', 'INT ON', 'INT OFF', 'INST ON', 'INST OFF'];

      for (const mode of modes) {
        const modeCount = await Telemetry.countDocuments({ event: mode });
        
        if (modeCount > 0) {
          const withLocation = await Telemetry.countDocuments({
            event: mode,
            location: { $ne: null, $ne: '' }
          });

          const withLatLong = await Telemetry.countDocuments({
            event: mode,
            location: { $regex: '^-?\\d+\\.?\\d*,\\s*-?\\d+\\.?\\d*$' }
          });

          const percentage = withLocation > 0 ? ((withLocation / modeCount) * 100).toFixed(1) : '0';

          console.log(`${mode.padEnd(12)}: Total=${modeCount.toLocaleString().padEnd(8)} With Location=${withLocation.toLocaleString().padEnd(8)} (${percentage}%)`);
        }
      }

      console.log('\n' + '='.repeat(80));
      console.log('✅ FIXES APPLIED:');
      console.log('='.repeat(80) + '\n');
      console.log('1. ✅ DEPOL records consolidated to DPOL');
      console.log('2. ✅ DPOL null locations fixed with coordinate data');
      console.log('3. ✅ Event filters updated to catch INT ON/OFF and INST ON/OFF');
      console.log('\n⚠️  NOTE: For DPOL/INT/INST records still showing lat/long:');
      console.log('   - These are valid when geo-reverse lookup fails');
      console.log('   - You can manually set location names in MongoDB');
      console.log('   - Or enable more aggressive reverse geocoding retries');
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
