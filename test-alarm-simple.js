/**
 * Simple Alarm Test - Check if alarm client is working
 */

require('dotenv').config();

const mongoose = require('mongoose');
const Device = require('./models/Device');
const Alarm = require('./models/Alarm');
const alarmMonitoringService = require('./services/alarmMonitoringService');

const dbUrl = process.env.MONGODB_URI || process.env.MONGO_URI || 'mongodb://localhost:27017/zeptac_iot';

async function testAlarmClient() {
  try {
    console.log('\n' + '='.repeat(80));
    console.log('🧪 SIMPLE ALARM CLIENT TEST');
    console.log('='.repeat(80) + '\n');

    // Connect to database
    console.log('🔗 Connecting to MongoDB...');
    await mongoose.connect(dbUrl);
    console.log('✅ Connected to MongoDB\n');

    // Clean up old test data
    console.log('🧹 Cleaning up old test data...');
    await Alarm.deleteMany({ name: { $regex: 'SIMPLE_TEST' } });
    await Device.deleteMany({ deviceName: { $regex: 'SIMPLE_TEST' } });
    console.log('✅ Cleaned up\n');

    // Create a test device
    console.log('📱 Creating test device...');
    const device = await Device.create({
      deviceId: 'SIMPLE_TEST_DEV_001',
      deviceName: 'SIMPLE_TEST_Device',
      unitNo: 'U-TEST-001',
      location: 'Test Lab',
      deviceType: 'sensor',
      configuration: {
        deviceSettings: {
          referenceFail: 5,
          referenceUP: 50,
          referenceOV: 100
        }
      }
    });
    console.log(`✅ Device created: ${device.deviceName} (${device.deviceId})\n`);

    // Create an alarm for this device
    console.log('⚠️  Creating alarm for device...');
    const alarm = await Alarm.create({
      name: 'SIMPLE_TEST_Alarm_DCV_Low',
      device_name: 'SIMPLE_TEST_Device',
      deviceId: 'SIMPLE_TEST_DEV_001',
      parameter: 'DCV',
      severity: 'critical',
      status: 'Active',
      device_params: {
        ref_1: 5,      // Ref 1: DCV should not go below 5
        ref_2: 50,     // Ref 2: DCI should not exceed 50
        ref_3: 100     // Ref 3: ACV should not exceed 100
      },
      notification_config: {
        email_ids: ['adityakhandagale69@gmail.com'],
        sms_numbers: []
      }
    });
    console.log(`✅ Alarm created: ${alarm.name}\n`);

    // Test 1: Check alarm exists
    console.log('🧪 TEST 1: Verify alarm exists in database');
    const fetchedAlarm = await Alarm.findById(alarm._id);
    if (fetchedAlarm) {
      console.log('✅ Alarm found in database');
      console.log(`   Name: ${fetchedAlarm.name}`);
      console.log(`   Device: ${fetchedAlarm.device_name}`);
      console.log(`   Ref 1: ${fetchedAlarm.device_params.ref_1}`);
    } else {
      console.log('❌ Alarm not found in database');
    }
    console.log('');

    // Test 2: Get device-specific alarms
    console.log('🧪 TEST 2: Fetch device-specific alarms');
    const deviceAlarms = await Alarm.getDeviceAlarms('SIMPLE_TEST_Device', 'Active');
    console.log(`✅ Found ${deviceAlarms.length} alarm(s) for device`);
    if (deviceAlarms.length > 0) {
      console.log(`   Alarm: ${deviceAlarms[0].name}`);
    }
    console.log('');

    // Test 3: Test alarm with data that SHOULD trigger it (DCV = 2, below threshold of 5)
    console.log('🧪 TEST 3: Test alarm trigger with DCV = 2 (below threshold of 5)');
    const triggerData = {
      dcv: 2,      // THIS SHOULD TRIGGER ALARM (below ref_1=5)
      dci: 10,
      acv: 50
    };
    console.log('📊 Simulating device data:', triggerData);
    console.log('   Expected: Alarm should trigger\n');
    
    await alarmMonitoringService.checkAlarmsForDevice(triggerData, 'SIMPLE_TEST_DEV_001', 'NORMAL');
    console.log('');

    // Test 4: Test alarm with data that should NOT trigger it (DCV = 10, above threshold)
    console.log('🧪 TEST 4: Test alarm with DCV = 10 (above threshold of 5)');
    const noTriggerData = {
      dcv: 10,     // This should NOT trigger alarm (above ref_1=5)
      dci: 10,
      acv: 50
    };
    console.log('📊 Simulating device data:', noTriggerData);
    console.log('   Expected: Alarm should NOT trigger\n');
    
    await alarmMonitoringService.checkAlarmsForDevice(noTriggerData, 'SIMPLE_TEST_DEV_001', 'NORMAL');
    console.log('');

    // Test 5: Check alarm model methods
    console.log('🧪 TEST 5: Verify Alarm model methods exist');
    if (typeof Alarm.getDeviceAlarms === 'function') {
      console.log('✅ Alarm.getDeviceAlarms() method exists');
    } else {
      console.log('❌ Alarm.getDeviceAlarms() method NOT found');
    }
    
    if (typeof alarm.recordTrigger === 'function') {
      console.log('✅ Alarm.prototype.recordTrigger() method exists');
    } else {
      console.log('❌ Alarm.prototype.recordTrigger() method NOT found');
    }
    console.log('');

    // Summary
    console.log('='.repeat(80));
    console.log('✅ ALARM CLIENT TEST COMPLETE');
    console.log('='.repeat(80) + '\n');

    // Cleanup
    await Alarm.deleteMany({ name: { $regex: 'SIMPLE_TEST' } });
    await Device.deleteMany({ deviceName: { $regex: 'SIMPLE_TEST' } });
    console.log('🧹 Cleaned up test data\n');

    await mongoose.disconnect();
    console.log('✅ Disconnected from MongoDB');

  } catch (error) {
    console.error('❌ Test failed:', error.message);
    console.error(error);
    process.exit(1);
  }
}

testAlarmClient();
