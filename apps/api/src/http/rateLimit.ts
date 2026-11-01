import { rateLimit, type Options } from 'express-rate-limit';
import { RedisStore } from 'rate-limit-redis';
import type { Redis } from 'ioredis';
import type { RequestHandler } from 'express';
import type { Config } from '../config';

const ONE_MINUTE_MS = 60_000;
const ONE_HOUR_MS = 3_600_000;
const MS_PER_SECOND = 1000;

export interface Limiters {
  global: RequestHandler;
  auth: RequestHandler;
  register: RequestHandler;
  publicApi: RequestHandler;
}

/** Redis-backed when available so limits hold across horizontally scaled instances. */
export function createLimiters(config: Config, redis?: Redis): Limiters {
  const make = (name: string, windowMs: number, limit: number): RequestHandler => {
    const options: Partial<Options> = {
      windowMs,
      limit,
      standardHeaders: 'draft-7',
      legacyHeaders: false,
      handler: (req, res) => {
        const retryAfter = Math.ceil(windowMs / MS_PER_SECOND);
        res.setHeader('Retry-After', String(retryAfter));
        res.status(429).json({
          data: null,
          meta: { requestId: req.requestId },
          error: { code: 'RATE_LIMITED', message: 'Too many requests', details: { retryAfterSeconds: retryAfter } },
        });
      },
    };
    if (redis) {
      options.store = new RedisStore({
        prefix: `rl:${name}:`,
        sendCommand: (...args: string[]) => redis.call(args[0] as string, ...args.slice(1)) as Promise<never>,
      });
    }
    return rateLimit(options);
  };
  return {
    global: make('global', ONE_MINUTE_MS, config.RATE_LIMIT_GLOBAL_MAX),
    auth: make('auth', ONE_MINUTE_MS, config.RATE_LIMIT_AUTH_MAX),
    register: make('register', ONE_HOUR_MS, config.RATE_LIMIT_REGISTER_MAX),
    publicApi: make('public', ONE_MINUTE_MS, config.RATE_LIMIT_PUBLIC_MAX),
  };
}
