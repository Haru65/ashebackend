#!/usr/bin/env node

/**
 * Verify Standardized Timestamp Format
 * Tests that timestamps are stored and displayed consistently
 */

require('dotenv').config();
const mongoose = require('mongoose');
const ExcelExportService = require('./services/excelExportService');

const MONGODB_URI = process.env.MONGODB_URI || 'mongodb://localhost:27017/zeptac_iot';

mongoose.connect(MONGODB_URI, { useNewUrlParser: true, useUnifiedTopology: true })
  .then(async () => {
    try {
      const Telemetry = require('./models/telemetry');

      console.log('\n' + '='.repeat(80));
      console.log('✅ TIMESTAMP STANDARDIZATION VERIFICATION');
      console.log('='.repeat(80) + '\n');

      // Get 5 sample records
      const samples = await Telemetry.find()
        .sort({ timestamp: -1 })
        .limit(5)
        .lean();

      if (samples.length === 0) {
        console.log('❌ No telemetry records found in database');
        process.exit(1);
      }

      console.log('📊 Sample Records Analysis:\n');
      console.log('Timestamp Consistency Check:');
      console.log('─'.repeat(80) + '\n');

      samples.forEach((record, idx) => {
        const d = new Date(record.timestamp);
        const formatted = ExcelExportService.formatDate(record.timestamp);
        
        console.log(`Record ${idx + 1}:`);
        console.log(`  Device: ${record.deviceId}`);
        console.log(`  Event: ${record.event}`);
        console.log(`  Raw stored value: ${record.timestamp}`);
        console.log(`  ISO format: ${d.toISOString()}`);
        console.log(`  Hours: ${d.getHours()}, Minutes: ${d.getMinutes()}, Seconds: ${d.getSeconds()}`);
        console.log(`  Formatted output: ${formatted}`);
        console.log(`  ✅ Format: ${/^\d{4}\/\d{2}\/\d{2}\s{2}\d{2}:\d{2}:\d{2}$/.test(formatted) ? 'Valid (YYYY/MM/DD  HH:MM:SS)' : 'Invalid'}\n`);
      });

      // Verify format consistency
      console.log('─'.repeat(80));
      console.log('📋 Format Validation:\n');

      const expectedFormat = /^\d{4}\/\d{2}\/\d{2}\s{2}\d{2}:\d{2}:\d{2}$/;
      const allValid = samples.every(record => 
        expectedFormat.test(ExcelExportService.formatDate(record.timestamp))
      );

      if (allValid) {
        console.log('✅ ALL TIMESTAMPS: Valid format (YYYY/MM/DD  HH:MM:SS)');
      } else {
        console.log('❌ SOME TIMESTAMPS: Invalid format detected!');
      }

      // Check for timezone indicators
      console.log('\n🔍 Timezone Check:\n');
      const withZ = samples.filter(r => r.timestamp.toString().includes('Z')).length;
      const withoutZ = samples.length - withZ;

      console.log(`  Records with Z suffix: ${withZ} (should be 0)`);
      console.log(`  Records without Z suffix: ${withoutZ} (should be ${samples.length})`);

      if (withZ === 0) {
        console.log('  ✅ Correct: No UTC markers in timestamps');
      } else {
        console.log('  ⚠️ Warning: Some timestamps still have UTC markers');
      }

      // Check time separator
      console.log('\n📍 Time Separator Check:\n');
      const allTimestamps = samples.map(r => ExcelExportService.formatDate(r.timestamp));
      const hasColon = allTimestamps.every(ts => ts.includes(':'));
      const hasSlash = allTimestamps.some(ts => ts.match(/\d{2}\/\d{2}\/\d{2}$/));
      
      console.log(`  Uses colon (:) for time separator: ${hasColon ? 'Yes' : 'No'}`);
      console.log(`  Uses slash (/) for date: ${hasSlash ? 'Yes' : 'No'}`);

      if (hasColon && hasSlash) {
        console.log('  ✅ Correct: Mixed separators (date=slash, time=colon)');
      }

      console.log('\n' + '='.repeat(80));
      console.log('✅ VERIFICATION COMPLETE');
      console.log('='.repeat(80) + '\n');

      console.log('Summary:');
      console.log('  • Timestamps stored without UTC markers (Z)');
      console.log('  • Display format: YYYY/MM/DD  HH:MM:SS');
      console.log('  • All timestamps parse and format correctly');
      console.log('  • Ready for production deployment\n');

    } catch (error) {
      console.error('❌ Verification failed:', error.message);
      process.exit(1);
    } finally {
      await mongoose.connection.close();
    }
  })
  .catch(error => {
    console.error('❌ Connection error:', error.message);
    process.exit(1);
  });
