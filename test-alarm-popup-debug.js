/**
 * Comprehensive Debug Test for Alarm Popup Flow
 * Tests the complete flow from backend to frontend
 */

const BASE_URL = 'http://localhost:5000';

async function testAlarmPopupFlow() {
  console.log('🚀 Starting Alarm Popup Flow Debug Test...\n');
  
  try {
    // Test 1: Get device to trigger alarm on
    console.log('1️⃣ Fetching devices...');
    const devicesRes = await fetch(`${BASE_URL}/api/iot/devices`);
    const devicesData = await devicesRes.json();
    
    if (!devicesData.success || devicesData.data.length === 0) {
      console.error('❌ No devices found');
      return;
    }
    
    const device = devicesData.data[0];
    console.log(`✅ Found device: ${device.deviceName} (${device.deviceId})\n`);
    
    // Test 2: Get alarms for this device
    console.log('2️⃣ Fetching alarms for device...');
    const alarmsRes = await fetch(`${BASE_URL}/api/alarms/device/${device.deviceName}`);
    const alarmsData = await alarmsRes.json();
    
    if (!alarmsData.success || alarmsData.data.length === 0) {
      console.error('❌ No alarms configured for device');
      return;
    }
    
    const alarm = alarmsData.data[0];
    console.log(`✅ Found alarm: ${alarm.name}\n`);
    
    // Test 3: Check initial alarm triggers
    console.log('3️⃣ Checking alarm triggers BEFORE triggering new alarm...');
    const triggersBeforeRes = await fetch(`${BASE_URL}/api/alarms/triggers/recent?hours=24&limit=50`);
    const triggersBeforeData = await triggersBeforeRes.json();
    
    console.log(`📊 Before - Total triggers: ${triggersBeforeData.total}`);
    console.log(`📊 Before - Success: ${triggersBeforeData.success}`);
    console.log(`📊 Before - Data count: ${triggersBeforeData.data?.length || 0}\n`);
    
    const countBefore = triggersBeforeData.total || 0;
    
    // Test 4: Simulate alarm trigger
    console.log('4️⃣ Simulating alarm trigger by publishing test data...');
    const testDataRes = await fetch(`${BASE_URL}/api/test-alarm-trigger`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        deviceId: device.deviceId,
        alarmId: alarm._id
      })
    });
    
    if (testDataRes.ok) {
      console.log('✅ Test alarm trigger sent\n');
    } else {
      console.log('⚠️ Test endpoint may not exist, continuing anyway...\n');
    }
    
    // Test 5: Wait and check triggers
    console.log('5️⃣ Waiting 3 seconds for alarm to be processed...');
    await new Promise(resolve => setTimeout(resolve, 3000));
    
    console.log('6️⃣ Checking alarm triggers AFTER triggering new alarm...');
    const triggersAfterRes = await fetch(`${BASE_URL}/api/alarms/triggers/recent?hours=24&limit=50`);
    const triggersAfterData = await triggersAfterRes.json();
    
    console.log(`📊 After - Total triggers: ${triggersAfterData.total}`);
    console.log(`📊 After - Success: ${triggersAfterData.success}`);
    console.log(`📊 After - Data count: ${triggersAfterData.data?.length || 0}`);
    
    if (triggersAfterData.data && triggersAfterData.data.length > 0) {
      console.log(`\n📋 Most recent trigger:`);
      const recent = triggersAfterData.data[0];
      console.log(`   - Alarm: ${recent.alarm_name}`);
      console.log(`   - Device: ${recent.device_name}`);
      console.log(`   - Reason: ${recent.trigger_reason}`);
      console.log(`   - Time: ${new Date(recent.triggered_at).toLocaleString()}`);
    }
    
    const countAfter = triggersAfterData.total || 0;
    const newAlarmsCount = countAfter - countBefore;
    
    console.log(`\n🎯 Result Summary:`);
    console.log(`   Before: ${countBefore} alarms`);
    console.log(`   After:  ${countAfter} alarms`);
    console.log(`   New:    ${newAlarmsCount} alarm(s)`);
    
    if (newAlarmsCount > 0) {
      console.log(`\n✅ SUCCESS - Alarm was created and is queryable!`);
      console.log(`   Frontend should receive popup for ${newAlarmsCount} new alarm(s)`);
    } else {
      console.log(`\n⚠️ WARNING - No new alarms found in API!`);
      console.log(`   Check:`)  ;
      console.log(`   1. Is alarm monitoring service running?`);
      console.log(`   2. Are alarms properly configured?`);
      console.log(`   3. Check backend logs for [Alarm Monitor] messages`);
    }
    
    // Test 7: Continuous polling simulation
    console.log(`\n\n7️⃣ Simulating frontend polling (5 iterations)...`);
    for (let i = 1; i <= 5; i++) {
      console.log(`\n   Poll #${i} at ${new Date().toLocaleTimeString()}`);
      const pollRes = await fetch(`${BASE_URL}/api/alarms/triggers/recent?hours=24&limit=50`);
      const pollData = await pollRes.json();
      
      if (pollData.success) {
        console.log(`   ✅ API Response: ${pollData.total} total triggers`);
        if (pollData.data && pollData.data.length > 0) {
          console.log(`   📋 Latest: ${pollData.data[0].alarm_name}`);
        }
      } else {
        console.log(`   ❌ API Error: ${pollData.message}`);
      }
      
      if (i < 5) {
        await new Promise(resolve => setTimeout(resolve, 2000));
      }
    }
    
    console.log('\n\n✅ Debug test complete!\n');
    
  } catch (error) {
    console.error('❌ Test failed:', error.message);
  }
}

// Run the test
testAlarmPopupFlow();
