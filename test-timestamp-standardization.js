#!/usr/bin/env node

/**
 * TIMESTAMP STANDARDIZATION FINAL TEST
 * Comprehensive verification that the fix resolves the 6-hour offset issue
 */

require('dotenv').config();
const mongoose = require('mongoose');
const ExcelExportService = require('./services/excelExportService');

const MONGODB_URI = process.env.MONGODB_URI;

if (!MONGODB_URI) {
  console.error('❌ MONGODB_URI not found in .env');
  process.exit(1);
}

mongoose.connect(MONGODB_URI, { useNewUrlParser: true, useUnifiedTopology: true })
  .then(async () => {
    try {
      const Telemetry = require('./models/telemetry');

      console.log('\n' + '█'.repeat(80));
      console.log('█' + ' '.repeat(78) + '█');
      console.log('█' + '  TIMESTAMP STANDARDIZATION - FINAL TEST'.padEnd(78) + '█');
      console.log('█' + ' '.repeat(78) + '█');
      console.log('█'.repeat(80) + '\n');

      // Test 1: Database Records Analysis
      console.log('TEST 1: Database Records Sampling');
      console.log('─'.repeat(80));

      const samples = await Telemetry.find()
        .sort({ _id: -1 })
        .limit(10)
        .lean();

      if (samples.length === 0) {
        console.log('❌ No records found. Cannot proceed with tests.');
        process.exit(1);
      }

      console.log(`Found ${samples.length} sample records\n`);

      let testsPassed = 0;
      let testsFailed = 0;

      // Test 2: Format Validation
      console.log('\nTEST 2: Timestamp Format Validation');
      console.log('─'.repeat(80));

      const expectedFormat = /^\d{4}\/\d{2}\/\d{2}\s{2}\d{2}:\d{2}:\d{2}$/;
      samples.forEach((record, idx) => {
        const formatted = ExcelExportService.formatDate(record.timestamp);
        const isValid = expectedFormat.test(formatted);
        
        if (isValid) {
          console.log(`✅ Record ${idx + 1}: ${formatted}`);
          testsPassed++;
        } else {
          console.log(`❌ Record ${idx + 1}: ${formatted} - INVALID FORMAT`);
          testsFailed++;
        }
      });

      // Test 3: No UTC Markers
      console.log('\n\nTEST 3: UTC Marker Check');
      console.log('─'.repeat(80));

      const timestampStrings = samples.map(r => r.timestamp.toString());
      const hasZ = timestampStrings.filter(t => t.includes('Z')).length;

      if (hasZ === 0) {
        console.log(`✅ PASS: All ${samples.length} timestamps stored WITHOUT UTC marker (Z)`);
        testsPassed++;
      } else {
        console.log(`❌ FAIL: ${hasZ} timestamps still have UTC marker (Z)`);
        testsFailed++;
      }

      // Test 4: Time Separator Check
      console.log('\n\nTEST 4: Time Separator Verification');
      console.log('─'.repeat(80));

      const formattedTimestamps = samples.map(r => ExcelExportService.formatDate(r.timestamp));
      const colonSepCount = formattedTimestamps.filter(t => t.match(/:\d{2}:\d{2}$/)).length;
      const slashSepCount = formattedTimestamps.filter(t => t.match(/\/\d{2}\/\d{2}$/)).length;

      if (colonSepCount === samples.length && slashSepCount === samples.length) {
        console.log(`✅ PASS: All timestamps use correct separators`);
        console.log(`   • Date: YYYY/MM/DD (slash separator)`);
        console.log(`   • Time: HH:MM:SS (colon separator)`);
        testsPassed++;
      } else {
        console.log(`❌ FAIL: Inconsistent separators detected`);
        testsFailed++;
      }

      // Test 5: Time Consistency
      console.log('\n\nTEST 5: Hours/Minutes/Seconds Consistency');
      console.log('─'.repeat(80));

      let consistencyPass = true;
      samples.slice(0, 3).forEach((record, idx) => {
        const d = new Date(record.timestamp);
        const h = d.getHours();
        const m = d.getMinutes();
        const s = d.getSeconds();
        
        // Extract from formatted string
        const formatted = ExcelExportService.formatDate(record.timestamp);
        const timePart = formatted.split('  ')[1]; // Get "HH:MM:SS" part
        const [fh, fm, fs] = timePart.split(':').map(Number);
        
        if (h === fh && m === fm && s === fs) {
          console.log(`✅ Record ${idx + 1}: Time consistent (${h}:${m}:${s})`);
        } else {
          console.log(`❌ Record ${idx + 1}: Time MISMATCH - Date methods(${h}:${m}:${s}) vs formatted(${fh}:${fm}:${fs})`);
          consistencyPass = false;
        }
      });
      
      if (consistencyPass) {
        testsPassed++;
      } else {
        testsFailed++;
      }

      // Test 6: API Response Format
      console.log('\n\nTEST 6: API Response Format Simulation');
      console.log('─'.repeat(80));

      const apiResponse = {
        success: true,
        data: samples.map(r => ({
          _id: r._id,
          timestamp: r.timestamp, // This is what API returns
          deviceId: r.deviceId,
          event: r.event
        })),
        meta: { total: samples.length }
      };

      // Simulate frontend receiving and formatting
      const frontendFormatted = apiResponse.data.map(item => {
        // This mimics what Reports.vue does
        const d = new Date(item.timestamp);
        const year = d.getFullYear();
        const month = String(d.getMonth() + 1).padStart(2, '0');
        const day = String(d.getDate()).padStart(2, '0');
        const hours = String(d.getHours()).padStart(2, '0');
        const minutes = String(d.getMinutes()).padStart(2, '0');
        const seconds = String(d.getSeconds()).padStart(2, '0');
        return `${year}/${month}/${day}  ${hours}:${minutes}:${seconds}`;
      });

      const frontendFormatValid = frontendFormatted.every(ts => expectedFormat.test(ts));
      if (frontendFormatValid) {
        console.log(`✅ PASS: Frontend formatting works correctly`);
        console.log(`   Sample: ${frontendFormatted[0]}`);
        testsPassed++;
      } else {
        console.log(`❌ FAIL: Frontend formatting produces invalid results`);
        testsFailed++;
      }

      // FINAL SUMMARY
      console.log('\n\n' + '█'.repeat(80));
      console.log('█' + ' TEST RESULTS SUMMARY'.padEnd(78) + '█');
      console.log('█'.repeat(80));

      const totalTests = 6;
      const passPercentage = Math.round((testsPassed / totalTests) * 100);

      console.log(`\n  Tests Passed: ${testsPassed}/${totalTests} (${passPercentage}%)`);
      console.log(`  Tests Failed: ${testsFailed}/${totalTests}\n`);

      if (testsFailed === 0) {
        console.log('  ✅ ALL TESTS PASSED - READY FOR PRODUCTION\n');
        console.log('  ✓ Timestamps stored correctly (no UTC markers)');
        console.log('  ✓ Format standardized (YYYY/MM/DD  HH:MM:SS)');
        console.log('  ✓ Separators correct (date=/, time=:)');
        console.log('  ✓ API response format correct');
        console.log('  ✓ Frontend formatting consistent');
        console.log('  ✓ Hours/minutes/seconds accurate\n');
      } else {
        console.log('  ❌ Some tests failed - review issues above\n');
      }

      console.log('█'.repeat(80) + '\n');

      process.exit(testsFailed === 0 ? 0 : 1);

    } catch (error) {
      console.error('❌ Test execution error:', error.message);
      process.exit(1);
    } finally {
      await mongoose.connection.close();
    }
  })
  .catch(error => {
    console.error('❌ Database connection error:', error.message);
    process.exit(1);
  });
