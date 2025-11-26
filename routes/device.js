const express = require('express');
const DeviceController = require('../controller/deviceController');
const { authenticateToken, requirePermission, optionalAuth } = require('../middleware/auth');

const router = express.Router();

// Device routes
router.get('/devices', DeviceController.getAllDevices); // Public endpoint - no auth required
router.post('/devices', DeviceController.createDevice); // Public endpoint for adding new devices
router.get('/devices/mqtt', authenticateToken, requirePermission('read_devices'), DeviceController.getDevices);
router.get('/devices/:deviceId', DeviceController.getDeviceById); // Public endpoint - no auth required
router.get('/devices/:deviceId/settings', DeviceController.getDeviceSettings); // Get device configuration/settings
router.post('/devices/:deviceId/data', authenticateToken, requirePermission('write_devices'), DeviceController.postDeviceData);
router.post('/send-message', authenticateToken, requirePermission('send_commands'), DeviceController.sendMessage);

// Device configuration routes with acknowledgment tracking
router.post('/devices/:deviceId/config/interrupt', authenticateToken, requirePermission('send_commands'), DeviceController.setInterruptMode);
router.post('/devices/:deviceId/config/manual', authenticateToken, requirePermission('send_commands'), DeviceController.setManualMode);
router.post('/devices/:deviceId/config/normal', authenticateToken, requirePermission('send_commands'), DeviceController.setNormalMode);
router.post('/devices/:deviceId/config/dpol', authenticateToken, requirePermission('send_commands'), DeviceController.setDpolMode);
router.post('/devices/:deviceId/config/inst', authenticateToken, requirePermission('send_commands'), DeviceController.setInstMode);
router.post('/devices/:deviceId/config/settings', authenticateToken, requirePermission('send_commands'), DeviceController.setSettingsMode);

router.get('/health', optionalAuth, DeviceController.getHealth);

module.exports = router;