#!/usr/bin/env node

/**
 * Test Script: O/P and U/P Values Fix
 * 
 * This script tests the fix for O/P and U/P values not persisting after server restart.
 * It verifies that:
 * 1. Values are stored correctly in the database
 * 2. Values are retrieved correctly from the database
 * 3. API response uses correct field names ("Reference OP" not "Reference OV")
 */

require('dotenv').config();
const mongoose = require('mongoose');
const Device = require('./models/Device');
const DeviceManagementService = require('./services/deviceManagementService');

const TEST_DEVICE_ID = 'test-op-up-device';

async function runTests() {
  try {
    console.log('\n🧪 === O/P and U/P Values Fix Test Suite ===\n');
    
    // Connect to database
    console.log('🔌 Connecting to MongoDB...');
    await mongoose.connect(process.env.MONGODB_URI || 'mongodb://localhost:27017/iot-platform');
    console.log('✅ Connected\n');
    
    // Create or find test device
    console.log('📝 Setting up test device...');
    let device = await Device.findOne({ deviceId: TEST_DEVICE_ID });
    
    if (!device) {
      device = new Device({
        deviceId: TEST_DEVICE_ID,
        name: 'Test Device for O/P U/P Fix',
        type: 'sensor',
        status: 'active',
        configuration: {
          deviceSettings: {}
        }
      });
    }
    
    // Test 1: Store values in database
    console.log('\n📌 Test 1: Storing O/P and U/P values in database');
    device.configuration.deviceSettings = {
      referenceOP: 1.5,
      referenceUP: 2.0,
      referenceFail: 0.3,
      electrode: 0,
      event: 0,
      shuntVoltage: 25,
      shuntCurrent: 999
    };
    
    await device.save();
    console.log('   ✅ Stored: referenceOP=1.5, referenceUP=2.0');
    
    // Test 2: Retrieve from database directly
    console.log('\n📌 Test 2: Retrieving directly from database');
    const savedDevice = await Device.findOne({ deviceId: TEST_DEVICE_ID });
    const dbSettings = savedDevice.configuration.deviceSettings;
    console.log(`   ✅ Retrieved: referenceOP=${dbSettings.referenceOP}, referenceUP=${dbSettings.referenceUP}`);
    
    // Test 3: Retrieve via DeviceManagementService (simulates API call)
    console.log('\n📌 Test 3: Retrieving via DeviceManagementService (API simulation)');
    const service = new DeviceManagementService();
    const apiResponse = await service.getDeviceSettings(TEST_DEVICE_ID);
    
    const params = apiResponse.Parameters;
    console.log(`   Retrieved from API:`);
    console.log(`     - "Reference UP": ${params['Reference UP']}`);
    console.log(`     - "Reference OP": ${params['Reference OP']}`);
    
    // Test 4: Verify field names are correct
    console.log('\n📌 Test 4: Verifying field names');
    const hasReferenceUP = 'Reference UP' in params;
    const hasReferenceOP = 'Reference OP' in params;
    const hasReferenceOV = 'Reference OV' in params;
    
    console.log(`   ✅ Has "Reference UP": ${hasReferenceUP}`);
    console.log(`   ✅ Has "Reference OP": ${hasReferenceOP}`);
    console.log(`   ✅ Does NOT have "Reference OV": ${!hasReferenceOV}`);
    
    // Test 5: Verify values match
    console.log('\n📌 Test 5: Verifying values match');
    const upMatch = String(params['Reference UP']) === '2.0' || String(params['Reference UP']) === '2';
    const opMatch = String(params['Reference OP']) === '1.5' || String(params['Reference OP']) === '1.5';
    
    console.log(`   ✅ Reference UP value matches: ${upMatch}`);
    console.log(`   ✅ Reference OP value matches: ${opMatch}`);
    
    // Summary
    console.log('\n📊 === Test Summary ===');
    const allPassed = hasReferenceUP && hasReferenceOP && !hasReferenceOV && upMatch && opMatch;
    
    if (allPassed) {
      console.log('✅ All tests PASSED! O/P and U/P values will persist after server restart.');
    } else {
      console.log('❌ Some tests FAILED! There may still be issues with persistence.');
    }
    
    // Cleanup
    console.log('\n🧹 Cleaning up test device...');
    await Device.deleteOne({ deviceId: TEST_DEVICE_ID });
    console.log('✅ Cleanup complete\n');
    
    await mongoose.connection.close();
    process.exit(allPassed ? 0 : 1);
    
  } catch (error) {
    console.error('❌ Test error:', error);
    process.exit(1);
  }
}

runTests();
