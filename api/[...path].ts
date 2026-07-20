import { Hono } from "hono";
import { ApiError, toApiError } from "../backend/src/lib/errors.js";
import { ok } from "../backend/src/lib/http.js";
import { requestContext } from "../backend/src/middleware/request-context.js";
import { security } from "../backend/src/middleware/security.js";
import { demoRoutes } from "../backend/src/routes/demo.js";
import type { AppEnvironment } from "../backend/src/types.js";
import type { Bindings } from "../backend/src/types.js";

interface Counter {
  count: number;
  expiresAt: number;
}

const counters = new Map<string, Counter>();

function createDemoDatabase(): D1Database {
  return {
    prepare(query: string) {
      let parameters: unknown[] = [];
      const statement = {
        bind(...values: unknown[]) {
          parameters = values;
          return statement;
        },
        async first<T>() {
          if (/^SELECT\s+1/iu.test(query.trim())) return { ok: 1 } as T;
          if (!query.includes("rate_limit_windows")) {
            throw new Error(
              "This Vercel deployment exposes only the public V1 demo API.",
            );
          }

          const [key, windowStart, expiresAt] = parameters;
          if (
            typeof key !== "string" ||
            typeof windowStart !== "number" ||
            typeof expiresAt !== "number"
          ) {
            throw new Error("Invalid rate-limit statement.");
          }

          const counterKey = `${key}:${windowStart}`;
          const previous = counters.get(counterKey);
          const count = (previous?.count ?? 0) + 1;
          counters.set(counterKey, { count, expiresAt });

          const now = Math.floor(Date.now() / 1000);
          if (counters.size > 500) {
            for (const [candidate, counter] of counters) {
              if (counter.expiresAt < now) counters.delete(candidate);
            }
          }
          return { count } as T;
        },
      };
      return statement;
    },
  } as unknown as D1Database;
}

const demoDatabase = createDemoDatabase();
const app = new Hono<AppEnvironment>();

app.use("*", requestContext);
app.use("*", security);
app.get("/health/live", (context) => ok(context, { status: "ok" }));
app.get("/health/ready", (context) =>
  ok(context, { status: "ready", storage: "public_demo_adapter" }),
);
app.route("/v1/demo", demoRoutes);

app.notFound(() => {
  throw new ApiError(
    404,
    "ROUTE_NOT_FOUND",
    "The requested API route does not exist.",
  );
});

app.onError((error, context) => {
  const apiError = toApiError(error);
  if (apiError.status >= 500) {
    console.error(
      JSON.stringify({
        timestamp: new Date().toISOString(),
        level: "error",
        message: "request_failed",
        traceId: context.get("requestId"),
        method: context.req.method,
        path: new URL(context.req.url).pathname,
        code: apiError.code,
        error: error instanceof Error ? error.message : "unknown",
      }),
    );
  }
  return context.json(
    {
      error: {
        code: apiError.code,
        message: apiError.message,
        retryable: apiError.retryable,
        ...(apiError.details === undefined
          ? {}
          : { details: apiError.details }),
        traceId: context.get("requestId"),
      },
    },
    apiError.status as 400,
  );
});

function bindingsFor(request: Request): Bindings {
  const origin = new URL(request.url).origin;
  const bindings: Bindings = {
    DB: demoDatabase,
    OBJECTS: {} as R2Bucket,
    APP_ENV: "production",
    ALLOWED_ORIGINS: [origin, process.env.ALLOWED_ORIGINS]
      .filter(Boolean)
      .join(","),
    API_BASE_URL: `${origin}/api`,
    LIVE_TRADING_ENABLED: "false",
    GLOBAL_TRADING_KILL_SWITCH: "true",
    PHONE_VERIFICATION_REQUIRED: "false",
    SESSION_TTL_SECONDS: "2592000",
    MAX_RESULT_BYTES: "5242880",
    SESSION_SIGNING_SECRET:
      process.env.SESSION_SIGNING_SECRET ?? "vercel-demo-session-disabled",
    DATASET_SIGNING_SECRET:
      process.env.DATASET_SIGNING_SECRET ?? "vercel-demo-dataset-disabled",
    UPSTOX_API_BASE_URL:
      process.env.UPSTOX_API_BASE_URL ?? "https://api.upstox.com",
    ...(process.env.UPSTOX_ANALYTICS_TOKEN
      ? { UPSTOX_ANALYTICS_TOKEN: process.env.UPSTOX_ANALYTICS_TOKEN }
      : {}),
  };
  return bindings;
}

export default {
  async fetch(request: Request): Promise<Response> {
    const requestUrl = new URL(request.url);
    const routedPath = requestUrl.searchParams.get("path");
    if (routedPath) {
      requestUrl.pathname = `/${routedPath}`;
      requestUrl.searchParams.delete("path");
    } else {
      requestUrl.pathname = requestUrl.pathname.replace(/^\/api(?=\/)/u, "");
    }
    return app.fetch(new Request(requestUrl, request), bindingsFor(request));
  },
};
