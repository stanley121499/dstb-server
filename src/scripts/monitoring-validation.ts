/**
 * Monitoring Validation Script
 * 
 * Tests Telegram Bot, Google Sheets, and Email integrations with real credentials.
 * Run this after setting up all monitoring credentials in .env file.
 * 
 * Usage: npx tsx src/scripts/monitoring-validation.ts
 */

import dotenv from "dotenv";
import { TelegramAlerter } from "../monitoring/TelegramAlerter.js";
import { GoogleSheetsReporter } from "../monitoring/GoogleSheetsReporter.js";
import { EmailAlerter } from "../monitoring/EmailAlerter.js";

// Load environment variables
dotenv.config();

interface ValidationResult {
  service: string;
  success: boolean;
  message: string;
  error?: string;
}

async function validateTelegram(): Promise<ValidationResult> {
  console.log("\n🔍 Testing Telegram Bot...");
  
  try {
    const botToken = process.env.TELEGRAM_BOT_TOKEN;
    const chatId = process.env.TELEGRAM_CHAT_ID;
    
    if (!botToken || !chatId) {
      return {
        service: "Telegram",
        success: false,
        message: "Missing credentials",
        error: "TELEGRAM_BOT_TOKEN or TELEGRAM_CHAT_ID not set in .env"
      };
    }
    
    const alerter = new TelegramAlerter({
      botToken,
      chatId
    });
    
    await alerter.sendAlert({
      level: "INFO",
      message: "✅ DSTB Bot monitoring validation test - Telegram is working!",
      metadata: {
        timestamp: new Date().toISOString(),
        testType: "validation"
      }
    });
    
    return {
      service: "Telegram",
      success: true,
      message: "Message sent successfully! Check your Telegram app."
    };
  } catch (error) {
    return {
      service: "Telegram",
      success: false,
      message: "Failed to send message",
      error: error instanceof Error ? error.message : String(error)
    };
  }
}

async function validateGoogleSheets(): Promise<ValidationResult> {
  console.log("\n🔍 Testing Google Sheets...");
  
  try {
    const sheetsId = process.env.GOOGLE_SHEETS_ID;
    const credentialsPath = process.env.GOOGLE_CREDENTIALS_PATH;
    
    if (!sheetsId || !credentialsPath) {
      return {
        service: "Google Sheets",
        success: false,
        message: "Missing credentials",
        error: "GOOGLE_SHEETS_ID or GOOGLE_CREDENTIALS_PATH not set in .env"
      };
    }
    
    const reporter = new GoogleSheetsReporter({
      sheetsId,
      credentialsPath
    });
    
    await reporter.updateBotStatus({
      botId: "validation-test",
      symbol: "TEST-USD",
      strategy: "Validation Test",
      status: "running",
      equity: 1000,
      dailyPnl: 0,
      openPosition: null,
      lastUpdate: new Date().toISOString()
    });
    
    return {
      service: "Google Sheets",
      success: true,
      message: "Row updated successfully! Check your Google Sheet."
    };
  } catch (error) {
    return {
      service: "Google Sheets",
      success: false,
      message: "Failed to update sheet",
      error: error instanceof Error ? error.message : String(error)
    };
  }
}

async function validateEmail(): Promise<ValidationResult> {
  console.log("\n🔍 Testing Email...");
  
  try {
    const smtpHost = process.env.EMAIL_SMTP_HOST;
    const smtpPort = process.env.EMAIL_SMTP_PORT;
    const smtpUser = process.env.EMAIL_SMTP_USER;
    const smtpPass = process.env.EMAIL_SMTP_PASS;
    const emailFrom = process.env.EMAIL_FROM;
    const emailTo = process.env.EMAIL_TO;
    
    if (!smtpHost || !smtpPort || !smtpUser || !smtpPass || !emailFrom || !emailTo) {
      return {
        service: "Email",
        success: false,
        message: "Missing credentials",
        error: "One or more EMAIL_* environment variables not set in .env"
      };
    }
    
    const alerter = new EmailAlerter({
      host: smtpHost,
      port: parseInt(smtpPort, 10),
      secure: process.env.EMAIL_SMTP_SECURE === "true",
      user: smtpUser,
      pass: smtpPass,
      from: emailFrom,
      to: emailTo
    });
    
    await alerter.sendAlert({
      level: "INFO",
      message: "✅ DSTB Bot monitoring validation test - Email is working!",
      metadata: {
        timestamp: new Date().toISOString(),
        testType: "validation"
      }
    });
    
    return {
      service: "Email",
      success: true,
      message: "Email sent successfully! Check your inbox."
    };
  } catch (error) {
    return {
      service: "Email",
      success: false,
      message: "Failed to send email",
      error: error instanceof Error ? error.message : String(error)
    };
  }
}

function printResult(result: ValidationResult): void {
  if (result.success) {
    console.log(`✅ ${result.service}: ${result.message}`);
  } else {
    console.log(`❌ ${result.service}: ${result.message}`);
    if (result.error) {
      console.log(`   Error: ${result.error}`);
    }
  }
}

function printSummary(results: ValidationResult[]): void {
  console.log("\n" + "=".repeat(60));
  console.log("VALIDATION SUMMARY");
  console.log("=".repeat(60));
  
  const successful = results.filter(r => r.success).length;
  const total = results.length;
  
  results.forEach(printResult);
  
  console.log("\n" + "-".repeat(60));
  console.log(`Result: ${successful}/${total} services configured correctly`);
  console.log("-".repeat(60));
  
  if (successful === total) {
    console.log("\n✨ All monitoring systems configured correctly!");
    console.log("You're ready to proceed with bot deployment.\n");
  } else {
    console.log("\n⚠️  Some monitoring systems need configuration.");
    console.log("See docs/monitoring-credentials-setup.md for setup instructions.\n");
  }
}

async function main(): Promise<void> {
  console.log("=".repeat(60));
  console.log("DSTB BOT - MONITORING VALIDATION");
  console.log("=".repeat(60));
  console.log("\nThis script will test your monitoring system credentials:");
  console.log("1. Telegram Bot");
  console.log("2. Google Sheets");
  console.log("3. Email (SMTP)");
  console.log("\nMake sure you've set up all credentials in .env file.");
  console.log("See docs/monitoring-credentials-setup.md for instructions.\n");
  
  const results: ValidationResult[] = [];
  
  // Test Telegram
  results.push(await validateTelegram());
  
  // Test Google Sheets
  results.push(await validateGoogleSheets());
  
  // Test Email
  results.push(await validateEmail());
  
  // Print summary
  printSummary(results);
  
  // Exit with error code if any validation failed
  const allSuccess = results.every(r => r.success);
  process.exit(allSuccess ? 0 : 1);
}

// Run validation
main().catch((error) => {
  console.error("\n❌ Unexpected error during validation:");
  console.error(error);
  process.exit(1);
});
