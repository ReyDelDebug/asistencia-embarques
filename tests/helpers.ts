import { closePool, getPool, query } from "../src/lib/db";
import { hashSecret } from "../src/lib/crypto";
import { migrate } from "../scripts/migrate";
import { seed, type SeedResult } from "../scripts/seed";
import type { RequestMeta } from "../src/lib/services/auth";

/** Instante a partir de una hora local de Ciudad de México (UTC-6, sin horario de verano). */
export const mx = (local: string) => new Date(`${local}-06:00`);

export const meta = (now: Date, ip = "10.0.0.1"): RequestMeta => ({ ip, userAgent: "vitest", now });

/** Borra por completo la base de pruebas, aplica migraciones y carga inicial. */
export async function resetDatabase(): Promise<SeedResult> {
  const url = process.env.DATABASE_URL ?? "";
  if (!/asistencia_test|_test\b|test/.test(url)) throw new Error("Por seguridad, las pruebas solo corren en una BD *_test");
  await getPool().query("DROP SCHEMA public CASCADE; CREATE SCHEMA public;");
  await migrate(false);
  return seed({ writeFiles: false, log: false });
}

export async function employeeByName(name: string) {
  const rows = await query<{ id: number; employee_number: string; role: string }>(
    "SELECT id, employee_number, role FROM employees WHERE full_name = $1", [name]);
  return rows[0];
}

/** PIN de prueba (no trivial). En producción cada trabajador crea el suyo. */
export const TEST_PIN = "482915";

/** Simula que todos los trabajadores (salvo `except`) ya crearon su PIN. */
export async function activateAll(except: string[] = []): Promise<void> {
  await query(`UPDATE employees SET pin_hash = $1 WHERE NOT (full_name = ANY($2))`, [await hashSecret(TEST_PIN), except]);
}

export function pinOf(_seedResult: SeedResult, name: string): string {
  void name;
  return TEST_PIN;
}

export { closePool };
