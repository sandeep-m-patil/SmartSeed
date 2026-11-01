import { spawn, type ChildProcess } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { randomBytes } from 'node:crypto';
import EmbeddedPostgres from 'embedded-postgres';
import { generateKeyPair, exportPKCS8, exportSPKI } from 'jose';
import { runner } from 'node-pg-migrate';
import pg from 'pg';

/**
 * Boots the BUILT bundles (dist/server.js and dist/worker.js) against a throwaway Postgres and
 * exercises the real process wiring: config parsing, DB connection, readiness, tenant
 * registration, job polling and clean shutdown. Run `npm run build` first, then `npm run smoke`.
 */
const freePort = () => new Promise<number>((res, rej) => {
  const s = createServer();
  s.once('error', rej);
  s.listen(0, () => { const { port } = s.address() as { port: number }; s.close(() => res(port)); });
});

const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function waitFor(url: string, timeoutMs: number): Promise<Response> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    try { return await fetch(url); } catch (err) {
      if (Date.now() > deadline) throw err;
      await wait(250);
    }
  }
}

async function main() {
  const dir = mkdtempSync(join(tmpdir(), 'smartseed-smoke-'));
  const pgPort = await freePort();
  const apiPort = await freePort();
  const pgServer = new EmbeddedPostgres({ databaseDir: dir, user: 'postgres', password: 'postgres', port: pgPort, persistent: false });
  await pgServer.initialise();
  await pgServer.start();
  await pgServer.createDatabase('smartseed');
  const admin = `postgres://postgres:postgres@localhost:${pgPort}/smartseed`;
  const client = new pg.Client({ connectionString: admin });
  await client.connect();
  await client.query("CREATE ROLE smartseed_app LOGIN PASSWORD 'smartseed_app' NOSUPERUSER NOBYPASSRLS");
  await client.end();
  await runner({ databaseUrl: admin, dir: resolve(process.cwd(), 'migrations'), direction: 'up', migrationsTable: 'pgmigrations', log: () => undefined });

  const { privateKey, publicKey } = await generateKeyPair('ES256', { extractable: true });
  const env = {
    ...process.env,
    NODE_ENV: 'staging', PORT: String(apiPort), LOG_LEVEL: 'warn',
    DATABASE_URL: `postgres://smartseed_app:smartseed_app@localhost:${pgPort}/smartseed`,
    JWT_PRIVATE_KEY: await exportPKCS8(privateKey), JWT_PUBLIC_KEY: await exportSPKI(publicKey),
    FIELD_ENCRYPTION_KEY: randomBytes(32).toString('base64'), METRICS_TOKEN: 'smoke-metrics-token-123456',
  };
  const children: ChildProcess[] = [];
  const start = (file: string) => { const c = spawn('node', [file], { env, stdio: ['ignore', 'pipe', 'pipe'] }); children.push(c); return c; };
  const results: string[] = [];
  try {
    const api = start('dist/server.js');
    const worker = start('dist/worker.js');
    let workerLog = '';
    worker.stderr?.on('data', (d) => { workerLog += d; });
    worker.stdout?.on('data', (d) => { workerLog += d; });
    const base = `http://127.0.0.1:${apiPort}`;
    const ready = await waitFor(`${base}/readyz`, 20_000);
    results.push(`api /readyz -> ${ready.status}`);
    const reg = await fetch(`${base}/v1/tenants/register`, {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ companyName: 'Smoke Seeds', adminName: 'Smoke Admin', adminEmail: 'smoke@example.com', adminPassword: 'Str0ngPassw0rd!x' }),
    });
    results.push(`register tenant -> ${reg.status}`);
    const metrics = await fetch(`${base}/metrics`, { headers: { authorization: 'Bearer smoke-metrics-token-123456' } });
    results.push(`metrics -> ${metrics.status}`);
    await wait(2500);
    const sweeps = await pgQuery(admin, "SELECT type, status FROM jobs ORDER BY type");
    results.push(`worker jobs -> ${JSON.stringify(sweeps)}`);
    results.push(`worker warned about missing Fabric: ${/Fabric is not configured/.test(workerLog)}`);
    api.kill('SIGTERM');
    worker.kill('SIGTERM');
    await wait(1000);
  } finally {
    children.forEach((c) => c.kill());
    await pgServer.stop();
    rmSync(dir, { recursive: true, force: true });
  }
  console.log(results.join('\n'));
}

async function pgQuery(url: string, sql: string) {
  const c = new pg.Client({ connectionString: url });
  await c.connect();
  const res = await c.query(sql);
  await c.end();
  return res.rows;
}

main().then(() => process.exit(0)).catch((err) => { console.error(err); process.exit(1); });
