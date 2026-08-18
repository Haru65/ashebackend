# Database Cleanup Script - Usage Guide

## Overview
The `cleanup-old-data.js` script safely removes redundant and old data from your MongoDB database while preserving important information:

✅ **PRESERVED:**
- All user accounts and user data
- All device configurations
- All alarm configurations
- All zone data
- Data from the last 7 days (configurable)

🗑️ **DELETED:**
- Telemetry records older than 7 days
- Device history records older than 7 days
- Alarm trigger logs older than 7 days
- Notification records older than 7 days

---

## Installation

The script uses only existing Node.js dependencies from your project:
- `mongoose` - MongoDB ODM
- `dotenv` - Environment configuration

No additional packages need to be installed.

---

## Usage

### 1. **Test Run (Dry Run) - RECOMMENDED FIRST STEP**

See how much data would be deleted without making any changes:

```bash
node cleanup-old-data.js --dry-run
```

**Output Example:**
```
======================================================================
🗑️  DATABASE CLEANUP SCRIPT
======================================================================
📅 Days to keep: 7
🔍 Mode: DRY RUN (no changes)
======================================================================

✅ Connected to MongoDB

📊 TELEMETRY DATA (telemetry_data)
  📍 Records older than 2026-03-20T15:32:00.000Z: 45,230
  [DRY RUN] Would delete 45,230 records

📱 DEVICE HISTORY (devicehistory)
  📍 Records older than 2026-03-20T15:32:00.000Z: 12,450
  [DRY RUN] Would delete 12,450 records

🚨 ALARM TRIGGERS (alarm_triggers)
  📍 Records older than 2026-03-20T15:32:00.000Z: 3,890
  [DRY RUN] Would delete 3,890 records

📧 NOTIFICATIONS (notifications)
  📍 Records older than 2026-03-20T15:32:00.000Z: 8,765
  [DRY RUN] Would delete 8,765 records

✅ PRESERVED DATA
  👥 Users: 15 (all preserved)
  📱 Devices: All preserved (configurations)
  🚨 Alarms: All preserved (configurations)
  📍 Zones: All preserved (configurations)

======================================================================
✅ DRY RUN COMPLETE - No data was deleted
======================================================================
```

### 2. **Actual Cleanup**

After reviewing the dry run results, execute the actual cleanup:

```bash
node cleanup-old-data.js
```

**Output Example:**
```
📊 TELEMETRY DATA (telemetry_data)
  📍 Records older than 2026-03-20T15:32:00.000Z: 45,230
  ✅ Deleted 45,230 telemetry records

📱 DEVICE HISTORY (devicehistory)
  📍 Records older than 2026-03-20T15:32:00.000Z: 12,450
  ✅ Deleted 12,450 device history records

🚨 ALARM TRIGGERS (alarm_triggers)
  📍 Records older than 2026-03-20T15:32:00.000Z: 3,890
  ✅ Deleted 3,890 alarm trigger records

📧 NOTIFICATIONS (notifications)
  📍 Records older than 2026-03-20T15:32:00.000Z: 8,765
  ✅ Deleted 8,765 notification records

✅ PRESERVED DATA
  👥 Users: 15 (all preserved)
  📱 Devices: All preserved (configurations)
  🚨 Alarms: All preserved (configurations)
  📍 Zones: All preserved (configurations)

======================================================================
✅ CLEANUP COMPLETE
======================================================================
```

### 3. **Custom Retention Period**

To keep data for a different number of days (e.g., 14 days instead of 7):

```bash
# Keep last 14 days (dry run)
node cleanup-old-data.js --dry-run --days 14

# Keep last 14 days (actual cleanup)
node cleanup-old-data.js --days 14

# Keep last 30 days
node cleanup-old-data.js --days 30
```

---

## Command Options

| Option | Description | Example |
|--------|-------------|---------|
| `--dry-run` | Show what would be deleted without making changes (RECOMMENDED) | `node cleanup-old-data.js --dry-run` |
| `--days N` | Number of days to keep data (default: 7) | `node cleanup-old-data.js --days 14` |
| Both | Combine options | `node cleanup-old-data.js --dry-run --days 14` |

---

## Data Collections Details

### 📊 telemetry_data
- **Timestamp Field:** `timestamp`
- **Contains:** Real-time device sensor readings, events, status
- **Impact:** Reduces database size significantly (usually largest collection)
- **Example Records Deleted:** Sensor readings from before 7 days ago

### 📱 devicehistory
- **Timestamp Field:** `timestamp`
- **Contains:** Time-series device telemetry history
- **Impact:** Moderate space savings
- **Example Records Deleted:** Historical device parameter values

### 🚨 alarm_triggers
- **Timestamp Field:** `createdAt`
- **Contains:** Log of all alarm activations with trigger details
- **Impact:** Keeps alarm history while removing old logs
- **Example Records Deleted:** Old alarm activation records

### 📧 notifications
- **Timestamp Field:** `created_at`
- **Contains:** System and alarm notifications to users
- **Impact:** Keeps recent notifications for reference
- **Example Records Deleted:** Old notification messages

---

## Safety Features

✅ **Dry Run Mode** - Review changes before executing
✅ **Non-Cascading** - Doesn't affect device/user/alarm configurations
✅ **Selective Deletion** - Only deletes based on timestamp, preserves critical data
✅ **Error Handling** - Reports errors without crashing
✅ **Logging** - Clear output showing what was deleted

---

## Pre-Cleanup Checklist

Before running the cleanup:

1. ✅ **Backup Your Database**
   ```bash
   # Using MongoDB tools
   mongodump --uri "mongodb://localhost:27017/ashecontrol" --out ./backup
   ```

2. ✅ **Review Dry Run Results**
   ```bash
   node cleanup-old-data.js --dry-run
   ```

3. ✅ **Verify Database Connection**
   - Ensure `.env` or `.env.example` has correct `MONGODB_URI`
   - Test connection: `node -e "require('./config/database').connectDB()"`

4. ✅ **Stop Non-Essential Services**
   - Consider stopping the application during cleanup for safety
   - Cleanup typically takes seconds to minutes depending on data volume

---

## Post-Cleanup Verification

After cleanup, verify your data:

```bash
# Check telemetry data count
node -e "const m = require('./models/telemetry'); m.countDocuments().then(c => console.log('Telemetry:', c))"

# Check user count (should not change)
node -e "const m = require('./models/user'); m.countDocuments().then(c => console.log('Users:', c))"
```

---

## Troubleshooting

### Script Won't Connect to Database
- **Check:** Is MongoDB running?
- **Check:** Is `MONGODB_URI` in `.env` file correct?
- **Check:** Are credentials valid?

### Permission Denied Error
- **Fix:** Ensure your MongoDB user has delete permissions
- **Check:** User role should include `deleteAnyDatabase` or collection-specific delete

### Out of Memory Error
- **Cause:** Too much data being deleted at once
- **Fix:** Run on off-peak hours or use smaller retention period
- **Alternative:** Delete collections manually in smaller batches

---

## Scheduling Automatic Cleanup

### Using Cron (Linux/Mac)

```bash
# Run cleanup every Sunday at 2 AM
0 2 * * 0 cd /path/to/ASHECONTROL/BACKEND && node cleanup-old-data.js

# Add to crontab
crontab -e
```

### Using PM2 (Recommended)

```bash
# Create PM2 cleanup task
pm2 start cleanup-old-data.js --name "db-cleanup" --cron "0 2 * * 0"

# Save PM2 configuration
pm2 save
```

### Using Windows Task Scheduler

1. Create batch file `cleanup.bat`:
   ```batch
   @echo off
   cd D:\ASHECONTROL\BACKEND
   node cleanup-old-data.js
   ```

2. Schedule in Task Scheduler
   - Trigger: Daily at 2 AM
   - Action: Run `cleanup.bat`

---

## Estimated Data Reduction

For a typical system collecting telemetry every minute from 20 devices:

| Time Period | Estimated Size | After 7-Day Retention |
|------------|----------------|----------------------|
| 30 days | ~150 MB | ~35 MB |
| 90 days | ~450 MB | ~35 MB |
| 1 year | ~1.8 GB | ~35 MB |

---

## Support & Questions

If you encounter issues:

1. Check the error message in the script output
2. Verify MongoDB connection: `mongo mongodb://localhost:27017/ashecontrol`
3. Review model definitions in `./models/`
4. Check MongoDB logs for permission issues

---

## Quick Reference

```bash
# Dry run (always safe, no changes)
node cleanup-old-data.js --dry-run

# Actual cleanup (7 days retention)
node cleanup-old-data.js

# Custom retention (14 days)
node cleanup-old-data.js --days 14

# Dry run with custom retention
node cleanup-old-data.js --dry-run --days 30
```

---

**Created:** 2026-03-27  
**Version:** 1.0  
**Compatibility:** Node.js 12+, MongoDB 3.6+
