# DSTB Trading Bot Documentation

**Version:** 2.0 (Simplified Architecture)  
**Status:** 🚧 In Implementation  
**Last Updated:** February 2026

## 📚 Documentation Index

This `/docs` folder is the **authoritative source of truth** for the DSTB trading bot.

---

## 🚀 Start Here

**New to the project?** Read these in order:

1. **[📖 New Architecture Overview](./30-new-architecture.md)** ⭐ **START HERE**
   - Why we refactored
   - System overview
   - Key changes from old system

2. **[🔌 Strategy Plugin Guide](./31-strategy-plugin-guide.md)**
   - How to create trading strategies
   - Examples: ORB-ATR, CME Gap, SMA Crossover
   - Testing and validation

3. **[🚀 Deployment Guide](./32-deployment-guide.md)**
   - Running on Windows/Linux
   - Process management (PM2, Windows Service)
   - Cloud deployment (Digital Ocean, Render)

4. **[💻 CLI Reference](./33-cli-reference.md)**
   - All available commands
   - Usage examples
   - Configuration files

5. **[📊 Monitoring Setup](./34-monitoring-setup.md)**
   - Telegram instant alerts
   - Google Sheets dashboard
   - Email reports

6. **[🔄 Migration Plan](./35-migration-plan.md)**
   - Step-by-step migration from old system
   - Testing checklist
   - Rollback plan

7. **[🤖 AI Agent Implementation](./36-ai-agent-implementation.md)** ⭐ **FOR IMPLEMENTERS**
   - Task breakdown (7 agents)
   - Parallelization strategy
   - Implementation order

---

## 📋 Reference Documentation

### Core Concepts (Still Valid)

- **[12-strategy-orb-atr.md](./12-strategy-orb-atr.md)** - ORB+ATR strategy specification
- **[18-dev-standards.md](./18-dev-standards.md)** - Coding standards and conventions
- **[00-glossary.md](./00-glossary.md)** - Terminology and definitions
- **[37-exchange-error-handling.md](./37-exchange-error-handling.md)** - Bitunix error handling + circuit breaker

### Legacy Documentation (Deprecated)

These docs describe the old monorepo system with frontend. They are kept for reference but are no longer the active architecture:

- ~~[01-overview.md](./01-overview.md)~~ - Old system overview
- ~~[11-architecture.md](./11-architecture.md)~~ - Old monorepo architecture
- ~~[16-ui-spec.md](./16-ui-spec.md)~~ - Frontend UI (removed)
- ~~[17-supabase-schema-and-migrations.md](./17-supabase-schema-and-migrations.md)~~ - Supabase (replaced with SQLite)
- ~~[20-monorepo-and-local-dev.md](./20-monorepo-and-local-dev.md)~~ - Old dev setup
- ~~[21-deployment-vercel-render.md](./21-deployment-vercel-render.md)~~ - Old deployment
- ~~[22-ai-agent-prompts.md](./22-ai-agent-prompts.md)~~ - Old implementation plan (replaced by 36-*)

---

## 🎯 Quick Links by Task

### I want to...

**...understand the new system**
→ Read [30-new-architecture.md](./30-new-architecture.md)

**...create a new trading strategy**
→ Read [31-strategy-plugin-guide.md](./31-strategy-plugin-guide.md)

**...run the bot on my computer**
→ Read [32-deployment-guide.md](./32-deployment-guide.md)

**...control bots from command line**
→ Read [33-cli-reference.md](./33-cli-reference.md)

**...set up alerts and monitoring**
→ Read [34-monitoring-setup.md](./34-monitoring-setup.md)

**...migrate from the old system**
→ Read [35-migration-plan.md](./35-migration-plan.md)

**...implement the new system**
→ Read [36-ai-agent-implementation.md](./36-ai-agent-implementation.md)

**...understand ORB strategy logic**
→ Read [12-strategy-orb-atr.md](./12-strategy-orb-atr.md)

---

## 📊 Current Status

### What's Implemented

- ✅ Live trading with ORB-ATR strategy
- ✅ Bitunix exchange integration
- ✅ Basic bot lifecycle management
- ✅ File-based logging
- ✅ CLI commands (partial)

### What's New (v2.0)

- ✅ Architecture redesign (docs complete)
- 🚧 Strategy plugin system (in progress)
- 🚧 Google Sheets monitoring (in progress)
- 🚧 Telegram alerts (in progress)
- 🚧 Hardened exchange layer (in progress)
- ⏳ SQLite state management (planned)
- ⏳ Multi-bot support (planned)

### What's Removed

- ❌ Frontend UI (`apps/web`) - Too complex to maintain
- ❌ Supabase database - Replaced with SQLite
- ❌ Express API server - Replaced with CLI
- ❌ WebSocket real-time updates - Not needed

---

## 🎯 For Different Roles

### For Developers/Implementers

**Start Here:**
1. [30-new-architecture.md](./30-new-architecture.md) - Understand the system
2. [36-ai-agent-implementation.md](./36-ai-agent-implementation.md) - Task breakdown
3. [18-dev-standards.md](./18-dev-standards.md) - Coding standards

**Key Docs:**
- [31-strategy-plugin-guide.md](./31-strategy-plugin-guide.md) - Plugin system
- [12-strategy-orb-atr.md](./12-strategy-orb-atr.md) - Strategy logic

### For Traders/Users

**Start Here:**
1. [30-new-architecture.md](./30-new-architecture.md) - What changed and why
2. [32-deployment-guide.md](./32-deployment-guide.md) - How to run the bot
3. [33-cli-reference.md](./33-cli-reference.md) - Available commands

**Key Docs:**
- [31-strategy-plugin-guide.md](./31-strategy-plugin-guide.md) - Create strategies
- [34-monitoring-setup.md](./34-monitoring-setup.md) - Setup alerts

### For AI Agents

**Start Here:**
1. [36-ai-agent-implementation.md](./36-ai-agent-implementation.md) - Your task assignments
2. [18-dev-standards.md](./18-dev-standards.md) - How to code
3. Relevant spec based on your assigned task

---

## 📝 Documentation Principles

### This Folder is Source of Truth

- **Code** implements what **docs** specify
- If code and docs conflict → fix the code or update docs with clear reasoning
- All major changes require doc updates

### Writing Style

- Clear, concise, actionable
- Include examples for complex topics
- Provide "why" not just "how"
- Keep up to date as system evolves

### File Naming Convention

- `00-09`: Glossary and overview
- `10-19`: Original system specs (mostly legacy)
- `20-29`: Development and deployment (mostly legacy)
- `30-39`: **New simplified system** (current focus)

---

## 🔄 Migration Timeline

- **Jan 2026:** Original system complete (Phase 1 + Phase 2 partial)
- **Feb 2026:** Refactor decision + new architecture design
- **Feb-Mar 2026:** Implementation of simplified system
- **Mar 2026:** Testing and gradual migration
- **Apr 2026:** Full cutover to new system

---

## 🆘 Getting Help

### Common Questions

**Q: Why did you remove the frontend?**
A: Out of scope, too complex to maintain. Google Sheets provides better solution for partner monitoring.

**Q: Why SQLite instead of Supabase?**
A: Simpler, no external dependencies, works offline, easier to backup.

**Q: Can I still use the old system?**
A: Yes, old code is archived, but new system is recommended for better stability.

**Q: How do I add a new strategy?**
A: See [Strategy Plugin Guide](./31-strategy-plugin-guide.md)

**Q: How do I run multiple bots?**
A: See [CLI Reference](./33-cli-reference.md) - each bot gets its own ID

**Q: How do I monitor bots?**
A: See [Monitoring Setup](./34-monitoring-setup.md) - Telegram + Google Sheets

### Documentation Issues

If you find errors, outdated info, or missing documentation:
1. Check if it's in a legacy doc (10-29 series)
2. Refer to new docs (30-39 series) for current system
3. Open an issue or update the docs directly

---

## 📚 External Resources

- **Luxon Documentation:** https://moment.github.io/luxon/
- **SQLite Documentation:** https://www.sqlite.org/docs.html
- **Telegram Bot API:** https://core.telegram.org/bots/api
- **Google Sheets API:** https://developers.google.com/sheets/api
- **Bitunix API:** https://openapidoc.bitunix.com/doc/

---

## 📖 Version History

### v2.0 (Feb 2026) - Simplified Architecture
- Removed frontend and Supabase
- Added strategy plugin system
- Added Google Sheets + Telegram monitoring
- Hardened exchange layer
- CLI-first approach

### v1.0 (Jan 2026) - Original System
- Full-stack monorepo
- React frontend + Express API
- Supabase database
- Backtesting + optimization
- Basic live trading

---

**Last Updated:** February 4, 2026  
**Maintained By:** Project team  
**Status:** Living documentation (updated as system evolves)
