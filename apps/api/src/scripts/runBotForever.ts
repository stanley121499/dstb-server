#!/usr/bin/env tsx

/**
 * Bot Runner with Automatic Restart
 * 
 * This script runs a bot continuously and automatically restarts it if it crashes.
 * Perfect for running bots 24/7 with maximum reliability.
 * 
 * Features:
 * - Automatic restart on crashes
 * - Exponential backoff for repeated failures
 * - Graceful shutdown on Ctrl+C
 * - Detailed logging of start/stop events
 * 
 * Usage:
 *   npm run bot:forever -- --config bot-live-bitunix.json
 */

import { spawn, type ChildProcess } from "node:child_process";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

/**
 * ANSI color codes for terminal output
 */
const colors = {
  green: "\x1b[32m",
  red: "\x1b[31m",
  yellow: "\x1b[33m",
  blue: "\x1b[34m",
  magenta: "\x1b[35m",
  cyan: "\x1b[36m",
  reset: "\x1b[0m",
  bold: "\x1b[1m"
};

/**
 * Configuration
 */
const MAX_RESTART_DELAY_MS = 60_000; // 1 minute max delay
const MIN_RESTART_DELAY_MS = 1_000; // 1 second min delay
const RESTART_DELAY_MULTIPLIER = 2; // Exponential backoff
const HEALTHY_RUN_TIME_MS = 300_000; // 5 minutes - if bot runs this long, reset failure count

/**
 * State tracking
 */
let botProcess: ChildProcess | null = null;
let failureCount = 0;
let lastStartTime = 0;
let isShuttingDown = false;
let restartTimeout: NodeJS.Timeout | null = null;

/**
 * Parse command line arguments
 */
function parseArgs(): { configPath: string } | null {
  const args = process.argv.slice(2);
  const configIndex = args.indexOf("--config");
  
  if (configIndex === -1 || configIndex === args.length - 1) {
    console.error(`${colors.red}Error: Missing --config argument${colors.reset}`);
    console.error(`Usage: npm run bot:forever -- --config <config-file.json>`);
    return null;
  }
  
  return {
    configPath: args[configIndex + 1]
  };
}

/**
 * Calculate restart delay with exponential backoff
 */
function getRestartDelay(): number {
  const delay = MIN_RESTART_DELAY_MS * Math.pow(RESTART_DELAY_MULTIPLIER, failureCount);
  return Math.min(delay, MAX_RESTART_DELAY_MS);
}

/**
 * Format milliseconds to human-readable duration
 */
function formatDuration(ms: number): string {
  const seconds = Math.floor(ms / 1000);
  if (seconds < 60) {
    return `${seconds}s`;
  }
  const minutes = Math.floor(seconds / 60);
  const remainingSeconds = seconds % 60;
  if (minutes < 60) {
    return `${minutes}m ${remainingSeconds}s`;
  }
  const hours = Math.floor(minutes / 60);
  const remainingMinutes = minutes % 60;
  return `${hours}h ${remainingMinutes}m`;
}

/**
 * Log with timestamp
 */
function log(message: string, color = colors.reset): void {
  const timestamp = new Date().toISOString();
  console.log(`${colors.cyan}[${timestamp}]${colors.reset} ${color}${message}${colors.reset}`);
}

/**
 * Start the bot process
 */
function startBot(configPath: string): void {
  if (isShuttingDown) {
    return;
  }
  
  lastStartTime = Date.now();
  log(`${colors.bold}🚀 Starting bot (attempt ${failureCount + 1})...${colors.reset}`, colors.green);
  log(`   Config: ${configPath}`, colors.blue);
  
  // Spawn the bot process using npm run (which handles PATH correctly)
  const rootDir = join(__dirname, "..", "..");
  botProcess = spawn("npm", ["run", "bot:start", "--", "--config", configPath], {
    stdio: "inherit",
    cwd: rootDir,
    env: process.env,
    shell: true // Use shell to properly resolve npm
  });
  
  // Handle bot process exit
  botProcess.on("exit", (code: number | null, signal: string | null) => {
    const runTime = Date.now() - lastStartTime;
    const duration = formatDuration(runTime);
    
    botProcess = null;
    
    if (isShuttingDown) {
      log("Bot stopped (graceful shutdown)", colors.yellow);
      return;
    }
    
    if (code === 0) {
      log(`Bot exited normally after ${duration}`, colors.green);
      // Normal exit, don't restart
      process.exit(0);
      return;
    }
    
    // Check if bot ran long enough to be considered healthy
    if (runTime >= HEALTHY_RUN_TIME_MS) {
      log(`Bot ran successfully for ${duration} before exiting`, colors.green);
      failureCount = 0; // Reset failure count
    } else {
      failureCount++;
      log(`Bot crashed after ${duration} (failure count: ${failureCount})`, colors.red);
    }
    
    if (signal !== null) {
      log(`Bot was killed by signal: ${signal}`, colors.red);
    } else if (code !== null) {
      log(`Bot exited with code: ${code}`, colors.red);
    }
    
    // Schedule restart with backoff
    const delay = getRestartDelay();
    log(`Restarting in ${formatDuration(delay)}...`, colors.yellow);
    
    restartTimeout = setTimeout(() => {
      restartTimeout = null;
      startBot(configPath);
    }, delay);
  });
  
  // Handle bot process errors
  botProcess.on("error", (err: Error) => {
    log(`Failed to start bot process: ${err.message}`, colors.red);
    failureCount++;
    
    const delay = getRestartDelay();
    log(`Retrying in ${formatDuration(delay)}...`, colors.yellow);
    
    restartTimeout = setTimeout(() => {
      restartTimeout = null;
      startBot(configPath);
    }, delay);
  });
}

/**
 * Graceful shutdown handler
 */
function shutdown(): void {
  if (isShuttingDown) {
    return;
  }
  
  isShuttingDown = true;
  log(`${colors.bold}🛑 Shutting down...${colors.reset}`, colors.yellow);
  
  // Cancel any pending restart
  if (restartTimeout !== null) {
    clearTimeout(restartTimeout);
    restartTimeout = null;
    log("Cancelled pending restart", colors.yellow);
  }
  
  // Kill bot process if running
  if (botProcess !== null) {
    log("Stopping bot process...", colors.yellow);
    botProcess.kill("SIGTERM");
    
    // Force kill after 10 seconds if it doesn't stop
    setTimeout(() => {
      if (botProcess !== null) {
        log("Force killing bot process...", colors.red);
        botProcess.kill("SIGKILL");
      }
    }, 10_000);
  } else {
    process.exit(0);
  }
}

/**
 * Main execution
 */
function main(): void {
  // Parse arguments
  const args = parseArgs();
  if (args === null) {
    process.exit(1);
  }
  
  // Print banner
  console.log(`${colors.bold}${colors.magenta}╔═══════════════════════════════════════════════════╗${colors.reset}`);
  console.log(`${colors.bold}${colors.magenta}║   Trading Bot - Auto-Restart Runner               ║${colors.reset}`);
  console.log(`${colors.bold}${colors.magenta}╚═══════════════════════════════════════════════════╝${colors.reset}\n`);
  
  log("Bot runner initialized", colors.green);
  log(`Press ${colors.bold}Ctrl+C${colors.reset} to stop`, colors.yellow);
  
  // Register shutdown handlers
  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);
  process.on("SIGHUP", shutdown);
  
  // Handle uncaught errors
  process.on("uncaughtException", (err: Error) => {
    log(`Uncaught exception in runner: ${err.message}`, colors.red);
    console.error(err.stack);
  });
  
  process.on("unhandledRejection", (reason: unknown) => {
    log(`Unhandled rejection in runner: ${String(reason)}`, colors.red);
  });
  
  // Start the bot
  startBot(args.configPath);
}

// Execute
main();
