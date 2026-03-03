# Fastpanel Migration - Troubleshooting & Debugging

## Pre-Migration Diagnostics

Run these checks before shutting down Render deployment:

### 1. Export Current Configuration
```bash
# SSH into Render or local dev server
cat .env | grep -v PASSWORD > backup_env_vars.txt
# Keep this for reference (sanitize passwords before sharing)
```

### 2. Backup Database
```bash
# If using MongoDB Atlas
mongodump --uri="mongodb+srv://..." --out=./backup_$(date +%Y%m%d)

# If local MongoDB
mongodump --out=./backup_$(date +%Y%m%d)

# Compress and keep safe
tar -czf backup_$(date +%Y%m%d).tar.gz backup_$(date +%Y%m%d)
```

---

## Common Issues & Solutions

### ❌ Issue 1: "Connection Refused" on Port 3001

**Symptoms:**
- Nginx returns "502 Bad Gateway"
- `curl localhost:3001` returns connection refused

**Diagnosis:**
```bash
# Check if Node.js is running
pm2 status
ps aux | grep node

# Check if port is in use
netstat -tlnp | grep 3001
sudo lsof -i :3001

# Check PM2 logs
pm2 logs zeptac-backend
```

**Solutions:**

1. **App crashed - restart it:**
```bash
pm2 restart zeptac-backend
pm2 logs zeptac-backend
# Watch for startup errors
```

2. **Port already in use:**
```bash
# Kill process on 3001
lsof -ti:3001 | xargs kill -9

# Start fresh
pm2 start ecosystem.config.js
```

3. **Out of memory:**
```bash
# Check memory usage
pm2 monit

# Increase max memory in ecosystem.config.js
# max_memory_restart: '2G'
# Or increase node_args: '--max-old-space-size=8192'

pm2 restart zeptac-backend
```

---

### ❌ Issue 2: "502 Bad Gateway" Errors

**Symptoms:**
- Browser shows "502 Bad Gateway"
- Nginx running but backend unreachable

**Diagnosis:**
```bash
# Check Nginx error log
tail -50 /var/log/nginx/zeptac-backend-error.log

# Check if backend is running
pm2 status

# Test direct connection
curl -v http://127.0.0.1:3001/api/health
```

**Common Causes & Fixes:**

1. **Backend not running:**
```bash
pm2 start ecosystem.config.js
pm2 save
```

2. **Environment variables missing:**
```bash
# Check .env exists
ls -la /home/username/applications/zeptac-backend/BACKEND/.env

# If missing, create it with all vars from FASTPANEL_MIGRATION_GUIDE.md
nano /home/username/applications/zeptac-backend/BACKEND/.env

# Restart to load new env vars
pm2 restart zeptac-backend
```

3. **Nginx not connecting to right IP/port:**
```bash
# Check nginx config
grep -A 5 "upstream zeptac_backend" /etc/nginx/sites-enabled/zeptac-backend

# Should be: server 127.0.0.1:3001;
# Reload Nginx
sudo nginx -t
sudo systemctl reload nginx
```

---

### ❌ Issue 3: "504 Gateway Timeout" on File Exports

**Symptoms:**
- File export requests timeout after ~60 seconds
- API works but exports fail

**Diagnosis:**
```bash
# Check your export endpoint timeout in Nginx
grep -A 10 "location /api/export" /etc/nginx/sites-enabled/zeptac-backend
```

**Solutions:**

1. **Increase Nginx timeout:**
```bash
sudo nano /etc/nginx/sites-available/zeptac-backend

# In /api/export location block, ensure:
# proxy_connect_timeout 120s;
# proxy_send_timeout 120s;
# proxy_read_timeout 120s;

# Also update main location block:
# proxy_connect_timeout 90s;
# proxy_send_timeout 90s;
# proxy_read_timeout 90s;

sudo nginx -t
sudo systemctl reload nginx
```

2. **Increase Node.js memory:**
```bash
# Edit ecosystem.config.js
nano /home/username/applications/zeptac-backend/BACKEND/ecosystem.config.js

# Change: node_args: '--max-old-space-size=8192'
# (original was 4096)

pm2 restart zeptac-backend
```

3. **Stream response instead of buffering:**
```bash
# In your index.js export route, ensure streaming:
res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
res.setHeader('Content-Disposition', 'attachment; filename="export.xlsx"');

workbook.xlsx.write(res).then(() => res.end());
// Not: const buffer = await workbook.xlsx.writeBuffer();
```

---

### ❌ Issue 4: "Cannot GET /api/health"

**Symptoms:**
- `curl https://your-domain.com/` returns 404
- But app works locally

**Diagnosis:**
```bash
# Check if route exists
grep -r "GET.*health\|api.*health" /home/username/applications/zeptac-backend/BACKEND/
```

**Solution:**
Add health check route to `index.js` if missing:

```javascript
// Add near the top of route definitions
app.get('/api/health', (req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});
```

Then restart:
```bash
pm2 restart zeptac-backend
```

---

### ❌ Issue 5: "WebSocket Connection Failed"

**Symptoms:**
- Real-time features don't work
- Socket.IO events not received
- Browser console: "WebSocket connection failed"

**Diagnosis:**
```bash
# Check PM2 logs for Socket.IO errors
pm2 logs zeptac-backend | grep -i socket

# Check if WebSocket upgrade headers are set
curl -i -N -H "Connection: Upgrade" -H "Upgrade: websocket" http://localhost:3001
```

**Solutions:**

1. **Nginx WebSocket headers missing:**
```bash
nano /etc/nginx/sites-available/zeptac-backend

# Ensure these lines exist in ALL location blocks:
proxy_set_header Upgrade $http_upgrade;
proxy_set_header Connection "upgrade";

sudo nginx -t
sudo systemctl reload nginx
```

2. **Verify Socket.IO initialization in Express:**
```javascript
// In index.js, check:
const io = initializeSocket(server);

// And ensure routes use io:
app.io = io;
// Or pass io to routes module
```

Restart if changed:
```bash
pm2 restart zeptac-backend
```

---

### ❌ Issue 6: "MongoDB Connection Refused"

**Symptoms:**
- App won't start
- PM2 logs: "MongoServerError: connect EREFUSED"

**Diagnosis:**
```bash
# Check if MongoDB is reachable
ping your-mongodb-server
telnet your-mongodb-server 27017

# Verify connection string
echo $MONGODB_URI
# Should show valid connection string

# Test connection directly
mongosh "your-mongodb-uri"
```

**Solutions:**

1. **Check .env file:**
```bash
cat /home/username/applications/zeptac-backend/BACKEND/.env | grep MONGODB
# Should have: MONGODB_URI=mongodb+srv://...
```

2. **Verify Atlas IP whitelist:**
- Go to MongoDB Atlas dashboard
- Network Access → IP Whitelist
- Add your Fastpanel server IP
- Check: `curl ifconfig.me` to get your IP

3. **Test connection:**
```bash
cd /home/username/applications/zeptac-backend/BACKEND
node -e "const mongoose = require('mongoose'); mongoose.connect(process.env.MONGODB_URI).then(()=>console.log('Connected!'),err=>console.error('Error:',err));"
```

---

### ❌ Issue 7: "CORS Errors" from Frontend

**Symptoms:**
- Browser console: "Access to XMLHttpRequest blocked by CORS policy"
- Network tab shows 200 response but JS can't access it

**Diagnosis:**
```bash
# Check frontend .env
cat /path/to/frontend/.env | grep API_URL

# Should match your backend domain
# Example: VITE_API_URL=https://your-domain.com
```

**Solutions:**

1. **Update frontend .env:**
```bash
# Frontend directory
nano .env.production

# Add or update:
VITE_API_URL=https://your-domain.com
VITE_WEBSOCKET_URL=wss://your-domain.com

# Rebuild
npm run build
```

2. **Verify backend CORS config:**
```bash
# In index.js
app.use(cors({
  origin: 'https://your-frontend-domain.com',
  credentials: true,
}));
```

3. **Restart both services:**
```bash
# Backend
pm2 restart zeptac-backend

# Frontend (if deployed locally)
npm run build && npm run preview
```

---

### ❌ Issue 8: "SSL Certificate Not Valid"

**Symptoms:**
- Browser shows "NET::ERR_CERT_INVALID"
- `curl https://your-domain.com` shows certificate errors

**Solutions:**

1. **Check certificate:**
```bash
# See cert details
openssl x509 -text -noout -in /path/to/certificate.crt

# Check expiration
openssl x509 -dates -noout -in /path/to/certificate.crt
```

2. **Verify Nginx cert paths:**
```bash
grep "ssl_certificate" /etc/nginx/sites-enabled/zeptac-backend

# Ensure paths are correct:
ls -la /path/to/certificate.crt
ls -la /path/to/private.key

# Permissions must be 644 for cert, 600 for key
chmod 644 /path/to/certificate.crt
chmod 600 /path/to/private.key
```

3. **Regenerate with Let's Encrypt:**
```bash
sudo certbot renew --force-renewal
# Or delete and recreate
sudo certbot delete --cert-name your-domain.com
sudo certbot certonly --webroot -w /var/www/certbot -d your-domain.com
```

Reload Nginx:
```bash
sudo nginx -t
sudo systemctl reload nginx
```

---

### ❌ Issue 9: "High Memory Usage - Process Killed"

**Symptoms:**
- PM2 logs: "Process killed (memory exceeded)"
- App crashes intermittently

**Diagnosis:**
```bash
pm2 monit
# Watch Memory % column

# Check historical memory
pm2 logs zeptac-backend | grep -i "memory\|killed"
```

**Solutions:**

1. **Increase max memory restart threshold:**
```bash
nano /home/username/applications/zeptac-backend/BACKEND/ecosystem.config.js

# Change:
max_memory_restart: '2G'  // from 1G

pm2 restart zeptac-backend
```

2. **Increase Node.js heap:**
```bash
# In ecosystem.config.js:
node_args: '--max-old-space-size=8192'  // from 4096

pm2 restart zeptac-backend
```

3. **Check for memory leaks:**
```bash
# Monitor memory growth over time
watch -n 5 'pm2 monit'

# If memory keeps growing, may have a leak
# Check: eventlisteners, timers, unclosed connections
```

---

### ❌ Issue 10: "Deployment Files Not Updated (git pull failed)"

**Symptoms:**
- Changes pushed to GitHub but not reflecting on server
- Old code still running

**Solutions:**

1. **Manual pull and restart:**
```bash
cd /home/username/applications/zeptac-backend
git pull origin main
cd BACKEND
npm install
pm2 restart zeptac-backend
```

2. **Set up auto-pull (optional):**
```bash
pm2 install pm2-auto-pull

# Configure cron job
crontab -e

# Add:
0 */6 * * * cd /home/username/applications/zeptac-backend && git pull origin main && cd BACKEND && npm install && pm2 restart zeptac-backend
```

---

## Checking System Resources

### View Real-time Resource Usage
```bash
pm2 monit
```

### View overall server stats
```bash
# Install htop if not present
sudo apt install htop
htop

# Quick check
free -h          # RAM
df -h             # Disk
uptime            # Load average
```

---

## Viewing Logs

### PM2 Application Logs
```bash
# Real-time logs
pm2 logs zeptac-backend

# Last 20 lines
pm2 logs zeptac-backend -n 20

# Export logs to file
pm2 logs zeptac-backend > app_logs.txt

# Filter for errors
pm2 logs zeptac-backend | grep -i "error\|fail\|exception"
```

### Nginx Logs
```bash
# Access log
tail -f /var/log/nginx/zeptac-backend-access.log

# Error log
tail -f /var/log/nginx/zeptac-backend-error.log

# Search for 502 errors
grep 502 /var/log/nginx/zeptac-backend-error.log

# Count error types
tail -100 /var/log/nginx/zeptac-backend-error.log | cut -d' ' -f1-15 | sort | uniq -c
```

### System Logs
```bash
# Recent system errors
sudo journalctl -xe

# Nginx service logs
sudo systemctl status nginx

# PM2 service logs (if configured as systemd service)
sudo journalctl -u pm2 -f
```

---

## Performance Optimization Checklist

- [ ] Node.js memory configured: `--max-old-space-size=4096+`
- [ ] PM2 cluster mode: `exec_mode: 'cluster'`
- [ ] MongoDB connection pooling checked
- [ ] Nginx gzip compression enabled
- [ ] Nginx caching configured
- [ ] Database indexes verified
- [ ] Rate limiting in place
- [ ] Timeout values increased for file operations
- [ ] WebSocket keep-alive configured
- [ ] Log rotation set up

---

## Escalation Procedure

If issue persists after trying above:

1. **Collect diagnostics:**
```bash
# Create diagnostic bundle
mkdir /tmp/zeptac-diagnostics
pm2 logs zeptac-backend > /tmp/zeptac-diagnostics/pm2-logs.txt
cat .env > /tmp/zeptac-diagnostics/env.txt
cat /etc/nginx/sites-enabled/zeptac-backend > /tmp/zeptac-diagnostics/nginx.conf
pm2 status > /tmp/zeptac-diagnostics/pm2-status.txt
pm2 monit > /tmp/zeptac-diagnostics/pm2-monit.txt 2>&1
ps aux | grep node > /tmp/zeptac-diagnostics/ps-node.txt
netstat -tlnp > /tmp/zeptac-diagnostics/netstat.txt
free -h > /tmp/zeptac-diagnostics/memory.txt
df -h > /tmp/zeptac-diagnostics/disk.txt
```

2. **Contact Support with:**
- Diagnostic bundle
- Description of the issue
- When it started
- What changed recently
- Fastpanel ticket number

---

## Emergency Commands

```bash
# Stop everything
pm2 stop all

# Kill stubborn process
killall -9 node

# Clear PM2 cache
pm2 kill

# Full reset
pm2 flush

# Emergency restart
pm2 restart zeptac-backend --update-env

# Force Nginx reload
sudo nginx -s reload

# Check if something is listening on Nginx port
sudo lsof -i :80
sudo lsof -i :443
```

---

Remember: Always check logs first when debugging! 🔍
