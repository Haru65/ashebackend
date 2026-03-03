# Render → Fastpanel Migration Summary

## 📋 What You're Getting

I've created a complete migration package for moving your Express.js backend from Render to Fastpanel with Nginx. Here's what's included:

### Documentation Files Created:

1. **FASTPANEL_MIGRATION_GUIDE.md** (Main Guide)
   - Complete step-by-step migration process
   - Pre-migration checklist
   - PM2 setup for process management
   - Nginx reverse proxy configuration
   - SSL certificate setup
   - Database configuration
   - Firewall rules
   - Troubleshooting for common issues

2. **FASTPANEL_MIGRATION_QUICK_CHECKLIST.md** (Quick Reference)
   - Day-by-day task breakdown
   - Common commands cheat sheet
   - Estimated timeline
   - Rollback plan

3. **FASTPANEL_TROUBLESHOOTING.md** (Detailed Debugging)
   - 10 most common issues with solutions
   - Diagnostic procedures
   - Log viewing commands
   - Performance optimization tips
   - Emergency commands

4. **ecosystem.config.js** (PM2 Configuration)
   - Ready-to-use PM2 config
   - Cluster mode setup
   - Memory management
   - Log rotation

5. **nginx-config-template.conf** (Nginx Configuration)
   - Complete Nginx config
   - SSL/TLS setup
   - Security headers
   - WebSocket support for Socket.IO
   - Special handling for file exports
   - Copy-paste ready

6. **ENV_PRODUCTION_TEMPLATE.md** (Environment Variables)
   - All required environment variables
   - Production configuration
   - Security best practices
   - Variable generation guide
   - Connection testing commands

---

## 🚀 Quick Start (5 Steps)

### Step 1: Prepare Your Current Setup
- Backup your MongoDB database
- Document all environment variables from Render
- Test everything works on Render before moving

### Step 2: Set Up Fastpanel Server
```bash
# SSH into Fastpanel and run:
cd /home/username/applications
git clone https://github.com/Haru65/ZEPTAC-DEMO-BACKEND.git zeptac-backend
cd zeptac-backend/BACKEND
npm install --production
```

### Step 3: Configure Environment & Database
```bash
# Create .env with production values
# Use ENV_PRODUCTION_TEMPLATE.md as guide
nano .env

# Test database connection
mongosh "your-mongodb-uri"
```

### Step 4: Set Up PM2 & Nginx
```bash
# Already have ecosystem.config.js
mkdir -p logs
pm2 start ecosystem.config.js
pm2 save

# Copy and customize nginx-config-template.conf
# Enable with: sudo ln -s /etc/nginx/sites-available/zeptac-backend /etc/nginx/sites-enabled/
```

### Step 5: Set Up SSL & Test
- Use Fastpanel auto-SSL or Let's Encrypt
- Update frontend .env to point to new backend domain
- Test all features work

---

## 📊 Migration Timeline

| Phase | Task | Duration |
|-------|------|----------|
| **Day 1-2** | Backup data, setup server, install dependencies | 2-3 hours |
| **Day 3** | Configure .env, test database, PM2 setup | 1-2 hours |
| **Day 4** | Nginx configuration and testing | 1-2 hours |
| **Day 5** | SSL certificate setup | 30 min - 2 hours |
| **Day 6** | DNS propagation and frontend update | 1-4 hours |
| **Day 7** | Full testing and verification | 2-3 hours |
| **Day 8** | Monitoring and cleanup | Ongoing |

**Total: 2-3 days of active work**

---

## 🎯 Why Fastpanel + Nginx vs. Render?

### Advantages:
✅ **Cost**: Generally cheaper than Render for long-running apps  
✅ **Control**: Full server access, no deployment timeout limits  
✅ **Performance**: Dedicated resources, no shared instance limits  
✅ **Customization**: Can install and configure anything  
✅ **File Exports**: No hard timeout limits like Render's 30 seconds  

### Trade-offs:
❌ **Responsibility**: You manage server maintenance  
❌ **Scalability**: Requires manual configuration for horizontal scaling  
❌ **Updates**: Must manually update Node.js and dependencies  

---

## 🔑 Key Migration Points

### 1. Process Management (PM2)
- Replaces Render's built-in process management
- Auto-restarts app on crashes
- Enables cluster mode for multiple workers
- Use `pm2 logs` to debug issues

### 2. Reverse Proxy (Nginx)
- Acts as intermediary between users and Node.js app
- Handles SSL/TLS certificates
- Enables WebSocket support for Socket.IO
- Important for file exports (longer timeouts)

### 3. Security
- Configure strong JWT secrets
- Enable HTTPS everywhere
- Set up firewall rules
- Use MongoDB Atlas instead of local DB

### 4. Monitoring
- Watch PM2 logs: `pm2 logs zeptac-backend`
- Monitor Nginx: `tail -f /var/log/nginx/zeptac-backend-error.log`
- Set up log rotation and backups

---

## ⚠️ Common Pitfalls to Avoid

1. **Timeout Issues on File Exports**
   - Ensure Nginx has longer timeouts (120s)
   - Configure `max-old-space-size` in Node.js
   - Don't buffer large files in memory

2. **WebSocket Connection Fails**
   - Nginx must have `proxy_set_header Upgrade` lines
   - Check Socket.IO initialization in Express

3. **SSL Certificate Problems**
   - Use Fastpanel auto-SSL (easiest)
   - Update certificate paths in Nginx
   - Check certificate permissions

4. **CORS Errors**
   - Ensure frontend .env has correct API_URL
   - Make sure `CORS_ORIGIN` in backend matches domain
   - Restart backend after changing .env

5. **Database Connection Issues**
   - Verify MongoDB Atlas IP whitelist includes Fastpanel server
   - Test connection string before starting app
   - Check credentials are correct

---

## 📝 Files to Commit to Git

After migration, add to your repo:

```bash
git add ecosystem.config.js
git add FASTPANEL_MIGRATION_GUIDE.md
git add FASTPANEL_MIGRATION_QUICK_CHECKLIST.md
git add FASTPANEL_TROUBLESHOOTING.md
git add ENV_PRODUCTION_TEMPLATE.md
git add nginx-config-template.conf
git commit -m "docs: Add Fastpanel deployment guides"
git push
```

**Don't commit:**
- `.env` (sensitive data)
- `.env.production` (passwords)
- `logs/` directory

---

## 🔄 Rollback Procedure

If critical issues arise, you can quickly revert:

1. **Keep Render deployment running** for 1-2 weeks
2. **Point DNS back to Render** if needed
3. **Redeploy frontend** to use Render API URL
4. **Investigate** issues while on Render
5. **Fix** and retry Fastpanel deployment

This gives you safety net during transition!

---

## 📞 Support Resources

### Official Documentation:
- Fastpanel Docs: https://docs.fastpanel.direct/
- Nginx Documentation: https://nginx.org/en/docs/
- PM2 Documentation: https://pm2.keymetrics.io/
- Express.js Security: https://expressjs.com/en/advanced/best-practice-security.html

### Your Project Files:
- **index.js**: Main Express app - should need no changes
- **package.json**: Already production-ready
- **.env**: Use ENV_PRODUCTION_TEMPLATE.md

---

## ✅ Pre-Flight Checklist

Before starting migration, ensure:

- [ ] MongoDB Atlas account set up and cluster created
- [ ] Fastpanel account with SSH access
- [ ] Domain name purchased and ready
- [ ] All environment variables documented
- [ ] Backup of current database taken
- [ ] All features tested on Render
- [ ] Frontend repo ready to update
- [ ] SSL certificate plan (auto-SSL or Let's Encrypt)
- [ ] Team notified about migration window
- [ ] Monitoring tools configured

---

## 🎓 What You'll Learn

By following this migration, you'll understand:

✓ How to set up a Node.js app in production  
✓ How Nginx works as a reverse proxy  
✓ PM2 process management for Node.js  
✓ SSL/TLS certificate configuration  
✓ WebSocket proxy configuration  
✓ Production database setup  
✓ Server monitoring and logging  
✓ Troubleshooting production issues  

---

## 📖 Document Index

| Document | Purpose | When to Use |
|----------|---------|------------|
| FASTPANEL_MIGRATION_GUIDE.md | Complete step-by-step guide | Main reference during migration |
| FASTPANEL_MIGRATION_QUICK_CHECKLIST.md | Daily task breakdown | Day-to-day execution |
| FASTPANEL_TROUBLESHOOTING.md | Problem solving | When something breaks |
| ecosystem.config.js | PM2 configuration | Copy to Fastpanel server |
| nginx-config-template.conf | Nginx configuration | Copy to `/etc/nginx/sites-available/` |
| ENV_PRODUCTION_TEMPLATE.md | Environment variables | Create `.env` file on server |

---

## 🎉 After Successful Migration

1. **Monitor for 1 week** - Watch logs, check performance
2. **Clean up Render** - Can delete after verified stability
3. **Set up backups** - Automated MongoDB backups to cloud storage
4. **Enable monitoring** - Sentry/DataDog for error tracking (optional)
5. **Document** - Update README with Fastpanel deployment info
6. **Celebrate** - You've successfully migrated your backend! 🚀

---

##❓ Quick FAQ

**Q: Will my website have downtime?**  
A: During DNS switch (Step 6), clients may take a few hours to route to new server due to DNS caching. Minimal downtime expected.

**Q: What if something goes wrong?**  
A: Revert DNS to Render, investigate with logs, then retry. See FASTPANEL_TROUBLESHOOTING.md.

**Q: How do I debug production issues?**  
A: Use `pm2 logs` for app logs, `tail /var/log/nginx/*.log` for Nginx logs. See troubleshooting guide.

**Q: Can I scale this later?**  
A: Yes! Fastpanel supports Docker containers for scaling. Start with this and upgrade later.

**Q: Do I need to change my code?**  
A: No! Your Express app should work as-is. No code changes needed.

**Q: What about WebSocket/Socket.IO?**  
A: Already configured in the Nginx template. Real-time features will work.

**Q: How often should I backup?**  
A: Daily backups recommended in production. Use MongoDB's built-in backup features.

---

## 🚀 You're Ready!

You now have everything needed to migrate successfully. Start with:

1. **Read**: FASTPANEL_MIGRATION_GUIDE.md (full understanding)
2. **Prepare**: Backup data and document current setup
3. **Execute**: Follow FASTPANEL_MIGRATION_QUICK_CHECKLIST.md day by day
4. **Debug**: Reference FASTPANEL_TROUBLESHOOTING.md if issues arise
5. **Celebrate**: Your backend is now on Fastpanel! 🎉

---

**Document Set Created**: March 4, 2026  
**Status**: Ready for Migration  
**Support**: All documents included in BACKEND folder
