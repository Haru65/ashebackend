#!/usr/bin/env node

/**
 * COMPREHENSIVE Location Fix - Replace ALL problematic locations
 */

require('dotenv').config();
const mongoose = require('mongoose');

const MONGODB_URI = process.env.MONGODB_URI || 'mongodb://localhost:27017/zeptac_iot';

mongoose.connect(MONGODB_URI, { useNewUrlParser: true, useUnifiedTopology: true })
  .then(async () => {
    try {
      const Telemetry = require('./models/telemetry');

      console.log('\n' + '='.repeat(80));
      console.log('🔧 COMPREHENSIVE LOCATION FIX');
      console.log('='.repeat(80) + '\n');

      const DEFAULT_LOCATION = 'Mumbai, India';

      // 1. Fix "null, null" strings
      console.log('Fixing "null, null" strings...');
      const nullNullResult = await Telemetry.updateMany(
        { location: 'null, null' },
        { $set: { location: DEFAULT_LOCATION } }
      );
      console.log(`✅ Updated ${nullNullResult.modifiedCount} records with "null, null"\n`);

      // 2. Fix "undefined" strings
      console.log('Fixing "undefined" strings...');
      const undefinedResult = await Telemetry.updateMany(
        { location: 'undefined' },
        { $set: { location: DEFAULT_LOCATION } }
      );
      console.log(`✅ Updated ${undefinedResult.modifiedCount} records with "undefined"\n`);

      // 3. Fix empty or null location fields
      console.log('Fixing empty/null location fields...');
      const emptyResult = await Telemetry.updateMany(
        { $or: [
          { location: null },
          { location: '' },
          { location: { $exists: false } }
        ] },
        { $set: { location: DEFAULT_LOCATION } }
      );
      console.log(`✅ Updated ${emptyResult.modifiedCount} records with empty/null locations\n`);

      // 4. Verify
      console.log('Verifying fix...\n');
      const stats = await Telemetry.aggregate([
        {
          $group: {
            _id: '$location',
            count: { $sum: 1 }
          }
        },
        { $sort: { count: -1 } },
        { $limit: 10 }
      ]);

      console.log('📊 Top 10 Location Values:\n');
      stats.forEach((stat, idx) => {
        console.log(`   ${(idx + 1).toString().padStart(2)}. "${stat._id}" : ${stat.count.toString().padStart(6)} records`);
      });

      // Final count verification
      const nullNullCount = await Telemetry.countDocuments({ location: 'null, null' });
      const undefinedCount = await Telemetry.countDocuments({ location: 'undefined' });
      const validLocations = await Telemetry.countDocuments({ location: { $ne: null, $ne: '' } });

      console.log('\n' + '='.repeat(80));
      console.log('Final Status:');
      console.log(`  "null, null" remaining: ${nullNullCount}`);
      console.log(`  "undefined" remaining: ${undefinedCount}`);
      console.log(`  Valid locations: ${validLocations}`);
      console.log(`\n✅ Fix Complete!`);
      console.log('='.repeat(80) + '\n');

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
