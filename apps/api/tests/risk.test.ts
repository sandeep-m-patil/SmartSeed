import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import request from 'supertest';
import { randomUUID } from 'node:crypto';
import { createInvestigationService } from '../src/investigations/service';
import type { Block, LlmProvider } from '../src/investigations/llm';
import { createRiskService } from '../src/risk/service';
import { decryptField } from '../src/lib/crypto';
import { FakeScorer, silentLogger } from './doubles';
import {
  createHarness, resetData, seedManufacturer, seedPartner, seedTenant, seedUser, tokenFor, type Harness, type Party,
} from './helpers';

let h: Harness;
let tenantId: string;
let mfr: Party;
let d1: Party;
let admin: { id: string; token: string };
let productId: string;
let batchId: string;
let scorer: FakeScorer;

beforeAll(async () => { h = await createHarness(); });
afterAll(async () => { await h.close(); });

const call = (method: 'get' | 'post' | 'patch', path: string, token: string, body?: unknown, key?: string) => {
  const req = request(h.app)[method](`/v1${path}`).set('Authorization', `Bearer ${token}`);
  if (key) req.set('Idempotency-Key', key);
  return body === undefined ? req : req.send(body as object);
};

const highScore = {
  riskScore: 82, level: 'CRITICAL' as const, severity: 'CRITICAL', category: 'scan_behaviour', confidence: 0.7,
  indicators: [{ code: 'SCAN_BURST', family: 'scan_behaviour', severity: 'HIGH', normalizedSignal: 0.9, description: 'Unusually many scans in a short time.' }],
};

async function scanTimes(n: number) {
  const qr = (await call('post', `/batches/${batchId}/qr`, mfr.token)).body.data.id;
  const token = decryptField((await h.admin.query('SELECT token_enc FROM qr_codes WHERE id = $1', [qr])).rows[0].token_enc, h.config.FIELD_ENCRYPTION_KEY);
  for (let i = 0; i < n; i++) await request(h.app).get(`/v1/public/verify/${token}?lat=17.38&lon=78.48`).set('X-Device-Id', randomUUID());
  return token;
}

const riskService = () => createRiskService({ db: h.db, scorer, logger: silentLogger });

async function makeAlert() {
  await scanTimes(3);
  scorer.result = highScore;
  await riskService().scoreBatch(batchId);
  return (await h.admin.query('SELECT id FROM alerts')).rows[0].id as string;
}

beforeEach(async () => {
  await resetData(h);
  scorer = new FakeScorer();
  tenantId = await seedTenant(h);
  mfr = await seedManufacturer(h, tenantId);
  d1 = await seedPartner(h, tenantId, 'distributor');
  const a = await seedUser(h, { role: 'company_admin', tenantId });
  admin = { id: a.id, token: await tokenFor(h, a.id, tenantId, ['company_admin']) };
  const p = await call('post', '/products', mfr.token, { name: 'Cotton', brand: 'WhiteGold', cropType: 'Cotton', variety: 'C-9', category: 'hybrid' });
  productId = p.body.data.id;
  const b = await call('post', '/batches', mfr.token, {
    productId, manufacturingDate: '2026-01-01', expiryDate: '2099-01-01', productionLocation: 'Nagpur', facility: 'F1', initialQuantity: 500,
  });
  batchId = b.body.data.id;
});

describe('scoring pipeline', () => {
  it('sends the detection service real records and stores prediction, score history and a deduplicated alert', async () => {
    await scanTimes(2);
    scorer.result = highScore;
    await riskService().scoreBatch(batchId);
    const sent = scorer.requests[0] as { context: { batch: { initialQuantity: number }; scans: unknown[]; chainVerified: boolean | null } };
    expect(sent.context.batch.initialQuantity).toBe(500);
    expect(sent.context.scans).toHaveLength(2);
    expect(sent.context.chainVerified).toBeNull();

    await riskService().scoreBatch(batchId);
    expect((await h.admin.query('SELECT count(*)::int AS n FROM risk_scores')).rows[0].n).toBe(2);
    expect((await h.admin.query('SELECT count(*)::int AS n FROM anomaly_predictions')).rows[0].n).toBe(2);
    const alerts = (await h.admin.query('SELECT alert_type, severity, status FROM alerts')).rows;
    expect(alerts).toEqual([{ alert_type: 'SCAN_ANOMALY', severity: 'CRITICAL', status: 'open' }]);
    const jobs = (await h.admin.query("SELECT type FROM jobs WHERE type IN ('investigate', 'notify_alert') ORDER BY type")).rows.map((r) => r.type);
    expect(jobs).toEqual(['investigate', 'notify_alert']);
  });

  it('records low scores without raising alerts', async () => {
    await riskService().scoreBatch(batchId);
    expect((await h.admin.query('SELECT count(*)::int AS n FROM alerts')).rows[0].n).toBe(0);
    expect((await h.admin.query('SELECT level FROM risk_scores')).rows[0].level).toBe('LOW');
  });

  it('feeds risk back into public verification and never auto-labels a product counterfeit', async () => {
    const token = await scanTimes(1);
    scorer.result = highScore;
    await riskService().scoreBatch(batchId);
    const res = await request(h.app).get(`/v1/public/verify/${token}`);
    expect(res.body.data.risk.level).toBe('CRITICAL');
    expect(res.body.data.verification.scanActivity).toBe('SUSPICIOUS');
    expect(res.body.data.verification.investigation).toBe('UNDER_INVESTIGATION');
    expect(res.body.data.indicator).toBe('RED');
    expect(res.body.data.verification.investigation).not.toBe('CONFIRMED_COUNTERFEIT');
  });
});

describe('investigation agent', () => {
  const svc = (llm?: LlmProvider) => createInvestigationService({ db: h.db, llm, logger: silentLogger });

  it('builds an evidence-only report whose every observed fact cites retrieved records', async () => {
    const alertId = await makeAlert();
    const id = await svc().investigate(alertId);
    const inv = await call('get', `/investigations/${id}`, admin.token);
    expect(inv.body.data.generatedBy).toBe('rules');
    expect(inv.body.data.requiresHumanReview).toBe(true);
    const report = inv.body.data.report;
    const facts = report.findings.filter((f: { kind: string }) => f.kind === 'observed_fact');
    expect(facts.length).toBeGreaterThan(0);
    expect(facts.every((f: { evidenceRefs: string[] }) => f.evidenceRefs.length > 0)).toBe(true);
    expect(report.findings.some((f: { kind: string }) => f.kind === 'model_interpretation')).toBe(true);
    expect(report.recommendedSteps.length).toBeGreaterThan(0);
    expect(report.confidenceAndLimitations).toContain('rules');
  });

  it('drops facts that cite records the agent never retrieved', async () => {
    const alertId = await makeAlert();
    const scanId = (await h.admin.query('SELECT id FROM qr_scans LIMIT 1')).rows[0].id;
    const llm: LlmProvider = {
      name: 'fake-llm',
      async complete(req) {
        const done = req.messages.length > 1;
        const content: Block[] = done
          ? [{ type: 'tool_use', id: 't2', name: 'submit_report', input: {
              mainSuspiciousActivity: 'Burst of scans', potentialExplanation: 'Possibly copied labels', confidenceAndLimitations: 'Limited data',
              recommendedSteps: ['Inspect packets'], timeline: [{ at: new Date().toISOString(), event: 'scan', ref: 'scan:does-not-exist' }],
              findings: [
                { kind: 'observed_fact', text: 'A scan happened', evidenceRefs: [`scan:${scanId}`] },
                { kind: 'observed_fact', text: 'A shipment vanished in Dubai', evidenceRefs: ['event:made-up'] },
                { kind: 'observed_fact', text: 'Unsupported claim', evidenceRefs: [] },
                { kind: 'hypothesis', text: 'Label cloning', evidenceRefs: [] },
              ] } }]
          : [{ type: 'tool_use', id: 't1', name: 'get_scan_history', input: {} }];
        return { content };
      },
    };
    const id = await svc(llm).investigate(alertId);
    const inv = (await call('get', `/investigations/${id}`, admin.token)).body.data;
    expect(inv.generatedBy).toBe('fake-llm');
    expect(inv.report.findings.map((f: { text: string }) => f.text)).toEqual(['A scan happened', 'Label cloning']);
    expect(inv.report.droppedFindings).toBe(2);
    expect(inv.report.timeline).toEqual([]);
  });

  it('falls back to the evidence report when the model misbehaves', async () => {
    const alertId = await makeAlert();
    const broken: LlmProvider = { name: 'broken', complete: async () => ({ content: [{ type: 'text', text: 'I think it is fake!' }] }) };
    const id = await svc(broken).investigate(alertId);
    expect((await call('get', `/investigations/${id}`, admin.token)).body.data.generatedBy).toBe('rules');
  });

  it('is idempotent per alert', async () => {
    const alertId = await makeAlert();
    await svc().investigate(alertId);
    expect(await svc().investigate(alertId)).toBeNull();
    expect((await h.admin.query('SELECT count(*)::int AS n FROM investigations')).rows[0].n).toBe(1);
  });
});

describe('human review workflow', () => {
  async function investigation() {
    const alertId = await makeAlert();
    const id = await createInvestigationService({ db: h.db, logger: silentLogger }).investigate(alertId);
    return { alertId, id: id as string };
  }
  const act = (id: string, body: object, token = admin.token) => call('post', `/investigations/${id}/actions`, token, body);

  it('holds transfers and the batch while under investigation, and releases them on dismissal', async () => {
    const { id } = await investigation();
    const t = await call('post', '/transfers', mfr.token, { batchId, toOrgId: d1.orgId, quantity: 50 }, randomUUID());
    expect((await act(id, { action: 'mark_under_investigation' })).status).toBe(201);
    expect((await h.admin.query('SELECT status FROM seed_batches')).rows[0].status).toBe('on_hold');
    const blocked = await call('post', `/transfers/${t.body.data.id}/dispatch`, mfr.token, { sourceLocation: 'Nagpur', destinationLocation: 'Pune' });
    expect(blocked.body.error.code).toBe('UNDER_INVESTIGATION');
    const blockedNew = await call('post', '/transfers', mfr.token, { batchId, toOrgId: d1.orgId, quantity: 5 }, randomUUID());
    expect(blockedNew.body.error.code).toBe('BATCH_NOT_ACTIVE');

    await act(id, { action: 'dismiss_false_positive', note: 'Trade show demo scans' });
    expect((await h.admin.query('SELECT status FROM seed_batches')).rows[0].status).toBe('active');
    expect((await h.admin.query('SELECT under_investigation FROM transfers')).rows[0].under_investigation).toBe(false);
    expect((await h.admin.query('SELECT status, resolution FROM alerts')).rows[0]).toMatchObject({ status: 'dismissed', resolution: { outcome: 'false_positive' } });
    expect((await call('post', `/transfers/${t.body.data.id}/dispatch`, mfr.token, { sourceLocation: 'Nagpur', destinationLocation: 'Pune' })).status).toBe(200);
  });

  it('requires an outcome to resolve, closes the investigation and surfaces a confirmed outcome publicly', async () => {
    const { id } = await investigation();
    const token = (await h.admin.query('SELECT token_enc FROM qr_codes')).rows[0].token_enc;
    const publicToken = decryptField(token, h.config.FIELD_ENCRYPTION_KEY);
    expect((await act(id, { action: 'mark_resolved' })).body.error.code).toBe('OUTCOME_REQUIRED');
    expect((await act(id, { action: 'mark_resolved', outcome: 'confirmed_counterfeit', note: 'Lab test failed' })).status).toBe(201);
    expect((await act(id, { action: 'confirm_suspicious' })).body.error.code).toBe('INVESTIGATION_CLOSED');
    const verify = await request(h.app).get(`/v1/public/verify/${publicToken}`);
    expect(verify.body.data.verification.investigation).toBe('CONFIRMED_COUNTERFEIT');
    expect(verify.body.data.indicator).toBe('RED');
    const detail = (await call('get', `/investigations/${id}`, admin.token)).body.data;
    expect(detail.actions.map((a: { action: string }) => a.action)).toEqual(['mark_resolved']);
  });

  it('audits every decision and keeps the action log append-only', async () => {
    const { id } = await investigation();
    await act(id, { action: 'request_verification', note: 'Ask distributor for photos' });
    await act(id, { action: 'escalate_authority' });
    const audits = (await h.admin.query("SELECT action FROM audit_logs WHERE action LIKE 'investigation.%' ORDER BY seq")).rows.map((r) => r.action);
    expect(audits).toEqual(['investigation.created', 'investigation.request_verification', 'investigation.escalate_authority']);
    await expect(h.admin.query('DELETE FROM investigation_actions')).rejects.toThrow(/append-only/);
  });

  it('restricts decisions to authorised roles and the owning tenant', async () => {
    const { id } = await investigation();
    expect((await act(id, { action: 'mark_resolved', outcome: 'cleared' }, mfr.token)).status).toBe(403);
    expect((await call('get', `/investigations/${id}`, mfr.token)).status).toBe(403);
    const otherTenant = await seedTenant(h);
    const other = await seedUser(h, { role: 'company_admin', tenantId: otherTenant });
    const otherToken = await tokenFor(h, other.id, otherTenant, ['company_admin']);
    expect((await act(id, { action: 'dismiss_false_positive' }, otherToken)).status).toBe(404);
    expect((await call('get', `/investigations/${id}`, otherToken)).status).toBe(404);
    const platform = await seedUser(h, { role: 'platform_admin', tenantId: null });
    const platformToken = await tokenFor(h, platform.id, null, ['platform_admin']);
    expect((await call('get', `/investigations/${id}`, platformToken)).status).toBe(200);
  });
});

describe('alerts and dashboard', () => {
  it('filters alerts by level, status, product and batch and isolates tenants', async () => {
    await makeAlert();
    const base = (await call('get', '/alerts', admin.token)).body.data;
    expect(base).toHaveLength(1);
    expect(base[0]).toMatchObject({ alertType: 'SCAN_ANOMALY', batchId, productName: 'Cotton' });
    expect((await call('get', '/alerts?level=CRITICAL', admin.token)).body.data).toHaveLength(1);
    expect((await call('get', '/alerts?level=LOW', admin.token)).body.data).toHaveLength(0);
    expect((await call('get', '/alerts?status=resolved', admin.token)).body.data).toHaveLength(0);
    expect((await call('get', `/alerts?productId=${productId}&batchId=${batchId}`, admin.token)).body.data).toHaveLength(1);
    expect((await call('get', `/alerts?orgId=${mfr.orgId}`, admin.token)).body.data).toHaveLength(1);

    const otherTenant = await seedTenant(h);
    const other = await seedUser(h, { role: 'company_admin', tenantId: otherTenant });
    expect((await call('get', '/alerts', await tokenFor(h, other.id, otherTenant, ['company_admin']))).body.data).toEqual([]);
    const platform = await seedUser(h, { role: 'platform_admin', tenantId: null });
    expect((await call('get', '/alerts', await tokenFor(h, platform.id, null, ['platform_admin']))).body.data).toHaveLength(1);
  });

  it('assigns only valid investigators', async () => {
    const alertId = await makeAlert();
    expect((await call('patch', `/alerts/${alertId}`, admin.token, { assigneeId: admin.id })).status).toBe(200);
    expect((await call('patch', `/alerts/${alertId}`, admin.token, { assigneeId: d1.user.id })).body.error.code).toBe('INVALID_ASSIGNEE');
    expect((await call('get', `/alerts/${alertId}`, admin.token)).body.data.assigneeId).toBe(admin.id);
    expect((await call('patch', `/alerts/${alertId}`, mfr.token, { assigneeId: admin.id })).status).toBe(403);
  });

  it('computes the overview and analytics from live data, scoped per tenant', async () => {
    await makeAlert();
    const overview = (await call('get', '/risk/overview', admin.token)).body.data;
    expect(overview).toMatchObject({ totalBatches: 1, totalScans: 3, highRiskBatches: 1, criticalAlerts: 1, investigations: { total: 0, resolved: 0, pending: 0 } });
    const analytics = (await call('get', '/risk/analytics', admin.token)).body.data;
    expect(analytics.riskDistribution.find((r: { level: string }) => r.level === 'CRITICAL').count).toBe(1);
    expect(analytics.topFlaggedBatches[0]).toMatchObject({ batchId, alerts: 1 });
    expect(analytics.dailyAnomalies).toHaveLength(1);

    const otherTenant = await seedTenant(h);
    const other = await seedUser(h, { role: 'company_admin', tenantId: otherTenant });
    const empty = (await call('get', '/risk/overview', await tokenFor(h, other.id, otherTenant, ['company_admin']))).body.data;
    expect(empty).toMatchObject({ totalBatches: 0, totalScans: 0, criticalAlerts: 0 });
    expect((await call('get', '/risk/overview', d1.token)).status).toBe(403);
  });
});
