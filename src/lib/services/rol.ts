/**
 * Rol de turno. El supervisor asigna Día o Noche a cada trabajador a partir de
 * una fecha (normalmente el lunes de la semana). La asignación sigue vigente
 * hasta que el supervisor la vuelva a cambiar (ej. rotación cada 15 días).
 */
import { query, queryOne, withTransaction, type Queryable } from "../db";
import { AppError } from "../errors";
import { addDays, getLocalParts, isValidDateString } from "../time";
import { logAudit } from "./audit";
import type { SessionUser } from "./auth";
import { getShifts } from "./catalog";

/** Lunes de la semana de una fecha 'YYYY-MM-DD'. */
export function mondayOf(date: string): string {
  const d = new Date(`${date}T12:00:00Z`);
  const dow = d.getUTCDay(); // 0 = domingo
  return addDays(date, dow === 0 ? -6 : 1 - dow);
}

export async function getEffectiveShiftId(employeeId: number, date: string, client?: Queryable): Promise<number> {
  const row = await queryOne<{ shift_id: number }>(`SELECT employee_shift_on($1, $2) AS shift_id`, [employeeId, date], client);
  if (!row?.shift_id) throw new AppError(404, "NOT_FOUND", "Empleado no encontrado.");
  return row.shift_id;
}

export interface NextChange {
  date: string;
  shiftCode: string;
  shiftName: string;
}

/** Próximo cambio de turno programado después de una fecha. */
export async function getNextChange(employeeId: number, afterDate: string): Promise<NextChange | null> {
  const row = await queryOne<{ effective_from: string; code: string; name: string }>(
    `SELECT sa.effective_from, s.code, s.name FROM shift_assignments sa JOIN shifts s ON s.id = sa.shift_id
     WHERE sa.employee_id = $1 AND sa.effective_from > $2
     ORDER BY sa.effective_from LIMIT 1`,
    [employeeId, afterDate],
  );
  return row ? { date: row.effective_from, shiftCode: row.code, shiftName: row.name } : null;
}

export interface RolRow {
  employeeId: number;
  employeeNumber: string;
  fullName: string;
  role: "EMPLOYEE" | "LEADER" | "SUPERVISOR";
  departmentId: number | null;
  departmentName: string;
  subareaId: number | null;
  subareaName: string | null;
  shiftCode: string; // turno vigente en la fecha consultada
  since: string | null; // desde cuándo aplica ese turno (null = turno base)
  nextChange: NextChange | null;
}

export async function getRol(date: string): Promise<RolRow[]> {
  if (!isValidDateString(date)) throw new AppError(400, "BAD_DATE", "Fecha no válida.");
  const rows = await query<{
    id: number; employee_number: string; full_name: string; role: RolRow["role"]; department_id: number | null;
    department_name: string | null; subarea_id: number | null; subarea_name: string | null; shift_code: string;
    since: string | null; next_date: string | null; next_code: string | null; next_name: string | null;
    d_order: number | null; sa_order: number | null;
  }>(
    `SELECT e.id, e.employee_number, e.full_name, e.role, e.department_id, d.name AS department_name,
            e.subarea_id, sa.name AS subarea_name, d.sort_order AS d_order, sa.sort_order AS sa_order,
            s.code AS shift_code,
            (SELECT max(x.effective_from) FROM shift_assignments x WHERE x.employee_id = e.id AND x.effective_from <= $1) AS since,
            nx.effective_from AS next_date, ns.code AS next_code, ns.name AS next_name
     FROM employees e
     LEFT JOIN departments d ON d.id = e.department_id
     LEFT JOIN subareas sa ON sa.id = e.subarea_id
     JOIN shifts s ON s.id = employee_shift_on(e.id, $1)
     LEFT JOIN LATERAL (
       SELECT y.effective_from, y.shift_id FROM shift_assignments y
       WHERE y.employee_id = e.id AND y.effective_from > $1 ORDER BY y.effective_from LIMIT 1
     ) nx ON TRUE
     LEFT JOIN shifts ns ON ns.id = nx.shift_id
     WHERE e.active
     ORDER BY d.sort_order NULLS FIRST, sa.sort_order NULLS FIRST,
              CASE e.role WHEN 'SUPERVISOR' THEN 0 WHEN 'LEADER' THEN 1 ELSE 2 END, e.full_name`,
    [date],
  );
  return rows.map((r) => ({
    employeeId: r.id,
    employeeNumber: r.employee_number,
    fullName: r.full_name,
    role: r.role,
    departmentId: r.department_id,
    departmentName: r.department_name ?? "Supervisión",
    subareaId: r.subarea_id,
    subareaName: r.subarea_name,
    shiftCode: r.shift_code,
    since: r.since,
    nextChange: r.next_date ? { date: r.next_date, shiftCode: r.next_code!, shiftName: r.next_name! } : null,
  }));
}

export async function saveRol(
  effectiveFrom: string,
  items: { employeeId: number; shiftCode: string }[],
  user: SessionUser,
  ip: string,
  now: Date,
): Promise<{ changed: number }> {
  if (!isValidDateString(effectiveFrom)) throw new AppError(400, "BAD_DATE", "Fecha no válida.");
  const today = getLocalParts(now).date;
  if (effectiveFrom < today) {
    throw new AppError(400, "PAST_DATE", "El rol solo puede aplicarse a partir de hoy o en fechas futuras.");
  }
  if (!Array.isArray(items) || items.length === 0) throw new AppError(400, "EMPTY", "No hay cambios para guardar.");
  if (items.length > 500) throw new AppError(400, "TOO_MANY", "Demasiados registros.");
  const shifts = await getShifts();

  return withTransaction(async (client) => {
    const changes: { employeeId: number; name: string; from: string; to: string }[] = [];
    for (const item of items) {
      const shift = shifts.find((s) => s.code === item.shiftCode);
      if (!shift) throw new AppError(400, "BAD_SHIFT", "Turno no válido.");
      const emp = await queryOne<{ id: number; full_name: string; active: boolean }>(
        `SELECT id, full_name, active FROM employees WHERE id = $1`, [Number(item.employeeId)], client,
      );
      if (!emp || !emp.active) throw new AppError(404, "NOT_FOUND", "Empleado no encontrado o dado de baja.");
      const current = await getEffectiveShiftId(emp.id, effectiveFrom, client);
      if (current === shift.id) continue;
      await query(
        `INSERT INTO shift_assignments (employee_id, shift_id, effective_from, created_by)
         VALUES ($1, $2, $3, $4)
         ON CONFLICT ON CONSTRAINT shift_assignments_unique
         DO UPDATE SET shift_id = EXCLUDED.shift_id, created_by = EXCLUDED.created_by, created_at = now()`,
        [emp.id, shift.id, effectiveFrom, user.id], client,
      );
      changes.push({
        employeeId: emp.id, name: emp.full_name,
        from: shifts.find((s) => s.id === current)?.code ?? "?", to: shift.code,
      });
    }
    if (changes.length) {
      await logAudit({
        actorType: "USER", actorId: user.id, actorLabel: user.displayName, action: "ROL_UPDATED",
        entity: "shift_assignments", entityId: effectiveFrom, details: { effectiveFrom, changes }, ip,
      }, client);
    }
    return { changed: changes.length };
  });
}
