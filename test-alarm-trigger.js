const mongoose = require('mongoose');
const AlarmTrigger = require('./models/AlarmTrigger');

// Connect to MongoDB
mongoose.connect('mongodb://localhost:27017/ZEPTAC', {
  useNewUrlParser: true,
  useUnifiedTopology: true
})
.then(async () => {
  console.log('✅ Connected to MongoDB');
  
  try {
    // Test 1: Check if AlarmTrigger collection exists
    const count = await AlarmTrigger.countDocuments();
    console.log(`📊 Total alarm triggers in database: ${count}`);
    
    // Test 2: Fetch recent triggers
    const recent = await AlarmTrigger.find()
      .sort({ createdAt: -1 })
      .limit(5);
    
    if (recent.length > 0) {
      console.log('\n📋 Recent alarm triggers:');
      recent.forEach(trigger => {
        console.log(`  - ${trigger.alarm_name} on ${trigger.device_name} at ${trigger.createdAt}`);
        console.log(`    Reason: ${trigger.trigger_reason}`);
        console.log(`    Values:`, trigger.triggered_values);
      });
    } else {
      console.log('\n⚠️  No alarm triggers found in database yet');
      console.log('   Triggers will be saved when an alarm is triggered after backend restart');
    }
    
    // Test 3: Check collection structure
    const collection = mongoose.connection.collection('alarmtriggers');
    const stats = await collection.stats();
    console.log(`\n📈 Database stats:`, {
      count: stats.count,
      size: stats.size,
      avgObjSize: stats.avgObjSize
    });
    
  } catch (error) {
    console.error('❌ Error checking AlarmTrigger:', error.message);
  }
  
  process.exit(0);
})
.catch(error => {
  console.error('❌ MongoDB connection failed:', error.message);
  process.exit(1);
});
