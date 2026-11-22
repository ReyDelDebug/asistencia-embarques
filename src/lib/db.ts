import { Pool, type PoolClient, type QueryResultRow, types } from "pg";

// DATE (oid 1082) se devuelve como texto 'YYYY-MM-DD' para evitar
// desfases de zona horaria al convertirlo en objeto Date.
types.setTypeParser(1082, (v: string) => v);
// BIGINT/BIGSERIAL (oid 20) como número (los ids nunca superan 2^53).
types.setTypeParser(20, (v: string) => Number(v));

const globalForPg = globalThis as unknown as { __pgPool?: Pool };

function buildPool(): Pool {
  const raw = process.env.DATABASE_URL;
  if (!raw) {
    throw new Error("DATABASE_URL no está configurada. Revisa tu archivo .env");
  }
  const url = new URL(raw);
  const isLocal = ["localhost", "127.0.0.1", "::1"].includes(url.hostname);
  const sslMode = (process.env.DATABASE_SSL ?? (isLocal ? "disable" : "require")).toLowerCase();
  // El modo SSL se controla con DATABASE_SSL, no con el parámetro de la URL.
  url.searchParams.delete("sslmode");

  let ssl: false | { rejectUnauthorized: boolean; ca?: string } = false;
  if (sslMode === "require") {
    ssl = { rejectUnauthorized: false };
  } else if (sslMode === "verify") {
    ssl = { rejectUnauthorized: true, ca: process.env.DATABASE_SSL_CA?.replace(/\\n/g, "\n") };
  }

  return new Pool({
    connectionString: url.toString(),
    max: Number(process.env.PG_POOL_MAX ?? 5),
    idleTimeoutMillis: 10_000,
    connectionTimeoutMillis: 10_000,
    ssl,
  });
}

export function getPool(): Pool {
  if (!globalForPg.__pgPool) {
    globalForPg.__pgPool = buildPool();
  }
  return globalForPg.__pgPool;
}

export type Queryable = Pick<PoolClient, "query">;

export async function query<T extends QueryResultRow = QueryResultRow>(
  text: string,
  params: unknown[] = [],
  client?: Queryable,
): Promise<T[]> {
  const res = await (client ?? getPool()).query<T>(text, params);
  return res.rows;
}

export async function queryOne<T extends QueryResultRow = QueryResultRow>(
  text: string,
  params: unknown[] = [],
  client?: Queryable,
): Promise<T | null> {
  const rows = await query<T>(text, params, client);
  return rows[0] ?? null;
}

export async function withTransaction<T>(fn: (client: PoolClient) => Promise<T>): Promise<T> {
  const client = await getPool().connect();
  try {
    await client.query("BEGIN");
    const result = await fn(client);
    await client.query("COMMIT");
    return result;
  } catch (err) {
    await client.query("ROLLBACK").catch(() => undefined);
    throw err;
  } finally {
    client.release();
  }
}

export async function closePool(): Promise<void> {
  if (globalForPg.__pgPool) {
    await globalForPg.__pgPool.end();
    globalForPg.__pgPool = undefined;
  }
}
