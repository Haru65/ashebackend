const express = require('express');
const mongoose = require('mongoose');
const Device = require('./models/Device');
const http = require('http');
const socketIo = require('socket.io');
const mqtt = require('mqtt');
const cors = require('cors');
const Joi = require('joi');
const rateLimit = require('express-rate-limit');
const winston = require('winston');

const app = express();
const server = http.createServer(app);

const io = socketIo(server, {
  cors: {
    origin: ["https://zeptac-iot-platform-vp3h-kljhebkdt-haru65s-projects.vercel.app", "http://localhost:5175","https://zeptac-iot-platform-vp3h.vercel.app"],
    methods: ["GET", "POST"],
    credentials: true
  }
});

app.use(cors());
app.use(express.json());

// MongoDB connection
mongoose.connect(process.env.MONGODB_URI || 'mongodb://localhost:27017/zeptac_iot_devices', {
  useNewUrlParser: true,
  useUnifiedTopology: true
}).then(() => console.log('MongoDB connected')).catch(err => console.error('MongoDB connection error:', err));

// Logger setup
const logger = winston.createLogger({
  level: 'info',
  format: winston.format.combine(
    winston.format.timestamp(),
    winston.format.json()
  ),
  transports: [
    new winston.transports.Console(),
    new winston.transports.File({ filename: 'backend.log' })
  ]
});

// Rate limiter
const apiLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 100,
  message: 'Too many requests from this IP, please try again later.'
});
app.use('/api/', apiLimiter);

// Device validation schema
const deviceValidationSchema = Joi.object({
  deviceId: Joi.string().required(),
  name: Joi.string().required(),
  type: Joi.string().valid('sensor', 'actuator', 'gateway').required(),
  mqtt: Joi.object({
    brokerUrl: Joi.string().required(),
    topics: Joi.array().items(Joi.string()).min(1).required(),
    username: Joi.string().allow(''),
    password: Joi.string().allow(''),
    options: Joi.object({
      qos: Joi.number().valid(0, 1, 2).default(0),
      keepalive: Joi.number().default(60),
      clientId: Joi.string().allow(''),
      clean: Joi.boolean().default(true)
    })
  }).required(),
  location: Joi.object({
    latitude: Joi.number(),
    longitude: Joi.number()
  }),
  status: Joi.string().valid('active', 'inactive', 'error'),
  lastSeen: Joi.date(),
  metrics: Joi.any()
});

// GET /api/devices - List all devices with pagination and filtering
app.get('/api/devices', async (req, res) => {
  try {
    const { page = 1, limit = 10, type, status, search } = req.query;
    const filter = {};
    if (type) filter.type = type;
    if (status) filter.status = status;
    if (search) filter.name = { $regex: search, $options: 'i' };
    const devices = await Device.find(filter)
      .skip((page - 1) * limit)
      .limit(Number(limit));
    const total = await Device.countDocuments(filter);
    res.json({ success: true, data: devices, total });
  } catch (err) {
    logger.error('GET /api/devices error', { error: err });
    res.status(500).json({ success: false, message: 'Server error' });
  }
});

// GET /api/devices/:id - Get single device details
app.get('/api/devices/:id', async (req, res) => {
  try {
    const device = await Device.findOne({ deviceId: req.params.id });
    if (!device) return res.status(404).json({ success: false, message: 'Device not found' });
    res.json({ success: true, data: device });
  } catch (err) {
    logger.error('GET /api/devices/:id error', { error: err });
    res.status(500).json({ success: false, message: 'Server error' });
  }
});

// POST /api/devices - Create new device
app.post('/api/devices', async (req, res) => {
  try {
    const { error, value } = deviceValidationSchema.validate(req.body);
    if (error) return res.status(400).json({ success: false, message: error.details[0].message });
    const exists = await Device.findOne({ deviceId: value.deviceId });
    if (exists) return res.status(409).json({ success: false, message: 'Device ID already exists' });
    const device = new Device(value);
    await device.save();
    res.status(201).json({ success: true, data: device });
  } catch (err) {
    logger.error('POST /api/devices error', { error: err });
    res.status(500).json({ success: false, message: 'Server error' });
  }
});

// PUT /api/devices/:id - Update device information
app.put('/api/devices/:id', async (req, res) => {
  try {
    const { error, value } = deviceValidationSchema.validate(req.body);
    if (error) return res.status(400).json({ success: false, message: error.details[0].message });
    const device = await Device.findOneAndUpdate({ deviceId: req.params.id }, value, { new: true });
    if (!device) return res.status(404).json({ success: false, message: 'Device not found' });
    res.json({ success: true, data: device });
  } catch (err) {
    logger.error('PUT /api/devices/:id error', { error: err });
    res.status(500).json({ success: false, message: 'Server error' });
  }
});

// DELETE /api/devices/:id - Remove device
app.delete('/api/devices/:id', async (req, res) => {
  try {
    const device = await Device.findOneAndDelete({ deviceId: req.params.id });
    if (!device) return res.status(404).json({ success: false, message: 'Device not found' });
    res.json({ success: true, message: 'Device deleted' });
  } catch (err) {
    logger.error('DELETE /api/devices/:id error', { error: err });
    res.status(500).json({ success: false, message: 'Server error' });
  }
});

// GET /api/devices/:id/status - Get current connection status and metrics
app.get('/api/devices/:id/status', async (req, res) => {
  try {
    // This will be updated to support dynamic device pool
    const device = await Device.findOne({ deviceId: req.params.id });
    if (!device) return res.status(404).json({ success: false, message: 'Device not found' });
    // Placeholder: return status and metrics from DB (to be updated for live status)
    res.json({ success: true, data: { status: device.status, lastSeen: device.lastSeen, metrics: device.metrics } });
  } catch (err) {
    logger.error('GET /api/devices/:id/status error', { error: err });
    res.status(500).json({ success: false, message: 'Server error' });
  }
});

// MQTT Connection Test validation schema
const mqttTestSchema = Joi.object({
  brokerUrl: Joi.string().required(),
  username: Joi.string().allow(''),
  password: Joi.string().allow(''),
  clientId: Joi.string().allow(''),
  testTopic: Joi.string().default('test/connection'),
  qos: Joi.number().valid(0, 1, 2).default(0),
  keepalive: Joi.number().default(60),
  timeout: Joi.number().default(15000)
});

// POST /api/mqtt/test-connection - Test MQTT broker connectivity
app.post('/api/mqtt/test-connection', async (req, res) => {
  let testClient = null;
  const startTime = Date.now();
  
  try {
    // Validate input
    const { error, value } = mqttTestSchema.validate(req.body);
    if (error) {
      return res.status(400).json({ 
        success: false, 
        message: error.details[0].message,
        testResults: null
      });
    }

    const { brokerUrl, username, password, clientId, testTopic, qos, keepalive, timeout } = value;
    
    // Prepare MQTT options
    const mqttOptions = {
      clientId: clientId || `test-client-${Math.random().toString(16).substr(2, 8)}`,
      keepalive,
      connectTimeout: timeout,
      clean: true
    };
    
    if (username) mqttOptions.username = username;
    if (password) mqttOptions.password = password;

    logger.info('Starting MQTT connection test', { brokerUrl, clientId: mqttOptions.clientId });

    // Test results object
    const testResults = {
      brokerUrl,
      clientId: mqttOptions.clientId,
      connectionTest: { success: false, message: '', duration: 0 },
      subscribeTest: { success: false, message: '', duration: 0 },
      publishTest: { success: false, message: '', duration: 0 },
      echoTest: { success: false, message: '', duration: 0 },
      overallSuccess: false,
      totalDuration: 0
    };

    // Promise wrapper for MQTT operations
    const testConnection = () => {
      return new Promise((resolve, reject) => {
        const connectionStart = Date.now();
        let isResolved = false;
        let echoReceived = false;
        const testMessage = `test-${Date.now()}`;
        
        // Create test client
        testClient = mqtt.connect(brokerUrl, mqttOptions);
        
        // Set overall timeout
        const overallTimeout = setTimeout(() => {
          if (!isResolved) {
            isResolved = true;
            testResults.connectionTest.message = 'Connection timeout';
            reject(new Error('Connection timeout'));
          }
        }, timeout);

        // Connection success
        testClient.on('connect', () => {
          if (isResolved) return;
          
          testResults.connectionTest.success = true;
          testResults.connectionTest.message = 'Successfully connected to broker';
          testResults.connectionTest.duration = Date.now() - connectionStart;
          
          logger.info('MQTT connection successful', { brokerUrl });
          
          // Test subscription
          const subscribeStart = Date.now();
          testClient.subscribe(testTopic, { qos }, (err) => {
            if (err) {
              if (!isResolved) {
                isResolved = true;
                testResults.subscribeTest.message = `Subscribe failed: ${err.message}`;
                clearTimeout(overallTimeout);
                reject(err);
              }
              return;
            }
            
            testResults.subscribeTest.success = true;
            testResults.subscribeTest.message = `Successfully subscribed to ${testTopic}`;
            testResults.subscribeTest.duration = Date.now() - subscribeStart;
            
            // Test publish
            const publishStart = Date.now();
            testClient.publish(testTopic, JSON.stringify({ 
              type: 'connection-test', 
              message: testMessage,
              timestamp: new Date().toISOString()
            }), { qos }, (err) => {
              if (err) {
                if (!isResolved) {
                  isResolved = true;
                  testResults.publishTest.message = `Publish failed: ${err.message}`;
                  clearTimeout(overallTimeout);
                  reject(err);
                }
                return;
              }
              
              testResults.publishTest.success = true;
              testResults.publishTest.message = `Successfully published to ${testTopic}`;
              testResults.publishTest.duration = Date.now() - publishStart;
              
              // Wait for echo (message receive test)
              const echoStart = Date.now();
              const echoTimeout = setTimeout(() => {
                if (!isResolved && !echoReceived) {
                  isResolved = true;
                  testResults.echoTest.message = 'Echo timeout - message published but not received';
                  testResults.overallSuccess = testResults.connectionTest.success && 
                                             testResults.subscribeTest.success && 
                                             testResults.publishTest.success;
                  clearTimeout(overallTimeout);
                  resolve(testResults);
                }
              }, 5000); // 5 second echo timeout
              
              // Listen for our echo message
              testClient.on('message', (topic, message) => {
                if (topic === testTopic && !echoReceived) {
                  try {
                    const receivedData = JSON.parse(message.toString());
                    if (receivedData.message === testMessage) {
                      echoReceived = true;
                      clearTimeout(echoTimeout);
                      
                      if (!isResolved) {
                        isResolved = true;
                        testResults.echoTest.success = true;
                        testResults.echoTest.message = 'Successfully received echo message';
                        testResults.echoTest.duration = Date.now() - echoStart;
                        testResults.overallSuccess = true;
                        clearTimeout(overallTimeout);
                        resolve(testResults);
                      }
                    }
                  } catch (parseErr) {
                    // Ignore parse errors for non-test messages
                  }
                }
              });
            });
          });
        });

        // Connection error
        testClient.on('error', (err) => {
          if (!isResolved) {
            isResolved = true;
            testResults.connectionTest.message = `Connection failed: ${err.message}`;
            clearTimeout(overallTimeout);
            reject(err);
          }
        });

        // Connection close
        testClient.on('close', () => {
          if (!isResolved) {
            isResolved = true;
            testResults.connectionTest.message = 'Connection closed unexpectedly';
            clearTimeout(overallTimeout);
            reject(new Error('Connection closed'));
          }
        });
      });
    };

    // Execute the test
    await testConnection();
    testResults.totalDuration = Date.now() - startTime;
    
    logger.info('MQTT connection test completed', { 
      success: testResults.overallSuccess, 
      duration: testResults.totalDuration 
    });

    res.json({
      success: true,
      message: testResults.overallSuccess ? 'All tests passed' : 'Some tests failed',
      testResults
    });

  } catch (err) {
    const totalDuration = Date.now() - startTime;
    logger.error('MQTT connection test failed', { error: err.message, duration: totalDuration });
    
    res.status(400).json({
      success: false,
      message: err.message,
      testResults: {
        ...req.body,
        connectionTest: { success: false, message: err.message, duration: totalDuration },
        subscribeTest: { success: false, message: 'Not attempted', duration: 0 },
        publishTest: { success: false, message: 'Not attempted', duration: 0 },
        echoTest: { success: false, message: 'Not attempted', duration: 0 },
        overallSuccess: false,
        totalDuration
      }
    });
  } finally {
    // Cleanup test client
    if (testClient) {
      try {
        testClient.end(true);
      } catch (cleanupErr) {
        logger.error('Error cleaning up test client', { error: cleanupErr });
      }
    }
  }
});
// MQTT Broker configs
const originalBroker = {
  url: 'mqtt://test.mosquitto.org',
  topic: 'devices/234/data',
  options: {
    clientId: 'simulated-client-' + Math.random().toString(16).substr(2, 8),
    keepalive: 45,
    reconnectPeriod: 5000,
    connectTimeout: 10000,
    clean: true
  }
};

const simulatedBroker = {
   url: 'mqtt://broker.zeptac.com:1883',
  topic: 'devices/123/data',
  options: {
    clientId: 'original-client-' + Math.random().toString(16).substr(2, 8),
    username: 'zeptac_iot',
    password: 'ZepIOT@123',
    keepalive: 45,
    reconnectPeriod: 10000,
    connectTimeout: 15000,
    clean: true
 
  }
};

const originalClient = mqtt.connect(originalBroker.url, originalBroker.options);
const simulatedClient = mqtt.connect(simulatedBroker.url, simulatedBroker.options);

// Device data and state
let deviceData = {
  main: null,
  sim: null,
  original: null,
  mainSource: 'aaa' // default to simulation device first
};

let lastOriginalTimestamp = 0;
const ORIGINAL_TIMEOUT = 30000; // 30 seconds without data triggers failover
let timeoutTimer = null;
let connectionStatus = {
  original: false,
  simulated: false
};

// Basic data transform helper
function transformDeviceData(payload, source, topic) {
  return {
    id: payload.SPN?.toString() ?? payload.SN?.toString() ?? "N/A",
    name: payload.API ?? (source === 'original' ? 'Original-Device' : 'AAA'),
    icon: 'bi-device',
    type: 'sensor',
    location: payload.LATITUDE && payload.LONGITUDE && (payload.LATITUDE !== 0 || payload.LONGITUDE !== 0)
      ? `${payload.LATITUDE}, ${payload.LONGITUDE}` : "",
    status: payload.EVENT ?? "NORMAL",
    lastSeen: payload.TimeStamp ?? new Date().toISOString(),
    timestamp: Date.now(),
    source: source,
    metrics: Object.keys(payload)
      .filter(k => !['API', 'EVENT', 'TimeStamp', 'LATITUDE', 'LONGITUDE', 'SN', 'SPN', 'LOG'].includes(k))
      .map(k => ({
        type: k,
        value: parseFloat(payload[k]) || payload[k],
        icon: k === 'DCV' || k === 'ACV' ? 'bi-battery' : k === 'DCI' || k === 'ACI' ? 'bi-lightning-charge' : 'bi-graph-up'
      }))
  };
}

// Emit to frontend with throttling
const UPDATE_THROTTLE = 1000; // ms
let lastUpdateTimes = { main: 0, sim: 0 };

function throttledEmit(updateType, data) {
  const now = Date.now();
  if (now - (lastUpdateTimes[updateType] || 0) >= UPDATE_THROTTLE) {
    io.emit('deviceUpdate', { type: updateType, data });
    lastUpdateTimes[updateType] = now;
  }
}

// Set main device and notify frontend
function setMainDevice(deviceInfo, source) {
  if (deviceData.mainSource === source) {
    deviceData.main = deviceInfo;
    throttledEmit('main', deviceInfo);
    return;
  }
  deviceData.main = deviceInfo;
  deviceData.mainSource = source;
  throttledEmit('main', deviceInfo);
  io.emit('deviceStatus', {
    activeDevice: source,
    originalActive: source === 'original',
    message: `Switched to ${source === 'original' ? 'original' : 'AAA'} device`
  });
  console.log(`Switched main device to: ${source}`);
}

// Failover logic: revert to simulated device if original not sending for timeout
function setOriginalTimeout() {
  if (timeoutTimer) clearTimeout(timeoutTimer);
  timeoutTimer = setTimeout(() => {
    if (deviceData.mainSource === 'original') {
      if (deviceData.sim) {
        setMainDevice(deviceData.sim, 'aaa');
        console.log('Original timeout, failover to simulated device');
      }
    }
  }, ORIGINAL_TIMEOUT);
}

// MQTT event handlers for original device
originalClient.on('connect', () => {
  connectionStatus.original = true;
  console.log('Connected to original device broker');
  originalClient.subscribe(originalBroker.topic, { qos: 0 }, err => {
    if (!err) console.log(`Subscribed to original topic: ${originalBroker.topic}`);
  });
});

originalClient.on('message', (topic, message) => {
  try {
    const payload = JSON.parse(message.toString());
    const deviceInfo = transformDeviceData(payload, 'original', topic);
    deviceData.original = deviceInfo;
    lastOriginalTimestamp = Date.now();
    setMainDevice(deviceInfo, 'original');
    setOriginalTimeout();
  } catch (err) {
    console.error('Error parsing original device message:', err);
  }
});

originalClient.on('close', () => {
  connectionStatus.original = false;
  console.log('Original device broker disconnected');
});

originalClient.on('error', err => {
  connectionStatus.original = false;
  console.error('Original device client error:', err);
});

// MQTT event handlers for AAA device (simulated)
simulatedClient.on('connect', () => {
  connectionStatus.simulated = true;
  console.log('Connected to AAA device broker');
  simulatedClient.subscribe(simulatedBroker.topic, { qos: 0 }, err => {
    if (!err) console.log(`Subscribed to simulated topic: ${simulatedBroker.topic}`);
  });
});

simulatedClient.on('message', (topic, message) => {
  try {
    const payload = JSON.parse(message.toString());
    const deviceInfo = transformDeviceData(payload, 'aaa', topic);
    deviceData.sim = deviceInfo;
    throttledEmit('sim', deviceInfo);
    if (deviceData.mainSource !== 'original') {
      setMainDevice(deviceInfo, 'aaa');
    }
  } catch (err) {
    console.error('Error parsing simulated device message:', err);
  }
});

simulatedClient.on('close', () => {
  connectionStatus.simulated = false;
  console.log('Simulated device broker disconnected');
});

simulatedClient.on('error', err => {
  connectionStatus.simulated = false;
  console.error('Simulated device client error:', err);
});

// Socket.io connection handler
io.on('connection', socket => {
  console.log(`Client connected: ${socket.id}`);
  socket.emit('initialData', {
    main: deviceData.main,
    sim: deviceData.sim,
    mainSource: deviceData.mainSource,
    connectionStatus
  });
  socket.on('disconnect', () => {
    console.log(`Client disconnected: ${socket.id}`);
  });
});

app.get('/api/devices', (req, res) => {
  res.json({
    success: true,
    data: { ...deviceData, connectionStatus }
  });
});

app.get('/api/health', (req, res) => {
  res.json({
    status: 'ok',
    timestamp: new Date().toISOString(),
    activeDevice: deviceData.mainSource,
    connectionStatus
  });
});

const PORT = process.env.PORT || 3001;
server.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});

process.on('SIGINT', () => {
  if (timeoutTimer) clearTimeout(timeoutTimer);
  originalClient.end(true);
  simulatedClient.end(true);
  server.close();
  process.exit(0);
});
