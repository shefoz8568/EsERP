import { Logger } from '@nestjs/common';

const logger = new Logger('Config');

export interface AppConfig {
  port: number;
  nodeEnv: string;
  databaseUrl: string;
  redisUrl: string;
  jwtAccessSecret: string;
  jwtRefreshSecret: string;
  jwtAccessTtlSeconds: number;
  jwtRefreshTtlSeconds: number;
  corsOrigin: string;
  s3: { endpoint?: string; region: string; bucket: string; accessKey: string; secretKey: string };
  smtp: { host: string; port: number; user?: string; pass?: string; from: string };
  oauth: {
    google: { clientId?: string; clientSecret?: string };
    microsoft: { clientId?: string; clientSecret?: string };
    callbackUrl: string;
  };
  otelEnabled: boolean;
  otelEndpoint?: string;
  /** Phase 11 — rate limiting (per tenant + IP; per API key separately). */
  rateLimit: { max: number; windowSeconds: number; apiKeyMax: number; apiKeyWindowSeconds: number };
  /** Phase 11 — field encryption key (64 hex chars) for HR sensitive fields. */
  encryptionKey?: string;
  /** Phase 11 — ZATCA sandbox credentials (empty = simulation mode). */
  zatca: { mode: string; sandboxUrl?: string; complianceCsid?: string; secret?: string };
  /** Phase 11 — payment / SMS provider credentials (empty = mock providers). */
  providers: { moyasarKey?: string; hyperpayUserId?: string; hyperpayEntityId?: string; hyperpayToken?: string; smsApiKey?: string; smsSender?: string };
}

/** Env config with validation. In production missing JWT secrets are fatal;
 *  in dev, defaults are allowed but logged loudly. */
export default (): AppConfig => {
  const isProd = process.env.NODE_ENV === 'production';
  const access = process.env.JWT_ACCESS_SECRET;
  const refresh = process.env.JWT_REFRESH_SECRET;
  if (isProd && (!access || !refresh)) {
    throw new Error('JWT_ACCESS_SECRET and JWT_REFRESH_SECRET are required in production');
  }
  if (!isProd && (!access || !refresh)) {
    logger.warn('JWT secrets not set — using INSECURE dev defaults. Never use these in production.');
  }
  return {
    port: Number(process.env.API_PORT ?? 3001),
    nodeEnv: process.env.NODE_ENV ?? 'development',
    databaseUrl: process.env.DATABASE_URL ?? '',
    redisUrl: process.env.REDIS_URL ?? 'redis://localhost:6379',
    jwtAccessSecret: access ?? 'dev-access-secret-change-me',
    jwtRefreshSecret: refresh ?? 'dev-refresh-secret-change-me',
    jwtAccessTtlSeconds: Number(process.env.JWT_ACCESS_TTL_SECONDS ?? 900),
    jwtRefreshTtlSeconds: Number(process.env.JWT_REFRESH_TTL_SECONDS ?? 2592000),
    corsOrigin: process.env.CORS_ORIGIN ?? process.env.WEB_URL ?? 'http://localhost:3000',
    s3: {
      endpoint: process.env.S3_ENDPOINT || undefined,
      region: process.env.S3_REGION ?? 'us-east-1',
      bucket: process.env.S3_BUCKET ?? 'eserp-files',
      accessKey: process.env.S3_ACCESS_KEY ?? 'minioadmin',
      secretKey: process.env.S3_SECRET_KEY ?? 'minioadmin',
    },
    smtp: {
      host: process.env.SMTP_HOST ?? 'localhost',
      port: Number(process.env.SMTP_PORT ?? 1025),
      user: process.env.SMTP_USER || undefined,
      pass: process.env.SMTP_PASSWORD || undefined,
      from: process.env.SMTP_FROM ?? 'EsERP <noreply@eserp.local>',
    },
    oauth: {
      google: { clientId: process.env.GOOGLE_CLIENT_ID || undefined, clientSecret: process.env.GOOGLE_CLIENT_SECRET || undefined },
      microsoft: { clientId: process.env.MICROSOFT_CLIENT_ID || undefined, clientSecret: process.env.MICROSOFT_CLIENT_SECRET || undefined },
      callbackUrl: process.env.OAUTH_CALLBACK_URL ?? 'http://localhost:3001/api/v1/auth/oauth/callback',
    },
    otelEnabled: process.env.OTEL_ENABLED === 'true',
    otelEndpoint: process.env.OTEL_EXPORTER_OTLP_ENDPOINT || undefined,
    rateLimit: {
      max: Number(process.env.RATE_LIMIT_MAX ?? 600),
      windowSeconds: Number(process.env.RATE_LIMIT_WINDOW_SECONDS ?? 60),
      apiKeyMax: Number(process.env.API_KEY_RATE_LIMIT_MAX ?? 300),
      apiKeyWindowSeconds: Number(process.env.API_KEY_RATE_LIMIT_WINDOW_SECONDS ?? 60),
    },
    encryptionKey: process.env.ENCRYPTION_KEY || undefined,
    zatca: {
      mode: (process.env.ZATCA_MODE ?? 'simulation').toLowerCase(),
      sandboxUrl: process.env.ZATCA_SANDBOX_URL || undefined,
      complianceCsid: process.env.ZATCA_COMPLIANCE_CSID || undefined,
      secret: process.env.ZATCA_SECRET || undefined,
    },
    providers: {
      moyasarKey: process.env.MOYASAR_API_KEY || undefined,
      hyperpayUserId: process.env.HYPERPAY_USER_ID || undefined,
      hyperpayEntityId: process.env.HYPERPAY_ENTITY_ID || undefined,
      hyperpayToken: process.env.HYPERPAY_ACCESS_TOKEN || undefined,
      smsApiKey: process.env.SMS_API_KEY || undefined,
      smsSender: process.env.SMS_SENDER || undefined,
    },
  };
};
