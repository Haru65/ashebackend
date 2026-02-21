const nodemailer = require('nodemailer');
const fs = require('fs');
const path = require('path');

class EmailService {
  constructor() {
    // Initialize nodemailer transporters for different email providers
    this.transporters = {
      gmail: null,
      outlook: null,
      smtp: null
    };
    
    this.initializeTransporters();
    
    // Email templates storage
    this.templates = {
      alarm: this.loadTemplate('alarm'),
      maintenance: this.loadTemplate('maintenance'),
      report: this.loadTemplate('report'),
      custom: this.loadTemplate('custom')
    };
  }

  /**
   * Initialize email transporters for different providers
   */
  initializeTransporters() {
    // Gmail transporter
    // Support both GMAIL_PASSWORD and GMAIL_APP_PASSWORD (app password from https://myaccount.google.com/apppasswords)
    const gmailPassword = process.env.GMAIL_PASSWORD || process.env.GMAIL_APP_PASSWORD;
    if (process.env.GMAIL_USER && gmailPassword) {
      this.transporters.gmail = nodemailer.createTransport({
        service: 'gmail',
        auth: {
          user: process.env.GMAIL_USER,
          pass: gmailPassword
        }
      });
      console.log('✅ Gmail transporter initialized');
    } else {
      console.log('⚠️ Gmail transporter skipped - missing GMAIL_USER or GMAIL_PASSWORD/GMAIL_APP_PASSWORD');
    }

    // Outlook transporter
    if (process.env.OUTLOOK_USER && process.env.OUTLOOK_PASSWORD) {
      this.transporters.outlook = nodemailer.createTransport({
        service: 'hotmail',
        auth: {
          user: process.env.OUTLOOK_USER,
          pass: process.env.OUTLOOK_PASSWORD
        }
      });
    }

    // Generic SMTP transporter
    if (process.env.SMTP_HOST) {
      this.transporters.smtp = nodemailer.createTransport({
        host: process.env.SMTP_HOST,
        port: process.env.SMTP_PORT || 587,
        secure: process.env.SMTP_SECURE === 'true',
        auth: {
          user: process.env.SMTP_USER,
          pass: process.env.SMTP_PASSWORD
        }
      });
    }
  }

  /**
   * Load email templates
   */
  loadTemplate(templateName) {
    try {
      const templatePath = path.join(__dirname, '..', 'templates', 'email', `${templateName}.html`);
      if (fs.existsSync(templatePath)) {
        return fs.readFileSync(templatePath, 'utf8');
      }
    } catch (error) {
      console.warn(`Template ${templateName} not found, using default`);
    }
    return this.getDefaultTemplate(templateName);
  }

  /**
   * Get default email template
   */
  getDefaultTemplate(templateName) {
    const templates = {
      alarm: `
        <!DOCTYPE html>
        <html>
        <head>
          <style>
            body { font-family: Arial, sans-serif; margin: 0; padding: 20px; background-color: #f5f5f5; }
            .container { max-width: 600px; margin: 0 auto; background-color: white; border-radius: 8px; box-shadow: 0 2px 10px rgba(0,0,0,0.1); }
            .header { background-color: {{severityColor}}; color: white; padding: 20px; border-radius: 8px 8px 0 0; text-align: center; }
            .content { padding: 20px; }
            .alarm-details { background-color: #f8f9fa; padding: 15px; border-radius: 5px; margin: 15px 0; }
            .footer { background-color: #f8f9fa; padding: 15px; text-align: center; border-radius: 0 0 8px 8px; }
            .btn { background-color: #007bff; color: white; padding: 10px 20px; text-decoration: none; border-radius: 5px; display: inline-block; margin: 10px 0; }
          </style>
        </head>
        <body>
          <div class="container">
            <div class="header">
              <h1>🚨 ALARM NOTIFICATION</h1>
              <h2>{{alarmName}}</h2>
            </div>
            <div class="content">
              {{content}}
            </div>
            <div class="footer">
              <p><small>This is an automated message from ZEPTAC IoT Platform</small></p>
            </div>
          </div>
        </body>
        </html>
      `,
      custom: `
        <!DOCTYPE html>
        <html>
        <head>
          <style>
            body { font-family: Arial, sans-serif; margin: 0; padding: 20px; background-color: #f5f5f5; }
            .container { max-width: 600px; margin: 0 auto; background-color: white; border-radius: 8px; box-shadow: 0 2px 10px rgba(0,0,0,0.1); }
            .header { background-color: #007bff; color: white; padding: 20px; border-radius: 8px 8px 0 0; text-align: center; }
            .content { padding: 20px; }
            .footer { background-color: #f8f9fa; padding: 15px; text-align: center; border-radius: 0 0 8px 8px; }
          </style>
        </head>
        <body>
          <div class="container">
            <div class="header">
              <h1>{{subject}}</h1>
            </div>
            <div class="content">
              {{content}}
            </div>
            <div class="footer">
              <p><small>ZEPTAC IoT Platform</small></p>
            </div>
          </div>
        </body>
        </html>
      `
    };
    return templates[templateName] || templates.custom;
  }

  /**
   * Send alarm email notification
   */
  async sendAlarmEmail(alarm, recipients, provider = 'gmail') {
    const transporter = this.transporters[provider];
    if (!transporter) {
      throw new Error(`Email provider ${provider} not configured`);
    }

    const { subject, html } = this.formatAlarmEmail(alarm);
    const results = [];

    for (const recipient of recipients) {
      try {
        const result = await transporter.sendMail({
          from: this.getFromAddress(provider),
          to: recipient,
          subject: subject,
          html: html
        });
        results.push({
          recipient,
          status: 'sent',
          messageId: result.messageId,
          provider
        });
      } catch (error) {
        results.push({
          recipient,
          status: 'failed',
          error: error.message,
          provider
        });
      }
    }

    return results;
  }

  /**
   * Send custom email
   */
  async sendCustomEmail(emailData, provider = 'gmail') {
    const transporter = this.transporters[provider];
    if (!transporter) {
      throw new Error(`Email provider ${provider} not configured`);
    }

    const {
      recipients,
      subject,
      content,
      template = 'custom',
      attachments = []
    } = emailData;

    const html = this.processTemplate(template, {
      subject,
      content
    });

    const results = [];

    for (const recipient of recipients) {
      try {
        const mailOptions = {
          from: this.getFromAddress(provider),
          to: recipient,
          subject: subject,
          html: html
        };

        if (attachments.length > 0) {
          mailOptions.attachments = attachments;
        }

        const result = await transporter.sendMail(mailOptions);
        results.push({
          recipient,
          status: 'sent',
          messageId: result.messageId,
          provider
        });
      } catch (error) {
        results.push({
          recipient,
          status: 'failed',
          error: error.message,
          provider
        });
      }
    }

    return results;
  }

  /**
   * Send bulk email campaign
   */
  async sendBulkEmail(campaignData) {
    const {
      recipients,
      subject,
      content,
      template = 'custom',
      provider = 'gmail',
      batchSize = 50,
      delay = 1000
    } = campaignData;

    const results = [];
    const batches = this.chunkArray(recipients, batchSize);

    for (let i = 0; i < batches.length; i++) {
      const batch = batches[i];
      console.log(`Sending batch ${i + 1} of ${batches.length}...`);

      const batchResults = await this.sendCustomEmail({
        recipients: batch,
        subject,
        content,
        template
      }, provider);

      results.push(...batchResults);

      // Add delay between batches to avoid rate limiting
      if (i < batches.length - 1) {
        await this.sleep(delay);
      }
    }

    return {
      totalSent: results.filter(r => r.status === 'sent').length,
      totalFailed: results.filter(r => r.status === 'failed').length,
      results
    };
  }

  /**
   * Format alarm email
   */
  formatAlarmEmail(alarm) {
    const timestamp = new Date().toLocaleString();
    const severityColor = this.getSeverityColor(alarm.severity);
    
    const subject = `🚨 ${alarm.severity.toUpperCase()} ALARM: ${alarm.name} - ${alarm.unit_no || alarm.device_name}`;
    
    // Use telemetry values for current readings, fall back to device_params or empty
    const telemetryData = alarm.telemetry_values || alarm.device_params || {};
    
    // Helper function to safely get telemetry value with multiple possible field names
    const getTelemetryValue = (fieldNames) => {
      if (Array.isArray(fieldNames)) {
        for (const field of fieldNames) {
          if (telemetryData[field] !== undefined && telemetryData[field] !== null) {
            return telemetryData[field];
          }
        }
      }
      return 'N/A';
    };

    const parametersTableHTML = `
      <h3>Device Parameters & Telemetry Values:</h3>
      <table style="width: 100%; border-collapse: collapse; margin: 15px 0;">
        <thead>
          <tr style="background-color: #f8f9fa; border-bottom: 2px solid #dee2e6;">
            <th style="padding: 10px; text-align: left; border: 1px solid #dee2e6;">Parameter</th>
            <th style="padding: 10px; text-align: center; border: 1px solid #dee2e6;">Current Value</th>
          </tr>
        </thead>
        <tbody>
          <tr style="border-bottom: 1px solid #dee2e6; background-color: #ffe6e6;">
            <td style="padding: 10px; border: 1px solid #dee2e6;"><strong>🔴 REF1 Status</strong></td>
            <td style="padding: 10px; text-align: center; border: 1px solid #dee2e6; font-weight: bold;">${getTelemetryValue(['REF1 STS', 'ref1_sts', 'REF1_STS'])}</td>
          </tr>
          <tr style="border-bottom: 1px solid #dee2e6; background-color: #ffe6e6;">
            <td style="padding: 10px; border: 1px solid #dee2e6;"><strong>🔴 REF2 Status</strong></td>
            <td style="padding: 10px; text-align: center; border: 1px solid #dee2e6; font-weight: bold;">${getTelemetryValue(['REF2 STS', 'ref2_sts', 'REF2_STS'])}</td>
          </tr>
          <tr style="border-bottom: 1px solid #dee2e6; background-color: #ffe6e6;">
            <td style="padding: 10px; border: 1px solid #dee2e6;"><strong>🔴 REF3 Status</strong></td>
            <td style="padding: 10px; text-align: center; border: 1px solid #dee2e6; font-weight: bold;">${getTelemetryValue(['REF3 STS', 'ref3_sts', 'REF3_STS'])}</td>
          </tr>
          <tr style="border-bottom: 1px solid #dee2e6;">
            <td style="padding: 10px; border: 1px solid #dee2e6;"><strong>REF1 (Measurement)</strong></td>
            <td style="padding: 10px; text-align: center; border: 1px solid #dee2e6;">${getTelemetryValue(['REF1', 'ref1', 'REF_1'])}</td>
          </tr>
          <tr style="border-bottom: 1px solid #dee2e6;">
            <td style="padding: 10px; border: 1px solid #dee2e6;"><strong>REF2 (Measurement)</strong></td>
            <td style="padding: 10px; text-align: center; border: 1px solid #dee2e6;">${getTelemetryValue(['REF2', 'ref2', 'REF_2'])}</td>
          </tr>
          <tr style="border-bottom: 1px solid #dee2e6;">
            <td style="padding: 10px; border: 1px solid #dee2e6;"><strong>REF3 (Measurement)</strong></td>
            <td style="padding: 10px; text-align: center; border: 1px solid #dee2e6;">${getTelemetryValue(['REF3', 'ref3', 'REF_3'])}</td>
          </tr>
          <tr style="border-bottom: 1px solid #dee2e6;">
            <td style="padding: 10px; border: 1px solid #dee2e6;"><strong>DCV (DC Voltage)</strong></td>
            <td style="padding: 10px; text-align: center; border: 1px solid #dee2e6;">${getTelemetryValue(['dcv', 'DCV'])}</td>
          </tr>
          <tr style="border-bottom: 1px solid #dee2e6;">
            <td style="padding: 10px; border: 1px solid #dee2e6;"><strong>DCI (DC Current)</strong></td>
            <td style="padding: 10px; text-align: center; border: 1px solid #dee2e6;">${getTelemetryValue(['dci', 'DCI'])}</td>
          </tr>
          <tr style="border-bottom: 1px solid #dee2e6;">
            <td style="padding: 10px; border: 1px solid #dee2e6;"><strong>ACV (AC Voltage)</strong></td>
            <td style="padding: 10px; text-align: center; border: 1px solid #dee2e6;">${getTelemetryValue(['acv', 'ACV'])}</td>
          </tr>
          <tr style="border-bottom: 1px solid #dee2e6;">
            <td style="padding: 10px; border: 1px solid #dee2e6;"><strong>ACI (AC Current)</strong></td>
            <td style="padding: 10px; text-align: center; border: 1px solid #dee2e6;">${getTelemetryValue(['aci', 'ACI'])}</td>
          </tr>
          <tr style="border-bottom: 1px solid #dee2e6;">
            <td style="padding: 10px; border: 1px solid #dee2e6;"><strong>Digital Input 1</strong></td>
            <td style="padding: 10px; text-align: center; border: 1px solid #dee2e6;">${getTelemetryValue(['di1', 'DI1'])}</td>
          </tr>
          <tr style="border-bottom: 1px solid #dee2e6;">
            <td style="padding: 10px; border: 1px solid #dee2e6;"><strong>Digital Input 2</strong></td>
            <td style="padding: 10px; text-align: center; border: 1px solid #dee2e6;">${getTelemetryValue(['di2', 'DI2'])}</td>
          </tr>
          <tr style="border-bottom: 1px solid #dee2e6;">
            <td style="padding: 10px; border: 1px solid #dee2e6;"><strong>Digital Input 3</strong></td>
            <td style="padding: 10px; text-align: center; border: 1px solid #dee2e6;">${getTelemetryValue(['di3', 'DI3'])}</td>
          </tr>
          <tr style="border-bottom: 1px solid #dee2e6;">
            <td style="padding: 10px; border: 1px solid #dee2e6;"><strong>Digital Input 4</strong></td>
            <td style="padding: 10px; text-align: center; border: 1px solid #dee2e6;">${getTelemetryValue(['di4', 'DI4'])}</td>
          </tr>
          <tr style="border-bottom: 1px solid #dee2e6;">
            <td style="padding: 10px; border: 1px solid #dee2e6;"><strong>Digital Output</strong></td>
            <td style="padding: 10px; text-align: center; border: 1px solid #dee2e6;">${getTelemetryValue(['do1', 'DO1', 'dpo', 'DPO'])}</td>
          </tr>
          ${telemetryData.event ? `<tr style="border-bottom: 1px solid #dee2e6;">
            <td style="padding: 10px; border: 1px solid #dee2e6;"><strong>Event Type</strong></td>
            <td style="padding: 10px; text-align: center; border: 1px solid #dee2e6;">${telemetryData.event}</td>
          </tr>` : ''}
          ${telemetryData.mode ? `<tr style="border-bottom: 1px solid #dee2e6;">
            <td style="padding: 10px; border: 1px solid #dee2e6;"><strong>Device Mode</strong></td>
            <td style="padding: 10px; text-align: center; border: 1px solid #dee2e6;">${telemetryData.mode}</td>
          </tr>` : ''}
        </tbody>
      </table>
    `;
    
    const content = `
      <div class="alarm-details">
        <h3>Alarm Details</h3>
        <p><strong>Unit Number:</strong> ${alarm.unit_no || alarm.deviceId || 'N/A'}</p>
        <p><strong>Location:</strong> ${alarm.location || 'N/A'}</p>
        <p><strong>Date & Time:</strong> ${timestamp}</p>
        <p><strong>Alarm Type:</strong> ${alarm.alarm_type || alarm.name}</p>
        <p><strong>Device:</strong> ${alarm.device_name}</p>
        <p><strong>Parameter:</strong> ${alarm.parameter || 'N/A'}</p>
        <p><strong>Severity:</strong> <span style="color: ${severityColor}; font-weight: bold;">${alarm.severity.toUpperCase()}</span></p>
      </div>
      
      <div style="background-color: #ffe6e6; padding: 15px; border-radius: 5px; margin: 15px 0; border-left: 4px solid #dc3545;">
        <h3 style="margin-top: 0; color: #dc3545;">🔴 Alarm Source Detection</h3>
        <p style="margin: 5px 0;"><strong>REF1 Status:</strong> ${getTelemetryValue(['REF1 STS', 'ref1_sts', 'REF1_STS'])} (Values: OP=Operating, UP=Up, FAIL=Failed)</p>
        <p style="margin: 5px 0;"><strong>REF2 Status:</strong> ${getTelemetryValue(['REF2 STS', 'ref2_sts', 'REF2_STS'])} (Values: OP=Operating, UP=Up, FAIL=Failed)</p>
        <p style="margin: 5px 0;"><strong>REF3 Status:</strong> ${getTelemetryValue(['REF3 STS', 'ref3_sts', 'REF3_STS'])} (Values: OP=Operating, UP=Up, FAIL=Failed)</p>
        <p style="margin: 5px 0; font-size: 12px; color: #666;"><em>Note: Any REF Status showing OP, UP, or FAIL will trigger alarm (Priority Check 0)</em></p>
      </div>
      
      ${parametersTableHTML}
      
      <div style="text-align: center;">
        <a href="${process.env.FRONTEND_URL}${alarm.link || ''}" class="btn">View Device Details</a>
      </div>
    `;

    const html = this.processTemplate('alarm', {
      alarmName: alarm.name,
      severityColor,
      content
    });

    return { subject, html };
  }

  /**
   * Process template with variables
   */
  processTemplate(templateName, variables) {
    let template = this.templates[templateName];
    
    for (const [key, value] of Object.entries(variables)) {
      const regex = new RegExp(`{{${key}}}`, 'g');
      template = template.replace(regex, value);
    }
    
    return template;
  }

  /**
   * Get from address based on provider
   */
  getFromAddress(provider) {
    const addresses = {
      gmail: process.env.GMAIL_USER || 'noreply@zeptac.com',
      outlook: process.env.OUTLOOK_USER || 'noreply@zeptac.com',
      smtp: process.env.SMTP_FROM || 'noreply@zeptac.com'
    };
    return addresses[provider] || 'noreply@zeptac.com';
  }

  /**
   * Get severity color
   */
  getSeverityColor(severity) {
    const colors = {
      critical: '#dc3545',
      warning: '#ffc107',
      info: '#17a2b8',
      ok: '#28a745',
      battery: '#007bff'
    };
    return colors[severity] || '#6c757d';
  }

  /**
   * Chunk array into smaller arrays
   */
  chunkArray(array, chunkSize) {
    const chunks = [];
    for (let i = 0; i < array.length; i += chunkSize) {
      chunks.push(array.slice(i, i + chunkSize));
    }
    return chunks;
  }

  /**
   * Sleep for specified milliseconds
   */
  sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  /**
   * Test email configuration
   */
  async testEmailConfig(provider = 'gmail') {
    const transporter = this.transporters[provider];
    if (!transporter) {
      throw new Error(`Email provider ${provider} not configured`);
    }

    try {
      await transporter.verify();
      return { success: true, message: `${provider} configuration is valid` };
    } catch (error) {
      return { success: false, message: error.message };
    }
  }

  /**
   * Get email provider status
   */
  getProviderStatus() {
    try {
      const status = {};
      
      if (!this.transporters || typeof this.transporters !== 'object') {
        console.warn('Transporters not initialized properly');
        return {
          gmail: { configured: false, ready: false },
          outlook: { configured: false, ready: false },
          smtp: { configured: false, ready: false }
        };
      }

      for (const [provider, transporter] of Object.entries(this.transporters)) {
        status[provider] = {
          configured: transporter !== null && transporter !== undefined,
          ready: false
        };
      }
      
      return status;
    } catch (error) {
      console.error('Error getting provider status:', error);
      return {
        gmail: { configured: false, ready: false },
        outlook: { configured: false, ready: false },
        smtp: { configured: false, ready: false }
      };
    }
  }

  /**
   * Generic send email method - handles both custom emails and alarm emails
   * @param {Object} options - Email options
   * @param {String} options.to - Recipient email
   * @param {String} options.subject - Email subject
   * @param {String} options.template - Template name ('alarm', 'custom', etc.)
   * @param {Object} options.data - Template data
   * @param {String} options.provider - Email provider to use (default: 'gmail')
   */
  async sendEmail(options) {
    try {
      const { to, subject, template, data, provider = 'gmail' } = options;

      if (!to) {
        throw new Error('Recipient email address is required');
      }

      const transporter = this.transporters[provider];
      if (!transporter) {
        throw new Error(`Email provider '${provider}' is not configured`);
      }

      // Generate email content from template
      let htmlContent = '';
      if (template === 'alarm') {
        htmlContent = this.formatAlarmEmailContent(data);
      } else {
        htmlContent = this.processTemplate(template || 'custom', data);
      }

      // Send email
      const result = await transporter.sendMail({
        from: process.env.EMAIL_FROM || process.env.GMAIL_USER,
        to: to,
        subject: subject,
        html: htmlContent
      });

      console.log(`[Email Service] ✅ Email sent successfully to ${to}`);
      return { success: true, messageId: result.messageId };
    } catch (error) {
      console.error('[Email Service] ❌ Failed to send email:', error.message);
      throw error;
    }
  }

  /**
   * Format alarm email content
   */
  formatAlarmEmailContent(alarmData) {
    if (!alarmData) return '<p>Alarm triggered</p>';

    return `
      <html>
        <body style="font-family: Arial, sans-serif; color: #333;">
          <div style="border-left: 4px solid #dc3545; padding: 20px; background-color: #f8f9fa;">
            <h2 style="color: #dc3545; margin-top: 0;">🚨 ALARM TRIGGERED</h2>
            
            <p><strong>Alarm Name:</strong> ${alarmData.alarmName || 'Unknown'}</p>
            <p><strong>Device:</strong> ${alarmData.deviceName || 'Unknown'}</p>
            <p><strong>Parameter:</strong> ${alarmData.parameter || 'N/A'}</p>
            <p><strong>Severity:</strong> <span style="color: #dc3545; font-weight: bold;">${alarmData.severity || 'Unknown'}</span></p>
            <p><strong>Timestamp:</strong> ${alarmData.timestamp || new Date().toLocaleString()}</p>
            
            <h3>Reason:</h3>
            <p>${alarmData.reason || 'No reason provided'}</p>
            
            ${alarmData.device_params ? `
            <h3>Device Parameters & Telemetry Values:</h3>
            <table style="border-collapse: collapse; width: 100%; margin-top: 10px;">
              <tr style="background-color: #e9ecef;">
                <th style="border: 1px solid #ddd; padding: 8px; text-align: left;">Parameter</th>
                <th style="border: 1px solid #ddd; padding: 8px; text-align: left;">Current Value</th>
                <th style="border: 1px solid #ddd; padding: 8px; text-align: left;">Unit</th>
              </tr>
              <tr>
                <td style="border: 1px solid #ddd; padding: 8px;"><strong>DCV (DC Voltage)</strong></td>
                <td style="border: 1px solid #ddd; padding: 8px;">${alarmData.device_params.dcv || 'N/A'}</td>
                <td style="border: 1px solid #ddd; padding: 8px;">Volts</td>
              </tr>
              <tr style="background-color: #f9f9f9;">
                <td style="border: 1px solid #ddd; padding: 8px;"><strong>DCI (DC Current)</strong></td>
                <td style="border: 1px solid #ddd; padding: 8px;">${alarmData.device_params.dci || 'N/A'}</td>
                <td style="border: 1px solid #ddd; padding: 8px;">Amperes</td>
              </tr>
              <tr>
                <td style="border: 1px solid #ddd; padding: 8px;"><strong>ACV (AC Voltage)</strong></td>
                <td style="border: 1px solid #ddd; padding: 8px;">${alarmData.device_params.acv || 'N/A'}</td>
                <td style="border: 1px solid #ddd; padding: 8px;">Volts</td>
              </tr>
              <tr style="background-color: #f9f9f9;">
                <td style="border: 1px solid #ddd; padding: 8px;"><strong>ACI (AC Current)</strong></td>
                <td style="border: 1px solid #ddd; padding: 8px;">${alarmData.device_params.aci || 'N/A'}</td>
                <td style="border: 1px solid #ddd; padding: 8px;">Amperes</td>
              </tr>
              <tr style="background-color: #fff3cd;">
                <td style="border: 1px solid #ddd; padding: 8px;"><strong>REF1 (Reference 1)</strong></td>
                <td style="border: 1px solid #ddd; padding: 8px;">${alarmData.device_params.ref_1 || alarmData.device_params.ref1 || 'N/A'}</td>
                <td style="border: 1px solid #ddd; padding: 8px;">Threshold</td>
              </tr>
              <tr style="background-color: #f9f9f9;">
                <td style="border: 1px solid #ddd; padding: 8px;"><strong>REF2 (Reference 2)</strong></td>
                <td style="border: 1px solid #ddd; padding: 8px;">${alarmData.device_params.ref_2 || alarmData.device_params.ref2 || 'N/A'}</td>
                <td style="border: 1px solid #ddd; padding: 8px;">Threshold</td>
              </tr>
              <tr>
                <td style="border: 1px solid #ddd; padding: 8px;"><strong>REF3 (Reference 3)</strong></td>
                <td style="border: 1px solid #ddd; padding: 8px;">${alarmData.device_params.ref_3 || alarmData.device_params.ref3 || 'N/A'}</td>
                <td style="border: 1px solid #ddd; padding: 8px;">Threshold</td>
              </tr>
              <tr style="background-color: #f9f9f9;">
                <td style="border: 1px solid #ddd; padding: 8px;"><strong>Digital Input 1</strong></td>
                <td style="border: 1px solid #ddd; padding: 8px;">${alarmData.device_params.di1 || alarmData.device_params.DI1 || 'N/A'}</td>
                <td style="border: 1px solid #ddd; padding: 8px;">OPEN/CLOSE</td>
              </tr>
              <tr>
                <td style="border: 1px solid #ddd; padding: 8px;"><strong>Digital Input 2</strong></td>
                <td style="border: 1px solid #ddd; padding: 8px;">${alarmData.device_params.di2 || alarmData.device_params.DI2 || 'N/A'}</td>
                <td style="border: 1px solid #ddd; padding: 8px;">OPEN/CLOSE</td>
              </tr>
              <tr style="background-color: #f9f9f9;">
                <td style="border: 1px solid #ddd; padding: 8px;"><strong>Digital Input 3</strong></td>
                <td style="border: 1px solid #ddd; padding: 8px;">${alarmData.device_params.di3 || alarmData.device_params.DI3 || 'N/A'}</td>
                <td style="border: 1px solid #ddd; padding: 8px;">OPEN/CLOSE</td>
              </tr>
              <tr>
                <td style="border: 1px solid #ddd; padding: 8px;"><strong>Digital Input 4</strong></td>
                <td style="border: 1px solid #ddd; padding: 8px;">${alarmData.device_params.di4 || alarmData.device_params.DI4 || 'N/A'}</td>
                <td style="border: 1px solid #ddd; padding: 8px;">OPEN/CLOSE</td>
              </tr>
              <tr style="background-color: #f9f9f9;">
                <td style="border: 1px solid #ddd; padding: 8px;"><strong>Digital Output</strong></td>
                <td style="border: 1px solid #ddd; padding: 8px;">${alarmData.device_params.do1 || alarmData.device_params.DO1 || 'N/A'}</td>
                <td style="border: 1px solid #ddd; padding: 8px;">ON/OFF</td>
              </tr>
              ${alarmData.device_params.event || alarmData.device_params.EVENT ? `<tr>
                <td style="border: 1px solid #ddd; padding: 8px;"><strong>Event Type</strong></td>
                <td style="border: 1px solid #ddd; padding: 8px;">${alarmData.device_params.event || alarmData.device_params.EVENT || 'N/A'}</td>
                <td style="border: 1px solid #ddd; padding: 8px;">Status</td>
              </tr>` : ''}
              ${alarmData.device_params.mode || alarmData.device_params.MODE ? `<tr style="background-color: #f9f9f9;">
                <td style="border: 1px solid #ddd; padding: 8px;"><strong>Device Mode</strong></td>
                <td style="border: 1px solid #ddd; padding: 8px;">${alarmData.device_params.mode || alarmData.device_params.MODE || 'N/A'}</td>
                <td style="border: 1px solid #ddd; padding: 8px;">Configuration</td>
              </tr>` : ''}
            </table>
            ` : ''}
          </div>
        </body>
      </html>
    `;
  }
}

module.exports = EmailService;