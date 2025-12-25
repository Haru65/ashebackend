#!/usr/bin/env node

/**
 * Test: Set UP and Set OP Electrode-Based Validation
 * Tests both Set UP and Set OP values with electrode-based ranges
 */

const http = require('http');

const BASE_URL = 'http://localhost:5000';
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
    name: 'Cu/CuSO4 - Valid Set UP (0.8) & Set OP (2.0)',
    electrode: 0,
    setup: 0.8,
    setop: 2.0,
    shouldPass: true
  },
  {
    name: 'Cu/CuSO4 - Invalid Set UP (0.5) - too low',
    electrode: 0,
    setup: 0.5,
    setop: 2.0,
    shouldPass: false,
    expectedField: 'Set UP'
  },
  {
    name: 'Cu/CuSO4 - Invalid Set OP (1.0) - too low',
    electrode: 0,
    setup: 0.8,
    setop: 1.0,
    shouldPass: false,
    expectedField: 'Set OP'
  },
  {
    name: 'Cu/CuSO4 - Invalid Set OP (3.5) - too high',
    electrode: 0,
    setup: 0.8,
    setop: 3.5,
    shouldPass: false,
    expectedField: 'Set OP'
  },
  {
    name: 'Zinc - Valid Set UP (-0.2) & Set OP (1.0)',
    electrode: 1,
    setup: -0.2,
    setop: 1.0,
    shouldPass: true
  },
  {
    name: 'Zinc - Invalid Set UP (-0.6) - too low',
    electrode: 1,
    setup: -0.6,
    setop: 1.0,
    shouldPass: false,
    expectedField: 'Set UP'
  },
  {
    name: 'Zinc - Invalid Set OP (0.05) - too low',
    electrode: 1,
    setup: -0.2,
    setop: 0.05,
    shouldPass: false,
    expectedField: 'Set OP'
  },
  {
    name: 'Zinc - Invalid Set OP (2.0) - too high',
    electrode: 1,
    setup: -0.2,
    setop: 2.0,
    shouldPass: false,
    expectedField: 'Set OP'
  },
  {
    name: 'Ag/AgCl - Valid Set UP (0.9) & Set OP (2.5)',
    electrode: 2,
    setup: 0.9,
    setop: 2.5,
    shouldPass: true
  }
];

const test = async () => {
  console.log('🧪 Test: Set UP and Set OP Electrode Validation\n');
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
        reffail: { value: 0.9 }
      });

      const isSuccess = response.status === 200 && response.body.success;

      if (testCase.shouldPass) {
        if (isSuccess) {
          console.log(`   ✅ PASS: Values accepted as expected`);
          passed++;
        } else {
          console.log(`   ❌ FAIL: Values rejected but should have been accepted`);
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
            console.log(`   ✅ PASS: Value rejected as expected`);
            if (response.body.validation) {
              console.log(`   Field: ${response.body.validation.field}`);
              console.log(`   Range: ${response.body.validation.allowedMin} to ${response.body.validation.allowedMax}`);
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
    console.log('✅ All tests passed!');
  } else {
    console.log(`❌ ${failed} test(s) failed`);
  }
};

test().catch(console.error);
