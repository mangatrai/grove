import cron from "node-cron";
import YahooFinance from "yahoo-finance2";

import { log } from "../../logger.js";

const SYMBOL = "IBM";

export type StockQuote = {
  symbol: string;
  price: number;
  previousClose: number;
  asOf: string; // YYYY-MM-DD
};

const yf = new YahooFinance({ suppressNotices: ["yahooSurvey"] });

let cache: StockQuote | null = null;

// Returns cached quote if available (even if stale — scheduler handles updates).
// Only calls Yahoo Finance if cache is empty (first request after server start).
export async function getStockQuote(): Promise<StockQuote | null> {
  if (cache) return cache;
  return refreshQuote();
}

async function refreshQuote(): Promise<StockQuote | null> {
  try {
    const result = await yf.quote(SYMBOL, {}, { validateResult: false });
    const asOf = result.regularMarketTime
      ? new Date(result.regularMarketTime).toISOString().slice(0, 10)
      : new Date().toISOString().slice(0, 10);
    const quote: StockQuote = {
      symbol: SYMBOL,
      price: result.regularMarketPrice ?? result.regularMarketPreviousClose ?? 0,
      previousClose: result.regularMarketPreviousClose ?? 0,
      asOf,
    };
    cache = quote;
    log.info({ symbol: SYMBOL, price: quote.price, asOf }, "espp-stock: quote refreshed");
    return quote;
  } catch (err) {
    log.warn({ err }, "espp-stock: failed to fetch quote");
    return cache;
  }
}

export function startStockQuoteScheduler(): void {
  // Initial fetch on startup
  refreshQuote().catch(() => {});

  // 4:15 PM ET Mon–Fri = 3:15 PM CT = after NYSE/NASDAQ close.
  // node-cron fires exactly at this time regardless of DST; no UTC offset math needed.
  cron.schedule("15 16 * * 1-5", () => { refreshQuote().catch(() => {}); }, {
    timezone: "America/New_York",
  });
}
