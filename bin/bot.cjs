#!/usr/bin/env node

/**
 * CLI launcher that runs the TypeScript CLI via tsx.
 */
const { spawn } = require("node:child_process");
const path = require("node:path");

// Step 1: Resolve the CLI entry path.
const entryPath = path.resolve(__dirname, "..", "src", "cli", "index.ts");
// Step 2: Forward argv into the CLI entrypoint.
const argv = process.argv.slice(2);
const nodeArgs = ["--import", "tsx", entryPath, ...argv];
// Step 3: Spawn a child process and forward stdio.
const child = spawn(process.execPath, nodeArgs, { stdio: "inherit" });

child.on("exit", (code) => {
  // Step 4: Exit with the child process code.
  const exitCode = typeof code === "number" ? code : 1;
  process.exit(exitCode);
});
