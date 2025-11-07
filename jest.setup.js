/**
 * Jest Setup File
 * 
 * Configure global test settings and utilities
 */

// Set test timeout to 30 seconds for integration tests
jest.setTimeout(30000);

// Setup environment variables for testing
process.env.NODE_ENV = 'test';
process.env.MONGODB_URI = process.env.MONGODB_URI || 'mongodb://localhost:27017/iot-platform-test';
process.env.MQTT_BROKER_URL = process.env.MQTT_BROKER_URL || 'mqtt://test.mosquitto.org';
process.env.JWT_SECRET = 'test-jwt-secret';

// Global test utilities
global.testUtils = {
  /**
   * Wait for a specified time
   */
  sleep: (ms) => new Promise(resolve => setTimeout(resolve, ms)),
  
  /**
   * Generate random device ID
   */
  generateDeviceId: () => `TEST_DEVICE_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
  
  /**
   * Clean up test data
   */
  cleanupTestData: async (mongoose, deviceIds) => {
    const Device = mongoose.model('Device');
    const DeviceHistory = mongoose.model('DeviceHistory');
    
    await Device.deleteMany({ deviceId: { $in: deviceIds } });
    await DeviceHistory.deleteMany({ deviceId: { $in: deviceIds } });
  },
};

// Mock console methods to reduce noise in test output (optional)
// global.console = {
//   ...console,
//   log: jest.fn(),
//   debug: jest.fn(),
//   info: jest.fn(),
// };

console.log('🧪 Jest test environment initialized');
