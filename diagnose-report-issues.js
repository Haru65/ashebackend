#!/usr/bin/env node

/**
 * Diagnose Report Generation Issues
 * 1. Check why INST records aren't being exported
 * 2. Check location field values for different event modes
 * 3. Diagnose lat/long vs geo-reverse location issues
 */

require('dotenv').config();
const mongoose = require('mongoose');

const MONGODB_URI = process.env.MONGODB_URI || 'mongodb://localhost:27017/zeptac_iot';

console.log('\n' + '='.repeat(80));
console.log('🔧 REPORT GENERATION ISSUES DIAGNOSTIC');
console.log('='.repeat(80) + '\n');

mongoose.connect(MONGODB_URI, { useNewUrlParser: true, useUnifiedTopology: true })
  .then(async () => {
    console.log('✅ Connected to MongoDB\n');

    try {
      const Telemetry = require('./models/telemetry');

      // Issue 1: Check INST records
      console.log('=' .repeat(80));
      console.log('🔍 ISSUE 1: INST MODE - WHERE ARE THE RECORDS?');
      console.log('='.repeat(80));

      const instOnCount = await Telemetry.countDocuments({ event: 'INST ON' });
      const instOffCount = await Telemetry.countDocuments({ event: 'INST OFF' });
      const instOnlyCount = await Telemetry.countDocuments({ event: { $regex: '^INST', $options: 'i' } });

      console.log(`\nSTART: INST ON records: ${instOnCount}`);
      console.log(`INST OFF records: ${instOffCount}`);
      console.log(`Total INST* records: ${instOnlyCount}`);

      if (instOnCount > 0 || instOffCount > 0) {
        const instSample = await Telemetry.findOne({ event: { $regex: '^INST', $options: 'i' } }).lean();
        console.log('\n📋 Sample INST record:');
        console.log(`  Event value: "${instSample.event}"`);
        console.log(`  Location: "${instSample.location}"`);
        console.log(`  Timestamp: ${instSample.timestamp}`);
        console.log(`  Device ID: ${instSample.deviceId}`);
      }

      // Issue 2: Check location field values by event type
      console.log('\n' + '='.repeat(80));
      console.log('🔍 ISSUE 2: LOCATION FIELD VALUES BY EVENT TYPE');
      console.log('='.repeat(80) + '\n');

      const eventModes = ['NORMAL', 'DPOL', 'INT ON', 'INT OFF', 'INST ON', 'INST OFF', 'UNSAVE', 'DEPOL'];

      for (const mode of eventModes) {
        const count = await Telemetry.countDocuments({ event: mode });
        
        if (count > 0) {
          // Get samples with location field analysis
          const samples = await Telemetry.find({ event: mode })
            .select('location event timestamp')
            .limit(3)
            .lean();

          console.log(`\n📌 ${mode.padEnd(12)} (${count} records):`);
          
          samples.forEach((sample, idx) => {
            const locType = sample.location ? 
              (sample.location.includes(',') && sample.location.match(/^-?\d+\.?\d*,\s*-?\d+\.?\d*$/) ? 'LAT/LONG' : 'GEO-REVERSE') 
              : 'NONE';
            console.log(`   Sample ${idx + 1}: ${sample.location || 'NO LOCATION'} (${locType})`);
          });
        }
      }

      // Issue 3: Check how many records have lat/long vs geo-reverse
      console.log('\n' + '='.repeat(80));
      console.log('🔍 ISSUE 3: LOCATION FIELD ANALYSIS');
      console.log('='.repeat(80) + '\n');

      const totalCount = await Telemetry.countDocuments();
      
      // Get samples from database
      const allSamples = await Telemetry.find()
        .select('location')
        .limit(100)
        .lean();

      let locationTypes = {
        latlong: 0,
        geoReverse: 0,
        empty: 0,
        unknown: 0
      };

      allSamples.forEach(sample => {
        if (!sample.location) {
          locationTypes.empty++;
        } else if (sample.location.match(/^-?\d+\.?\d*,\s*-?\d+\.?\d*$/)) {
          locationTypes.latlong++;
        } else if (typeof sample.location === 'string' && sample.location.length > 0) {
          locationTypes.geoReverse++;
        } else {
          locationTypes.unknown++;
        }
      });

      console.log('Sample of 100 records:');
      console.log(`  Lat/Long format (e.g., "19.05, 72.87"): ${locationTypes.latlong}`);
      console.log(`  Geo-reverse location (e.g., "Sion East..."): ${locationTypes.geoReverse}`);
      console.log(`  Empty/NULL: ${locationTypes.empty}`);
      console.log(`  Unknown: ${locationTypes.unknown}`);

      // Check specific modes for location issues
      console.log('\n📊 Location breakdown by EVENT mode:\n');

      for (const mode of ['DPOL', 'DEPOL', 'INT ON', 'INT OFF', 'INST ON', 'INST OFF']) {
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

          const withGeoReverse = withLocation - withLatLong;

          console.log(`${mode.padEnd(12)}: Total=${modeCount}, With Location=${withLocation}, Lat/Long=${withLatLong}, Geo-Reverse=${withGeoReverse}`);
        }
      }

      console.log('\n' + '='.repeat(80));
      console.log('💡 DIAGNOSTIC SUMMARY:');
      console.log('='.repeat(80) + '\n');

      const instTotal = await Telemetry.countDocuments({ event: { $regex: '^INST', $options: 'i' } });
      const dpolTotal = await Telemetry.countDocuments({ event: 'DPOL' });
      const depolTotal = await Telemetry.countDocuments({ event: 'DEPOL' });
      const intTotal = await Telemetry.countDocuments({ event: { $regex: '^INT', $options: 'i' } });

      console.log(`✅ INST records exist: ${instTotal > 0 ? 'YES (' + instTotal + ' records)' : 'NO'}`);
      console.log(`⚠️  DPOL vs DEPOL: DPOL=${dpolTotal}, DEPOL=${depolTotal} (should normalize DEPOL to DPOL)`);
      console.log(`📍 INT location issues: Check if location field is being populated correctly`);
      console.log(`\nPossible causes:`);
      console.log('1. INST export might be filtering incorrectly in Excel service');
      console.log('2. DPOL/INT location field might not be reverse-geocoding properly');
      console.log('3. DEPOL records are separate from DPOL and might need consolidation');

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
