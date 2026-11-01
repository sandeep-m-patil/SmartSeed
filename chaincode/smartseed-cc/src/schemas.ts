import { z } from 'zod';
import { BatchStatus, MAX_ID_LENGTH, MIN_ID_LENGTH, Outcome, ReportReason, SHA256_HEX_LENGTH } from './constants';

// Every string field is pattern-restricted: no free text can reach the ledger.
const idString = z.string().regex(new RegExp(`^[A-Za-z0-9_-]{${MIN_ID_LENGTH},${MAX_ID_LENGTH}}$`));
const refString = z.string().regex(new RegExp(`^[A-Za-z0-9_.:-]{1,${MAX_ID_LENGTH}}$`));
const hex = z.string().regex(new RegExp(`^[a-f0-9]{${SHA256_HEX_LENGTH}}$`));
const epochMs = z.number().int().positive().refine(Number.isSafeInteger);
const regionCode = z.string().regex(/^[A-Z]{2}(-[A-Z0-9]{1,3})?$/);

const eventBase = {
  eventId: idString,
  recordHash: hex,
  dbRecordRef: refString.optional(),
  signatureRef: refString.optional(),
  corrects: idString.optional(),
};
const onBatch = { ...eventBase, batchId: idString };

export const RegisterProductInput = z.object({ ...eventBase, productId: idString, ownerTenantId: idString }).strict();
export const RegisterBatchInput = z
  .object({ ...onBatch, productId: idString, quantityCommitment: hex, mfgDateMs: epochMs, expiryDateMs: epochMs })
  .strict();
export const TransferInput = z.object({ ...onBatch, toTenantId: idString, quantityCommitment: hex }).strict();
export const TransferResponseInput = z.object({ ...onBatch, transferEventId: idString }).strict();
export const ShipmentInput = z.object({ ...onBatch, transferEventId: idString }).strict();
export const RetailSaleInput = z.object({ ...onBatch, saleCommitment: hex }).strict();
export const FarmerVerificationInput = z.object({ ...onBatch, farmerHash: hex, regionCode }).strict();
export const StatusUpdateInput = z.object({ ...onBatch, newStatus: z.nativeEnum(BatchStatus) }).strict();
export const CounterfeitReportInput = z.object({ ...onBatch, reason: z.nativeEnum(ReportReason) }).strict();
export const OutcomeInput = z
  .object({ ...onBatch, reportEventId: idString, outcome: z.nativeEnum(Outcome) })
  .strict();

export interface EventBaseInput {
  eventId: string;
  recordHash: string;
  dbRecordRef?: string | undefined;
  signatureRef?: string | undefined;
  corrects?: string | undefined;
  batchId?: string;
}

export type RegisterProductInput = z.infer<typeof RegisterProductInput>;
export type RegisterBatchInput = z.infer<typeof RegisterBatchInput>;
export type TransferInput = z.infer<typeof TransferInput>;
export type TransferResponseInput = z.infer<typeof TransferResponseInput>;
export type ShipmentInput = z.infer<typeof ShipmentInput>;
export type RetailSaleInput = z.infer<typeof RetailSaleInput>;
export type FarmerVerificationInput = z.infer<typeof FarmerVerificationInput>;
export type StatusUpdateInput = z.infer<typeof StatusUpdateInput>;
export type CounterfeitReportInput = z.infer<typeof CounterfeitReportInput>;
export type OutcomeInput = z.infer<typeof OutcomeInput>;
