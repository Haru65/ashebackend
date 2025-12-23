/**
 * Direct MongoDB inspection - list all collections and their documents
 */

const mongoose = require('mongoose');

const dbUrl = process.env.MONGO_URI || process.env.MONGODB_URI || 'mongodb://localhost:27017/ZEPTAC_IOT';

async function inspectDatabase() {
  try {
    console.log('\n' + '='.repeat(80));
    console.log('🔍 MONGODB COLLECTION INSPECTION');
    console.log('='.repeat(80) + '\n');

    await mongoose.connect(dbUrl);
    console.log('✅ Connected to MongoDB\n');

    const db = mongoose.connection.db;
    const collections = await db.listCollections().toArray();

    console.log(`📚 Found ${collections.length} collections:\n`);

    for (const collection of collections) {
      const collectionName = collection.name;
      const count = await db.collection(collectionName).countDocuments();
      
      console.log(`📄 ${collectionName} (${count} documents)`);
      
      if (count > 0) {
        const sample = await db.collection(collectionName).findOne({});
        console.log(`   Sample data:`, JSON.stringify(sample, null, 2).split('\n').slice(0, 10).join('\n   '));
        if (count > 1 || Object.keys(sample).length > 10) {
          console.log(`   ... (truncated)`);
        }
      }
      console.log();
    }

    console.log('='.repeat(80) + '\n');

  } catch (error) {
    console.error('❌ Error:', error.message);
  } finally {
    await mongoose.connection.close();
  }
}

inspectDatabase();
