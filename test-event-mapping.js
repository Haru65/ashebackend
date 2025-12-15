/**
 * Test Event Mapping Functionality
 * 
 * This script tests the new Event/Mode mapping feature to ensure
 * it correctly converts numeric codes to readable names.
 */

const { mapEventCode } = require('./utils/dataTransform');

console.log('🧪 Testing Event Mapping Functionality\n');

// Test cases for event mapping
const testCases = [
  { code: 0, expected: 'Normal' },
  { code: 1, expected: 'Interrupt' },
  { code: 2, expected: 'Manual' },
  { code: 3, expected: 'DEPOL' },
  { code: 4, expected: 'Instant' },
  { code: '0', expected: 'Normal' }, // Test string input
  { code: '3', expected: 'DEPOL' },   // Test string input
  { code: 99, expected: 'Unknown (99)' }, // Test unknown code
  { code: -1, expected: 'Unknown (-1)' }  // Test invalid code
];

console.log('Event Code Mapping Tests:');
console.log('========================');

let passed = 0;
let total = testCases.length;

testCases.forEach((test, index) => {
  const result = mapEventCode(test.code);
  const success = result === test.expected;
  
  console.log(`Test ${index + 1}: Code ${test.code} -> "${result}"`);
  console.log(`   Expected: "${test.expected}"`);
  console.log(`   Status: ${success ? '✅ PASS' : '❌ FAIL'}\n`);
  
  if (success) passed++;
});

console.log(`\n📊 Test Results: ${passed}/${total} tests passed`);

if (passed === total) {
  console.log('🎉 All event mapping tests passed!');
} else {
  console.log('⚠️  Some tests failed. Please check the implementation.');
}

// Test with sample device payload
console.log('\n' + '='.repeat(50));
console.log('Sample Device Data Transformation Test');
console.log('='.repeat(50));

const samplePayload = {
  LOG: 1234,
  EVENT: 1, // Should map to "Interrupt"
  REF1: 2.45,
  REF2: 3.21,
  REF3: 6.50, // Should display as "OPEN"
  DI1: 1,
  DI2: 0
};

console.log('Sample payload:', JSON.stringify(samplePayload, null, 2));
console.log('EVENT field:', samplePayload.EVENT, '-> should map to "Interrupt"');

// Test the actual transform function
const { transformDeviceData } = require('./utils/dataTransform');
const transformed = transformDeviceData(samplePayload, 'devices/TEST123/data');

// Find the EVENT metric
const eventMetric = transformed.metrics.find(m => m.type === 'EVENT');
if (eventMetric) {
  console.log('\nTransformed EVENT metric:');
  console.log('  Type:', eventMetric.type);
  console.log('  Value:', eventMetric.value);
  console.log('  Raw Value:', eventMetric.rawValue);
  console.log('  Display Value:', eventMetric.displayValue);
  console.log('  Expected: "Interrupt (1)"');
  
  const expectedValue = 'Interrupt (1)';
  if (eventMetric.value === expectedValue && eventMetric.displayValue === 'Interrupt') {
    console.log('  Status: ✅ PASS - Event mapping works correctly in data transform!');
  } else {
    console.log('  Status: ❌ FAIL - Event mapping not working in data transform');
  }
} else {
  console.log('  Status: ❌ FAIL - EVENT metric not found in transformed data');
}

console.log('\n🔄 Testing complete. Event mapping is now active for incoming device data.');