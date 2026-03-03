# Migrate Backend from Render to Fastpanel with Nginx

## Overview
This guide covers migrating your Express.js backend from Render to Fastpanel, which uses Nginx as a reverse proxy.

---

## Pre-Migration Checklist

- [ ] Backup your current database and all data
- [ ] Test all functionality in production on Render first
- [ ] Have your Fastpanel access credentials ready
- [ ] Domain name pointing to Fastpanel nameservers
- [ ] SSL certificate ready (Fastpanel can auto-generate)
- [ ] All environment variables documented

---

## Step 1: Prepare Your Backend for Production

### 1.1 Update Environment Variables
Create production `.env` file on Fastpanel with these values:

```env
# ============================================
# Database Configuration
# ============================================
MONGODB_URI=mongodb+srv://<username>:<password>@cluster0.xxxxx.mongodb.net/zeptac_iot?retryWrites=true&w=majority

# ============================================
# Server Configuration
# ============================================
PORT=3001
NODE_ENV=production

# ============================================
# API Configuration
# ============================================
API_BASE_URL=https://your-domain.com
FRONTEND_URL=https://your-frontend-domain.com
CORS_ORIGIN=https://your-frontend-domain.com

# ============================================
# Authentication (CHANGE THESE!)
# ============================================
JWT_SECRET=your-very-secure-jwt-secret-min-32-chars
JWT_EXPIRE=7d
REFRESH_TOKEN_SECRET=your-very-secure-refresh-token-min-32-chars
REFRESH_TOKEN_EXPIRE=30d
BCRYPT_ROUNDS=10
SESSION_SECRET=your-session-secret-change-this

# ============================================
# MQTT Configuration
# ============================================
MQTT_BROKER_URL=mqtt://your-mqtt-server:1883
MQTT_USERNAME=your_username
MQTT_PASSWORD=your_password

# ============================================
# Device Management
# ============================================
DEVICE_STATUS_CHECK_INTERVAL=2
DEVICE_OFFLINE_THRESHOLD=5

# ============================================
# Email Configuration (for notifications)
# ============================================
SMTP_HOST=smtp.gmail.com
SMTP_PORT=587
SMTP_USER=your-email@gmail.com
SMTP_PASSWORD=your-app-password
SMTP_FROM=noreply@your-domain.com

# ============================================
# Twilio Configuration (if using SMS notifications)
# ============================================
TWILIO_ACCOUNT_SID=your_account_sid
TWILIO_AUTH_TOKEN=your_auth_token
TWILIO_PHONE_NUMBER=+1234567890
```

### 1.2 Verify package.json
Your current start script is already production-ready:
```json
"start": "node --max-old-space-size=4096 index.js"
```

---

## Step 2: Set Up Fastpanel Node.js Application

### 2.1 SSH into Your Fastpanel Server
```bash
ssh user@your-fastpanel-server.com
```

### 2.2 Navigate to Application Directory
```bash
cd /home/username/applications
```

### 2.3 Clone Your Repository
```bash
git clone https://github.com/Haru65/ZEPTAC-DEMO-BACKEND.git zeptac-backend
cd zeptac-backend/BACKEND
```

### 2.4 Install Dependencies
```bash
npm install --production
npm install pm2 -g
```

---

## Step 3: Set Up Process Manager (PM2)

PM2 keeps your Node.js app running and auto-restarts it on crashes.

### 3.1 Create PM2 Ecosystem Config
Create `ecosystem.config.js` in your backend root:

```javascript
module.exports = {
  apps: [{
    name: 'zeptac-backend',
    script: 'index.js',
    instances: 'max',
    exec_mode: 'cluster',
    env: {
      NODE_ENV: 'production',
      PORT: 3001
    },
    error_file: './logs/error.log',
    out_file: './logs/out.log',
    log_date_format: 'YYYY-MM-DD HH:mm:ss Z',
    merge_logs: true,
    autorestart: true,
    watch: false,
    max_memory_restart: '1G',
    node_args: '--max-old-space-size=4096'
  }]
};
```

### 3.2 Start Application with PM2
```bash
# Create logs directory
mkdir -p logs

# Start the app
pm2 start ecosystem.config.js

# Make it auto-start on server reboot
pm2 startup
pm2 save
```

### 3.3 Monitor Your Process
```bash
pm2 logs zeptac-backend
pm2 status
```

---

## Step 4: Configure Nginx Reverse Proxy

### 4.1 Create Nginx Configuration
Create `/etc/nginx/sites-available/zeptac-backend`:

```nginx
upstream zeptac_backend {
    server 127.0.0.1:3001;
    keepalive 64;
}

# Redirect HTTP to HTTPS
server {
    listen 80;
    listen [::]:80;
    server_name your-domain.com www.your-domain.com;

    # Allow Let's Encrypt verification
    location /.well-known/acme-challenge/ {
        root /var/www/certbot;
    }

    # Redirect all other traffic to HTTPS
    location / {
        return 301 https://$server_name$request_uri;
    }
}

# HTTPS Server Block
server {
    listen 443 ssl http2;
    listen [::]:443 ssl http2;
    server_name your-domain.com www.your-domain.com;

    # SSL Certificate (Use Fastpanel's auto-SSL or Let's Encrypt)
    ssl_certificate /path/to/your/certificate.crt;
    ssl_certificate_key /path/to/your/private.key;
    
    # SSL Configuration
    ssl_protocols TLSv1.2 TLSv1.3;
    ssl_ciphers HIGH:!aNULL:!MD5;
    ssl_prefer_server_ciphers on;
    ssl_session_cache shared:SSL:10m;
    ssl_session_timeout 10m;

    # Security Headers
    add_header Strict-Transport-Security "max-age=31536000; includeSubDomains" always;
    add_header X-Frame-Options "SAMEORIGIN" always;
    add_header X-Content-Type-Options "nosniff" always;
    add_header X-XSS-Protection "1; mode=block" always;

    # Logging
    access_log /var/log/nginx/zeptac-backend-access.log;
    error_log /var/log/nginx/zeptac-backend-error.log;

    # Gzip Compression
    gzip on;
    gzip_types text/plain text/css text/javascript application/json application/javascript;
    gzip_min_length 1000;

    # Proxy settings
    location / {
        proxy_pass http://zeptac_backend;
        proxy_http_version 1.1;
        
        # WebSocket support (for Socket.IO)
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection "upgrade";
        
        # Standard headers
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_set_header X-Forwarded-Host $server_name;
        
        # Timeouts (important for file exports)
        proxy_connect_timeout 90s;
        proxy_send_timeout 90s;
        proxy_read_timeout 90s;
        
        # Buffering
        proxy_buffering off;
        proxy_request_buffering off;
        
        # Keep-alive
        proxy_set_header Connection "";
        keepalive_timeout 65;
    }

    # Specific route optimizations
    location /api/export {
        proxy_pass http://zeptac_backend;
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        
        # Longer timeout for exports
        proxy_connect_timeout 120s;
        proxy_send_timeout 120s;
        proxy_read_timeout 120s;
        proxy_buffering off;
    }
}
```

### 4.2 Enable the Configuration
```bash
# Create symbolic link
sudo ln -s /etc/nginx/sites-available/zeptac-backend /etc/nginx/sites-enabled/

# Test Nginx configuration
sudo nginx -t

# Reload Nginx
sudo systemctl reload nginx
```

---

## Step 5: Set Up SSL Certificate

### Option A: Using Fastpanel's Auto-SSL (Recommended)
1. Go to Fastpanel Control Panel
2. Navigate to SSL Certificates
3. Click "Generate Auto SSL"
4. Select your domain
5. Auto SSL will auto-renew yearly

### Option B: Manual Let's Encrypt Setup
```bash
# Install Certbot
sudo apt-get install certbot python3-certbot-nginx

# Get certificate
sudo certbot certonly --webroot -w /var/www/certbot -d your-domain.com -d www.your-domain.com

# Update Nginx config with certificate paths (shown above)
# Test auto-renewal
sudo certbot renew --dry-run
```

---

## Step 6: Configure Firewall Rules

In Fastpanel's Firewall settings, allow:

```
Inbound:
- Port 80 (HTTP)
- Port 443 (HTTPS)
- Port 3001 (Node.js - optional, internal only)

Outbound:
- Port 27017 (MongoDB)
- Port 1883 (MQTT)
- Port 587 (SMTP Email)
- Port 443 (External APIs)
```

---

## Step 7: Database Configuration

### 7.1 MongoDB Atlas Connection (Recommended)
If not already setup, use MongoDB Atlas:

1. Go to https://www.mongodb.com/cloud/atlas
2. Create a cluster
3. Get connection string: `mongodb+srv://user:pass@cluster.mongodb.net/dbname`
4. Update `MONGODB_URI` in `.env`

### 7.2 Whitelist Fastpanel IP
In MongoDB Atlas:
- Network Access → IP Whitelist
- Add your Fastpanel server's IP

---

## Step 8: Environment & Application Setup

### 8.1 Upload Environment File
```bash
# SSH into Fastpanel, then:
nano ~/applications/zeptac-backend/BACKEND/.env

# Paste production environment variables (from Step 1.1)
# Save: Ctrl+O, Enter, Ctrl+X
```

### 8.2 Verify Application Start
```bash
cd ~/applications/zeptac-backend/BACKEND
npm start

# Should see: "Connected to MongoDB", "Server running on port 3001"
# Kill with Ctrl+C
```

### 8.3 Start with PM2
```bash
pm2 start ecosystem.config.js
pm2 save
```

---

## Step 9: Verify Everything Works

### 9.1 Test API Endpoint
```bash
curl https://your-domain.com/api/health
```

Expected response:
```json
{ "status": "ok" }
```

### 9.2 Check Logs
```bash
# PM2 logs
pm2 logs zeptac-backend

# Nginx logs
tail -f /var/log/nginx/zeptac-backend-access.log
tail -f /var/log/nginx/zeptac-backend-error.log
```

### 9.3 Frontend Connection
Update frontend `.env` to point to new backend:
```env
VITE_API_URL=https://your-domain.com
```

---

## Step 10: Monitor & Maintain

### 10.1 Add Monitoring (Optional)
```bash
# Install monitoring tools
pm2 install pm2-logrotate
pm2 install pm2-auto-pull  # Auto pulls latest from git

# Check system resources
pm2 monit
```

### 10.2 Regular Backups
```bash
# Schedule MongoDB backup daily
0 2 * * * mongodump --uri="mongodb+srv://..." --out=/backup/$(date +\%Y\%m\%d)
```

### 10.3 Log Rotation Setup
```bash
# Create log rotation config
sudo nano /etc/logrotate.d/zeptac

# Add:
/var/log/nginx/zeptac-backend-*.log {
    daily
    missingok
    rotate 14
    compress
    delaycompress
    notifempty
    create 640 www-data www-data
    sharedscripts
    postrotate
        systemctl reload nginx > /dev/null 2>&1 || true
    endscript
}
```

---

## Troubleshooting

### Issue: "Cannot connect to upstream"
1. Check PM2 is running: `pm2 status`
2. Verify port 3001: `netstat -tlnp | grep 3001`
3. Restart: `pm2 restart zeptac-backend`

### Issue: "504 Gateway Timeout" on file exports
1. Check Nginx timeout settings (see Step 4.1)
2. Increase Node.js memory: Check `ecosystem.config.js`
3. Monitor PM2: `pm2 logs`

### Issue: "CORS errors" from frontend
1. Check `FRONTEND_URL` in `.env` matches frontend domain
2. Verify CORS origin in `index.js`
3. Restart backend: `pm2 restart zeptac-backend`

### Issue: WebSocket connection fails
1. Verify Nginx has `proxy_set_header Upgrade $http_upgrade;` (see Step 4.1)
2. Check Socket.IO logs in PM2
3. Ensure `ws` and `wss` are allowed through firewall

### Issue: Database connection fails
1. Verify `MONGODB_URI` is correct
2. Check Fastpanel IP is whitelisted in MongoDB Atlas
3. Test connection: `mongo "mongodb+srv://..."`

---

## Rollback Plan

If issues occur, you can quickly switch back to Render:

1. Point domain DNS back to Render
2. Render frontend URL remains same
3. Disable Fastpanel deployment temporarily

---

## Performance Tips

1. **Enable HTTP/2**: Already configured in Nginx
2. **Use CDN**: CloudFlare for static assets
3. **Database Indexing**: Ensure MongoDB indexes are created
4. **Rate Limiting**: Already configured in Express
5. **Monitoring**: Use PM2 Plus for real-time monitoring

---

## Security Checklist

- [ ] Change all default secrets (JWT, session, etc.)
- [ ] Enable firewall rules
- [ ] Set up SSL certificate
- [ ] Configure CORS properly
- [ ] Add rate limiting headers
- [ ] Enable security headers in Nginx
- [ ] Regular backups enabled
- [ ] MongoDB user authentication set up
- [ ] MQTT broker secured (if applicable)
- [ ] Email credentials secure in `.env`

---

## Next Steps After Migration

1. **Verify all features work**: Test authentication, MQTT, email notifications
2. **Monitor performance**: Check PM2 and Nginx logs for errors
3. **Update documentation**: Update any DNS/API docs for team
4. **Celebrate**: Migration complete! 🎉

---

Need help? Check Fastpanel documentation: https://docs.fastpanel.direct/
