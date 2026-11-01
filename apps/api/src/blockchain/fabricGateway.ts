import { createPrivateKey } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import * as grpc from '@grpc/grpc-js';
import { connect, hash, signers, type Gateway } from '@hyperledger/fabric-gateway';
import { ChainError, type LedgerGateway, type SubmitRequest, type SubmitResult } from './gateway';

const CONTRACT_NAME = 'SmartSeedContract';
const GRPC_UNAVAILABLE = 14;
const GRPC_DEADLINE_EXCEEDED = 4;
const MVCC_READ_CONFLICT = 11;
const PHANTOM_READ_CONFLICT = 12;
const ENDORSE_TIMEOUT_MS = 15_000;
const COMMIT_TIMEOUT_MS = 60_000;

export interface FabricIdentity {
  mspId: string;
  certificate: Buffer;
  privateKeyPem: string;
}

export interface IdentityProvider {
  get(orgId: string): Promise<FabricIdentity>;
}

/**
 * Reads per-organization identities enrolled by infra/fabric (see its README):
 * <dir>/<orgId>/{cert.pem,key.pem,mspid}. Production swaps this for a KMS/HSM-backed provider.
 */
export class DirectoryIdentityProvider implements IdentityProvider {
  constructor(private readonly dir: string) {}

  async get(orgId: string): Promise<FabricIdentity> {
    const base = join(this.dir, orgId);
    try {
      const [certificate, privateKeyPem, mspId] = await Promise.all([
        readFile(join(base, 'cert.pem')), readFile(join(base, 'key.pem'), 'utf8'), readFile(join(base, 'mspid'), 'utf8'),
      ]);
      return { mspId: mspId.trim(), certificate, privateKeyPem };
    } catch {
      throw new ChainError(`no Fabric identity enrolled for organization ${orgId}`, false, 'NO_IDENTITY');
    }
  }
}

export interface FabricConfig {
  peerEndpoint: string;
  peerTlsCaPath: string;
  peerHostAlias?: string | undefined;
  channel: string;
  chaincode: string;
}

/** Maps Fabric client errors to retryable (infrastructure) vs permanent (chaincode rejected it). */
export function classifyFabricError(err: unknown): ChainError {
  const e = err as { message?: string; code?: number; details?: unknown[]; status?: { code?: number } };
  const message = e.message ?? String(err);
  const commitCode = e.status?.code;
  if (commitCode === MVCC_READ_CONFLICT || commitCode === PHANTOM_READ_CONFLICT) return new ChainError(message, true, 'MVCC_CONFLICT');
  if (e.code === GRPC_UNAVAILABLE || e.code === GRPC_DEADLINE_EXCEEDED) return new ChainError(message, true, 'UNAVAILABLE');
  return new ChainError(message, false, 'REJECTED');
}

export class FabricGateway implements LedgerGateway {
  private readonly gateways = new Map<string, Gateway>();
  private client: grpc.Client | null = null;

  constructor(private readonly cfg: FabricConfig, private readonly identities: IdentityProvider) {}

  private async grpcClient(): Promise<grpc.Client> {
    if (this.client) return this.client;
    const tlsRootCert = await readFile(this.cfg.peerTlsCaPath);
    const options = this.cfg.peerHostAlias ? { 'grpc.ssl_target_name_override': this.cfg.peerHostAlias } : {};
    this.client = new grpc.Client(this.cfg.peerEndpoint, grpc.credentials.createSsl(tlsRootCert), options);
    return this.client;
  }

  private async gatewayFor(orgId: string): Promise<Gateway> {
    const cached = this.gateways.get(orgId);
    if (cached) return cached;
    const id = await this.identities.get(orgId);
    const gateway = connect({
      client: await this.grpcClient(),
      identity: { mspId: id.mspId, credentials: id.certificate },
      signer: signers.newPrivateKeySigner(createPrivateKey(id.privateKeyPem)),
      hash: hash.sha256,
      endorseOptions: () => ({ deadline: Date.now() + ENDORSE_TIMEOUT_MS }),
      submitOptions: () => ({ deadline: Date.now() + ENDORSE_TIMEOUT_MS }),
      commitStatusOptions: () => ({ deadline: Date.now() + COMMIT_TIMEOUT_MS }),
    });
    this.gateways.set(orgId, gateway);
    return gateway;
  }

  private contract(gateway: Gateway) {
    return gateway.getNetwork(this.cfg.channel).getContract(this.cfg.chaincode, CONTRACT_NAME);
  }

  async submit(req: SubmitRequest): Promise<SubmitResult> {
    try {
      const contract = this.contract(await this.gatewayFor(req.orgId));
      const transient = req.transient
        ? Object.fromEntries(Object.entries(req.transient).map(([k, v]) => [k, Buffer.from(v)]))
        : undefined;
      const proposal = contract.newProposal(req.fn, { arguments: [JSON.stringify(req.input)], ...(transient ? { transientData: transient } : {}) });
      const transaction = await proposal.endorse();
      const result = JSON.parse(Buffer.from(transaction.getResult()).toString('utf8')) as { status: SubmitResult['status'] };
      const commit = await transaction.submit();
      const status = await commit.getStatus();
      if (!status.successful) {
        throw Object.assign(new Error(`transaction ${status.transactionId} failed validation (code ${status.code})`), { status });
      }
      return { status: result.status, txId: status.transactionId, blockNumber: Number(status.blockNumber), validationCode: String(status.code) };
    } catch (err) {
      throw err instanceof ChainError ? err : classifyFabricError(err);
    }
  }

  async evaluate(orgId: string, fn: string, args: string[]): Promise<string> {
    try {
      const contract = this.contract(await this.gatewayFor(orgId));
      return Buffer.from(await contract.evaluateTransaction(fn, ...args)).toString('utf8');
    } catch (err) {
      throw err instanceof ChainError ? err : classifyFabricError(err);
    }
  }

  close(): void {
    this.gateways.forEach((g) => g.close());
    this.client?.close();
  }
}
