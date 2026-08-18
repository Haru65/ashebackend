/**
 * Test Email Script
 * Sends a test email to specified recipients
 * 
 * Usage: node send-test-email.js
 */

require('dotenv').config();
const EmailService = require('./services/emailService');

async function sendTestEmail() {
  const emailService = new EmailService();

  const recipients = [
    'mgmangesh2@gmail.com',
    'designsupport@ashecontrols.com'
  ];

  const emailContent = `
    <h2>Hello!</h2>
    <p>This is a test email from the ZEPTAC IoT Platform.</p>
    <p>If you received this email, the email configuration is working correctly.</p>
    <br/>
    <p><strong>Email Details:</strong></p>
    <ul>
      <li>Sent at: ${new Date().toLocaleString()}</li>
      <li>From: noreply@zeptac.com</li>
      <li>Provider: Resend</li>
    </ul>
    <br/>
    <p>Best regards,<br/>ZEPTAC IoT Platform Team</p>
  `;

  try {
    console.log('📧 Sending test emails via Resend...');
    console.log(`Recipients: ${recipients.join(', ')}`);
    
    const results = [];

    for (const recipient of recipients) {
      try {
        const result = await emailService.sendEmail({
          to: recipient,
          subject: 'Test Email from ZEPTAC IoT Platform',
          template: 'custom',
          data: {
            subject: 'Test Email from ZEPTAC IoT Platform',
            content: emailContent
          }
        });

        results.push({
          recipient,
          status: 'sent',
          messageId: result.messageId,
          provider: 'resend'
        });
      } catch (error) {
        results.push({
          recipient,
          status: 'failed',
          error: error.message,
          provider: 'resend'
        });
      }
    }

    console.log('\n✅ Email sending completed:\n');
    results.forEach((result, index) => {
      console.log(`[${index + 1}] ${result.recipient}`);
      console.log(`    Status: ${result.status}`);
      if (result.status === 'sent') {
        console.log(`    Message ID: ${result.messageId}`);
      } else if (result.status === 'failed') {
        console.log(`    Error: ${result.error}`);
      }
    });

  } catch (error) {
    console.error('❌ Error sending email:', error.message);
    process.exit(1);
  }
}

sendTestEmail();
