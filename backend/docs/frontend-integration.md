# Frontend integration contract

## Demo flow (recommended for the showcase)

1. Fetch `GET /v1/demo/strategy` and use `response.data` as the editable strategy preset.
2. Send it to `POST /v1/demo/backtest` as `{ "configuration": strategy }`.
3. Render `response.data.summary`, `equityCurve`, and `trades`.
4. Keep the two returned warnings visible. The data is synthetic by design.

The separate market-analysis flow uses real, read-only data when the backend has an Upstox Analytics Token:

```text
GET /v1/demo/market/status
GET /v1/demo/crypto/analysis?symbol=SOLUSDT&interval=5
GET /v1/demo/market/analysis?symbol=NIFTY&interval=5
GET /v1/demo/market/modeled-analysis?symbol=NIFTY&interval=5
GET /v1/demo/market/option-chain?symbol=NIFTY&expiry=2026-07-30
```

Check `status.data.configured` before requesting analysis. Analysis returns `quote`, chronological `candles`, an index-aligned `indicators` array, the latest indicator point, calculation parameters, and freshness metadata. A missing token produces `MARKET_DATA_TOKEN_REQUIRED`; never request or store the provider token in the frontend.

Successful responses use:

```json
{
  "data": {},
  "traceId": "request-correlation-id"
}
```

Errors use:

```json
{
  "error": {
    "code": "VALIDATION_FAILED",
    "message": "The request is invalid.",
    "retryable": false,
    "details": { "issues": [] },
    "traceId": "request-correlation-id"
  }
}
```

## Access form

The current frontend email field is supported directly:

```text
POST /v1/auth/signup  { "email": "person@example.com", "password": "at-least-12-characters" }
POST /v1/auth/login   { "email": "person@example.com", "password": "at-least-12-characters" }
```

Use `credentials: "include"` on every authenticated fetch. After signup/login, read the `dokimi_csrf` cookie and send its value as `X-CSRF-Token` on authenticated `POST`, `PATCH`, and `DELETE` requests. The session itself is an HttpOnly cookie.

For local Vite development, `http://localhost:5173` is already allowed. Configure `VITE_API_BASE_URL=http://localhost:8787` in the frontend environment.

## Authenticated showcase resources

```text
GET/POST       /v1/strategies
GET/PATCH      /v1/strategies/{id}
POST           /v1/strategies/{id}/versions
POST           /v1/strategies/{id}/share
GET/POST       /v1/baskets
POST           /v1/runs/estimate
POST           /v1/runs                 (requires Idempotency-Key)
POST           /v1/runs/{id}/save
GET/POST       /v1/portfolios
POST           /v1/brokers/paper/authorize
POST           /v1/trade-groups
POST           /v1/trade-groups/{id}/confirm-entry (requires Idempotency-Key)
POST           /v1/trade-groups/{id}/confirm-exit  (requires Idempotency-Key)
```

Live market-analysis routes are read-only. Broker execution remains release-gated; label execution as `Paper` and keep synthetic backtest results clearly distinguished from exchange data.
