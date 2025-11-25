const mqttService = require('./mqttService');

class SocketService {
  constructor() {
    this.io = null;
  }

  initialize(io) {
    this.io = io;
    this.setupSocketHandlers();
  }

  setupSocketHandlers() {
    this.io.on('connection', (socket) => {
      console.log(`🔗 Client connected: ${socket.id}`);
      
      // Send initial data to new client
      this.sendInitialData(socket);
      
      // Handle message sending from frontend
      socket.on('sendMessage', (messageData, callback) => {
        this.handleSendMessage(messageData, callback, socket.id);
      });

      // Handle device command sending from frontend
      socket.on('sendDeviceCommand', (commandData, callback) => {
        this.handleSendDeviceCommand(commandData, callback, socket.id);
      });

      socket.on('disconnect', () => {
        console.log(`❌ Client disconnected: ${socket.id}`);
      });
    });
  }

  sendInitialData(socket) {
    const deviceData = mqttService.getDeviceData();
    const connectionStatus = mqttService.getConnectionStatus();
    
    const initialData = {
      main: deviceData.device,
      sim: null,
      mainSource: 'device',
      connectionStatus
    };
    
    socket.emit('initialData', initialData);
    
    console.log('📤 Sent initial data to client:', {
      device: initialData.main ? initialData.main.name : 'No data',
      connectionStatus: connectionStatus.device ? 'Connected' : 'Disconnected'
    });
  }

  handleSendMessage(messageData, callback, socketId) {
    console.log('\n📨 MESSAGE SEND REQUEST RECEIVED:');
    console.log('🔗 Socket ID:', socketId);
    console.log('📄 Message Data:', JSON.stringify(messageData, null, 2));
    console.log('⏰ Request Time:', new Date().toISOString());
    
    try {
      const { text, type, targetDevice, timestamp } = messageData;
      
      if (!text || !text.trim()) {
        console.log('❌ Message validation failed: Empty text');
        callback({ success: false, error: 'Message text is required' });
        return;
      }

      console.log('✅ Message validation passed');
      console.log('📝 Message text:', text);
      console.log('🎯 Target type:', type);
      console.log('🔧 Target device:', targetDevice);

      if (!mqttService.isDeviceConnected()) {
        console.log('❌ Device 123 not connected');
        callback({ 
          success: false, 
          error: 'Device 123 is not connected' 
        });
        return;
      }

      const messagePayload = {
        message: text.trim(),
        timestamp: timestamp || new Date().toISOString(),
        sender: 'frontend',
        type: type || 'individual'
      };

      console.log('📡 Publishing message to device 123...');
      console.log('   Payload:', JSON.stringify(messagePayload, null, 2));

      mqttService.publishMessage(messagePayload, (err) => {
        if (err) {
          console.error('❌ Error publishing to device 123:', err);
          callback({ 
            success: false, 
            error: `Failed to send message: ${err.message}` 
          });
        } else {
          console.log('✅ Message published to device 123 successfully');
          const response = { 
            success: true, 
            messageId: `msg_${Date.now()}`,
            details: `Message sent to device 123`
          };
          console.log('✅ Message sending successful:', response);
          callback(response);
          
          // Notify all connected clients about the message
          this.io.emit('messageNotification', {
            type: 'sent',
            message: messagePayload,
            targets: 'device-123'
          });
        }
      });
    } catch (error) {
      console.error('❌ Error processing message:', error);
      callback({ 
        success: false, 
        error: 'Internal server error while processing message' 
      });
    }
  }

  handleSendDeviceCommand(commandData, callback, socketId) {
    console.log('\n📡 DEVICE COMMAND REQUEST RECEIVED:');
    console.log('🔗 Socket ID:', socketId);
    console.log('📄 Command Data:', JSON.stringify(commandData, null, 2));
    console.log('⏰ Request Time:', new Date().toISOString());
    
    try {
      const { commandType, deviceId, parameters, timestamp } = commandData;
      
      if (!commandType || !deviceId) {
        console.log('❌ Command validation failed: Missing required fields');
        callback({ success: false, error: 'Command type and device ID are required' });
        return;
      }

      console.log('✅ Command validation passed');
      console.log('🎯 Command type:', commandType);
      console.log('📱 Device ID:', deviceId);
      console.log('⚙️ Parameters:', JSON.stringify(parameters, null, 2));

      if (!mqttService.isDeviceConnected()) {
        console.log('❌ Device not connected');
        callback({ 
          success: false, 
          error: 'Device is not connected' 
        });
        return;
      }

      // ⚠️ IMPORTANT: Use complete settings frame format for ALL commands
      // Get current settings and update based on command type
      const commandId = `cmd_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
      
      // For legacy socket-based commands, we should redirect to proper API endpoints
      // But for backward compatibility, send in complete settings format
      const commandPayload = {
        "Device ID": deviceId,
        "Message Type": "settings",  // Always use "settings" type
        "sender": "Server",
        "CommandId": commandId,
        "Parameters": parameters  // This should be complete settings, not just changed values
      };

      console.log('📡 Publishing command in COMPLETE SETTINGS FORMAT:');
      console.log('   Payload:', JSON.stringify(commandPayload, null, 2));
      console.warn('⚠️  WARNING: Legacy socket command detected!');
      console.warn('⚠️  This should be complete settings. Use API endpoints instead for proper settings management.');

      mqttService.publishMessage(commandPayload, (err) => {
        if (err) {
          console.error('❌ Error publishing command:', err);
          callback({ 
            success: false, 
            error: `Failed to send command: ${err.message}` 
          });
        } else {
          console.log('✅ Command published successfully');
          const response = { 
            success: true, 
            commandId: commandId,
            details: `Command sent to device ${deviceId}`,
            warning: 'Legacy socket command - recommend using API endpoints for settings'
          };
          console.log('✅ Command sending successful:', response);
          callback(response);
          
          // Notify all connected clients about the command
          this.io.emit('commandNotification', {
            type: 'sent',
            command: commandPayload,
            target: deviceId
          });
        }
      });
    } catch (error) {
      console.error('❌ Error processing command:', error);
      callback({ 
        success: false, 
        error: 'Internal server error while processing command' 
      });
    }
  }

  emitToAll(event, data) {
    if (this.io) {
      this.io.emit(event, data);
    }
  }
}

// Export singleton instance
const socketService = new SocketService();
module.exports = socketService;