/**
 * Test Script for MQTT Client and Device Status Monitor
 * 
 * Usage: node testIoTServices.js
 */

const mongoose = require('mongoose');
require('dotenv').config();
const { initializeServices, shutdownServices } = require('./initIoTServices');

// MongoDB connection string
const MONGODB_URI = process.env.MONGODB_URI || 'mongodb://localhost:27017/iot-platform';

async function testServices() {
  try {
    console.log('🧪 IoT Services Test Script\n');

    // Connect to MongoDB
    console.log('📦 Connecting to MongoDB...');
    await mongoose.connect(MONGODB_URI, {
      useNewUrlParser: true,
      useUnifiedTopology: true
    });
    console.log('✅ MongoDB connected\n');

    // Initialize IoT services
    const initialized = initializeServices({
      mqttBroker: process.env.MQTT_BROKER_URL || 'mqtt://test.mosquitto.org',
      statusCheckInterval: 2
    });

    if (!initialized) {
      console.error('❌ Failed to initialize services');
      process.exit(1);
    }

    console.log('\n📝 Services are running...');
    console.log('💡 To test:');
    console.log('   1. Publish MQTT messages to topics like: devices/123/data');
    console.log('   2. Message format: {"battery": 85, "signal": 90, "temperature": 22.5}');
    console.log('   3. Watch the console for incoming messages and status updates');
    console.log('\n🛑 Press Ctrl+C to stop\n');

    // Keep the process alive
    process.on('SIGINT', async () => {
      console.log('\n\n⚠️ Received SIGINT, shutting down...');
      shutdownServices();
      await mongoose.connection.close();
      console.log('✅ MongoDB connection closed');
      process.exit(0);
    });

  } catch (error) {
    console.error('❌ Error in test script:', error);
    process.exit(1);
  }
}

// Run the test
testServices();
