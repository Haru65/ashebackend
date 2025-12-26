/**
 * Script to check and remove any TTL (Time To Live) indexes on the User collection
 * that might be causing automatic deletion of users
 * 
 * Usage: node checkAndFixTTLIndexes.js
 */

const mongoose = require('mongoose');
require('dotenv').config();

async function checkAndFixTTLIndexes() {
  try {
    console.log('🔍 Checking for TTL indexes on User collection...\n');
    
    // Connect to MongoDB
    await mongoose.connect(process.env.MONGODB_URI || 'mongodb://localhost:27017/zeptac_iot');
    console.log('✅ MongoDB connected\n');

    // Get the User collection
    const db = mongoose.connection.db;
    const userCollection = db.collection('users');

    // Get all indexes on the User collection
    const indexes = await userCollection.indexes();
    
    console.log('📋 Current indexes on "users" collection:');
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    
    let foundTTLIndexes = false;
    const indexesToDrop = [];

    indexes.forEach((index, i) => {
      const indexName = index.name;
      const indexSpec = index.key;
      const hasExpireAfterSeconds = 'expireAfterSeconds' in index;
      
      console.log(`\n[Index ${i}] Name: ${indexName}`);
      console.log(`  Fields: ${JSON.stringify(indexSpec)}`);
      
      if (hasExpireAfterSeconds) {
        console.log(`  ⚠️  TTL DETECTED! Expires after: ${index.expireAfterSeconds} seconds`);
        foundTTLIndexes = true;
        if (indexName !== '_id_') {
          indexesToDrop.push(indexName);
        }
      } else {
        console.log(`  ✅ Regular index (no TTL)`);
      }
    });

    console.log('\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');

    if (!foundTTLIndexes) {
      console.log('\n✅ No TTL indexes found! Users should be safe.');
    } else {
      console.log(`\n⚠️  Found ${indexesToDrop.length} TTL index(es) that need to be removed`);
      
      if (indexesToDrop.length > 0) {
        console.log('\n🔧 Removing TTL indexes...\n');
        
        for (const indexName of indexesToDrop) {
          try {
            await userCollection.dropIndex(indexName);
            console.log(`   ✅ Dropped index: ${indexName}`);
          } catch (error) {
            console.error(`   ❌ Failed to drop index ${indexName}:`, error.message);
          }
        }
        
        // Verify removal
        const updatedIndexes = await userCollection.indexes();
        const stillHasTTL = updatedIndexes.some(idx => 'expireAfterSeconds' in idx && idx.name !== '_id_');
        
        if (!stillHasTTL) {
          console.log('\n✅ All TTL indexes successfully removed!');
        } else {
          console.log('\n⚠️  Some TTL indexes remain. Manual intervention may be needed.');
        }
      }
    }

    console.log('\n🔍 Checking user count...');
    const userCount = await mongoose.model('User').countDocuments();
    console.log(`   Total users in database: ${userCount}`);

  } catch (error) {
    console.error('❌ Error:', error);
  } finally {
    await mongoose.connection.close();
    console.log('\n✅ Database connection closed');
    process.exit(0);
  }
}

// Import User model
require('./models/user');

checkAndFixTTLIndexes();
