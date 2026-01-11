# Alarm Trigger Details System Documentation

## Overview
The alarm trigger details system captures comprehensive information every time an alarm is triggered and stores it in a dedicated database collection. This allows users to view detailed information about past alarm activations through the UI.

## Components

### 1. AlarmTrigger Model (`BACKEND/models/AlarmTrigger.js`)
Stores detailed information about each alarm trigger event.

**Key Fields:**
- `alarm_id` - Reference to the Alarm
- `alarm_name` - Name of the alarm (for quick reference)
- `device_id` - Device identifier
- `device_name` - Device name
- `trigger_reason` - Why the alarm was triggered
  - Example: `"REF2 STS is 'OP' (valid status detected)"`
  - Example: `"DCV (10) out of bounds [0, 9]"`
- `triggered_values` - All sensor values at the moment of trigger
  - REF1, REF2, REF3, REF1 STS, REF2 STS, REF3 STS
  - DCV, DCI, ACV, EVENT status
- `alarm_config` - Alarm configuration at trigger time
  - severity, parameter, device_params
- `triggered_at` - Timestamp of trigger
- `notification_status` - SENT, FAILED, PENDING, SKIPPED

**Static Methods:**
```javascript
// Record a trigger
await AlarmTrigger.recordTrigger({
  alarm_id: ObjectId,
  alarm_name: string,
  device_id: string,
  device_name: string,
  trigger_reason: string,
  triggered_values: object,
  alarm_config: object,
  event_status: string,
  notification_status: string
});

// Get alarm history
const triggers = await AlarmTrigger.getAlarmHistory(alarmId, limit);

// Get device alarm history
const triggers = await AlarmTrigger.getDeviceAlarmHistory(deviceId, limit);

// Get recent triggers
const triggers = await AlarmTrigger.getRecentTriggers(since);
```

### 2. Updated AlarmMonitoringService
The alarm monitoring service has been updated to save trigger details to both:
1. **DeviceHistory** - For backward compatibility
2. **AlarmTrigger** - New dedicated collection for detailed trigger info

When an alarm is triggered:
1. All relevant sensor values are captured
2. Alarm configuration is saved
3. Trigger reason is recorded
4. Full trigger record is saved to database

### 3. API Endpoints

#### Get Recent Alarm Triggers
```
GET /api/alarms/triggers/recent?hours=24&limit=50
```

**Response:**
```json
{
  "success": true,
  "data": [
    {
      "_id": "...",
      "alarm_id": "...",
      "alarm_name": "High Voltage Alert",
      "device_id": "123",
      "device_name": "Sensor 1 - AAAA-BBBB-CCCC",
      "trigger_reason": "REF2 STS is 'OP' (valid status detected)",
      "triggered_values": {
        "REF1 STS": "",
        "REF2 STS": "OP",
        "REF3 STS": "",
        "DCV": "5.5",
        "DCI": "2.1",
        "ACV": "1441.9",
        "EVENT": "NORMAL"
      },
      "triggered_at": "2026-01-11T10:30:00Z",
      "notification_status": "SENT"
    }
  ],
  "total": 5,
  "timeRange": "Last 24 hours"
}
```

#### Get Alarm Trigger History
```
GET /api/alarms/triggers/:alarmId?page=1&limit=50
```

Returns all times a specific alarm has been triggered.

#### Get Device Alarm Triggers
```
GET /api/alarms/triggers/device/:deviceId?page=1&limit=50
```

Returns all alarm triggers for a specific device.

### 4. Frontend Integration - View Alarm Details

Example component usage in Vue/React:

```javascript
// Fetch recent triggers
async function loadRecentAlarms() {
  const response = await fetch('/api/alarms/triggers/recent?hours=24');
  const result = await response.json();
  return result.data;
}

// Fetch specific alarm trigger history
async function loadAlarmTriggers(alarmId) {
  const response = await fetch(`/api/alarms/triggers/${alarmId}`);
  const result = await response.json();
  return result.data;
}

// Fetch device alarm history
async function loadDeviceAlarmTriggers(deviceId) {
  const response = await fetch(`/api/alarms/triggers/device/${deviceId}`);
  const result = await response.json();
  return result.data;
}
```

### 5. Data Captured in Trigger

When an alarm is triggered, the following data is saved:

```javascript
{
  // Reference fields
  alarm_id: ObjectId,
  alarm_name: "testing",
  device_id: "123",
  device_name: "Sensor 1 - AAAA-BBBB-CCCC",
  
  // Trigger information
  trigger_reason: "REF2 STS is 'OP' (valid status detected)",
  triggered_at: Date,
  
  // All sensor values at moment of trigger
  triggered_values: {
    'REF1 STS': 'OP' | 'UP' | 'FAIL' | '',
    'REF2 STS': 'OP' | 'UP' | 'FAIL' | '',
    'REF3 STS': 'OP' | 'UP' | 'FAIL' | '',
    'REF1': numeric string,
    'REF2': numeric string,
    'REF3': numeric string,
    'DCV': numeric,
    'DCI': numeric,
    'ACV': numeric,
    'EVENT': 'NORMAL' | other event codes
  },
  
  // Alarm configuration at time of trigger
  alarm_config: {
    severity: 'critical' | 'warning' | 'info',
    parameter: string,
    device_params: {
      ref_1_upper: number,
      ref_1_lower: number,
      ref_2_upper: number,
      ref_2_lower: number,
      ref_3_upper: number,
      ref_3_lower: number,
      dcv_upper: number,
      dcv_lower: number,
      dci_upper: number,
      dci_lower: number,
      acv_upper: number,
      acv_lower: number
    }
  },
  
  // Notification status
  notification_status: 'SENT' | 'FAILED' | 'PENDING' | 'SKIPPED'
}
```

## REF Status Alarm Triggering

### How It Works

1. **REF Status Values** (Check 0 - First Priority)
   - Monitors: `REF1 STS`, `REF2 STS`, `REF3 STS`
   - Valid status values: `OP`, `UP`, `FAIL`
   - If ANY of these contain a valid status → **ALARM TRIGGERS**

2. **Example Trigger Scenarios:**

   **Scenario A: REF2 is Operating**
   ```
   Device sends: REF2 STS = "OP"
   Result: ✅ ALARM TRIGGERED
   Reason: "REF2 STS is 'OP' (valid status detected)"
   ```

   **Scenario B: REF Status with Invalid Value**
   ```
   Device sends: REF1 STS = "INVALID"
   Result: ❌ NO ALARM (invalid status)
   ```

   **Scenario C: REF Status Empty**
   ```
   Device sends: REF1 STS = ""
   Result: ❌ NO ALARM (empty string)
   ```

## Alarm Throttling

- **Interval**: 1 hour (60 * 60 * 1000 ms)
- When an alarm triggers, subsequent triggers for the **same alarm** within 1 hour are **not notified**
- This prevents alert fatigue while still recording all triggers
- The trigger is recorded in the database regardless of notification status

## Example: Viewing Alarm Details in Popup

### In the Frontend Component:

```vue
<template>
  <div>
    <!-- Alarm Triggers List -->
    <div class="alarm-triggers">
      <table>
        <thead>
          <tr>
            <th>Time</th>
            <th>Alarm</th>
            <th>Device</th>
            <th>Reason</th>
            <th>Action</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="trigger in triggers" :key="trigger._id">
            <td>{{ formatDate(trigger.triggered_at) }}</td>
            <td>{{ trigger.alarm_name }}</td>
            <td>{{ trigger.device_name }}</td>
            <td>{{ trigger.trigger_reason }}</td>
            <td>
              <button @click="openDetail(trigger)">View Details</button>
            </td>
          </tr>
        </tbody>
      </table>
    </div>

    <!-- Detail Popup Modal -->
    <div v-if="selectedTrigger" class="modal">
      <div class="modal-content">
        <h2>Alarm Trigger Details</h2>
        
        <section class="details-section">
          <h3>Alarm Information</h3>
          <p><strong>Name:</strong> {{ selectedTrigger.alarm_name }}</p>
          <p><strong>Severity:</strong> {{ selectedTrigger.alarm_config.severity }}</p>
          <p><strong>Device:</strong> {{ selectedTrigger.device_name }}</p>
          <p><strong>Time:</strong> {{ formatDate(selectedTrigger.triggered_at) }}</p>
        </section>

        <section class="details-section">
          <h3>Trigger Reason</h3>
          <p>{{ selectedTrigger.trigger_reason }}</p>
        </section>

        <section class="details-section">
          <h3>Sensor Values at Trigger</h3>
          <table>
            <tr>
              <td>REF1 Status:</td>
              <td>{{ selectedTrigger.triggered_values['REF1 STS'] || '-' }}</td>
            </tr>
            <tr>
              <td>REF2 Status:</td>
              <td>{{ selectedTrigger.triggered_values['REF2 STS'] || '-' }}</td>
            </tr>
            <tr>
              <td>REF3 Status:</td>
              <td>{{ selectedTrigger.triggered_values['REF3 STS'] || '-' }}</td>
            </tr>
            <tr>
              <td>DCV:</td>
              <td>{{ selectedTrigger.triggered_values.DCV }}</td>
            </tr>
            <tr>
              <td>DCI:</td>
              <td>{{ selectedTrigger.triggered_values.DCI }}</td>
            </tr>
            <tr>
              <td>ACV:</td>
              <td>{{ selectedTrigger.triggered_values.ACV }}</td>
            </tr>
            <tr>
              <td>EVENT:</td>
              <td>{{ selectedTrigger.triggered_values.EVENT }}</td>
            </tr>
          </table>
        </section>

        <section class="details-section">
          <h3>Alarm Thresholds</h3>
          <table>
            <tr v-for="(key, param) in selectedTrigger.alarm_config.device_params">
              <td>{{ param }}:</td>
              <td>{{ key }}</td>
            </tr>
          </table>
        </section>

        <button @click="selectedTrigger = null">Close</button>
      </div>
    </div>
  </div>
</template>

<script>
export default {
  data() {
    return {
      triggers: [],
      selectedTrigger: null
    };
  },
  
  async mounted() {
    await this.loadRecentTriggers();
  },
  
  methods: {
    async loadRecentTriggers() {
      const response = await fetch('/api/alarms/triggers/recent?hours=24');
      const result = await response.json();
      this.triggers = result.data;
    },
    
    openDetail(trigger) {
      this.selectedTrigger = trigger;
    },
    
    formatDate(date) {
      return new Date(date).toLocaleString();
    }
  }
};
</script>
```

## Database Collections

### AlarmTrigger Collection

```
db.alarmtriggers
├─ alarm_id (indexed)
├─ alarm_name
├─ device_id (indexed)
├─ device_name (indexed)
├─ trigger_reason
├─ triggered_values (flexible object)
├─ alarm_config (nested object)
├─ event_status
├─ triggered_at (indexed, TTL: 90 days)
└─ notification_status
```

## Summary

The alarm trigger details system provides:

✅ **Complete audit trail** of all alarm activations  
✅ **Detailed sensor values** captured at moment of trigger  
✅ **Flexible querying** by alarm, device, or time range  
✅ **Easy debugging** - see exactly why alarm triggered  
✅ **Historical record** - retained for 90 days  
✅ **UI popup support** - display trigger details in modal/popup  

This enables users to investigate and understand alarm events with full context.
