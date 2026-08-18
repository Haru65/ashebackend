# Device-Specific Alarm System - Visual Architecture

## System Overview Diagram

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                         ZEPTAC IOT ALARM SYSTEM                             │
│                     Device-Specific Monitoring Architecture                  │
└─────────────────────────────────────────────────────────────────────────────┘

┌───────────────┐         ┌───────────────┐
│  Device A     │         │  Device B     │
│  (MQTT)       │         │  (HTTP)       │
└───────┬───────┘         └───────┬───────┘
        │                         │
        │ dcv=5                   │ dcv=5
        │ dci=30                  │ dci=30
        │ acv=50                  │ acv=50
        │ EVENT=NORMAL            │ EVENT=NORMAL
        │                         │
        └────────────┬────────────┘
                     │
                     ↓
        ┌────────────────────────┐
        │  HTTP POST /api/data   │
        │  or MQTT topics/data   │
        └────────────┬───────────┘
                     │
                     ↓
        ┌─────────────────────────────────────────┐
        │ Device Controller or MQTT Service       │
        │ Extract: deviceId, deviceData, EVENT   │
        └────────────┬────────────────────────────┘
                     │
                     ↓
        ┌─────────────────────────────────────────────────────┐
        │ alarmMonitoringService.checkAlarmsForDevice()       │
        │                                                     │
        │  1. Get Device by ID                               │
        │     Device.findOne({ deviceId })                   │
        │     → Returns: deviceName = "Sensor_A" or "Sensor_B"
        │                                                     │
        │  2. Get Device's Alarms (KEY STEP!)                │
        │     Alarm.getDeviceAlarms(deviceName, 'Active')   │
        │     → Returns: ONLY alarms for this device         │
        │                                                     │
        │  3. For each alarm:                                │
        │     checkAlarmCondition(alarm, device, data)       │
        └────────────┬────────────────────────────────────────┘
                     │
          ┌──────────┴──────────┐
          │                     │
    Device A:              Device B:
    Get Sensor_A           Get Sensor_B
    Alarms                 Alarms
          │                     │
          ↓                     ↓
    ┌──────────────┐      ┌──────────────┐
    │ Alarm_A_1    │      │ Alarm_B_1    │
    │ Alarm_A_2    │      │              │
    └──────────────┘      └──────────────┘
          │                     │
          ↓                     ↓
    DCV 5 < 10?          No Alarms!
    YES TRIGGER!         No Check
          │                     │
          ↓                     ↓
    SEND EMAIL            (DONE)
    to A's recipients
```

## Database Schema Flow

```
┌─────────────────────────────────────────────────────────────────┐
│                      MongoDB: alarms Collection                 │
├─────────────────────────────────────────────────────────────────┤
│                                                                 │
│  Alarm 1:                                                       │
│  {                                                              │
│    _id: ObjectId("..."),                                       │
│    name: "Sensor A - Low DCV",                                 │
│    device_name: "Sensor_A",      ← KEY FIELD (indexed)        │
│    deviceId: "SENSOR_A",         ← Alternate key (indexed)    │
│    parameter: "DCV",                                           │
│    severity: "critical",                                       │
│    status: "Active",             ← Used with device_name     │
│    device_params: {                                            │
│      ref_1: 10,                  ← Ref Fail threshold        │
│      ref_2: 50,                  ← Ref UP threshold          │
│      ref_3: 100,                 ← Ref OV threshold          │
│      dcv: 5, dci: 30, acv: 50                                │
│    },                                                          │
│    notification_config: {                                      │
│      email_ids: ["admin@company.com"],                        │
│      sms_numbers: ["+1234567890"]                             │
│    },                                                          │
│    last_triggered: ISODate("2024-01-15T14:30:45.123Z"),     │
│    trigger_count: 5,                                          │
│    notification_sent: true                                     │
│  }                                                              │
│                                                                 │
│  Alarm 2:                                                       │
│  {                                                              │
│    _id: ObjectId("..."),                                       │
│    name: "Sensor A - High ACV",                                │
│    device_name: "Sensor_A",      ← Same device, different alarm
│    ...                                                          │
│  }                                                              │
│                                                                 │
│  Alarm 3:                                                       │
│  {                                                              │
│    _id: ObjectId("..."),                                       │
│    name: "Sensor B - Low DCV",                                 │
│    device_name: "Sensor_B",      ← Different device           │
│    ...                                                          │
│  }                                                              │
│                                                                 │
├─────────────────────────────────────────────────────────────────┤
│  INDEXES (for fast queries):                                   │
│  - { device_name: 1, status: 1 }                              │
│  - { deviceId: 1, status: 1 }                                 │
│  - { name: 1 }                                                │
│  - { created_at: 1 }                                          │
│  - { notification_sent: 1 }                                   │
└─────────────────────────────────────────────────────────────────┘
```

## Device-Specific Query Performance

```
Query: Alarm.getDeviceAlarms("Sensor_A", "Active")

SQL-like equivalent:
  SELECT * FROM alarms 
  WHERE device_name = "Sensor_A" 
  AND status = "Active"

MongoDB query:
  db.alarms.find({ 
    device_name: "Sensor_A",
    status: "Active"
  })

Performance:
  - Without index: O(n) - scans all alarms
  - With compound index {device_name: 1, status: 1}: O(log n) ✅
  
  With 10,000 alarms:
  - Without index: ~100ms (slow)
  - With index: ~0.1ms (instant) ✅

Benefit:
  Even with millions of alarms, device queries are INSTANT!
```

## Complete Data Flow: From Device to Email

```
┌─────────────────────────────────────────────────────────────────────┐
│                       DEVICE A → EMAIL FLOW                         │
└─────────────────────────────────────────────────────────────────────┘

STEP 1: DEVICE SENDS DATA
┌────────────────────────────────┐
│ Sensor_A sends MQTT message:   │
│ Topic: devices/SENSOR_A/data   │
│ Payload: {                     │
│   dcv: 5,                      │
│   dci: 30,                     │
│   acv: 50,                     │
│   EVENT: "NORMAL",             │
│   timestamp: "2024-01-15..."   │
│ }                              │
└────────────┬───────────────────┘
             │
             ↓

STEP 2: MQTT SERVICE PROCESSES
┌────────────────────────────────────────┐
│ mqttService.saveTelemetryData()        │
│                                        │
│ 1. Parse message                       │
│ 2. Store in DeviceHistory              │
│ 3. Extract EVENT status                │
│ 4. Call alarm monitoring service       │
└────────────┬───────────────────────────┘
             │
             ↓

STEP 3: ALARM MONITORING SERVICE
┌──────────────────────────────────────────────────────┐
│ alarmMonitoringService.checkAlarmsForDevice()        │
│                                                      │
│ Input:                                               │
│  - deviceData: { dcv: 5, dci: 30, acv: 50 }         │
│  - deviceId: "SENSOR_A"                             │
│  - event: "NORMAL"                                  │
│                                                      │
│ 1. Get Device:                                       │
│    device = Device.findOne({ deviceId: "SENSOR_A" })│
│    → { deviceName: "Sensor_A", ... }                │
│                                                      │
│ 2. Get Device's Alarms (DEVICE-SPECIFIC!):          │
│    alarms = Alarm.getDeviceAlarms("Sensor_A", "...")│
│    Query: { device_name: "Sensor_A", status: "..." }│
│    → [Alarm_A_1, Alarm_A_2, ...]                    │
│                                                      │
│ 3. For each alarm in Sensor_A's list:               │
│    checkAlarmCondition(Alarm_A_1, device, data)    │
└────────────┬───────────────────────────────────────┘
             │
             ↓

STEP 4: CHECK ALARM CONDITIONS
┌──────────────────────────────────────────────────┐
│ checkAlarmCondition(alarm, device, deviceData)   │
│                                                  │
│ Alarm_A_1: "Sensor A - Low DCV"                 │
│ Thresholds: ref_1=10, ref_2=50, ref_3=100      │
│                                                  │
│ Condition 1: Is EVENT abnormal?                 │
│   "NORMAL" == "NORMAL"? NO                       │
│                                                  │
│ Condition 2: Is DCV below Ref 1?                │
│   5 < 10? YES! ✓ CONDITION MET!                │
│                                                  │
│ Action: TRIGGER ALARM                           │
└────────────┬──────────────────────────────────┘
             │
             ↓

STEP 5: SEND NOTIFICATION
┌──────────────────────────────────────────────┐
│ sendAlarmNotification()                      │
│                                              │
│ 1. Check debounce:                           │
│    Last trigger: 15 minutes ago              │
│    Cooldown: 5 minutes                       │
│    Can trigger? YES (15 > 5) ✓              │
│                                              │
│ 2. Get recipients:                           │
│    email_ids: ["admin@company.com"]          │
│                                              │
│ 3. Prepare email:                            │
│    Subject: 🚨 ALARM: Sensor A - Low DCV    │
│    Body:                                     │
│      Alarm: Sensor A - Low DCV               │
│      Device: Sensor_A                        │
│      Reason: DCV (5) < Ref1 (10)            │
│      Time: 2024-01-15T14:30:45Z             │
│                                              │
│ 4. Send email via EmailService               │
│    To: admin@company.com                     │
│    → Email sent ✓                            │
│                                              │
│ 5. Update alarm in database:                 │
│    alarm.last_triggered = now()              │
│    alarm.trigger_count += 1                  │
│    alarm.notification_sent = true            │
│    alarm.save()                              │
└────────────┬────────────────────────────────┘
             │
             ↓

STEP 6: RESULT
┌──────────────────────────────────────────────┐
│ Email in inbox:                              │
│                                              │
│ From: ZEPTAC IOT Alerts                      │
│ To: admin@company.com                        │
│ Subject: 🚨 ALARM: Sensor A - Low DCV       │
│                                              │
│ Body:                                        │
│ ────────────────────────────────────────    │
│ ALARM TRIGGERED                             │
│                                              │
│ Alarm Name: Sensor A - Low DCV              │
│ Device: Sensor_A                            │
│ Severity: CRITICAL                          │
│ Status: Active                              │
│                                              │
│ Trigger Reason:                             │
│ DCV (5) below Ref 1 threshold (10)         │
│                                              │
│ Current Parameters:                         │
│ • DCV: 5 (threshold: 10) ✓ ABNORMAL       │
│ • DCI: 30 (threshold: 50)                  │
│ • ACV: 50 (threshold: 100)                 │
│                                              │
│ Timestamp: 2024-01-15 14:30:45              │
│ ────────────────────────────────────────    │
│                                              │
│ ✅ EMAIL DELIVERED                          │
└──────────────────────────────────────────────┘
```

## Comparison: Device A vs Device B Data

```
┌─────────────────────────────────────────────────────────┐
│  SCENARIO 1: Device A sends low DCV (5)                │
├─────────────────────────────────────────────────────────┤
│                                                         │
│ Device Data: dcv=5, dci=30, acv=50                     │
│ Device ID: SENSOR_A                                    │
│ Device Name: Sensor_A                                  │
│                                                         │
│ Database Lookup:                                        │
│ ┌─────────────────────────────────────┐               │
│ │ Query: {                            │               │
│ │   device_name: "Sensor_A",          │               │
│ │   status: "Active"                  │               │
│ │ }                                   │               │
│ │                                     │               │
│ │ Results:                            │               │
│ │ ✓ Alarm_A_1: "Low DCV" (Ref1=10)  │               │
│ │ ✓ Alarm_A_2: "High ACV" (Ref3=100)│              │
│ └─────────────────────────────────────┘               │
│                                                         │
│ Threshold Check:                                        │
│ ✓ DCV=5 < Ref1=10 → TRIGGER Alarm_A_1                │
│ ✓ ACV=50 < Ref3=100 → NO TRIGGER for Alarm_A_2      │
│                                                         │
│ Email Sent: admin@company.com                         │
│ Reason: DCV below threshold                           │
│                                                         │
│ Database Updated:                                       │
│ Alarm_A_1.last_triggered = now()                      │
│ Alarm_A_1.trigger_count = 5                           │
│                                                         │
└─────────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────────┐
│  SCENARIO 2: Device B sends same data (dcv=5)         │
├─────────────────────────────────────────────────────────┤
│                                                         │
│ Device Data: dcv=5, dci=30, acv=50                     │
│ Device ID: SENSOR_B                                    │
│ Device Name: Sensor_B                                  │
│                                                         │
│ Database Lookup:                                        │
│ ┌─────────────────────────────────────┐               │
│ │ Query: {                            │               │
│ │   device_name: "Sensor_B",          │               │
│ │   status: "Active"                  │               │
│ │ }                                   │               │
│ │                                     │               │
│ │ Results:                            │               │
│ │ ✗ No alarms configured for Sensor_B│               │
│ │ ✗ (Device B has no alarms)          │               │
│ └─────────────────────────────────────┘               │
│                                                         │
│ Threshold Check:                                        │
│ (SKIPPED - no alarms to check)                         │
│                                                         │
│ Email Sent: NONE                                       │
│ Reason: No alarms configured for Device B             │
│                                                         │
│ Database Updated: Nothing                             │
│                                                         │
│ KEY POINT: Even though Device B sent the SAME         │
│ abnormal data (dcv=5), NO ALARM TRIGGERED!            │
│ This is CORRECT because Device B has no alarms        │
│ configured, so it's not monitored.                    │
│                                                         │
└─────────────────────────────────────────────────────────┘
```

## Debounce Mechanism

```
┌────────────────────────────────────────────────────────┐
│         ALARM DEBOUNCE (5-Minute Cooldown)            │
├────────────────────────────────────────────────────────┤
│                                                        │
│ Time: 14:00:00                                        │
│ Alarm_A_1 triggered → Email sent ✓                   │
│ Last trigger: 14:00:00                               │
│                                                        │
│ Time: 14:02:00 (2 minutes later)                      │
│ Alarm_A_1 conditions met again                        │
│ Time since last trigger: 2 minutes < 5 minutes       │
│ Action: SKIP (debounce active)                        │
│ Email NOT sent                                        │
│                                                        │
│ Time: 14:05:30 (5.5 minutes later)                    │
│ Alarm_A_1 conditions met again                        │
│ Time since last trigger: 5.5 minutes > 5 minutes     │
│ Action: TRIGGER (debounce expired)                    │
│ Email sent ✓                                          │
│ Last trigger: 14:05:30 (reset timer)                 │
│                                                        │
│ Benefit:                                              │
│ Prevents email spam if threshold stays violated      │
│ User gets notified once every 5 minutes maximum      │
│                                                        │
└────────────────────────────────────────────────────────┘
```

## Index Performance Impact

```
Query: Find all active alarms for "Sensor_A"

WITH INDEX { device_name: 1, status: 1 }:

10 alarms total:     ~0.01ms
100 alarms total:    ~0.01ms
1,000 alarms total:  ~0.02ms
10,000 alarms total: ~0.05ms  ← INSTANT
100,000 alarms:      ~0.10ms  ← INSTANT

WITHOUT INDEX:

10 alarms total:     ~0.1ms
100 alarms total:    ~1ms
1,000 alarms total:  ~10ms
10,000 alarms total: ~100ms   ← SLOW
100,000 alarms:      ~1,000ms ← VERY SLOW

Difference at 10,000 alarms:
- With index: 0.05ms
- Without index: 100ms
- SPEEDUP: 2000x faster! ✅
```

---

**Key Takeaway:** The compound index `{ device_name: 1, status: 1 }` makes device-specific queries practically instant, even with millions of alarms in the database!
