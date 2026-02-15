# Migration Plan: Old System → New Simplified System

**Status:** 🚧 In Implementation  
**Last Updated:** February 2026

## Overview

This document provides a **step-by-step plan** for migrating from the old monorepo system (with frontend + Supabase) to the new simplified CLI-based system.

## Migration Strategy

**Approach:** **Gradual migration with parallel running**

1. Keep old system running
2. Build and test new system in parallel
3. Migrate bots one at a time
4. Verify each bot before migrating next
5. Archive old system after full migration

**Timeline:** 2-3 weeks

---

## Pre-Migration Checklist

### Data Backup

- [ ] **Export all backtest results** from Supabase
  ```sql
  -- Export to CSV
  COPY (SELECT * FROM backtest_runs) TO '/tmp/backtest_runs.csv' CSV HEADER;
  COPY (SELECT * FROM backtest_trades) TO '/tmp/backtest_trades.csv' CSV HEADER;
  ```

- [ ] **Backup current bot configs** from Supabase
  ```sql
  COPY (SELECT * FROM bots) TO '/tmp/bots_backup.csv' CSV HEADER;
  ```

- [ ] **Export parameter sets** for reference
  ```sql
  COPY (SELECT * FROM parameter_sets) TO '/tmp/parameter_sets.csv' CSV HEADER;
  ```

- [ ] **Save logs** from current bots
  ```bash
  cp -r apps/api/logs/ backups/logs-$(date +%Y-%m-%d)/
  ```

### Environment Preparation

- [ ] **Test new system on separate machine** (if possible)
- [ ] **Verify all dependencies installed** (Node 18+, npm 9+)
- [ ] **Create Telegram bot** (for alerts)
- [ ] **Setup Google Sheets** (for monitoring)
- [ ] **Test with paper trading** (48 hours minimum)

---

## Phase 1: Build New System (Week 1)

### Implement Core Components

Follow [AI Agent Implementation Guide](./36-ai-agent-implementation.md):

- [ ] **Agent 1:** Core Infrastructure (SQLite, logging, config)
- [ ] **Agent 2:** Strategy Plugin System (ORB migration)
- [ ] **Agent 3:** Exchange Layer Hardening

**Deliverables:**
- Working SQLite database
- ORB strategy as plugin
- Hardened Bitunix adapter

**Testing:**
```bash
# Test strategy backtest
bot backtest --config configs/strategies/orb-btc-15m.json \
  --start 2024-01-01 --end 2024-12-31

# Compare with old system results
# Should be within ±1%
```

---

## Phase 2: Add Bot Engine & Monitoring (Week 2)

### Implement Remaining Components

- [ ] **Agent 4:** Simplified Bot Engine
- [ ] **Agent 5:** Monitoring & Alerts (Telegram + Google Sheets)

**Deliverables:**
- Working TradingBot class
- Telegram alerts functional
- Google Sheets updating

**Testing:**
```bash
# Start paper trading
bot start --config configs/strategies/orb-btc-15m.json --paper

# Let run for 48 hours
# Verify:
# - Telegram alerts received
# - Google Sheets updates
# - Logs look correct
# - No crashes

# Compare P&L with backtest
# Should be within ±5%
```

---

## Phase 3: Migrate First Bot (Week 3)

### Migration Steps for Each Bot

#### 1. Export Bot Config from Old System

```bash
# In old system (apps/api/)
node dist/scripts/export-bot-config.js --bot-id <old-bot-id> \
  --output configs/strategies/migrated-bot-1.json
```

This creates a new-system-compatible config file.

#### 2. Test with Paper Trading

```bash
# In new system
bot start --config configs/strategies/migrated-bot-1.json --paper

# Run for 24 hours minimum
# Compare with old bot's performance
```

#### 3. Stop Old Bot

```bash
# In old system
npm run bot:stop -- --id <old-bot-id>

# Verify position closed
npm run bot:status -- --id <old-bot-id>
```

#### 4. Start New Bot (Live)

```bash
# In new system
bot start --config configs/strategies/migrated-bot-1.json --daemon

# Verify started
bot status

# Monitor closely for first hour
bot logs --follow
```

#### 5. Verify New Bot

**Checklist:**
- [ ] Bot shows "running" status
- [ ] Heartbeat updating (< 1 min old)
- [ ] Telegram alerts working
- [ ] Google Sheets updating
- [ ] Logs show normal operation
- [ ] No error messages

**Watch for 24 hours:**
- [ ] Bot doesn't crash
- [ ] Trades execute correctly
- [ ] P&L tracking accurate
- [ ] Stops and TPs work

#### 6. Document Results

```
Migration Report: Bot 1

Old System Performance (last 7 days):
  - Total Trades: 12
  - Win Rate: 58%
  - P&L: +$234.50

New System Performance (first 7 days):
  - Total Trades: 11
  - Win Rate: 55%
  - P&L: +$212.30

Difference: -9.5% P&L (within acceptable range ±10%)
Issues: None
Status: ✅ Migration successful
```

#### 7. Migrate Next Bot

Repeat steps 1-6 for each remaining bot.

---

## Data Migration

### Trade History

**Option 1: Keep in Supabase (Read-Only)**
```typescript
// Add Supabase read-only client to new system
// For viewing historical trades only
// Don't write new trades to Supabase
```

**Option 2: Export to CSV**
```bash
# Export old trades
node dist/scripts/export-trades.js --output historical-trades.csv

# Import to new system (optional)
node dist/scripts/import-historical-trades.js --input historical-trades.csv
```

**Option 3: Start Fresh**
```
- Keep old Supabase for historical reference
- New system tracks new trades in SQLite
- Historical performance calculated from old system exports
```

**Recommendation:** Option 3 (start fresh)

### Parameter Sets

**Export from old system:**
```bash
node dist/scripts/export-all-params.js --output params-library/
```

This creates JSON files for each parameter set.

**Convert to new format (if needed):**
```bash
node dist/scripts/convert-params.js --input params-library/ \
  --output configs/strategies/
```

---

## Rollback Plan

### If Migration Fails

**Scenario 1: New bot crashes repeatedly**
```bash
# Stop new bot
bot emergency-stop-all

# Restart old bot
cd old-system/apps/api
npm run bot:start -- --config <old-config>

# Investigate issue
bot logs <new-bot-id> --level error
```

**Scenario 2: Performance significantly worse**
```
If new system P&L > 20% worse than old system after 1 week:
1. Stop new bot
2. Restart old bot  
3. Report issue for investigation
4. Don't proceed with more migrations
```

**Scenario 3: Data loss or corruption**
```bash
# Restore from backup
cp backups/bot-state-<date>.db data/bot-state.db

# Restart bot
bot restart <bot-id>
```

---

## Parallel Running Period

**Duration:** 1 week per bot (after migration)

**Setup:**
```
Computer 1: Old system (1 bot)
Computer 2: New system (same bot config)

Both running same strategy on same symbol
Compare results daily
```

**Success Criteria:**
- New system P&L within ±10% of old system
- New system has fewer errors
- New system doesn't crash
- Monitoring working correctly

**If criteria met:** Proceed to migrate next bot

---

## Post-Migration Cleanup

### After All Bots Migrated Successfully

#### 1. Archive Old System

```bash
# Stop all old bots
cd old-system/apps/api
npm run bot:emergency-stop-all

# Backup old system
cd ..
tar -czf dstb-old-system-$(date +%Y-%m-%d).tar.gz .

# Move to archive
mkdir -p ~/archives/
mv dstb-old-system-*.tar.gz ~/archives/
```

#### 2. Keep Supabase (Read-Only)

```
- Don't delete Supabase project
- Keep for historical trade data
- Downgrade to free tier if possible
- Export critical data to CSV for backup
```

#### 3. Archive Frontend

```bash
# Old system: apps/web/
mv apps/web/ archived/web-$(date +%Y-%m-%d)/
```

#### 4. Update Documentation

- [ ] Mark old docs as deprecated
- [ ] Update README with migration complete status
- [ ] Document any issues encountered
- [ ] Update team on new system usage

---

## Training & Handoff

### For You (Technical User)

**New Commands to Learn:**
```bash
# Old: npm run bot:start -- --config bot.json
# New: bot start --config bot.json

# Old: npm run bot:stop -- --id <id>
# New: bot stop <id>

# Old: npm run bot:logs -- --id <id>
# New: bot logs <id> --follow
```

**New Monitoring:**
- Check Telegram for alerts (not web dashboard)
- Check Google Sheets for performance (not Supabase)
- Use CLI for bot control (not API)

### For Your Partner (Non-Technical)

**What Changed:**
- No more web dashboard
- Instead: Google Sheets (simpler!)

**New Routine:**
1. Open Google Sheets bookmark
2. Check equity and P&L
3. That's it!

**Training:**
```
Show partner:
1. How to open Google Sheets on phone
2. What each column means
3. How to check if bots are running (Status column)
4. When to alert you (if Status shows "error")
```

---

## Troubleshooting Migration Issues

### Issue: New bot won't start

**Check:**
```bash
# Verify config file valid
cat configs/strategies/bot.json | jq

# Check environment variables
cat .env | grep BITUNIX

# Check logs
tail -f logs/bot-$(date +%Y-%m-%d).log
```

### Issue: Strategy results don't match

**Verify:**
```bash
# Run backtest on same period
# Old system:
npm run backtest -- --start 2024-01-01 --end 2024-12-31

# New system:
bot backtest --config bot.json --start 2024-01-01 --end 2024-12-31

# Compare results (should be within ±1%)
```

**Common causes:**
- Session timezone handling different
- ATR calculation difference
- Fee/slippage model changed

**Solution:** Review strategy plugin implementation

### Issue: Missing historical data

**Options:**
1. Export from Supabase to CSV
2. Query Supabase via separate script
3. Start fresh (recommended)

### Issue: Monitoring not working

**Telegram:**
```bash
node dist/test-telegram.js
# Verify receives message
```

**Google Sheets:**
```bash
node dist/test-google-sheets.js
# Verify sheet updates
```

---

## Success Criteria

### Migration Complete When:

- [ ] All bots migrated to new system
- [ ] All bots running >7 days without issues
- [ ] Performance within ±10% of old system
- [ ] Telegram alerts working
- [ ] Google Sheets updating
- [ ] No critical errors in logs
- [ ] Partner can monitor via Google Sheets
- [ ] Old system fully stopped
- [ ] Old system backed up
- [ ] Documentation updated

---

## Timeline Summary

**Week 1:**
- Day 1-2: Implement core infrastructure
- Day 3-4: Implement strategy plugins
- Day 5-7: Implement exchange hardening + testing

**Week 2:**
- Day 1-2: Implement bot engine
- Day 3-4: Implement monitoring
- Day 5-7: Paper trading validation (48h)

**Week 3:**
- Day 1-2: Migrate first bot
- Day 3: Monitor first bot
- Day 4-5: Migrate second bot (if multiple)
- Day 6-7: Final testing and cleanup

**Week 4 (Optional):**
- Continue monitoring
- Optimize based on learnings
- Archive old system
- Update documentation

---

## Rollback Decision Tree

```
Is new system working?
├─ YES → Continue migration
└─ NO → Investigate issue
    ├─ Minor bug? → Fix and retry
    ├─ Major bug? → Rollback to old system
    └─ Unknown? → Keep old system running, investigate in parallel
```

**Rollback if:**
- New system crashes >3 times in 24h
- Performance >20% worse than old system
- Critical data loss
- Unable to fix bugs within 3 days
- Partner can't use monitoring system

**Don't rollback if:**
- Minor performance difference (<10%)
- Small bugs that don't affect trading
- Cosmetic issues
- Learning curve

---

## References

- [New Architecture](./30-new-architecture.md)
- [AI Agent Implementation](./36-ai-agent-implementation.md)
- [Deployment Guide](./32-deployment-guide.md)
- [CLI Reference](./33-cli-reference.md)
- [Monitoring Setup](./34-monitoring-setup.md)
