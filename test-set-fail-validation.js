#!/usr/bin/env node

/**
 * Test: Set Fail Static Value Validation
 * Tests that Set Fail values are restricted to static values per electrode
 * 
 * Cu/CuSO4 (0) and Ag/AgCl (2): 0.3 (static)
 * Zinc (1): -0.8 (static)
 */

const http = require('http');

const DEVICE_ID = '123';

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

const testCases = [
  {
    name: 'Cu/CuSO4 - Set Fail 0.3 (valid static value)',
    electrode: 0,
    setup: 0.8,
    setop: 2.0,
    reffail: 0.3,
    shouldPass: true
  },
  {
    name: 'Cu/CuSO4 - Set Fail 0.9 (invalid, not static)',
    electrode: 0,
    setup: 0.8,
    setop: 2.0,
    reffail: 0.9,
    shouldPass: false,
    expectedField: 'Set Fail'
  },
  {
    name: 'Cu/CuSO4 - Set Fail 0.5 (invalid, not static)',
    electrode: 0,
    setup: 0.8,
    setop: 2.0,
    reffail: 0.5,
    shouldPass: false,
    expectedField: 'Set Fail'
  },
  {
    name: 'Ag/AgCl - Set Fail 0.3 (valid static value)',
    electrode: 2,
    setup: 0.8,
    setop: 2.0,
    reffail: 0.3,
    shouldPass: true
  },
  {
    name: 'Ag/AgCl - Set Fail -0.8 (invalid for Ag/AgCl)',
    electrode: 2,
    setup: 0.8,
    setop: 2.0,
    reffail: -0.8,
    shouldPass: false,
    expectedField: 'Set Fail'
  },
  {
    name: 'Zinc - Set Fail -0.8 (valid static value)',
    electrode: 1,
    setup: -0.2,
    setop: 1.0,
    reffail: -0.8,
    shouldPass: true
  },
  {
    name: 'Zinc - Set Fail 0.3 (invalid for Zinc)',
    electrode: 1,
    setup: -0.2,
    setop: 1.0,
    reffail: 0.3,
    shouldPass: false,
    expectedField: 'Set Fail'
  },
  {
    name: 'Zinc - Set Fail -0.5 (invalid, not static)',
    electrode: 1,
    setup: -0.2,
    setop: 1.0,
    reffail: -0.5,
    shouldPass: false,
    expectedField: 'Set Fail'
  }
];

const test = async () => {
  console.log('🧪 Test: Set Fail Static Value Validation\n');
  console.log('═'.repeat(80));
  
  let passed = 0;
  let failed = 0;

  for (const testCase of testCases) {
    console.log(`\n📋 ${testCase.name}`);

    try {
      // Set electrode
      await makeRequest('POST', `/api/devices/${DEVICE_ID}/configure/electrode`, {
        electrodeType: testCase.electrode
      });

      // Set alarm values
      const response = await makeRequest('POST', `/api/alarms/${DEVICE_ID}`, {
        setup: { value: testCase.setup },
        setop: { value: testCase.setop },
        reffail: { value: testCase.reffail }
      });

      const isSuccess = response.status === 200 && response.body.success;

      if (testCase.shouldPass) {
        if (isSuccess) {
          console.log(`   ✅ PASS: Value accepted as expected`);
          console.log(`   Set Fail = ${testCase.reffail} (static value confirmed)`);
          passed++;
        } else {
          console.log(`   ❌ FAIL: Value rejected but should have been accepted`);
          console.log(`   Response: ${response.body.error}`);
          failed++;
        }
      } else {
        if (!isSuccess) {
          if (testCase.expectedField && response.body.validation?.field !== testCase.expectedField) {
            console.log(`   ⚠️ PARTIAL: Value rejected but for wrong field`);
            console.log(`   Expected field: ${testCase.expectedField}`);
            console.log(`   Got field: ${response.body.validation?.field}`);
            failed++;
          } else {
            console.log(`   ✅ PASS: Value rejected as expected (static value enforced)`);
            if (response.body.validation) {
              console.log(`   Static value required: ${response.body.validation.staticValue}`);
            }
            passed++;
          }
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

  console.log(`\n${'═'.repeat(80)}`);
  console.log(`\n📊 Test Results: ${passed} passed, ${failed} failed out of ${testCases.length} tests`);
  
  if (failed === 0) {
    console.log('✅ All tests passed! Set Fail static values are properly enforced.');
  } else {
    console.log(`❌ ${failed} test(s) failed`);
  }
};

test().catch(console.error);
