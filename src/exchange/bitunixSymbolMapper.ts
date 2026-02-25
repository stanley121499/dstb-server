import { ExchangeError } from "./ExchangeError.js";

type SymbolParts = Readonly<{
  base: string;
  quote: string;
}>;

/**
 * Converts a platform symbol (e.g. BTC-USD) into Bitunix format (e.g. BTCUSDT).
 */
export function toBitunixSymbol(symbol: string): string {
  const parts = splitSymbol(symbol);
  const quote = normalizeQuoteToBitunix(parts.quote);
  return `${parts.base}${quote}`;
}

/**
 * Converts a Bitunix symbol (e.g. BTCUSDT) into platform format (e.g. BTC-USD).
 */
export function fromBitunixSymbol(symbol: string): string {
  if (typeof symbol !== "string" || symbol.trim().length === 0) {
    throw new ExchangeError({
      code: "INVALID_SYMBOL",
      message: "Bitunix symbol must be a non-empty string"
    });
  }

  const normalized = symbol.trim().toUpperCase();
  const { base, quote } = splitBitunixSymbol(normalized);
  const mappedQuote = normalizeQuoteFromBitunix(quote);

  return `${base}-${mappedQuote}`;
}

function splitSymbol(symbol: string): SymbolParts {
  if (typeof symbol !== "string" || symbol.trim().length === 0) {
    throw new ExchangeError({
      code: "INVALID_SYMBOL",
      message: "Symbol must be a non-empty string"
    });
  }

  const normalized = symbol.trim().toUpperCase();
  let separator: "-" | "/" | null = null;
  if (normalized.includes("-")) {
    separator = "-";
  } else if (normalized.includes("/")) {
    separator = "/";
  }
  if (separator === null) {
    return splitBitunixSymbol(normalized);
  }

  const parts = normalized.split(separator).filter((value) => value.length > 0);
  if (parts.length !== 2) {
    throw new ExchangeError({
      code: "INVALID_SYMBOL",
      message: `Symbol must contain a single separator: ${symbol}`
    });
  }

  const [base, quote] = parts;
  if (base === undefined || quote === undefined) {
    throw new ExchangeError({
      code: "INVALID_SYMBOL",
      message: `Symbol must contain base and quote: ${symbol}`
    });
  }

  return { base, quote };
}

function splitBitunixSymbol(symbol: string): SymbolParts {
  const normalized = symbol.trim().toUpperCase();
  if (normalized.endsWith("USDT")) {
    return { base: normalized.slice(0, -4), quote: "USDT" };
  }
  if (normalized.endsWith("USD")) {
    return { base: normalized.slice(0, -3), quote: "USD" };
  }
  if (normalized.length <= 3) {
    throw new ExchangeError({
      code: "INVALID_SYMBOL",
      message: `Symbol is too short to split: ${symbol}`
    });
  }

  return { base: normalized.slice(0, -3), quote: normalized.slice(-3) };
}

function normalizeQuoteToBitunix(quote: string): string {
  const normalized = quote.trim().toUpperCase();
  if (normalized === "USD") {
    return "USDT";
  }
  return normalized;
}

function normalizeQuoteFromBitunix(quote: string): string {
  const normalized = quote.trim().toUpperCase();
  if (normalized === "USDT") {
    return "USD";
  }
  return normalized;
}
