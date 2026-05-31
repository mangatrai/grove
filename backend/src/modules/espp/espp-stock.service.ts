import YahooFinance from "yahoo-finance2";

import { log } from "../../logger.js";

const SYMBOL = "IBM";
const TTL_MS = 60 * 60 * 1000; // 1 hour
const SCHEDULER_INTERVAL_MS = 5 * 60 * 1000; // check every 5 min

export type StockQuote = {
  symbol: string;
  price: number;
  previousClose: number;
  asOf: string; // YYYY-MM-DD
};

const yf = new YahooFinance({ suppressNotices: ["yahooSurvey"] });

let cache: { quote: StockQuote; fetchedAt: number } | null = null;

export async function getStockQuote(): Promise<StockQuote | null> {
  if (cache && Date.now() - cache.fetchedAt < TTL_MS) return cache.quote;
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
    cache = { quote, fetchedAt: Date.now() };
    log.info({ symbol: SYMBOL, price: quote.price, asOf }, "espp-stock: quote refreshed");
    return quote;
  } catch (err) {
    log.warn({ err }, "espp-stock: failed to fetch quote");
    return cache?.quote ?? null;
  }
}

export function startStockQuoteScheduler(): void {
  // Initial fetch on startup
  refreshQuote().catch(() => {});

  // Refresh at ~4:15 PM ET on weekdays (4:15 PM EDT = 20:15 UTC; EST = 21:15 UTC)
  setInterval(() => {
    const now = new Date();
    const dow = now.getUTCDay(); // 0=Sun, 1-5=Mon-Fri
    const isWeekday = dow >= 1 && dow <= 5;
    const h = now.getUTCHours();
    const m = now.getUTCMinutes();
    const inEdtWindow = h === 20 && m >= 15 && m < 20;
    const inEstWindow = h === 21 && m >= 15 && m < 20;
    if (isWeekday && (inEdtWindow || inEstWindow)) {
      refreshQuote().catch(() => {});
    }
  }, SCHEDULER_INTERVAL_MS);
}
