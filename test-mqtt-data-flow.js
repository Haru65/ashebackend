/**
 * Test MQTT Data Flow
 * Verifies that device data from MQTT is properly stored and retrieved
 * Tests: Electrode, Reference, Interrupt, Timestamps
 */

const mongoose = require('mongoose');
const Device = require('./models/Device');
const DeviceHistory = require('./models/DeviceHistory');

// Sample test data matching the device simulation format
const testPayload = {
  "Device ID": 123,
  "Message Type": "SETTING DATA",
  "Sender": "Device",
  "Parameters": {
    "Electrode": 2,
    "Event": 0,
    "Shunt Voltage": 99,
    "Shunt Current": 15,
    "Reference Fail": 30,
    "Reference UP": 64,
    "Reference OV": 3,
    "Manual Mode Action": 0,
    "Interrupt ON Time": 60,
    "Interrupt OFF Time": 16,
    "Interrupt Start TimeStamp": "2025-11-12 20:34:07",
    "Interrupt Stop TimeStamp": "2025-12-26 19:34:09",
    "DPOL Interval": "00:00:00",
    "Depolarization Start TimeStamp": "2025-12-12 06:34:07",
    "Depolarization Stop TimeStamp": "2025-12-12 06:34:07",
    "Instant Mode": 1,
    "Instant Start TimeStamp": "19:14:01",
    "Instant End TimeStamp": "00:00:00"
  }
};

async function testDataFlow() {
  try {
    // Connect to MongoDB
    await mongoose.connect(process.env.MONGODB_URI || 'mongodb://localhost:27017/ashecontrol', {
      useNewUrlParser: true,
      useUnifiedTopology: true
    });
    console.log('✅ Connected to MongoDB\n');

    const deviceId = '123';

    // Simulate mqttClientService updateDevice logic
    console.log('📝 Step 1: Simulating MQTT data storage...');
    const updateData = {
      $set: {
        'status.state': 'online',
        'status.lastSeen': new Date(),
        'mqtt.topics.data': 'devices/123/data',
        // Map Parameters object from MQTT payload to device configuration
        'configuration.deviceSettings.electrode': testPayload.Parameters?.Electrode,
        'configuration.deviceSettings.event': testPayload.Parameters?.Event,
        'configuration.deviceSettings.manualModeAction': testPayload.Parameters?.["Manual Mode Action"],
        'configuration.deviceSettings.shuntVoltage': testPayload.Parameters?.["Shunt Voltage"],
        'configuration.deviceSettings.shuntCurrent': testPayload.Parameters?.["Shunt Current"],
        'configuration.deviceSettings.referenceFail': testPayload.Parameters?.["Reference Fail"],
        'configuration.deviceSettings.referenceUP': testPayload.Parameters?.["Reference UP"],
          'configuration.deviceSettings.referenceOP': testPayload.Parameters?.["Reference OP"],
        'configuration.deviceSettings.di1': testPayload.Parameters?.["DI1"],
        'configuration.deviceSettings.di2': testPayload.Parameters?.["DI2"],
        'configuration.deviceSettings.di3': testPayload.Parameters?.["DI3"],
        'configuration.deviceSettings.di4': testPayload.Parameters?.["DI4"],
        'configuration.deviceSettings.interruptOnTime': testPayload.Parameters?.["Interrupt ON Time"],
        'configuration.deviceSettings.interruptOffTime': testPayload.Parameters?.["Interrupt OFF Time"],
        'configuration.deviceSettings.interruptStartTimestamp': testPayload.Parameters?.["Interrupt Start TimeStamp"],
        'configuration.deviceSettings.interruptStopTimestamp': testPayload.Parameters?.["Interrupt Stop TimeStamp"],
        'configuration.deviceSettings.dpolInterval': testPayload.Parameters?.["DPOL Interval"],
        'configuration.deviceSettings.depolarizationStartTimestamp': testPayload.Parameters?.["Depolarization Start TimeStamp"],
        'configuration.deviceSettings.depolarizationStopTimestamp': testPayload.Parameters?.["Depolarization Stop TimeStamp"],
        'configuration.deviceSettings.instantMode': testPayload.Parameters?.["Instant Mode"],
        'configuration.deviceSettings.instantStartTimestamp': testPayload.Parameters?.["Instant Start TimeStamp"],
        'configuration.deviceSettings.instantEndTimestamp': testPayload.Parameters?.["Instant End TimeStamp"]
      }
    };

    const device = await Device.findOneAndUpdate(
      { deviceId },
      updateData,
      { new: true, upsert: true, setDefaultsOnInsert: true }
    );

    console.log('✅ Device updated in MongoDB\n');

    // Step 2: Store in history
    console.log('📝 Step 2: Storing history...');
    const history = await DeviceHistory.create({
      deviceId,
      timestamp: new Date(),
      data: testPayload,
      topic: 'devices/123/data'
    });
    console.log('✅ History stored\n');

    // Step 3: Verify device retrieval
    console.log('📝 Step 3: Retrieving device configuration...');
    const retrievedDevice = await Device.findOne({ deviceId }).lean();

    if (!retrievedDevice) {
      console.error('❌ Device not found!');
      process.exit(1);
    }

    const config = retrievedDevice.configuration?.deviceSettings || {};

    console.log('✅ Device retrieved\n');
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    console.log('CONFIGURATION VERIFICATION:');
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');

    // Check all critical fields
    const fieldChecks = [
      { name: 'Electrode', value: config.electrode, expected: 2 },
      { name: 'Event', value: config.event, expected: 0 },
      { name: 'Shunt Voltage', value: config.shuntVoltage, expected: 99 },
      { name: 'Shunt Current', value: config.shuntCurrent, expected: 15 },
      { name: 'Reference Fail', value: config.referenceFail, expected: 30 },
      { name: 'Reference UP', value: config.referenceUP, expected: 64 },
      { name: 'Reference OP', value: config.referenceOP, expected: 3 },
      { name: 'Manual Mode Action', value: config.manualModeAction, expected: 0 },
      { name: 'Interrupt ON Time', value: config.interruptOnTime, expected: 60 },
      { name: 'Interrupt OFF Time', value: config.interruptOffTime, expected: 16 },
      { name: 'Interrupt Start TimeStamp', value: config.interruptStartTimestamp, expected: "2025-11-12 20:34:07" },
      { name: 'Interrupt Stop TimeStamp', value: config.interruptStopTimestamp, expected: "2025-12-26 19:34:09" },
      { name: 'DPOL Interval', value: config.dpolInterval, expected: "00:00:00" },
      { name: 'Depolarization Start TimeStamp', value: config.depolarizationStartTimestamp, expected: "2025-12-12 06:34:07" },
      { name: 'Depolarization Stop TimeStamp', value: config.depolarizationStopTimestamp, expected: "2025-12-12 06:34:07" },
      { name: 'Instant Mode', value: config.instantMode, expected: 1 },
      { name: 'Instant Start TimeStamp', value: config.instantStartTimestamp, expected: "19:14:01" },
      { name: 'Instant End TimeStamp', value: config.instantEndTimestamp, expected: "00:00:00" }
    ];

    let passedTests = 0;
    let failedTests = 0;

    fieldChecks.forEach(check => {
      const passed = check.value === check.expected;
      const symbol = passed ? '✅' : '❌';
      console.log(`${symbol} ${check.name}: ${check.value} (expected: ${check.expected})`);
      if (passed) passedTests++;
      else failedTests++;
    });

    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    console.log(`\n📊 Results: ${passedTests} passed, ${failedTests} failed\n`);

    // Step 4: Verify API response format
    console.log('📝 Step 4: Testing API response format...');
    const apiResponse = {
      deviceId: retrievedDevice.deviceId,
      name: retrievedDevice.deviceName || retrievedDevice.deviceId,
      location: retrievedDevice.location || 'N/A',
      status: retrievedDevice.status?.state || 'offline',
      lastSeen: retrievedDevice.status?.lastSeen || null,
      currentData: retrievedDevice.sensors || {},
      configuration: retrievedDevice.configuration || null
    };

    console.log('✅ API Response structure:\n');
    console.log(JSON.stringify(apiResponse, null, 2));

    console.log('\n✅ Data flow test completed successfully!\n');

    // Cleanup
    await Device.deleteOne({ deviceId });
    await DeviceHistory.deleteOne({ deviceId });
    console.log('🧹 Cleaned up test data\n');

  } catch (error) {
    console.error('❌ Test failed:', error);
    process.exit(1);
  } finally {
    await mongoose.disconnect();
    console.log('MongoDB connection closed');
  }
}

// Run test
testDataFlow().catch(console.error);
