import { z } from 'zod';

/** Validation at the boundary: unknown enum values are rejected (fail closed), never trusted. */
export const verifyResultSchema = z.object({
  product: z.object({ name: z.string(), brand: z.string(), cropType: z.string(), variety: z.string() }).nullable(),
  manufacturer: z.object({ name: z.string() }).nullable(),
  batch: z
    .object({ code: z.string(), mfgDate: z.string(), expiryDate: z.string(), expired: z.boolean() })
    .nullable(),
  package: z
    .object({ serialNo: z.string() })
    .nullish()
    .transform((v) => v ?? null),
  certifications: z.array(
    z.object({ type: z.string(), issuer: z.string(), number: z.string(), validTo: z.string().nullable() }),
  ),
  // step/orgType/status stay open strings so a future server code cannot break the app; UI maps unknowns to a generic label.
  journey: z.array(z.object({ step: z.string(), orgType: z.string(), at: z.string(), status: z.string() })),
  verification: z.object({
    digitalIdentity: z.enum(['VALID', 'REVOKED', 'UNKNOWN']),
    blockchain: z.enum(['VERIFIED', 'UNVERIFIED', 'FAILED']),
    scanActivity: z.enum(['NORMAL', 'SUSPICIOUS']),
    investigation: z.enum(['NONE', 'UNDER_INVESTIGATION', 'CONFIRMED_COUNTERFEIT']),
  }),
  risk: z.object({
    score: z.number(),
    level: z.enum(['LOW', 'MEDIUM', 'HIGH', 'CRITICAL']),
    assessed: z.boolean(),
  }),
  indicator: z.enum(['GREEN', 'YELLOW', 'RED']),
  warnings: z.array(z.string()),
  asOf: z.string(),
});

export const notificationSchema = z.object({
  id: z.string(),
  type: z.string().nullish(),
  title: z.string(),
  body: z.string(),
  createdAt: z.string(),
  readAt: z.string().nullish(),
});
export const notificationsSchema = z.array(notificationSchema);

export type AppNotification = z.infer<typeof notificationSchema>;

export const envelopeSchema = z.object({
  data: z.unknown().optional(),
  meta: z.unknown().optional(),
  error: z.object({ code: z.string().optional(), message: z.string().optional() }).nullable().optional(),
});
