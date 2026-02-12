const Zone = require('../models/Zone');

class ZoneController {
  /**
   * Get all zones
   */
  static async getAllZones(req, res) {
    try {
      console.log('🔍 Fetching all zones...');
      
      const zones = await Zone.find({}).sort({ createdAt: -1 });
      
      console.log(`✅ Retrieved ${zones.length} zones`);
      
      res.json({
        success: true,
        count: zones.length,
        zones: zones
      });
    } catch (error) {
      console.error('❌ Error fetching zones:', error);
      res.status(500).json({
        success: false,
        error: 'Failed to fetch zones',
        message: error.message
      });
    }
  }

  /**
   * Get zone by ID
   */
  static async getZoneById(req, res) {
    try {
      const { zoneId } = req.params;
      console.log(`🔍 Fetching zone: ${zoneId}`);
      
      const zone = await Zone.findOne({ id: zoneId });
      
      if (!zone) {
        return res.status(404).json({
          success: false,
          error: 'Zone not found',
          message: `Zone with ID ${zoneId} does not exist`
        });
      }
      
      console.log(`✅ Retrieved zone: ${zone.name}`);
      
      res.json({
        success: true,
        zone: zone
      });
    } catch (error) {
      console.error('❌ Error fetching zone:', error);
      res.status(500).json({
        success: false,
        error: 'Failed to fetch zone',
        message: error.message
      });
    }
  }

  /**
   * Create a new zone
   */
  static async createZone(req, res) {
    try {
      const { id, name, description, color, deviceCount } = req.body;
      
      // Validate required fields
      if (!name) {
        return res.status(400).json({
          success: false,
          error: 'Zone name is required'
        });
      }

      // Check if zone with same ID already exists
      if (id) {
        const existingZone = await Zone.findOne({ id });
        if (existingZone) {
          return res.status(409).json({
            success: false,
            error: `Zone with ID ${id} already exists`
          });
        }
      }

      // Create new zone
      const newZone = new Zone({
        id: id || `zone-${Date.now()}`,
        name: name.trim(),
        description: description || '',
        color: color || '#007bff',
        deviceCount: deviceCount || 0
      });

      await newZone.save();

      console.log(`✅ Zone created: ${newZone.name} (${newZone.id})`);

      res.status(201).json({
        success: true,
        message: 'Zone created successfully',
        zone: newZone
      });
    } catch (error) {
      console.error('❌ Error creating zone:', error);
      res.status(500).json({
        success: false,
        error: 'Failed to create zone',
        message: error.message
      });
    }
  }

  /**
   * Update a zone
   */
  static async updateZone(req, res) {
    try {
      const { zoneId } = req.params;
      const { name, description, color, deviceCount } = req.body;

      console.log(`🔄 Updating zone: ${zoneId}`);

      // Build update object
      const updateData = {};
      if (name !== undefined) updateData.name = name.trim();
      if (description !== undefined) updateData.description = description;
      if (color !== undefined) updateData.color = color;
      if (deviceCount !== undefined) updateData.deviceCount = deviceCount;

      const zone = await Zone.findOneAndUpdate(
        { id: zoneId },
        updateData,
        { new: true, runValidators: true }
      );

      if (!zone) {
        return res.status(404).json({
          success: false,
          error: 'Zone not found',
          message: `Zone with ID ${zoneId} does not exist`
        });
      }

      console.log(`✅ Zone updated: ${zone.name}`);

      res.json({
        success: true,
        message: 'Zone updated successfully',
        zone: zone
      });
    } catch (error) {
      console.error('❌ Error updating zone:', error);
      res.status(500).json({
        success: false,
        error: 'Failed to update zone',
        message: error.message
      });
    }
  }

  /**
   * Delete a zone
   */
  static async deleteZone(req, res) {
    try {
      const { zoneId } = req.params;

      console.log(`🗑️ Deleting zone: ${zoneId}`);

      const zone = await Zone.findOneAndDelete({ id: zoneId });

      if (!zone) {
        return res.status(404).json({
          success: false,
          error: 'Zone not found',
          message: `Zone with ID ${zoneId} does not exist`
        });
      }

      console.log(`✅ Zone deleted: ${zone.name}`);

      res.json({
        success: true,
        message: 'Zone deleted successfully',
        zone: zone
      });
    } catch (error) {
      console.error('❌ Error deleting zone:', error);
      res.status(500).json({
        success: false,
        error: 'Failed to delete zone',
        message: error.message
      });
    }
  }

  /**
   * Bulk operations - create default zones if none exist
   */
  static async initializeDefaultZones(req, res) {
    try {
      console.log('🔷 Initializing default zones...');

      // Check if zones exist
      const existingZones = await Zone.find({});
      if (existingZones.length > 0) {
        return res.json({
          success: true,
          message: 'Zones already exist',
          zones: existingZones
        });
      }

      // Create default zones
      const defaultZones = [
        {
          id: 'zone-1',
          name: 'Zone 1',
          description: 'Primary monitoring zone',
          color: '#007bff',
          deviceCount: 0
        },
        {
          id: 'zone-2',
          name: 'Zone 2',
          description: 'Secondary monitoring zone',
          color: '#28a745',
          deviceCount: 0
        },
        {
          id: 'zone-3',
          name: 'Zone 3',
          description: 'Tertiary monitoring zone',
          color: '#ffc107',
          deviceCount: 0
        },
        {
          id: 'zone-4',
          name: 'Zone 4',
          description: 'Backup monitoring zone',
          color: '#dc3545',
          deviceCount: 0
        }
      ];

      const createdZones = await Zone.insertMany(defaultZones);

      console.log(`✅ Created ${createdZones.length} default zones`);

      res.status(201).json({
        success: true,
        message: 'Default zones initialized',
        zones: createdZones
      });
    } catch (error) {
      console.error('❌ Error initializing zones:', error);
      res.status(500).json({
        success: false,
        error: 'Failed to initialize zones',
        message: error.message
      });
    }
  }
}

module.exports = ZoneController;
