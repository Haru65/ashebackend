const mqtt = require('mqtt');

// Prefer environment variables for any secrets or environment-specific values.
// You should set these in Render's Environment settings (or locally via .env when developing).
const deviceId = process.env.MQTT_DEVICE_ID || '123';
const defaultBrokerUrl = process.env.MQTT_BROKER_URL || 'mqtt://broker.zeptac.com:1883';
const defaultDataTopic = process.env.MQTT_DATA_TOPIC || `devices/${deviceId}/data`;
const defaultCommandTopic = process.env.MQTT_COMMAND_TOPIC || `devices/${deviceId}/commands`;

const deviceBroker = {
  url: defaultBrokerUrl,
  dataTopic: defaultDataTopic,
  commandTopic: defaultCommandTopic,
  options: {
    clientId: process.env.MQTT_CLIENT_ID || `backend_server_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
    username: process.env.MQTT_USERNAME || process.env.MQTT_USER || 'zeptac_iot',
    password: process.env.MQTT_PASSWORD || process.env.MQTT_PASS || 'ZepIOT@123',
    keepalive: 60,
    reconnectPeriod: 5000,
    connectTimeout: 30000,
    clean: true,
    rejectUnauthorized: false,
    protocolVersion: 4,
    queueQoSZero: false,
    will: {
      topic: `devices/${deviceId}/status`,
      payload: JSON.stringify({
        status: 'offline',
        timestamp: new Date().toISOString(),
        clientId: 'backend_server_123'
      }),
      qos: 1,
      retain: true
    }
  }
};

// Alternative stable brokers for testing (keep as reference)
const alternativeBrokers = {
  mosquitto: 'mqtt://test.mosquitto.org:1883',
  eclipse: 'mqtt://mqtt.eclipseprojects.io:1883',
  hivemq: 'mqtt://broker.hivemq.com:1883',
  local: 'mqtt://localhost:1883'
};

module.exports = {
  deviceBroker,
  alternativeBrokers
};