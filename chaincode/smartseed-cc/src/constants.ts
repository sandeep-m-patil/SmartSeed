export const CONTRACT_NAME = 'SmartSeedContract';

export enum Role {
  Manufacturer = 'manufacturer',
  Distributor = 'distributor',
  Retailer = 'retailer',
  Carrier = 'carrier',
  Authority = 'authority',
  Admin = 'admin',
  Gateway = 'gateway',
}

export enum EventType {
  ProductRegistered = 'PRODUCT_REGISTERED',
  BatchRegistered = 'BATCH_REGISTERED',
  TransferInitiated = 'TRANSFER_INITIATED',
  TransferAccepted = 'TRANSFER_ACCEPTED',
  TransferRejected = 'TRANSFER_REJECTED',
  TransferCancelled = 'TRANSFER_CANCELLED',
  ShipmentRecorded = 'SHIPMENT_RECORDED',
  RetailSale = 'RETAIL_SALE',
  FarmerVerification = 'FARMER_VERIFICATION',
  StatusUpdated = 'STATUS_UPDATED',
  CounterfeitReport = 'COUNTERFEIT_REPORT',
  InvestigationOutcome = 'INVESTIGATION_OUTCOME',
}

export enum BatchStatus {
  Active = 'ACTIVE',
  Held = 'HELD',
  Recalled = 'RECALLED',
  Revoked = 'REVOKED',
  Expired = 'EXPIRED',
  SoldOut = 'SOLD_OUT',
}

export enum ReportReason {
  LabelMismatch = 'LABEL_MISMATCH',
  DuplicateScan = 'DUPLICATE_SCAN',
  PackagingSuspect = 'PACKAGING_SUSPECT',
  Other = 'OTHER',
}

export enum Outcome {
  Confirmed = 'CONFIRMED',
  Cleared = 'CLEARED',
  Inconclusive = 'INCONCLUSIVE',
}

export enum ResultStatus {
  Committed = 'COMMITTED',
  AlreadyCommitted = 'ALREADY_COMMITTED',
}

export enum ErrorCode {
  MissingAttribute = 'MISSING_ATTRIBUTE',
  UnauthorizedRole = 'UNAUTHORIZED_ROLE',
  WrongTenant = 'WRONG_TENANT',
  NotOwner = 'NOT_OWNER',
  NotReceiver = 'NOT_RECEIVER',
  NotHolder = 'NOT_HOLDER',
  NotSender = 'NOT_SENDER',
  InvalidInput = 'INVALID_INPUT',
  NotFound = 'NOT_FOUND',
  AlreadyExists = 'ALREADY_EXISTS',
  EventImmutable = 'EVENT_IMMUTABLE',
  DuplicateEventMismatch = 'DUPLICATE_EVENT_MISMATCH',
  InvalidCorrection = 'INVALID_CORRECTION',
  BatchRevoked = 'BATCH_REVOKED',
  BatchHeld = 'BATCH_HELD',
  BatchExpired = 'BATCH_EXPIRED',
  BatchNotActive = 'BATCH_NOT_ACTIVE',
  NoPendingTransfer = 'NO_PENDING_TRANSFER',
  IllegalTransition = 'ILLEGAL_TRANSITION',
  CommitmentMismatch = 'COMMITMENT_MISMATCH',
  QuantityExceeded = 'QUANTITY_EXCEEDED',
  InvalidExpiry = 'INVALID_EXPIRY',
}

export const ATTR_ROLE = 'role';
export const ATTR_TENANT_ID = 'tenantId';
export const ATTR_ORG_ID = 'orgId';

export const KEY_PRODUCT = 'PRODUCT:';
export const KEY_BATCH = 'BATCH:';
export const KEY_EVENT = 'EVENT:';
export const KEY_HOLDING = 'HOLDING:';
export const KEY_PENDING = 'PENDING:';
export const KEY_SEPARATOR = ':';
export const KEY_RANGE_END = ';'; // next char after ':' - exclusive end of a prefix range
export const BATCH_EVENT_INDEX = 'BATCH~EVENT';
export const SEQ_PAD_WIDTH = 10;

export const PDC_PREFIX = 'pdc_';
export const PDC_KEY_QTY = 'QTY:';
export const PDC_KEY_HOLD = 'HOLD:';
export const PDC_KEY_SOLD = 'SOLD:';
export const TRANSIENT_QUANTITY = 'quantity';
export const TRANSIENT_SALT = 'salt';
export const COMMITMENT_SEPARATOR = '|';
export const ORG_HASH_PREFIX = 'smartseed:org:';

export const MS_PER_SECOND = 1000;
export const NANOS_PER_MS = 1_000_000;
export const MAX_ID_LENGTH = 64;
export const MIN_ID_LENGTH = 3;
export const MAX_QUANTITY_DIGITS = 15;
export const SHA256_HEX_LENGTH = 64;
