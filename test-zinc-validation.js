#!/usr/bin/env node

/**
 * Quick Test: Zinc Electrode Validation
 * Tests that the system properly rejects 0.90 for Zinc electrode
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

const test = async () => {
  console.log('🧪 Quick Test: Zinc Electrode Validation\n');
  
  try {
    // Step 1: Set electrode to Zinc (Type 1)
    console.log('Step 1️⃣: Setting electrode to Zinc (Type 1)...');
    const electrodeResponse = await makeRequest('POST', `/api/devices/${DEVICE_ID}/configure/electrode`, {
      electrodeType: 1
    });
    console.log(`Status: ${electrodeResponse.status}`);
    console.log(`Response:`, JSON.stringify(electrodeResponse.body, null, 2));
    
    // Step 2: Try to set Set UP to 0.90 (should FAIL for Zinc)
    console.log('\n\nStep 2️⃣: Attempting to set Set UP to 0.90 for Zinc electrode...');
    console.log('Expected: ❌ VALIDATION ERROR (0.90 is out of range for Zinc)\n');
    
    const alarmResponse = await makeRequest('POST', `/api/alarms/${DEVICE_ID}`, {
      setup: { value: 0.90 },
      setop: { value: 0.50 },
      reffail: { value: 0.90 }
    });
    
    console.log(`Status: ${alarmResponse.status}`);
    console.log(`Response:`, JSON.stringify(alarmResponse.body, null, 2));
    
    if (alarmResponse.status === 400 && !alarmResponse.body.success) {
      console.log('\n\n✅ SUCCESS: Validation correctly rejected 0.90 for Zinc electrode');
      if (alarmResponse.body.validation) {
        console.log(`   Allowed range: ${alarmResponse.body.validation.allowedMin} to ${alarmResponse.body.validation.allowedMax}`);
      }
    } else {
      console.log('\n\n❌ FAILURE: Validation should have rejected 0.90 for Zinc electrode');
    }
    
    // Step 3: Set a valid value for Zinc (-0.3)
    console.log('\n\nStep 3️⃣: Setting valid Set UP value -0.3 for Zinc electrode...');
    console.log('Expected: ✅ SUCCESS\n');
    
    const validResponse = await makeRequest('POST', `/api/alarms/${DEVICE_ID}`, {
      setup: { value: -0.3 },
      setop: { value: -0.2 },
      reffail: { value: -0.4 }
    });
    
    console.log(`Status: ${validResponse.status}`);
    console.log(`Response:`, JSON.stringify(validResponse.body, null, 2));
    
    if (validResponse.status === 200 && validResponse.body.success) {
      console.log('\n✅ SUCCESS: Valid value -0.3 was accepted for Zinc electrode');
    } else {
      console.log('\n❌ FAILURE: Valid value -0.3 should have been accepted');
    }
    
  } catch (error) {
    console.error('❌ ERROR:', error.message);
  }
};

test();
