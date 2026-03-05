/**
 * Script to clear telemetry data
 * Use with caution - this deletes data from the database
 */

const mongoose = require('mongoose');
const readline = require('readline');
const path = require('path');

require('dotenv').config({ path: path.join(__dirname, '.env') });

const Telemetry = require('./models/telemetry');

const rl = readline.createInterface({
  input: process.stdin,
  output: process.stdout
});

function prompt(question) {
  return new Promise((resolve) => {
    rl.question(question, (answer) => {
      resolve(answer.trim().toLowerCase());
    });
  });
}

async function clearTelemetryData() {
  try {
    console.log('\n' + '='.repeat(80));
    console.log('⚠️  TELEMETRY DATA CLEARING TOOL');
    console.log('='.repeat(80));
    console.log('\n🚨 WARNING: This will DELETE data from the database!');
    console.log('   Once deleted, data cannot be recovered.\n');

    const mongoUri = process.env.MONGODB_URI || 'mongodb+srv://admin:ashecontrol@cluster0.v2hyu.mongodb.net/ashecontrol?retryWrites=true&w=majority';
    
    console.log('🔗 Connecting to MongoDB...');
    await mongoose.connect(mongoUri, {
      serverSelectionTimeoutMS: 15000,
      socketTimeoutMS: 45000,
    });
    console.log('✅ Connected to MongoDB\n');

    // Get current data stats
    const totalRecords = await Telemetry.countDocuments();
    console.log(`📊 Current telemetry records: ${totalRecords}`);

    const eventCounts = {};
    const eventTypes = ['DPOL', 'INT', 'INST', 'NORMAL'];
    for (const eventType of eventTypes) {
      const count = await Telemetry.countDocuments({ event: eventType });
      if (count > 0) {
        eventCounts[eventType] = count;
        console.log(`   ${eventType}: ${count}`);
      }
    }

    if (totalRecords === 0) {
      console.log('\n✅ No data to clear - database is already empty');
      rl.close();
      return;
    }

    console.log('\n📋 CLEAR OPTIONS:');
    console.log('  1. Clear ALL telemetry data');
    console.log('  2. Clear DPOL events only');
    console.log('  3. Clear INT events only');
    console.log('  4. Clear INST events only');
    console.log('  5. Clear NORMAL events only');
    console.log('  6. Clear data before specific date');
    console.log('  0. Cancel (do nothing)');

    const choice = await prompt('\n👉 Enter your choice (0-6): ');

    if (choice === '0') {
      console.log('\n❌ Operation cancelled - no data deleted');
      rl.close();
      return;
    }

    let filter = null;
    let description = '';
    let recordsToDelete = 0;

    switch (choice) {
      case '1':
        // Clear ALL
        filter = {};
        description = 'ALL telemetry records';
        recordsToDelete = totalRecords;
        break;

      case '2':
        // DPOL only
        filter = { event: 'DPOL' };
        description = 'DPOL events';
        recordsToDelete = eventCounts.DPOL || 0;
        break;

      case '3':
        // INT only
        filter = { event: 'INT' };
        description = 'INT events';
        recordsToDelete = eventCounts.INT || 0;
        break;

      case '4':
        // INST only
        filter = { event: 'INST' };
        description = 'INST events';
        recordsToDelete = eventCounts.INST || 0;
        break;

      case '5':
        // NORMAL only
        filter = { event: 'NORMAL' };
        description = 'NORMAL events';
        recordsToDelete = eventCounts.NORMAL || 0;
        break;

      case '6':
        // Before date
        const dateStr = await prompt('Enter date (YYYY-MM-DD): ');
        try {
          const beforeDate = new Date(dateStr);
          if (isNaN(beforeDate.getTime())) {
            console.log('\n❌ Invalid date format');
            rl.close();
            return;
          }
          filter = { timestamp: { $lt: beforeDate } };
          description = `records before ${dateStr}`;
          recordsToDelete = await Telemetry.countDocuments(filter);
        } catch (error) {
          console.log('\n❌ Error parsing date:', error.message);
          rl.close();
          return;
        }
        break;

      default:
        console.log('\n❌ Invalid choice');
        rl.close();
        return;
    }

    if (recordsToDelete === 0) {
      console.log('\n✅ No records match criteria - nothing to delete');
      rl.close();
      return;
    }

    // Final confirmation
    console.log('\n' + '='.repeat(80));
    console.log(`🗑️  ABOUT TO DELETE: ${recordsToDelete} ${description}`);
    console.log('='.repeat(80));
    console.log('\n❌ THIS CANNOT BE UNDONE!');

    const confirm = await prompt('\nType "DELETE" to confirm: ');

    if (confirm !== 'DELETE') {
      console.log('\n✅ Operation cancelled - no data deleted');
      rl.close();
      return;
    }

    // Perform deletion
    console.log('\n🗑️  Deleting data...');
    const deleteResult = await Telemetry.deleteMany(filter);
    
    console.log('\n✅ DATA DELETED SUCCESSFULLY');
    console.log(`   ${deleteResult.deletedCount} records removed`);

    // Show updated counts
    const remainingRecords = await Telemetry.countDocuments();
    console.log(`\n📊 Remaining telemetry records: ${remainingRecords}`);
    
    const remainingCounts = {};
    for (const eventType of eventTypes) {
      const count = await Telemetry.countDocuments({ event: eventType });
      if (count > 0) {
        console.log(`   ${eventType}: ${count}`);
      }
    }

  } catch (error) {
    console.error('\n❌ Error:', error.message);
  } finally {
    try {
      await mongoose.connection.close();
      console.log('\n✅ Database connection closed');
    } catch (e) {
      // ignore
    }
    rl.close();
  }
}

clearTelemetryData();
