import type { Bindings } from '../types';
import type { MarketDataProvider } from '../domain/market-data';
import { UpstoxMarketDataProvider } from './upstox';

export function createMarketDataProvider(bindings: Bindings): MarketDataProvider {
  return new UpstoxMarketDataProvider(
    bindings.UPSTOX_ANALYTICS_TOKEN ?? '',
    bindings.UPSTOX_API_BASE_URL ?? 'https://api.upstox.com',
  );
}
