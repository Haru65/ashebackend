#!/usr/bin/env node

/**
 * Diagnose Frontend Timestamp Display Issue
 * Check API response vs what frontend receives
 */

require('dotenv').config();
const mongoose = require('mongoose');

const MONGODB_URI = process.env.MONGODB_URI;

mongoose.connect(MONGODB_URI, { useNewUrlParser: true, useUnifiedTopology: true })
  .then(async () => {
    try {
      const Telemetry = require('./models/telemetry');

      console.log('\n' + '='.repeat(80));
      console.log('🔍 FRONTEND TIMESTAMP DISPLAY DIAGNOSTIC');
      console.log('='.repeat(80) + '\n');

      // Get a sample record
      const record = await Telemetry.findOne().lean();

      if (!record) {
        console.log('❌ No records found');
        process.exit(1);
      }

      console.log('📊 Raw Database Record:\n');
      console.log(`  _id: ${record._id}`);
      console.log(`  timestamp (raw): ${record.timestamp}`);
      console.log(`  timestamp type: ${record.timestamp?.constructor?.name}`);
      console.log(`  timestamp toISOString(): ${record.timestamp?.toISOString?.()}`);

      // Simulate what gets sent via JSON API
      const jsonString = JSON.stringify({ timestamp: record.timestamp });
      console.log(`\n📤 What API sends (JSON serialized):`);
      console.log(`  ${jsonString}`);

      // Parse it back like frontend does
      const parsed = JSON.parse(jsonString);
      console.log(`\n📥 What Frontend receives (after JSON.parse):`);
      console.log(`  timestamp: ${parsed.timestamp}`);
      console.log(`  timestamp type: ${typeof parsed.timestamp}`);

      // Now what frontend's formatDate does
      const d = new Date(parsed.timestamp);
      console.log(`\n🔄 Frontend JavaScript Date parsing:`);
      console.log(`  new Date("${parsed.timestamp}")`);
      console.log(`  toISOString(): ${d.toISOString()}`);
      console.log(`  getHours(): ${d.getHours()}`);
      console.log(`  getMinutes(): ${d.getMinutes()}`);
      console.log(`  getSeconds(): ${d.getSeconds()}`);
      console.log(`  getTimezoneOffset(): ${d.getTimezoneOffset()} minutes`);

      // Format using frontend formatDate logic
      const year = d.getFullYear();
      const month = String(d.getMonth() + 1).padStart(2, '0');
      const day = String(d.getDate()).padStart(2, '0');
      const hours = String(d.getHours()).padStart(2, '0');
      const minutes = String(d.getMinutes()).padStart(2, '0');
      const seconds = String(d.getSeconds()).padStart(2, '0');
      const formattedOutput = `${year}/${month}/${day}  ${hours}:${minutes}:${seconds}`;

      console.log(`\n✅ Frontend displays as: ${formattedOutput}`);

      // What it should display
      console.log(`\nℹ️ EXPECTED VS ACTUAL:`);
      
      const deviceTimestamp = '2026-03-04 14:16:52'; // Example of what device sent
      const d2 = new Date(deviceTimestamp.replace(' ', 'T'));
      const year2 = d2.getFullYear();
      const month2 = String(d2.getMonth() + 1).padStart(2, '0');
      const day2 = String(d2.getDate()).padStart(2, '0');
      const hours2 = String(d2.getHours()).padStart(2, '0');
      const minutes2 = String(d2.getMinutes()).padStart(2, '0');
      const seconds2 = String(d2.getSeconds()).padStart(2, '0');
      
      console.log(`  ACTUAL (from DB): ${formattedOutput}`);
      console.log(`  EXPECTED (device sent): ${year2}/${month2}/${day2}  ${hours2}:${minutes2}:${seconds2}`);

      // Check if there's a timezone issue
      if (d.getHours() !== d2.getHours()) {
        console.log(`\n⚠️ TIMEZONE MISMATCH DETECTED!`);
        console.log(`  Browser timezone offset: ${d.getTimezoneOffset()} minutes`);
        console.log(`  This is causing the display issue`);
      } else {
        console.log(`\n✅ No timezone mismatch - displaying correctly`);
      }

      console.log('\n' + '='.repeat(80) + '\n');

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
