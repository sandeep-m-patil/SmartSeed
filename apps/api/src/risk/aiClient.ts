import { createHmac } from 'node:crypto';

const REQUEST_TIMEOUT_MS = 10_000;

export interface AiIndicator { code: string; family: string; severity: string; normalizedSignal: number; description: string }
export interface AiEvidence { kind: string; ref: string; detail: string }

export interface AiScore {
  riskScore: number;
  level: 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL';
  category: string;
  severity: string;
  indicators: AiIndicator[];
  confidence: number;
  evidence: AiEvidence[];
  recommendedAction: string;
  modelVersion: string;
  mode: string;
  componentScores: Record<string, number>;
  configVersion: string;
  notes?: string[];
  disclaimer: string;
}

export interface AiScorer {
  score(request: unknown): Promise<AiScore>;
}

export class AiServiceError extends Error {}

/** Signed (HMAC-SHA256 over the raw body + epoch timestamp) HTTP client for the Python detection service. */
export class HttpAiClient implements AiScorer {
  constructor(private readonly baseUrl: string, private readonly secret: string, private readonly fetchImpl: typeof fetch = fetch) {}

  async score(request: unknown): Promise<AiScore> {
    const body = JSON.stringify(request);
    const timestamp = String(Math.floor(Date.now() / 1000));
    const signature = createHmac('sha256', this.secret).update(body).digest('hex');
    const res = await this.fetchImpl(`${this.baseUrl.replace(/\/$/, '')}/v1/score`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Signature': signature, 'X-Timestamp': timestamp },
      body,
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
    if (!res.ok) throw new AiServiceError(`AI service responded ${res.status}`);
    return (await res.json()) as AiScore;
  }
}
