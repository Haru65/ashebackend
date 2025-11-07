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
    clientId: process.env.MQTT_CLIENT_ID || deviceId,
    username: process.env.MQTT_USERNAME || process.env.MQTT_USER || 'zeptac_iot',
    password: process.env.MQTT_PASSWORD || process.env.MQTT_PASS || 'ZepIOT@123',
    keepalive: parseInt(process.env.MQTT_KEEPALIVE || '60', 10),
    reconnectPeriod: parseInt(process.env.MQTT_RECONNECT_PERIOD || '5000', 10),
    connectTimeout: parseInt(process.env.MQTT_CONNECT_TIMEOUT || '30000', 10),
    clean: process.env.MQTT_CLEAN ? process.env.MQTT_CLEAN === 'true' : true,
    rejectUnauthorized: process.env.MQTT_REJECT_UNAUTHORIZED ? process.env.MQTT_REJECT_UNAUTHORIZED === 'true' : false,
    protocolVersion: parseInt(process.env.MQTT_PROTOCOL_VERSION || '4', 10),
    queueQoSZero: process.env.MQTT_QUEUE_QOS_ZERO ? process.env.MQTT_QUEUE_QOS_ZERO === 'true' : false,
    will: {
      topic: process.env.MQTT_WILL_TOPIC || `devices/${deviceId}/status`,
      payload: JSON.stringify({
        status: 'offline',
        timestamp: new Date().toISOString(),
        clientId: process.env.MQTT_CLIENT_ID || deviceId
      }),
      qos: parseInt(process.env.MQTT_WILL_QOS || '1', 10),
      retain: process.env.MQTT_WILL_RETAIN ? process.env.MQTT_WILL_RETAIN === 'true' : true
    },
    properties: {
      sessionExpiryInterval: parseInt(process.env.MQTT_SESSION_EXPIRY || '300', 10),
      receiveMaximum: parseInt(process.env.MQTT_RECEIVE_MAX || '100', 10),
      maximumPacketSize: parseInt(process.env.MQTT_MAX_PACKET || '100000', 10)
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