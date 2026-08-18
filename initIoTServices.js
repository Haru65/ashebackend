/**
 * IoT Services Initializer
 * Starts MQTT client and Device Status Monitor services
 * 
 * Usage: 
 * - Require this file in your main server file (e.g., index.js)
 * - Call initializeServices() after MongoDB connection is established
 */

const mongoose = require('mongoose');
const mqttClientService = require('./services/mqttClientService');
const deviceStatusMonitor = require('./services/deviceStatusMonitor');

/**
 * Initialize all IoT services
 * @param {object} options - Configuration options
 * @param {string} options.mqttBroker - MQTT broker URL (default: mqtt://broker.zeptac.com:1883)
 * @param {string} options.mqttUsername - MQTT username for authentication
 * @param {string} options.mqttPassword - MQTT password for authentication
 * @param {number} options.statusCheckInterval - Status check interval in minutes (default: 2)
 */
function initializeServices(options = {}) {
  const config = {
    mqttBroker: options.mqttBroker || process.env.MQTT_BROKER_URL || 'mqtt://broker.zeptac.com:1883',
    mqttUsername: options.mqttUsername || process.env.MQTT_USERNAME || 'zeptac_iot',
    mqttPassword: options.mqttPassword || process.env.MQTT_PASSWORD || 'ZepIOT@123',
    statusCheckInterval: options.statusCheckInterval || 2
  };

  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log('🚀 Initializing IoT Services');
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');

  // Check MongoDB connection
  if (mongoose.connection.readyState !== 1) {
    console.error('❌ MongoDB is not connected. Please connect to MongoDB before initializing IoT services.');
    return false;
  }

  try {
    // 1. Start MQTT Client Service
    console.log('\n📡 Starting MQTT Client Service...');
    mqttClientService.brokerUrl = config.mqttBroker;
    mqttClientService.username = config.mqttUsername;
    mqttClientService.password = config.mqttPassword;
    mqttClientService.connect();

    // 2. Start Device Status Monitor
    console.log('\n🔍 Starting Device Status Monitor...');
    if (config.statusCheckInterval !== 2) {
      deviceStatusMonitor.checkIntervalMs = config.statusCheckInterval * 60 * 1000;
    }
    deviceStatusMonitor.start();

    console.log('\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    console.log('✅ All IoT Services Initialized Successfully');
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');

    return true;
  } catch (error) {
    console.error('❌ Error initializing IoT services:', error);
    return false;
  }
}

/**
 * Gracefully shutdown all services
 */
function shutdownServices() {
  console.log('\n🛑 Shutting down IoT services...');

  try {
    // Stop Device Status Monitor
    deviceStatusMonitor.stop();
    console.log('✓ Device Status Monitor stopped');

    // Disconnect MQTT Client
    mqttClientService.disconnect();
    console.log('✓ MQTT Client disconnected');

    console.log('✅ All IoT services stopped gracefully\n');
  } catch (error) {
    console.error('❌ Error during shutdown:', error);
  }
}

// Handle process termination
process.on('SIGINT', () => {
  console.log('\n⚠️ Received SIGINT signal');
  shutdownServices();
  process.exit(0);
});

process.on('SIGTERM', () => {
  console.log('\n⚠️ Received SIGTERM signal');
  shutdownServices();
  process.exit(0);
});

module.exports = {
  initializeServices,
  shutdownServices,
  mqttClientService,
  deviceStatusMonitor
};
