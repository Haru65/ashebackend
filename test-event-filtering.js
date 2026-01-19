/**
 * Test script to verify DPOL and INST events are being saved correctly
 * This will simulate device messages and check if they're saved to the database
 */

require('dotenv').config({ path: '.env' });
const mongoose = require('mongoose');
const Telemetry = require('./models/telemetry');

async function testEventSaving() {
  try {
    // Connect to MongoDB
    const mongoUri = process.env.MONGO_URI || 'mongodb://localhost:27017/ashecontrol';
    console.log('🔗 Connecting to MongoDB:', mongoUri);
    
    await mongoose.connect(mongoUri);
    console.log('✅ Connected to MongoDB\n');
    
    // Clear existing test data
    await Telemetry.deleteMany({ deviceId: 'test-device-events' });
    console.log('🧹 Cleared previous test data\n');
    
    // Test saving records with different event types
    const testEvents = ['NORMAL', 'INT ON', 'INT OFF', 'DEPOL', 'INST ON', 'INST OFF', 'DPOL', 'INSTANT'];
    
    console.log('📝 Creating test telemetry records with different events:\n');
    
    for (const eventValue of testEvents) {
      const testRecord = new Telemetry({
        deviceId: 'test-device-events',
        timestamp: new Date(),
        event: eventValue,
        status: 'online',
        location: 'Test Location'
      });
      
      // Set data as plain object, let the schema convert it to Map
      testRecord.data = {
        'TEST_FIELD': 'test_value',
        'REF1': '+5.00',
        'ACV': '1441.9'
      };
      
      await testRecord.save();
      console.log(`✅ Saved: event="${eventValue}"`);
    }
    
    console.log('\n📊 Verifying saved records:\n');
    
    // Query back and verify
    const savedRecords = await Telemetry.find({ deviceId: 'test-device-events' });
    console.log(`Total records saved: ${savedRecords.length}`);
    console.log('Unique events found:');
    
    const uniqueEvents = new Set(savedRecords.map(r => r.event));
    uniqueEvents.forEach(event => {
      const count = savedRecords.filter(r => r.event === event).length;
      console.log(`  "${event}": ${count} record(s)`);
    });
    
    // Test filtering each event type
    console.log('\n🔍 Testing filters:\n');
    
    const filters = [
      { name: 'NORMAL', values: [0, '0', 'NORMAL'] },
      { name: 'INT', values: [1, '1', 'INT', 'INTERRUPT'] },
      { name: 'DPOL', values: [3, '3', 'DPOL', 'DEPOL'] },
      { name: 'INST', values: [4, '4', 'INST', 'INSTANT'] }
    ];
    
    for (const filter of filters) {
      const regexPatterns = filter.values.filter(e => typeof e === 'string');
      const exactMatches = filter.values.filter(e => typeof e === 'number');
      
      const queryConditions = [];
      if (exactMatches.length > 0) {
        queryConditions.push({ event: { $in: exactMatches } });
      }
      if (regexPatterns.length > 0) {
        const regexStr = regexPatterns.map(p => p.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|');
        queryConditions.push({ event: { $regex: regexStr, $options: 'i' } });
      }
      
      const query = {
        deviceId: 'test-device-events',
        $or: queryConditions
      };
      
      const matchedRecords = await Telemetry.find(query);
      console.log(`Filter "${filter.name}": ${matchedRecords.length} records matched`);
      if (matchedRecords.length > 0) {
        console.log(`  Events: ${[...new Set(matchedRecords.map(r => r.event))].join(', ')}`);
      }
    }
    
    // Clean up test data
    await Telemetry.deleteMany({ deviceId: 'test-device-events' });
    console.log('\n✅ Test data cleaned up');
    
  } catch (error) {
    console.error('❌ Error:', error.message);
    process.exit(1);
  } finally {
    await mongoose.disconnect();
    console.log('✅ Disconnected from MongoDB');
  }
}

testEventSaving();
