# Database Cleanup - Quick Reference

## TL;DR

```bash
# See what will be deleted (SAFE - no changes)
node cleanup-old-data.js --dry-run

# Actually delete old data (keeps last 7 days + all users)
node cleanup-old-data.js

# Keep last 14 days instead of 7
node cleanup-old-data.js --days 14
```

---

## What Gets Deleted

| Collection | Keep | Delete |
|-----------|------|--------|
| **telemetry_data** | Last 7 days | Older sensor readings |
| **devicehistory** | Last 7 days | Older device history |
| **alarm_triggers** | Last 7 days | Old alarm logs |
| **notifications** | Last 7 days | Old notifications |
| **users** | ✅ ALL | Nothing |
| **devices** | ✅ ALL | Nothing |
| **alarms** | ✅ ALL | Nothing |
| **zones** | ✅ ALL | Nothing |

---

## Common Commands

```bash
# Test first (ALWAYS do this!)
node cleanup-old-data.js --dry-run

# Run cleanup with 7 days retention
node cleanup-old-data.js

# Run cleanup with 14 days retention
node cleanup-old-data.js --days 14

# Run cleanup with 30 days retention
node cleanup-old-data.js --days 30

# Test with 14 days retention
node cleanup-old-data.js --dry-run --days 14
```

---

## Typical Space Savings

| Scenario | Before | After | Saved |
|----------|--------|-------|-------|
| 1 month data | 150 MB | 35 MB | 115 MB (77%) |
| 3 months data | 450 MB | 35 MB | 415 MB (92%) |
| 1 year data | 1.8 GB | 35 MB | 1.76 GB (98%) |

---

## Step-by-Step Guide

### Step 1: Backup (Optional but Recommended)
```bash
# Create database backup
mongodump --uri "mongodb://localhost:27017/ashecontrol" --out ./backup
```

### Step 2: Test the Script
```bash
node cleanup-old-data.js --dry-run
```

Review the output to see how much data will be deleted.

### Step 3: Run Cleanup
```bash
node cleanup-old-data.js
```

### Step 4: Verify
Check that database still works and users can log in.

---

## Troubleshooting

| Problem | Solution |
|---------|----------|
| "MongoDB connection failed" | Check if MongoDB is running and `.env` has correct URI |
| "Permission denied" | Ensure MongoDB user has delete permissions |
| "Out of memory" | Run on off-peak hours; try smaller custom days |
| Nothing happens | Check that you're in `/BACKEND` folder |

---

## For Developers

### How to Add to CI/CD

**GitHub Actions:**
```yaml
- name: Cleanup old database data
  run: |
    cd BACKEND
    node cleanup-old-data.js
```

**GitLab CI:**
```yaml
cleanup_database:
  script:
    - cd BACKEND
    - node cleanup-old-data.js
  schedule:
    cron: "0 2 * * 0"  # Weekly at 2 AM
```

### How to Monitor

```bash
# Run and log to file
node cleanup-old-data.js >> cleanup_$(date +%Y%m%d).log 2>&1

# Run with timestamps
node cleanup-old-data.js | tee cleanup_$(date +%Y%m%d_%H%M%S).log
```

---

## File Locations

| File | Purpose |
|------|---------|
| `cleanup-old-data.js` | Main cleanup script |
| `CLEANUP_GUIDE.md` | Full documentation |
| `CLEANUP_QUICK_REFERENCE.md` | This file |

---

## Environment Variables

Script uses: `.env` or `.env.example`

```env
MONGODB_URI=mongodb://localhost:27017/ashecontrol
# or for Atlas:
# MONGODB_URI=mongodb+srv://user:pass@cluster.mongodb.net/ashecontrol
```

---

## Questions?

Review `CLEANUP_GUIDE.md` for detailed documentation.
