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

    const providers = ['gmail', 'outlook', 'smtp'];
    for (const provider of providers) {
      try {
        const result = await emailService.testEmailConfig(provider);
        if (result.success) {
          console.log(`✅ ${provider.toUpperCase()}: ${result.message}`);
        } else {
          console.log(`❌ ${provider.toUpperCase()}: ${result.message}`);
        }
      } catch (error) {
        console.log(`❌ ${provider.toUpperCase()}: ${error.message}`);
      }
    }

    // Check 4: Recommendations
    console.log('\n💡 Step 4: Recommendations');
    console.log('─'.repeat(50));

    const configuredProviders = Object.entries(status)
      .filter(([_, config]) => config.configured)
      .map(([provider, _]) => provider);

    if (configuredProviders.length === 0) {
      console.log('❌ NO EMAIL PROVIDERS CONFIGURED!');
      console.log('\n📌 To fix this on Render:');
      console.log('');
      console.log('Option 1: Using Gmail (Recommended)');
      console.log('   1. Go to https://myaccount.google.com/apppasswords');
      console.log('   2. Generate an app password');
      console.log('   3. Add to Render environment variables:');
      console.log('      GMAIL_USER=your.email@gmail.com');
      console.log('      GMAIL_APP_PASSWORD=generated_app_password');
      console.log('');
      console.log('Option 2: Using Custom SMTP');
      console.log('   1. Add to Render environment variables:');
      console.log('      SMTP_HOST=smtp.example.com');
      console.log('      SMTP_PORT=587');
      console.log('      SMTP_USER=your.email@example.com');
      console.log('      SMTP_PASSWORD=your_password');
      console.log('      SMTP_SECURE=false');
      console.log('');
    } else {
      console.log(`✅ Email service configured with: ${configuredProviders.join(', ').toUpperCase()}`);
      console.log('   Emails should send successfully!');
    }

    console.log('\n✅ === DIAGNOSTIC COMPLETE ===\n');

  } catch (error) {
    console.error('❌ Error during diagnostic:', error);
  }
}

// Run diagnostic
diagnoseEmailConfig().catch(console.error);
