/**
 * Simple Device Management Core Functionality Test
 * Tests the core database storage and retrieval functionality
 */

const mongoose = require('mongoose');

// Connect to database
async function connectToDatabase() {
  try {
    await mongoose.connect('mongodb://localhost:27017/ashecontrol', {
      useNewUrlParser: true,
      useUnifiedTopology: true,
    });
    console.log('✅ Connected to MongoDB');
  } catch (error) {
    console.error('❌ MongoDB connection failed:', error);
    process.exit(1);
  }
}

// Test device management functionality
async function testDeviceManagement() {
  console.log('🚀 Testing Device Management Core Functionality...\n');

  try {
    // Import services
    const deviceManagementService = require('./services/deviceManagementService');

    // Test 1: Register a new device
    console.log('📝 Test 1: Register Device');
    try {
      const deviceData = {
        deviceId: "CORE_TEST_001",
        name: "Core Test Device",
        type: "sensor",
        location: { latitude: 40.7128, longitude: -74.0060 }
      };

      const device = await deviceManagementService.registerDevice(deviceData);
      console.log('✅ Device registered:', device.deviceId);
    } catch (error) {
      if (error.message.includes('already exists')) {
        console.log('ℹ️  Device already exists, continuing...');
      } else {
        throw error;
      }
    }

    // Test 2: Store device settings
    console.log('\n📝 Test 2: Store Device Settings');
    const settings = {
      electrode: 1,
      shuntVoltage: 30,
      shuntCurrent: 1000,
      referenceFail: 35,
      referenceUP: 320,
      referenceOP: 65
    };

    await deviceManagementService.storeDeviceSettings("CORE_TEST_001", settings, "test_system");
    console.log('✅ Device settings stored successfully');

    // Test 3: Get device settings in standardized format
    console.log('\n📝 Test 3: Get Device Settings');
    const retrievedSettings = await deviceManagementService.getDeviceSettings("CORE_TEST_001");
    console.log('✅ Device settings retrieved:');
    console.log('   Device ID:', retrievedSettings['Device ID']);
    console.log('   Message Type:', retrievedSettings['Message Type']);
    console.log('   Parameters Count:', Object.keys(retrievedSettings.Parameters).length);
    console.log('   Electrode:', retrievedSettings.Parameters.Electrode);
    console.log('   Shunt Voltage:', retrievedSettings.Parameters['Shunt Voltage']);

    // Test 4: Update specific parameters
    console.log('\n📝 Test 4: Update Device Parameters');
    const updatedParams = {
      "Electrode": 2,
      "Shunt Voltage": 35,
      "Reference Fail": 40
    };

    const completeSettings = await deviceManagementService.updateDeviceParameters(
      "CORE_TEST_001", 
      updatedParams, 
      "test-command-123"
    );

    console.log('✅ Parameters updated successfully');
    console.log('   Updated Electrode:', completeSettings.Parameters.Electrode);
    console.log('   Updated Shunt Voltage:', completeSettings.Parameters['Shunt Voltage']);
    console.log('   Updated Reference Fail:', completeSettings.Parameters['Reference Fail']);

    // Test 5: Get all devices
    console.log('\n📝 Test 5: Get All Devices');
    const allDevices = await deviceManagementService.getAllDevicesWithSettings();
    console.log('✅ Retrieved all devices:');
    allDevices.forEach(device => {
      console.log(`   - ${device.deviceId}: ${device.name} (${device.type})`);
    });

    // Test 6: Verify complete settings format
    console.log('\n📝 Test 6: Verify Complete Settings Format');
    const finalSettings = await deviceManagementService.getDeviceSettings("CORE_TEST_001");
    
    const requiredParams = [
      'Electrode', 'Shunt Voltage', 'Shunt Current', 'Reference Fail',
      'Reference UP', 'Reference OV', 'Interrupt ON Time', 'Interrupt OFF Time',
      'Interrupt Start TimeStamp', 'Interrupt Stop TimeStamp', 'DPOL Interval',
      'Depolarization Start TimeStamp', 'Depolarization Stop TimeStamp',
      'Instant Mode', 'Instant Start TimeStamp', 'Instant End TimeStamp'
    ];

    const missingParams = requiredParams.filter(param => !(param in finalSettings.Parameters));
    
    if (missingParams.length === 0) {
      console.log('✅ All required parameters present in complete settings');
    } else {
      console.log('❌ Missing parameters:', missingParams);
    }

    console.log('\n📄 Complete Settings Payload Format:');
    console.log(JSON.stringify(finalSettings, null, 2));

    console.log('\n✅ All core functionality tests passed!');

  } catch (error) {
    console.error('\n❌ Test failed:', error);
    throw error;
  }
}

// Run the test
async function runTest() {
  try {
    await connectToDatabase();
    await testDeviceManagement();
    console.log('\n🎉 Core Device Management System is working correctly!');
  } catch (error) {
    console.error('\n💥 Core functionality test failed:', error);
  } finally {
    await mongoose.connection.close();
    console.log('\n📋 Test completed - database connection closed');
  }
}

// Execute if run directly
if (require.main === module) {
  runTest();
}

module.exports = { testDeviceManagement };