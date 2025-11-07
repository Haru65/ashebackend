/**
 * MongoDB Device Seeder Script
 * Seeds the database with sample IoT devices for testing
 * 
 * Usage: node seedDevices.js
 */

const mongoose = require('mongoose');
require('dotenv').config();

// Import Device model
const Device = require('../models/Device');

// MongoDB connection string
const MONGODB_URI = process.env.MONGODB_URI || 'mongodb://localhost:27017/iot-platform';

// Sample devices data
const sampleDevices = [
  {
    deviceId: 'DEVICE_123',
    deviceName: 'Sensor 1',
    location: 'Building A - Floor 1',
    mqtt: {
      brokerUrl: 'ws://localhost:1883',
      topicPrefix: 'devices',
      topics: {
        data: 'devices/123/data',
        status: 'devices/123/status',
        control: 'devices/123/control'
      }
    },
    sensors: {
      battery: 85,
      signal: 92,
      temperature: 22.5,
      humidity: 45,
      pressure: 1013
    },
    status: {
      state: 'online',
      lastSeen: new Date()
    },
    metadata: {
      icon: 'bi bi-thermometer-half',
      color: '#4CAF50',
      description: 'Temperature and humidity sensor in Building A'
    },
    historicalCollection: 'telemetry_device_123'
  },
  {
    deviceId: 'DEVICE_234',
    deviceName: 'Sensor 2',
    location: 'Building B - Floor 2',
    mqtt: {
      brokerUrl: 'ws://localhost:1883',
      topicPrefix: 'devices',
      topics: {
        data: 'devices/234/data',
        status: 'devices/234/status',
        control: 'devices/234/control'
      }
    },
    sensors: {
      battery: 78,
      signal: 88,
      temperature: 24.0,
      humidity: 52,
      pressure: 1015
    },
    status: {
      state: 'online',
      lastSeen: new Date()
    },
    metadata: {
      icon: 'bi bi-speedometer2',
      color: '#2196F3',
      description: 'Environmental monitoring sensor in Building B'
    },
    historicalCollection: 'telemetry_device_234'
  }
];

// Connect to MongoDB
async function connectDB() {
  try {
    await mongoose.connect(MONGODB_URI, {
      useNewUrlParser: true,
      useUnifiedTopology: true
    });
    console.log('✅ MongoDB connected successfully');
  } catch (error) {
    console.error('❌ MongoDB connection error:', error);
    process.exit(1);
  }
}

// Seed devices
async function seedDevices() {
  try {
    console.log('🌱 Starting device seeding process...');

    // Clear existing devices
    console.log('🗑️  Clearing existing devices...');
    const deleteResult = await Device.deleteMany({});
    console.log(`   Deleted ${deleteResult.deletedCount} existing device(s)`);

    // Insert sample devices
    console.log('📥 Inserting sample devices...');
    const insertedDevices = await Device.insertMany(sampleDevices);
    console.log(`✅ Successfully inserted ${insertedDevices.length} device(s):`);

    // Log details of inserted devices
    insertedDevices.forEach((device, index) => {
      console.log(`\n   Device ${index + 1}:`);
      console.log(`   - ID: ${device.deviceId}`);
      console.log(`   - Name: ${device.deviceName}`);
      console.log(`   - Location: ${device.location}`);
      console.log(`   - Status: ${device.status.state}`);
      console.log(`   - MQTT Data Topic: ${device.mqtt.topics.data}`);
      console.log(`   - Battery: ${device.sensors.battery}%`);
      console.log(`   - Signal: ${device.sensors.signal}%`);
      console.log(`   - Temperature: ${device.sensors.temperature}°C`);
    });

    console.log('\n✅ Device seeding completed successfully!');
    console.log('\n📊 Summary:');
    console.log(`   Total devices: ${insertedDevices.length}`);
    console.log(`   Device IDs: ${insertedDevices.map(d => d.deviceId).join(', ')}`);
    
  } catch (error) {
    console.error('❌ Error seeding devices:', error);
    throw error;
  }
}

// Main execution
async function main() {
  try {
    await connectDB();
    await seedDevices();
    
    console.log('\n🎉 All operations completed successfully!');
    process.exit(0);
  } catch (error) {
    console.error('\n❌ Seeding failed:', error.message);
    process.exit(1);
  }
}

// Run the script
main();
