import type { Bindings } from '../types.js';
import type { MarketDataProvider } from '../domain/market-data.js';
import { UpstoxMarketDataProvider } from './upstox.js';

export function createMarketDataProvider(bindings: Bindings): MarketDataProvider {
  return new UpstoxMarketDataProvider(
    bindings.UPSTOX_ANALYTICS_TOKEN ?? '',
    bindings.UPSTOX_API_BASE_URL ?? 'https://api.upstox.com',
  );
}
