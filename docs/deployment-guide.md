# Deployment Guide

**Last Updated:** February 2026

---

## Prerequisites

- **Node.js** v20 or later
- **npm** v10 or later
- A Bitunix account with API key (Futures)
- `.env` file with credentials (see [Environment Variables](#environment-variables))

---

## Quick Start (Local / Dev)

```powershell
# 1. Install dependencies
npm install

# 2. Copy and fill in environment variables
copy .env.example .env
# Edit .env with your API keys

# 3. Run a backtest to verify setup
npm run bot -- backtest --config configs/bot.example.json --start 2024-01-01 --end 2024-06-30

# 4. Start in paper trading mode
npm run bot -- start --config configs/bot.example.json --paper
```

---

## Running Live

```powershell
# Start a live bot
npm run bot -- start --config configs/bot-live-eth-bitunix.json

# View status
npm run bot -- status

# Follow logs
npm run bot -- logs <bot-id> --follow
```

> **Warning:** Always test in paper mode or with Bitunix testnet before going live. Set `"testMode": true` in the config's `bitunix` section for testnet.

---

## Windows Service (Auto-Start on Boot)

Use [NSSM](https://nssm.cc/) to register the bot as a Windows service:

```powershell
# Install NSSM, then
nssm install DSTB-Bot "node" "--import tsx src/cli/index.ts start --config configs/bot-live-eth-bitunix.json"
nssm set DSTB-Bot AppDirectory "E:\Dev\GitHub\dstb-server"
nssm set DSTB-Bot AppRestartDelay 5000
nssm start DSTB-Bot
```

NSSM will automatically restart the process on crash.

---

## Linux / VPS (systemd)

Create `/etc/systemd/system/dstb-bot.service`:

```ini
[Unit]
Description=DSTB Trading Bot
After=network.target

[Service]
Type=simple
User=ubuntu
WorkingDirectory=/home/ubuntu/dstb-server
ExecStart=/usr/bin/node --import tsx src/cli/index.ts start --config configs/bot-live-eth-bitunix.json
Restart=always
RestartSec=5
EnvironmentFile=/home/ubuntu/dstb-server/.env

[Install]
WantedBy=multi-user.target
```

```bash
sudo systemctl daemon-reload
sudo systemctl enable dstb-bot
sudo systemctl start dstb-bot
sudo journalctl -u dstb-bot -f
```

---

## Cloud VPS (Recommended for Production)

A $6/month [DigitalOcean Droplet](https://www.digitalocean.com/) (1 vCPU, 1 GB RAM) is sufficient. Use the Linux/systemd setup above.

**Recommended workflow:**
1. Provision droplet (Ubuntu 22.04)
2. Install Node.js 20 via `nvm`
3. Clone repo, run `npm install`
4. Set up `.env` file
5. Register systemd service
6. Enable Telegram alerts for monitoring

---

## Log Rotation

Logs are written daily to `logs/bot-<id>-<date>.log`. They are not automatically deleted — set up a cron task to prune old logs:

```bash
# Delete logs older than 30 days (Linux cron)
0 3 * * * find /home/ubuntu/dstb-server/logs -name "*.log" -mtime +30 -delete
```

---

## Environment Variables

```bash
# Bitunix exchange
BITUNIX_API_KEY=
BITUNIX_SECRET_KEY=

# Telegram alerts (optional but recommended)
TELEGRAM_BOT_TOKEN=
TELEGRAM_CHAT_ID=

# Google Sheets (optional)
GOOGLE_SHEETS_ID=
GOOGLE_SERVICE_ACCOUNT_KEY_PATH=path/to/key.json

# Email alerts (optional)
SMTP_HOST=smtp.gmail.com
SMTP_PORT=587
SMTP_USER=
SMTP_PASS=
ALERT_EMAIL_TO=
```

---

## Database Backup

The SQLite database is a single file:

```
data/bot-state.db
```

Back it up by simply copying it:

```bash
cp data/bot-state.db data/backups/bot-state-$(date +%Y%m%d).db
```

---

## See Also

- [CLI Reference](./cli-reference.md)
- [Monitoring Setup](./monitoring-setup.md)
- [Architecture](./architecture.md)
