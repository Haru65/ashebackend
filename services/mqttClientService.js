/**
 * MQTT Client Service
 * Connects to MQTT broker, listens for device messages, and updates MongoDB
 */

const mqtt = require('mqtt');
const Device = require('../models/Device');
const DeviceHistory = require('../models/DeviceHistory');
const alarmMonitoringService = require('./alarmMonitoringService');

class MqttClientService {
  constructor(brokerUrl = 'mqtt://test.mosquitto.org', username = null, password = null) {
    this.brokerUrl = brokerUrl;
    this.username = username;
    this.password = password;
    this.client = null;
    this.isConnected = false;
    this.reconnectAttempts = 0;
    this.maxReconnectAttempts = 10;
  }

  /**
   * Convert received shunt values from integer format (no decimal) to decimal format
   * e.g., 689 → "68.9", 2550 → "25.50", 97 → "9.7", "919" → "91.9"
   * @param {number|string} value - The value to convert
   * @param {number} decimalPlaces - Number of decimal places (default 1 for current, 2 for voltage)
   * @returns {string} Formatted value with decimal
   */
  formatReceivedShuntValue(value, decimalPlaces = 1) {
    if (value === undefined || value === null) return null;
    
    // Convert to string and remove any whitespace
    let strValue = value.toString().trim();
    
    // Remove trailing .0 if present (handle case where value comes as "919.0")
    if (strValue.includes('.')) {
      const numValue = parseFloat(strValue);
      strValue = Math.round(numValue).toString();
    }
    
    // For integer values, we need to add the decimal point
    // Move decimal point from the right based on decimalPlaces
    // 689 with 1 decimal place → "68.9"
    // 2550 with 2 decimal places → "25.50"
    // 919 with 1 decimal place → "91.9"
    // 050 with 2 decimal places → "0.50"
    
    if (strValue.length <= decimalPlaces) {
      // Pad with leading zeros
      strValue = strValue.padStart(decimalPlaces + 1, '0');
    }
    
    const insertIndex = strValue.length - decimalPlaces;
    const formatted = strValue.slice(0, insertIndex) + '.' + strValue.slice(insertIndex);
    
    console.log(`📊 [SHUNT] Converted value: ${value} (${typeof value}) → ${formatted} (decimalPlaces: ${decimalPlaces})`);
    return formatted;
  }

  /**
   * Convert reference voltage values from integer format (no decimal) to decimal format
   * Divides by 100 to place decimal at 2 places from the right
   * e.g., 030 → "0.30", 123 → "1.23", 134 → "1.34"
   * @param {number|string} value - The value to convert
   * @returns {string} Formatted value with 2 decimal places
   */
  formatReceivedReferenceValue(value) {
    if (value === undefined || value === null) return null;
    
    // Convert to string and remove any existing padding
    let strValue = value.toString().trim();
    
    // If already has decimal, return as-is
    if (strValue.includes('.')) {
      return strValue;
    }
    
    // Convert string to number and divide by 100 to place decimal
    // "030" → 30 → 30/100 = 0.30
    // "123" → 123 → 123/100 = 1.23
    const numValue = parseInt(strValue, 10);
    const formatted = (numValue / 100).toFixed(2);
    
    console.log(`📊 Reference value converted: ${value} → ${formatted}`);
    return formatted;
  }

  /**
   * Initialize and connect to MQTT broker
   */
  connect() {
    console.log(`[MQTT Client] Connecting to broker: ${this.brokerUrl}`);

    const connectOptions = {
      clientId: `iot_backend_${Date.now()}_${Math.random().toString(36).substring(7)}`,
      clean: true,
      connectTimeout: 4000,
      reconnectPeriod: 5000,
      keepalive: 60
    };

    // Add authentication if provided
    if (this.username && this.password) {
      connectOptions.username = this.username;
      connectOptions.password = this.password;
      console.log(`[MQTT Client] 🔐 Using authentication (username: ${this.username})`);
    }

    this.client = mqtt.connect(this.brokerUrl, connectOptions);

    // Handle connection
    this.client.on('connect', () => {
      console.log('[MQTT Client] ✅ Connected to MQTT broker');
      this.isConnected = true;
      this.reconnectAttempts = 0;

      // Subscribe to wildcard topic to capture all device messages
      const topic = 'devices/+/data';
      this.client.subscribe(topic, { qos: 1 }, (err) => {
        if (err) {
          console.error('[MQTT Client] ❌ Subscription error:', err);
        } else {
          console.log(`[MQTT Client] 📡 Subscribed to topic: ${topic}`);
        }
      });
    });

    // Handle incoming messages
    this.client.on('message', async (topic, message) => {
      try {
        await this.handleMessage(topic, message);
      } catch (error) {
        console.error('[MQTT Client] ❌ Error handling message:', error);
      }
    });

    // Handle errors
    this.client.on('error', (error) => {
      console.error('[MQTT Client] ❌ Connection error:', error);
      this.isConnected = false;
    });

    // Handle disconnection
    this.client.on('disconnect', () => {
      console.log('[MQTT Client] 🔌 Disconnected from broker');
      this.isConnected = false;
    });

    // Handle offline
    this.client.on('offline', () => {
      console.log('[MQTT Client] 📵 Client offline');
      this.isConnected = false;
    });

    // Handle reconnection
    this.client.on('reconnect', () => {
      this.reconnectAttempts++;
      console.log(`[MQTT Client] 🔄 Reconnecting... (Attempt ${this.reconnectAttempts})`);
      
      if (this.reconnectAttempts >= this.maxReconnectAttempts) {
        console.error('[MQTT Client] ❌ Max reconnection attempts reached. Stopping...');
        this.client.end();
      }
    });

    // Handle close
    this.client.on('close', () => {
      console.log('[MQTT Client] Connection closed');
      this.isConnected = false;
    });
  }

  /**
   * Handle incoming MQTT message
   * @param {string} topic - MQTT topic (e.g., 'devices/123/data')
   * @param {Buffer} message - Message payload
   */
  async handleMessage(topic, message) {
    try {
      // Extract deviceId from topic path (e.g., 'devices/123/data' -> '123')
      const topicParts = topic.split('/');
      if (topicParts.length < 3 || topicParts[0] !== 'devices') {
        console.warn(`[MQTT Client] ⚠️ Invalid topic format: ${topic}`);
        return;
      }

      const deviceId = topicParts[1];
      
      // Parse JSON message payload
      let payload;
      try {
        payload = JSON.parse(message.toString());
      } catch (parseError) {
        console.error(`[MQTT Client] ❌ Failed to parse JSON for device ${deviceId}:`, parseError);
        return;
      }

      console.log(`[MQTT Client] 📩 Received message from device ${deviceId}:`, payload);

      // Update device in MongoDB
      await this.updateDevice(deviceId, payload, topic);

      // Store message in DeviceHistory collection
      await this.storeHistory(deviceId, payload, topic);

      // Check alarms for this device data (CRITICAL: This triggers email notifications!)
      const event = payload.Parameters?.Event || payload.EVENT || payload.event || 'NORMAL';
      
      const sensorData = {
        dcv: payload.Parameters?.["Shunt Voltage"] || payload.dcv || 0,
        dci: payload.Parameters?.["Shunt Current"] || payload.dci || 0,
        acv: payload.Parameters?.["Reference OV"] || payload.acv || 0,
        ref_1: payload.Parameters?.["Reference Fail"] || payload.ref_1 || 0,
        ref_2: payload.Parameters?.["Reference UP"] || payload.ref_2 || 0,
        ref_3: payload.Parameters?.["Reference OV"] || payload.ref_3 || 0,
        EVENT: event,
        ...payload
      };
      
      console.log(`[MQTT Client] 🔔 Alarm Check Data for ${deviceId}:`, {
        dci: sensorData.dci,
        dcv: sensorData.dcv,
        acv: sensorData.acv,
        event: event
      });
      
      await alarmMonitoringService.checkAlarmsForDevice(sensorData, deviceId, event);

      console.log(`[MQTT Client] ✅ Successfully processed message from device ${deviceId}`);

    } catch (error) {
      console.error('[MQTT Client] ❌ Error in handleMessage:', error);
    }
  }

  /**
   * Update device in MongoDB with new data
   * @param {string} deviceId - Device identifier
   * @param {object} payload - Message payload
   * @param {string} topic - MQTT topic
   */
  async updateDevice(deviceId, payload, topic) {
    try {
      const updateData = {
        $set: {
          'sensors.battery': payload.battery !== undefined ? payload.battery : undefined,
          'sensors.signal': payload.signal !== undefined ? payload.signal : undefined,
          'sensors.temperature': payload.temperature !== undefined ? payload.temperature : undefined,
          'sensors.humidity': payload.humidity !== undefined ? payload.humidity : undefined,
          'sensors.pressure': payload.pressure !== undefined ? payload.pressure : undefined,
          'status.state': 'online',
          'status.lastSeen': new Date(),
          'mqtt.topics.data': topic,
          // Map Parameters object from MQTT payload to device configuration
          'configuration.deviceSettings.electrode': payload.Parameters?.Electrode !== undefined ? payload.Parameters.Electrode : undefined,
          'configuration.deviceSettings.event': payload.Parameters?.Event !== undefined ? payload.Parameters.Event : undefined,
          'configuration.deviceSettings.manualModeAction': payload.Parameters?.["Manual Mode Action"] !== undefined ? payload.Parameters["Manual Mode Action"] : undefined,
        }
      };

      // Get shunt voltage value
      const shuntVoltageRaw = payload.Parameters?.["Shunt Voltage"] ?? payload["Shunt Voltage"];
      const shuntVoltageConverted = shuntVoltageRaw !== undefined ? this.formatReceivedShuntValue(shuntVoltageRaw, 2) : undefined;
      if (shuntVoltageConverted !== undefined) {
        updateData.$set['configuration.deviceSettings.shuntVoltage'] = shuntVoltageConverted;
        console.log(`[MQTT] 🔋 Shunt Voltage: ${shuntVoltageRaw} → ${shuntVoltageConverted}`);
      }

      // Get shunt current value
      const shuntCurrentRaw = payload.Parameters?.["Shunt Current"] ?? payload["Shunt Current"];
      const shuntCurrentConverted = shuntCurrentRaw !== undefined ? this.formatReceivedShuntValue(shuntCurrentRaw, 1) : undefined;
      if (shuntCurrentConverted !== undefined) {
        updateData.$set['configuration.deviceSettings.shuntCurrent'] = shuntCurrentConverted;
        console.log(`[MQTT] 🔌 Shunt Current: ${shuntCurrentRaw} → ${shuntCurrentConverted}`);
      }

      // Get reference fail value
      const referenceFailRaw = payload.Parameters?.["Reference Fail"] ?? payload["Reference Fail"];
      const referenceFailConverted = referenceFailRaw !== undefined ? this.formatReceivedReferenceValue(referenceFailRaw) : undefined;
      if (referenceFailConverted !== undefined) {
        updateData.$set['configuration.deviceSettings.referenceFail'] = referenceFailConverted;
        console.log(`[MQTT] 📊 Reference Fail: ${referenceFailRaw} → ${referenceFailConverted}`);
      }

      // Get reference UP value
      const referenceUPRaw = payload.Parameters?.["Reference UP"] ?? payload["Reference UP"];
      const referenceUPConverted = referenceUPRaw !== undefined ? this.formatReceivedReferenceValue(referenceUPRaw) : undefined;
      if (referenceUPConverted !== undefined) {
        updateData.$set['configuration.deviceSettings.referenceUP'] = referenceUPConverted;
        console.log(`[MQTT] 📊 Reference UP: ${referenceUPRaw} → ${referenceUPConverted}`);
      }

      // Get reference OP value
      const referenceOPRaw = payload.Parameters?.["Reference OP"] ?? payload["Reference OV"] ?? payload["Reference OP"];
      const referenceOPConverted = referenceOPRaw !== undefined ? this.formatReceivedReferenceValue(referenceOPRaw) : undefined;
      if (referenceOPConverted !== undefined) {
        updateData.$set['configuration.deviceSettings.referenceOP'] = referenceOPConverted;
        console.log(`[MQTT] 📊 Reference OP: ${referenceOPRaw} → ${referenceOPConverted}`);
      }

      // Add remaining digital and configuration fields
      updateData.$set['configuration.deviceSettings.di1'] = payload.Parameters?.["DI1"] !== undefined ? payload.Parameters["DI1"] : undefined;
      updateData.$set['configuration.deviceSettings.di2'] = payload.Parameters?.["DI2"] !== undefined ? payload.Parameters["DI2"] : undefined;
      updateData.$set['configuration.deviceSettings.di3'] = payload.Parameters?.["DI3"] !== undefined ? payload.Parameters["DI3"] : undefined;
      updateData.$set['configuration.deviceSettings.di4'] = payload.Parameters?.["DI4"] !== undefined ? payload.Parameters["DI4"] : undefined;
      updateData.$set['configuration.deviceSettings.interruptOnTime'] = payload.Parameters?.["Interrupt ON Time"] !== undefined ? payload.Parameters["Interrupt ON Time"] : undefined;
      updateData.$set['configuration.deviceSettings.interruptOffTime'] = payload.Parameters?.["Interrupt OFF Time"] !== undefined ? payload.Parameters["Interrupt OFF Time"] : undefined;
      updateData.$set['configuration.deviceSettings.interruptStartTimestamp'] = payload.Parameters?.["Interrupt Start TimeStamp"] !== undefined ? payload.Parameters["Interrupt Start TimeStamp"] : undefined;
      updateData.$set['configuration.deviceSettings.interruptStopTimestamp'] = payload.Parameters?.["Interrupt Stop TimeStamp"] !== undefined ? payload.Parameters["Interrupt Stop TimeStamp"] : undefined;
      updateData.$set['configuration.deviceSettings.dpolInterval'] = payload.Parameters?.["DPOL Interval"] !== undefined ? payload.Parameters["DPOL Interval"] : undefined;
      updateData.$set['configuration.deviceSettings.depolarizationStartTimestamp'] = payload.Parameters?.["Depolarization Start TimeStamp"] !== undefined ? payload.Parameters["Depolarization Start TimeStamp"] : undefined;
      updateData.$set['configuration.deviceSettings.depolarizationStopTimestamp'] = payload.Parameters?.["Depolarization Stop TimeStamp"] !== undefined ? payload.Parameters["Depolarization Stop TimeStamp"] : undefined;
      updateData.$set['configuration.deviceSettings.instantMode'] = payload.Parameters?.["Instant Mode"] !== undefined ? payload.Parameters["Instant Mode"] : undefined;
      updateData.$set['configuration.deviceSettings.instantStartTimestamp'] = payload.Parameters?.["Instant Start TimeStamp"] !== undefined ? payload.Parameters["Instant Start TimeStamp"] : undefined;
      updateData.$set['configuration.deviceSettings.instantEndTimestamp'] = payload.Parameters?.["Instant End TimeStamp"] !== undefined ? payload.Parameters["Instant End TimeStamp"] : undefined;

      // Remove undefined values
      Object.keys(updateData.$set).forEach(key => {
        if (updateData.$set[key] === undefined) {
          delete updateData.$set[key];
        }
      });

      // Update or create device
      const device = await Device.findOneAndUpdate(
        { deviceId: deviceId },
        updateData,
        { 
          new: true, 
          upsert: true,
          setDefaultsOnInsert: true
        }
      );

      console.log(`[MQTT Client] 💾 Updated device ${deviceId} in MongoDB with all parameters`);
      return device;

    } catch (error) {
      console.error(`[MQTT Client] ❌ Error updating device ${deviceId}:`, error);
      throw error;
    }
  }

  /**
   * Store message in DeviceHistory collection
   * @param {string} deviceId - Device identifier
   * @param {object} payload - Message payload
   * @param {string} topic - MQTT topic
   */
  async storeHistory(deviceId, payload, topic) {
    try {
      const historyEntry = await DeviceHistory.create({
        deviceId,
        timestamp: new Date(),
        data: payload,
        topic
      });

      console.log(`[MQTT Client] 📊 Stored history entry for device ${deviceId}`);
      return historyEntry;

    } catch (error) {
      console.error(`[MQTT Client] ❌ Error storing history for device ${deviceId}:`, error);
      throw error;
    }
  }

  /**
   * Disconnect from MQTT broker
   */
  disconnect() {
    if (this.client) {
      console.log('[MQTT Client] Disconnecting...');
      this.client.end(true);
      this.client = null;
      this.isConnected = false;
    }
  }

  /**
   * Get connection status
   */
  getStatus() {
    return {
      connected: this.isConnected,
      reconnectAttempts: this.reconnectAttempts,
      brokerUrl: this.brokerUrl
    };
  }
}

// Export singleton instance
module.exports = new MqttClientService();
