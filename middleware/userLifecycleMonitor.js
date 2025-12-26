/**
 * User Lifecycle Monitoring Middleware
 * Logs user creation, updates, and access to help detect unexpected deletion issues
 */

const User = require('../models/user');

class UserLifecycleMonitor {
  /**
   * Log user creation
   */
  static async logUserCreation(user) {
    try {
      console.log(`📝 USER CREATED:`);
      console.log(`   ID: ${user._id}`);
      console.log(`   Email: ${user.email}`);
      console.log(`   Username: ${user.username}`);
      console.log(`   Role: ${user.role}`);
      console.log(`   Created At: ${user.createdAt}`);
      console.log(`   Timestamp: ${new Date().toISOString()}`);
      
      // Optional: Write to file or external logging service
      this._writeToLog({
        type: 'USER_CREATED',
        userId: user._id,
        email: user.email,
        timestamp: new Date()
      });
    } catch (error) {
      console.error('Error logging user creation:', error);
    }
  }

  /**
   * Log user login
   */
  static async logUserLogin(userId, email) {
    try {
      console.log(`✅ USER LOGIN:`);
      console.log(`   ID: ${userId}`);
      console.log(`   Email: ${email}`);
      console.log(`   Timestamp: ${new Date().toISOString()}`);
      
      this._writeToLog({
        type: 'USER_LOGIN',
        userId,
        email,
        timestamp: new Date()
      });
    } catch (error) {
      console.error('Error logging user login:', error);
    }
  }

  /**
   * Verify user still exists after creation
   * Run this periodically to detect unexpected deletions
   */
  static async verifyUserExists(userId) {
    try {
      const user = await User.findById(userId);
      
      if (!user) {
        console.error(`⚠️  USER MISSING - UNEXPECTED DELETION DETECTED:`);
        console.error(`   User ID: ${userId}`);
        console.error(`   Timestamp: ${new Date().toISOString()}`);
        
        this._writeToLog({
          type: 'USER_MISSING',
          userId,
          timestamp: new Date(),
          severity: 'HIGH'
        });
        
        return false;
      }
      
      return true;
    } catch (error) {
      console.error('Error verifying user existence:', error);
      return false;
    }
  }

  /**
   * Get user count and log it
   */
  static async logUserCount() {
    try {
      const count = await User.countDocuments();
      console.log(`📊 USER COUNT: ${count} users in database at ${new Date().toISOString()}`);
      
      this._writeToLog({
        type: 'USER_COUNT_CHECK',
        count,
        timestamp: new Date()
      });
      
      return count;
    } catch (error) {
      console.error('Error getting user count:', error);
      return -1;
    }
  }

  /**
   * Check for users that were created but no longer exist
   * (Indicates TTL or other auto-deletion is happening)
   */
  static async detectUnexpectedDeletions() {
    try {
      // This would require maintaining a separate log of created users
      // For now, we just check the current state
      const recentUsers = await User.find({
        createdAt: { 
          $gte: new Date(Date.now() - 7 * 24 * 60 * 60 * 1000) // Last 7 days
        }
      }).select('_id email createdAt updatedAt');
      
      console.log(`🔍 RECENT USERS (Last 7 days):`);
      console.log(`   Count: ${recentUsers.length}`);
      
      recentUsers.forEach(user => {
        console.log(`   - ${user.email} (Created: ${user.createdAt.toISOString()})`);
      });
      
      return recentUsers;
    } catch (error) {
      console.error('Error detecting unexpected deletions:', error);
      return [];
    }
  }

  /**
   * Set up periodic monitoring
   */
  static startPeriodicMonitoring(intervalMinutes = 60) {
    console.log(`🚀 Starting User Lifecycle Monitoring (interval: ${intervalMinutes} minutes)`);
    
    setInterval(async () => {
      console.log('\n📊 ===== PERIODIC USER MONITORING CHECK =====');
      await this.logUserCount();
      await this.detectUnexpectedDeletions();
      console.log('==========================================\n');
    }, intervalMinutes * 60 * 1000);
  }

  /**
   * Private helper to write logs (can be extended to file/external service)
   */
  static _writeToLog(logEntry) {
    // TODO: Implement external logging (file, Elasticsearch, CloudWatch, etc.)
    // For now, just log to console
    if (process.env.ENABLE_USER_LIFECYCLE_LOGS === 'true') {
      console.log(`[USER_LOG] ${JSON.stringify(logEntry)}`);
    }
  }
}

module.exports = UserLifecycleMonitor;
