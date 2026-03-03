const express = require('express');
const router = express.Router();
const notificationController = require('../controller/notificationController');

/**
 * Notification Routes
 * IMPORTANT: Specific routes must come BEFORE generic parameter-based routes!
 * Routes are processed in order, so more specific patterns must come first
 */

// Broadcast notifications route (must come FIRST - most specific)
router.get('/broadcast/all', notificationController.getBroadcastNotifications);
router.get('/broadcast/unread', notificationController.getUnreadBroadcastNotifications);

// Specific routes for user notifications (must come BEFORE generic parameter-based routes)
router.get('/user/:userId/unread', notificationController.getUnreadNotifications);
router.get('/user/:userId/count', notificationController.getNotificationCount);
router.put('/user/:userId/read-all', notificationController.markAllAsRead);
router.get('/user/:userId', notificationController.getUserNotifications);

// Routes for individual notification operations by ID
// These handle IDs like "69a295482daae0853553ebdc" or "69a295482daae0853553ebdc-1772543662965"

// OPTIONS handler for preflight requests
router.options('/:notificationId/read', (req, res) => {
  res.header('Access-Control-Allow-Methods', 'GET, POST, PUT, PATCH, DELETE, OPTIONS');
  res.header('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  res.sendStatus(200);
});

router.put('/:notificationId/read', (req, res, next) => {
  console.log(`[NotificationRoutes] 📥 PUT /:notificationId/read called`);
  console.log(`[NotificationRoutes] 📝 notificationId param: ${req.params.notificationId}`);
  console.log(`[NotificationRoutes] 📊 Full URL: ${req.originalUrl}`);
  next();
}, notificationController.markAsRead);

// OPTIONS handler for preflight requests on delete
router.options('/:notificationId', (req, res) => {
  res.header('Access-Control-Allow-Methods', 'GET, POST, PUT, PATCH, DELETE, OPTIONS');
  res.header('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  res.sendStatus(200);
});

router.delete('/:notificationId', (req, res, next) => {
  console.log(`[NotificationRoutes] 📥 DELETE /:notificationId called`);
  console.log(`[NotificationRoutes] 📝 notificationId param: ${req.params.notificationId}`);
  next();
}, notificationController.deleteNotification);

// OPTIONS handler for PUT on mark all as read
router.options('/user/:userId/read-all', (req, res) => {
  res.header('Access-Control-Allow-Methods', 'GET, POST, PUT, PATCH, DELETE, OPTIONS');
  res.header('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  res.sendStatus(200);
});

// Generic routes (must come last)
router.post('/', notificationController.createNotification);

module.exports = router;
