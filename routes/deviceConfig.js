const express = require('express');
const router = express.Router();
const deviceConfigController = require('../controller/deviceConfigController');

// Device configuration routes
router.post('/devices/:deviceId/configure/interrupt-mode', deviceConfigController.configureInterruptMode);
router.post('/devices/:deviceId/configure/manual-mode', deviceConfigController.configureManualMode);
router.post('/devices/:deviceId/configure/normal-mode', deviceConfigController.configureNormalMode);
router.post('/devices/:deviceId/configure/dpol-mode', deviceConfigController.configureDpolMode);
router.post('/devices/:deviceId/configure/inst-mode', deviceConfigController.configureInstMode);
router.post('/devices/:deviceId/configure/timer', deviceConfigController.configureTimer);
router.post('/devices/:deviceId/configure/electrode', deviceConfigController.configureElectrode);
router.post('/devices/:deviceId/configure/alarm', deviceConfigController.configureAlarm);

// Device status route
router.get('/devices/:deviceId/status', deviceConfigController.getDeviceStatus);

// Device settings routes - NEW
router.get('/devices/:deviceId/settings', deviceConfigController.getDeviceSettings);
router.post('/devices/:deviceId/settings', deviceConfigController.updateDeviceSettings);
router.post('/devices/:deviceId/settings/single', deviceConfigController.updateSingleSetting);

// Settings caching routes - COMPLETE PAYLOAD & BATCH
router.post('/devices/:deviceId/settings/complete', deviceConfigController.sendCompleteSettingsPayload);
router.post('/devices/:deviceId/settings/batch', deviceConfigController.batchUpdateSettings);

// New configuration routes for missing features  
router.post('/devices/:deviceId/configure/voltage', deviceConfigController.configureSetVoltage);
router.post('/devices/:deviceId/configure/shunt', deviceConfigController.configureSetShunt);

// New routes for Shunt Voltage and Shunt Current configuration (data frame parameters)
router.post('/devices/:deviceId/configure/shunt-voltage', deviceConfigController.configureShuntVoltage);
router.post('/devices/:deviceId/configure/shunt-current', deviceConfigController.configureShuntCurrent);
router.post('/devices/:deviceId/configure/logging', deviceConfigController.configureLoggingInterval);

// Individual set value configuration routes with acknowledgment tracking
router.post('/devices/:deviceId/configure/set-up', deviceConfigController.configureSetUP);
router.post('/devices/:deviceId/configure/set-op', deviceConfigController.configureSetOP);
router.post('/devices/:deviceId/configure/ref-fail', deviceConfigController.configureRefFail);

module.exports = router;