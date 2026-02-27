const express = require('express');
const http = require('http');
const cors = require('cors');
require('dotenv').config();

// Import configurations
const { connectDB } = require('./config/database');
const { initializeSocket } = require('./config/socket');

// Import services
const mqttService = require('./services/mqttService');
const socketService = require('./services/socketService');
const deviceStatusMonitor = require('./services/deviceStatusMonitor');
const alarmMonitoringService = require('./services/alarmMonitoringService');
const { initializeServices, shutdownServices } = require('./initIoTServices');
const UserLifecycleMonitor = require('./middleware/userLifecycleMonitor');
const EmailService = require('./services/emailService');

// Import routes
const routes = require('./routes');
const deviceConfigRoutes = require('./routes/deviceConfig');
// telemetryRoutes handled in routes/index.js

const app = express();
const server = http.createServer(app);

// Initialize Socket.IO
const io = initializeSocket(server);

// Connect to database
connectDB();

// Middleware
// TEMPORARY: Allow all origins for testing deployment
// TODO: Set FRONTEND_URLS on Render with exact Vercel origin and revert this
app.use(cors({
  origin: true, // Allow any origin
  methods: ["GET", "POST", "PUT", "DELETE", "OPTIONS"],
  credentials: true,
  allowedHeaders: ["Content-Type", "Authorization", "Accept"]
}));
app.use(express.json());

// Initialize services
mqttService.initialize(io);
socketService.initialize(io);
alarmMonitoringService.initialize(io);

// Routes - ORDER MATTERS! Mount more specific routes before generic ones
app.use('/api', deviceConfigRoutes); // Mount device config routes FIRST (more specific: /api/devices/:id/configure/...)
app.use('/', routes); // Mount generic routes INCLUDING telemetry (has /api/telemetry)

// Periodic status logging
const startStatusReporting = () => {
  setInterval(() => {
    console.log('\n📊 === STATUS REPORT ===');
    console.log('⏰ Time:', new Date().toISOString());
    console.log('🔗 Device 123 Status:', mqttService.isDeviceConnected() ? '✅ Connected' : '❌ Disconnected');
    
    const deviceData = mqttService.getDeviceData();
    console.log('📱 Device Data:', deviceData.device ? `✅ Available (${deviceData.device.name})` : '❌ No data');
    
    const lastUpdate = mqttService.getLastTimestamp();
    console.log('🔄 Last update:', lastUpdate ? new Date(lastUpdate).toISOString() : 'Never');
    console.log('========================\n');
  }, 30000); // Report every 30 seconds
};

// Start user lifecycle monitoring
const startUserMonitoring = () => {
  // Log user count and check for unexpected deletions every hour
  if (process.env.ENABLE_USER_LIFECYCLE_LOGS !== 'false') {
    UserLifecycleMonitor.startPeriodicMonitoring(60); // Check every 60 minutes
  }
};

// Start device status monitor
const startDeviceStatusMonitoring = () => {
  console.log('🚀 Starting device status monitor service...');
  deviceStatusMonitor.start();
};

// Initialize and verify email service
const initializeEmailService = () => {
  try {
    const emailService = new EmailService();
    const providerStatus = emailService.getProviderStatus();
    
    console.log('\n📧 === EMAIL SERVICE STATUS ===');
    console.log('Gmail:', providerStatus.gmail.configured ? '✅ Configured' : '❌ NOT configured');
    console.log('Outlook:', providerStatus.outlook.configured ? '✅ Configured' : '❌ NOT configured');
    console.log('SMTP:', providerStatus.smtp.configured ? '✅ Configured' : '❌ NOT configured');
    
    if (!providerStatus.gmail.configured && !providerStatus.outlook.configured && !providerStatus.smtp.configured) {
      console.error('\n⚠️ WARNING: No email provider configured!');
      console.error('   Please set email environment variables on Render:');
      console.error('   - GMAIL_USER and GMAIL_APP_PASSWORD');
      console.error('   - OR OUTLOOK_USER and OUTLOOK_PASSWORD');
      console.error('   - OR SMTP_HOST, SMTP_PORT, SMTP_USER, SMTP_PASSWORD');
      console.error('   Email notifications will FAIL until configured.\n');
    } else {
      console.log('✅ Email service ready for sending notifications\n');
    }
  } catch (error) {
    console.error('❌ Error initializing email service:', error.message);
  }
};

// Start the server
const PORT = process.env.PORT || 3001;
server.listen(PORT, () => {
  console.log(`🚀 Server running on port ${PORT}`);
  console.log('📊 Device Configuration initialized');
  console.log('⏳ Waiting for real MQTT data from device 123...');
  
  // Check email service immediately on startup
  initializeEmailService();
  
  // NOTE: Commented out initializeServices as mqttService.js already handles MQTT connection
  // If you need the generic MQTT client for multiple devices, use different clientIds
  // setTimeout(() => {
  //   initializeServices({
  //     mqttBroker: process.env.MQTT_BROKER_URL || 'mqtt://test.mosquitto.org',
  //     statusCheckInterval: 2 // Check every 2 minutes
  //   });
  // }, 2000); // Wait 2 seconds for MongoDB connection to stabilize
  
  // Start periodic status reporting
  startStatusReporting();
  
  // Start device status monitoring
  startDeviceStatusMonitoring();
  
  // Start user lifecycle monitoring
  startUserMonitoring();
});

// Graceful shutdown
const gracefulShutdown = () => {
  console.log('\n🔄 Shutting down gracefully...');
  
  // Stop device status monitor
  deviceStatusMonitor.stop();
  
  // Shutdown IoT services
  shutdownServices();
  
  mqttService.disconnect();
  server.close(() => {
    console.log('✅ Server closed successfully');
    process.exit(0);
  });
};

process.on('SIGINT', gracefulShutdown);
process.on('SIGTERM', gracefulShutdown);