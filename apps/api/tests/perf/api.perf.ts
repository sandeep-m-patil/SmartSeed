import { appendFileSync } from 'node:fs';
import { afterAll, beforeAll, it } from 'vitest';
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import { randomUUID } from 'node:crypto';
import { decryptField } from '../../src/lib/crypto';
import { createHarness, resetData, seedManufacturer, seedPartner, seedTenant, type Harness } from '../helpers';

/**
 * Smoke-level latency measurements against an embedded Postgres on the developer machine. These
 * numbers are NOT capacity claims: real targets need production-like hardware and data volumes.
 */
let h: Harness;
let server: http.Server;
let base: string;

beforeAll(async () => {
  h = await createHarness();
  server = h.app.listen(0);
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});
afterAll(async () => { server.close(); await h.close(); });

async function measure(name: string, total: number, concurrency: number, run: (i: number) => Promise<Response>) {
  const times: number[] = [];
  let failures = 0;
  let next = 0;
  const started = performance.now();
  await Promise.all(Array.from({ length: concurrency }, async () => {
    while (next < total) {
      const i = next++;
      const t0 = performance.now();
      const res = await run(i);
      await res.arrayBuffer();
      times.push(performance.now() - t0);
      if (res.status >= 400) failures += 1;
    }
  }));
  const elapsed = (performance.now() - started) / 1000;
  times.sort((a, b) => a - b);
  const pct = (p: number) => times[Math.min(times.length - 1, Math.floor(times.length * p))]!.toFixed(1);
  appendFileSync('perf-results.txt', `PERF ${name}: n=${total} conc=${concurrency} p50=${pct(0.5)}ms p95=${pct(0.95)}ms p99=${pct(0.99)}ms max=${times.at(-1)!.toFixed(1)}ms rps=${(total / elapsed).toFixed(0)} failures=${failures}
`);
}

it('measures public verification, list reads and transfer creation', async () => {
  await resetData(h);
  const tenantId = await seedTenant(h);
  const mfr = await seedManufacturer(h, tenantId);
  const d1 = await seedPartner(h, tenantId, 'distributor');
  const auth = { Authorization: `Bearer ${mfr.token}`, 'Content-Type': 'application/json' };
  const post = (path: string, body: unknown, extra: Record<string, string> = {}) => fetch(`${base}/v1${path}`, { method: 'POST', headers: { ...auth, ...extra }, body: JSON.stringify(body) });
  const product = await (await post('/products', { name: 'Perf Maize', brand: 'Perf', cropType: 'Maize', variety: 'P1', category: 'hybrid' })).json() as { data: { id: string } };
  const batch = await (await post('/batches', { productId: product.data.id, manufacturingDate: '2026-01-01', expiryDate: '2099-01-01', productionLocation: 'Pune', facility: 'Plant 1', initialQuantity: 1_000_000 })).json() as { data: { id: string } };
  const qr = await (await post(`/batches/${batch.data.id}/qr`, {})).json() as { data: { id: string } };
  const token = decryptField((await h.admin.query('SELECT token_enc FROM qr_codes WHERE id = $1', [qr.data.id])).rows[0].token_enc, h.config.FIELD_ENCRYPTION_KEY);

  await measure('GET /public/verify/:token', 400, 20, () => fetch(`${base}/v1/public/verify/${token}`, { headers: { 'X-Device-Id': randomUUID() } }));
  await measure('GET /batches (authenticated list)', 400, 20, () => fetch(`${base}/v1/batches?limit=25`, { headers: auth }));
  await measure('POST /transfers (reserve stock, write event + outbox)', 200, 10, () =>
    post('/transfers', { batchId: batch.data.id, toOrgId: d1.orgId, quantity: 1 }, { 'Idempotency-Key': randomUUID() }));
}, 300_000);
