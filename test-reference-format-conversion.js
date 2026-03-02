#!/usr/bin/env node

/**
 * Test Script: Reference Value Format Conversion
 * 
 * Tests the formatReceivedReferenceValue() function to ensure it correctly
 * converts both 3-digit and 4-digit reference value formats to decimal format.
 */

// Mock the formatReceivedReferenceValue function
function formatReceivedReferenceValue(value) {
  if (value === undefined || value === null) return null;
  
  let strValue = value.toString().trim();
  
  if (strValue.includes('.')) {
    return strValue;
  }
  
  const numValue = parseInt(strValue, 10);
  
  let formatted;
  if (Math.abs(numValue) >= 1000) {
    // 4-digit format: "3000" → 3000 → 3000/10000 = 0.30
    formatted = (numValue / 10000).toFixed(2);
    console.log(`📊 Reference value converted (4-digit format): ${value} → ${formatted}`);
  } else {
    // 3-digit format: "030" → 30 → 30/100 = 0.30
    formatted = (numValue / 100).toFixed(2);
    console.log(`📊 Reference value converted (3-digit format): ${value} → ${formatted}`);
  }
  
  return formatted;
}

console.log('\n🧪 === Reference Value Format Conversion Tests ===\n');

// Test cases
const testCases = [
  // 4-digit format (with extra zeros)
  { input: "3000", expected: "0.30", format: "4-digit", description: "Reference Fail (0.30V)" },
  { input: "6000", expected: "0.60", format: "4-digit", description: "Reference UP (0.60V)" },
  { input: "8000", expected: "0.80", format: "4-digit", description: "Reference OP (0.80V)" },
  { input: "1000", expected: "0.10", format: "4-digit", description: "Small value (0.10V)" },
  { input: "10000", expected: "1.00", format: "4-digit", description: "Large value (1.00V)" },
  
  // 3-digit format (original)
  { input: "030", expected: "0.30", format: "3-digit", description: "Reference Fail (0.30V)" },
  { input: "060", expected: "0.60", format: "3-digit", description: "Reference UP (0.60V)" },
  { input: "300", expected: "3.00", format: "3-digit", description: "Reference OP (3.00V)" },
  { input: "010", expected: "0.10", format: "3-digit", description: "Small value (0.10V)" },
  { input: "999", expected: "9.99", format: "3-digit", description: "Large value (9.99V)" },
  
  // Negative values
  { input: "-3000", expected: "-0.30", format: "4-digit", description: "Negative 4-digit (−0.30V)" },
  { input: "-030", expected: "-0.30", format: "3-digit", description: "Negative 3-digit (−0.30V)" },
  
  // Already decimal format
  { input: "0.30", expected: "0.30", format: "decimal", description: "Already decimal (0.30V)" },
  { input: "0.60", expected: "0.60", format: "decimal", description: "Already decimal (0.60V)" },
];

let passedTests = 0;
let failedTests = 0;

console.log('📌 Running conversion tests...\n');

testCases.forEach((testCase, index) => {
  const result = formatReceivedReferenceValue(testCase.input);
  const passed = result === testCase.expected;
  
  const status = passed ? '✅' : '❌';
  console.log(`${status} Test ${index + 1}: ${testCase.description}`);
  console.log(`   Input: "${testCase.input}" (${testCase.format} format)`);
  console.log(`   Expected: "${testCase.expected}"`);
  console.log(`   Got: "${result}"`);
  
  if (passed) {
    passedTests++;
  } else {
    failedTests++;
  }
  console.log();
});

// Summary
console.log('📊 === Test Summary ===');
console.log(`✅ Passed: ${passedTests}/${testCases.length}`);
console.log(`❌ Failed: ${failedTests}/${testCases.length}`);

if (failedTests === 0) {
  console.log('\n✅ All tests passed! Reference value conversion is working correctly.\n');
  process.exit(0);
} else {
  console.log('\n❌ Some tests failed! There may be issues with the conversion.\n');
  process.exit(1);
}
