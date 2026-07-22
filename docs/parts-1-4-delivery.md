# Parts 1–4 Delivery Record

**Delivered:** 23 July 2026

**Branch:** `codex/professional-v1`

**Release boundary:** zero-cash private alpha for research and paper trading; live broker orders disabled

## Outcome

The reset showcase has been rebuilt into a coherent V1 research workflow. A user can initialize a signed session, observe truthful market states, import options data, run a deterministic backtest without blocking the UI, inspect and export evidence, combine runs into a basket, replay a historical session without future candles, build a provider-backed paper strategy, and monitor durable paper fills.

Every workspace uses the same terminal header, navigation, typography, spacing scale, panel language, form controls, tables, status notices, responsive breakpoints, focus treatment, reduced-motion behavior, and research/paper labels.

## Part 1 — Foundation and hardening

- Signed 12-hour `HttpOnly`, `SameSite=Strict` one-click research session; email and password are not required.
- Protected `/demo` route, explicit logout, and fail-closed signing-secret configuration.
- Lazy-loaded routes, application error boundary, Web Worker isolation, CSP and security headers.
- Provider request timeouts, bounded response parsing, schema validation, safe errors, and rate limits.
- CI quality workflow; frontend and backend format/lint/typecheck/test/build/audit commands.
- High-severity dependency audits report zero known vulnerabilities at delivery time.

## Part 2 — Truthful market data

- SOL/USDT public WebSocket updates plus REST candle reconciliation and reconnect behavior.
- Instrument and interval changes cancel or supersede stale requests.
- Upstox server adapter for Indian-index history, active option contracts, effective lot size, option chain, IV, Greeks, volume, OI, and bid/ask data.
- Recent-history fallback when intraday data is empty or the market is closed.
- Explicit source/freshness/error states; professional equity views never call the modeled-candle route.
- Missing Upstox credentials produce a bounded provider error and an empty chart—not an endless loader or fabricated data.

## Part 3 — Deterministic V1 backtesting

- Local CSV parsing with size/row limits, required-column validation, OHLC validation, and deterministic ordering.
- Short ATM straddle resolution with entry/exit time, lots, effective configured lot size, leg stop/target, slippage, per-order fees, and conservative stop-first same-candle handling.
- Worker execution and cancellation.
- Dataset SHA-256, engine/fill/timezone manifest, exclusions, warnings, quality grade, trade audit, equity curve, summary metrics, and safe CSV/JSON export.
- Explicit synthetic sample fixture for workflow evaluation only.
- Saved strategy versions, cloning into the form, repeatable runs, and result comparison.

This is the V1 engine slice, not full parity with every advanced PRD rule. Re-entry, rollover, closest-premium/range selection, combined-premium rules, profit-lock/trailing protection, full statutory Indian cost tables, aligned correlation analytics, Excel/PDF generation, and broad multi-strategy templates remain later engine expansion. They must not be represented as delivered.

## Part 4 — Professional workflow surface

- **Dashboard:** live crypto candles, truthful equity provider state, optional indicators, synthetic overview clearly labeled, equity curve, and sessions.
- **Quick Backtest:** import, configuration, validation, saved versions, clone, worker run/cancel, comparison, audit, manifest, warnings, and exports.
- **Results Library:** immutable local snapshots, search/source filters, quality and manifest metadata, warnings, trade-detail inspection, and exports.
- **Basket Manager:** durable local CRUD, shared capital, multipliers, basket stop/target, aggregate scenario, and conservative summed drawdown disclosure.
- **Historical Simulator:** imported/sample sessions, deterministic next-candle/auto replay, no-future-data guard, buy/sell entries, quantity adjustment, exits, P&L, event audit, and replay JSON export.
- **Live Builder:** provider active expiries, lot size, spot, option chain, IV/delta, OI/volume, bid/ask depth, buy/sell legs, quantity adjustment, payoff, premium, and paper submission.
- **Paper Portfolio:** durable open legs, automatic 15-second provider marking, manual refresh, unrealized/realized P&L, premium exposure, two-step idempotent exit confirmation, and a closed-fill ledger.

## Verification evidence

- Root production build, lint, 26 tests, and high-severity audit: pass.
- Worker format, lint, typecheck, 23 tests, dry-run build, and high-severity audit: pass.
- Signed session lifecycle: unauthenticated rejection, initialization, protected request, logout, and post-logout rejection verified locally.
- Browser checks: one-click entry, WebSocket price movement, interval switching, opt-in indicators, equity fail-closed behavior, worker backtest, saved results and trade detail, basket calculation, replay P&L, live-builder provider error, and paper empty state verified on localhost.

## External gate and Part 5

Exchange-backed Indian data cannot be demonstrated locally until a valid eligible read-only Upstox Analytics Token is configured on the backend. This is an external provider/account gate; no token is embedded or simulated.

Part 5 remains necessary before calling the service operationally production-ready: durable distributed rate limits, deployed D1/R2 migrations, cross-browser E2E and accessibility automation, load/reconnect/long-session tests, monitoring and freshness alerts, backups and restore drills, incident and rollback runbooks, privacy/terms/data-rights records, and independent release acceptance.
