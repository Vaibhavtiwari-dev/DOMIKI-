# Dokimi V1

Dokimi is a backtesting showcase with live market telemetry, OHLC candles, and technical indicators.

## Local development

Run the Cloudflare Workers API and Vite app in separate terminals:

```powershell
cd backend
Copy-Item .dev.vars.example .dev.vars
npm install
npm run dev
```

```powershell
npm install
npm run dev
```

Open `http://localhost:5173/demo`.

## Vercel deployment

The repository includes a single Vercel project that serves both the Vite frontend and the public V1 demo API. The browser uses `/api` automatically in production, while local development continues to use the Worker on port 8787.

The Vercel adapter intentionally exposes the showcase endpoints used by the frontend. The complete Cloudflare Worker remains in `backend/` for the future D1/R2-backed authenticated product.

Deploy from the repository root. `UPSTOX_ANALYTICS_TOKEN` is optional; without it, SOL/USDT remains live through Bybit and Indian indices use clearly labeled modeled data.

On Vercel, store `UPSTOX_ANALYTICS_TOKEN` as a **Sensitive** environment variable for Production and Preview. Keep it server-side (never use a `VITE_` prefix), then redeploy so the API can authorize Upstox REST and WebSocket market-data requests.

## Market data

- SOL/USDT uses Bybit's public spot WebSocket directly. It requires no token and automatically reconnects with a heartbeat and exponential backoff.
- A REST snapshot is reconciled every 15 seconds so historical candles and calculated indicators stay aligned with the stream.
- Indian-equity selectors use distinct modeled data until `UPSTOX_ANALYTICS_TOKEN` is configured. Once configured, they connect to Upstox Market Data Feed V3 over WebSocket and reconcile exchange-backed candles every 15 seconds.

To enable Upstox equity data, generate the one-year, read-only Analytics Token in **Upstox Developer Apps > Analytics**, then set it only in `backend/.dev.vars`:

```dotenv
UPSTOX_ANALYTICS_TOKEN=your-token-here
```

Never commit `.dev.vars`; it is ignored by Git. Restart the backend after changing it.

## Verification

```powershell
npm run lint
npm run build
cd backend
npm run check
npm audit --audit-level=high
```
