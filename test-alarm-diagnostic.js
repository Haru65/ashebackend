/**
 * Diagnostic script to check:
 * 1. What alarms exist in the database
 * 2. Their configuration
 * 3. Whether email service is configured
 * 4. Manual alarm trigger test
 */

const mongoose = require('mongoose');
const Alarm = require('./models/Alarm');
const Device = require('./models/Device');
const EmailService = require('./services/emailService');
const alarmMonitoringService = require('./services/alarmMonitoringService');

const dbUrl = process.env.MONGO_URI || 'mongodb://localhost:27017/ZEPTAC_IOT';

async function runDiagnostics() {
  try {
    console.log('\n' + '='.repeat(80));
    console.log('🔍 ALARM DIAGNOSTIC TEST');
    console.log('='.repeat(80) + '\n');

    // Connect to database
    await mongoose.connect(dbUrl);
    console.log('✅ Connected to MongoDB\n');

    // Check 1: List all alarms
    console.log('📋 STEP 1: Listing all alarms in database...');
    const allAlarms = await Alarm.find({}).lean();
    console.log(`   Found ${allAlarms.length} alarm(s)\n`);

    if (allAlarms.length === 0) {
      console.log('⚠️  NO ALARMS FOUND IN DATABASE!');
      console.log('   You need to create an alarm first via: POST /api/alarms\n');
    } else {
      for (const alarm of allAlarms) {
        console.log(`   Alarm: ${alarm.name}`);
        console.log(`   ├─ Device: ${alarm.device_name}`);
        console.log(`   ├─ Status: ${alarm.status}`);
        console.log(`   ├─ Severity: ${alarm.severity}`);
        console.log(`   ├─ Email Recipients: ${alarm.notification_config?.email_ids?.join(', ') || 'NONE'}`);
        console.log(`   └─ Thresholds: Ref1=${alarm.device_params?.ref_1}, Ref2=${alarm.device_params?.ref_2}, Ref3=${alarm.device_params?.ref_3}\n`);
      }
    }

    // Check 2: List all devices
    console.log('📱 STEP 2: Listing all devices in database...');
    const allDevices = await Device.find({}).lean();
    console.log(`   Found ${allDevices.length} device(s)\n`);

    for (const device of allDevices) {
      console.log(`   Device: ${device.deviceName || device.deviceId}`);
      console.log(`   └─ ID: ${device.deviceId}\n`);
    }

    // Check 3: Email service configuration
    console.log('📧 STEP 3: Checking email service configuration...');
    const emailService = new EmailService();
    console.log('   Email service created\n');
    console.log('   Current configuration:');
    console.log(`   ├─ Service: ${process.env.EMAIL_SERVICE || 'Gmail'}`);
    console.log(`   ├─ From Email: ${process.env.EMAIL_FROM || 'Not set'}`);
    console.log(`   ├─ Gmail User: ${process.env.GMAIL_USER || 'Not set'}`);
    console.log(`   ├─ App Password: ${process.env.GMAIL_APP_PASSWORD ? '✅ Set' : '❌ Not set'}\n`);

    if (!process.env.GMAIL_APP_PASSWORD && !process.env.SMTP_PASSWORD) {
      console.log('⚠️  EMAIL SERVICE NOT CONFIGURED!');
      console.log('   Add these env variables to send emails:\n');
      console.log('   EMAIL_SERVICE=gmail');
      console.log('   GMAIL_USER=your-email@gmail.com');
      console.log('   GMAIL_APP_PASSWORD=your-app-password\n');
      console.log('   Or configure SMTP instead:\n');
      console.log('   EMAIL_SERVICE=smtp');
      console.log('   SMTP_HOST=smtp.example.com');
      console.log('   SMTP_USER=user@example.com');
      console.log('   SMTP_PASSWORD=password\n');
    }

    // Check 4: Test with sample device data
    if (allAlarms.length > 0 && allDevices.length > 0) {
      console.log('🧪 STEP 4: Testing alarm trigger with sample data...\n');

      const alarm = allAlarms[0];
      const device = allDevices.find(d => d.deviceName === alarm.device_name) || allDevices[0];

      console.log(`   Testing alarm: ${alarm.name}`);
      console.log(`   For device: ${device.deviceName || device.deviceId}\n`);

      // Create test data that EXCEEDS the threshold
      const testData = {
        dci: alarm.device_params?.ref_2 ? (alarm.device_params.ref_2 + 10) : 100,
        dcv: alarm.device_params?.ref_1 ? (alarm.device_params.ref_1 - 10) : 5,
        acv: alarm.device_params?.ref_3 ? (alarm.device_params.ref_3 + 10) : 150,
        EVENT: 'NORMAL'
      };

      console.log('   Sample test data (designed to trigger alarm):');
      console.log(`   ├─ DCI: ${testData.dci} (threshold: ${alarm.device_params?.ref_2})`);
      console.log(`   ├─ DCV: ${testData.dcv} (threshold: ${alarm.device_params?.ref_1})`);
      console.log(`   ├─ ACV: ${testData.acv} (threshold: ${alarm.device_params?.ref_3})`);
      console.log(`   └─ EVENT: ${testData.EVENT}\n`);

      console.log('   Calling alarm monitoring service...\n');
      await alarmMonitoringService.checkAlarmsForDevice(testData, device.deviceId, testData.EVENT);

      console.log('\n   ✅ Alarm check completed (check logs above for results)\n');
    }

    // Summary
    console.log('='.repeat(80));
    console.log('📊 DIAGNOSTIC SUMMARY');
    console.log('='.repeat(80) + '\n');

    if (allAlarms.length === 0) {
      console.log('❌ Issue: No alarms found');
      console.log('   Solution: Create an alarm via POST /api/alarms\n');
    }

    if (!allAlarms.some(a => a.notification_config?.email_ids?.length > 0)) {
      console.log('❌ Issue: No email addresses configured');
      console.log('   Solution: Add email_ids to alarm notification_config\n');
    }

    if (!process.env.GMAIL_APP_PASSWORD && !process.env.SMTP_PASSWORD) {
      console.log('❌ Issue: Email service not configured');
      console.log('   Solution: Set EMAIL_SERVICE env variable and credentials\n');
    }

    if (allAlarms.length > 0 && allAlarms.some(a => a.notification_config?.email_ids?.length > 0)) {
      console.log('✅ Configuration looks good!');
      console.log('   If emails still not sending:');
      console.log('   1. Check backend logs for [Alarm Monitor] messages');
      console.log('   2. Verify thresholds: data must EXCEED ref_2 or be BELOW ref_1\n');
    }

    console.log('='.repeat(80) + '\n');

  } catch (error) {
    console.error('❌ Error:', error.message);
  } finally {
    await mongoose.connection.close();
  }
}

runDiagnostics();
