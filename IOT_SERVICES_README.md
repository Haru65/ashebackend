# IoT Backend Services

This folder contains the backend services for managing IoT devices, MQTT communication, and device status monitoring.

## Services

### 1. MQTT Client Service (`services/mqttClientService.js`)

Connects to an MQTT broker and listens for device messages.

**Features:**
- ✅ Connects to MQTT broker (default: test.mosquitto.org)
- ✅ Subscribes to wildcard topic `devices/+/data`
- ✅ Extracts deviceId from topic path (e.g., `devices/123/data` → `123`)
- ✅ Parses JSON message payloads
- ✅ Updates device in MongoDB with new sensor data
- ✅ Sets device status to 'online' and updates lastSeen timestamp
- ✅ Stores messages in DeviceHistory collection
- ✅ Automatic reconnection on connection loss
- ✅ Comprehensive error handling and logging

**Message Format:**
```json
{
  "battery": 85,
  "signal": 90,
  "temperature": 22.5,
  "humidity": 45,
  "pressure": 1013
}
```

**Topics:**
- `devices/123/data` - Device 123 sensor data
- `devices/234/data` - Device 234 sensor data
- `devices/+/data` - Wildcard subscription for all devices

---

### 2. Device Status Monitor (`services/deviceStatusMonitor.js`)

Periodically checks device status based on lastSeen timestamps.

**Features:**
- ✅ Runs every 2 minutes (configurable)
- ✅ Queries all devices from MongoDB
- ✅ Checks lastSeen timestamp for each device
- ✅ Updates device status based on thresholds:
  - **Online**: lastSeen < 3 minutes
  - **Warning**: lastSeen between 3-5 minutes
  - **Offline**: lastSeen > 5 minutes
- ✅ Bulk updates devices for performance
- ✅ Logs all status changes
- ✅ Provides status summary (count by status)

---

## Setup & Usage

### 1. Install Dependencies

Ensure you have `mqtt` package installed:

```bash
cd BACKEND
npm install mqtt
```

### 2. Environment Variables

Add to your `.env` file:

```env
MONGODB_URI=mongodb://localhost:27017/iot-platform
MQTT_BROKER_URL=mqtt://test.mosquitto.org
```

### 3. Seed Sample Devices

```bash
node seedDevices.js
```

This creates 2 sample devices:
- DEVICE_123 (Sensor 1) - `devices/123/data`
- DEVICE_234 (Sensor 2) - `devices/234/data`

### 4. Start Backend Server

The services auto-start when the server starts:

```bash
node index.js
```

**Or** test services standalone:

```bash
node testIoTServices.js
```

---

## Testing MQTT Messages

### Using MQTT.fx or Mosquitto CLI

**Publish to Device 123:**
```bash
mosquitto_pub -h test.mosquitto.org -t "devices/123/data" -m '{"battery":85,"signal":90,"temperature":22.5}'
```

**Publish to Device 234:**
```bash
mosquitto_pub -h test.mosquitto.org -t "devices/234/data" -m '{"battery":78,"signal":88,"temperature":24.0}'
```

### Using Node.js Test Script

Create a simple publisher:

```javascript
const mqtt = require('mqtt');
const client = mqtt.connect('mqtt://test.mosquitto.org');

client.on('connect', () => {
  setInterval(() => {
    const data = {
      battery: Math.floor(Math.random() * 100),
      signal: Math.floor(Math.random() * 100),
      temperature: (Math.random() * 10 + 20).toFixed(1)
    };
    
    client.publish('devices/123/data', JSON.stringify(data));
    console.log('Published:', data);
  }, 5000);
});
```

---

## Architecture

```
┌─────────────┐
│ IoT Device  │
└──────┬──────┘
       │ MQTT Publish
       │ devices/123/data
       ▼
┌─────────────────────┐
│  MQTT Broker        │
│ test.mosquitto.org  │
└──────┬──────────────┘
       │ Subscribe
       │ devices/+/data
       ▼
┌─────────────────────┐
│  MQTT Client        │
│  Service            │
└──────┬──────────────┘
       │
       ├─► Update Device (MongoDB)
       │   - Set sensors data
       │   - Status: online
       │   - Update lastSeen
       │
       └─► Store History (MongoDB)
           - DeviceHistory collection
           - TTL: 30 days

┌─────────────────────┐
│ Device Status       │
│ Monitor             │
│ (Every 2 min)       │
└──────┬──────────────┘
       │
       └─► Check lastSeen
           - < 3 min: online
           - 3-5 min: warning
           - > 5 min: offline
```

---

## API Integration

The services integrate with your Express API:

**Device Endpoints:**
- `GET /api/devices` - List all devices
- `GET /api/devices/:deviceId` - Get device details with 24h history
- `POST /api/devices/:deviceId/data` - Manual data ingestion

**Real-time:**
- Socket.IO events emitted on device updates
- Frontend receives live updates

---

## Monitoring & Logs

**MQTT Client Logs:**
```
[MQTT Client] ✅ Connected to MQTT broker
[MQTT Client] 📡 Subscribed to topic: devices/+/data
[MQTT Client] 📩 Received message from device 123: {...}
[MQTT Client] 💾 Updated device 123 in MongoDB
[MQTT Client] 📊 Stored history entry for device 123
```

**Status Monitor Logs:**
```
[Device Monitor] 🔍 Checking device status...
[Device Monitor] Found 2 device(s) to check
[Device Monitor] ⚠️ Sensor 1 (DEVICE_123): online → warning (Last seen: 245s ago)
[Device Monitor] 📝 Updated 1 device(s)
[Device Monitor] 📊 Summary: 1 online, 1 warning, 0 offline
```

---

## Troubleshooting

**MQTT Connection Issues:**
- Check broker URL in `.env`
- Test connectivity: `ping test.mosquitto.org`
- Try alternative brokers: `mqtt://broker.hivemq.com`

**MongoDB Issues:**
- Verify connection string
- Check MongoDB is running: `mongosh`
- Ensure Device model is imported

**Status Not Updating:**
- Check device lastSeen timestamp in MongoDB
- Verify thresholds (3min warning, 5min offline)
- Check monitor is running every 2 minutes

---

## Production Considerations

1. **MQTT Broker:**
   - Use private broker for production
   - Enable TLS/SSL: `mqtts://...`
   - Add authentication credentials

2. **Performance:**
   - Adjust check interval based on device count
   - Use indexes on lastSeen for faster queries
   - Consider sharding for large deployments

3. **Monitoring:**
   - Set up alerts for service failures
   - Track message processing latency
   - Monitor MongoDB write performance

4. **Security:**
   - Validate message payloads
   - Rate limit device messages
   - Implement device authentication

---

## Files

- `services/mqttClientService.js` - MQTT client implementation
- `services/deviceStatusMonitor.js` - Status monitor implementation
- `initIoTServices.js` - Service initializer
- `testIoTServices.js` - Standalone test script
- `seedDevices.js` - Database seeding script

---

## License

MIT
