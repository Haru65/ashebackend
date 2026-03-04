/**
 * Location geocoding test - simplified version without dotenv
 */

// Set MongoDB URI directly (or use env var if available)
const mongoUri = process.env.MONGODB_URI || 'mongodb+srv://admin:ashecontrol@cluster0.v2hyu.mongodb.net/ashecontrol?retryWrites=true&w=majority';

const mongoose = require('mongoose');
const path = require('path');

// Load models
const Telemetry = require('./models/telemetry');

async function testLocationGeocoding() {
  try {
    console.log('\n🔍 LOCATION GEOCODING FIX VERIFICATION');
    console.log('='.repeat(80));
    console.log(`\n🔗 MongoDB URI: ${mongoUri.substring(0, 60)}...`);
    
    await mongoose.connect(mongoUri, { 
      serverSelectionTimeoutMS: 15000,
      socketTimeoutMS: 45000,
    });
    console.log('✅ Connected to MongoDB');
    
    // Get summary
    console.log('\n📊 Telemetry Summary:');
    const totalRecords = await Telemetry.countDocuments();
    console.log(`   Total records: ${totalRecords}`);
    
    // Check each event type
    const eventTypes = ['DPOL', 'INT', 'INST', 'NORMAL'];
    
    for (const eventType of eventTypes) {
      const count = await Telemetry.countDocuments({ event: eventType });
      console.log(`\n📋 ${eventType} Events: ${count} records`);
      
      if (count > 0) {
        // Get a sample record
        const sample = await Telemetry.findOne({ event: eventType })
          .sort({ timestamp: -1 })
          .lean();
        
        if (sample) {
          console.log(`   Sample record ID: ${sample._id}`);
          console.log(`   Timestamp: ${sample.timestamp}`);
          console.log(`   Location: "${sample.location}"`);
          
          // Analyze location field
          if (!sample.location || sample.location === 'N/A') {
            console.log(`   Status: ❌ No location (may be processing)`);;
          } else if (/^-?\d+\.?\d*,\s*-?\d+\.?\d*$/.test(sample.location.trim())) {
            console.log(`   Status: ❌ Still showing coordinates`);
          } else if (sample.location.toLowerCase().includes('mumbai') || sample.location.toLowerCase().includes('delhi') || sample.location.toLowerCase().includes('goa') || sample.location.toLowerCase().includes('bangalore')) {
            console.log(`   Status: ✅ Proper location name`);
          } else {
            console.log(`   Status: ✅ Geocoded (${sample.location})`);
          }
        }
      }
    }
    
    // Check last 10 records of each type
    console.log('\n' + '='.repeat(80));
    console.log('📝 Last 3 records of each event type:');
    
    for (const eventType of eventTypes) {
      const records = await Telemetry.find({ event: eventType })
        .sort({ timestamp: -1 })
        .limit(3)
        .lean();
      
      if (records.length > 0) {
        console.log(`\n${eventType}:`);
        records.forEach((rec, idx) => {
          const locStr = rec.location || 'null';
          const isCoords = /^-?\d+\.?\d*,\s*-?\d+\.?\d*$/.test(locStr.trim());
          const status = isCoords ? '❌' : '✅';
          console.log(`  [${idx + 1}] ${status} ${locStr}`);
        });
      }
    }
    
  } catch (error) {
    console.error('\n❌ Error:', error.message);
    if (error.code === 'ENOTFOUND') {
      console.error('   Network error - cannot reach MongoDB');
    }
  } finally {
    try {
      await mongoose.connection.close();
      console.log('\n✅ Database connection closed');
    } catch (e) {
      // ignore
    }
  }
}

testLocationGeocoding();
