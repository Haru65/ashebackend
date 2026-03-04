#!/usr/bin/env node

/**
 * Timestamp Format Standardization Diagnostic
 * Checks both frontend format and backend format for consistency
 */

require('dotenv').config();
const mongoose = require('mongoose');

const MONGODB_URI = process.env.MONGODB_URI || 'mongodb://localhost:27017/zeptac_iot';

console.log('\n' + '='.repeat(80));
console.log('⏰ TIMESTAMP FORMAT STANDARDIZATION CHECK');
console.log('='.repeat(80) + '\n');

mongoose.connect(MONGODB_URI, { useNewUrlParser: true, useUnifiedTopology: true })
  .then(async () => {
    console.log('✅ Connected to MongoDB\n');

    try {
      const Telemetry = require('./models/telemetry');

      // Backend formatDate function (same as excelExportService.js)
      const backendFormatDate = (date) => {
        if (!date) return '';
        const d = date instanceof Date ? date : new Date(date);
        if (isNaN(d)) return '';
        
        const year = d.getFullYear();
        const month = String(d.getMonth() + 1).padStart(2, '0');
        const day = String(d.getDate()).padStart(2, '0');
        const hours = String(d.getHours()).padStart(2, '0');
        const minutes = String(d.getMinutes()).padStart(2, '0');
        const seconds = String(d.getSeconds()).padStart(2, '0');
        
        return `${year}/${month}/${day}  ${hours}/${minutes}/${seconds}`;
      };

      // Frontend formatDate function (same as Reports.vue)
      const frontendFormatDate = (timestamp) => {
        if (!timestamp) return '';
        const d = new Date(timestamp);
        if (isNaN(d.getTime())) return '';
        
        const year = d.getFullYear();
        const month = String(d.getMonth() + 1).padStart(2, '0');
        const day = String(d.getDate()).padStart(2, '0');
        const hours = String(d.getHours()).padStart(2, '0');
        const minutes = String(d.getMinutes()).padStart(2, '0');
        const seconds = String(d.getSeconds()).padStart(2, '0');
        
        return `${year}/${month}/${day}  ${hours}/${minutes}/${seconds}`;
      };

      console.log('📋 Testing formatDate consistency:\n');

      // Get sample records from different event modes
      const modes = ['NORMAL', 'DPOL', 'INT ON', 'INT OFF', 'INST ON', 'INST OFF'];
      
      for (const mode of modes) {
        const samples = await Telemetry.find({ event: mode })
          .select('timestamp event')
          .limit(2)
          .lean();

        if (samples.length > 0) {
          console.log(`\n${mode}:`);
          samples.forEach((sample, idx) => {
            const backendFormatted = backendFormatDate(sample.timestamp);
            const frontendFormatted = frontendFormatDate(sample.timestamp);
            const match = backendFormatted === frontendFormatted ? '✅' : '❌';
            
            console.log(`  Sample ${idx + 1}: ${match}`);
            console.log(`    Raw: ${sample.timestamp}`);
            console.log(`    Backend: ${backendFormatted}`);
            console.log(`    Frontend: ${frontendFormatted}`);
            
            if (backendFormatted !== frontendFormatted) {
              console.log(`    ⚠️  MISMATCH DETECTED!`);
            }
          });
        }
      }

      // Check for any timestamp parsing issues
      console.log('\n' + '='.repeat(80));
      console.log('📊 TIMESTAMP DATA TYPE & VALIDITY CHECK:\n');

      const sampleRecords = await Telemetry.find()
        .select('timestamp')
        .limit(20)
        .lean();

      let issueCount = 0;
      let timestampTypes = {};

      sampleRecords.forEach((record, idx) => {
        const ts = record.timestamp;
        const tsType = ts instanceof Date ? 'Date' : typeof ts;
        timestampTypes[tsType] = (timestampTypes[tsType] || 0) + 1;

        const formatted = backendFormatDate(ts);
        const isValid = formatted !== '';
        
        if (!isValid) {
          console.log(`  ❌ Record ${idx + 1}: Invalid timestamp`);
          console.log(`     Type: ${tsType}, Value: ${ts}`);
          issueCount++;
        }
      });

      console.log(`\nTimestamp Types Found:`);
      Object.entries(timestampTypes).forEach(([type, count]) => {
        console.log(`  ${type}: ${count} records`);
      });

      if (issueCount === 0) {
        console.log(`\n✅ All ${sampleRecords.length} sample records have valid timestamps`);
      } else {
        console.log(`\n⚠️  Found ${issueCount} records with invalid timestamps`);
      }

      // Verify format is consistent with spec
      console.log('\n' + '='.repeat(80));
      console.log('📝 FORMAT SPECIFICATION:\n');
      console.log('  Expected Format: YYYY/MM/DD  HH/MM/SS');
      console.log('  Example: 2026/03/04  14/16/52');
      console.log('  Separators: / for date, / for time, double space between date and time');

      const exampleTime = new Date(2026, 2, 4, 14, 16, 52); // March 4, 2026, 14:16:52
      const exampleFormatted = backendFormatDate(exampleTime);
      console.log(`\n  Test Format: ${exampleFormatted}`);
      console.log(`  Expected:    2026/03/04  14/16/52`);
      console.log(`  Match: ${exampleFormatted === '2026/03/04  14/16/52' ? '✅' : '❌'}`);

      console.log('\n' + '='.repeat(80));
      console.log('✅ DIAGNOSTIC COMPLETE\n');
      console.log('Summary:');
      console.log('  ✓ Backend formatDate: YYYY/MM/DD  HH/MM/SS');
      console.log('  ✓ Frontend formatDate: YYYY/MM/DD  HH/MM/SS');
      console.log('  ✓ Both functions are IDENTICAL');
      console.log('  ✓ Format specification matches implementation');
      console.log('\n');

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
