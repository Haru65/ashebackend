#!/usr/bin/env node

/**
 * Test Script: Electrode-Based Set UP Value Validation
 * Tests the new electrode-based validation for Set UP (Reference UP) values
 * 
 * Mapping:
 * - Electrode 0 (Cu/CuSO4): Set UP range 0.6 to 1.0
 * - Electrode 2 (Ag/AgCl): Set UP range 0.6 to 1.0
 * - Electrode 1 (Zinc): Set UP range -0.5 to -0.1
 */

const http = require('http');

const BASE_URL = 'http://localhost:5000';
const DEVICE_ID = '123';

// Test cases
const testCases = [
  {
    name: 'Cu/CuSO4 (0) - Valid Set UP (0.8)',
    electrode: 0,
    setupValue: 0.8,
    shouldPass: true
  },
  {
    name: 'Cu/CuSO4 (0) - Invalid Set UP (0.5) - Too Low',
    electrode: 0,
    setupValue: 0.5,
    shouldPass: false
  },
  {
    name: 'Cu/CuSO4 (0) - Invalid Set UP (1.2) - Too High',
    electrode: 0,
    setupValue: 1.2,
    shouldPass: false
  },
  {
    name: 'Ag/AgCl (2) - Valid Set UP (0.7)',
    electrode: 2,
    setupValue: 0.7,
    shouldPass: true
  },
  {
    name: 'Ag/AgCl (2) - Invalid Set UP (0.5) - Too Low',
    electrode: 2,
    setupValue: 0.5,
    shouldPass: false
  },
  {
    name: 'Zinc (1) - Valid Set UP (-0.3)',
    electrode: 1,
    setupValue: -0.3,
    shouldPass: true
  },
  {
    name: 'Zinc (1) - Invalid Set UP (-0.6) - Too Low',
    electrode: 1,
    setupValue: -0.6,
    shouldPass: false
  },
  {
    name: 'Zinc (1) - Invalid Set UP (0.0) - Too High',
    electrode: 1,
    setupValue: 0.0,
    shouldPass: false
  }
];

// Helper to make HTTP requests
const makeRequest = (method, path, body = null) => {
  return new Promise((resolve, reject) => {
    const options = {
      hostname: 'localhost',
      port: 5000,
      path: path,
      method: method,
      headers: {
        'Content-Type': 'application/json'
      }
    };

    const req = http.request(options, (res) => {
      let data = '';
      res.on('data', (chunk) => { data += chunk; });
      res.on('end', () => {
        try {
          const parsed = JSON.parse(data);
          resolve({ status: res.statusCode, body: parsed });
        } catch (e) {
          resolve({ status: res.statusCode, body: data });
        }
      });
    });

    req.on('error', reject);
    if (body) {
      req.write(JSON.stringify(body));
    }
    req.end();
  });
};

// Run tests
const runTests = async () => {
  console.log('🧪 Testing Electrode-Based Set UP Validation\n');
  console.log('='.repeat(70));
  
  let passed = 0;
  let failed = 0;

  for (const testCase of testCases) {
    console.log(`\n📋 Test: ${testCase.name}`);
    console.log(`   Electrode: ${testCase.electrode}`);
    console.log(`   Set UP Value: ${testCase.setupValue}`);

    try {
      // First, set the electrode type
      await makeRequest('POST', `/api/devices/${DEVICE_ID}/configure/electrode`, {
        electrodeType: testCase.electrode
      });

      // Then, attempt to set the alarm configuration
      const response = await makeRequest('POST', `/api/alarms/${DEVICE_ID}`, {
        setup: { value: testCase.setupValue },
        setop: { value: 0.5 },
        reffail: { value: 0.9 }
      });

      const isSuccess = response.status === 200 && response.body.success;

      if (testCase.shouldPass) {
        if (isSuccess) {
          console.log(`   ✅ PASS: Value accepted as expected`);
          passed++;
        } else {
          console.log(`   ❌ FAIL: Value rejected but should have been accepted`);
          console.log(`   Response: ${JSON.stringify(response.body)}`);
          failed++;
        }
      } else {
        if (!isSuccess) {
          console.log(`   ✅ PASS: Value rejected as expected`);
          if (response.body.validation) {
            console.log(`   Validation Error: ${response.body.error}`);
            console.log(`   Allowed Range: ${response.body.validation.allowedMin} to ${response.body.validation.allowedMax}`);
          }
          passed++;
        } else {
          console.log(`   ❌ FAIL: Value accepted but should have been rejected`);
          failed++;
        }
      }
    } catch (error) {
      console.log(`   ⚠️ ERROR: ${error.message}`);
      failed++;
    }
  }

  console.log(`\n${'='.repeat(70)}`);
  console.log(`\n📊 Test Results: ${passed} passed, ${failed} failed out of ${testCases.length} tests`);
  
  if (failed === 0) {
    console.log('✅ All tests passed!');
  } else {
    console.log(`❌ ${failed} test(s) failed`);
  }
};

// Run the tests
runTests().catch(console.error);
