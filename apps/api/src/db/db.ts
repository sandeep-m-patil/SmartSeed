import pg from 'pg';

const PG_DATE_OID = 1082;
// Keep DATE columns as 'YYYY-MM-DD' strings; JS Date would shift them by the server timezone.
pg.types.setTypeParser(PG_DATE_OID, (value) => value);

export type Tx = pg.PoolClient;

export interface ActorScope {
  tenantId: string | null;
  orgId: string | null;
}

export interface Db {
  /** Transaction whose RLS context is one tenant (and optionally the caller's organization). */
  withActor<T>(scope: ActorScope, fn: (tx: Tx) => Promise<T>): Promise<T>;
  withTenant<T>(tenantId: string, fn: (tx: Tx) => Promise<T>): Promise<T>;
  /**
   * Transaction that bypasses RLS. Only for flows that cannot know the tenant yet
   * (login, refresh, registration), platform administration, and settlement of
   * multi-party supply-chain mutations whose parties are verified in code.
   */
  withSystem<T>(fn: (tx: Tx) => Promise<T>): Promise<T>;
  /** Fail-closed transaction with no context set; used by tests and health checks. */
  withNoContext<T>(fn: (tx: Tx) => Promise<T>): Promise<T>;
  close(): Promise<void>;
}

interface Context {
  tenantId: string;
  orgId: string;
  isSystem: boolean;
}

export function createDb(connectionString: string): Db {
  const pool = new pg.Pool({ connectionString, max: 10 });

  async function run<T>(ctx: Context, fn: (tx: Tx) => Promise<T>): Promise<T> {
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      await client.query(
        `SELECT set_config('app.tenant_id', $1, true), set_config('app.org_id', $2, true), set_config('app.is_system', $3, true)`,
        [ctx.tenantId, ctx.orgId, ctx.isSystem ? 'on' : 'off'],
      );
      const result = await fn(client);
      await client.query('COMMIT');
      return result;
    } catch (err) {
      await client.query('ROLLBACK').catch(() => undefined);
      throw err;
    } finally {
      client.release();
    }
  }

  const withActor: Db['withActor'] = (scope, fn) =>
    run({ tenantId: scope.tenantId ?? '', orgId: scope.orgId ?? '', isSystem: false }, fn);

  return {
    withActor,
    withTenant: (tenantId, fn) => withActor({ tenantId, orgId: null }, fn),
    withSystem: (fn) => run({ tenantId: '', orgId: '', isSystem: true }, fn),
    withNoContext: (fn) => run({ tenantId: '', orgId: '', isSystem: false }, fn),
    close: () => pool.end(),
  };
}
