-- Phase 2: allow dashboard Bot Grid to subscribe to live bot status/equity/heartbeat.
ALTER PUBLICATION supabase_realtime ADD TABLE bots;
