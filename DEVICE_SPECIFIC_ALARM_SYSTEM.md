# Device-Specific Alarm System Documentation

## Overview
The alarm system now ensures that each alarm is tied to a **specific device** and only monitors that device's data. This prevents false alarms and cross-contamination between devices.

## Key Architecture Changes

### 1. Database-Backed Alarms (Not In-Memory)
**Before:** Alarms were stored only in frontend component state  
**After:** All alarms are persisted to MongoDB via the `Alarm` model

### 2. Device Association
Each alarm in the database has:
```javascript
{
  name: "Alarm Name",
  device_name: "Sensor_A",        // ← REQUIRED: Ties alarm to this device
  deviceId: "DEVICE_A",           // ← Alternate device identifier
  parameter: "DCV",
  severity: "critical",
  status: "Active",
  device_params: { ... }          // Thresholds for this device
}
```

### 3. Device-Specific Monitoring
When device data arrives (HTTP POST or MQTT):

```javascript
// ❌ OLD: Checked all devices against all alarms (wrong!)
async checkAlarmsForDevice(deviceData, deviceId, event) {
  const alarms = await Alarm.find({}); // Gets ALL alarms
  // ❌ Checks Device A data against Device B alarms!
}

// ✅ NEW: Checks only that device's alarms (correct!)
async checkAlarmsForDevice(deviceData, deviceId, event) {
  const device = await Device.findOne({ deviceId });
  const deviceName = device.deviceName;
  
  // Fetches ONLY alarms for this specific device
  const alarms = await Alarm.getDeviceAlarms(deviceName, 'Active');
  
  // Checks Device A data only against Device A alarms
  for (const alarm of alarms) {
    await this.checkAlarmCondition(alarm, device, deviceData, event);
  }
}
```

## Database Schema

### Alarm Model (`/models/Alarm.js`)
```javascript
{
  // Device Association (KEY FIELDS)
  device_name: String,   // Indexed - fast lookups by device
  deviceId: String,      // Indexed - alternate lookup

  // Alarm Configuration
  name: String,
  parameter: String,
  severity: ['critical', 'warning', 'info', 'ok', 'battery'],
  status: ['Active', 'Inactive'],

  // Thresholds
  device_params: {
    ref_1: Number,  // Reference Fail threshold
    ref_2: Number,  // Reference UP threshold
    ref_3: Number,  // Reference OV threshold
    dcv: Number,    // DC Voltage threshold
    dci: Number,    // DC Current threshold
    acv: Number     // AC Voltage threshold
  },

  // Notifications
  notification_config: {
    email_ids: [String],
    sms_numbers: [String]
  },

  // Tracking
  last_triggered: Date,
  trigger_count: Number,
  notification_sent: Boolean
}
```

### Database Indexes
```javascript
// Efficient device-specific queries
AlarmSchema.index({ device_name: 1, status: 1 });
AlarmSchema.index({ deviceId: 1, status: 1 });

// Static method for device lookup
Alarm.getDeviceAlarms(device_name, status)
```

## Data Flow: Device Data → Alarm Check → Email

### HTTP POST Flow
```
1. POST /api/devices/data
   └─> deviceController.postDeviceData(deviceData)
       └─> Extract EVENT status
       └─> alarmMonitoringService.checkAlarmsForDevice(
             deviceData, 
             deviceId, 
             event
           )
           └─> Device.findOne({ deviceId })
           └─> Alarm.getDeviceAlarms(deviceName, 'Active')
           └─> For each alarm: checkAlarmCondition()
               └─> If threshold exceeded: sendAlarmNotification()
                   └─> Email sent ONLY to this alarm's configured recipients
```

### MQTT Flow
```
1. MQTT message arrives on devices/{deviceId}/data
   └─> mqttService.saveTelemetryData()
       └─> Extract EVENT status
       └─> alarmMonitoringService.checkAlarmsForDevice(...)
           └─> Same as HTTP flow above
```

## Alarm Controller Methods

### Get all alarms (with optional device filter)
```javascript
GET /api/alarms?device_name=Sensor_A&status=Active
```

### Get alarms for specific device
```javascript
GET /api/alarms/device/Sensor_A
// Returns only alarms configured for Sensor_A
```

### Create alarm (tied to device)
```javascript
POST /api/alarms
{
  "name": "Sensor A - Low DCV",
  "device_name": "Sensor_A",    // ← Device this alarm monitors
  "parameter": "DCV",
  "severity": "critical",
  "status": "Active",
  "device_params": {
    "ref_1": 10,  // Threshold values for THIS device
    "ref_2": 50,
    "ref_3": 100
  },
  "notification_config": {
    "email_ids": ["admin@company.com"]
  }
}
```

### Delete alarms for a device
```javascript
DELETE /api/alarms/device/Sensor_A
// Removes ALL alarms for Sensor_A
```

## Alarm Monitoring Service

### Main Method: `checkAlarmsForDevice()`
```javascript
async checkAlarmsForDevice(deviceData, deviceId, event = 'NORMAL') {
  // 1. Get device info
  const device = await Device.findOne({ deviceId });
  
  // 2. Fetch ONLY alarms for THIS device from database
  const alarms = await Alarm.getDeviceAlarms(deviceName, 'Active');
  
  // 3. Check each alarm
  for (const alarm of alarms) {
    await this.checkAlarmCondition(alarm, device, deviceData, event);
  }
}
```

### Condition Checks
An alarm triggers if:

1. **EVENT Status is Abnormal**
   ```javascript
   if (event !== 'NORMAL') {
     // Trigger: Device reported abnormal status
   }
   ```

2. **DCV Below Ref 1 Threshold**
   ```javascript
   if (dcv < alarm.device_params.ref_1) {
     // Trigger: Reference Fail condition
   }
   ```

3. **DCI Above Ref 2 Threshold**
   ```javascript
   if (dci > alarm.device_params.ref_2) {
     // Trigger: Reference UP condition
   }
   ```

4. **ACV Above Ref 3 Threshold**
   ```javascript
   if (acv > alarm.device_params.ref_3) {
     // Trigger: Reference OV condition
   }
   ```

### Notification Flow
```javascript
sendAlarmNotification(alarm, device, deviceData, reason) {
  // 1. Check debounce (5-minute cooldown)
  if (recentlyTriggered) return;
  
  // 2. Get email addresses from alarm config
  const emails = alarm.notification_config.email_ids;
  
  // 3. Send email to EACH recipient
  for (const email of emails) {
    await emailService.sendEmail({
      to: email,
      subject: `🚨 ALARM: ${alarm.name} - ${device.deviceName}`,
      template: 'alarm',
      data: { alarm, device, deviceData, reason }
    });
  }
  
  // 4. Log trigger to database
  await alarm.recordTrigger();
}
```

## How to Verify Device-Specific Behavior

### Run Test
```bash
node test-device-specific-alarms.js
```

### Test Scenarios
1. **Create alarm for Device A** → Should NOT trigger on Device B data
2. **Create alarm for Device B** → Should NOT trigger on Device A data
3. **Send abnormal data to Device A** → Triggers Device A alarms only
4. **Send abnormal data to Device B** → Triggers Device B alarms only

### Check Database
```javascript
// See alarms for specific device
db.alarms.find({ device_name: "Sensor_A" })

// See all active alarms by device
db.alarms.find({ status: "Active" }).sort({ device_name: 1 })

// See triggers
db.alarms.find({ trigger_count: { $gt: 0 } })
```

## Frontend Integration

### AlarmAddModal.vue
1. User selects device from dropdown
2. Fetches device parameters via `/api/devices/params/:deviceName`
3. Shows parameters (Ref 1, 2, 3, DCV, DCI, ACV)
4. User sets threshold values
5. Creates alarm via `POST /api/alarms` with `device_name` field

### AlarmListing.vue
1. Fetches all alarms or filters by device
2. Displays alarms in table grouped by device
3. Each row shows which device it's monitoring
4. Can send notifications, edit, or delete per-alarm

## Email Notification

When alarm triggers, email includes:
```
Alarm Name: Sensor A - Low DCV
Device: Sensor_A
Trigger Reason: DCV (5) below Ref 1 threshold (10)
Severity: critical
Timestamp: 2024-01-15 14:30:45

Device Parameters:
- Ref 1: 10
- Ref 2: 50
- Ref 3: 100
- Current DCV: 5
- Current DCI: 30
- Current ACV: 50
```

## Important Notes

1. **Device-Specific Query**: `Alarm.getDeviceAlarms(deviceName, status)` is essential - it ensures only relevant alarms are checked

2. **Debounce Mechanism**: 5-minute cooldown prevents spam - same alarm won't email twice within 5 minutes

3. **Database Persistence**: Unlike previous in-memory storage, alarms survive application restarts

4. **Indexed Fields**: `device_name` is indexed for fast lookups - even with 10,000 alarms, device-specific queries are instant

5. **No Cross-Contamination**: Alarm for "Sensor A" has ZERO knowledge of "Sensor B" - they're isolated

## Troubleshooting

### Alarm Not Triggering
1. Check alarm status: `db.alarms.findOne({ name: "..." })` → status should be "Active"
2. Check device_name matches: `db.alarms.find({ device_name: "..." })`
3. Check thresholds: Are they configured correctly?
4. Check data: Is the device actually sending abnormal data?

### Email Not Sent
1. Check notification_config: `db.alarms.findOne({...}).notification_config.email_ids`
2. Check email service: Is EmailService configured?
3. Check logs: `alarmMonitoringService` logs all email attempts

### Wrong Device Triggered
1. Verify `device_name` in alarm matches actual device name
2. Check that alarmMonitoringService receives correct `deviceId`
3. Ensure Device model returns correct `deviceName` field

## Summary

✅ **Device-Specific**: Each alarm monitors exactly ONE device  
✅ **Database-Backed**: Alarms survive application restarts  
✅ **Indexed Queries**: Fast device-specific lookups  
✅ **Isolated**: No cross-contamination between devices  
✅ **Logged**: All triggers tracked in database  
✅ **Email Support**: Notifications sent to configured recipients  
