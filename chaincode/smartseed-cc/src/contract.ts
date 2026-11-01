import { Context, Contract, Info, Returns, Transaction } from 'fabric-contract-api';
import { ROLES_OWNER, ROLES_PRIVILEGED } from './auth';
import { CONTRACT_NAME, Role } from './constants';
import { execute } from './execute';
import { recordInvestigationOutcome, updateBatchStatus } from './handlers/lifecycle';
import {
  recordCounterfeitReport,
  recordFarmerVerification,
  recordRetailSale,
  recordShipment,
} from './handlers/recording';
import { registerBatch, registerProduct } from './handlers/registration';
import { acceptBatch, cancelTransfer, rejectBatch, transferBatch } from './handlers/transfer';
import { getBatchHistoryJson, getBatchJson, getEventJson, verifyRecordHashJson } from './queries';
import * as S from './schemas';

const TRANSFER_PARTIES: readonly Role[] = ROLES_OWNER;
const SHIPPERS: readonly Role[] = [...ROLES_OWNER, Role.Carrier];
const STATUS_ACTORS: readonly Role[] = [...ROLES_OWNER, ...ROLES_PRIVILEGED];

@Info({ title: CONTRACT_NAME, description: 'SmartSeed seed supply-chain traceability (commitments and hashes only)' })
export class SmartSeedContract extends Contract {
  constructor() {
    super(CONTRACT_NAME);
  }

  @Transaction()
  @Returns('string')
  public async RegisterProduct(ctx: Context, input: string): Promise<string> {
    return execute(ctx, input, {
      fn: 'RegisterProduct',
      roles: [Role.Manufacturer],
      schema: S.RegisterProductInput,
      handler: registerProduct,
    });
  }

  @Transaction()
  @Returns('string')
  public async RegisterBatch(ctx: Context, input: string): Promise<string> {
    return execute(ctx, input, {
      fn: 'RegisterBatch',
      roles: [Role.Manufacturer],
      schema: S.RegisterBatchInput,
      handler: registerBatch,
    });
  }

  @Transaction()
  @Returns('string')
  public async TransferBatch(ctx: Context, input: string): Promise<string> {
    return execute(ctx, input, {
      fn: 'TransferBatch',
      roles: TRANSFER_PARTIES,
      schema: S.TransferInput,
      handler: transferBatch,
    });
  }

  @Transaction()
  @Returns('string')
  public async AcceptBatch(ctx: Context, input: string): Promise<string> {
    return execute(ctx, input, {
      fn: 'AcceptBatch',
      roles: TRANSFER_PARTIES,
      schema: S.TransferResponseInput,
      handler: acceptBatch,
    });
  }

  @Transaction()
  @Returns('string')
  public async RejectBatch(ctx: Context, input: string): Promise<string> {
    return execute(ctx, input, {
      fn: 'RejectBatch',
      roles: TRANSFER_PARTIES,
      schema: S.TransferResponseInput,
      handler: rejectBatch,
    });
  }

  @Transaction()
  @Returns('string')
  public async CancelTransfer(ctx: Context, input: string): Promise<string> {
    return execute(ctx, input, {
      fn: 'CancelTransfer',
      roles: TRANSFER_PARTIES,
      schema: S.TransferResponseInput,
      handler: cancelTransfer,
    });
  }

  @Transaction()
  @Returns('string')
  public async RecordShipment(ctx: Context, input: string): Promise<string> {
    return execute(ctx, input, {
      fn: 'RecordShipment',
      roles: SHIPPERS,
      schema: S.ShipmentInput,
      handler: recordShipment,
    });
  }

  @Transaction()
  @Returns('string')
  public async RecordRetailSale(ctx: Context, input: string): Promise<string> {
    return execute(ctx, input, {
      fn: 'RecordRetailSale',
      roles: [Role.Retailer],
      schema: S.RetailSaleInput,
      handler: recordRetailSale,
    });
  }

  @Transaction()
  @Returns('string')
  public async RecordFarmerVerification(ctx: Context, input: string): Promise<string> {
    return execute(ctx, input, {
      fn: 'RecordFarmerVerification',
      roles: [Role.Gateway],
      schema: S.FarmerVerificationInput,
      handler: recordFarmerVerification,
    });
  }

  @Transaction()
  @Returns('string')
  public async UpdateBatchStatus(ctx: Context, input: string): Promise<string> {
    return execute(ctx, input, {
      fn: 'UpdateBatchStatus',
      roles: STATUS_ACTORS,
      schema: S.StatusUpdateInput,
      handler: updateBatchStatus,
    });
  }

  @Transaction()
  @Returns('string')
  public async RecordCounterfeitReport(ctx: Context, input: string): Promise<string> {
    return execute(ctx, input, {
      fn: 'RecordCounterfeitReport',
      roles: [Role.Gateway],
      schema: S.CounterfeitReportInput,
      handler: recordCounterfeitReport,
    });
  }

  @Transaction()
  @Returns('string')
  public async RecordInvestigationOutcome(ctx: Context, input: string): Promise<string> {
    return execute(ctx, input, {
      fn: 'RecordInvestigationOutcome',
      roles: ROLES_PRIVILEGED,
      schema: S.OutcomeInput,
      handler: recordInvestigationOutcome,
    });
  }

  @Transaction(false)
  @Returns('string')
  public async GetBatch(ctx: Context, batchId: string): Promise<string> {
    return getBatchJson(ctx, batchId);
  }

  @Transaction(false)
  @Returns('string')
  public async GetBatchHistory(ctx: Context, batchId: string): Promise<string> {
    return getBatchHistoryJson(ctx, batchId);
  }

  @Transaction(false)
  @Returns('string')
  public async GetEvent(ctx: Context, eventId: string): Promise<string> {
    return getEventJson(ctx, eventId);
  }

  @Transaction(false)
  @Returns('string')
  public async VerifyRecordHash(ctx: Context, eventId: string, hash: string): Promise<string> {
    return verifyRecordHashJson(ctx, eventId, hash);
  }
}
