export interface Candle {
  timestamp: string;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
  openInterest: number;
}

export interface MarketQuote {
  instrumentKey: string;
  symbol: MarketSymbol;
  lastPrice: number;
  previousClose: number;
  lastTradedQuantity: number;
  volume: number;
  asOf: string;
}

export interface OptionMarketData {
  ltp: number;
  volume: number;
  openInterest: number;
  closePrice: number;
  bidPrice: number;
  bidQuantity: number;
  askPrice: number;
  askQuantity: number;
}

export interface OptionGreeks {
  delta: number;
  gamma: number;
  theta: number;
  vega: number;
  impliedVolatility: number;
}

export interface OptionChainStrike {
  expiry: string;
  strikePrice: number;
  underlyingSpotPrice: number;
  pcr: number | null;
  call: { instrumentKey: string; market: OptionMarketData; greeks: OptionGreeks } | null;
  put: { instrumentKey: string; market: OptionMarketData; greeks: OptionGreeks } | null;
}

export const MARKET_INSTRUMENTS = {
  NIFTY: 'NSE_INDEX|Nifty 50',
  BANKNIFTY: 'NSE_INDEX|Nifty Bank',
  FINNIFTY: 'NSE_INDEX|Nifty Fin Service',
  MIDCPNIFTY: 'NSE_INDEX|NIFTY MID SELECT',
  INDIAVIX: 'NSE_INDEX|India VIX',
  SENSEX: 'BSE_INDEX|SENSEX',
  BANKEX: 'BSE_INDEX|BANKEX',
} as const;

export type MarketSymbol = keyof typeof MARKET_INSTRUMENTS;

export interface MarketDataProvider {
  readonly id: string;
  getQuote(symbol: MarketSymbol): Promise<MarketQuote>;
  getIntradayCandles(symbol: MarketSymbol, intervalMinutes: number): Promise<Candle[]>;
  getHistoricalCandles(
    symbol: MarketSymbol,
    intervalMinutes: number,
    from: string,
    to: string,
  ): Promise<Candle[]>;
  getOptionChain(symbol: MarketSymbol, expiryDate: string): Promise<OptionChainStrike[]>;
}
