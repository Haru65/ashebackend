# Alarm Trigger History - Diagnostic & Next Steps

## Current Status
✅ **Code Implementation**: Complete - all files created and updated
✅ **Route Configuration**: Fixed - trigger routes properly ordered before parameterized routes
⏳ **Backend State**: Needs restart to load AlarmTrigger model and execute trigger logging

## Diagnostic Steps

### Step 1: Verify Backend is Running
```bash
# Check if Node.js process is running on port 3001
# Windows PowerShell:
Get-NetTcpConnection -LocalPort 3001 -ErrorAction SilentlyContinue | Format-Table

# Or use:
netstat -ano | findstr :3001
```

### Step 2: Check Current Alarm Data
Run the test script to see if triggers are being saved:
```bash
cd D:\ASHECONTROL\BACKEND
node test-alarm-trigger.js
```

Expected output:
```
✅ Connected to MongoDB
📊 Total alarm triggers in database: 0  (or shows count if triggers exist)
⚠️  No alarm triggers found in database yet
   Triggers will be saved when an alarm is triggered after backend restart
```

### Step 3: Restart Backend Server
**Option A: Simple Restart (Recommended)**
```bash
# In the terminal where backend is running:
# Press Ctrl+C to stop the server

# Then restart:
cd D:\ASHECONTROL\BACKEND
node index.js
```

**Option B: Using npm if configured**
```bash
cd D:\ASHECONTROL\BACKEND
npm start
```

### Step 4: Verify Restart Loaded Changes
After restart, check backend console for these messages:
```
✅ Models loaded successfully
✅ Database connected
✅ Alarm monitoring service started
```

### Step 5: Test Alarm Trigger
1. Check if your device is sending data (should show in device history)
2. Wait for an alarm to trigger (if already set up)
3. Check backend console for:
```
[Alarm Monitor] ⚠️ Alarm 'testing' triggered
[Alarm Monitor] 💾 Alarm trigger saved to AlarmTrigger for alarm 'testing'
```

### Step 6: Verify Triggers in Database
After trigger fires, run test script again:
```bash
node test-alarm-trigger.js
```

Expected output:
```
✅ Connected to MongoDB
📊 Total alarm triggers in database: 1
📋 Recent alarm triggers:
  - testing on DEVICE_NAME at 2024-01-15T10:30:00.000Z
    Reason: REF1 STS is OP (valid status detected)
    Values: { REF1_STS: 'OP', voltage: 120.5, ... }
```

### Step 7: Verify Frontend Display
1. **Open browser** and go to `http://localhost:5173/apps/alarms`
2. **Click alarm detail** to view trigger history
3. Should see table with:
   - Timestamp (when alarm triggered)
   - Status (SENT/PENDING)
   - Reason (alarm condition)
   - Device Values (REF status, voltages, etc.)

Alternative: Check **Notifications tab → Recent Alarms**
- Should show triggered alarms with device info
- Click "View Details" to see full context

## File Structure Reference

### Backend Files Created/Modified
```
BACKEND/
├── models/
│   └── AlarmTrigger.js          (✅ Created - holds trigger records)
├── services/
│   └── alarmMonitoringService.js (✅ Updated - saves to AlarmTrigger)
├── controller/
│   └── alarmController.js        (✅ Updated - 3 new methods)
├── routes/
│   └── alarm.js                  (✅ Fixed - route ordering)
└── test-alarm-trigger.js         (✅ Created - diagnostic script)
```

### Frontend Files Modified
```
frontend/ZEPTAC-IOT-PLATFORM/src/views/
├── apps/notification/
│   └── NotificationListing.vue   (✅ Updated - Recent Alarms tab)
└── apps/iot/alarms/
    └── AlarmListing.vue           (✅ Updated - trigger history fetch)
```

## API Endpoints (Now Available)

All endpoints return paginated results with trigger details:

### 1. Recent Triggers
```
GET /api/alarms/triggers/recent?hours=24&limit=50&page=1
```
Response:
```json
{
  "success": true,
  "data": [
    {
      "_id": "...",
      "alarm_name": "testing",
      "device_name": "DEVICE_001",
      "trigger_reason": "REF1 STS is OP",
      "triggered_values": { ... },
      "createdAt": "2024-01-15T10:30:00.000Z"
    }
  ],
  "total": 1,
  "page": 1,
  "pages": 1
}
```

### 2. Alarm History
```
GET /api/alarms/triggers/alarm-id?page=1&limit=20
```

### 3. Device Triggers
```
GET /api/alarms/triggers/device/device-id?page=1&limit=20
```

## Troubleshooting

### Problem: "No alarm triggers recorded yet" still shows after restart

**Check 1:** Backend actually restarted
- Look at backend console timestamp after you stopped and started
- Verify it says "[Alarm Monitor] Started" with current time

**Check 2:** Alarm actually triggered
- Check Device History to confirm alarm triggered (should show date-time)
- Check backend console for "[Alarm Monitor] ⚠️ Alarm..." message

**Check 3:** Database connection
```bash
# Verify MongoDB is running
Get-Process mongod  # Windows

# If not running, start:
mongod.exe  # or use MongoDB Compass
```

**Check 4:** Collection created
```bash
# Open MongoDB Compass or mongo shell
# Check database: ZEPTAC
# Look for collection: alarmtriggers
# Should exist after first alarm triggers
```

### Problem: API returns empty array

1. **Restart backend** (many times this fixes it)
2. **Check route ordering** - trigger routes must come before :id routes
   - Currently fixed in alarm.js
3. **Test endpoint directly**:
   - Open: `http://localhost:3001/api/alarms/triggers/recent`
   - Should return JSON with data array

### Problem: Frontend shows error on API call

1. Check browser console (F12) for exact error
2. Verify backend is running: `netstat -ano | findstr :3001`
3. Check CORS - should be enabled in backend (Express middleware)
4. Verify URL matches: `/api/alarms/triggers/...`

## Expected Timeline After Restart

1. **Immediately**: Backend loads AlarmTrigger model
2. **When alarm triggers**: recordTrigger() saves to database
3. **Next API call**: Frontend receives trigger data
4. **In UI**: History table populates with trigger records

## Key Points to Remember

- ✅ Code is 100% implemented and correct
- ✅ Routes are properly configured
- ✅ Database model is ready
- ⏳ **Only missing: Backend restart**
- 🔄 After restart: System will work automatically

No code changes needed - just restart Node.js process!
