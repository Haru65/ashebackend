const EmailService = require('../services/emailService');
const Alarm = require('../models/Alarm');
const Telemetry = require('../models/telemetry');

class EmailController {
  constructor() {
    this.emailService = new EmailService();
  }

  /**
   * Send alarm email notification
   */
  async sendAlarmEmail(req, res) {
    try {
      const { alarmId, recipients, provider = 'gmail' } = req.body;

      if (!alarmId || !recipients || recipients.length === 0) {
        return res.status(400).json({
          success: false,
          message: 'Alarm ID and recipients are required'
        });
      }

      // Get alarm data (this should come from your alarm controller/service)
      const alarm = await this.getAlarmById(alarmId);
      if (!alarm) {
        return res.status(404).json({
          success: false,
          message: 'Alarm not found'
        });
      }

      const results = await this.emailService.sendAlarmEmail(alarm, recipients, provider);

      res.json({
        success: true,
        message: 'Alarm email notifications sent',
        data: results
      });

    } catch (error) {
      res.status(500).json({
        success: false,
        message: 'Error sending alarm email',
        error: error.message
      });
    }
  }

  /**
   * Send custom email
   */
  async sendCustomEmail(req, res) {
    try {
      const {
        recipients,
        subject,
        content,
        template = 'custom',
        provider = 'gmail',
        attachments = []
      } = req.body;

      if (!recipients || recipients.length === 0 || !subject || !content) {
        return res.status(400).json({
          success: false,
          message: 'Recipients, subject, and content are required'
        });
      }

      const results = await this.emailService.sendCustomEmail({
        recipients,
        subject,
        content,
        template,
        attachments
      }, provider);

      res.json({
        success: true,
        message: 'Custom emails sent successfully',
        data: results
      });

    } catch (error) {
      res.status(500).json({
        success: false,
        message: 'Error sending custom email',
        error: error.message
      });
    }
  }

  /**
   * Send bulk email campaign
   */
  async sendBulkEmail(req, res) {
    try {
      const {
        recipients,
        subject,
        content,
        template = 'custom',
        provider = 'gmail',
        batchSize = 50,
        delay = 1000
      } = req.body;

      if (!recipients || recipients.length === 0 || !subject || !content) {
        return res.status(400).json({
          success: false,
          message: 'Recipients, subject, and content are required'
        });
      }

      const results = await this.emailService.sendBulkEmail({
        recipients,
        subject,
        content,
        template,
        provider,
        batchSize,
        delay
      });

      res.json({
        success: true,
        message: 'Bulk email campaign completed',
        data: results
      });

    } catch (error) {
      res.status(500).json({
        success: false,
        message: 'Error sending bulk email',
        error: error.message
      });
    }
  }

  /**
   * Get email templates
   */
  async getEmailTemplates(req, res) {
    try {
      const templates = [
        {
          id: 'alarm',
          name: 'Alarm Notification',
          description: 'Template for alarm notifications',
          variables: ['alarmName', 'severityColor', 'content']
        },
        {
          id: 'maintenance',
          name: 'Maintenance Alert',
          description: 'Template for maintenance notifications',
          variables: ['deviceName', 'maintenanceType', 'scheduledDate']
        },
        {
          id: 'report',
          name: 'System Report',
          description: 'Template for system reports',
          variables: ['reportTitle', 'reportData', 'period']
        },
        {
          id: 'custom',
          name: 'Custom Template',
          description: 'Generic template for custom messages',
          variables: ['subject', 'content']
        }
      ];

      res.json({
        success: true,
        data: templates
      });

    } catch (error) {
      res.status(500).json({
        success: false,
        message: 'Error fetching email templates',
        error: error.message
      });
    }
  }

  /**
   * Test email configuration
   */
  async testEmailConfig(req, res) {
    try {
      const { provider = 'gmail' } = req.body;

      const result = await this.emailService.testEmailConfig(provider);

      res.json({
        success: result.success,
        message: result.message
      });

    } catch (error) {
      res.status(500).json({
        success: false,
        message: 'Error testing email configuration',
        error: error.message
      });
    }
  }

  /**
   * Get email provider status
   */
  async getProviderStatus(req, res) {
    try {
      if (!this.emailService) {
        return res.status(500).json({
          success: false,
          message: 'Email service not initialized'
        });
      }

      const status = this.emailService.getProviderStatus();

      res.json({
        success: true,
        data: status || {}
      });

    } catch (error) {
      console.error('Error fetching provider status:', error);
      res.status(500).json({
        success: false,
        message: 'Error fetching provider status',
        error: error.message
      });
    }
  }

  /**
   * Send test email
   */
  async sendTestEmail(req, res) {
    try {
      const { recipient, provider = 'gmail' } = req.body;

      if (!recipient) {
        return res.status(400).json({
          success: false,
          message: 'Recipient email is required'
        });
      }

      const testEmailData = {
        recipients: [recipient],
        subject: 'ZEPTAC IoT Platform - Test Email',
        content: `
          <h2>Email Configuration Test</h2>
          <p>This is a test email to verify your email configuration is working correctly.</p>
          <p><strong>Provider:</strong> ${provider}</p>
          <p><strong>Timestamp:</strong> ${new Date().toLocaleString()}</p>
          <p>If you received this email, your email configuration is working properly!</p>
        `,
        template: 'custom'
      };

      const results = await this.emailService.sendCustomEmail(testEmailData, provider);

      res.json({
        success: true,
        message: 'Test email sent successfully',
        data: results
      });

    } catch (error) {
      res.status(500).json({
        success: false,
        message: 'Error sending test email',
        error: error.message
      });
    }
  }

  /**
   * Get email statistics
   */
  async getEmailStats(req, res) {
    try {
      // This would typically come from a database
      const stats = {
        totalSent: 1250,
        totalFailed: 23,
        successRate: 98.16,
        lastSent: new Date().toISOString(),
        monthlyStats: [
          { month: 'Oct 2025', sent: 345, failed: 8 },
          { month: 'Sep 2025', sent: 298, failed: 5 },
          { month: 'Aug 2025', sent: 412, failed: 10 }
        ]
      };

      res.json({
        success: true,
        data: stats
      });

    } catch (error) {
      res.status(500).json({
        success: false,
        message: 'Error fetching email statistics',
        error: error.message
      });
    }
  }

  /**
   * Helper method to get alarm by ID with current telemetry data
   */
  async getAlarmById(alarmId) {
    try {
      // Fetch actual alarm from database
      const alarm = await Alarm.findById(alarmId).lean();
      
      if (!alarm) {
        console.warn(`Alarm with ID ${alarmId} not found`);
        return null;
      }

      // Fetch latest telemetry for this device to get current values
      const latestTelemetry = await Telemetry.findOne({
        deviceId: alarm.deviceId || alarm.device_name
      })
        .sort({ timestamp: -1 })
        .lean();

      // Merge telemetry data with alarm
      if (latestTelemetry && latestTelemetry.data) {
        // Convert Map to object if needed
        const telemetryData = latestTelemetry.data instanceof Map 
          ? Object.fromEntries(latestTelemetry.data)
          : latestTelemetry.data;
        
        // Add telemetry values to alarm object for email formatting
        alarm.telemetry_values = telemetryData;
        alarm.location = alarm.location || latestTelemetry.location;
        alarm.event = alarm.event || latestTelemetry.event;
      }

      return alarm;
    } catch (error) {
      console.error(`Error fetching alarm ${alarmId}:`, error);
      return null;
    }
  }
}

module.exports = new EmailController();