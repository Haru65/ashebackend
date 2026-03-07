#!/usr/bin/env node

/**
 * Email Configuration Diagnostic Tool
 * Checks if email service is properly configured
 * 
 * Usage: node test-email-config.js
 */

require('dotenv').config();
const EmailService = require('./services/emailService');

async function diagnoseEmailConfig() {
  console.log('\n🔍 === EMAIL CONFIGURATION DIAGNOSTIC ===\n');

  // Check 1: Environment Variables
  console.log('📋 Step 1: Checking Environment Variables');
  console.log('─'.repeat(50));
  
  const emailVars = {
    'GMAIL_USER': process.env.GMAIL_USER,
    'GMAIL_PASSWORD': process.env.GMAIL_PASSWORD ? '***SET***' : '❌ NOT SET',
    'GMAIL_APP_PASSWORD': process.env.GMAIL_APP_PASSWORD ? '***SET***' : '❌ NOT SET',
    'OUTLOOK_USER': process.env.OUTLOOK_USER,
    'OUTLOOK_PASSWORD': process.env.OUTLOOK_PASSWORD ? '***SET***' : '❌ NOT SET',
    'SMTP_HOST': process.env.SMTP_HOST,
    'SMTP_PORT': process.env.SMTP_PORT,
    'SMTP_USER': process.env.SMTP_USER,
    'SMTP_PASSWORD': process.env.SMTP_PASSWORD ? '***SET***' : '❌ NOT SET',
    'RESEND_API_KEY': process.env.RESEND_API_KEY || process.env.resend_api ? '***SET***' : '❌ NOT SET',
    'EMAIL_FROM': process.env.EMAIL_FROM
  };

  Object.entries(emailVars).forEach(([key, value]) => {
    const status = value ? (typeof value === 'string' && value.includes('***') ? '✅' : '✅') : '❌';
    console.log(`${status} ${key}: ${value || '(not set)'}`);
  });

  // Check 2: Email Service Initialization
  console.log('\n📧 Step 2: Email Service Initialization');
  console.log('─'.repeat(50));
  
  try {
    const emailService = new EmailService();
    const status = emailService.getProviderStatus();
    
    console.log('\nProvider Status:');
    Object.entries(status).forEach(([provider, config]) => {
      const icon = config.configured ? '✅' : '❌';
      console.log(`${icon} ${provider.toUpperCase()}: ${config.configured ? 'READY' : 'NOT CONFIGURED'}`);
    });

    // Check 3: Try to verify each transporter
    console.log('\n🔗 Step 3: Testing Email Providers');
    console.log('─'.repeat(50));

    // Resend-only mode: skip verification on other providers
    if (status.resend && status.resend.configured) {
      console.log('\n📨 Testing Resend email send (this may take up to 10 seconds)...');
      try {
        const testEmail = await emailService.sendEmail({
          to: process.env.EMAIL_FROM || 'test@example.com',
          subject: '✅ ZEPTAC Email Service Test (Resend)',
          template: 'custom',
          data: { message: 'If you received this email, the Resend email service is working correctly!' }
        });

        if (testEmail && testEmail.success) {
          console.log(`✅ TEST EMAIL SENT SUCCESSFULLY VIA RESEND!`);
          console.log(`   Message ID: ${testEmail.messageId}`);
          console.log(`   Check your inbox for confirmation`);
        } else {
          console.log(`⚠️  TEST EMAIL SEND ATTEMPT FAILED`);
        }
      } catch (error) {
        console.log(`⚠️  Email send test: ${error.message}`);
      }
    } else {
      console.log('❌ Resend is NOT configured - cannot test');
    }

    // Check 4: Recommendations
    console.log('\n💡 Step 4: Recommendations');
    console.log('─'.repeat(50));

    if (!status.resend || !status.resend.configured) {
      console.log('❌ RESEND EMAIL API NOT CONFIGURED!');
      console.log('\n📌 To set up Resend:');
      console.log('');
      console.log('1. Go to https://resend.com');
      console.log('2. Create an account and get your API key');
      console.log('3. Add to your .env file:');
      console.log('   RESEND_API_KEY=your_api_key_here');
      console.log('   or');
      console.log('   resend_api=your_api_key_here');
      console.log('');
    } else {
      console.log(`✅ Email service configured with Resend API (PRIMARY)`);;
      console.log('');
      console.log('🚀 RESEND IS THE ACTIVE EMAIL PROVIDER');
      console.log('   All alarm notifications will be sent via Resend');
      console.log('   No Gmail SMTP configuration needed');
      console.log('');
      console.log('✅ System is ready to send emails!');
    }

    console.log('\n✅ === DIAGNOSTIC COMPLETE ===\n');

  } catch (error) {
    console.error('❌ Error during diagnostic:', error);
  }
}

// Run diagnostic
diagnoseEmailConfig().catch(console.error);
