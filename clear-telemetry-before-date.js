/**
 * Script to clear telemetry data before a specific date
 * Non-interactive version for scripting
 */

const mongoose = require('mongoose');
const path = require('path');

require('dotenv').config({ path: path.join(__dirname, '.env') });

const Telemetry = require('./models/telemetry');

async function clearDataBeforeDate(dateString) {
  try {
    console.log('\n' + '='.repeat(80));
    console.log('🗑️  TELEMETRY CLEANUP TOOL');
    console.log('='.repeat(80));

    const mongoUri = process.env.MONGODB_URI || 'mongodb+srv://admin:ashecontrol@cluster0.v2hyu.mongodb.net/ashecontrol?retryWrites=true&w=majority';
    
    console.log('\n🔗 Connecting to MongoDB...');
    await mongoose.connect(mongoUri, {
      serverSelectionTimeoutMS: 15000,
      socketTimeoutMS: 45000,
    });
    console.log('✅ Connected to MongoDB');

    // Parse the date
    const beforeDate = new Date(dateString);
    if (isNaN(beforeDate.getTime())) {
      throw new Error(`Invalid date format: ${dateString}. Use YYYY-MM-DD (e.g., 2026-03-03)`);
    }

    console.log(`\n📋 Target: Delete all records before ${beforeDate.toISOString().split('T')[0]}`);

    // Get current stats
    const totalBefore = await Telemetry.countDocuments();
    const recordsToDelete = await Telemetry.countDocuments({ timestamp: { $lt: beforeDate } });
    
    console.log(`\n📊 Current Statistics:`);
    console.log(`   Total records: ${totalBefore}`);
    console.log(`   Records before ${dateString}: ${recordsToDelete}`);
    
    if (recordsToDelete === 0) {
      console.log('\n✅ No records found before this date - nothing to delete');
      return;
    }

    // Show breakdown
    const eventTypes = ['DPOL', 'INT', 'INST', 'NORMAL'];
    console.log(`\n   Breakdown by event type (before ${dateString}):`);
    for (const eventType of eventTypes) {
      const count = await Telemetry.countDocuments({ 
        event: eventType,
        timestamp: { $lt: beforeDate }
      });
      if (count > 0) {
        console.log(`      ${eventType}: ${count}`);
      }
    }

    // Perform deletion
    console.log(`\n🗑️  Deleting ${recordsToDelete} records...`);
    const deleteResult = await Telemetry.deleteMany({ timestamp: { $lt: beforeDate } });
    
    console.log('\n✅ DELETION COMPLETE');
    console.log(`   ${deleteResult.deletedCount} records removed`);

    // Show updated stats
    const totalAfter = await Telemetry.countDocuments();
    console.log(`\n📊 Updated Statistics:`);
    console.log(`   Total records: ${totalAfter}`);
    console.log(`   Deleted: ${recordsToDelete}`);
    
    console.log(`\n   Remaining by event type:`);
    for (const eventType of eventTypes) {
      const count = await Telemetry.countDocuments({ event: eventType });
      if (count > 0) {
        console.log(`      ${eventType}: ${count}`);
      }
    }

  } catch (error) {
    console.error('\n❌ Error:', error.message);
    process.exit(1);
  } finally {
    try {
      await mongoose.connection.close();
      console.log('\n✅ Database connection closed\n');
    } catch (e) {
      // ignore
    }
  }
}

// Get date from command line argument or use default
const dateArg = process.argv[2];

if (!dateArg) {
  console.error('\n❌ Usage: node clear-telemetry-before-date.js <date>');
  console.error('   Example: node clear-telemetry-before-date.js 2026-03-03');
  process.exit(1);
}

clearDataBeforeDate(dateArg);
