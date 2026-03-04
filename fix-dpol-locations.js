#!/usr/bin/env node

/**
 * Analyze and Fix DPOL Location Data
 * Check why DPOL records show lat/long instead of geo-reverse locations
 */

require('dotenv').config();
const mongoose = require('mongoose');

const MONGODB_URI = process.env.MONGODB_URI || 'mongodb://localhost:27017/zeptac_iot';

console.log('\n' + '='.repeat(80));
console.log('🔍 DPOL LOCATION DATA ANALYSIS & FIX');
console.log('='.repeat(80) + '\n');

mongoose.connect(MONGODB_URI, { useNewUrlParser: true, useUnifiedTopology: true })
  .then(async () => {
    console.log('✅ Connected to MongoDB\n');

    try {
      const Telemetry = require('./models/telemetry');

      // Get DPOL samples with location data
      console.log('Step 1: Analyzing DPOL location patterns...\n');

      const dpolSamples = await Telemetry.find({ event: 'DPOL' })
        .select('location _id timestamp')
        .limit(20)
        .lean();

      console.log('Sample DPOL records and their locations:\n');

      let locationPatterns = {
        latLongDecimal: 0,      // "19.05, 72.8667"
        latLongFull: 0,         // "19°03'N, 072°52'E"
        geoReverse: 0,          // "Sion East, Mumbai..."
        nullValue: 0,           // null or ""
        other: 0
      };

      dpolSamples.forEach((record, idx) => {
        let type = 'unknown';
        
        if (!record.location || record.location === '') {
          type = 'NULL/EMPTY';
          locationPatterns.nullValue++;
        } else if (record.location.match(/^-?\d+\.?\d*,\s*-?\d+\.?\d*$/)) {
          type = 'LAT/LONG DECIMAL';
          locationPatterns.latLongDecimal++;
        } else if (record.location.match(/^\d+°\d+.*[NSEW],\s*\d+°\d+.*[NSEW]/)) {
          type = 'LAT/LONG DMS';
          locationPatterns.latLongFull++;
        } else if (record.location.length > 10) {
          type = 'GEO-REVERSE';
          locationPatterns.geoReverse++;
        } else {
          type = 'OTHER';
          locationPatterns.other++;
        }

        console.log(`${(idx + 1).toString().padEnd(2)}. "${record.location}" (${type})`);
      });

      console.log('\n' + '-'.repeat(80));
      console.log('Location Pattern Summary:');
      console.log('-'.repeat(80));
      console.log(`  Decimal Lat/Long (19.05, 72.8667): ${locationPatterns.latLongDecimal}`);
      console.log(`  DMS Format (19°03'N, 072°52'E):   ${locationPatterns.latLongFull}`);
      console.log(`  Geo-Reverse Location:             ${locationPatterns.geoReverse}`);
      console.log(`  Null/Empty:                       ${locationPatterns.nullValue}`);
      console.log(`  Other:                            ${locationPatterns.other}`);

      // Step 2: Get full record data to see coordinates field
      console.log('\n' + '='.repeat(80));
      console.log('Step 2: Checking data fields for coordinate information...\n');

      const dpolDetail = await Telemetry.findOne({ event: 'DPOL' }).lean();
      if (dpolDetail && dpolDetail.data) {
        const dataObj = dpolDetail.data instanceof Map ? Object.fromEntries(dpolDetail.data) : dpolDetail.data;
        const coordFields = Object.keys(dataObj).filter(k => 
          k.match(/latitude|longitude|lat|lon|lati|longi/i)
        );

        console.log('Coordinate-related fields in DPOL data:');
        coordFields.forEach(field => {
          console.log(`  ${field}: ${dataObj[field]}`);
        });

        if (coordFields.length === 0) {
          console.log('  (No coordinate fields found in data)');
        }
      }

      // Step 3: Fix DPOL locations - try reverse geocoding for lat/long only records
      console.log('\n' + '='.repeat(80));
      console.log('Step 3: Attempting to fix DPOL locations...\n');

      if (locationPatterns.latLongDecimal > 0 && locationPatterns.geoReverse === 0) {
        console.log(`Found ${locationPatterns.latLongDecimal} DPOL records with only lat/long coordinates`);
        console.log('These need reverse geocoding to display proper location names.\n');

        // Parse a lat/long and attempt reverse geocoding
        const latLongSample = await Telemetry.findOne({ 
          event: 'DPOL',
          location: { $regex: '^-?\\d+\\.?\\d*,\\s*-?\\d+\\.?\\d*$' }
        }).lean();

        if (latLongSample && latLongSample.location) {
          const parts = latLongSample.location.split(',').map(p => parseFloat(p.trim()));
          console.log(`Sample coordinates: ${latLongSample.location}`);
          console.log(`Parsed as: latitude=${parts[0]}, longitude=${parts[1]}`);

          // Try to reverse geocode
          try {
            const axios = require('axios');
            const lat = parts[0];
            const lon = parts[1];

            console.log(`\nAttempting reverse geocoding...`);
            
            // Try OpenWeather first
            const openWeatherUrl = `https://api.openweathermap.org/geo/1.0/reverse?lat=${lat}&lon=${lon}&limit=1&appid=1234567890abc`;
            
            // Try Nominatim (free, no key needed)
            const nominatimUrl = `https://nominatim.openstreetmap.org/reverse?lat=${lat}&lon=${lon}&format=json`;
            
            console.log(`Trying Nominatim reverse geocoding...`);
            
            const response = await axios.get(nominatimUrl, {
              headers: { 'User-Agent': 'ZeptacIOT/1.0' },
              timeout: 5000
            });

            if (response.data && response.data.address) {
              const locationName = response.data.address.city || 
                                 response.data.address.town || 
                                 response.data.address.village ||
                                 response.data.display_name ||
                                 'Unknown Location';

              console.log(`✅ Reverse geocode successful: "${locationName}"`);

              // Update all DPOL records with this location pattern
              const updateCount = await Telemetry.countDocuments({
                event: 'DPOL',
                location: latLongSample.location
              });

              if (updateCount > 0) {
                await Telemetry.updateMany(
                  {
                    event: 'DPOL',
                    location: latLongSample.location
                  },
                  { location: locationName }
                );

                console.log(`Updated ${updateCount} DPOL records from "${latLongSample.location}" to "${locationName}"`);
              }
            }
          } catch (geocodeError) {
            console.log(`⚠️  Reverse geocoding failed: ${geocodeError.message}`);
            console.log(`   DPOL records will display coordinates until geocoding succeeds`);
          }
        }
      }

      // Verify results
      console.log('\n' + '='.repeat(80));
      console.log('Final DPOL Location Status:\n');

      const finalSamples = await Telemetry.find({ event: 'DPOL' })
        .select('location')
        .limit(10)
        .lean();

      finalSamples.forEach((record, idx) => {
        console.log(`${(idx + 1).toString().padEnd(2)}. "${record.location}"`);
      });

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
