#!/usr/bin/env node

/**
 * Verification Script: O/P and U/P Values Persistence
 * 
 * This script verifies that O/P (Reference OP) and U/P (Reference UP) values
 * are properly stored and retrieved from the database after server restart.
 * 
 * Usage: node verify-op-up-persistence.js <deviceId>
 */

require('dotenv').config();
const mongoose = require('mongoose');
const Device = require('./models/Device');

const deviceId = process.argv[2] || '123';

async function verifyPersistence() {
  try {
    console.log('\n📋 === O/P and U/P Persistence Verification ===\n');
    
    // Connect to database
    console.log('🔌 Connecting to MongoDB...');
    await mongoose.connect(process.env.MONGODB_URI || 'mongodb://localhost:27017/iot-platform');
    console.log('✅ Connected to MongoDB\n');
    
    // Find device
    console.log(`🔍 Looking for device: ${deviceId}`);
    const device = await Device.findOne({ deviceId });
    
    if (!device) {
      console.log(`❌ Device ${deviceId} not found in database`);
      process.exit(1);
    }
    
    console.log(`✅ Found device: ${device.name}\n`);
    
    // Check stored values
    const settings = device.configuration?.deviceSettings || {};
    
    console.log('📊 === Stored Database Values (camelCase) ===');
    console.log(`   referenceOP: ${settings.referenceOP} (type: ${typeof settings.referenceOP})`);
    console.log(`   referenceUP: ${settings.referenceUP} (type: ${typeof settings.referenceUP})`);
    console.log(`   referenceFail: ${settings.referenceFail} (type: ${typeof settings.referenceFail})\n`);
    
    // Simulate what getDeviceSettings() returns
    const deviceManagementService = require('./services/deviceManagementService');
    const settingsResponse = await deviceManagementService.getDeviceSettings(deviceId);
    
    console.log('📊 === API Response Format (Title Case) ===');
    const params = settingsResponse.Parameters || {};
    console.log(`   "Reference UP": ${params['Reference UP']} (type: ${typeof params['Reference UP']})`);
    console.log(`   "Reference OP": ${params['Reference OP']} (type: ${typeof params['Reference OP']})`);
    console.log(`   "Reference Fail": ${params['Reference Fail']} (type: ${typeof params['Reference Fail']})\n`);
    
    // Verify consistency
    console.log('✅ === Verification Results ===');
    
    const checks = [
      {
        name: 'Reference UP exists in API response',
        pass: params['Reference UP'] !== undefined
      },
      {
        name: 'Reference OP exists in API response',
        pass: params['Reference OP'] !== undefined
      },
      {
        name: 'Reference UP matches database value',
        pass: String(params['Reference UP']) === String(settings.referenceUP)
      },
      {
        name: 'Reference OP matches database value',
        pass: String(params['Reference OP']) === String(settings.referenceOP)
      },
      {
        name: 'No "Reference OV" in API response (should use "Reference OP")',
        pass: params['Reference OV'] === undefined
      }
    ];
    
    let allPassed = true;
    checks.forEach(check => {
      const status = check.pass ? '✅' : '❌';
      console.log(`   ${status} ${check.name}`);
      if (!check.pass) allPassed = false;
    });
    
    console.log('\n' + (allPassed ? '✅ All checks passed!' : '❌ Some checks failed!'));
    
    await mongoose.connection.close();
    process.exit(allPassed ? 0 : 1);
    
  } catch (error) {
    console.error('❌ Error during verification:', error);
    process.exit(1);
  }
}

verifyPersistence();
