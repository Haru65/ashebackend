const mongoose = require('mongoose');
const ExcelExportService = require('./services/excelExportService');
require('dotenv').config();

async function testExcelExport() {
  try {
    // Connect to MongoDB
    await mongoose.connect(process.env.MONGODB_URI || 'mongodb://localhost:27017/zeptac_iot');
    console.log('✅ MongoDB connected');

    console.log('📊 Testing Excel export...');

    // Test 1: Export all data
    console.log('\n🔍 Test 1: Export all telemetry data');
    const allDataExport = await ExcelExportService.exportTelemetryToExcel({
      filename: 'all_telemetry_data.xlsx'
    });
    
    const allDataPath = await ExcelExportService.saveExcelFile(
      allDataExport.workbook,
      allDataExport.filename
    );
    
    console.log(`✅ Exported ${allDataExport.recordCount} records from ${allDataExport.devices} devices`);

    // Test 2: Export specific device data
    console.log('\n🔍 Test 2: Export data for device 123');
    const deviceExport = await ExcelExportService.exportTelemetryToExcel({
      deviceId: '123',
      filename: 'device_123_data.xlsx'
    });
    
    const devicePath = await ExcelExportService.saveExcelFile(
      deviceExport.workbook,
      deviceExport.filename
    );
    
    console.log(`✅ Exported ${deviceExport.recordCount} records for device 123`);

    // Test 3: Export last 24 hours data
    console.log('\n🔍 Test 3: Export last 24 hours data');
    const last24hExport = await ExcelExportService.exportTelemetryToExcel({
      startDate: new Date(Date.now() - 24 * 60 * 60 * 1000),
      endDate: new Date(),
      filename: 'last_24h_data.xlsx'
    });
    
    const last24hPath = await ExcelExportService.saveExcelFile(
      last24hExport.workbook,
      last24hExport.filename
    );
    
    console.log(`✅ Exported ${last24hExport.recordCount} records from last 24 hours`);

    console.log('\n📊 Export Summary:');
    console.log(`   All data: ${allDataExport.recordCount} records`);
    console.log(`   Device 123: ${deviceExport.recordCount} records`);
    console.log(`   Last 24h: ${last24hExport.recordCount} records`);
    console.log('\n📁 Files saved in ./exports/ directory');

  } catch (error) {
    console.error('❌ Export test error:', error);
  } finally {
    await mongoose.connection.close();
    console.log('✅ MongoDB disconnected');
    process.exit(0);
  }
}

testExcelExport();