# Monitoring & Alerts Setup

**Status:** 🚧 In Implementation  
**Last Updated:** February 2026

## Overview

This guide covers setting up monitoring and alerts for the DSTB trading bot using:
1. **Telegram** - Instant error alerts
2. **Google Sheets** - Live dashboard for partner monitoring  
3. **Email** - Daily summaries and backup alerts

---

## Telegram Alerts

### Why Telegram?

- ✅ Instant notifications (< 1 minute)
- ✅ Works on phone/desktop
- ✅ Can send commands to bot
- ✅ Free
- ✅ No phone number exposed

### Setup Steps

#### 1. Create Telegram Bot

1. Open Telegram and search for `@BotFather`
2. Send `/newbot`
3. Follow prompts:
   - Bot name: `My Trading Bot Alerts`
   - Username: `my_trading_alerts_bot`
4. Save the **bot token** (looks like: `123456:ABC-DEF1234ghIkl-zyx57W2v1u123ew11`)

#### 2. Get Your Chat ID

1. Search for your bot in Telegram
2. Send it a message: `/start`
3. Visit: `https://api.telegram.org/bot<YOUR_BOT_TOKEN>/getUpdates`
4. Find `"chat":{"id":123456789}` in the response
5. Save your **chat ID**

#### 3. Configure in .env

```env
TELEGRAM_BOT_TOKEN=123456:ABC-DEF1234ghIkl-zyx57W2v1u123ew11
TELEGRAM_CHAT_ID=123456789
TELEGRAM_POLL_INTERVAL_MS=5000
TELEGRAM_RATE_WINDOW_MS=60000
TELEGRAM_RATE_MAX=20
```

#### 4. Test

```bash
node dist/test-telegram.js
```

You should receive a test message in Telegram.

### Alert Levels

**🔴 CRITICAL** (Immediate notification):
- Bot crashed
- Position liquidated  
- Daily loss limit hit
- Exchange disconnected >5 minutes
- Order stuck >10 minutes
- Position mismatch detected

**🟡 WARNING** (Notification, not urgent):
- Reconnection successful after failure
- Unusual slippage (>1%)
- Strategy skipped trade (filter triggered)
- Partial fill
- Rate limit hit (but handled)

**🟢 INFO** (Daily summary only):
- Trade executed
- Position updated
- Normal operations

### Example Alerts

```
🔴 CRITICAL
Bot: ORB BTC Aggressive
Exchange disconnected for 5+ minutes
Attempting reconnection...
Status: Trading paused

🟡 WARNING
Bot: ORB BTC Conservative
Unusual slippage detected
Expected: 0.1% | Actual: 0.8%
Trade still executed successfully

✅ Daily Summary
Bots: 3 running
Trades: 5 executed
PnL: +$234.50 (+2.1%)
Win Rate: 80%
```

### Telegram Commands

Send commands to your bot in Telegram:

```
/status - Show all bots status
/positions - Show open positions
/stop <bot-id> - Stop specific bot
```

---

## Google Sheets Dashboard

### Why Google Sheets?

- ✅ Partner (non-technical) can view on phone
- ✅ No login required (shareable link)
- ✅ Updates every 5 minutes
- ✅ Visual charts and formatting
- ✅ Historical data preserved

### Setup Steps

#### 1. Create Google Sheet

1. Go to https://sheets.google.com
2. Create new spreadsheet: "DSTB Trading Dashboard"
3. Copy the Sheet ID from URL:
   ```
   https://docs.google.com/spreadsheets/d/1ABC...XYZ/edit
                                              ^^^ This part
   ```

#### 2. Create Service Account

1. Go to https://console.cloud.google.com
2. Create new project: "DSTB Bot"
3. Enable Google Sheets API
4. Create Service Account:
   - Name: `dstb-bot-reporter`
   - Role: Editor
5. Create key (JSON)
6. Download key file → save as `google-service-account.json`

#### 3. Share Sheet with Service Account

1. Open your Google Sheet
2. Click Share
3. Add service account email (from JSON file):
   ```
   dstb-bot-reporter@project-id.iam.gserviceaccount.com
   ```
4. Set permission: Editor
5. Done

#### 4. Configure in .env

```env
GOOGLE_SHEETS_ID=1ABC...XYZ
GOOGLE_SERVICE_ACCOUNT_KEY=./google-service-account.json
GOOGLE_SHEETS_INTERVAL_MS=300000
GOOGLE_SHEETS_TRADE_DAYS=7
GOOGLE_SHEETS_SUMMARY_DAYS=7
GOOGLE_SHEETS_MAX_TRADES=200
```

#### 5. Initialize Sheet Structure

```bash
node dist/init-google-sheet.js
```

This creates the sheet structure with columns:
- Time
- Bot Name
- Strategy
- Equity
- Today P&L
- Position
- Status
- Heartbeat

### Sheet Layout

**Tab 1: Live Status** (updates every 5min)

| Time      | Bot Name               | Equity    | Today P&L | Position     | Status  |
|-----------|------------------------|-----------|-----------|--------------|---------|
| 14:32 UTC | ORB BTC Aggressive     | $5,234.50 | +$234.50  | LONG 0.1 BTC | running |
| 14:32 UTC | ORB BTC Conservative   | $4,889.20 | -$110.80  | None         | running |
| 14:32 UTC | CME Gap ETH           | $5,000.00 | $0.00     | None         | waiting |

**Tab 2: Trade History**

| Date       | Bot       | Side  | Entry   | Exit    | PnL      | R-Mult |
|------------|-----------|-------|---------|---------|----------|--------|
| 2026-02-04 | bot-abc   | LONG  | 45,000  | 46,500  | +$150.00 | +3.0R  |
| 2026-02-04 | bot-abc   | SHORT | 45,800  | 45,600  | +$20.00  | +0.4R  |

**Tab 3: Daily Summary**

| Date       | Total Equity | Day PnL  | Trades | Win Rate |
|------------|--------------|----------|--------|----------|
| 2026-02-04 | $15,123.70   | +$123.70 | 5      | 80%      |
| 2026-02-03 | $15,000.00   | +$89.50  | 3      | 67%      |

**Tab 4: Performance Charts**

- Equity curve (line chart)
- Daily P&L (bar chart)
- Win rate (pie chart)

### Sharing with Partner

1. Click "Share" button
2. Change to "Anyone with the link can view"
3. Copy link
4. Send to partner

They can:
- View on phone/desktop
- See real-time updates
- No Google account needed
- No editing access

---

## Email Alerts

### Setup (Gmail Example)

#### 1. Enable App Password

1. Google Account → Security
2. 2-Step Verification → Enable
3. App Passwords → Generate
4. Save password

#### 2. Configure in .env

```env
SMTP_HOST=smtp.gmail.com
SMTP_PORT=587
SMTP_USER=your-email@gmail.com
SMTP_PASS=your-16-char-app-password
ALERT_EMAIL_TO=your-phone-email@gmail.com
ALERT_EMAIL_FROM=your-email@gmail.com
ALERT_DAILY_HOUR=8
ALERT_EMAIL_RATE_WINDOW_MS=60000
ALERT_EMAIL_RATE_MAX=5
```

#### 3. Test

```bash
node dist/test-email.js
```

### Email Schedule

**Daily Summary** (8 AM):
- Yesterday's performance
- Open positions
- Today's schedule
- System health

**Weekly Report** (Monday 8 AM):
- Week performance
- Top trades
- Strategy performance comparison
- System uptime

**Critical Alerts** (Immediate):
- Same as Telegram CRITICAL
- Backup if Telegram fails

### Example Daily Email

```
Subject: DSTB Trading Bot - Daily Summary (2026-02-04)

Hi,

Here's your daily trading summary:

Performance (Feb 4, 2026):
  Total P&L: +$123.70 (+0.82%)
  Equity: $15,123.70
  Trades: 5 (4 winners, 1 loser)
  Win Rate: 80%

Bots Running: 3
  ✅ ORB BTC Aggressive: +$234.50
  ❌ ORB BTC Conservative: -$110.80
  ⏸️ CME Gap ETH: No trades (waiting for setup)

Current Positions:
  LONG 0.1 BTC @ 45,000 (+$50.00)

System Health: ✅ All Clear
  - No errors in last 24h
  - All bots heartbeat healthy
  - Memory usage normal

Next scheduled activity:
  - CME Gap ETH: Waiting for Friday close

---
DSTB Trading Bot
View live dashboard: [Google Sheets Link]
```

---

## Dashboard on Phone

### For You (Technical User)

**Install:**
1. Telegram app (for alerts)
2. Google Sheets app (for dashboard)
3. Gmail app (for daily summaries)

**Daily Routine:**
```
Morning:
1. Check Telegram for overnight alerts
2. Open Google Sheet → check equity
3. Read daily email summary

During Day:
1. Telegram notifies you of trades
2. Check Sheets if curious about positions

Evening:
1. Review trades in Google Sheet
2. Check performance metrics
```

### For Your Partner (Non-Technical)

**Install:**
1. Google Sheets app only

**What They See:**
- Bookmark the Google Sheet link
- Open anytime to check:
  - Current equity (are we making money?)
  - Today's P&L (up or down today?)
  - Open positions (what are we trading?)
  - Bot status (is everything running?)

**No technical knowledge needed!**

---

## Monitoring Best Practices

### 1. Check Daily

- [ ] Morning: Read daily email
- [ ] Morning: Check Telegram for errors
- [ ] Evening: Review Google Sheet performance

### 2. Act on Alerts

**CRITICAL Alert Received:**
1. Check bot status immediately
2. If real issue: Stop bot
3. Investigate logs
4. Fix issue
5. Restart when safe

**WARNING Alert:**
1. Note the issue
2. Monitor if it repeats
3. Investigate if frequent

### 3. Weekly Review

- [ ] Review performance metrics
- [ ] Check if strategy adjustments needed
- [ ] Verify all monitoring still working
- [ ] Clear old logs

### 4. Test Monitoring

```bash
# Send test alerts (monthly)
node dist/test-alerts.js
```

Verify you receive:
- Telegram message
- Email
- Google Sheet updates

---

## Troubleshooting

### Telegram Not Working

**Check:**
1. Bot token correct in .env?
2. Chat ID correct?
3. Internet connection working?

**Test:**
```bash
curl -X POST "https://api.telegram.org/bot<TOKEN>/sendMessage" \
  -d "chat_id=<CHAT_ID>" \
  -d "text=Test message"
```

### Google Sheets Not Updating

**Check:**
1. Service account key file exists?
2. Sheet ID correct?
3. Service account has Editor access?
4. Google Sheets API enabled?

**Test:**
```bash
node dist/test-google-sheets.js
```

### Email Not Sending

**Check:**
1. App password (not regular password)
2. 2-Step Verification enabled
3. SMTP settings correct
4. Internet/firewall not blocking port 587

**Test:**
```bash
node dist/test-email.js
```

---

## Cost

- **Telegram:** Free
- **Google Sheets:** Free (up to 10M cells)
- **Email (Gmail):** Free
- **Total:** $0/month

---

## Privacy & Security

### Telegram
- Bot token: Keep secret (don't share)
- Chat ID: Not sensitive (just a number)
- Messages: Encrypted by Telegram

### Google Sheets
- Service account key: Keep secret (like a password)
- Sheet link: Anyone with link can view (don't share publicly)
- Data: In your Google account (not public)

### Email
- App password: Keep secret
- Emails: In your Gmail (secure)

**Never:**
- Commit secrets to git
- Share bot tokens publicly
- Post API keys in sheets/emails

---

## Advanced: Custom Monitoring

### Webhook Alerts

Send alerts to custom webhook:

```typescript
// In bot config
"monitoring": {
  "webhook": {
    "url": "https://your-server.com/alerts",
    "method": "POST",
    "headers": {
      "Authorization": "Bearer your-token"
    }
  }
}
```

### Discord Integration

Similar to Telegram, use Discord webhook:

```env
DISCORD_WEBHOOK_URL=https://discord.com/api/webhooks/...
```

### Slack Integration

Use Slack incoming webhook for team notifications.

---

## References

- [New Architecture](./30-new-architecture.md)
- [Deployment Guide](./32-deployment-guide.md)
- [CLI Reference](./33-cli-reference.md)
- [Telegram Bot API](https://core.telegram.org/bots/api)
- [Google Sheets API](https://developers.google.com/sheets/api)

---

## Core Integration (src/monitoring)

Use the monitoring classes in `src/monitoring` to wire alerts and reporting into the core bot runtime.

```typescript
import { Logger } from "../src/core/Logger";
import { StateManager } from "../src/core/StateManager";
import { TelegramAlerter } from "../src/monitoring/TelegramAlerter";
import { GoogleSheetsReporter } from "../src/monitoring/GoogleSheetsReporter";
import { EmailAlerter } from "../src/monitoring/EmailAlerter";

const logger = new Logger("monitoring", "logs");
const stateManager = new StateManager({
  dbPath: "data/bot-state.db",
  schemaPath: "data/schema.sql",
  logger
});

const telegram = TelegramAlerter.fromEnv({
  stateManager,
  logger,
  onStopBot: async (botId) => {
    // Call your bot controller to stop a running bot.
    return true;
  }
});
telegram.startPolling();

const sheets = GoogleSheetsReporter.fromEnv({ stateManager, logger });
sheets.start();

const email = EmailAlerter.fromEnv({ stateManager, logger });
email.start();
```
