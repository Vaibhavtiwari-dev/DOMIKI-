import { parse } from 'protobufjs';
import marketDataFeedProto from './MarketDataFeed.proto?raw';
import type { CryptoStreamStatus } from './bybitStream';

interface StreamAuthorization {
  data: { url: string; instrumentKey: string };
}

interface LtpcMessage {
  ltp?: number;
  ltt?: string | number;
  cp?: number;
}

interface FeedMessage {
  ltpc?: LtpcMessage;
  fullFeed?: {
    indexFF?: { ltpc?: LtpcMessage };
    marketFF?: { ltpc?: LtpcMessage };
  };
  firstLevelWithGreeks?: { ltpc?: LtpcMessage };
}

interface FeedResponseMessage {
  feeds?: Record<string, FeedMessage>;
  currentTs?: string | number;
}

interface StreamOptions {
  apiBaseUrl: string;
  symbol: string;
  onStatus: (status: CryptoStreamStatus) => void;
  onQuote: (quote: { lastPrice: number; previousClose: number | null; asOf: string }) => void;
}

const feedResponseType = parse(marketDataFeedProto).root.lookupType(
  'com.upstox.marketdatafeederv3udapi.rpc.proto.FeedResponse',
);

function finiteNumber(value: unknown): number | null {
  const parsed = typeof value === 'string' || typeof value === 'number' ? Number(value) : Number.NaN;
  return Number.isFinite(parsed) ? parsed : null;
}

function decodeFeed(buffer: ArrayBuffer): FeedResponseMessage {
  const decoded = feedResponseType.decode(new Uint8Array(buffer));
  return feedResponseType.toObject(decoded, { longs: String }) as FeedResponseMessage;
}

function quoteFromFeed(feed: FeedMessage | undefined): LtpcMessage | undefined {
  return (
    feed?.ltpc ??
    feed?.fullFeed?.indexFF?.ltpc ??
    feed?.fullFeed?.marketFF?.ltpc ??
    feed?.firstLevelWithGreeks?.ltpc
  );
}

export function connectUpstoxMarketStream(options: StreamOptions): () => void {
  let stopped = false;
  let socket: WebSocket | null = null;
  let reconnectTimer: number | undefined;
  let authorizationRequest: AbortController | null = null;
  let reconnectAttempt = 0;

  const scheduleReconnect = () => {
    if (stopped || reconnectTimer !== undefined) return;
    reconnectAttempt += 1;
    options.onStatus('reconnecting');
    reconnectTimer = window.setTimeout(() => {
      reconnectTimer = undefined;
      void connect();
    }, Math.min(10_000, 1_000 * 2 ** reconnectAttempt));
  };

  const connect = async () => {
    if (stopped) return;
    options.onStatus(reconnectAttempt === 0 ? 'connecting' : 'reconnecting');
    authorizationRequest = new AbortController();
    try {
      const response = await fetch(
        `${options.apiBaseUrl}/v1/demo/market/stream-url?symbol=${encodeURIComponent(options.symbol)}`,
        { signal: authorizationRequest.signal, credentials: 'include' },
      );
      const payload = (await response.json()) as StreamAuthorization;
      if (!response.ok || !payload.data?.url || !payload.data.instrumentKey) {
        throw new Error('The equity stream could not be authorized.');
      }
      const streamUrl = new URL(payload.data.url);
      if (streamUrl.protocol !== 'wss:') throw new Error('The equity stream URL is invalid.');
      if (stopped) return;

      socket = new WebSocket(streamUrl);
      socket.binaryType = 'arraybuffer';
      socket.onopen = () => {
        reconnectAttempt = 0;
        options.onStatus('live');
        socket?.send(
          new TextEncoder().encode(
            JSON.stringify({
              guid: crypto.randomUUID(),
              method: 'sub',
              data: { mode: 'ltpc', instrumentKeys: [payload.data.instrumentKey] },
            }),
          ),
        );
      };
      socket.onmessage = (event) => {
        if (!(event.data instanceof ArrayBuffer)) return;
        let message: FeedResponseMessage;
        try {
          message = decodeFeed(event.data);
        } catch {
          return;
        }
        const quote = quoteFromFeed(message.feeds?.[payload.data.instrumentKey]);
        const lastPrice = finiteNumber(quote?.ltp);
        if (lastPrice === null) return;
        const timestamp = finiteNumber(quote?.ltt) ?? finiteNumber(message.currentTs) ?? Date.now();
        options.onQuote({
          lastPrice,
          previousClose: finiteNumber(quote?.cp),
          asOf: new Date(timestamp).toISOString(),
        });
      };
      socket.onclose = scheduleReconnect;
      socket.onerror = () => socket?.close();
    } catch (error) {
      if (!stopped && !(error instanceof DOMException && error.name === 'AbortError')) {
        scheduleReconnect();
      }
    }
  };

  void connect();
  return () => {
    stopped = true;
    authorizationRequest?.abort();
    if (reconnectTimer !== undefined) window.clearTimeout(reconnectTimer);
    socket?.close();
    options.onStatus('offline');
  };
}
