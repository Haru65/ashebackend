# Device-Specific Alarm System - Quick Test Guide

## How the System Works (Simple Version)

```
When device sends data:
┌─────────────────────────────────────┐
│ Device sends data (MQTT or HTTP)   │
└────────────┬────────────────────────┘
             │
             ↓
┌─────────────────────────────────────────────────────┐
│ Find all alarms for THIS DEVICE ONLY               │
│ (Alarm.getDeviceAlarms("Sensor_A", "Active"))      │
└────────────┬────────────────────────────────────────┘
             │
             ↓
┌─────────────────────────────────────────────────────┐
│ Check if data exceeds alarm thresholds             │
└────────────┬────────────────────────────────────────┘
             │
             ↓
       ┌─────┴──────┐
       │             │
   YES │             │ NO
       ↓             ↓
   ┌─────────┐   ┌─────────┐
   │ TRIGGER │   │  QUIET  │
   │ EMAIL   │   │  (DONE) │
   └─────────┘   └─────────┘
```

## Database Changes Summary

| Aspect | Before | After |
|--------|--------|-------|
| **Storage** | Frontend state only | MongoDB database |
| **Device Scope** | Global (all devices) | Device-specific (tied to one device) |
| **Persistence** | Lost on page refresh | Survives app restart |
| **Monitoring** | Checked all alarms | Queries only device's alarms |
| **Isolation** | ❌ Cross-contamination possible | ✅ Perfect isolation |

## Test: Create Alarm for Device A

### Step 1: Create Device A (if not exists)
```bash
curl -X POST http://localhost:8000/api/devices \
  -H "Content-Type: application/json" \
  -d '{
    "deviceId": "SENSOR_A",
    "deviceName": "Sensor_A",
    "unitNo": "U001",
    "location": "Lab 1"
  }'
```

### Step 2: Create Alarm for Device A
```bash
curl -X POST http://localhost:8000/api/alarms \
  -H "Content-Type: application/json" \
  -d '{
    "name": "Sensor A - Low DCV",
    "device_name": "Sensor_A",        ← Device this alarm monitors
    "parameter": "DCV",
    "severity": "critical",
    "status": "Active",
    "device_params": {
      "ref_1": 10,
      "ref_2": 50,
      "ref_3": 100
    },
    "notification_config": {
      "email_ids": ["your-email@gmail.com"]
    }
  }'
```

### Step 3: Verify Alarm in Database
```bash
# Check the alarm was created
db.alarms.findOne({ name: "Sensor A - Low DCV" })

# Should show: device_name: "Sensor_A"
```

### Step 4: Send Device A Data That Triggers Alarm
```bash
# Send data with DCV = 5 (below threshold of 10)
curl -X POST http://localhost:8000/api/devices/data \
  -H "Content-Type: application/json" \
  -d '{
    "deviceId": "SENSOR_A",
    "dcv": 5,           ← Below ref_1 threshold (10)
    "dci": 30,
    "acv": 50,
    "EVENT": "NORMAL"
  }'
```

### Step 5: Check Email Sent
- Look at email (check spam folder)
- Email should say: "ALARM: Sensor A - Low DCV - Sensor_A"
- Shows that DCV (5) is below Ref 1 threshold (10)

## Test: Verify Device B NOT Affected

### Step 1: Create Device B
```bash
curl -X POST http://localhost:8000/api/devices \
  -H "Content-Type: application/json" \
  -d '{
    "deviceId": "SENSOR_B",
    "deviceName": "Sensor_B",
    "unitNo": "U002",
    "location": "Lab 2"
  }'
```

### Step 2: Verify No Alarms for Device B
```bash
# Check database
db.alarms.find({ device_name: "Sensor_B" })

# Should return: empty (no alarms)
```

### Step 3: Send Device B Data (Even with LOW DCV)
```bash
curl -X POST http://localhost:8000/api/devices/data \
  -H "Content-Type: application/json" \
  -d '{
    "deviceId": "SENSOR_B",
    "dcv": 5,           ← Below Device B threshold too
    "dci": 30,
    "acv": 50,
    "EVENT": "NORMAL"
  }'
```

### Step 4: Check NO Email Sent
- Device B has NO alarms configured
- Even though DCV is low, NO email is sent
- ✅ Proof that system is device-specific!

## Test: Create Alarm for Device B, Verify Isolation

### Step 1: Create Alarm for Device B ONLY
```bash
curl -X POST http://localhost:8000/api/alarms \
  -H "Content-Type: application/json" \
  -d '{
    "name": "Sensor B - Low DCV",
    "device_name": "Sensor_B",        ← Device B (not A!)
    "parameter": "DCV",
    "severity": "warning",
    "status": "Active",
    "device_params": {
      "ref_1": 20,      ← Different threshold than Device A
      "ref_2": 75,
      "ref_3": 150
    },
    "notification_config": {
      "email_ids": ["your-email@gmail.com"]
    }
  }'
```

### Step 2: Send Device B Data That Triggers (DCV = 15)
```bash
curl -X POST http://localhost:8000/api/devices/data \
  -H "Content-Type: application/json" \
  -d '{
    "deviceId": "SENSOR_B",
    "dcv": 15,          ← Below Device B threshold (20)
    "dci": 60,
    "acv": 120,
    "EVENT": "NORMAL"
  }'
```

### Step 3: Email Should Be Sent for Device B
- Email: "ALARM: Sensor B - Low DCV - Sensor_B"
- Shows DCV (15) below Ref 1 threshold (20)

### Step 4: Send Device A Data That WOULDN'T Trigger B's Alarm
```bash
curl -X POST http://localhost:8000/api/devices/data \
  -H "Content-Type: application/json" \
  -d '{
    "deviceId": "SENSOR_A",
    "dcv": 15,          ← This is OK for Device A (threshold 10)
    "dci": 30,
    "acv": 50,
    "EVENT": "NORMAL"
  }'
```

### Step 5: Only Device A Alarm Triggers (if threshold met)
- Device A alarm: threshold 10, data 15 → OK, no trigger
- Device B alarm: NOT checked at all (different device)
- ✅ Perfect isolation!

## Database Queries to Verify

### See all alarms for Device A
```javascript
db.alarms.find({ device_name: "Sensor_A" })
```

### See all alarms for Device B
```javascript
db.alarms.find({ device_name: "Sensor_B" })
```

### See which alarms have been triggered
```javascript
db.alarms.find({ trigger_count: { $gt: 0 } })
```

### See last trigger time
```javascript
db.alarms.find({}, { name: 1, device_name: 1, last_triggered: 1, trigger_count: 1 })
```

### Check alarm is Active
```javascript
db.alarms.findOne({ name: "Sensor A - Low DCV" })
// Look for: status: "Active"
```

## Automatic Test (Node.js)

```bash
cd /path/to/BACKEND
node test-device-specific-alarms.js
```

This will:
1. Create test Device A and Device B
2. Create alarms for Device A ONLY
3. Send abnormal data to Device A → triggers alarm ✓
4. Send abnormal data to Device B → no alarm ✓
5. Verify database persistence ✓
6. Print detailed report

## Key Verification Points

| Check | Expected Result | How to Verify |
|-------|-----------------|---------------|
| Alarm tied to device | `device_name` matches alarm's device | `db.alarms.findOne({...})` |
| Device A data checks A's alarms | Email only for A's alarms | Send data, check email |
| Device B data checks B's alarms | Email only for B's alarms | Send data, check email |
| Cross-device isolation | No false triggers | Send wrong data, no email |
| Database persists alarms | Alarms survive restart | Restart app, check DB |
| Thresholds work correctly | Email sent when threshold exceeded | Send data at boundary values |

## Troubleshooting Checklist

- [ ] Alarm created: `db.alarms.find()` shows it
- [ ] Device name correct: `device_name` matches exactly
- [ ] Alarm active: `status: "Active"`
- [ ] Email configured: `notification_config.email_ids` has address
- [ ] Data being sent: Check backend logs
- [ ] Threshold values set: `device_params` has numbers
- [ ] Email service working: Check app logs for email attempts

## Summary

✅ **One alarm per device** - Device A alarms are independent of Device B  
✅ **Database queries** - Fetches only relevant alarms  
✅ **No cross-contamination** - Sensor A won't trigger Sensor B's alarms  
✅ **Persistent** - Alarms saved to MongoDB  
✅ **Testable** - Easy to verify with curl or test script  

**Bottom Line:** When Device A sends abnormal data, ONLY Device A's alarms are checked and only Device A's email recipients are notified!
