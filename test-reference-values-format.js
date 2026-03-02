#!/usr/bin/env node

/**
 * Test Script: Reference Values Format Fix
 * 
 * Verifies that Reference Fail, Reference UP, and Reference OP values
 * are stored in the correct decimal format (e.g., "0.60") not device format (e.g., "060" or "6000")
 */

require('dotenv').config();
const mongoose = require('mongoose');
const Device = require('./models/Device');

const TEST_DEVICE_ID = 'test-ref-format-device';

async function runTests() {
  try {
    console.log('\n🧪 === Reference Values Format Test Suite ===\n');
    
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
        name: 'Test Device for Reference Format',
        type: 'sensor',
        status: 'active',
        configuration: {
          deviceSettings: {}
        }
      });
    }
    
    // Test 1: Store decimal values
    console.log('\n📌 Test 1: Storing decimal format values');
    device.configuration.deviceSettings = {
      referenceFail: "0.30",
      referenceUP: "0.60",
      referenceOP: "0.80",
      electrode: 0,
      event: 0,
      shuntVoltage: "025",
      shuntCurrent: "999"
    };
    
    await device.save();
    console.log('   ✅ Stored: referenceFail="0.30", referenceUP="0.60", referenceOP="0.80"');
    
    // Test 2: Verify stored values
    console.log('\n📌 Test 2: Verifying stored values');
    const savedDevice = await Device.findOne({ deviceId: TEST_DEVICE_ID });
    const settings = savedDevice.configuration.deviceSettings;
    
    console.log(`   referenceFail: "${settings.referenceFail}" (type: ${typeof settings.referenceFail})`);
    console.log(`   referenceUP: "${settings.referenceUP}" (type: ${typeof settings.referenceUP})`);
    console.log(`   referenceOP: "${settings.referenceOP}" (type: ${typeof settings.referenceOP})`);
    
    // Test 3: Check format is correct
    console.log('\n📌 Test 3: Verifying format correctness');
    
    const checks = [
      {
        name: 'referenceFail is decimal format',
        pass: /^\d+\.\d{2}$/.test(settings.referenceFail),
        value: settings.referenceFail
      },
      {
        name: 'referenceUP is decimal format',
        pass: /^\d+\.\d{2}$/.test(settings.referenceUP),
        value: settings.referenceUP
      },
      {
        name: 'referenceOP is decimal format',
        pass: /^\d+\.\d{2}$/.test(settings.referenceOP),
        value: settings.referenceOP
      },
      {
        name: 'referenceFail is NOT device format (no "030")',
        pass: settings.referenceFail !== "030",
        value: settings.referenceFail
      },
      {
        name: 'referenceUP is NOT device format (no "060")',
        pass: settings.referenceUP !== "060",
        value: settings.referenceUP
      },
      {
        name: 'referenceOP is NOT device format (no "080")',
        pass: settings.referenceOP !== "080",
        value: settings.referenceOP
      },
      {
        name: 'referenceFail is NOT extra zeros format (no "3000")',
        pass: settings.referenceFail !== "3000",
        value: settings.referenceFail
      },
      {
        name: 'referenceUP is NOT extra zeros format (no "6000")',
        pass: settings.referenceUP !== "6000",
        value: settings.referenceUP
      },
      {
        name: 'referenceOP is NOT extra zeros format (no "8000")',
        pass: settings.referenceOP !== "8000",
        value: settings.referenceOP
      }
    ];
    
    let allPassed = true;
    checks.forEach(check => {
      const status = check.pass ? '✅' : '❌';
      console.log(`   ${status} ${check.name} (value: "${check.value}")`);
      if (!check.pass) allPassed = false;
    });
    
    // Test 4: Simulate API response
    console.log('\n📌 Test 4: Simulating API response format');
    const apiResponse = {
      "Device ID": TEST_DEVICE_ID,
      "Message Type": "settings",
      "sender": "Server",
      "Parameters": {
        "Reference Fail": settings.referenceFail,
        "Reference UP": settings.referenceUP,
        "Reference OP": settings.referenceOP
      }
    };
    
    console.log('   API Response Parameters:');
    console.log(`     - "Reference Fail": "${apiResponse.Parameters['Reference Fail']}"`);
    console.log(`     - "Reference UP": "${apiResponse.Parameters['Reference UP']}"`);
    console.log(`     - "Reference OP": "${apiResponse.Parameters['Reference OP']}"`);
    
    // Test 5: Simulate frontend display
    console.log('\n📌 Test 5: Simulating frontend display');
    
    const formatVoltageValue = (value, decimals = 2) => {
      if (!value && value !== 0) return '0.00';
      let numValue = parseFloat(value.toString());
      if (isNaN(numValue)) return '0.00';
      
      // If absolute value >= 5, it's in integer format (multiply by 100), so divide by 100
      if (Math.abs(numValue) >= 5) {
        numValue = numValue / 100;
      }
      
      return numValue.toFixed(decimals);
    };
    
    const displayFail = formatVoltageValue(settings.referenceFail);
    const displayUP = formatVoltageValue(settings.referenceUP);
    const displayOP = formatVoltageValue(settings.referenceOP);
    
    console.log(`   Display values:`);
    console.log(`     - Reference Fail: ${displayFail}V`);
    console.log(`     - Reference UP: ${displayUP}V`);
    console.log(`     - Reference OP: ${displayOP}V`);
    
    const displayChecks = [
      {
        name: 'Reference Fail displays correctly',
        pass: displayFail === '0.30',
        expected: '0.30',
        actual: displayFail
      },
      {
        name: 'Reference UP displays correctly',
        pass: displayUP === '0.60',
        expected: '0.60',
        actual: displayUP
      },
      {
        name: 'Reference OP displays correctly',
        pass: displayOP === '0.80',
        expected: '0.80',
        actual: displayOP
      }
    ];
    
    displayChecks.forEach(check => {
      const status = check.pass ? '✅' : '❌';
      console.log(`   ${status} ${check.name} (expected: ${check.expected}, actual: ${check.actual})`);
      if (!check.pass) allPassed = false;
    });
    
    // Summary
    console.log('\n📊 === Test Summary ===');
    if (allPassed) {
      console.log('✅ All tests PASSED! Reference values are stored and displayed correctly.');
    } else {
      console.log('❌ Some tests FAILED! There may still be issues with value formatting.');
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
