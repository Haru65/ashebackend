const mongoose = require('mongoose');
const Device = require('./models/Device');
require('dotenv').config();

const devices = [
  {
    deviceId: '123',
    deviceName: 'Sensor 1 - AAAA-BBBB-CCCC',
    location: '19.076, 72.8777',
    mqtt: {
      brokerUrl: 'mqtt://broker.zeptac.com:1883',
      topicPrefix: 'devices/123',
      topics: {
        data: 'devices/123/data',
        status: 'devices/123/status',
        control: 'devices/123/commands'
      }
    },
    sensors: {
      battery: null,
      signal: null,
      temperature: null,
      humidity: null,
      pressure: null
    },
    status: {
      state: 'offline',
      lastSeen: null
    },
    metadata: {
      icon: 'bi-lightbulb',
      color: '#007bff',
      description: 'Primary IoT sensor device'
    }
  },
  {
    deviceId: '234',
    deviceName: 'Sensor 2 - BBBB-CCCC-DDDD',
    location: '18.5204, 73.8567',
    mqtt: {
      brokerUrl: 'mqtt://broker.zeptac.com:1883',
      topicPrefix: 'devices/234',
      topics: {
        data: 'devices/234/data',
        status: 'devices/234/status',
        control: 'devices/234/commands'
      }
    },
    sensors: {
      battery: null,
      signal: null,
      temperature: null,
      humidity: null,
      pressure: null
    },
    status: {
      state: 'offline',
      lastSeen: null
    },
    metadata: {
      icon: 'bi-thermometer-half',
      color: '#28a745',
      description: 'Temperature monitoring sensor'
    }
  },
  {
    deviceId: '345',
    deviceName: 'Sensor 3 - CCCC-DDDD-EEEE',
    location: '28.7041, 77.1025',
    mqtt: {
      brokerUrl: 'mqtt://broker.zeptac.com:1883',
      topicPrefix: 'devices/345',
      topics: {
        data: 'devices/345/data',
        status: 'devices/345/status',
        control: 'devices/345/commands'
      }
    },
    sensors: {
      battery: null,
      signal: null,
      temperature: null,
      humidity: null,
      pressure: null
    },
    status: {
      state: 'offline',
      lastSeen: null
    },
    metadata: {
      icon: 'bi-water',
      color: '#17a2b8',
      description: 'Humidity monitoring sensor'
    }
  }
];

async function seedDevices() {
  try {
    console.log('🔄 Connecting to MongoDB...');
    await mongoose.connect(process.env.MONGODB_URI);
    console.log('✅ Connected to MongoDB');

    // Clear existing devices
    console.log('🗑️  Clearing existing devices...');
    await Device.deleteMany({});
    console.log('✅ Cleared existing devices');

    // Insert new devices
    console.log('📝 Inserting new devices...');
    const result = await Device.insertMany(devices);
    console.log(`✅ Successfully seeded ${result.length} devices:\n`);
    
    result.forEach(device => {
      console.log(`   📱 ${device.deviceName}`);
      console.log(`      ID: ${device.deviceId}`);
      console.log(`      Location: ${device.location}`);
      console.log(`      MQTT Topic: ${device.mqtt.topics.data}`);
      console.log(`      Status: ${device.status.state}\n`);
    });

    await mongoose.disconnect();
    console.log('✅ Disconnected from MongoDB');
    console.log('\n🎉 Database seeding complete!');
    process.exit(0);
  } catch (error) {
    console.error('❌ Error seeding devices:', error);
    process.exit(1);
  }
}

seedDevices();
