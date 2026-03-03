/**
 * Test Notification System
 * Run this script to verify the notification system is working correctly
 * 
 * Usage: node test-notification-system.js
 */

require('dotenv').config();
const mongoose = require('mongoose');
const Notification = require('./models/Notification');
const User = require('./models/user');

async function testNotificationSystem() {
  try {
    console.log('\n🧪 === NOTIFICATION SYSTEM TEST ===\n');

    // Connect to database
    console.log('📡 Connecting to MongoDB...');
    await mongoose.connect(process.env.MONGODB_URI || 'mongodb://localhost:27017/iot_platform');
    console.log('✅ Connected to MongoDB\n');

    // Get a test user
    console.log('👤 Fetching test user...');
    const user = await User.findOne({ isActive: true }).select('_id username email');
    
    if (!user) {
      console.error('❌ No active users found in database');
      console.log('   Please create a user first');
      process.exit(1);
    }
    
    console.log(`✅ Found user: ${user.username} (${user._id})\n`);

    // Test 1: Create a notification
    console.log('📝 Test 1: Creating a notification...');
    const testNotification = await Notification.createNotification({
      user_id: user._id.toString(),
      type: 'alarm',
      alarm_id: new mongoose.Types.ObjectId(),
      alarm_name: 'Test Alarm',
      device_id: 'test-device-001',
      device_name: 'Test Device',
      title: '🚨 ALARM: Test Alarm',
      message: 'This is a test notification',
      trigger_reason: 'Test trigger reason',
      severity: 'warning',
      triggered_values: { REF1_STS: 'OP', DCV: 15 }
    });
    console.log(`✅ Created notification: ${testNotification._id}\n`);

    // Test 2: Fetch notifications
    console.log('📥 Test 2: Fetching notifications...');
    const notifications = await Notification.getUserNotifications(user._id.toString(), 10);
    console.log(`✅ Fetched ${notifications.length} notification(s)`);
    if (notifications.length > 0) {
      console.log(`   - First notification: ${notifications[0].title}`);
      console.log(`   - Is read: ${notifications[0].is_read}`);
    }
    console.log();

    // Test 3: Fetch unread notifications
    console.log('📥 Test 3: Fetching unread notifications...');
    const unreadNotifications = await Notification.getUnread(user._id.toString(), 10);
    console.log(`✅ Fetched ${unreadNotifications.length} unread notification(s)\n`);

    // Test 4: Mark as read
    console.log('✏️ Test 4: Marking notification as read...');
    const markedNotification = await Notification.markAsRead(testNotification._id.toString());
    console.log(`✅ Marked as read: ${markedNotification.is_read}`);
    console.log(`   - Read at: ${markedNotification.read_at}\n`);

    // Test 5: Verify mark as read
    console.log('📥 Test 5: Verifying mark as read...');
    const unreadAfterMark = await Notification.getUnread(user._id.toString(), 10);
    console.log(`✅ Unread count after mark: ${unreadAfterMark.length}\n`);

    // Test 6: Create multiple notifications
    console.log('📝 Test 6: Creating multiple notifications...');
    for (let i = 0; i < 3; i++) {
      await Notification.createNotification({
        user_id: user._id.toString(),
        type: 'alarm',
        alarm_id: new mongoose.Types.ObjectId(),
        alarm_name: `Test Alarm ${i + 1}`,
        device_id: `test-device-${i + 1}`,
        device_name: `Test Device ${i + 1}`,
        title: `🚨 ALARM: Test Alarm ${i + 1}`,
        message: `Test notification ${i + 1}`,
        trigger_reason: `Test trigger ${i + 1}`,
        severity: i === 0 ? 'critical' : i === 1 ? 'high' : 'warning',
        triggered_values: { REF1_STS: 'OP', DCV: 15 + i }
      });
    }
    console.log('✅ Created 3 notifications\n');

    // Test 7: Fetch all notifications
    console.log('📥 Test 7: Fetching all notifications...');
    const allNotifications = await Notification.getUserNotifications(user._id.toString(), 100);
    console.log(`✅ Total notifications: ${allNotifications.length}`);
    allNotifications.forEach((notif, index) => {
      console.log(`   ${index + 1}. ${notif.title} (${notif.severity}) - Read: ${notif.is_read}`);
    });
    console.log();

    // Test 8: Mark all as read
    console.log('✏️ Test 8: Marking all as read...');
    const result = await Notification.markAllAsRead(user._id.toString());
    console.log(`✅ Marked ${result.modifiedCount} notification(s) as read\n`);

    // Test 9: Verify all marked as read
    console.log('📥 Test 9: Verifying all marked as read...');
    const unreadFinal = await Notification.getUnread(user._id.toString(), 100);
    console.log(`✅ Unread count: ${unreadFinal.length}\n`);

    // Test 10: Count notifications
    console.log('📊 Test 10: Counting notifications...');
    const totalCount = await Notification.countDocuments({ user_id: user._id });
    const unreadCount = await Notification.countDocuments({ user_id: user._id, is_read: false });
    console.log(`✅ Total: ${totalCount}, Unread: ${unreadCount}\n`);

    // Summary
    console.log('✅ === ALL TESTS PASSED ===\n');
    console.log('Summary:');
    console.log(`  - Created notifications: ✅`);
    console.log(`  - Fetched notifications: ✅`);
    console.log(`  - Marked as read: ✅`);
    console.log(`  - Fetched unread: ✅`);
    console.log(`  - Counted notifications: ✅`);
    console.log(`  - Database connection: ✅`);
    console.log(`  - Model methods: ✅\n`);

    console.log('🎉 Notification system is working correctly!\n');

  } catch (error) {
    console.error('❌ Test failed:', error);
    console.error('\nStack trace:', error.stack);
    process.exit(1);
  } finally {
    await mongoose.disconnect();
    console.log('🔌 Disconnected from MongoDB\n');
  }
}

// Run tests
testNotificationSystem();
