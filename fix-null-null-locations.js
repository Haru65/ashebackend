#!/usr/bin/env node

/**
 * Fix DPOL Location - Replace "null, null" with proper location
 * DPOL records store literal "null, null" string instead of coordinates
 */

require('dotenv').config();
const mongoose = require('mongoose');

const MONGODB_URI = process.env.MONGODB_URI || 'mongodb://localhost:27017/zeptac_iot';

console.log('\n' + '='.repeat(80));
console.log('🗺️  FIXING DPOL "null, null" LOCATIONS');
console.log('='.repeat(80) + '\n');

mongoose.connect(MONGODB_URI, { useNewUrlParser: true, useUnifiedTopology: true })
  .then(async () => {
    console.log('✅ Connected to MongoDB\n');

    try {
      const Telemetry = require('./models/telemetry');

      // Step 1: Count records with "null, null"
      const nullLocCount = await Telemetry.countDocuments({ 
        event: 'DPOL',
        location: 'null, null'
      });

      console.log(`Found ${nullLocCount} DPOL records with "null, null" location\n`);

      if (nullLocCount === 0) {
        console.log('No DPOL records with "null, null" location found!');
        process.exit(0);
      }

      // Step 2: Get a sample to check device info
      const sampleDPOL = await Telemetry.findOne({ 
        event: 'DPOL',
        location: 'null, null'
      }).lean();

      console.log('Sample DPOL record analysis:');
      console.log(`  Device ID: ${sampleDPOL.deviceId}`);
      console.log(`  Timestamp: ${sampleDPOL.timestamp}`);
      
      // Check if this device has records with proper locations
      const deviceWithLocation = await Telemetry.findOne({ 
        deviceId: sampleDPOL.deviceId,
        location: { $ne: 'null, null', $ne: null, $ne: '' }
      }).lean();

      let fixLocation = 'Mumbai, India'; // Default

      if (deviceWithLocation && deviceWithLocation.location && deviceWithLocation.location !== 'null, null') {
        fixLocation = deviceWithLocation.location;
        console.log(`  Found location from same device: "${fixLocation}"`);
      } else {
        console.log(`  No other location found for device, using default: "${fixLocation}"`);
      }

      // Step 3: Update all DPOL records with "null, null" to proper location
      console.log(`\nUpdating ${nullLocCount} DPOL records...`);
      
      const result = await Telemetry.updateMany(
        { 
          event: 'DPOL',
          location: 'null, null'
        },
        { 
          location: fixLocation
        }
      );

      console.log(`✅ Updated ${result.modifiedCount} records`);

      // Step 4: Verify the fix
      console.log('\nVerifying fix...');
      
      const updatedSamples = await Telemetry.find({ event: 'DPOL' })
        .select('location _id')
        .limit(10)
        .lean();

      console.log(`Sample of updated DPOL records:\n`);
      updatedSamples.forEach((record, idx) => {
        console.log(`  ${(idx + 1).toString().padEnd(2)}. "${record.location}"`);
      });

      // Step 5: Verify for INT records too
      console.log('\n' + '-'.repeat(80));
      console.log('Checking INT records for same issue...\n');

      const intNullCount = await Telemetry.countDocuments({
        event: { $regex: '^INT', $options: 'i' },
        location: 'null, null'
      });

      if (intNullCount > 0) {
        console.log(`Found ${intNullCount} INT records with "null, null" location`);
        
        const intResult = await Telemetry.updateMany(
          {
            event: { $regex: '^INT', $options: 'i' },
            location: 'null, null'
          },
          { location: fixLocation }
        );

        console.log(`✅ Updated ${intResult.modifiedCount} INT records`);
      } else {
        console.log(`✅ No INT records with "null, null" location`);
      }

      // Step 6: Verify for INST records too
      console.log('\n' + '-'.repeat(80));
      console.log('Checking INST records for same issue...\n');

      const instNullCount = await Telemetry.countDocuments({
        event: { $regex: '^INST', $options: 'i' },
        location: 'null, null'
      });

      if (instNullCount > 0) {
        console.log(`Found ${instNullCount} INST records with "null, null" location`);
        
        const instResult = await Telemetry.updateMany(
          {
            event: { $regex: '^INST', $options: 'i' },
            location: 'null, null'
          },
          { location: fixLocation }
        );

        console.log(`✅ Updated ${instResult.modifiedCount} INST records`);
      } else {
        console.log(`✅ No INST records with "null, null" location`);
      }

      console.log('\n' + '='.repeat(80));
      console.log('✅ FIX COMPLETE!');
      console.log('='.repeat(80) + '\n');

      console.log(`All "null, null" locations replaced with: "${fixLocation}"\n`);

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
