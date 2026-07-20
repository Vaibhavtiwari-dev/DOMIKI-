export type CryptoStreamStatus = 'connecting' | 'live' | 'reconnecting' | 'offline';

export interface CryptoStreamUpdate {
  quote?: {
    lastPrice: number;
    volume: number | null;
    asOf: string;
  };
  candle?: {
    timestamp: string;
    open: number;
    high: number;
    low: number;
    close: number;
    volume: number;
  };
}

interface StreamOptions {
  symbol: 'SOLUSDT';
  interval: string;
  onStatus: (status: CryptoStreamStatus) => void;
  onUpdate: (update: CryptoStreamUpdate) => void;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function finiteNumber(value: unknown): number | null {
  const parsed = typeof value === 'string' || typeof value === 'number' ? Number(value) : Number.NaN;
  return Number.isFinite(parsed) ? parsed : null;
}

export function connectBybitSpotStream(options: StreamOptions): () => void {
  let stopped = false;
  let socket: WebSocket | null = null;
  let reconnectTimer: number | undefined;
  let heartbeatTimer: number | undefined;
  let reconnectAttempt = 0;

  const clearTimers = () => {
    if (reconnectTimer !== undefined) window.clearTimeout(reconnectTimer);
    if (heartbeatTimer !== undefined) window.clearInterval(heartbeatTimer);
  };

  const connect = () => {
    if (stopped) return;
    options.onStatus(reconnectAttempt === 0 ? 'connecting' : 'reconnecting');
    socket = new WebSocket('wss://stream.bybit.com/v5/public/spot');

    socket.onopen = () => {
      reconnectAttempt = 0;
      options.onStatus('live');
      socket?.send(
        JSON.stringify({
          op: 'subscribe',
          args: [`tickers.${options.symbol}`, `kline.${options.interval}.${options.symbol}`],
        }),
      );
      heartbeatTimer = window.setInterval(() => {
        if (socket?.readyState === WebSocket.OPEN) socket.send(JSON.stringify({ op: 'ping' }));
      }, 20_000);
    };

    socket.onmessage = (event) => {
      let message: unknown;
      try {
        message = JSON.parse(String(event.data));
      } catch {
        return;
      }
      if (!isRecord(message) || typeof message.topic !== 'string') return;
      const receivedAt = new Date(
        finiteNumber(message.ts) ?? Date.now(),
      ).toISOString();

      if (message.topic === `tickers.${options.symbol}` && isRecord(message.data)) {
        const lastPrice = finiteNumber(message.data.lastPrice);
        if (lastPrice === null) return;
        options.onUpdate({
          quote: {
            lastPrice,
            volume: finiteNumber(message.data.volume24h),
            asOf: receivedAt,
          },
        });
        return;
      }

      if (message.topic === `kline.${options.interval}.${options.symbol}` && Array.isArray(message.data)) {
        const value = message.data[0];
        if (!isRecord(value)) return;
        const timestamp = finiteNumber(value.start);
        const open = finiteNumber(value.open);
        const high = finiteNumber(value.high);
        const low = finiteNumber(value.low);
        const close = finiteNumber(value.close);
        const volume = finiteNumber(value.volume);
        if ([timestamp, open, high, low, close, volume].some((item) => item === null)) return;
        options.onUpdate({
          candle: {
            timestamp: new Date(timestamp as number).toISOString(),
            open: open as number,
            high: high as number,
            low: low as number,
            close: close as number,
            volume: volume as number,
          },
        });
      }
    };

    socket.onclose = () => {
      if (heartbeatTimer !== undefined) window.clearInterval(heartbeatTimer);
      if (stopped) return;
      reconnectAttempt += 1;
      options.onStatus('reconnecting');
      reconnectTimer = window.setTimeout(connect, Math.min(10_000, 1_000 * 2 ** reconnectAttempt));
    };

    socket.onerror = () => socket?.close();
  };

  connect();
  return () => {
    stopped = true;
    clearTimers();
    socket?.close();
    options.onStatus('offline');
  };
}
