# How to View Bot Logs

Your bot IS running! Bot ID: **0ef044ce-09f9-4151-9d25-fbb9fb0163fc**

## ✅ Current Status:
```
Bot is running in paper trading mode
Waiting for NY trading session (9:30 AM ET)
```

---

## 📊 3 Ways to View Logs:

### Option 1: Using PowerShell (Recommended)
```powershell
# Follow logs in real-time
Get-Content logs\bot-0ef044ce-09f9-4151-9d25-fbb9fb0163fc-2026-02-05.log -Wait

# Or view last 50 lines
Get-Content logs\bot-0ef044ce-09f9-4151-9d25-fbb9fb0163fc-2026-02-05.log -Tail 50
```

### Option 2: Using CLI logs command
```bash
# View logs (without --follow for now, has a bug)
npm run bot -- logs 0ef044ce-09f9-4151-9d25-fbb9fb0163fc --tail 50
```

### Option 3: Open log file directly
Open in your editor:
```
logs/bot-0ef044ce-09f9-4151-9d25-fbb9fb0163fc-2026-02-05.log
```

---

## 📝 What the Bot is Doing Now:

```
✅ Bot started successfully
✅ Reconciled positions (none found - correct)
✅ Strategy initialized with 21 warmup candles  
⏳ Waiting for NY trading session to start (9:30 AM)
```

The bot won't trade until the NY market session starts at 9:30 AM ET.

---

## 🛑 To Stop the Bot:

```bash
npm run bot -- stop 0ef044ce-09f9-4151-9d25-fbb9fb0163fc
```

Or stop all:
```bash
npm run bot -- stop --all
```

---

## 🔴 To Run LIVE (Real Money):

**ONLY when you're ready:**

1. First stop the paper trading bot:
   ```bash
   npm run bot -- stop --all
   ```

2. Make sure your `.env` file has real API keys:
   ```env
   BITUNIX_API_KEY=your-real-key
   BITUNIX_SECRET_KEY=your-real-secret
   ```

3. Start LIVE:
   ```bash
   npm run bot -- start --config configs/bot-live-eth-bitunix.json
   ```

4. View logs:
   ```powershell
   Get-Content logs\bot-<new-id>-2026-02-05.log -Wait
   ```

---

## ⚠️ Known Issue:

The `--daemon` mode and `--follow` flag have bugs on Windows. For now:
- ✅ Run in foreground (without --daemon)  
- ✅ Use PowerShell `Get-Content -Wait` to follow logs
- ❌ Don't use `--daemon` mode yet
- ❌ Don't use `--follow` flag yet

---

## 💡 Quick Reference:

| Command | What it does |
|---------|-------------|
| `npm run bot -- status` | Show all bots |
| `Get-Content logs\bot-*.log -Wait` | Follow logs live |
| `npm run bot -- stop --all` | Stop all bots |
| `npm run bot -- start --config <path>` | Start live |
| `npm run bot -- start --config <path> --paper` | Start paper |

---

Your bot is working perfectly! 🎉
