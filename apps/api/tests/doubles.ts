import pino from 'pino';
import { generateKeyPairSync } from 'node:crypto';
import { ChainError, type LedgerGateway, type SubmitRequest, type SubmitResult } from '../src/blockchain/gateway';
import { EnvKeySigner } from '../src/blockchain/signer';
import type { AiScore, AiScorer } from '../src/risk/aiClient';

/**
 * TEST-ONLY ledger double. It records calls and can be scripted to fail; it must never be wired into
 * a runtime build (production uses FabricGateway against real peers).
 */
export class RecordingGateway implements LedgerGateway {
  calls: SubmitRequest[] = [];
  /** Return an error to fail the next matching call; return null to succeed. */
  failWhen: (req: SubmitRequest) => Error | null = () => null;
  alreadyCommitted = false;
  hashMatches = true;
  evaluated: { orgId: string; fn: string; args: string[] }[] = [];
  private seq = 0;

  async submit(req: SubmitRequest): Promise<SubmitResult> {
    const err = this.failWhen(req);
    if (err) throw err;
    this.calls.push(req);
    this.seq += 1;
    return {
      status: this.alreadyCommitted ? 'ALREADY_COMMITTED' : 'COMMITTED',
      txId: `tx-${this.seq}`, blockNumber: this.seq, validationCode: 'VALID',
    };
  }

  async evaluate(orgId: string, fn: string, args: string[]): Promise<string> {
    this.evaluated.push({ orgId, fn, args });
    return JSON.stringify({ eventId: args[0], matches: this.hashMatches });
  }
}

export const transientError = () => new ChainError('peer unavailable', true, 'UNAVAILABLE');
export const rejectedError = () => new ChainError('NOT_OWNER: caller does not own batch', false, 'REJECTED');

export function testSigner() {
  const { privateKey, publicKey } = generateKeyPairSync('ec', { namedCurve: 'P-256' });
  return {
    signer: new EnvKeySigner(privateKey.export({ type: 'pkcs8', format: 'pem' }).toString()),
    publicKeyPem: publicKey.export({ type: 'spki', format: 'pem' }).toString(),
  };
}

export const silentLogger = pino({ level: 'silent' });

export class FakeScorer implements AiScorer {
  requests: unknown[] = [];
  constructor(public result: Partial<AiScore> = {}) {}

  async score(request: unknown): Promise<AiScore> {
    this.requests.push(request);
    return {
      riskScore: 5, level: 'LOW', category: 'none', severity: 'LOW', indicators: [], confidence: 0.5, evidence: [],
      recommendedAction: 'Normal verification', modelVersion: 'rules-test', mode: 'rules+unsupervised',
      componentScores: {}, configVersion: 'cfg-test', disclaimer: 'test', ...this.result,
    };
  }
}

export class FakeEmail {
  sent: { to: string; subject: string; text: string }[] = [];
  async send(msg: { to: string; subject: string; text: string }): Promise<void> {
    this.sent.push(msg);
  }
}

export class FakePush {
  sent: { token: string; title: string; body: string }[] = [];
  async send(msg: { token: string; title: string; body: string }): Promise<void> {
    this.sent.push(msg);
  }
}
