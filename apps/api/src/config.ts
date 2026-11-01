import { z } from 'zod';

const MAX_ACCESS_TTL_SECONDS = 900; // security policy: access tokens <= 15 min
const ENCRYPTION_KEY_BYTES = 32;

const pem = z.string().min(1).transform((v) => v.replace(/\n/g, '\n'));

const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'staging', 'production']).default('development'),
  PORT: z.coerce.number().int().default(4000),
  LOG_LEVEL: z.string().default('info'),
  DATABASE_URL: z.string().min(1),
  REDIS_URL: z.string().optional(),
  JWT_PRIVATE_KEY: pem,
  JWT_PUBLIC_KEY: pem,
  JWT_ISSUER: z.string().default('smartseed'),
  ACCESS_TTL_SECONDS: z.coerce.number().int().min(60).max(MAX_ACCESS_TTL_SECONDS).default(MAX_ACCESS_TTL_SECONDS),
  REFRESH_TTL_DAYS: z.coerce.number().int().min(1).max(90).default(14),
  FIELD_ENCRYPTION_KEY: z
    .string()
    .refine((v) => Buffer.from(v, 'base64').length === ENCRYPTION_KEY_BYTES, 'must be 32 bytes, base64'),
  CORS_ORIGINS: z.string().default('').transform((v) => v.split(',').map((s) => s.trim()).filter(Boolean)),
  RATE_LIMIT_GLOBAL_MAX: z.coerce.number().int().default(300),
  RATE_LIMIT_AUTH_MAX: z.coerce.number().int().default(10),
  RATE_LIMIT_REGISTER_MAX: z.coerce.number().int().default(5),
  RATE_LIMIT_PUBLIC_MAX: z.coerce.number().int().default(60),
  METRICS_TOKEN: z.string().min(16).optional(),
  SMTP_URL: z.string().optional(),
  EMAIL_FROM: z.string().default('SmartSeed <no-reply@smartseed.example>'),
  AI_SERVICE_URL: z.string().url().optional(),
  AI_SHARED_SECRET: z.string().optional(),
  ANTHROPIC_API_KEY: z.string().optional(),
  INVESTIGATION_MODEL: z.string().default('claude-sonnet-5-5'),
  FABRIC_PEER_ENDPOINT: z.string().optional(),
  FABRIC_PEER_TLS_CA_PATH: z.string().optional(),
  FABRIC_PEER_HOST_ALIAS: z.string().optional(),
  FABRIC_CHANNEL: z.string().default('seedchannel'),
  FABRIC_CHAINCODE: z.string().default('smartseed'),
  FABRIC_WALLET_DIR: z.string().optional(),
  FABRIC_USE_PDC: z.enum(['true', 'false']).default('false').transform((v) => v === 'true'),
  APP_SIGNING_PRIVATE_KEY: pem.optional(),
  RAZORPAY_KEY_ID: z.string().optional(),
  RAZORPAY_KEY_SECRET: z.string().optional(),
  RAZORPAY_WEBHOOK_SECRET: z.string().optional(),
  BILLING_GRACE_DAYS: z.coerce.number().int().min(0).default(7),
  SSE_INTERVAL_MS: z.coerce.number().int().min(100).default(3000),
  PUBLIC_VERIFY_BASE_URL: z.string().url().default('https://smartseed.example'),
});

export type Config = z.infer<typeof envSchema>;

export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  const parsed = envSchema.safeParse(env);
  if (!parsed.success) {
    const issues = parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; ');
    throw new Error(`Invalid environment configuration: ${issues}`);
  }
  return parsed.data;
}
