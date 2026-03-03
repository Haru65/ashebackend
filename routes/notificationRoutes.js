const express = require('express');
const router = express.Router();
const notificationController = require('../controller/notificationController');

/**
 * Notification Routes
 */

// Create a new notification
router.post('/', notificationController.createNotification);

// Get all notifications for a user
router.get('/user/:userId', notificationController.getUserNotifications);

// Get unread notifications for a user
router.get('/user/:userId/unread', notificationController.getUnreadNotifications);

// Get notification count for a user
router.get('/user/:userId/count', notificationController.getNotificationCount);

// Mark notification as read
router.put('/:notificationId/read', notificationController.markAsRead);

// Mark all notifications as read for a user
router.put('/user/:userId/read-all', notificationController.markAllAsRead);

// Delete a notification
router.delete('/:notificationId', notificationController.deleteNotification);

module.exports = router;
