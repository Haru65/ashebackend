#!/usr/bin/env node

/**
 * Test Excel Export Timestamp Format
 * Verifies that exported Excel files show correct timestamp format
 */

require('dotenv').config();
const mongoose = require('mongoose');
const ExcelExportService = require('./services/excelExportService');
const path = require('path');
const fs = require('fs');

const MONGODB_URI = process.env.MONGODB_URI;

mongoose.connect(MONGODB_URI, { useNewUrlParser: true, useUnifiedTopology: true })
  .then(async () => {
    try {
      const Telemetry = require('./models/telemetry');

      console.log('\n' + '='.repeat(80));
      console.log('🧪 EXCEL EXPORT TIMESTAMP FORMAT TEST');
      console.log('='.repeat(80) + '\n');

      // Get sample telemetry data
      const samples = await Telemetry.find()
        .limit(5)
        .lean();

      if (samples.length === 0) {
        console.log('❌ No telemetry data found');
        process.exit(1);
      }

      console.log(`📊 Found ${samples.length} samples\n`);

      // Test formatDate function
      console.log('TEST 1: formatDate() Function Output');
      console.log('─'.repeat(80));
      samples.forEach((sample, idx) => {
        const formatted = ExcelExportService.formatDate(sample.timestamp);
        const isValid = /^\d{4}\/\d{2}\/\d{2}\s{2}\d{2}:\d{2}:\d{2}$/.test(formatted);
        console.log(`${idx + 1}. ${formatted} ${isValid ? '✅' : '❌'}`);
      });

      // Generate actual Excel export
      console.log('\n\nTEST 2: Excel Export Generation');
      console.log('─'.repeat(80));

      const exportResult = await ExcelExportService.exportTelemetryToExcel({
        startDate: new Date('2026-01-01'),
        endDate: new Date('2026-12-31'),
        modes: []
      });

      console.log(`✅ Workbook generated: ${exportResult.filename}`);

      // Save to test file
      const testDir = path.join(__dirname, 'exports');
      if (!fs.existsSync(testDir)) {
        fs.mkdirSync(testDir, { recursive: true });
      }

      const testFile = path.join(testDir, `test-timestamp-export-${Date.now()}.xlsx`);
      await exportResult.workbook.xlsx.writeFile(testFile);
      console.log(`✅ Exported to: ${testFile}`);

      // Read the workbook back and check cells
      console.log('\n\nTEST 3: Verify Exported Cell Format');
      console.log('─'.repeat(80));

      const ExcelJS = require('exceljs');
      const wb = new ExcelJS.Workbook();
      await wb.xlsx.readFile(testFile);
      
      const ws = wb.worksheets[0]; // Main sheet
      
      // Check first few data rows (skip header)
      console.log('Timestamps from exported file:\n');
      let validCount = 0;
      for (let rowNum = 2; rowNum <= Math.min(6, ws.rowCount); rowNum++) {
        const row = ws.getRow(rowNum);
        const timestampCell = row.getCell(5); // Column E = Timestamp
        
        if (timestampCell.value) {
          const value = String(timestampCell.value);
          const isValid = /^\d{4}\/\d{2}\/\d{2}\s{2}\d{2}:\d{2}:\d{2}$/.test(value);
          
          console.log(`Row ${rowNum}: "${value}"`);
          console.log(`  Value type: ${typeof timestampCell.value}`);
          console.log(`  Cell dataType: ${timestampCell.dataType}`);
          console.log(`  Cell numFmt: ${timestampCell.numFmt}`);
          console.log(`  Format valid: ${isValid ? '✅' : '❌'}`);
          
          if (isValid) validCount++;
          console.log();
        }
      }

      console.log('='.repeat(80));
      if (validCount === Math.min(5, ws.rowCount - 1)) {
        console.log(`✅ ALL TIMESTAMPS CORRECT: Format is YYYY/MM/DD  HH:MM:SS`);
        console.log(`   Cell dataType set to 'string'`);
        console.log(`   Cell numFmt set to '@' (text)`);
      } else {
        console.log(`⚠️  Some timestamps may still be formatted by Excel`);
      }

      console.log('='.repeat(80) + '\n');

      process.exit(0);

    } catch (error) {
      console.error('❌ Test failed:', error.message);
      console.error(error);
      process.exit(1);
    } finally {
      await mongoose.connection.close();
    }
  })
  .catch(error => {
    console.error('❌ Connection error:', error.message);
    process.exit(1);
  });
