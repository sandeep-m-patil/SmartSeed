import pg from 'pg';
import { runner } from 'node-pg-migrate';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { createServer } from 'node:net';
import EmbeddedPostgres from 'embedded-postgres';

function freePort(): Promise<number> {
  return new Promise((resolvePort, reject) => {
    const srv = createServer();
    srv.once('error', reject);
    srv.listen(0, () => {
      const { port } = srv.address() as { port: number };
      srv.close(() => resolvePort(port));
    });
  });
}

/**
 * Uses TEST_ADMIN_DATABASE_URL when provided (CI / docker compose). Otherwise boots a
 * throwaway embedded Postgres so `npm test` works with no Docker. Either way the real
 * migrations build the schema from scratch.
 */
export default async function setup(): Promise<() => Promise<void>> {
  let teardown = async () => {};
  let adminUrl = process.env.TEST_ADMIN_DATABASE_URL;

  if (!adminUrl) {
    const dir = mkdtempSync(join(tmpdir(), 'smartseed-pg-'));
    const port = await freePort();
    const server = new EmbeddedPostgres({ databaseDir: dir, user: 'postgres', password: 'postgres', port, persistent: false });
    await server.initialise();
    await server.start();
    await server.createDatabase('smartseed_test');
    adminUrl = `postgres://postgres:postgres@localhost:${port}/smartseed_test`;
    process.env.TEST_ADMIN_DATABASE_URL = adminUrl;
    process.env.TEST_APP_DATABASE_URL = `postgres://smartseed_app:smartseed_app@localhost:${port}/smartseed_test`;
    teardown = async () => {
      await server.stop();
      rmSync(dir, { recursive: true, force: true });
    };
  }

  const client = new pg.Client({ connectionString: adminUrl });
  await client.connect();
  const role = await client.query("SELECT 1 FROM pg_roles WHERE rolname = 'smartseed_app'");
  if (role.rowCount === 0) {
    await client.query("CREATE ROLE smartseed_app LOGIN PASSWORD 'smartseed_app' NOSUPERUSER NOBYPASSRLS");
  }
  await client.query('DROP SCHEMA IF EXISTS public CASCADE; CREATE SCHEMA public;');
  await client.end();

  await runner({
    databaseUrl: adminUrl,
    dir: resolve(__dirname, '../migrations'),
    direction: 'up',
    migrationsTable: 'pgmigrations',
    log: () => undefined,
  });
  return teardown;
}
