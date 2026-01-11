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
  
  // Add Reference voltages (REF1, REF2, REF3) with OPEN display for > 5.00V
  if (params.REF1 !== undefined) {
    const ref1Value = parseFloat(params.REF1);
    metrics.push({
      type: 'REF1',
      value: ref1Value > 5.00 ? 'OPEN' : params.REF1,
      icon: 'bi-graph-up'
    });
  }
  if (params.REF2 !== undefined) {
    const ref2Value = parseFloat(params.REF2);
    metrics.push({
      type: 'REF2',
      value: ref2Value > 5.00 ? 'OPEN' : params.REF2,
      icon: 'bi-graph-up'
    });
  }
  if (params.REF3 !== undefined) {
    const ref3Value = parseFloat(params.REF3);
    metrics.push({
      type: 'REF3',
      value: ref3Value > 5.00 ? 'OPEN' : params.REF3,
      icon: 'bi-graph-up'
    });
  }
  
  // Add REF alarm states (REF/OP, REF/UP, REF FAIL)
  if (params['REF/OP'] !== undefined || params.REF_OP !== undefined) {
    metrics.push({
      type: 'REF/OP',
      value: params['REF/OP'] || params.REF_OP,
      icon: 'bi-exclamation-triangle'
    });
  }
  if (params['REF/UP'] !== undefined || params.REF_UP !== undefined) {
    metrics.push({
      type: 'REF/UP',
      value: params['REF/UP'] || params.REF_UP,
      icon: 'bi-arrow-up-circle'
    });
  }
  if (params['REF FAIL'] !== undefined || params.REF_FAIL !== undefined) {
    metrics.push({
      type: 'REF FAIL',
      value: params['REF FAIL'] || params.REF_FAIL,
      icon: 'bi-x-circle'
    });
  }
  
  // Add Digital Inputs (DI1, DI2, DI3, DI4)
  // Device sends these as "Digital Input 1-4" with OPEN/CLOSE or numeric values
  const di1Value = params.DI1 !== undefined ? params.DI1 : params['Digital Input 1'];
  if (di1Value !== undefined) {
    metrics.push({
      type: 'DI1',
      value: di1Value,
      icon: 'bi-toggle-on',
      category: 'Digital Input'
    });
  }
  
  const di2Value = params.DI2 !== undefined ? params.DI2 : params['Digital Input 2'];
  if (di2Value !== undefined) {
    metrics.push({
      type: 'DI2',
      value: di2Value,
      icon: 'bi-toggle-on',
      category: 'Digital Input'
    });
  }
  
  const di3Value = params.DI3 !== undefined ? params.DI3 : params['Digital Input 3'];
  if (di3Value !== undefined) {
    metrics.push({
      type: 'DI3',
      value: di3Value,
      icon: 'bi-toggle-on',
      category: 'Digital Input'
    });
  }
  
  const di4Value = params.DI4 !== undefined ? params.DI4 : params['Digital Input 4'];
  if (di4Value !== undefined) {
    metrics.push({
      type: 'DI4',
      value: di4Value,
      icon: 'bi-toggle-on',
      category: 'Digital Input'
    });
  }
  
  // Add Digital Output (DO1)
  // Device sends this as "Digital Output" with ON/OFF or numeric values
  const do1Value = params.DO1 !== undefined ? params.DO1 : params['Digital Output'];
  if (do1Value !== undefined) {
    metrics.push({
      type: 'DO1',
      value: do1Value,
      icon: 'bi-arrow-right-square',
      category: 'Digital Output'
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
  
  return {
    id: deviceId,
    name: payload.API ?? `Device-${deviceId}`,
    icon: 'bi-device',
    type: 'IoT Sensor',
    location: null, // Will be updated from telemetry after geocoding
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