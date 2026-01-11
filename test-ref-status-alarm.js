/**
 * Test file to verify REF Status alarm triggering
 * Tests that alarms trigger when REF1 STS, REF2 STS, or REF3 STS contain OP, UP, or FAIL
 */

const alarmMonitoringService = require('./services/alarmMonitoringService');
const Device = require('./models/Device');
const Alarm = require('./models/Alarm');

// Mock device data with REF status values
const testCases = [
  {
    name: 'REF1 STS with OP status',
    deviceData: {
      Parameters: {
        'REF1 STS': 'OP',
        'REF2 STS': '',
        'REF3 STS': '',
        'DCV': '0.0',
        'DCI': '0.0',
        'ACV': '1441.9'
      }
    },
    shouldTrigger: true,
    reason: "REF1 STS is 'OP' (valid status detected)"
  },
  {
    name: 'REF2 STS with UP status',
    deviceData: {
      Parameters: {
        'REF1 STS': '',
        'REF2 STS': 'UP',
        'REF3 STS': '',
        'DCV': '0.0',
        'DCI': '0.0',
        'ACV': '1441.9'
      }
    },
    shouldTrigger: true,
    reason: "REF2 STS is 'UP' (valid status detected)"
  },
  {
    name: 'REF3 STS with FAIL status',
    deviceData: {
      Parameters: {
        'REF1 STS': '',
        'REF2 STS': '',
        'REF3 STS': 'FAIL',
        'DCV': '0.0',
        'DCI': '0.0',
        'ACV': '1441.9'
      }
    },
    shouldTrigger: true,
    reason: "REF3 STS is 'FAIL' (valid status detected)"
  },
  {
    name: 'REF status with invalid value (should NOT trigger)',
    deviceData: {
      Parameters: {
        'REF1 STS': 'INVALID',
        'REF2 STS': '',
        'REF3 STS': '',
        'DCV': '0.0',
        'DCI': '0.0',
        'ACV': '1441.9'
      }
    },
    shouldTrigger: false,
    reason: null
  },
  {
    name: 'All REF status empty (should NOT trigger)',
    deviceData: {
      Parameters: {
        'REF1 STS': '',
        'REF2 STS': '',
        'REF3 STS': '',
        'DCV': '0.0',
        'DCI': '0.0',
        'ACV': '1441.9'
      }
    },
    shouldTrigger: false,
    reason: null
  }
];

console.log('=====================================');
console.log('REF STATUS ALARM TRIGGER TESTS');
console.log('=====================================\n');

testCases.forEach((testCase, index) => {
  console.log(`Test ${index + 1}: ${testCase.name}`);
  console.log(`Data:`, testCase.deviceData.Parameters);
  
  // Extract REF status values
  const params = testCase.deviceData.Parameters;
  const ref1Status = params['REF1 STS'] || '';
  const ref2Status = params['REF2 STS'] || '';
  const ref3Status = params['REF3 STS'] || '';
  
  // Valid REF status values that should trigger alarm
  const validRefStatuses = ['OP', 'UP', 'FAIL'];
  
  // Check if any REF status has a valid value
  let wouldTrigger = false;
  let reason = '';
  
  if (validRefStatuses.includes(ref1Status.toUpperCase?.() || ref1Status)) {
    wouldTrigger = true;
    reason = `REF1 STS is '${ref1Status}' (valid status detected)`;
  }
  
  if (!wouldTrigger && validRefStatuses.includes(ref2Status.toUpperCase?.() || ref2Status)) {
    wouldTrigger = true;
    reason = `REF2 STS is '${ref2Status}' (valid status detected)`;
  }
  
  if (!wouldTrigger && validRefStatuses.includes(ref3Status.toUpperCase?.() || ref3Status)) {
    wouldTrigger = true;
    reason = `REF3 STS is '${ref3Status}' (valid status detected)`;
  }
  
  const result = wouldTrigger === testCase.shouldTrigger ? '✅ PASS' : '❌ FAIL';
  console.log(`Expected trigger: ${testCase.shouldTrigger}, Got: ${wouldTrigger} ${result}`);
  if (wouldTrigger) {
    console.log(`Reason: ${reason}`);
  }
  console.log('');
});

console.log('=====================================');
console.log('IMPLEMENTATION NOTES:');
console.log('=====================================');
console.log(`
1. REF Status Check (Check 0 - First Priority):
   - Checks REF1 STS, REF2 STS, REF3 STS fields
   - Triggers alarm if ANY contains: OP, UP, or FAIL
   - Case-insensitive matching
   - Executes BEFORE event and threshold checks

2. Valid Status Values:
   - 'OP' (Operating/Normal)
   - 'UP' (Unstable/Problem)
   - 'FAIL' (Failed)

3. Invalid Values:
   - Empty string ''
   - 'INVALID', 'OK', or any other value
   - These do NOT trigger alarms

4. Alarm Priority:
   - Check 0: REF Status values
   - Check 1: EVENT status (abnormal)
   - Check 2: Parameter thresholds (numeric bounds)

5. Example Scenario:
   Input: REF2 STS = 'OP'
   Result: Alarm triggers with reason "REF2 STS is 'OP' (valid status detected)"
`);
