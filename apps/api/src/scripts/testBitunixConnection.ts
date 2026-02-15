#!/usr/bin/env tsx

/**
 * Test script to verify Bitunix API connectivity and authentication
 * 
 * This script tests all critical endpoints that the bot uses:
 * - Public: Market data (candles)
 * - Private: Account balance, positions, open orders
 * 
 * Run this script to ensure there are no network errors before starting the bot.
 */

import dotenv from "dotenv";
import { BitunixAdapter } from "../exchange/BitunixAdapter.js";

// Load environment variables
dotenv.config();

/**
 * ANSI color codes for terminal output
 */
const colors = {
  green: "\x1b[32m",
  red: "\x1b[31m",
  yellow: "\x1b[33m",
  blue: "\x1b[34m",
  reset: "\x1b[0m",
  bold: "\x1b[1m"
};

/**
 * Test result tracking
 */
type TestResult = {
  name: string;
  success: boolean;
  error?: string;
  data?: unknown;
};

const results: Array<TestResult> = [];

/**
 * Helper to print test results
 */
function printResult(result: TestResult): void {
  const icon = result.success ? "✅" : "❌";
  const color = result.success ? colors.green : colors.red;
  
  console.log(`\n${color}${icon} ${result.name}${colors.reset}`);
  
  if (result.success && result.data !== undefined) {
    console.log(`   ${colors.blue}Data:${colors.reset}`, JSON.stringify(result.data, null, 2));
  }
  
  if (!result.success && result.error !== undefined) {
    console.log(`   ${colors.red}Error:${colors.reset}`, result.error);
  }
}

/**
 * Main test execution
 */
async function runTests(): Promise<void> {
  console.log(`${colors.bold}${colors.blue}╔════════════════════════════════════════════════╗${colors.reset}`);
  console.log(`${colors.bold}${colors.blue}║   Bitunix API Connection Test                  ║${colors.reset}`);
  console.log(`${colors.bold}${colors.blue}╚════════════════════════════════════════════════╝${colors.reset}\n`);

  // Step 1: Validate environment variables
  console.log(`${colors.yellow}📋 Checking environment variables...${colors.reset}`);
  
  const apiKey = process.env.BITUNIX_API_KEY;
  const secretKey = process.env.BITUNIX_SECRET_KEY;
  
  if (!apiKey || apiKey.trim().length === 0) {
    console.log(`${colors.red}❌ BITUNIX_API_KEY is missing or empty${colors.reset}`);
    process.exit(1);
  }
  
  if (!secretKey || secretKey.trim().length === 0) {
    console.log(`${colors.red}❌ BITUNIX_SECRET_KEY is missing or empty${colors.reset}`);
    process.exit(1);
  }
  
  console.log(`${colors.green}✅ API Key: ${apiKey.substring(0, 8)}...${apiKey.substring(apiKey.length - 4)}${colors.reset}`);
  console.log(`${colors.green}✅ Secret Key: ${secretKey.substring(0, 8)}...${secretKey.substring(secretKey.length - 4)}${colors.reset}`);

  // Step 2: Create adapter instance
  console.log(`\n${colors.yellow}🔧 Creating Bitunix adapter...${colors.reset}`);
  
  let adapter: BitunixAdapter;
  try {
    adapter = new BitunixAdapter({
      symbol: "ETH-USD",
      interval: "1h",
      apiKey,
      secretKey,
      testMode: false,
      marketType: "futures"
    });
    console.log(`${colors.green}✅ Adapter created successfully${colors.reset}`);
  } catch (error) {
    console.log(`${colors.red}❌ Failed to create adapter:${colors.reset}`, error);
    process.exit(1);
  }

  // Step 3: Connect to exchange
  console.log(`\n${colors.yellow}🔌 Connecting to Bitunix...${colors.reset}`);
  
  try {
    await adapter.connect();
    results.push({
      name: "Connect to Exchange",
      success: true
    });
    console.log(`${colors.green}✅ Connected successfully${colors.reset}`);
  } catch (error) {
    results.push({
      name: "Connect to Exchange",
      success: false,
      error: String(error)
    });
    console.log(`${colors.red}❌ Connection failed:${colors.reset}`, error);
    process.exit(1);
  }

  // Step 4: Test public endpoint - Get latest candles
  console.log(`\n${colors.yellow}📊 Testing public endpoint: Get Latest Candles...${colors.reset}`);
  
  try {
    const candles = await adapter.getLatestCandles({ limit: 5 });
    results.push({
      name: "Get Latest Candles (Public)",
      success: true,
      data: {
        count: candles.length,
        latest: candles.length > 0 ? {
          timestamp: candles[0]?.timestamp,
          close: candles[0]?.close
        } : null
      }
    });
    printResult(results[results.length - 1] as TestResult);
  } catch (error) {
    results.push({
      name: "Get Latest Candles (Public)",
      success: false,
      error: String(error)
    });
    printResult(results[results.length - 1] as TestResult);
  }

  // Step 5: Test private endpoint - Get balance
  console.log(`\n${colors.yellow}💰 Testing private endpoint: Get Balance...${colors.reset}`);
  
  try {
    const balance = await adapter.getBalance();
    results.push({
      name: "Get Balance (Private)",
      success: true,
      data: {
        currency: balance.currency,
        total: balance.total,
        available: balance.available,
        locked: balance.locked
      }
    });
    printResult(results[results.length - 1] as TestResult);
  } catch (error) {
    results.push({
      name: "Get Balance (Private)",
      success: false,
      error: String(error)
    });
    printResult(results[results.length - 1] as TestResult);
  }

  // Step 6: Test private endpoint - Get position
  console.log(`\n${colors.yellow}📍 Testing private endpoint: Get Position...${colors.reset}`);
  
  try {
    const position = await adapter.getPosition();
    results.push({
      name: "Get Position (Private)",
      success: true,
      data: position ? {
        symbol: position.symbol,
        side: position.side,
        quantity: position.quantity,
        entryPrice: position.entryPrice,
        unrealizedPnl: position.unrealizedPnl
      } : "No open position"
    });
    printResult(results[results.length - 1] as TestResult);
  } catch (error) {
    results.push({
      name: "Get Position (Private)",
      success: false,
      error: String(error)
    });
    printResult(results[results.length - 1] as TestResult);
  }

  // Step 7: Test private endpoint - Get open orders
  console.log(`\n${colors.yellow}📋 Testing private endpoint: Get Open Orders...${colors.reset}`);
  
  try {
    const orders = await adapter.getOpenOrders();
    results.push({
      name: "Get Open Orders (Private)",
      success: true,
      data: {
        count: orders.length,
        orders: orders.map((order) => ({
          id: order.id,
          type: order.type,
          side: order.side,
          quantity: order.quantity,
          price: order.price,
          status: order.status
        }))
      }
    });
    printResult(results[results.length - 1] as TestResult);
  } catch (error) {
    results.push({
      name: "Get Open Orders (Private)",
      success: false,
      error: String(error)
    });
    printResult(results[results.length - 1] as TestResult);
  }

  // Step 8: Disconnect
  console.log(`\n${colors.yellow}🔌 Disconnecting...${colors.reset}`);
  
  try {
    await adapter.disconnect();
    console.log(`${colors.green}✅ Disconnected successfully${colors.reset}`);
  } catch (error) {
    console.log(`${colors.yellow}⚠️  Disconnect warning:${colors.reset}`, error);
  }

  // Step 9: Print summary
  console.log(`\n${colors.bold}${colors.blue}╔════════════════════════════════════════════════╗${colors.reset}`);
  console.log(`${colors.bold}${colors.blue}║   Test Summary                                 ║${colors.reset}`);
  console.log(`${colors.bold}${colors.blue}╚════════════════════════════════════════════════╝${colors.reset}\n`);

  const totalTests = results.length;
  const passedTests = results.filter((r) => r.success).length;
  const failedTests = totalTests - passedTests;

  console.log(`Total Tests: ${totalTests}`);
  console.log(`${colors.green}Passed: ${passedTests}${colors.reset}`);
  console.log(`${colors.red}Failed: ${failedTests}${colors.reset}`);

  if (failedTests === 0) {
    console.log(`\n${colors.bold}${colors.green}✅ ALL TESTS PASSED - Bot is ready to trade!${colors.reset}\n`);
    process.exit(0);
  } else {
    console.log(`\n${colors.bold}${colors.red}❌ SOME TESTS FAILED - Fix errors before running the bot!${colors.reset}\n`);
    process.exit(1);
  }
}

// Execute tests
runTests().catch((error) => {
  console.error(`${colors.red}Fatal error:${colors.reset}`, error);
  process.exit(1);
});
