const express = require('express');
const router = express.Router();
const alarmController = require('../controller/alarmController');

// Clear all alarms (admin only) - MUST come before /:id routes
router.delete('/', alarmController.clearAllAlarms.bind(alarmController));

// Device-specific alarm routes (IMPORTANT: Place before :id routes to avoid conflicts)
router.get('/device/:deviceName', alarmController.getAlarmsByDevice.bind(alarmController));
router.delete('/device/:deviceName', alarmController.deleteDeviceAlarms.bind(alarmController));

// Alarm CRUD routes
router.get('/', alarmController.getAllAlarms.bind(alarmController));
router.get('/:id', alarmController.getAlarmById.bind(alarmController));
router.post('/', alarmController.createAlarm.bind(alarmController));
router.put('/:id', alarmController.updateAlarm.bind(alarmController));
router.delete('/:id', alarmController.deleteAlarm.bind(alarmController));

// Notification routes
router.post('/:id/send-sms', alarmController.sendSMSNotification.bind(alarmController));
router.post('/:id/send-email', alarmController.sendEmailNotification.bind(alarmController));
router.post('/:id/trigger-notification', alarmController.triggerAlarmNotification.bind(alarmController));

// Device status routes
router.get('/dashboard/device-status', alarmController.getDeviceStatusSummary.bind(alarmController));

module.exports = router;
