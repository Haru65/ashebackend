#!/usr/bin/env node

/**
 * Complete Setup and Test Script for Alarm System
 * 
 * This script:
 * 1. Creates a test device
 * 2. Creates an alarm with email configuration
 * 3. Tests the alarm trigger with sample MQTT data
 * 4. Verifies email would be sent
 */

const mongoose = require('mongoose');
const Device = require('./models/Device');
const Alarm = require('./models/Alarm');
const alarmMonitoringService = require('./services/alarmMonitoringService');
const EmailService = require('./services/emailService');

const dbUrl = process.env.MONGO_URI || process.env.MONGODB_URI || 'mongodb://localhost:27017/zeptac_iot';

async function setupAndTest() {
  try {
    console.log('\n' + '='.repeat(80));
    console.log('⚙️  ALARM SYSTEM COMPLETE SETUP AND TEST');
    console.log('='.repeat(80) + '\n');

    // Connect to database
    console.log('🔌 Connecting to MongoDB...');
    await mongoose.connect(dbUrl);
    console.log('✅ Connected\n');

    // STEP 1: Create or find test device
    console.log('📱 STEP 1: Creating test device...');
    let device = await Device.findOne({ deviceName: 'TestDevice_Alarm' });
    
    if (device) {
      console.log(`✅ Found existing device: ${device.deviceName}`);
    } else {
      device = new Device({
        deviceId: 'TEST_DEVICE_' + Date.now(),
        deviceName: 'TestDevice_Alarm',
        status: 'Online',
        location: 'Lab',
        ipAddress: '192.168.1.100',
        macAddress: 'AA:BB:CC:DD:EE:FF'
      });
      await device.save();
      console.log(`✅ Created new device: ${device.deviceName}`);
      console.log(`   Device ID: ${device.deviceId}\n`);
    }

    // STEP 2: Create alarm with email configuration
    console.log('🚨 STEP 2: Creating alarm with email configuration...');
    
    // Delete old alarm if exists
    await Alarm.deleteMany({ name: 'Test_Alarm_System' });
    
    const alarm = new Alarm({
      name: 'Test_Alarm_System',
      description: 'Test alarm for troubleshooting email configuration',
      device_name: device.deviceName,
      severity: 'High',
      status: 'Active',
      device_params: {
        ref_1: 50,      // Reference Fail - triggers if DCV < 50
        ref_2: 100,     // Reference UP - triggers if DCI > 100
        ref_3: 150,     // Reference OV - triggers if ACV > 150
        dcv: 0,
        dci: 0,
        acv: 0
      },
      notification_config: {
        email_ids: ['ashecontrol.alerts@gmail.com'], // ⚠️ UPDATE THIS WITH YOUR EMAIL
        sms_numbers: [],
        enabled: true
      },
      event_conditions: ['ABNORMAL'],
      created_at: new Date(),
      updated_at: new Date()
    });

    await alarm.save();
    console.log(`✅ Created alarm: ${alarm.name}`);
    console.log(`   Device: ${alarm.device_name}`);
    console.log(`   Severity: ${alarm.severity}`);
    console.log(`   Email Recipients: ${alarm.notification_config.email_ids.join(', ')}`);
    console.log(`   Status: ${alarm.status}`);
    console.log(`   Thresholds:`);
    console.log(`   ├─ Ref 1 (DCV < ?): ${alarm.device_params.ref_1}`);
    console.log(`   ├─ Ref 2 (DCI > ?): ${alarm.device_params.ref_2}`);
    console.log(`   └─ Ref 3 (ACV > ?): ${alarm.device_params.ref_3}\n`);

    // STEP 3: Create test data that TRIGGERS the alarm
    console.log('🧪 STEP 3: Testing with sample data that EXCEEDS thresholds...\n');
    
    const testData = {
      dcv: 45,      // 45 < 50 ✅ (Ref 1 condition MET)
      dci: 120,     // 120 > 100 ✅ (Ref 2 condition MET)
      acv: 200,     // 200 > 150 ✅ (Ref 3 condition MET)
      ref_1: alarm.device_params.ref_1,
      ref_2: alarm.device_params.ref_2,
      ref_3: alarm.device_params.ref_3,
      EVENT: 'ABNORMAL'
    };

    console.log('   Sample data:');
    console.log(`   ├─ DCV: ${testData.dcv} (threshold: ${testData.ref_1}, should be <)`);
    console.log(`   ├─ DCI: ${testData.dci} (threshold: ${testData.ref_2}, should be >)`);
    console.log(`   ├─ ACV: ${testData.acv} (threshold: ${testData.ref_3}, should be >)`);
    console.log(`   └─ EVENT: ${testData.EVENT}\n`);

    console.log('   Calling alarm monitoring service...\n');
    await alarmMonitoringService.checkAlarmsForDevice(testData, device.deviceId, testData.EVENT);
    
    console.log('\n   ✅ Alarm check completed\n');

    // STEP 4: Verify email service
    console.log('📧 STEP 4: Checking email service configuration...\n');
    
    const hasEmailConfig = process.env.GMAIL_APP_PASSWORD || process.env.SMTP_PASSWORD;
    if (hasEmailConfig) {
      console.log('✅ Email service credentials found!');
      console.log(`   Service: ${process.env.EMAIL_SERVICE || 'gmail'}`);
      console.log(`   From: ${process.env.EMAIL_FROM || process.env.GMAIL_USER}\n`);
    } else {
      console.log('⚠️  Email service NOT configured!');
      console.log('   To enable email sending, update your .env file:\n');
      console.log('   Option 1: Gmail with App Password');
      console.log('   EMAIL_SERVICE=gmail');
      console.log('   GMAIL_USER=your-email@gmail.com');
      console.log('   GMAIL_APP_PASSWORD=your-16-character-app-password');
      console.log('   EMAIL_FROM=your-email@gmail.com\n');
      
      console.log('   Option 2: SMTP Server');
      console.log('   EMAIL_SERVICE=smtp');
      console.log('   SMTP_HOST=smtp.example.com');
      console.log('   SMTP_PORT=587');
      console.log('   SMTP_USER=your-username');
      console.log('   SMTP_PASSWORD=your-password');
      console.log('   EMAIL_FROM=sender@example.com\n');
    }

    // STEP 5: Summary
    console.log('='.repeat(80));
    console.log('✅ SETUP COMPLETE');
    console.log('='.repeat(80) + '\n');

    console.log('📋 What was created:');
    console.log(`   ✅ Device: TestDevice_Alarm (ID: ${device.deviceId})`);
    console.log(`   ✅ Alarm: Test_Alarm_System (Email: ashecontrol.alerts@gmail.com)`);
    console.log(`   ✅ Thresholds: Ref1=50, Ref2=100, Ref3=150\n`);

    console.log('🔄 Next steps to test email sending:\n');
    console.log('   1. Update email address in alarm:');
    console.log('      - Edit the email in notification_config (currently ashecontrol.alerts@gmail.com)');
    console.log('      - Or configure GMAIL_APP_PASSWORD in .env if using Gmail\n');
    
    console.log('   2. Send MQTT message with data exceeding thresholds:');
    console.log('      - DCV < 50 (send 45)');
    console.log('      - DCI > 100 (send 120)');
    console.log('      - ACV > 150 (send 200)\n');
    
    console.log('   3. Monitor backend logs for:');
    console.log('      - [MQTT Client] 🔔 Alarm Check Data (data extraction)');
    console.log('      - [Alarm Monitor] 📊 Checking alarm thresholds (threshold comparison)');
    console.log('      - [Email Service] sending email (or error if not configured)\n');

    console.log('📚 Key files:');
    console.log('   - Alarm in DB: _id = ' + alarm._id);
    console.log('   - Check logs: backend.log or console output\n');

    console.log('='.repeat(80) + '\n');

  } catch (error) {
    console.error('❌ Error:', error.message);
    console.error(error);
  } finally {
    await mongoose.connection.close();
  }
}

setupAndTest();
