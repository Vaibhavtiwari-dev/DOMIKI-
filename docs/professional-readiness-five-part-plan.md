# Dokimi Professional Readiness Plan

> Delivery update: the scoped zero-cost V1 implementation for Parts 1–4 is recorded in [parts-1-4-delivery.md](parts-1-4-delivery.md). This planning document preserves the broader target; unchecked advanced PRD capabilities and operational Part 5 gates remain future work.

**Prepared:** 23 July 2026

**Baseline commit:** `9a05012` (`main`)

**Constraint:** zero cash spend for the private-alpha research and paper-trading release

## Executive verdict

The reset restored a functional showcase baseline, not a professional backtesting product. The present application can demonstrate a synthetic strategy result and live SOL/USDT telemetry, but it cannot yet be relied on for professional Indian-options research.

The practical zero-cost target is a **professional-quality private alpha for research, user-supplied data, and paper trading**. A public commercial service with centrally supplied licensed historical options data, guaranteed uptime, SMS verification, or live broker execution cannot honestly be promised at zero cost.

## Current baseline after the reset

### Working now

- Credential-free `Initialize Session` navigation using local storage.
- A polished single dashboard with a synthetic short-straddle result.
- Deterministic synthetic backtest output with a configuration hash and manifest.
- Live SOL/USDT REST candles and public WebSocket updates through Bybit, with Binance fallback for REST data.
- User-selectable EMA, Bollinger Bands, Supertrend, RSI, MACD, ATR, VWAP, and Volume indicators. No indicator is selected by default.
- Backend foundations for authentication, strategies, baskets, datasets, runs, portfolios, paper trades, D1, R2, CSRF protection, audit events, idempotency, and provider adapters.
- Root frontend build and lint pass.
- Nineteen backend tests pass; backend lint, typecheck, and dry-run build pass when run independently.

### Not professional-ready

- The visible backtest is synthetic; it does not execute against historical option contracts.
- Local Upstox status reports `configured: false`, so Indian indices use modeled data rather than exchange-backed data.
- The UI exposes only the showcase dashboard; the backend strategy, basket, dataset, run, portfolio, and paper-trade APIs are not connected to complete user workflows.
- There is no historical option-chain replay, contract resolution, expiry calendar, historical lot-size service, or options candle store.
- The current backtest engine does not implement the PRD's advanced entry, exit, re-entry, rollover, profit-protection, or portfolio-risk semantics.
- No detailed result breakdown, trade audit drawer, comparison, correlation, Excel/PDF export, or saved result library is available in the current reset state.
- Backend `format:check` fails on 11 files.
- Backend dependency audit reports three high-severity development-toolchain vulnerabilities through `wrangler -> miniflare -> sharp`.
- The frontend production bundle is approximately 1.44 MB minified (about 410 KB gzip) and is not code-split.
- There is no browser end-to-end suite, accessibility gate, load test, backup/restore exercise, incident runbook, or production monitoring.
- The Vercel adapter exposes only public demo endpoints and uses process-memory rate limits. It is not the durable authenticated backend.

## Part 1 — Recover and harden the platform foundation

**Goal:** restore the lost architecture safely and make every later part verifiable.

### Changes

1. Create a protected implementation branch and make one atomic commit per completed part.
2. Restore the application shell and workspaces:
   - Dashboard
   - Quick Backtest
   - Basket Manager
   - Historical Simulator
   - Live Builder
   - Paper Portfolio
3. Replace local-storage-only access with a signed, `HttpOnly`, same-site demo session while retaining one-click `Initialize Session` for private alpha.
4. Add route guards, logout/session revocation, CSRF validation, secure cookies, strict origin checks, and request/body limits.
5. Validate every environment variable at startup and fail closed when secrets or providers are missing.
6. Rotate the previously shared Upstox token before using it again; never put it in frontend variables, Git, logs, URLs, or browser storage.
7. Add provider response-size limits, timeouts, schema validation, safe error mapping, and bounded retries with jitter.
8. Replace in-memory production rate limits with D1-backed or Cloudflare-native limits.
9. Restore CSV formula-injection protection and safe export filenames.
10. Restore frontend lazy loading and an error boundary; reduce the initial bundle below 500 KB gzip.
11. Fix Prettier failures and upgrade/pin the Worker toolchain until `npm audit --audit-level=high` is clean without a breaking downgrade.
12. Add CI for format, lint, typecheck, unit tests, production builds, audits, and secret scanning.

### Acceptance gate

- One-click entry works without email or password.
- Direct `/demo` access without a valid demo session redirects to `/`.
- Both package checks and high-severity audits pass.
- No provider credential reaches the browser.
- A clean clone can start frontend and backend from documented commands.
- Every change is committed before Part 2 begins.

## Part 2 — Truthful live and historical market-data layer

**Goal:** make every instrument, interval, candle, and freshness label accurate and explainable.

### Changes

1. Keep Bybit public WebSocket data for SOL/USDT and reconcile it periodically with REST candles.
2. Connect the server-side Upstox Analytics Token for read-only Indian-market quotes, historical candles, option chains, and WebSocket authorization.
3. Build one provider-neutral contract for quotes, candles, option chains, expiries, instruments, lot sizes, and freshness metadata.
4. Fix instrument switching for Nifty, Bank Nifty, Fin Nifty, India VIX, Sensex, Midcap Nifty, and Bankex.
5. Fix interval switching for 1, 3, 5, 15, and 30 minutes, including request cancellation and stale-response rejection.
6. Backfill enough completed candles before opening a live stream, including when the market is closed.
7. Recalculate indicators whenever a candle closes or history changes; never reuse indicator arrays from a different instrument or interval.
8. Add exchange calendar, holidays, exceptional sessions, active expiries, instrument keys, tick sizes, and effective-dated lot sizes.
9. Add an explicit data-state model: `live`, `delayed`, `market_closed`, `stale`, `unavailable`, `modeled_fixture`, and `user_imported`.
10. Remove modeled fallback from professional mode. If live or historical data is unavailable, show a clear error instead of realistic-looking fabricated candles.
11. Validate timestamps, OHLC invariants, duplicate candles, gaps, ordering, and future timestamps before data reaches charts or the engine.
12. Add golden provider fixtures and integration tests for every supported symbol and interval.

### Zero-cost data policy

- Upstox's Analytics Token is read-only and supports market quote, historical data, option chain, and WebSocket APIs, but it requires an eligible Upstox account and must be treated as a secret: <https://upstox.com/developer/api-documentation/analytics-token/>.
- Bybit public market data remains the no-token source for the SOL/USDT demonstration.
- Complete redistributable historical Indian-options data is not assumed to be free. The zero-cash path is **bring your own legally obtained dataset**, local-only imports, synthetic fixtures, or provider-authorized access under the provider's terms.

### Acceptance gate

- Changing any instrument or interval changes both the selector state and the underlying candle series.
- Closed-market selection still renders the most recent historical candles and labels the market closed.
- No equity screen can label modeled or stale data as live.
- Every chart displays provider, source, exchange timestamp, received timestamp, delay, and candle count.
- Provider failure produces a bounded, recoverable error and never an endless “preparing candles” state.

## Part 3 — Deterministic professional backtesting engine

**Goal:** run reproducible option-strategy research with auditable assumptions.

### Changes

1. Use one versioned strategy schema across backtest, simulator, paper trading, and future live execution.
2. Implement contract selection for ATM/offset/fixed strike, closest premium, premium range, combined premium, weekly/monthly expiries, and next-week-on-expiry-day.
3. Implement entry/exit time rules, weekdays, expiry filters, date filters, VIX filters, and missing-contract policies.
4. Implement leg and strategy SL/TP, square-off modes, trailing SL, move-to-cost, Wait & Trade, Range Breakout, re-entry, re-execution, time guards, profit lock, and rollover.
5. Use a conservative and documented same-candle policy for OHLC ambiguity.
6. Add effective-dated lot size, slippage, bid/ask or conservative fill model, brokerage, exchange fees, taxes, and direction-aware rounding.
7. Run backtests in a Web Worker with cancellation, progress, memory limits, partition pruning, and deterministic seeds only for explicit synthetic fixtures.
8. Produce a signed reproducibility manifest with strategy hash, dataset version, engine version, timezone, calendar version, cost model, fill policy, exclusions, and warnings.
9. Add data-quality grades and exclude sessions that cannot be resolved safely.
10. Produce complete analytics: P&L, ROI, MDD, duration, recovery, return/MDD, expectancy, profit factor, streaks, day/month/expiry breakdowns, margin, contribution, and aligned correlations.
11. Add an immutable trade audit containing contract resolution, entry/exit prices, triggered rules, costs, and ambiguous-candle decisions.
12. Add CSV, JSON, Excel, and printable/PDF reports that reconcile exactly with the UI.
13. Create golden reconciliation fixtures and property tests for accounting invariants.

### Acceptance gate

- A one-year two-leg run completes in the target browser without freezing the UI.
- Repeating the same configuration and dataset produces the same result hash.
- Summary, equity curve, trades, fees, and exports reconcile exactly.
- Every excluded session and ambiguous decision is visible.
- Synthetic results are never presented as exchange backtests.

## Part 4 — Complete the professional workflows and UI

**Goal:** expose the engine and market layer through coherent end-to-end workspaces.

### Changes

1. Quick Backtest: create, validate, save, clone, version, run, cancel, compare, and inspect strategies.
2. Basket Manager: CRUD, notes, folders, ordering, multipliers, shared capital, basket SL/TP, profit protection, contribution, and correlations.
3. Historical Simulator: date/expiry selection, 1/5/15-minute replay, pause/auto-forward, no-future-data guard, add/adjust/exit legs, and replay export.
4. Live Builder: real option chain, active expiry list, calls/puts, LTP, OI, volume, IV, Greeks, depth where available, lot size, margin estimate, and payoff at expiry.
5. Paper Portfolio: durable positions, orders, fills, realized/unrealized P&L, stale-price guards, idempotent entry/exit confirmation, and restart recovery.
6. Results Library: saved immutable runs, filters, trade drawer, warnings, manifest, quality grade, and exports.
7. Indicator experience: candles only by default; users explicitly add/remove studies and parameters.
8. UI quality: consistent spacing, aligned strategy summary, loading skeletons, actionable empty/error states, responsive layouts, keyboard navigation, focus visibility, reduced motion, and WCAG 2.2 AA checks.
9. Global status: market state, provider, data freshness, paper mode, incident banner, and background run progress.
10. Remove false institutional/compliance labels unless they are legally substantiated.

### Acceptance gate

- A user can go from strategy creation to backtest, trade inspection, export, replay, live observation, and paper position without a dead end.
- All primary workflows work at desktop, tablet, and mobile breakpoints.
- No screen relies on placeholder metrics or endless loaders.
- Accessibility automation reports no critical violations, followed by a keyboard-only manual pass.

## Part 5 — Production verification, operations, and release gates

**Goal:** make the private alpha supportable, observable, recoverable, and honest.

### Changes

1. Deploy the authenticated Worker to Cloudflare with D1 migrations and R2 objects; keep Vercel only for the static/demo surface if appropriate.
2. Add separate development, preview, and production environments with least-privilege secrets and documented rotation.
3. Add Playwright end-to-end tests for session entry, every instrument/interval, indicators, backtests, baskets, simulator, builder, paper trades, exports, and failure recovery.
4. Add contract tests against recorded provider fixtures, load tests, WebSocket reconnect tests, and long-session memory checks.
5. Add structured logs, privacy-safe request IDs, uptime checks, data-freshness alerts, quota alerts, client error reporting, and a public incident state.
6. Document and test database backup, object restore, migration rollback, deployment rollback, provider outage, token expiry, and data-corruption runbooks.
7. Add retention/deletion rules, privacy notice, terms, risk disclosures, data-source rights register, and security contact.
8. Complete threat models for identity/data and, separately, for any future live execution.
9. Keep live orders disabled behind both a feature flag and global kill switch until broker, legal, security, and regulatory gates are signed off.
10. Run a release-candidate reconciliation suite and independent manual acceptance pass before presenting professional-use claims.

### Zero-cost deployment boundary

- GitHub Actions is free for standard hosted runners on public repositories; private repositories receive a limited free allowance: <https://docs.github.com/en/billing/concepts/product-billing/github-actions>.
- Vercel Hobby is free but restricted to personal, non-commercial use and has quotas; it is suitable for a private/non-commercial demonstration, not a promised commercial production service: <https://vercel.com/docs/plans/hobby>.
- Cloudflare free tiers can support a small private alpha, but quotas must be monitored and hard stops configured. Free-tier terms and allowances can change.
- No paid service should be enabled automatically. Quota exhaustion must fail safely rather than create a bill.

### Acceptance gate

- CI, E2E, accessibility, security, reconciliation, and load gates pass on the release commit.
- Restore and rollback are demonstrated, not merely documented.
- Market-data rights are documented for every production source.
- The release is labeled accurately as research/paper trading until live-execution gates are complete.

## Delivery order and commit discipline

| Part | Deliverable | Commit checkpoint |
| --- | --- | --- |
| 1 | Secure, testable application foundation | `part-1-foundation` |
| 2 | Truthful market-data system | `part-2-market-data` |
| 3 | Deterministic options backtester | `part-3-engine` |
| 4 | Complete professional workflows | `part-4-workspaces` |
| 5 | Operationally verified release | `part-5-release` |

Each checkpoint must include its migrations, tests, documentation, and rollback notes. No hard reset should be run against active work. If another tool must work concurrently, it should use its own branch or worktree.

## Definition of success

Dokimi is ready for professional **research and paper use** only when all five acceptance gates pass, real and modeled data can never be confused, results reconcile to an immutable audit trail, failures are recoverable, and the product's claims match its actual data rights and operating model.

Professional live trading is a separate release requiring a broker write-capable authorization flow, order reconciliation, legal review, security approval, and applicable regulatory compliance. That release is outside the zero-cash promise.
