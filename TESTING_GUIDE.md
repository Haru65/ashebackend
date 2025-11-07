# Testing Guide for IoT Device Management System

## Overview

This guide covers all testing approaches for the IoT device management system, including integration tests, API tests, and MQTT message verification.

## Test Files

### 1. Integration Test Suite (`test-integration.js`)
Comprehensive end-to-end test that covers:
- Database seeding
- MQTT message publishing
- API endpoint verification
- Historical data storage
- Device status updates
- Offline detection

### 2. Jest Unit Tests (`__tests__/device.test.js`)
Unit and integration tests using Jest and Supertest:
- API endpoint testing
- Request/response validation
- Data persistence verification
- Error handling

### 3. Test Configuration
- `jest.setup.js` - Jest configuration and global utilities
- `test-package.json` - Test dependencies and scripts
- `.env.example` - Environment configuration template

## Prerequisites

### Required Services

1. **MongoDB** - Running on `localhost:27017` or configured via `MONGODB_URI`
2. **Backend Server** - Running on `localhost:3001` or configured via `API_BASE_URL`
3. **MQTT Broker** - Default: `test.mosquitto.org` or local broker

### Install Test Dependencies

```bash
cd BACKEND

# Install test dependencies
npm install --save-dev jest@29.7.0 supertest@6.3.3 @types/jest@29.5.5

# Or copy from test-package.json
npm install
```

## Running Tests

### Method 1: Integration Test (Recommended for Initial Testing)

This is a standalone test that doesn't require Jest.

```bash
cd BACKEND
node test-integration.js
```

**What it tests:**
1. ✅ Seeds 2 test devices in MongoDB
2. ✅ Publishes MQTT messages to `devices/sensor1/data` and `devices/sensor2/data`
3. ✅ Fetches device list via API
4. ✅ Fetches sensor1 details and verifies topic
5. ✅ Checks historical data storage
6. ✅ Verifies device status updates

**Expected Output:**
```
🚀 Starting IoT Device Management System Tests

Configuration:
  - MongoDB: mongodb://localhost:27017/iot-platform
  - MQTT Broker: mqtt://test.mosquitto.org
  - API Base URL: http://localhost:3001
═══════════════════════════════════════════════

📦 Setting up database...
✅ Connected to MongoDB
🗑️  Cleared existing test data

🧪 Test 1: Seeding devices...
✅ Seeded 2 devices
✅ Verified device seeding

🧪 Test 2: Publishing MQTT messages...
✅ Connected to MQTT broker
✅ Published message to devices/sensor1/data
✅ Published message to devices/sensor2/data

...

📊 Test Summary:
   ✅ Passed: 6
   ❌ Failed: 0
   ⏭️  Skipped: 1
```

### Method 2: Jest Tests

```bash
cd BACKEND

# Run all tests
npm test

# Run tests in watch mode
npm run test:watch

# Run with coverage
npm run test:coverage

# Run specific test file
npx jest __tests__/device.test.js
```

### Method 3: Manual MQTT Testing

#### Using Mosquitto CLI

**Install Mosquitto:**
```bash
# Windows (with Chocolatey)
choco install mosquitto

# macOS
brew install mosquitto

# Ubuntu/Debian
sudo apt-get install mosquitto-clients
```

**Publish Test Messages:**
```bash
# Publish to sensor1
mosquitto_pub -h test.mosquitto.org -t "devices/sensor1/data" -m '{"battery":87,"signal":93,"temperature":23.0}'

# Publish to sensor2
mosquitto_pub -h test.mosquitto.org -t "devices/sensor2/data" -m '{"battery":80,"signal":89,"temperature":24.5}'

# Subscribe to all device topics (for monitoring)
mosquitto_sub -h test.mosquitto.org -t "devices/+/data"
```

#### Using Node.js MQTT Client

Create a simple test publisher:

```javascript
// test-mqtt-publish.js
const mqtt = require('mqtt');

const client = mqtt.connect('mqtt://test.mosquitto.org');

client.on('connect', () => {
  console.log('Connected to MQTT broker');
  
  setInterval(() => {
    const data = {
      battery: Math.floor(Math.random() * 100),
      signal: Math.floor(Math.random() * 100),
      temperature: (Math.random() * 10 + 20).toFixed(1),
    };
    
    client.publish('devices/sensor1/data', JSON.stringify(data));
    console.log('Published to sensor1:', data);
  }, 5000);
});
```

Run it:
```bash
node test-mqtt-publish.js
```

## Environment Configuration

### Create `.env` file

Copy from `.env.example`:

```bash
cp .env.example .env
```

**Key variables for testing:**

```env
# Database
MONGODB_URI=mongodb://localhost:27017/iot-platform

# Server
PORT=3001
NODE_ENV=development

# MQTT
MQTT_BROKER_URL=mqtt://test.mosquitto.org

# Device Management
DEVICE_STATUS_CHECK_INTERVAL=2
DEVICE_OFFLINE_THRESHOLD=5
DEVICE_WARNING_THRESHOLD=3
```

## Test Scenarios

### Scenario 1: Complete System Test

**Steps:**

1. **Seed the database:**
   ```bash
   node seedDevices.js
   ```

2. **Start backend services:**
   ```bash
   node index.js
   ```
   
   Look for:
   ```
   [MQTT Client] ✅ Connected to MQTT broker
   [MQTT Client] 📡 Subscribed to topic: devices/+/data
   [Device Monitor] 🔍 Starting device status monitor...
   ```

3. **Run integration tests:**
   ```bash
   # In another terminal
   node test-integration.js
   ```

4. **Verify in MongoDB:**
   ```bash
   mongosh
   use iot-platform
   
   # Check devices
   db.devices.find().pretty()
   
   # Check history
   db.devicehistories.find().sort({timestamp: -1}).limit(10).pretty()
   ```

### Scenario 2: Real-time Device Simulation

**Steps:**

1. **Start device simulator:**
   ```bash
   cd device-sim
   node server.js
   ```

2. **Start backend:**
   ```bash
   cd BACKEND
   node index.js
   ```

3. **Monitor logs:**
   - Backend should show MQTT messages being received
   - Device status should update to "online"
   - Historical data should be stored

4. **Stop device simulator** and wait 5+ minutes:
   - Device status should change to "offline"

### Scenario 3: API Testing with Postman/curl

**Get device list:**
```bash
curl http://localhost:3001/api/devices \
  -H "Authorization: Bearer YOUR_TOKEN"
```

**Get device details:**
```bash
curl http://localhost:3001/api/devices/DEVICE_123 \
  -H "Authorization: Bearer YOUR_TOKEN"
```

**Update device data:**
```bash
curl -X POST http://localhost:3001/api/devices/DEVICE_123/data \
  -H "Authorization: Bearer YOUR_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"battery":88,"signal":92,"temperature":23.5}'
```

## Verifying Test Results

### Check Device Status

```bash
mongosh
use iot-platform

# Get all devices with their status
db.devices.find({}, {
  deviceId: 1,
  name: 1,
  'status.state': 1,
  'status.lastSeen': 1
}).pretty()
```

### Check Historical Data

```bash
# Get recent history for sensor1
db.devicehistories.find({
  deviceId: { $in: ['DEVICE_SENSOR1', 'sensor1'] }
}).sort({ timestamp: -1 }).limit(10).pretty()

# Count total history entries
db.devicehistories.countDocuments()
```

### Check MQTT Topic Mapping

```bash
# Verify topics are stored correctly
db.devices.find({}, {
  deviceId: 1,
  'mqtt.topics.data': 1
}).pretty()

# Should show:
# sensor1 -> devices/sensor1/data
# sensor2 -> devices/sensor2/data
```

## Troubleshooting

### Tests Failing to Connect to MongoDB

**Error:** `MongoNetworkError: connect ECONNREFUSED`

**Solutions:**
1. Ensure MongoDB is running: `mongod` or `brew services start mongodb-community`
2. Check connection string in `.env`
3. Try connecting manually: `mongosh`

### Tests Failing to Connect to MQTT Broker

**Error:** `Error: Connection refused`

**Solutions:**
1. Check broker URL: `mqtt://test.mosquitto.org` (public broker)
2. Use local broker: `mqtt://localhost:1883` (requires local Mosquitto)
3. Check firewall settings
4. Try alternative broker: `mqtt://broker.hivemq.com`

### Backend Not Receiving MQTT Messages

**Checklist:**
1. ✅ Backend MQTT client connected (check logs)
2. ✅ Subscribed to correct topic pattern (`devices/+/data`)
3. ✅ Publishing to matching topic (`devices/sensor1/data`)
4. ✅ Message format is valid JSON
5. ✅ MongoDB is connected

**Debug:**
```javascript
// Add in mqttClientService.js handleMessage function
console.log('RAW MESSAGE:', message.toString());
console.log('PARSED DATA:', data);
console.log('EXTRACTED DEVICE ID:', deviceId);
```

### Historical Data Not Being Stored

**Checklist:**
1. ✅ DeviceHistory model imported
2. ✅ `storeHistory()` function being called
3. ✅ No errors in backend logs
4. ✅ TTL index not deleting data too quickly (30 days default)

**Verify:**
```bash
# Check DeviceHistory collection exists
mongosh
use iot-platform
show collections

# Check indexes
db.devicehistories.getIndexes()
```

### Device Status Not Updating

**Checklist:**
1. ✅ Device status monitor running (check logs every 2 minutes)
2. ✅ `lastSeen` timestamp updating when messages received
3. ✅ Thresholds configured correctly (3min warning, 5min offline)

**Manual check:**
```javascript
// In MongoDB
db.devices.updateOne(
  { deviceId: 'DEVICE_SENSOR1' },
  { 
    $set: { 
      'status.lastSeen': new Date(),
      'status.state': 'online'
    }
  }
)
```

## Performance Testing

### Load Test with Multiple Messages

```javascript
// load-test.js
const mqtt = require('mqtt');
const client = mqtt.connect('mqtt://test.mosquitto.org');

client.on('connect', () => {
  console.log('Starting load test...');
  
  let count = 0;
  const interval = setInterval(() => {
    const devices = ['sensor1', 'sensor2', 'sensor3', 'sensor4', 'sensor5'];
    
    devices.forEach(deviceId => {
      const data = {
        battery: Math.random() * 100,
        signal: Math.random() * 100,
        temperature: Math.random() * 20 + 15,
      };
      
      client.publish(`devices/${deviceId}/data`, JSON.stringify(data));
      count++;
    });
    
    console.log(`Published ${count} messages`);
    
    if (count >= 1000) {
      clearInterval(interval);
      client.end();
      console.log('Load test complete');
    }
  }, 100);
});
```

## Continuous Integration

### GitHub Actions Example

```yaml
# .github/workflows/test.yml
name: Tests

on: [push, pull_request]

jobs:
  test:
    runs-on: ubuntu-latest
    
    services:
      mongodb:
        image: mongo:7.0
        ports:
          - 27017:27017
    
    steps:
      - uses: actions/checkout@v3
      
      - name: Setup Node.js
        uses: actions/setup-node@v3
        with:
          node-version: '18'
      
      - name: Install dependencies
        run: npm install
      
      - name: Run tests
        run: npm test
        env:
          MONGODB_URI: mongodb://localhost:27017/iot-platform-test
          MQTT_BROKER_URL: mqtt://test.mosquitto.org
```

## Next Steps

1. ✅ Run `node test-integration.js` to verify basic functionality
2. ✅ Seed database with `node seedDevices.js`
3. ✅ Start backend with `node index.js`
4. ✅ Start frontend with `npm run dev`
5. ✅ Open browser and test device pages
6. ✅ Publish MQTT messages and verify real-time updates
7. ✅ Check MongoDB for stored data
8. ✅ Run Jest tests with `npm test`

## Resources

- [MQTT.js Documentation](https://github.com/mqttjs/MQTT.js)
- [Jest Documentation](https://jestjs.io/)
- [Supertest Documentation](https://github.com/ladjs/supertest)
- [Mosquitto Documentation](https://mosquitto.org/documentation/)
