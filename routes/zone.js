const express = require('express');
const ZoneController = require('../controller/zoneController');

const router = express.Router();

/**
 * Zone Management Routes
 */

// Get all zones
router.get('/zones', ZoneController.getAllZones);

// Get zone by ID
router.get('/zones/:zoneId', ZoneController.getZoneById);

// Create a new zone
router.post('/zones', ZoneController.createZone);

// Update a zone
router.put('/zones/:zoneId', ZoneController.updateZone);

// Delete a zone
router.delete('/zones/:zoneId', ZoneController.deleteZone);

// Initialize default zones (if none exist)
router.post('/zones/init/defaults', ZoneController.initializeDefaultZones);

module.exports = router;
