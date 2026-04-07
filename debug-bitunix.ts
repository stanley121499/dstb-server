import "dotenv/config";
import { BitunixAdapter } from "./src/exchange/BitunixAdapter";

async function run() {
  const adapter = new BitunixAdapter({
    symbol: "ETH-USD",
    interval: "15m",
    apiKey: process.env.BITUNIX_API_KEY!,
    secretKey: process.env.BITUNIX_SECRET_KEY!,
    marketType: "futures"
  });

  console.log("Connecting...");
  await adapter.connect();

  console.log("Fetching balance...");
  try {
    const balance = await adapter.getBalance();
    console.log("Balance:", balance);
  } catch (err: unknown) {
    if (err instanceof Error) {
      console.log("ERR:", err.message);
    }
  }

  process.exit(0);
}

run();
