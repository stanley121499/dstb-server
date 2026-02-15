# Monitoring Credentials Setup Guide

Complete step-by-step guide to set up Telegram Bot, Google Sheets API, and Email for DSTB bot monitoring.

---

## 1. Telegram Bot Setup

### Step 1: Create a Telegram Bot

1. Open Telegram on your phone or desktop
2. Search for **@BotFather** (official Telegram bot for creating bots)
3. Start a chat with BotFather
4. Send the command: `/newbot`
5. Follow the prompts:
   - **Bot name**: Enter a display name (e.g., "DSTB Trading Alerts")
   - **Bot username**: Enter a unique username ending in "bot" (e.g., "dstb_trading_alerts_bot")
6. BotFather will reply with your **Bot Token** - save this!
   - Example: `1234567890:ABCdefGHIjklMNOpqrsTUVwxyz`

### Step 2: Get Your Chat ID

You need your personal chat ID so the bot knows where to send messages.

**Option A: Using @userinfobot**
1. Search for **@userinfobot** on Telegram
2. Start a chat with it
3. It will immediately send you your user ID
4. Save this number (e.g., `123456789`)

**Option B: Using your bot**
1. Start a chat with your newly created bot
2. Send any message to it
3. Open this URL in your browser (replace `YOUR_BOT_TOKEN`):
   ```
   https://api.telegram.org/botYOUR_BOT_TOKEN/getUpdates
   ```
4. Look for `"chat":{"id":123456789` in the JSON response
5. That number is your chat ID

### Step 3: Test Your Bot

Run this curl command to test (replace values):
```bash
curl -X POST "https://api.telegram.org/bot<YOUR_BOT_TOKEN>/sendMessage" \
  -H "Content-Type: application/json" \
  -d '{"chat_id": "<YOUR_CHAT_ID>", "text": "Test message from DSTB bot!"}'
```

You should receive the message on Telegram!

### Step 4: Add to .env file

```env
TELEGRAM_BOT_TOKEN=1234567890:ABCdefGHIjklMNOpqrsTUVwxyz
TELEGRAM_CHAT_ID=123456789
```

---

## 2. Google Sheets API Setup

### Step 1: Create a Google Cloud Project

1. Go to [Google Cloud Console](https://console.cloud.google.com/)
2. Click **"Select a project"** → **"New Project"**
3. Enter project name: "DSTB Trading Bot"
4. Click **"Create"**

### Step 2: Enable Google Sheets API

1. In your project, go to **"APIs & Services"** → **"Library"**
2. Search for **"Google Sheets API"**
3. Click on it and press **"Enable"**
4. Also enable **"Google Drive API"** (needed for file access)

### Step 3: Create Service Account

1. Go to **"APIs & Services"** → **"Credentials"**
2. Click **"Create Credentials"** → **"Service Account"**
3. Enter details:
   - **Service account name**: "dstb-bot-service"
   - **Service account ID**: (auto-filled)
   - Click **"Create and Continue"**
4. **Grant access** (optional): Skip this step, click **"Continue"**
5. Click **"Done"**

### Step 4: Generate Service Account Key

1. Click on the newly created service account email
2. Go to **"Keys"** tab
3. Click **"Add Key"** → **"Create new key"**
4. Choose **JSON** format
5. Click **"Create"**
6. A JSON file will download - **SAVE THIS SECURELY!**

### Step 5: Create Google Sheet

1. Go to [Google Sheets](https://sheets.google.com)
2. Create a new spreadsheet
3. Name it: "DSTB Trading Dashboard"
4. Copy the **Sheet ID** from the URL:
   ```
   https://docs.google.com/spreadsheets/d/SHEET_ID_HERE/edit
   ```
5. Click **"Share"** button
6. Add the service account email (from the JSON file, looks like `xxx@xxx.iam.gserviceaccount.com`)
7. Give it **"Editor"** permissions
8. Click **"Send"**

### Step 6: Add to .env file

```env
GOOGLE_SHEETS_ID=1a2b3c4d5e6f7g8h9i0j
GOOGLE_SERVICE_ACCOUNT_EMAIL=dstb-bot-service@your-project.iam.gserviceaccount.com
```

### Step 7: Save the Service Account JSON

Move the downloaded JSON file to your project:
```bash
# Create a secure directory
mkdir -p e:/Dev/GitHub/dstb-server/secrets

# Move the file (rename it)
move Downloads\your-project-*.json e:\Dev\GitHub\dstb-server\secrets\google-credentials.json
```

Add to `.env`:
```env
GOOGLE_CREDENTIALS_PATH=./secrets/google-credentials.json
```

**IMPORTANT**: Add `secrets/` to `.gitignore` to prevent committing credentials!

---

## 3. Email (SMTP) Setup

You have several options for email alerts. Choose the easiest for you:

### Option A: Gmail (Recommended for Testing)

1. Go to your [Google Account Settings](https://myaccount.google.com/)
2. Navigate to **Security** → **2-Step Verification** (enable if not already)
3. Scroll down to **App passwords**
4. Click **"App passwords"**
5. Select:
   - **App**: Mail
   - **Device**: Other (Custom name) → "DSTB Bot"
6. Click **"Generate"**
7. Copy the 16-character password (e.g., `abcd efgh ijkl mnop`)

Add to `.env`:
```env
EMAIL_SMTP_HOST=smtp.gmail.com
EMAIL_SMTP_PORT=587
EMAIL_SMTP_SECURE=false
EMAIL_SMTP_USER=your.email@gmail.com
EMAIL_SMTP_PASS=abcdefghijklmnop
EMAIL_FROM=your.email@gmail.com
EMAIL_TO=your.email@gmail.com
```

### Option B: Outlook/Hotmail

```env
EMAIL_SMTP_HOST=smtp-mail.outlook.com
EMAIL_SMTP_PORT=587
EMAIL_SMTP_SECURE=false
EMAIL_SMTP_USER=your.email@outlook.com
EMAIL_SMTP_PASS=your_password
EMAIL_FROM=your.email@outlook.com
EMAIL_TO=your.email@outlook.com
```

### Option C: Custom SMTP (e.g., SendGrid, Mailgun)

If you use a service like SendGrid:
```env
EMAIL_SMTP_HOST=smtp.sendgrid.net
EMAIL_SMTP_PORT=587
EMAIL_SMTP_SECURE=false
EMAIL_SMTP_USER=apikey
EMAIL_SMTP_PASS=your_sendgrid_api_key
EMAIL_FROM=alerts@yourdomain.com
EMAIL_TO=your.email@gmail.com
```

---

## 4. Complete .env Example

Here's what your complete `.env` file should look like:

```env
# Bitunix API (you should already have these)
BITUNIX_API_KEY=your_bitunix_api_key
BITUNIX_SECRET_KEY=your_bitunix_secret_key

# Telegram Bot
TELEGRAM_BOT_TOKEN=1234567890:ABCdefGHIjklMNOpqrsTUVwxyz
TELEGRAM_CHAT_ID=123456789

# Google Sheets
GOOGLE_SHEETS_ID=1a2b3c4d5e6f7g8h9i0j
GOOGLE_SERVICE_ACCOUNT_EMAIL=dstb-bot-service@your-project.iam.gserviceaccount.com
GOOGLE_CREDENTIALS_PATH=./secrets/google-credentials.json

# Email (Gmail example)
EMAIL_SMTP_HOST=smtp.gmail.com
EMAIL_SMTP_PORT=587
EMAIL_SMTP_SECURE=false
EMAIL_SMTP_USER=your.email@gmail.com
EMAIL_SMTP_PASS=abcdefghijklmnop
EMAIL_FROM=your.email@gmail.com
EMAIL_TO=your.email@gmail.com
```

---

## 5. Verify Setup

Once you've added all credentials, run the validation script:

```bash
# This script will test all three monitoring systems
npx tsx src/scripts/monitoring-validation.ts
```

Expected output:
```
🔍 Testing Telegram Bot...
✅ Telegram: Message sent successfully

🔍 Testing Google Sheets...
✅ Google Sheets: Row updated successfully

🔍 Testing Email...
✅ Email: Email sent successfully

✨ All monitoring systems configured correctly!
```

---

## Troubleshooting

### Telegram Issues

**Problem**: "Bot token is invalid"
- **Solution**: Double-check your token from BotFather
- Make sure there are no extra spaces

**Problem**: "Chat not found"
- **Solution**: Make sure you've sent at least one message to your bot first
- Verify your chat ID is correct

### Google Sheets Issues

**Problem**: "Permission denied"
- **Solution**: Make sure you shared the sheet with the service account email
- Grant "Editor" permissions, not just "Viewer"

**Problem**: "API not enabled"
- **Solution**: Enable both "Google Sheets API" and "Google Drive API" in your project

**Problem**: "Service account key not found"
- **Solution**: Check that the JSON file path in `.env` is correct
- Use relative paths from project root

### Email Issues

**Problem**: "Authentication failed" (Gmail)
- **Solution**: Use an App Password, not your regular Gmail password
- Make sure 2-Step Verification is enabled first

**Problem**: "Connection timeout"
- **Solution**: Check your firewall/antivirus isn't blocking port 587
- Try port 465 with `EMAIL_SMTP_SECURE=true`

---

## Security Best Practices

1. **Never commit `.env` file** - Add it to `.gitignore`
2. **Keep `secrets/` directory private** - Add to `.gitignore`
3. **Rotate credentials periodically** - Every 3-6 months
4. **Use separate bot for production** - Don't use same bot for testing
5. **Limit Google Sheet access** - Only share with necessary accounts
6. **Use environment variables on server** - Don't store credentials in code

---

## Next Steps

After setting up all credentials:

1. ✅ Run the validation script to test everything
2. ✅ Test each system individually
3. ✅ Proceed with 48-hour paper trading test
4. ✅ Monitor alerts during the test period
