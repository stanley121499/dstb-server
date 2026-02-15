# Deployment Guide

**Status:** 🚧 In Implementation  
**Last Updated:** February 2026

## Overview

This guide covers deploying and running the DSTB trading bot on Windows, Linux, and cloud platforms.

## Prerequisites

- Node.js 18+ installed
- npm 9+ installed
- Git (for cloning repository)
- Exchange API keys (Bitunix)
- (Optional) Telegram bot token
- (Optional) Google Sheets service account

---

## Local Development (Windows)

### Initial Setup

```powershell
# Clone repository
git clone https://github.com/your-username/dstb-server.git
cd dstb-server

# Install dependencies
npm install

# Build the bot
npm run build

# Create configs directory
mkdir configs\strategies

# Copy example config
copy configs\bot.example.json configs\bot.json
```

### Environment Variables

Create `.env` file in project root:

```env
# Exchange API Keys
BITUNIX_API_KEY=your-api-key-here
BITUNIX_SECRET_KEY=your-secret-key-here

# Telegram (optional)
TELEGRAM_BOT_TOKEN=your-telegram-bot-token
TELEGRAM_CHAT_ID=your-telegram-chat-id

# Google Sheets (optional)
GOOGLE_SHEETS_ID=your-sheet-id
GOOGLE_SERVICE_ACCOUNT_KEY=path/to/service-account-key.json

# Email (optional)
SMTP_HOST=smtp.gmail.com
SMTP_PORT=587
SMTP_USER=your-email@gmail.com
SMTP_PASS=your-app-password
```

### Running the Bot (Forever Loop)

**Recommended for local testing:**

```powershell
# Start bot with auto-restart
node dist/runner.js --config configs/strategies/orb-btc-15m.json
```

The runner will:
- Auto-restart on crashes
- Use exponential backoff
- Reset failure count after 5 minutes of healthy running
- Stop after 10 consecutive failures

**Press Ctrl+C to stop cleanly.**

### Keep Computer Awake

```powershell
# Prevent sleep
powercfg /change standby-timeout-ac 0
powercfg /change hibernate-timeout-ac 0

# Disable network adapter power saving
# Control Panel → Network Adapter → Properties → 
# Power Management → Uncheck "Allow computer to turn off this device"
```

---

## Windows Service (Production)

### Installation

Install `node-windows` globally:

```powershell
npm install -g node-windows
```

Create service installer (`install-service.js`):

```javascript
const Service = require("node-windows").Service;

const svc = new Service({
  name: "DSTB Trading Bot",
  description: "Cryptocurrency trading bot",
  script: "E:\\Dev\\GitHub\\dstb-server\\dist\\index.js",
  scriptOptions: "--config E:\\Dev\\GitHub\\dstb-server\\configs\\strategies\\orb-btc-15m.json"
});

svc.on("install", () => {
  svc.start();
});

svc.install();
```

Install the service:

```powershell
node install-service.js
```

### Managing the Service

```powershell
# Via Services (services.msc)
1. Open Services
2. Find "DSTB Trading Bot"
3. Right-click → Start/Stop/Restart

# Via PowerShell (as Admin)
Start-Service "DSTB Trading Bot"
Stop-Service "DSTB Trading Bot"
Restart-Service "DSTB Trading Bot"
```

### Uninstall Service

Create `uninstall-service.js`:

```javascript
const Service = require("node-windows").Service;

const svc = new Service({
  name: "DSTB Trading Bot",
  script: "E:\\Dev\\GitHub\\dstb-server\\dist\\index.js"
});

svc.on("uninstall", () => {
  console.log("Uninstall complete");
});

svc.uninstall();
```

```powershell
node uninstall-service.js
```

---

## Linux (Local or VPS)

### Initial Setup

```bash
# Update system
sudo apt update && sudo apt upgrade -y

# Install Node.js 18
curl -fsSL https://deb.nodesource.com/setup_18.x | sudo -E bash -
sudo apt install -y nodejs

# Clone repository
git clone https://github.com/your-username/dstb-server.git
cd dstb-server

# Install dependencies
npm install

# Build
npm run build

# Create environment file
cp .env.example .env
nano .env  # Edit with your keys
```

### Using PM2 (Recommended)

```bash
# Install PM2 globally
sudo npm install -g pm2

# Start bot
pm2 start dist/index.js --name trading-bot -- --config configs/strategies/orb-btc-15m.json

# Setup auto-start on reboot
pm2 startup
pm2 save

# Manage bot
pm2 status                # Check status
pm2 logs trading-bot      # View logs
pm2 restart trading-bot   # Restart
pm2 stop trading-bot      # Stop
pm2 delete trading-bot    # Remove

# Monitor
pm2 monit                 # Live monitoring
```

### Using systemd (Alternative)

Create service file `/etc/systemd/system/dstb-bot.service`:

```ini
[Unit]
Description=DSTB Trading Bot
After=network.target

[Service]
Type=simple
User=your-username
WorkingDirectory=/home/your-username/dstb-server
ExecStart=/usr/bin/node dist/index.js --config configs/strategies/orb-btc-15m.json
Restart=always
RestartSec=10
StandardOutput=syslog
StandardError=syslog
SyslogIdentifier=dstb-bot
Environment=NODE_ENV=production

[Install]
WantedBy=multi-user.target
```

Enable and start:

```bash
# Reload systemd
sudo systemctl daemon-reload

# Enable service
sudo systemctl enable dstb-bot

# Start service
sudo systemctl start dstb-bot

# Check status
sudo systemctl status dstb-bot

# View logs
sudo journalctl -u dstb-bot -f

# Stop/restart
sudo systemctl stop dstb-bot
sudo systemctl restart dstb-bot
```

---

## Digital Ocean Droplet

### 1. Create Droplet

- OS: Ubuntu 22.04 LTS
- Plan: Basic $6/month (1GB RAM)
- Datacenter: Choose nearest to exchange
- SSH keys: Add your public key

### 2. Initial Server Setup

```bash
# SSH into droplet
ssh root@your-droplet-ip

# Create non-root user
adduser trading
usermod -aG sudo trading
su - trading

# Setup firewall
sudo ufw allow OpenSSH
sudo ufw enable
```

### 3. Deploy Bot

```bash
# Follow Linux setup above
# Use PM2 for process management
```

### 4. Security

```bash
# Disable root SSH login
sudo nano /etc/ssh/sshd_config
# Set: PermitRootLogin no
sudo systemctl restart sshd

# Setup automatic security updates
sudo apt install unattended-upgrades
sudo dpkg-reconfigure -plow unattended-upgrades
```

### 5. Monitoring

```bash
# Install htop for resource monitoring
sudo apt install htop

# Check resources
htop

# Check disk space
df -h

# Check memory
free -h
```

---

## Render Background Worker

### 1. Create render.yaml

In project root:

```yaml
services:
  - type: background
    name: dstb-trading-bot
    env: node
    region: oregon  # Choose closest to exchange
    plan: starter  # $7/month
    buildCommand: npm install && npm run build
    startCommand: node dist/index.js --config /etc/secrets/bot-config.json
    envVars:
      - key: NODE_ENV
        value: production
      - key: BITUNIX_API_KEY
        sync: false
      - key: BITUNIX_SECRET_KEY
        sync: false
      - key: TELEGRAM_BOT_TOKEN
        sync: false
      - key: TELEGRAM_CHAT_ID
        sync: false
```

### 2. Deploy to Render

```bash
# Push to GitHub
git add .
git commit -m "Deploy to Render"
git push origin main

# On Render dashboard:
1. New → Background Worker
2. Connect repository
3. Render automatically detects render.yaml
4. Add environment variables
5. Deploy
```

### 3. Upload Config File

In Render dashboard:
1. Environment → Secret Files
2. Add file: `/etc/secrets/bot-config.json`
3. Paste your config JSON
4. Save

### 4. Monitor on Render

```
# View logs
Render Dashboard → Your Service → Logs

# Check metrics
Dashboard → Your Service → Metrics

# Manual restart
Dashboard → Your Service → Manual Deploy → Deploy Latest Commit
```

**Note:** Render workers don't have HTTP health checks. Use Telegram alerts and Google Sheets to monitor.

---

## Multi-Bot Deployment

### Running Multiple Bots

**Option 1: Separate Processes (Recommended)**

```bash
# Bot 1
pm2 start dist/index.js --name bot-aggressive -- --config configs/strategies/orb-btc-aggressive.json

# Bot 2
pm2 start dist/index.js --name bot-conservative -- --config configs/strategies/orb-btc-conservative.json

# Bot 3
pm2 start dist/index.js --name bot-cme-gap -- --config configs/strategies/cme-gap-eth.json

# View all
pm2 list
```

**Option 2: Single Process, Multi-Bot Manager (Future)**

This will be implemented later to manage multiple bots in a single process.

---

## Backup & Recovery

### Database Backup

```bash
# Daily backup script
#!/bin/bash
DATE=$(date +%Y-%m-%d)
cp data/bot-state.db backups/bot-state-$DATE.db

# Keep only last 30 days
find backups/ -name "bot-state-*.db" -mtime +30 -delete
```

Add to crontab:

```bash
crontab -e

# Add line:
0 2 * * * /home/trading/dstb-server/backup.sh
```

### Config Backup

```bash
# Backup configs
cp -r configs/ backups/configs-$(date +%Y-%m-%d)/

# Backup .env
cp .env backups/env-$(date +%Y-%m-%d).bak
```

### Recovery

```bash
# Restore database
cp backups/bot-state-2026-02-04.db data/bot-state.db

# Restart bot
pm2 restart trading-bot
```

---

## Troubleshooting

### Bot Won't Start

**Check logs:**
```bash
# PM2
pm2 logs trading-bot --lines 50

# systemd
sudo journalctl -u dstb-bot -n 50

# Windows
Check logs/ folder
```

**Common issues:**
1. Missing environment variables
2. Invalid config file JSON
3. Database file permissions
4. Port already in use

### Bot Keeps Crashing

**Check error count:**
```bash
cat logs/bot-$(date +%Y-%m-%d).log | grep ERROR
```

**Common causes:**
1. Network issues (check internet)
2. Exchange API issues (check Bitunix status)
3. Invalid strategy logic
4. Out of memory

**Solution:**
```bash
# Increase memory (PM2)
pm2 restart trading-bot --max-memory-restart 500M

# Check resources
htop
free -h
```

### Orders Not Executing

**Check:**
1. Exchange balance sufficient
2. Daily loss limit not hit
3. Risk checks passing
4. Exchange API keys valid

**Debug:**
```bash
# Check bot status
node dist/cli.js status

# Check positions
node dist/cli.js positions

# Check logs for rejection reasons
grep "Entry blocked" logs/bot-*.log
```

### High Memory Usage

**Check:**
```bash
# View memory
ps aux | grep node

# If >500MB, there might be a memory leak
pm2 restart trading-bot
```

**Prevention:**
- Restart bot daily (cron job)
- Limit historical candles stored
- Clear old logs regularly

---

## Performance Optimization

### Reduce Latency

1. **Choose datacenter near exchange:**
   - Bitunix servers likely in Asia
   - Choose Singapore/Tokyo region

2. **Use WebSocket (not polling):**
   - Already implemented in Bitunix adapter

3. **Optimize strategy calculations:**
   - Cache ATR, SMA calculations
   - Don't recalculate from scratch every candle

### Reduce Costs

**Digital Ocean:**
- Start with $6/month droplet
- Upgrade only if needed
- One droplet can run 5-10 bots

**Render:**
- $7/month per worker
- Each worker = one bot
- Use Digital Ocean for multiple bots

### Monitor Resources

```bash
# Setup monitoring alerts
# Render: Built-in metrics
# Digital Ocean: Install monitoring agent

# PM2 monitoring (web dashboard)
pm2 install pm2-server-monit
```

---

## Security Best Practices

1. **Never commit secrets:**
   ```bash
   # Ensure .env in .gitignore
   echo ".env" >> .gitignore
   ```

2. **Use environment variables:**
   - Never hardcode API keys
   - Use .env files locally
   - Use platform secrets in cloud

3. **Restrict API key permissions:**
   - Bitunix: Only enable Trading + Read permissions
   - Disable Withdrawal permission

4. **Keep system updated:**
   ```bash
   # Ubuntu
   sudo apt update && sudo apt upgrade -y
   
   # Node packages
   npm audit
   npm audit fix
   ```

5. **Use firewall:**
   ```bash
   # Ubuntu
   sudo ufw status
   sudo ufw allow 22/tcp  # SSH only
   sudo ufw enable
   ```

6. **Monitor for suspicious activity:**
   - Enable Telegram alerts
   - Check daily for unexpected trades
   - Set up balance alerts

---

## Maintenance Schedule

### Daily
- [ ] Check bot health (`bot health`)
- [ ] Review trades (`bot trades --today`)
- [ ] Check for errors in logs
- [ ] Verify heartbeat recent

### Weekly
- [ ] Review performance (`bot performance`)
- [ ] Check reconciliation (`bot reconcile`)
- [ ] Review memory/CPU usage
- [ ] Update strategy if needed

### Monthly
- [ ] Full system backup
- [ ] Review and clean logs
- [ ] Update dependencies (`npm update`)
- [ ] Review and optimize costs

---

## Monitoring Checklist

**Before Leaving Bot Running:**
- [ ] Telegram alerts working
- [ ] Google Sheets updating
- [ ] Daily email summaries enabled
- [ ] Heartbeat monitoring active
- [ ] Emergency stop tested
- [ ] Paper trading validated (48h+)
- [ ] Initial capital small ($100-500)

---

## References

- [New Architecture](./30-new-architecture.md)
- [CLI Reference](./33-cli-reference.md)
- [Monitoring Setup](./34-monitoring-setup.md)
- [Strategy Plugin Guide](./31-strategy-plugin-guide.md)
