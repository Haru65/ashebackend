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
  
  // Extract parameters from payload (could be in 'Parameters' key or at root level)
  const params = payload.Parameters || payload;
  
  // Build metrics array with individual values
  const metrics = [];
  
  // Add LOG number if present
  if (params.LOG !== undefined) {
    metrics.push({
      type: 'LOG',
      value: params.LOG,
      icon: 'bi-journal-text'
    });
  }
  
  // Add EVENT status
  if (params.EVENT !== undefined) {
    metrics.push({
      type: 'EVENT',
      value: params.EVENT,
      icon: 'bi-exclamation-circle'
    });
  }
  
  // Add Reference voltages (REF1, REF2, REF3)
  if (params.REF1 !== undefined) {
    metrics.push({
      type: 'REF1',
      value: params.REF1,
      icon: 'bi-graph-up'
    });
  }
  if (params.REF2 !== undefined) {
    metrics.push({
      type: 'REF2',
      value: params.REF2,
      icon: 'bi-graph-up'
    });
  }
  if (params.REF3 !== undefined) {
    metrics.push({
      type: 'REF3',
      value: params.REF3,
      icon: 'bi-graph-up'
    });
  }
  
  // Add DC Voltage
  if (params.DCV !== undefined) {
    metrics.push({
      type: 'DCV',
      value: params.DCV,
      icon: 'bi-battery-charging'
    });
  }
  
  // Add DC Current
  if (params.DCI !== undefined) {
    metrics.push({
      type: 'DCI',
      value: params.DCI,
      icon: 'bi-lightning-charge'
    });
  }
  
  // Add AC Voltage
  if (params.ACV !== undefined) {
    metrics.push({
      type: 'ACV',
      value: params.ACV,
      icon: 'bi-battery'
    });
  }
  
  // Add AC Current
  if (params.ACI !== undefined) {
    metrics.push({
      type: 'ACI',
      value: params.ACI,
      icon: 'bi-lightning'
    });
  }
  
  return {
    id: deviceId,
    name: payload.API ?? `Device-${deviceId}`,
    icon: 'bi-device',
    type: 'IoT Sensor',
    location: params.LATITUDE && params.LONGITUDE && (params.LATITUDE !== '00°00\'' && params.LONGITUDE !== '000°00\'')
      ? `${params.LATITUDE}, ${params.LONGITUDE}` : "Mumbai, India",
    status: params.EVENT ?? "NORMAL",
    lastSeen: params.TimeStamp ?? new Date().toISOString(),
    timestamp: Date.now(),
    source: `device-${deviceId}`,
    metrics: metrics
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