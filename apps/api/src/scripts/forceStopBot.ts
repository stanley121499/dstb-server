#!/usr/bin/env tsx

/**
 * Force-stop a bot by updating its database status to "stopped"
 * Use this when the bot process died but database still shows "running"
 */

import { createClient } from "@supabase/supabase-js";
import dotenv from "dotenv";

// Load environment variables
dotenv.config();

const supabaseUrl = process.env.SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!supabaseUrl || !supabaseKey) {
  console.error("Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY");
  process.exit(1);
}

const supabase = createClient(supabaseUrl, supabaseKey);

/**
 * Force-stop a bot in the database
 */
async function forceStopBot(botId: string): Promise<void> {
  console.log(`Force-stopping bot ${botId}...`);

  const { data, error } = await supabase
    .from("bots")
    .update({
      status: "stopped",
      updated_at: new Date().toISOString(),
    })
    .eq("id", botId)
    .select()
    .single();

  if (error) {
    console.error("Failed to force-stop bot:", error);
    process.exit(1);
  }

  console.log("✅ Bot force-stopped successfully");
  console.log(`ID: ${data.id}`);
  console.log(`Name: ${data.name}`);
  console.log(`Status: ${data.status}`);
}

// Main execution
const botId = process.argv[2];

if (!botId) {
  console.error("Usage: tsx forceStopBot.ts <bot-id>");
  process.exit(1);
}

forceStopBot(botId)
  .then(() => {
    console.log("\nBot stopped successfully!");
    process.exit(0);
  })
  .catch((err) => {
    console.error("Fatal error:", err);
    process.exit(1);
  });
