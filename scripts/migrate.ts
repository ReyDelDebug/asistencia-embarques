/* Aplica las migraciones SQL de db/migrations en orden. Idempotente. */
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { closePool, getPool } from "../src/lib/db";

try { process.loadEnvFile(".env"); } catch { /* sin .env: se usan variables del entorno */ }

export async function migrate(log = true): Promise<string[]> {
  const pool = getPool();
  const client = await pool.connect();
  const applied: string[] = [];
  try {
    await client.query(`CREATE TABLE IF NOT EXISTS schema_migrations (
      name TEXT PRIMARY KEY, applied_at TIMESTAMPTZ NOT NULL DEFAULT now())`);
    await client.query(`ALTER TABLE schema_migrations ENABLE ROW LEVEL SECURITY`);
    // Evita que dos procesos migren al mismo tiempo.
    await client.query(`SELECT pg_advisory_lock(7300512)`);
    const done = new Set((await client.query<{ name: string }>(`SELECT name FROM schema_migrations`)).rows.map((r) => r.name));
    const dir = join(process.cwd(), "db", "migrations");
    const files = readdirSync(dir).filter((f) => f.endsWith(".sql")).sort();
    for (const file of files) {
      if (done.has(file)) continue;
      const sql = readFileSync(join(dir, file), "utf8");
      await client.query("BEGIN");
      try {
        await client.query(sql);
        await client.query(`INSERT INTO schema_migrations (name) VALUES ($1)`, [file]);
        await client.query("COMMIT");
        applied.push(file);
        if (log) console.log(`✔ Migración aplicada: ${file}`);
      } catch (err) {
        await client.query("ROLLBACK");
        throw new Error(`Error en ${file}: ${(err as Error).message}`);
      }
    }
    if (log && applied.length === 0) console.log("✔ La base de datos ya está actualizada.");
  } finally {
    await client.query(`SELECT pg_advisory_unlock(7300512)`).catch(() => undefined);
    client.release();
  }
  return applied;
}

if (process.argv[1]?.endsWith("migrate.ts")) {
  migrate()
    .then(() => closePool())
    .catch(async (err) => {
      console.error("✖", err.message);
      await closePool();
      process.exit(1);
    });
}
