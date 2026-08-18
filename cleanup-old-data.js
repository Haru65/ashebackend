#!/usr/bin/env node
/**
 * Database Cleanup Script
 * 
 * Purpose: Remove redundant/old telemetry data while preserving:
 * - All user accounts and their data
 * - All device configurations
 * - All alarm configurations
 * - Data from the last 7 days
 * 
 * Collections handled:
 * - telemetry_data: Keep last 7 days
 * - devicehistory: Keep last 7 days
 * - alarm_triggers: Keep last 7 days
 * - notifications: Keep last 7 days
 * - users, devices, alarms, zones: Keep all
 * 
 * Usage: node cleanup-old-data.js [--dry-run] [--days N]
 */

const mongoose = require('mongoose');
require('dotenv').config();

// Models
const TelemetryModel = require('./models/telemetry');
const DeviceHistoryModel = require('./models/DeviceHistory');
const AlarmTriggerModel = require('./models/AlarmTrigger');
const NotificationModel = require('./models/Notification');
const UserModel = require('./models/user');

// Parse command line arguments
const args = process.argv.slice(2);
const isDryRun = args.includes('--dry-run');
const daysArgIndex = args.findIndex(arg => arg === '--days');
const daysToKeep = daysArgIndex !== -1 ? parseInt(args[daysArgIndex + 1]) : 7;

console.log('='.repeat(70));
console.log('🗑️  DATABASE CLEANUP SCRIPT');
console.log('='.repeat(70));
console.log(`📅 Days to keep: ${daysToKeep}`);
console.log(`🔍 Mode: ${isDryRun ? 'DRY RUN (no changes)' : 'LIVE (changes will be made)'}`);
console.log('='.repeat(70));

// Connect to database
async function connectDB() {
  try {
    await mongoose.connect(process.env.MONGODB_URI || 'mongodb://localhost:27017/ashecontrol', {
      useNewUrlParser: true,
      useUnifiedTopology: true,
    });
    console.log('✅ Connected to MongoDB');
  } catch (error) {
    console.error('❌ Failed to connect to MongoDB:', error.message);
    process.exit(1);
  }
}

// Calculate cutoff date
function getCutoffDate(days) {
  const cutoff = new Date();
  cutoff.setDate(cutoff.getDate() - days);
  return cutoff;
}

// Cleanup telemetry data
async function cleanupTelemetry() {
  try {
    console.log('\n📊 TELEMETRY DATA (telemetry_data)');
    const cutoffDate = getCutoffDate(daysToKeep);
    
    const countBefore = await TelemetryModel.countDocuments({ timestamp: { $lt: cutoffDate } });
    console.log(`  📍 Records older than ${cutoffDate.toISOString()}: ${countBefore}`);
    
    if (isDryRun) {
      console.log(`  [DRY RUN] Would delete ${countBefore} records`);
    } else {
      const result = await TelemetryModel.deleteMany({ timestamp: { $lt: cutoffDate } });
      console.log(`  ✅ Deleted ${result.deletedCount} telemetry records`);
    }
  } catch (error) {
    console.error('  ❌ Error cleaning telemetry data:', error.message);
  }
}

// Cleanup device history
async function cleanupDeviceHistory() {
  try {
    console.log('\n📱 DEVICE HISTORY (devicehistory)');
    const cutoffDate = getCutoffDate(daysToKeep);
    
    const countBefore = await DeviceHistoryModel.countDocuments({ timestamp: { $lt: cutoffDate } });
    console.log(`  📍 Records older than ${cutoffDate.toISOString()}: ${countBefore}`);
    
    if (isDryRun) {
      console.log(`  [DRY RUN] Would delete ${countBefore} records`);
    } else {
      const result = await DeviceHistoryModel.deleteMany({ timestamp: { $lt: cutoffDate } });
      console.log(`  ✅ Deleted ${result.deletedCount} device history records`);
    }
  } catch (error) {
    console.error('  ❌ Error cleaning device history:', error.message);
  }
}

// Cleanup alarm triggers
async function cleanupAlarmTriggers() {
  try {
    console.log('\n🚨 ALARM TRIGGERS (alarm_triggers)');
    const cutoffDate = getCutoffDate(daysToKeep);
    
    const countBefore = await AlarmTriggerModel.countDocuments({ createdAt: { $lt: cutoffDate } });
    console.log(`  📍 Records older than ${cutoffDate.toISOString()}: ${countBefore}`);
    
    if (isDryRun) {
      console.log(`  [DRY RUN] Would delete ${countBefore} records`);
    } else {
      const result = await AlarmTriggerModel.deleteMany({ createdAt: { $lt: cutoffDate } });
      console.log(`  ✅ Deleted ${result.deletedCount} alarm trigger records`);
    }
  } catch (error) {
    console.error('  ❌ Error cleaning alarm triggers:', error.message);
  }
}

// Cleanup notifications
async function cleanupNotifications() {
  try {
    console.log('\n📧 NOTIFICATIONS (notifications)');
    const cutoffDate = getCutoffDate(daysToKeep);
    
    const countBefore = await NotificationModel.countDocuments({ created_at: { $lt: cutoffDate } });
    console.log(`  📍 Records older than ${cutoffDate.toISOString()}: ${countBefore}`);
    
    if (isDryRun) {
      console.log(`  [DRY RUN] Would delete ${countBefore} records`);
    } else {
      const result = await NotificationModel.deleteMany({ created_at: { $lt: cutoffDate } });
      console.log(`  ✅ Deleted ${result.deletedCount} notification records`);
    }
  } catch (error) {
    console.error('  ❌ Error cleaning notifications:', error.message);
  }
}

// Show preserved data summary
async function showPreservedData() {
  try {
    console.log('\n✅ PRESERVED DATA');
    
    const userCount = await UserModel.countDocuments({});
    console.log(`  👥 Users: ${userCount} (all preserved)`);
    
    // Note: Device, Alarm, Zone counts would require importing those models
    console.log(`  📱 Devices: All preserved (configurations)`);
    console.log(`  🚨 Alarms: All preserved (configurations)`);
    console.log(`  📍 Zones: All preserved (configurations)`);
  } catch (error) {
    console.error('  ❌ Error retrieving preserved data info:', error.message);
  }
}

// Main cleanup function
async function runCleanup() {
  try {
    await connectDB();
    
    // Run cleanup operations
    await cleanupTelemetry();
    await cleanupDeviceHistory();
    await cleanupAlarmTriggers();
    await cleanupNotifications();
    
    // Show preserved data
    await showPreservedData();
    
    console.log('\n' + '='.repeat(70));
    if (isDryRun) {
      console.log('✅ DRY RUN COMPLETE - No data was deleted');
      console.log('\n💡 To perform actual cleanup, run:');
      console.log('   node cleanup-old-data.js');
    } else {
      console.log('✅ CLEANUP COMPLETE');
    }
    console.log('='.repeat(70));
    
  } catch (error) {
    console.error('❌ Fatal error during cleanup:', error);
    process.exit(1);
  } finally {
    await mongoose.connection.close();
  }
}

// Run the cleanup
runCleanup();
