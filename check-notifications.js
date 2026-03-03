const mongoose = require('mongoose');
const Notification = require('./models/Notification');

mongoose.connect('mongodb://localhost:27017/zeptac').then(async () => {
  console.log('Connected to DB');
  
  // Find ALL notifications
  const all = await Notification.find({}).lean();
  console.log('Total notifications:', all.length);
  
  // Find broadcast notifications
  const broadcast = await Notification.find({ user_id: null }).lean();
  console.log('Broadcast notifications (user_id: null):', broadcast.length);
  
  // Find alarm type notifications
  const alarmType = await Notification.find({ type: 'alarm' }).lean();
  console.log('Alarm type notifications:', alarmType.length);
  
  // Find broadcast alarms
  const broadcastAlarms = await Notification.find({ user_id: null, type: 'alarm' }).lean();
  console.log('Broadcast alarm notifications:', broadcastAlarms.length);
  
  if (broadcastAlarms.length > 0) {
    console.log('First broadcast alarm:', JSON.stringify(broadcastAlarms[0], null, 2));
  }
  
  // Show recent notification
  const recent = await Notification.findOne({}).sort({ created_at: -1 }).lean();
  console.log('Most recent notification:', JSON.stringify(recent, null, 2));
  
  process.exit(0);
}).catch(err => {
  console.error('DB Error:', err);
  process.exit(1);
});
