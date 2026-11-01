import { z } from 'zod';
import { TENANT_ASSIGNABLE_ROLES } from './rbac';

const MIN_PASSWORD_LENGTH = 12;
const MAX_PASSWORD_LENGTH = 128;
const MFA_CODE_LENGTH = 6;

export const emailSchema = z.string().trim().toLowerCase().email().max(254);

export const passwordSchema = z
  .string()
  .min(MIN_PASSWORD_LENGTH, `Password must be at least ${MIN_PASSWORD_LENGTH} characters`)
  .max(MAX_PASSWORD_LENGTH)
  .refine((p) => /[a-z]/.test(p) && /[A-Z]/.test(p) && /\d/.test(p), {
    message: 'Password must contain upper-case, lower-case and a digit',
  });

export const loginSchema = z.object({
  email: emailSchema,
  password: z.string().min(1).max(MAX_PASSWORD_LENGTH),
});

export const mfaTokenSchema = z.object({ mfaToken: z.string().min(1) });

export const mfaVerifySchema = mfaTokenSchema.extend({
  code: z.string().regex(new RegExp(`^\\d{${MFA_CODE_LENGTH}}$`), 'Code must be 6 digits'),
});

export const refreshSchema = z.object({ refreshToken: z.string().min(1) });

export const registerTenantSchema = z.object({
  companyName: z.string().trim().min(2).max(120),
  adminName: z.string().trim().min(2).max(120),
  adminEmail: emailSchema,
  adminPassword: passwordSchema,
});

export const createUserSchema = z.object({
  email: emailSchema,
  fullName: z.string().trim().min(2).max(120),
  password: passwordSchema,
  role: z.enum(TENANT_ASSIGNABLE_ROLES),
});

export const TENANT_STATUSES = ['pending', 'active', 'suspended'] as const;
export type TenantStatus = (typeof TENANT_STATUSES)[number];

export const updateTenantStatusSchema = z.object({ status: z.enum(['active', 'suspended']) });

export const pageQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(100).default(25),
  cursor: z.string().max(200).optional(),
});

export type LoginInput = z.infer<typeof loginSchema>;
export type RegisterTenantInput = z.infer<typeof registerTenantSchema>;
export type CreateUserInput = z.infer<typeof createUserSchema>;
export type PageQuery = z.infer<typeof pageQuerySchema>;

// ---------- Phase 3: supply chain ----------
const MAX_QUANTITY = 100_000_000;
const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Use YYYY-MM-DD');

export const createOrganizationSchema = z.object({
  type: z.enum(['distributor', 'wholesaler', 'retailer']),
  legalName: z.string().trim().min(2).max(160),
  registrationNo: z.string().trim().min(3).max(60),
  adminName: z.string().trim().min(2).max(120),
  adminEmail: emailSchema,
  adminPassword: passwordSchema,
});

const certificationSchema = z.object({
  type: z.string().trim().min(2).max(80),
  issuer: z.string().trim().min(2).max(120),
  number: z.string().trim().min(1).max(80),
  validFrom: isoDate.optional(),
  validTo: isoDate.optional(),
});

export const createProductSchema = z.object({
  name: z.string().trim().min(2).max(120),
  brand: z.string().trim().min(2).max(120),
  cropType: z.string().trim().min(2).max(80),
  variety: z.string().trim().min(1).max(80),
  category: z.string().trim().min(2).max(80),
  description: z.string().trim().max(2000).default(''),
  packaging: z.record(z.string(), z.union([z.string(), z.number()])).default({}),
  regulatoryIds: z.record(z.string(), z.string().max(120)).default({}),
  certifications: z.array(certificationSchema).max(20).default([]),
});

export const updateProductSchema = createProductSchema
  .pick({ description: true, packaging: true, regulatoryIds: true })
  .partial();

export const createBatchSchema = z
  .object({
    productId: z.string().uuid(),
    manufacturingDate: isoDate,
    expiryDate: isoDate,
    productionLocation: z.string().trim().min(2).max(160),
    facility: z.string().trim().min(2).max(160),
    initialQuantity: z.number().int().min(1).max(MAX_QUANTITY),
    unit: z.enum(['packet', 'kg']).default('packet'),
    certifications: z.array(certificationSchema).max(20).default([]),
  })
  .refine((b) => b.expiryDate > b.manufacturingDate, { path: ['expiryDate'], message: 'Expiry must be after manufacturing date' });

export const createTransferSchema = z.object({
  batchId: z.string().uuid(),
  toOrgId: z.string().uuid(),
  quantity: z.number().int().min(1).max(MAX_QUANTITY),
  note: z.string().trim().max(500).optional(),
});

export const dispatchTransferSchema = z.object({
  sourceLocation: z.string().trim().min(2).max(160),
  destinationLocation: z.string().trim().min(2).max(160),
  carrier: z.string().trim().max(120).optional(),
  vehicleRef: z.string().trim().max(60).optional(),
});

export const acceptTransferSchema = z.object({
  receivedQuantity: z.number().int().min(0).max(MAX_QUANTITY).optional(),
  note: z.string().trim().max(500).optional(),
});

export const rejectTransferSchema = z.object({ reason: z.string().trim().min(3).max(500) });

export const recordSaleSchema = z.object({
  batchId: z.string().uuid(),
  quantity: z.number().int().min(1).max(MAX_QUANTITY),
});

export const idempotencyKeySchema = z.string().trim().min(8).max(100);

export type CreateOrganizationInput = z.infer<typeof createOrganizationSchema>;
export type CreateProductInput = z.infer<typeof createProductSchema>;
export type CreateBatchInput = z.infer<typeof createBatchSchema>;
export type CreateTransferInput = z.infer<typeof createTransferSchema>;
export type DispatchTransferInput = z.infer<typeof dispatchTransferSchema>;
export type AcceptTransferInput = z.infer<typeof acceptTransferSchema>;
export type RecordSaleInput = z.infer<typeof recordSaleSchema>;
