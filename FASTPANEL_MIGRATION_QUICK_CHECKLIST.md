# Fastpanel Migration - Quick Start Checklist

## Pre-Migration (Do Before Moving)
- [ ] Backup current MongoDB at Render
- [ ] Test all backend features on Render
- [ ] Document all environment variables from Render dashboard
- [ ] Get Fastpanel login credentials

## Day 1: Prepare Fastpanel Server

### SSH Access
- [ ] SSH into Fastpanel: `ssh user@fastpanel-server.com`
- [ ] Create application directory: `mkdir -p /home/username/applications/zeptac-backend`

### Clone & Setup
```bash
cd /home/username/applications
git clone https://github.com/Haru65/ZEPTAC-DEMO-BACKEND.git zeptac-backend
cd zeptac-backend/BACKEND
npm install --production
npm install pm2 -g
```

## Day 2: Environment & Database

### 1. Create Production .env
```bash
nano /home/username/applications/zeptac-backend/BACKEND/.env
# Copy all vars from FASTPANEL_MIGRATION_GUIDE.md Step 1.1
# Update MONGODB_URI, JWT_SECRET, emails, API URLs
```

### 2. Verify Database Access
```bash
# Test MongoDB connection (install mongo shell if needed)
mongosh "your-mongodb-uri"
# Should connect without errors
```

### 3. Test Application
```bash
cd /home/username/applications/zeptac-backend/BACKEND
npm start
# Wait for "Server running on port 3001"
# Ctrl+C to exit
```

## Day 3: PM2 & Process Management

### 1. Copy PM2 Config
```bash
# File should already be at: /home/username/applications/zeptac-backend/BACKEND/ecosystem.config.js
# If not, copy from locally
```

### 2. Create Logs Directory
```bash
mkdir -p /home/username/applications/zeptac-backend/BACKEND/logs
```

### 3. Start with PM2
```bash
cd /home/username/applications/zeptac-backend/BACKEND
pm2 start ecosystem.config.js
pm2 logs zeptac-backend

# Should see: "Connected to MongoDB", "Server running on port 3001"
# Check status: pm2 status
```

### 4. Enable Auto-start on Reboot
```bash
pm2 startup
pm2 save
```

## Day 4: Nginx Configuration

### 1. Create Nginx Config
```bash
sudo nano /etc/nginx/sites-available/zeptac-backend
# Copy full config from FASTPANEL_MIGRATION_GUIDE.md Step 4.1
# Update: your-domain.com, certificate paths
```

### 2. Enable Config
```bash
sudo ln -s /etc/nginx/sites-available/zeptac-backend /etc/nginx/sites-enabled/
sudo nginx -t
sudo systemctl reload nginx
```

### 3. Verify Nginx Running
```bash
sudo systemctl status nginx
curl http://localhost/api/health
# Should return: {"status":"ok"}
```

## Day 5: SSL & Security

### 1. Set Up SSL (One Option)

**Option A: Fastpanel Auto-SSL (Easiest)**
- Go to Fastpanel Control Panel
- SSL Certificates → Generate Auto SSL
- Select your domain → Generate

**Option B: Let's Encrypt (Manual)**
```bash
sudo apt-get install certbot python3-certbot-nginx
sudo certbot certonly --webroot -w /var/www/certbot -d your-domain.com
# Update Nginx config with certificate paths
```

### 2. Test SSL
```bash
curl https://your-domain.com/api/health
# Should return: {"status":"ok"}
```

## Day 6: DNS & Frontend Update

### 1. Update DNS
- Point `your-domain.com` to Fastpanel nameservers or IP
- Update A record to Fastpanel server IP

### 2. Wait for DNS Propagation
```bash
# Check DNS propagation
nslookup your-domain.com
dig your-domain.com @8.8.8.8
```

### 3. Update Frontend .env
```bash
# Frontend repo .env:
VITE_API_URL=https://your-domain.com
```

### 4. Rebuild & Deploy Frontend
```bash
npm run build
# Deploy to Vercel or your hosting
```

## Day 7: Testing & Verification

### 1. Test All API Endpoints
```bash
curl https://your-domain.com/api/health
curl https://your-domain.com/api/devices
# All should return 200 OK
```

### 2. Check Logs
```bash
pm2 logs zeptac-backend
tail -f /var/log/nginx/zeptac-backend-access.log
tail -f /var/log/nginx/zeptac-backend-error.log
```

### 3. Test Frontend Connection
- Open frontend in browser
- Login should work
- Devices should load
- Real-time features should work (Socket.IO)

### 4. Test Email & MQTT (if used)
- Trigger a test alarm → Should send email
- MQTT devices should connect and send data
- Check `pm2 logs` for errors

## Day 8: Monitor & Cleanup

### 1. Monitor Performance
```bash
pm2 monit
# Watch CPU, memory usage
```

### 2. Verify Auto-restart Works
```bash
# Kill the process to test auto-restart
pm2 kill zeptac-backend
# Should auto-restart within seconds
pm2 status
```

### 3. Clean Up Render (Optional)
- Keep running for 1 week as backup
- Monitor for any issues
- Point domain back to Fastpanel if problems

### 4. Set Up Monitoring (Optional)
```bash
# Auto log rotation
pm2 install pm2-logrotate

# Real-time monitoring
pm2 install pm2-auto-pull
```

---

## Common Commands You'll Need

```bash
# Check app status
pm2 status zeptac-backend

# View recent logs
pm2 logs zeptac-backend

# Restart app
pm2 restart zeptac-backend

# Stop app
pm2 stop zeptac-backend

# Start app
pm2 start ecosystem.config.js

# Reload Nginx
sudo systemctl reload nginx

# Check Nginx status
sudo systemctl status nginx

# View Nginx logs
tail -f /var/log/nginx/zeptac-backend-error.log
```

---

## Rollback to Render (If Needed)

1. Update DNS to point back to Render
2. Keep Fastpanel setup intact for future use
3. Can revert to Fastpanel once issues resolved

---

## Estimated Timeline
- Day 1-2: Setup & Database: 2-3 hours
- Day 3: PM2 & Process: 1 hour  
- Day 4: Nginx: 1-2 hours
- Day 5: SSL: 30 mins - 2 hours
- Day 6: DNS & Frontend: 1-4 hours (DNS propagation time)
- Day 7: Testing: 2-3 hours
- Day 8: Monitoring: Ongoing

**Total: 2-3 days of active work**

---

## Need Help?

- Fastpanel Docs: https://docs.fastpanel.direct/
- Nginx Docs: https://nginx.org/en/docs/
- PM2 Docs: https://pm2.keymetrics.io/
- Node.js Best Practices: https://nodejs.org/en/docs/guides/

---

## After Migration Success

1. **Clean up**: Remove old Render deployment files
2. **Document**: Update your README with Fastpanel deployment info
3. **Monitor**: Set up error tracking (Sentry, DataDog, etc.)
4. **Backup**: Set up automated MongoDB backups
5. **Scale**: Monitor load and adjust PM2 instances if needed
