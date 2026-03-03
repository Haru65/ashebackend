# Production Environment Variables for Fastpanel Deployment

## How to Use This File
1. Copy all content below
2. Save as `.env` in your Fastpanel backend directory
3. Replace all placeholder values with your actual values
4. Restart PM2 to load new environment variables: `pm2 restart zeptac-backend`

---

# ============================================
# Database Configuration
# ============================================

## MongoDB Atlas (Recommended for Production)
# Get connection string from: https://www.mongodb.com/cloud/atlas
# Format: mongodb+srv://username:password@cluster.mongodb.net/dbname?retryWrites=true&w=majority
MONGODB_URI=mongodb+srv://username:password@cluster0.xxxxx.mongodb.net/zeptac_iot?retryWrites=true&w=majority
DB_CONNECTION_STRING=mongodb+srv://username:password@cluster0.xxxxx.mongodb.net/zeptac_iot?retryWrites=true&w=majority

## Alternative: Local MongoDB or Docker MongoDB
# MONGODB_URI=mongodb://username:password@mongodb-server:27017/zeptac_iot?authSource=admin
# DB_CONNECTION_STRING=mongodb://username:password@mongodb-server:27017/zeptac_iot?authSource=admin

---

# ============================================
# Server Configuration
# ============================================

PORT=3001
NODE_ENV=production

# API Configuration
API_BASE_URL=https://your-domain.com
FRONTEND_URL=https://your-frontend-domain.com
CORS_ORIGIN=https://your-frontend-domain.com

## If you have multiple frontend domains, separate with commas:
# CORS_ORIGIN=https://frontend.com,https://www.frontend.com,https://app.frontend.com

---

# ============================================
# Authentication & Security
# ============================================

## IMPORTANT: Change these BEFORE deploying!
## Use strong random strings (minimum 32 characters for JWT secrets)
## Generate with: openssl rand -base64 32

JWT_SECRET=your-very-secure-random-jwt-secret-minimum-32-characters-long
JWT_EXPIRE=7d

REFRESH_TOKEN_SECRET=your-very-secure-random-refresh-token-secret-minimum-32-chars
REFRESH_TOKEN_EXPIRE=30d

# Bcrypt rounds for password hashing
BCRYPT_ROUNDS=10

# Session secret for express-session
SESSION_SECRET=your-secure-session-secret-change-this-in-production

---

# ============================================
# MQTT Configuration
# ============================================

## Public MQTT broker (for testing only)
# MQTT_BROKER_URL=mqtt://test.mosquitto.org

## Production MQTT broker
MQTT_BROKER_URL=mqtt://your-mqtt-server.com:1883
MQTT_USERNAME=mqtt_user
MQTT_PASSWORD=mqtt_password

## If using MQTT over TLS/SSL
# MQTT_BROKER_URL=mqtts://your-mqtt-server.com:8883
# MQTT_TLS_CA=/path/to/ca.crt
# MQTT_TLS_CERT=/path/to/client.crt
# MQTT_TLS_KEY=/path/to/client.key

---

# ============================================
# Device Management
# ============================================

# Device status check interval (in minutes)
DEVICE_STATUS_CHECK_INTERVAL=2

# Device offline threshold (in minutes)
DEVICE_OFFLINE_THRESHOLD=5

# Device polling timeout (in seconds)
DEVICE_POLLING_TIMEOUT=30

---

# ============================================
# Email Configuration (for Notifications)
# ============================================

## Gmail with App Password (Recommended)
# 1. Enable 2FA on your Google account
# 2. Generate App Password: https://myaccount.google.com/apppasswords
# 3. Use the 16-character password below

SMTP_HOST=smtp.gmail.com
SMTP_PORT=587
SMTP_USER=your-email@gmail.com
SMTP_PASSWORD=your-app-password-16-chars
SMTP_FROM=noreply@your-domain.com
SMTP_SECURE=false

## Alternative: SendGrid
# SENDGRID_API_KEY=your-sendgrid-api-key
# SMTP_FROM=noreply@your-domain.com

## Alternative: Self-hosted SMTP
# SMTP_HOST=mail.your-domain.com
# SMTP_PORT=587
# SMTP_USER=your-username
# SMTP_PASSWORD=your-password
# SMTP_SECURE=true
# SMTP_FROM=noreply@your-domain.com

# Email settings
ADMIN_EMAIL=admin@your-domain.com
SUPPORT_EMAIL=support@your-domain.com

---

# ============================================
# Twilio Configuration (for SMS Notifications)
# ============================================

## Optional: Only needed if sending SMS alerts
# Get from: https://www.twilio.com/console

TWILIO_ACCOUNT_SID=your_account_sid_from_twilio
TWILIO_AUTH_TOKEN=your_auth_token_from_twilio
TWILIO_PHONE_NUMBER=+1234567890

---

# ============================================
# Logging Configuration
# ============================================

LOG_LEVEL=info
# Options: error, warn, info, debug, silly

# Log file locations (PM2 handles these, but can override)
LOG_DIR=./logs
LOG_FILE_NAME=app.log

---

# ============================================
# File Upload Configuration
# ============================================

MAX_UPLOAD_SIZE=52428800
# Size in bytes (50MB shown above)

UPLOAD_DIR=./uploads

---

# ============================================
# Notification Settings
# ============================================

# Enable/disable notification types
ENABLE_EMAIL_NOTIFICATIONS=true
ENABLE_SMS_NOTIFICATIONS=false
ENABLE_PUSH_NOTIFICATIONS=false

# Notification thresholds
ALARM_THRESHOLD_LEVEL=critical
ALERT_RETRY_ATTEMPTS=3
ALERT_RETRY_DELAY=60000

---

# ============================================
# Database Backup Configuration
# ============================================

# Backup frequency: daily, weekly, monthly
BACKUP_FREQUENCY=daily

# Backup time (24-hour format)
BACKUP_TIME=02:00

# Number of backups to keep
BACKUP_RETENTION_DAYS=30

---

# ============================================
# Monitoring & Analytics
# ============================================

## Optional: Sentry error tracking
# SENTRY_DSN=your-sentry-dsn

## Optional: DataDog APM
# DATADOG_ENABLED=false

## Optional: New Relic monitoring
# NEW_RELIC_ENABLED=false

---

# ============================================
# Feature Flags
# ============================================

# Enable/disable features
FEATURE_DEVICE_SPECIFIC_ALARMS=true
FEATURE_BULK_DEVICE_OPERATIONS=true
FEATURE_DATA_EXPORT=true
FEATURE_ADVANCED_ANALYTICS=true

---

# ============================================
# API Rate Limiting
# ============================================

# Requests per minute per IP
RATE_LIMIT_REQUESTS=100
RATE_LIMIT_WINDOW_MS=60000

---

# ============================================
# Cache Configuration
# ============================================

# Redis (optional, for session/cache management)
# REDIS_HOST=localhost
# REDIS_PORT=6379
# REDIS_PASSWORD=your-redis-password

---

# ============================================
# Third-party Integrations
# ============================================

## Optional: Weather API
# WEATHER_API_KEY=your-weather-api-key

## Optional: Maps API
# MAPS_API_KEY=your-maps-api-key

---

# ============================================
# Security Settings
# ============================================

# HTTPS only (enforce HTTPS for all cookies)
COOKIE_SECURE=true

# SameSite cookie policy
COOKIE_SAME_SITE=strict

# Session timeout (in milliseconds)
SESSION_TIMEOUT=3600000

# Token expiration
TOKEN_EXPIRATION=7200000

---

# ============================================
# Production Flags
# ============================================

# Only enable in production
IS_PRODUCTION=true

# Disable development features
DEBUG_MODE=false

# Enable cluster mode for PM2
CLUSTER_MODE=true

---

## ============================================
## CHECKLIST BEFORE DEPLOYMENT
## ============================================
## 
## - [ ] All placeholder values replaced with real values
## - [ ] Secure JWT secrets generated (minimum 32 chars)
## - [ ] CORS_ORIGIN matches your frontend domain
## - [ ] MongoDB connection string verified
## - [ ] SMTP credentials tested
## - [ ] MQTT broker connection tested (if applicable)
## - [ ] Twilio credentials verified (if using SMS)
## - [ ] API_BASE_URL points to production domain
## - [ ] DATABASE backups configured
## - [ ] All sensitive values secured (not in git)
## - [ ] Environment variables synced across all servers
## - [ ] PM2 restarted to load new variables
## - [ ] Logs checked for connection errors
##

---

## GENERATING SECURE SECRETS

# On your local machine or server, run:
openssl rand -base64 32    # For JWT_SECRET
openssl rand -base64 32    # For REFRESH_TOKEN_SECRET
openssl rand -base64 32    # For SESSION_SECRET

# You'll get output like:
# D7KmV9xB2nL/z4Q/mP9vZ5eY3kL7WnQ4S9tX1y0K2j4=

---

## TESTING ENVIRONMENT VARIABLES

# SSH into your server and test:
cd /home/username/applications/zeptac-backend/BACKEND

# Test MongoDB connection
node -e "const mongoose = require('mongoose'); mongoose.connect(process.env.MONGODB_URI).then(()=>console.log('✓ MongoDB connected'),err=>console.error('✗ Error:',err.message));"

# Test SMTP connection
node -e "const nodemailer = require('nodemailer'); const transporter = nodemailer.createTransport({host:process.env.SMTP_HOST, port:process.env.SMTP_PORT, auth:{user:process.env.SMTP_USER, pass:process.env.SMTP_PASSWORD}}); transporter.verify((err,valid)=>console.log(valid?'✓ SMTP connected':'✗ SMTP failed'));"

# Test MQTT connection
node -e "const mqtt = require('mqtt'); const client = mqtt.connect(process.env.MQTT_BROKER_URL); client.on('connect',()=>{console.log('✓ MQTT connected'); client.end();}); client.on('error',(err)=>console.log('✗ MQTT error:',err.message));"

---

## SECURITY BEST PRACTICES

1. Never commit .env to git
2. Use .env.example with placeholder values
3. Rotate secrets every 90 days
4. Use strong, random values
5. Different secrets for each environment
6. Use MongoDB Atlas IP whitelist
7. Enable HTTPS everywhere
8. Monitor access logs regularly
9. Set up alerts for failed authentication
10. Regular security audits

---

## NEED HELP?

- Fastpanel Docs: https://docs.fastpanel.direct/
- MongoDB Atlas: https://docs.atlas.mongodb.com/
- Node.js Env Guide: https://nodejs.org/en/docs/guides/nodejs-docker-webapp/
- Express Security: https://expressjs.com/en/advanced/best-practice-security.html
