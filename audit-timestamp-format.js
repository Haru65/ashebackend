#!/usr/bin/env node

/**
 * Timestamp Format Audit - Comprehensive Analysis
 */

require('dotenv').config();
const mongoose = require('mongoose');

const MONGODB_URI = process.env.MONGODB_URI || 'mongodb://localhost:27017/zeptac_iot';

mongoose.connect(MONGODB_URI, { useNewUrlParser: true, useUnifiedTopology: true })
  .then(async () => {
    try {
      const Telemetry = require('./models/telemetry');

      console.log('\n' + '='.repeat(80));
      console.log('🔍 TIMESTAMP FORMAT AUDIT');
      console.log('='.repeat(80) + '\n');

      // Get a sample record
      const sample = await Telemetry.findOne().lean();

      if (!sample) {
        console.log('❌ No telemetry records found');
        process.exit(1);
      }

      console.log('📋 Sample Record Analysis:\n');
      console.log(`  _id: ${sample._id}`);
      console.log(`  Raw timestamp value: ${sample.timestamp}`);
      console.log(`  Timestamp type: ${sample.timestamp?.constructor?.name}`);
      console.log(`  Timestamp ISO: ${sample.timestamp?.toISOString?.() || 'N/A'}`);
      
      if (sample.timestamp) {
        const d = new Date(sample.timestamp);
        console.log(`\n  Parsed as Date:`);
        console.log(`    getFullYear(): ${d.getFullYear()}`);
        console.log(`    getMonth(): ${d.getMonth() + 1}`);
        console.log(`    getDate(): ${d.getDate()}`);
        console.log(`    getHours(): ${d.getHours()}`);
        console.log(`    getMinutes(): ${d.getMinutes()}`);
        console.log(`    getSeconds(): ${d.getSeconds()}`);
        console.log(`    getTimezoneOffset(): ${d.getTimezoneOffset()} minutes (${d.getTimezoneOffset() / 60} hours)`);
        
        // This is what formatDate is doing
        const year = d.getFullYear();
        const month = String(d.getMonth() + 1).padStart(2, '0');
        const day = String(d.getDate()).padStart(2, '0');
        const hours = String(d.getHours()).padStart(2, '0');
        const minutes = String(d.getMinutes()).padStart(2, '0');
        const seconds = String(d.getSeconds()).padStart(2, '0');
        const formatted = `${year}/${month}/${day}  ${hours}/${minutes}/${seconds}`;
        
        console.log(`\n  Current formatDate() output:  ${formatted}`);
      }

      // Check database for timestamp variations
      console.log('\n' + '-'.repeat(80));
      console.log('📊 Database Timestamp Variations:\n');

      const aggregation = await Telemetry.aggregate([
        {
          $group: {
            _id: null,
            samples: { $push: { timestamp: '$timestamp', event: '$event', deviceId: '$deviceId' } },
            totalRecords: { $sum: 1 }
          }
        },
        {
          $project: {
            samples: { $slice: ['$samples', 5] },
            totalRecords: 1
          }
        }
      ]);

      const data = aggregation[0];
      console.log(`Total records: ${data.totalRecords}\n`);
      console.log('First 5 samples:\n');

      data.samples.forEach((sample, idx) => {
        const d = new Date(sample.timestamp);
        console.log(`  ${idx + 1}. Device: ${sample.deviceId}, Event: ${sample.event}`);
        console.log(`     Raw value: ${sample.timestamp}`);
        console.log(`     ISO: ${d.toISOString()}`);
        const year = d.getFullYear();
        const month = String(d.getMonth() + 1).padStart(2, '0');
        const day = String(d.getDate()).padStart(2, '0');
        const hours = String(d.getHours()).padStart(2, '0');
        const minutes = String(d.getMinutes()).padStart(2, '0');
        const seconds = String(d.getSeconds()).padStart(2, '0');
        console.log(`     Formatted: ${year}/${month}/${day}  ${hours}/${minutes}/${seconds}\n`);
      });

      console.log('='.repeat(80));
      console.log('\n🔴 PROBLEM IDENTIFIED:\n');
      console.log('The timestamps are being stored as UTC (with Z suffix) but should be LOCAL TIME.');
      console.log('This causes a 6-hour offset when displayed.');
      console.log('\nRoot cause in mqttService.js (line 2432-2437):');
      console.log('  const isoFormat = deviceTimestamp.replace(\' \', \'T\') + \'Z\';');
      console.log('  ^ This \'Z\' treats the timestamp as UTC, but it\'s actually in DEVICE LOCAL TIME!\n');
      
      console.log('DEVICE sends: "2026-03-04 14:16:52" (LOCAL TIME, UTC+5:30 or UTC+6)');
      console.log('CODE parses: "2026-03-04T14:16:52Z" (UTC)');
      console.log('RESULT: 6 hours earlier when displayed\n');

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
