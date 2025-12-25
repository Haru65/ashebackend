// Event/Mode mapping helper
function mapEventCode(eventCode) {
  const eventMappings = {
    0: 'Normal',
    1: 'Interrupt',
    2: 'Manual',
    3: 'DEPOL',
    4: 'Instant'
  };
  
  const numericCode = parseInt(eventCode);
  return eventMappings[numericCode] || `Unknown (${eventCode})`;
}

// Digital Input/Output mapping helper
function mapDigitalIOValue(value) {
  const numericValue = parseInt(value);
  const displayMap = {
    0: 'OPEN',
    1: 'CLOSE'
  };
  return displayMap[numericValue] !== undefined ? displayMap[numericValue] : `Unknown (${value})`;
}

// Helper function to normalize device parameter names
function normalizeDeviceParams(params) {
  const normalized = { ...params };
  
  // Map "Digital Input X" to "DIX"
  if (params['Digital Input 1'] !== undefined) normalized.DI1 = params['Digital Input 1'];
  if (params['Digital Input 2'] !== undefined) normalized.DI2 = params['Digital Input 2'];
  if (params['Digital Input 3'] !== undefined) normalized.DI3 = params['Digital Input 3'];
  if (params['Digital Input 4'] !== undefined) normalized.DI4 = params['Digital Input 4'];
  
  // Map "Digital Output" to "DO1" (assuming single output or primary output)
  if (params['Digital Output'] !== undefined) {
    normalized.DO1 = params['Digital Output'];
  }
  
  return normalized;
}

// Helper function to convert text values to numeric (OPEN/CLOSE -> 0/1 or OFF/ON -> 0/1)
function normalizeDigitalIOValue(value) {
  if (typeof value === 'number') return value;
  if (typeof value === 'string') {
    const lower = value.toUpperCase();
    if (lower === 'CLOSE' || lower === 'ON') return 1;
    if (lower === 'OPEN' || lower === 'OFF') return 0;
  }
  return value;
}

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
  let params = payload.Parameters || payload;
  
  // Normalize parameter names from device format to standard format
  params = normalizeDeviceParams(params);
  
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
  
  // Add EVENT status with readable mapping
  if (params.EVENT !== undefined) {
    const eventText = mapEventCode(params.EVENT);
    metrics.push({
      type: 'EVENT',
      value: `${eventText} (${params.EVENT})`,
      rawValue: params.EVENT,
      displayValue: eventText,
      icon: 'bi-exclamation-circle'
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
  if (params.DI1 !== undefined) {
    const normalizedValue = normalizeDigitalIOValue(params.DI1);
    metrics.push({
      type: 'DI1',
      value: mapDigitalIOValue(normalizedValue),
      rawValue: normalizedValue,
      icon: 'bi-toggles',
      category: 'Digital Input'
    });
  }
  if (params.DI2 !== undefined) {
    const normalizedValue = normalizeDigitalIOValue(params.DI2);
    metrics.push({
      type: 'DI2',
      value: mapDigitalIOValue(normalizedValue),
      rawValue: normalizedValue,
      icon: 'bi-toggles',
      category: 'Digital Input'
    });
  }
  if (params.DI3 !== undefined) {
    const normalizedValue = normalizeDigitalIOValue(params.DI3);
    metrics.push({
      type: 'DI3',
      value: mapDigitalIOValue(normalizedValue),
      rawValue: normalizedValue,
      icon: 'bi-toggles',
      category: 'Digital Input'
    });
  }
  if (params.DI4 !== undefined) {
    const normalizedValue = normalizeDigitalIOValue(params.DI4);
    metrics.push({
      type: 'DI4',
      value: mapDigitalIOValue(normalizedValue),
      rawValue: normalizedValue,
      icon: 'bi-toggles',
      category: 'Digital Input'
    });
  }
  
  // Add Digital Outputs (DO1, DO2, DO3, DO4)
  if (params.DO1 !== undefined) {
    const normalizedValue = normalizeDigitalIOValue(params.DO1);
    metrics.push({
      type: 'DO1',
      value: mapDigitalIOValue(normalizedValue),
      rawValue: normalizedValue,
      icon: 'bi-arrow-right-square',
      category: 'Digital Output'
    });
  }
  if (params.DO2 !== undefined) {
    const normalizedValue = normalizeDigitalIOValue(params.DO2);
    metrics.push({
      type: 'DO2',
      value: mapDigitalIOValue(normalizedValue),
      rawValue: normalizedValue,
      icon: 'bi-arrow-right-square',
      category: 'Digital Output'
    });
  }
  if (params.DO3 !== undefined) {
    const normalizedValue = normalizeDigitalIOValue(params.DO3);
    metrics.push({
      type: 'DO3',
      value: mapDigitalIOValue(normalizedValue),
      rawValue: normalizedValue,
      icon: 'bi-arrow-right-square',
      category: 'Digital Output'
    });
  }
  if (params.DO4 !== undefined) {
    const normalizedValue = normalizeDigitalIOValue(params.DO4);
    metrics.push({
      type: 'DO4',
      value: mapDigitalIOValue(normalizedValue),
      rawValue: normalizedValue,
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
  createThrottledEmit,
  mapEventCode
};