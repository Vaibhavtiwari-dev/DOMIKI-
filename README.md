# Dokimi V1

Dokimi is a local-first options research and paper-trading alpha. It combines live market telemetry, user-imported option candles, a deterministic browser backtester, historical replay, basket scenarios, a live option-chain builder, and a durable paper portfolio.

It does **not** place broker orders. Synthetic fixtures are labeled and are never substituted for unavailable Indian-equity data.

## What is included

- One-click research session backed by a signed, `HttpOnly`, `SameSite=Strict` cookie.
- Live SOL/USDT OHLC candles through public Bybit WebSocket data, with bounded REST reconciliation and Binance REST fallback.
- Server-side Upstox integration for Indian-index quotes, candles, active expiries, option contracts, option chains, IV, Greeks, volume, OI, and bid/ask values.
- Fail-closed equity screens when the read-only provider token is unavailable.
- Candles-only chart default with optional EMA, Bollinger Bands, Supertrend, RSI, MACD, ATR, VWAP, and Volume studies.
- Strict local CSV import, deterministic short-ATM-straddle research, conservative OHLC fill policy, costs, exclusions, quality grade, trade audit, manifest hash, and CSV/JSON export.
- Saved strategy versions, run comparison, result filters and trade inspection, basket scenarios, no-future-data replay, a paper strategy ticket, automatic paper marks, and a closed-fill ledger.
- Responsive shared workspace shell with keyboard focus states and reduced-motion support.

## Local development

Use Node.js 22 or newer. Run the Worker API and Vite app in separate terminals.

```powershell
cd backend
Copy-Item .dev.vars.example .dev.vars
npm install
npm run dev
```

Set two unique random values of at least 32 characters in `backend/.dev.vars`:

```dotenv
SESSION_SIGNING_SECRET=replace-with-a-long-random-local-secret
DATASET_SIGNING_SECRET=replace-with-a-different-long-random-secret
```

The optional Upstox credential must remain server-side:

```dotenv
UPSTOX_ANALYTICS_TOKEN=your-read-only-analytics-token
```

Never commit `.dev.vars`, provider tokens, or signing secrets.

Start the frontend from the repository root:

```powershell
npm install
npm run dev
```

Open `http://localhost:5173/` and select **Initialize Session**. Email and password fields are intentionally disabled for this private-alpha flow.

## Market-data truth boundary

- SOL/USDT uses public exchange data and updates without manual refresh.
- Indian-equity history and option-chain screens use Upstox only when a valid server-side token is configured.
- When Upstox is missing, expired, rate-limited, or unavailable, equity screens show an actionable provider error. They do not show modeled candles.
- The included option dataset is an explicit synthetic workflow fixture. Professional research requires a legally obtained CSV import or provider-authorized data.
- A closed market can still return the most recent provider history. “Live,” “closed,” “stale,” and “unavailable” must not be treated as equivalent states.

## CSV contract

Option imports are processed locally and are limited to 50 MB and 250,000 rows. Required columns are:

```text
timestamp,symbol,expiry,strike,optionType,underlying,open,high,low,close,volume,openInterest
```

`optionType` must be `CE` or `PE`; timestamps must be parseable; expiry must be `YYYY-MM-DD`; and each row must satisfy OHLC invariants.

## Verification

Run all frontend, adapter, unit, build, lint, and dependency gates:

```powershell
npm run check
```

Run the Worker gates separately:

```powershell
cd backend
npm run format:check
npm run check
npm run audit
```

## Deployment

The root Vercel project serves the Vite frontend and `/api` demo adapter. Configure `SESSION_SIGNING_SECRET` and `DATASET_SIGNING_SECRET` as sensitive production environment variables. `UPSTOX_ANALYTICS_TOKEN` is optional and must also be sensitive and server-side. Redeploy after changing any secret.

The Vercel adapter is appropriate for the public research demo surface, but its process-memory rate limiter is not durable. The full Worker in `backend/` includes D1/R2 architecture for a later operational release.

Security headers, a restrictive CSP, credential isolation, provider timeouts and response limits, request validation, cookie signing, live-order kill switches, and dependency audit gates are included. Operational monitoring, backups, restore drills, cross-browser E2E automation, and a production rate-limit service belong to Part 5.

See [Parts 1–4 delivery](docs/parts-1-4-delivery.md) and the [five-part readiness plan](docs/professional-readiness-five-part-plan.md).
