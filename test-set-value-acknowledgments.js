/**
 * Test Script for Set Value Acknowledgment Functionality
 * 
 * This script demonstrates how the new acknowledgment system works for set value operations.
 * It shows how to send set value commands and watch for acknowledgments.
 */

const axios = require('axios');
const io = require('socket.io-client');

// Configuration
const BASE_URL = 'http://localhost:5000';
const DEVICE_ID = '6762c2c73f96dce5736bb130'; // Replace with actual device ID
const SOCKET_URL = 'http://localhost:5000';

class SetValueAcknowledmentTest {
  constructor() {
    this.socket = null;
    this.pendingCommands = new Map();
  }

  async initialize() {
    // Connect to socket.io for real-time acknowledgments
    this.socket = io(SOCKET_URL, {
      transports: ['websocket', 'polling']
    });

    // Listen for acknowledgment events
    this.socket.on('deviceCommandSent', (data) => {
      console.log('\n🚀 COMMAND SENT EVENT:');
      console.log('   CommandId:', data.commandId);
      console.log('   Device:', data.deviceId);
      console.log('   Status:', data.status);
      if (data.setValues) {
        console.log('   Set Values:', data.setValues);
      }
      console.log('   Sent At:', data.sentAt);
    });

    this.socket.on('deviceCommandAcknowledged', (data) => {
      console.log('\n✅ ACKNOWLEDGMENT RECEIVED:');
      console.log('   CommandId:', data.commandId);
      console.log('   Device:', data.deviceId);
      console.log('   Status:', data.status);
      console.log('   Response Time:', data.responseTime + 'ms');
      if (data.setValues) {
        console.log('   Set Values Confirmed:', data.setValues);
      }
      if (data.deviceResponse) {
        console.log('   Device Response:', data.deviceResponse);
      }
      console.log('   Acknowledged At:', data.acknowledgedAt);

      // Remove from pending commands
      this.pendingCommands.delete(data.commandId);
    });

    this.socket.on('deviceCommandTimeout', (data) => {
      console.log('\n⏰ COMMAND TIMEOUT:');
      console.log('   CommandId:', data.commandId);
      console.log('   Device:', data.deviceId);
      console.log('   Message:', data.message);

      // Remove from pending commands
      this.pendingCommands.delete(data.commandId);
    });

    this.socket.on('connect', () => {
      console.log('🔌 Connected to Socket.IO server');
    });

    this.socket.on('disconnect', () => {
      console.log('🔌 Disconnected from Socket.IO server');
    });

    // Wait for connection
    await new Promise((resolve) => {
      this.socket.on('connect', resolve);
    });
  }

  async testSetUPValue(voltage) {
    try {
      console.log(`\n🔧 Testing Set UP value: ${voltage}V`);
      
      const response = await axios.post(`${BASE_URL}/api/devices/${DEVICE_ID}/configure/set-up`, {
        setUP: voltage
      });

      if (response.data.success) {
        console.log('✅ Set UP command sent successfully');
        console.log('   Command ID:', response.data.commandId);
        console.log('   Message:', response.data.message);
        
        // Track pending command
        this.pendingCommands.set(response.data.commandId, {
          type: 'Set UP',
          value: voltage,
          sentAt: new Date()
        });
        
        return response.data.commandId;
      } else {
        console.log('❌ Failed to send Set UP command:', response.data.message);
        return null;
      }
    } catch (error) {
      console.error('❌ Error sending Set UP command:', error.response?.data || error.message);
      return null;
    }
  }

  async testSetOPValue(voltage) {
    try {
      console.log(`\n🔧 Testing Set OP value: ${voltage}V`);
      
      const response = await axios.post(`${BASE_URL}/api/devices/${DEVICE_ID}/configure/set-op`, {
        setOP: voltage
      });

      if (response.data.success) {
        console.log('✅ Set OP command sent successfully');
        console.log('   Command ID:', response.data.commandId);
        console.log('   Message:', response.data.message);
        
        // Track pending command
        this.pendingCommands.set(response.data.commandId, {
          type: 'Set OP',
          value: voltage,
          sentAt: new Date()
        });
        
        return response.data.commandId;
      } else {
        console.log('❌ Failed to send Set OP command:', response.data.message);
        return null;
      }
    } catch (error) {
      console.error('❌ Error sending Set OP command:', error.response?.data || error.message);
      return null;
    }
  }

  async testRefFcalValue(voltage) {
    try {
      console.log(`\n🔧 Testing Ref Fcal value: ${voltage}V`);
      
      const response = await axios.post(`${BASE_URL}/api/devices/${DEVICE_ID}/configure/ref-fcal`, {
        refFcal: voltage
      });

      if (response.data.success) {
        console.log('✅ Ref Fcal command sent successfully');
        console.log('   Command ID:', response.data.commandId);
        console.log('   Message:', response.data.message);
        
        // Track pending command
        this.pendingCommands.set(response.data.commandId, {
          type: 'Ref Fcal',
          value: voltage,
          sentAt: new Date()
        });
        
        return response.data.commandId;
      } else {
        console.log('❌ Failed to send Ref Fcal command:', response.data.message);
        return null;
      }
    } catch (error) {
      console.error('❌ Error sending Ref Fcal command:', error.response?.data || error.message);
      return null;
    }
  }

  async testMultipleSetValues() {
    try {
      console.log('\n🔧 Testing multiple set values (using combined alarm endpoint)');
      
      const response = await axios.post(`${BASE_URL}/api/devices/${DEVICE_ID}/configure/alarm`, {
        setup: { value: 1.25, enabled: true },
        setop: { value: -0.75, enabled: true },
        reffcal: { value: 0.50, enabled: true }
      });

      if (response.data.success) {
        console.log('✅ Multiple set values command sent successfully');
        console.log('   Command ID:', response.data.commandId);
        console.log('   Message:', response.data.message);
        
        // Track pending command
        this.pendingCommands.set(response.data.commandId, {
          type: 'Multiple Set Values',
          values: { setUP: 1.25, setOP: -0.75, refFcal: 0.50 },
          sentAt: new Date()
        });
        
        return response.data.commandId;
      } else {
        console.log('❌ Failed to send multiple set values command:', response.data.message);
        return null;
      }
    } catch (error) {
      console.error('❌ Error sending multiple set values command:', error.response?.data || error.message);
      return null;
    }
  }

  async checkCommandStatus(commandId) {
    try {
      const response = await axios.get(`${BASE_URL}/api/devices/acknowledgments/${commandId}`);
      
      if (response.data.success) {
        const cmd = response.data.data;
        console.log(`\n📊 Command ${commandId} Status:`);
        console.log('   Status:', cmd.status);
        console.log('   Sent At:', cmd.sentAt);
        console.log('   Acknowledged At:', cmd.acknowledgedAt);
        console.log('   Response Time:', cmd.responseTime + 'ms');
        return cmd;
      } else {
        console.log('❌ Command not found:', response.data.message);
        return null;
      }
    } catch (error) {
      console.error('❌ Error checking command status:', error.response?.data || error.message);
      return null;
    }
  }

  showPendingCommands() {
    if (this.pendingCommands.size === 0) {
      console.log('\n📋 No pending commands');
      return;
    }

    console.log(`\n📋 Pending Commands (${this.pendingCommands.size}):`);
    this.pendingCommands.forEach((command, commandId) => {
      const elapsed = Date.now() - command.sentAt.getTime();
      console.log(`   ${commandId}: ${command.type} - ${elapsed}ms ago`);
    });
  }

  async runTests() {
    console.log('🚀 Starting Set Value Acknowledgment Tests...');
    console.log('📱 Device ID:', DEVICE_ID);
    
    // Test 1: Individual Set UP
    await this.testSetUPValue(2.50);
    await new Promise(resolve => setTimeout(resolve, 2000)); // Wait 2 seconds

    // Test 2: Individual Set OP  
    await this.testSetOPValue(-1.75);
    await new Promise(resolve => setTimeout(resolve, 2000)); // Wait 2 seconds

    // Test 3: Individual Ref Fcal
    await this.testRefFcalValue(0.25);
    await new Promise(resolve => setTimeout(resolve, 2000)); // Wait 2 seconds

    // Test 4: Multiple values at once
    await this.testMultipleSetValues();
    
    // Monitor pending commands
    const checkInterval = setInterval(() => {
      this.showPendingCommands();
    }, 5000);

    // Wait for acknowledgments or timeout
    setTimeout(() => {
      clearInterval(checkInterval);
      this.showPendingCommands();
      console.log('\n✅ Test completed. Check the results above.');
      this.socket.disconnect();
      process.exit(0);
    }, 30000); // Wait 30 seconds maximum
  }

  disconnect() {
    if (this.socket) {
      this.socket.disconnect();
    }
  }
}

// Run the tests
async function main() {
  const tester = new SetValueAcknowledmentTest();
  
  try {
    await tester.initialize();
    await tester.runTests();
  } catch (error) {
    console.error('❌ Test failed:', error);
    tester.disconnect();
    process.exit(1);
  }
}

// Handle process termination
process.on('SIGINT', () => {
  console.log('\n🛑 Test interrupted by user');
  process.exit(0);
});

if (require.main === module) {
  main();
}

module.exports = SetValueAcknowledmentTest;