require('dotenv').config();
const mongoose = require('mongoose');
const Telemetry = require('./models/telemetry');
const Device = require('./models/Device');

async function viewDatabaseData() {
  try {
    console.log('🔌 Connecting to MongoDB...');
    await mongoose.connect(process.env.MONGODB_URI);
    console.log('✅ Connected to MongoDB\n');

    // ========== DEVICES ==========
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    console.log('📱 DEVICES');
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');

    const devices = await Device.find({}).lean();
    console.log(`Total Devices: ${devices.length}\n`);

    if (devices.length > 0) {
      devices.forEach((device, index) => {
        console.log(`\n[${index + 1}] Device ID: ${device.deviceId || device._id}`);
        console.log(`    Name: ${device.name || 'N/A'}`);
        console.log(`    Type: ${device.type || 'N/A'}`);
        console.log(`    Status: ${device.status?.state || 'N/A'}`);
        console.log(`    Last Seen: ${device.status?.lastSeen || 'N/A'}`);
        
        if (device.location) {
          console.log(`    Location: ${device.location.latitude}, ${device.location.longitude}`);
        }
        
        if (device.configuration?.deviceSettings) {
          console.log(`    Settings:`);
          const settings = device.configuration.deviceSettings;
          console.log(`      - Electrode: ${settings.electrode}`);
          console.log(`      - Event: ${settings.event}`);
          console.log(`      - Manual Mode Action: ${settings.manualModeAction}`);
          console.log(`      - Instant Mode: ${settings.instantMode}`);
          console.log(`      - Shunt Voltage: ${settings.shuntVoltage}`);
          console.log(`      - Shunt Current: ${settings.shuntCurrent}`);
        }
        
        console.log('    ─────────────────────────────────────────');
      });
    } else {
      console.log('❌ No devices found in database');
    }

    // ========== TELEMETRY DATA ==========
    console.log('\n\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    console.log('📊 TELEMETRY DATA');
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');

    const telemetryCount = await Telemetry.countDocuments();
    console.log(`Total Telemetry Records: ${telemetryCount}\n`);

    if (telemetryCount > 0) {
      // Get latest 10 records
      const latestRecords = await Telemetry.find({})
        .sort({ timestamp: -1 })
        .limit(10)
        .lean();

      console.log('Latest 10 Records:\n');
      
      latestRecords.forEach((record, index) => {
        console.log(`\n[${index + 1}] Device ID: ${record.deviceId}`);
        console.log(`    Timestamp: ${new Date(record.timestamp).toLocaleString()}`);
        console.log(`    Event: ${record.event || 'NORMAL'}`);
        
        if (record.data) {
          console.log(`    Data Fields:`);
          const dataObj = record.data instanceof Map ? Object.fromEntries(record.data) : record.data;
          Object.entries(dataObj).forEach(([key, value]) => {
            console.log(`      - ${key}: ${value}`);
          });
        }
        console.log('    ─────────────────────────────────────────');
      });

      // Get statistics per device
      console.log('\n\n📈 STATISTICS BY DEVICE:\n');
      
      const deviceStats = await Telemetry.aggregate([
        {
          $group: {
            _id: '$deviceId',
            count: { $sum: 1 },
            firstRecord: { $min: '$timestamp' },
            lastRecord: { $max: '$timestamp' }
          }
        },
        { $sort: { count: -1 } }
      ]);

      deviceStats.forEach((stat, index) => {
        console.log(`\n[${index + 1}] Device: ${stat._id}`);
        console.log(`    Total Records: ${stat.count}`);
        console.log(`    First Record: ${new Date(stat.firstRecord).toLocaleString()}`);
        console.log(`    Last Record: ${new Date(stat.lastRecord).toLocaleString()}`);
        
        const timeSpan = (stat.lastRecord - stat.firstRecord) / (1000 * 60 * 60 * 24);
        console.log(`    Time Span: ${timeSpan.toFixed(2)} days`);
      });

      // Get date range
      console.log('\n\n📅 DATE RANGE:\n');
      const dateRange = await Telemetry.aggregate([
        {
          $group: {
            _id: null,
            minDate: { $min: '$timestamp' },
            maxDate: { $max: '$timestamp' }
          }
        }
      ]);

      if (dateRange.length > 0) {
        console.log(`    Oldest Record: ${new Date(dateRange[0].minDate).toLocaleString()}`);
        console.log(`    Newest Record: ${new Date(dateRange[0].maxDate).toLocaleString()}`);
        const totalDays = (dateRange[0].maxDate - dateRange[0].minDate) / (1000 * 60 * 60 * 24);
        console.log(`    Total Coverage: ${totalDays.toFixed(2)} days`);
      }

    } else {
      console.log('❌ No telemetry data found in database');
    }

    console.log('\n\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');

  } catch (error) {
    console.error('❌ Error:', error.message);
    console.error(error);
  } finally {
    await mongoose.connection.close();
    console.log('🔌 Database connection closed');
  }
}

// Run the script
viewDatabaseData();
