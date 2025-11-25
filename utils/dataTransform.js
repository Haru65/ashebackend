// Basic data transform helper
function transformDeviceData(payload, topic) {
  // Extract device ID from MQTT topic (e.g., 'devices/123/data' -> '123')
  let deviceIdFromTopic = "123"; // default
  if (topic) {
    const topicParts = topic.split('/');
    if (topicParts.length >= 2) {
      deviceIdFromTopic = topicParts[1];
    }
  }
  
  // Use device ID from topic, not from payload
  const deviceId = deviceIdFromTopic;
  
  return {
    id: deviceId,
    name: payload.API ?? `Device-${deviceId}`,
    icon: 'bi-device',
    type: 'IoT Sensor',
    location: payload.LATITUDE && payload.LONGITUDE && (payload.LATITUDE !== '00°00\'' && payload.LONGITUDE !== '000°00\'')
      ? `${payload.LATITUDE}, ${payload.LONGITUDE}` : "Mumbai, India",
    status: payload.EVENT ?? "NORMAL",
    lastSeen: payload.TimeStamp ?? new Date().toISOString(),
    timestamp: Date.now(),
    source: `device-${deviceId}`,
    metrics: [
      // Add Device ID as first metric
      {
        type: 'Device ID',
        value: deviceId,
        icon: 'bi-hash'
      },
      // Add Message Type
      {
        type: 'Message Type',
        value: payload['Message Type'] || 'LOG DATA',
        icon: 'bi-envelope'
      },
      // Add Sender
      {
        type: 'Sender',
        value: payload.Sender || 'Device',
        icon: 'bi-send'
      },
      // Add Parameters as JSON
      {
        type: 'Parameters',
        value: JSON.stringify(payload.Parameters || payload, null, 2),
        icon: 'bi-code-square'
      }
    ]
  };
}

// Throttle function for updates
const UPDATE_THROTTLE = 500; // Reduced to 500ms for more responsive updates
let lastUpdateTime = 0;
let lastConnectionStatusUpdate = 0;

function createThrottledEmit(io, mqttService) {
  return function throttledEmit(data) {
    const now = Date.now();
    
    // Always get current connection status
    const connectionStatus = mqttService ? mqttService.getConnectionStatus() : { device: false };
    
    // Throttle device data updates
    const shouldUpdateData = now - lastUpdateTime >= UPDATE_THROTTLE;
    
    // Send connection status update more frequently (every 200ms) or when it changes
    const shouldUpdateStatus = now - lastConnectionStatusUpdate >= 200;
    
    if (shouldUpdateData) {
      // Send full update with data and connection status
      io.emit('deviceUpdate', { 
        type: 'device', 
        data,
        connectionStatus 
      });
      lastUpdateTime = now;
      lastConnectionStatusUpdate = now;
    } else if (shouldUpdateStatus) {
      // Send connection status update only
      io.emit('deviceUpdate', { 
        type: 'status', 
        connectionStatus 
      });
      lastConnectionStatusUpdate = now;
    }
  };
}

module.exports = {
  transformDeviceData,
  createThrottledEmit
};