export interface Bindings {
  DB: D1Database;
  OBJECTS: R2Bucket;
  APP_ENV: string;
  ALLOWED_ORIGINS: string;
  API_BASE_URL: string;
  LIVE_TRADING_ENABLED: string;
  GLOBAL_TRADING_KILL_SWITCH: string;
  PHONE_VERIFICATION_REQUIRED: string;
  SESSION_TTL_SECONDS: string;
  MAX_RESULT_BYTES: string;
  SESSION_SIGNING_SECRET: string;
  DATASET_SIGNING_SECRET: string;
  PASSWORD_RESET_WEBHOOK_URL?: string;
  OPERATOR_API_KEY?: string;
  UPSTOX_ANALYTICS_TOKEN?: string;
  UPSTOX_API_BASE_URL?: string;
}

export interface AuthUser {
  id: string;
  phoneE164: string | null;
  email: string | null;
  role: 'user' | 'operator' | 'admin';
  sessionId: string;
  csrfHash: string;
}

export interface Variables {
  requestId: string;
  user: AuthUser;
}

export interface AppEnvironment {
  Bindings: Bindings;
  Variables: Variables;
}
