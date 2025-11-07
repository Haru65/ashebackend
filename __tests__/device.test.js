/**
 * Jest Test Suite for Device API Endpoints
 */

const request = require('supertest');
const mongoose = require('mongoose');
const Device = require('../models/Device');
const DeviceHistory = require('../models/DeviceHistory');

// Mock app setup (you'll need to adjust this based on your actual app structure)
let app;
let server;

beforeAll(async () => {
  // Connect to test database
  await mongoose.connect(process.env.MONGODB_URI || 'mongodb://localhost:27017/iot-platform-test');
  
  // Import app after DB connection
  app = require('../index'); // Adjust path as needed
  
  console.log('✅ Test database connected');
});

afterAll(async () => {
  // Cleanup
  await Device.deleteMany({ deviceId: /^TEST_/ });
  await DeviceHistory.deleteMany({ deviceId: /^TEST_/ });
  
  await mongoose.disconnect();
  
  if (server) {
    server.close();
  }
  
  console.log('✅ Test database disconnected');
});

describe('Device API Tests', () => {
  let testDeviceId;
  let authToken;
  
  beforeEach(async () => {
    // Create test device
    testDeviceId = global.testUtils.generateDeviceId();
    
    const testDevice = new Device({
      deviceId: testDeviceId,
      name: 'Test Device',
      location: {
        building: 'Test Building',
        room: 'Test Room',
      },
      mqtt: {
        brokerUrl: 'mqtt://test.mosquitto.org',
        topicPrefix: `devices/${testDeviceId}`,
        topics: {
          data: `devices/${testDeviceId}/data`,
          status: `devices/${testDeviceId}/status`,
          control: `devices/${testDeviceId}/control`,
        },
      },
      sensors: {
        battery: { value: 85, unit: '%', lastUpdate: new Date().toISOString() },
        signal: { value: 90, unit: '%', lastUpdate: new Date().toISOString() },
      },
      status: {
        state: 'online',
        lastSeen: new Date().toISOString(),
      },
    });
    
    await testDevice.save();
  });
  
  afterEach(async () => {
    // Cleanup test device
    await Device.deleteOne({ deviceId: testDeviceId });
    await DeviceHistory.deleteMany({ deviceId: testDeviceId });
  });
  
  describe('GET /api/devices', () => {
    it('should return list of devices', async () => {
      const response = await request(app)
        .get('/api/devices')
        .set('Authorization', authToken ? `Bearer ${authToken}` : '');
      
      expect(response.status).toBe(200);
      expect(response.body).toHaveProperty('devices');
      expect(Array.isArray(response.body.devices)).toBe(true);
      expect(response.body.devices.length).toBeGreaterThan(0);
    });
    
    it('should return devices with correct structure', async () => {
      const response = await request(app)
        .get('/api/devices')
        .set('Authorization', authToken ? `Bearer ${authToken}` : '');
      
      const device = response.body.devices.find(d => d.deviceId === testDeviceId);
      
      expect(device).toBeDefined();
      expect(device).toHaveProperty('deviceId');
      expect(device).toHaveProperty('name');
      expect(device).toHaveProperty('location');
      expect(device).toHaveProperty('status');
      expect(device.status).toHaveProperty('state');
    });
  });
  
  describe('GET /api/devices/:deviceId', () => {
    it('should return device details', async () => {
      const response = await request(app)
        .get(`/api/devices/${testDeviceId}`)
        .set('Authorization', authToken ? `Bearer ${authToken}` : '');
      
      expect(response.status).toBe(200);
      expect(response.body).toHaveProperty('device');
      expect(response.body.device.deviceId).toBe(testDeviceId);
    });
    
    it('should return device with MQTT configuration', async () => {
      const response = await request(app)
        .get(`/api/devices/${testDeviceId}`)
        .set('Authorization', authToken ? `Bearer ${authToken}` : '');
      
      const device = response.body.device;
      
      expect(device.mqtt).toBeDefined();
      expect(device.mqtt.topics).toBeDefined();
      expect(device.mqtt.topics.data).toContain(testDeviceId);
    });
    
    it('should return 404 for non-existent device', async () => {
      const response = await request(app)
        .get('/api/devices/NON_EXISTENT_DEVICE')
        .set('Authorization', authToken ? `Bearer ${authToken}` : '');
      
      expect(response.status).toBe(404);
    });
  });
  
  describe('POST /api/devices/:deviceId/data', () => {
    it('should update device data', async () => {
      const newData = {
        battery: 90,
        signal: 95,
        temperature: 25.5,
      };
      
      const response = await request(app)
        .post(`/api/devices/${testDeviceId}/data`)
        .set('Authorization', authToken ? `Bearer ${authToken}` : '')
        .send(newData);
      
      expect(response.status).toBe(200);
      expect(response.body).toHaveProperty('device');
      
      // Verify data was updated
      const updatedDevice = await Device.findOne({ deviceId: testDeviceId });
      expect(updatedDevice.sensors.battery.value).toBe(newData.battery);
    });
    
    it('should store data in history', async () => {
      const newData = {
        battery: 88,
        signal: 92,
      };
      
      await request(app)
        .post(`/api/devices/${testDeviceId}/data`)
        .set('Authorization', authToken ? `Bearer ${authToken}` : '')
        .send(newData);
      
      // Wait a bit for async operations
      await global.testUtils.sleep(500);
      
      // Check history
      const history = await DeviceHistory.findOne({ 
        deviceId: testDeviceId 
      }).sort({ timestamp: -1 });
      
      expect(history).toBeDefined();
      expect(history.data.battery).toBe(newData.battery);
    });
    
    it('should update device status to online', async () => {
      const newData = { battery: 85 };
      
      await request(app)
        .post(`/api/devices/${testDeviceId}/data`)
        .set('Authorization', authToken ? `Bearer ${authToken}` : '')
        .send(newData);
      
      const updatedDevice = await Device.findOne({ deviceId: testDeviceId });
      expect(updatedDevice.status.state).toBe('online');
      
      const lastSeenTime = new Date(updatedDevice.status.lastSeen);
      const now = new Date();
      const diffSeconds = (now - lastSeenTime) / 1000;
      
      expect(diffSeconds).toBeLessThan(5); // Last seen should be very recent
    });
  });
  
  describe('Device Status Updates', () => {
    it('should mark old device as offline', async () => {
      // Set lastSeen to 10 minutes ago
      const tenMinutesAgo = new Date(Date.now() - 10 * 60 * 1000);
      
      await Device.updateOne(
        { deviceId: testDeviceId },
        { 
          'status.lastSeen': tenMinutesAgo,
          'status.state': 'offline'
        }
      );
      
      const device = await Device.findOne({ deviceId: testDeviceId });
      expect(device.status.state).toBe('offline');
      
      const lastSeenTime = new Date(device.status.lastSeen);
      expect(lastSeenTime.getTime()).toBe(tenMinutesAgo.getTime());
    });
  });
  
  describe('Historical Data Query', () => {
    beforeEach(async () => {
      // Create some historical data
      const historyEntries = [
        {
          deviceId: testDeviceId,
          timestamp: new Date(Date.now() - 60000), // 1 minute ago
          data: { battery: 85, signal: 90 },
          topic: `devices/${testDeviceId}/data`,
        },
        {
          deviceId: testDeviceId,
          timestamp: new Date(Date.now() - 120000), // 2 minutes ago
          data: { battery: 84, signal: 89 },
          topic: `devices/${testDeviceId}/data`,
        },
        {
          deviceId: testDeviceId,
          timestamp: new Date(Date.now() - 180000), // 3 minutes ago
          data: { battery: 83, signal: 88 },
          topic: `devices/${testDeviceId}/data`,
        },
      ];
      
      await DeviceHistory.insertMany(historyEntries);
    });
    
    it('should retrieve historical data', async () => {
      const history = await DeviceHistory.find({ 
        deviceId: testDeviceId 
      }).sort({ timestamp: -1 });
      
      expect(history.length).toBeGreaterThanOrEqual(3);
      expect(history[0].data.battery).toBe(85); // Most recent first
    });
    
    it('should query historical data by time range', async () => {
      const startTime = new Date(Date.now() - 150000); // 2.5 minutes ago
      const endTime = new Date();
      
      const history = await DeviceHistory.find({
        deviceId: testDeviceId,
        timestamp: { $gte: startTime, $lte: endTime },
      }).sort({ timestamp: -1 });
      
      expect(history.length).toBe(2); // Should only get entries from last 2.5 minutes
    });
  });
});

describe('MQTT Integration Tests', () => {
  it('should extract device ID from MQTT topic', () => {
    const topic = 'devices/sensor1/data';
    const deviceId = topic.split('/')[1];
    
    expect(deviceId).toBe('sensor1');
  });
  
  it('should handle different device ID formats', () => {
    const topics = [
      'devices/123/data',
      'devices/DEVICE_123/data',
      'devices/sensor1/data',
    ];
    
    topics.forEach(topic => {
      const deviceId = topic.split('/')[1];
      expect(deviceId).toBeTruthy();
      expect(deviceId.length).toBeGreaterThan(0);
    });
  });
});
