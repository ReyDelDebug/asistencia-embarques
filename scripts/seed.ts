/*
 * Carga inicial idempotente: turnos, áreas, 36 empleados, supervisor de día
 * y usuario administrador. Se puede ejecutar varias veces sin duplicar nada
 * ni sobrescribir cambios hechos desde el panel.
 *
 * Los empleados se crean SIN PIN: cada trabajador crea su propio PIN la
 * primera vez que entra con su número de empleado. La contraseña inicial
 * del administrador se guarda en credenciales-iniciales/ (excluida de git).
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { closePool, withTransaction } from "../src/lib/db";
import { generatePassword, hashSecret } from "../src/lib/crypto";
import { validatePasswordStrength } from "../src/lib/services/auth";

try { process.loadEnvFile(".env"); } catch { /* opcional */ }

type Role = "EMPLOYEE" | "LEADER";
interface SeedEmployee { name: string; role?: Role; subarea?: "PT" }

const PLANTILLA: Record<"DIA" | "NOCHE", Record<string, SeedEmployee[]>> = {
  DIA: {
    CENTRAL: [
      { name: "Christian Tapia" },
      { name: "Antonio Rosado" },
      { name: "Alexis Altamirano" },
      { name: "Julio César" },
      { name: "Maximiliano" },
      { name: "Isaías Romero", role: "LEADER" },
      { name: "Israel Pumariega" },
      { name: "Jonathan Luna" },
      { name: "Manuel Cruz", role: "LEADER", subarea: "PT" }, // líder de PT
      { name: "Moisés Muñoz" },
      { name: "Arturo Martínez" },
    ],
    RC: [
      { name: "Enrique Suárez" },
      { name: "Arturo Mata" },
      { name: "Wenceslao Félix" },
      { name: "Isaac Antonio" },
      { name: "Gerardo Marroquín", role: "LEADER" },
      { name: "David Ponce" },
    ],
    WM: [
      { name: "Norberto Sánchez" },
      { name: "Carlos González" },
      { name: "Gustavo Mata" },
      { name: "Jonathan Cruz", role: "LEADER" },
      { name: "Miguel Cruz" },
    ],
  },
  NOCHE: {
    CENTRAL: [
      { name: "Enrique González" },
      { name: "Javier Ángeles", role: "LEADER" },
      { name: "Gregorio Meraz" },
      { name: "José Pinet" },
      { name: "Jesús Fuentes" },
      { name: "José Taizan" },
      { name: "Julián González" },
      { name: "Karlos Pinet" },
    ],
    RC: [
      { name: "Jair Nájera" },
      { name: "Gerardo González", role: "LEADER" },
      { name: "Raymundo Muñoz" },
      { name: "Edgar Ramírez" },
      { name: "José Cobos" },
      { name: "Ángel Peralta" },
    ],
  },
};

const slug = (s: string) =>
  s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");

export interface SeedResult {
  createdEmployees: { employeeNumber: string; name: string; shift: string; area: string; role: string }[];
  skippedEmployees: number;
  admin: { username: string; password: string | null; created: boolean };
  credentialsFile: string | null;
}

export async function seed(opts: { writeFiles?: boolean; log?: boolean } = {}): Promise<SeedResult> {
  const { writeFiles = true, log = true } = opts;
  const result: SeedResult = {
    createdEmployees: [], skippedEmployees: 0, admin: { username: "manuel", password: null, created: false }, credentialsFile: null,
  };

  await withTransaction(async (c) => {
    await c.query(
      `INSERT INTO shifts (code, name, open_time, close_time, report_title, sort_order) VALUES
         ('DIA',   'Día',   '05:00:00', '07:20:00', 'BUENOS DÍAS ASISTENCIA (HG) EMBARQUES', 1),
         ('NOCHE', 'Noche', '17:00:00', '19:20:00', 'BUENAS NOCHES ASISTENCIA (HG) EMBARQUES', 2)
       ON CONFLICT (code) DO NOTHING`,
    );
    await c.query(
      `INSERT INTO departments (code, name, report_label, sort_order) VALUES
         ('CENTRAL', 'Central', 'CENTRAL', 1),
         ('RC',      'RC',      'RAMPA C', 2),
         ('WM',      'Lavadoras', 'LAVADORAS', 3)
       ON CONFLICT (code) DO NOTHING`,
    );
    await c.query(
      `INSERT INTO subareas (department_id, code, name, report_label, sort_order)
       SELECT id, 'PT', 'PT', 'PT', 1 FROM departments WHERE code = 'CENTRAL'
       ON CONFLICT DO NOTHING`,
    );
    const shifts = new Map((await c.query<{ id: number; code: string }>(`SELECT id, code FROM shifts`)).rows.map((r) => [r.code, r.id]));
    const depts = new Map((await c.query<{ id: number; code: string }>(`SELECT id, code FROM departments`)).rows.map((r) => [r.code, r.id]));
    const subs = new Map((await c.query<{ id: number; code: string }>(`SELECT id, code FROM subareas`)).rows.map((r) => [r.code, r.id]));

    const insertEmployee = async (
      seedKey: string, number: string, name: string, role: string, deptId: number | null, shiftId: number,
      shiftCode: string, area: string, subareaId: number | null = null,
    ) => {
      const res = await c.query<{ id: number }>(
        `INSERT INTO employees (employee_number, full_name, role, department_id, subarea_id, shift_id, seed_key)
         VALUES ($1, $2, $3, $4, $5, $6, $7)
         ON CONFLICT DO NOTHING RETURNING id`,
        [number, name, role, deptId, subareaId, shiftId, seedKey],
      );
      if (res.rows[0]) {
        result.createdEmployees.push({ employeeNumber: number, name, shift: shiftCode, area, role });
        await c.query(
          `INSERT INTO audit_logs (actor_type, actor_label, action, entity, entity_id, details)
           VALUES ('SYSTEM', 'carga inicial', 'EMPLOYEE_SEEDED', 'employee', $1, $2)`,
          [String(res.rows[0].id), JSON.stringify({ employeeNumber: number, name, role })],
        );
      } else {
        result.skippedEmployees++;
      }
      return res.rows[0]?.id ?? null;
    };

    for (const shiftCode of ["DIA", "NOCHE"] as const) {
      let n = shiftCode === "DIA" ? 1001 : 2001;
      for (const [deptCode, list] of Object.entries(PLANTILLA[shiftCode])) {
        for (const emp of list) {
          await insertEmployee(
            `${shiftCode}-${deptCode}-${slug(emp.name)}`, String(n++), emp.name, emp.role ?? "EMPLOYEE",
            depts.get(deptCode)!, shifts.get(shiftCode)!, shiftCode, emp.subarea ? `${deptCode}-${emp.subarea}` : deptCode,
            emp.subarea ? subs.get(emp.subarea)! : null,
          );
        }
      }
    }

    // Supervisor de día: "Manuel" (persona distinta de Manuel Cruz de Central).
    await insertEmployee("SUP-DIA-manuel", "9001", "Manuel", "SUPERVISOR", null, shifts.get("DIA")!, "DIA", "SUPERVISIÓN");
    const sup = await c.query<{ id: number }>(`SELECT id FROM employees WHERE seed_key = 'SUP-DIA-manuel'`);

    // Usuario administrador del panel.
    const existing = await c.query(`SELECT id FROM users WHERE username = 'manuel'`);
    if (existing.rowCount === 0) {
      let password = process.env.ADMIN_INITIAL_PASSWORD?.trim();
      if (password) validatePasswordStrength(password);
      else password = generatePassword(14);
      await c.query(
        `INSERT INTO users (username, display_name, password_hash, role, employee_id)
         VALUES ('manuel', 'Manuel (Supervisor de día)', $1, 'ADMIN', $2)`,
        [await hashSecret(password), sup.rows[0]?.id ?? null],
      );
      await c.query(
        `INSERT INTO audit_logs (actor_type, actor_label, action, entity, details)
         VALUES ('SYSTEM', 'carga inicial', 'USER_SEEDED', 'user', '{"username":"manuel"}')`,
      );
      result.admin = { username: "manuel", password, created: true };
    }
  });

  if (writeFiles && result.admin.created) {
    const dir = join(process.cwd(), "credenciales-iniciales");
    mkdirSync(dir, { recursive: true });
    const stamp = new Date().toISOString().replace(/[:.]/g, "-");
    const file = join(dir, `credenciales-${stamp}.csv`);
    const lines = ["usuario_panel,nombre,rol,contrasena_inicial"];
    lines.push(`${result.admin.username},Manuel (Supervisor de día),ADMIN,${result.admin.password}`);
    writeFileSync(file, "﻿" + lines.join("\n") + "\n", { mode: 0o600 });
    result.credentialsFile = file;
  }

  if (log) {
    console.log(`✔ Empleados creados: ${result.createdEmployees.length} · ya existentes (sin cambios): ${result.skippedEmployees}`);
    if (result.createdEmployees.length) {
      console.log("  Los empleados no tienen PIN: cada uno lo crea la primera vez que entra con su número.");
      console.log("  Recuerda cambiar los números provisionales (1001…, 2001…) por los números reales desde el panel.");
    }
    if (result.admin.created) {
      console.log(`✔ Usuario administrador creado: ${result.admin.username}`);
      if (!process.env.ADMIN_INITIAL_PASSWORD) console.log(`  Contraseña generada: ${result.admin.password}`);
    } else {
      console.log("✔ El usuario administrador ya existía (no se modificó).");
    }
    if (result.credentialsFile) {
      console.log(`✔ Contraseña del administrador guardada en:\n  ${result.credentialsFile}`);
      console.log("  Cámbiala al entrar (Mi cuenta) y elimina el archivo.");
    }
  }
  return result;
}

if (process.argv[1]?.endsWith("seed.ts")) {
  seed()
    .then(() => closePool())
    .catch(async (err) => {
      console.error("✖", err.message);
      await closePool();
      process.exit(1);
    });
}
