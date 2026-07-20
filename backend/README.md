# Project Dokimi backend MVP

Cloudflare Workers API for the Project Dokimi showcase. It demonstrates the product's core architecture without pretending that licensed market data or live broker approval already exists.

## Showcase capabilities

- Email or E.164 phone signup and session login.
- A strict, versioned multi-leg options strategy schema.
- Immutable strategy versions and share snapshots.
- A deterministic synthetic backtest that returns trades, equity, drawdown, ROI, win rate, profit factor, and a reproducibility manifest.
- Read-only NSE/BSE quotes, intraday or dated candles, and option chains through an Upstox Analytics Token.
- Zero-credential live SOL/USDT spot quotes and candles through Bybit's public market-data API.
- Backtesting-ready SMA, EMA, RSI, MACD, Bollinger Bands, ATR, VWAP, and Supertrend series aligned to every candle.
- Metadata-backed browser run lifecycle with transactional demo credits.
- Baskets, folders, synthetic dataset manifests, paper portfolios, and idempotent paper order confirmation.
- Explicit release gates for licensed live data and broker execution.

## Local setup

Requirements: Node.js 22+ and a Cloudflare account only when deploying.

```powershell
cd backend
npm install
Copy-Item .dev.vars.example .dev.vars
npm run db:migrate:local
npm run dev
```

Replace the placeholder secrets in `.dev.vars` with separate random values of at least 32 characters. The API is served at `http://localhost:8787` by default.

### Enable live market data

Generate a free, read-only Analytics Token in the Upstox Developer Apps page and set it in `.dev.vars`:

```text
UPSTOX_ANALYTICS_TOKEN=your-token
```

Restart the worker after changing `.dev.vars`. The token is kept server-side and is never returned to the browser. The demo dashboard then enables its Live Indicator Lab automatically.

```text
GET /v1/demo/market/status
GET /v1/demo/crypto/analysis?symbol=SOLUSDT&interval=5
GET /v1/demo/market/analysis?symbol=NIFTY&interval=5
GET /v1/demo/market/modeled-analysis?symbol=NIFTY&interval=5
GET /v1/demo/market/analysis?symbol=BANKNIFTY&interval=15&from=2026-07-01&to=2026-07-20
GET /v1/demo/market/option-chain?symbol=NIFTY&expiry=2026-07-30
```

Supported indices are `NIFTY`, `BANKNIFTY`, `FINNIFTY`, `MIDCPNIFTY`, `INDIAVIX`, `SENSEX`, and `BANKEX`. Public demo requests are IP-rate-limited. Authenticated clients can use the equivalent `/v1/market/*` routes.

SOL/USDT live market data requires no token. When the Upstox token is absent, every equity-index selector still returns its own clearly labeled modeled OHLC series so the V1 controls and indicator workflow remain functional.

The fastest presentation flow does not require an account:

```text
GET  /v1/demo
GET  /v1/demo/strategy
POST /v1/demo/backtest   { "configuration": <strategy from previous call> }
```

The result is deterministic for a given strategy configuration and always includes `demo: true`, `synthetic: true`, and warnings that it is not exchange data.

## Quality checks

```powershell
npm run check
npm run audit
```

## Deployment

Create a D1 database and R2 bucket, replace the placeholder `database_id` in `wrangler.jsonc`, add secrets with `wrangler secret put`, then run:

```powershell
npm run db:migrate:remote
npm run deploy
```

Do not enable live trading until an approved broker adapter, token-encryption design, threat model, and regulatory release gate are complete.

See [docs/frontend-integration.md](docs/frontend-integration.md) for the UI contract.
