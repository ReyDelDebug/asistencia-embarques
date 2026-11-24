import { query, queryOne, withTransaction, type Queryable } from "../db";
import { AppError, isUniqueViolation } from "../errors";
import { getLocalParts, isValidDateString } from "../time";
import { logAudit } from "./audit";
import { revokeAllSessions, type SessionUser } from "./auth";
import { getDepartments, getShifts, getSubareas } from "./catalog";
import { validateFullName } from "./profile";

export type EmployeeRole = "EMPLOYEE" | "LEADER" | "SUPERVISOR";

export interface EmployeeListRow {
  id: number;
  employee_number: string;
  full_name: string;
  role: EmployeeRole;
  department_id: number | null;
  department_name: string | null;
  subarea_id: number | null;
  subarea_name: string | null;
  shift_id: number;
  shift_code: string;
  shift_name: string;
  current_shift_code: string;
  current_shift_name: string;
  active: boolean;
  terminated_at: string | null;
  has_pin: boolean;
  locked_until: Date | null;
  panel_username: string | null;
  photo_version: string | null;
}

export async function listEmployees(): Promise<EmployeeListRow[]> {
  const today = getLocalParts(new Date()).date;
  return query<EmployeeListRow>(
    `SELECT e.id, e.employee_number, e.full_name, e.role, e.department_id, d.name AS department_name,
            e.subarea_id, sa.name AS subarea_name,
            e.shift_id, s.code AS shift_code, s.name AS shift_name,
            cs.code AS current_shift_code, cs.name AS current_shift_name, e.active, e.terminated_at,
            (e.pin_hash IS NOT NULL) AS has_pin,
            CASE WHEN e.locked_until > now() THEN e.locked_until END AS locked_until,
            u.username AS panel_username,
            (extract(epoch FROM ph.updated_at) * 1000)::bigint::text AS photo_version
     FROM employees e
     JOIN shifts s ON s.id = e.shift_id
     JOIN shifts cs ON cs.id = employee_shift_on(e.id, $1)
     LEFT JOIN departments d ON d.id = e.department_id
     LEFT JOIN subareas sa ON sa.id = e.subarea_id
     LEFT JOIN users u ON u.employee_id = e.id
     LEFT JOIN employee_photos ph ON ph.employee_id = e.id
     ORDER BY e.active DESC, d.sort_order NULLS FIRST, sa.sort_order NULLS FIRST,
              CASE e.role WHEN 'SUPERVISOR' THEN 0 WHEN 'LEADER' THEN 1 ELSE 2 END, e.full_name`,
    [today],
  );
}

/** Números: turno de día 1001+, noche 2001+, supervisores 9001+. */
export async function nextEmployeeNumber(shiftCode: string, role: EmployeeRole, client?: Queryable): Promise<string> {
  const base = role === "SUPERVISOR" ? 9000 : shiftCode === "NOCHE" ? 2000 : 1000;
  const row = await queryOne<{ max: number | null }>(
    `SELECT max(employee_number::int) AS max FROM employees
     WHERE employee_number ~ '^[0-9]{4}$' AND employee_number::int > $1 AND employee_number::int < $2`,
    [base, base + 1000],
    client,
  );
  const next = (row?.max ?? base) + 1;
  if (next >= base + 1000) throw new AppError(409, "NUMBER_RANGE_FULL", "No hay números disponibles en el rango.");
  return String(next);
}

interface EmployeeInput {
  employeeNumber?: string;
  fullName: string;
  role: EmployeeRole;
  departmentId: number | null;
  subareaId?: number | null;
  shiftId: number;
}

async function validateInput(input: EmployeeInput): Promise<EmployeeInput & { shiftCode: string; subareaId: number | null }> {
  const fullName = validateFullName(input.fullName);
  const role = String(input.role ?? "EMPLOYEE").toUpperCase() as EmployeeRole;
  if (!["EMPLOYEE", "LEADER", "SUPERVISOR"].includes(role)) throw new AppError(400, "BAD_ROLE", "Rol no válido.");
  const shifts = await getShifts();
  const shift = shifts.find((s) => s.id === Number(input.shiftId));
  if (!shift) throw new AppError(400, "BAD_SHIFT", "Turno no válido.");
  let departmentId: number | null = null;
  if (role !== "SUPERVISOR") {
    const depts = await getDepartments();
    const dept = depts.find((d) => d.id === Number(input.departmentId));
    if (!dept) throw new AppError(400, "BAD_DEPARTMENT", "Selecciona un área.");
    departmentId = dept.id;
  }
  let subareaId: number | null = null;
  if (departmentId && input.subareaId) {
    const sub = (await getSubareas()).find((x) => x.id === Number(input.subareaId) && x.departmentId === departmentId);
    if (!sub) throw new AppError(400, "BAD_SUBAREA", "La subárea no pertenece al área seleccionada.");
    subareaId = sub.id;
  }
  const employeeNumber = input.employeeNumber ? String(input.employeeNumber).trim() : undefined;
  if (employeeNumber && !/^\d{3,10}$/.test(employeeNumber)) {
    throw new AppError(400, "BAD_NUMBER", "El número de empleado debe tener de 3 a 10 dígitos.");
  }
  return { employeeNumber, fullName, role, departmentId, subareaId, shiftId: shift.id, shiftCode: shift.code };
}

export async function createEmployee(
  raw: EmployeeInput,
  user: SessionUser,
  ip: string,
): Promise<{ id: number; employeeNumber: string }> {
  const input = await validateInput(raw);
  try {
    return await withTransaction(async (client) => {
      await client.query("LOCK TABLE employees IN SHARE ROW EXCLUSIVE MODE");
      const number = input.employeeNumber ?? (await nextEmployeeNumber(input.shiftCode, input.role, client));
      const row = await queryOne<{ id: number }>(
        `INSERT INTO employees (employee_number, full_name, role, department_id, subarea_id, shift_id)
         VALUES ($1, $2, $3, $4, $5, $6) RETURNING id`,
        [number, input.fullName, input.role, input.departmentId, input.subareaId, input.shiftId],
        client,
      );
      await logAudit({
        actorType: "USER", actorId: user.id, actorLabel: user.displayName, action: "EMPLOYEE_CREATED",
        entity: "employee", entityId: row!.id,
        details: { employeeNumber: number, fullName: input.fullName, role: input.role, departmentId: input.departmentId, subareaId: input.subareaId, shiftId: input.shiftId },
        ip,
      }, client);
      return { id: row!.id, employeeNumber: number };
    });
  } catch (err) {
    if (isUniqueViolation(err)) throw new AppError(409, "DUPLICATE_NUMBER", "Ese número de empleado ya existe.");
    throw err;
  }
}

export async function updateEmployee(id: number, raw: EmployeeInput, user: SessionUser, ip: string): Promise<void> {
  const input = await validateInput(raw);
  const before = await queryOne<Record<string, unknown>>(
    `SELECT employee_number, full_name, role, department_id, subarea_id, shift_id FROM employees WHERE id = $1`, [id],
  );
  if (!before) throw new AppError(404, "NOT_FOUND", "Empleado no encontrado.");
  const number = input.employeeNumber ?? (before.employee_number as string);
  try {
    await withTransaction(async (client) => {
      await query(
        `UPDATE employees SET employee_number = $2, full_name = $3, role = $4, department_id = $5, subarea_id = $6,
                shift_id = $7, updated_at = now()
         WHERE id = $1`,
        [id, number, input.fullName, input.role, input.departmentId, input.subareaId, input.shiftId],
        client,
      );
      const after = { employee_number: number, full_name: input.fullName, role: input.role, department_id: input.departmentId, subarea_id: input.subareaId, shift_id: input.shiftId };
      const changes: Record<string, { antes: unknown; despues: unknown }> = {};
      for (const k of Object.keys(after) as (keyof typeof after)[]) {
        if (before[k] !== after[k]) changes[k] = { antes: before[k], despues: after[k] };
      }
      await logAudit({
        actorType: "USER", actorId: user.id, actorLabel: user.displayName, action: "EMPLOYEE_UPDATED",
        entity: "employee", entityId: id, details: { changes }, ip,
      }, client);
    });
  } catch (err) {
    if (isUniqueViolation(err)) throw new AppError(409, "DUPLICATE_NUMBER", "Ese número de empleado ya existe.");
    throw err;
  }
}

/**
 * Restablecer PIN: borra el PIN actual, desbloquea la cuenta y cierra sesiones.
 * El trabajador vuelve a crear su propio PIN la próxima vez que entre.
 */
export async function resetEmployeePin(
  id: number, user: SessionUser, ip: string,
): Promise<{ employeeNumber: string; fullName: string }> {
  const emp = await queryOne<{ employee_number: string; full_name: string }>(
    `UPDATE employees SET pin_hash = NULL, failed_attempts = 0, locked_until = NULL, updated_at = now()
     WHERE id = $1 RETURNING employee_number, full_name`,
    [id],
  );
  if (!emp) throw new AppError(404, "NOT_FOUND", "Empleado no encontrado.");
  await revokeAllSessions("EMPLOYEE", id);
  await logAudit({
    actorType: "USER", actorId: user.id, actorLabel: user.displayName, action: "EMPLOYEE_PIN_RESET",
    entity: "employee", entityId: id, details: { employeeNumber: emp.employee_number }, ip,
  });
  return { employeeNumber: emp.employee_number, fullName: emp.full_name };
}

export async function terminateEmployee(
  id: number, reason: string, date: string | undefined, user: SessionUser, ip: string, now: Date,
): Promise<void> {
  const r = String(reason ?? "").trim();
  if (r.length < 3) throw new AppError(400, "REASON_REQUIRED", "Indica el motivo de la baja.");
  const d = date && isValidDateString(date) ? date : getLocalParts(now).date;
  const emp = await queryOne<{ id: number }>(
    `UPDATE employees SET active = false, terminated_at = $2, updated_at = now() WHERE id = $1 AND active RETURNING id`,
    [id, d],
  );
  if (!emp) throw new AppError(404, "NOT_FOUND", "Empleado no encontrado o ya dado de baja.");
  await revokeAllSessions("EMPLOYEE", id);
  await logAudit({
    actorType: "USER", actorId: user.id, actorLabel: user.displayName, action: "EMPLOYEE_TERMINATED",
    entity: "employee", entityId: id, details: { date: d, reason: r }, ip,
  });
}

export async function reactivateEmployee(id: number, reason: string, user: SessionUser, ip: string): Promise<void> {
  const r = String(reason ?? "").trim();
  if (r.length < 3) throw new AppError(400, "REASON_REQUIRED", "Indica el motivo de la reactivación.");
  const emp = await queryOne<{ id: number }>(
    `UPDATE employees SET active = true, terminated_at = NULL, updated_at = now() WHERE id = $1 AND NOT active RETURNING id`,
    [id],
  );
  if (!emp) throw new AppError(404, "NOT_FOUND", "Empleado no encontrado o ya activo.");
  await logAudit({
    actorType: "USER", actorId: user.id, actorLabel: user.displayName, action: "EMPLOYEE_REACTIVATED",
    entity: "employee", entityId: id, details: { reason: r }, ip,
  });
}
