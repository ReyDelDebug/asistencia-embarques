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
  temporary: boolean; // en apoyo temporal
  until: string | null;
  homeDepartmentName: string | null;
  support: boolean; // está en un área distinta a la suya
}

export async function getRol(date: string): Promise<RolRow[]> {
  if (!isValidDateString(date)) throw new AppError(400, "BAD_DATE", "Fecha no válida.");
  const rows = await query<{
    id: number; employee_number: string; full_name: string; role: RolRow["role"]; department_id: number | null;
    department_name: string | null; subarea_id: number | null; subarea_name: string | null; shift_code: string;
    since: string | null; next_date: string | null; next_code: string | null; next_name: string | null;
    d_order: number | null; sa_order: number | null; temporary: boolean; until_date: string | null;
    home_department_id: number | null; home_department_name: string | null;
  }>(
    `SELECT e.id, e.employee_number, e.full_name, e.role, pl.department_id, d.name AS department_name,
            pl.subarea_id, sa.name AS subarea_name, d.sort_order AS d_order, sa.sort_order AS sa_order,
            pl.is_temporary AS temporary, pl.until_date, e.department_id AS home_department_id, hd.name AS home_department_name,
            s.code AS shift_code,
            (SELECT max(x.effective_from) FROM shift_assignments x WHERE x.employee_id = e.id AND x.effective_from <= $1
               AND (x.end_date IS NULL OR x.end_date >= $1)) AS since,
            nx.effective_from AS next_date, ns.code AS next_code, ns.name AS next_name
     FROM employees e
     CROSS JOIN LATERAL employee_placement_on(e.id, $1) pl
     LEFT JOIN departments d ON d.id = pl.department_id
     LEFT JOIN departments hd ON hd.id = e.department_id
     LEFT JOIN subareas sa ON sa.id = pl.subarea_id
     JOIN shifts s ON s.id = pl.shift_id
     LEFT JOIN LATERAL (
       SELECT y.effective_from, y.shift_id FROM shift_assignments y
       WHERE y.employee_id = e.id AND y.effective_from > $1 ORDER BY y.effective_from, y.id LIMIT 1
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
    temporary: r.temporary,
    until: r.until_date,
    homeDepartmentName: r.home_department_name,
    support: r.department_id !== r.home_department_id,
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
      const placement = await getPlacement(emp.id, effectiveFrom, client);
      if (placement.temporary) {
        throw new AppError(409, "IN_SUPPORT", `${emp.full_name} está en apoyo temporal; termina el apoyo antes de cambiar su turno.`);
      }
      // Conserva el área vigente (si tuvo un cambio de área permanente)
      const keep = await queryOne<{ department_id: number | null; subarea_id: number | null }>(
        `SELECT department_id, subarea_id FROM shift_assignments
         WHERE employee_id = $1 AND effective_from <= $2 AND end_date IS NULL
         ORDER BY effective_from DESC, id DESC LIMIT 1`, [emp.id, effectiveFrom], client);
      await query(
        `INSERT INTO shift_assignments (employee_id, shift_id, effective_from, created_by, department_id, subarea_id)
         VALUES ($1, $2, $3, $4, $5, $6)
         ON CONFLICT ON CONSTRAINT shift_assignments_unique
         DO UPDATE SET shift_id = EXCLUDED.shift_id, created_by = EXCLUDED.created_by, created_at = now(),
                       department_id = EXCLUDED.department_id, subarea_id = EXCLUDED.subarea_id, end_date = NULL`,
        [emp.id, shift.id, effectiveFrom, user.id, keep?.department_id ?? null, keep?.subarea_id ?? null], client,
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

// ---------------------------------------------------------------------
// Cambio de área (apoyo temporal o cambio permanente)
// ---------------------------------------------------------------------
export interface Placement {
  shiftId: number;
  departmentId: number | null;
  subareaId: number | null;
  temporary: boolean;
  until: string | null;
}

export async function getPlacement(employeeId: number, date: string, client?: Queryable): Promise<Placement> {
  const r = await queryOne<{ shift_id: number; department_id: number | null; subarea_id: number | null; is_temporary: boolean; until_date: string | null }>(
    `SELECT * FROM employee_placement_on($1, $2)`, [employeeId, date], client);
  if (!r) throw new AppError(404, "NOT_FOUND", "Empleado no encontrado.");
  return { shiftId: r.shift_id, departmentId: r.department_id, subareaId: r.subarea_id, temporary: r.is_temporary, until: r.until_date };
}

export async function changeArea(
  input: { employeeId: number; shiftCode: string; departmentId: number; subareaId?: number | null; effectiveFrom: string; endDate?: string | null },
  user: SessionUser,
  ip: string,
  now: Date,
): Promise<{ temporary: boolean }> {
  const today = getLocalParts(now).date;
  if (!isValidDateString(input.effectiveFrom)) throw new AppError(400, "BAD_DATE", "Fecha de inicio no válida.");
  if (input.effectiveFrom < today) throw new AppError(400, "PAST_DATE", "El cambio solo puede aplicarse a partir de hoy.");
  const endDate = input.endDate ? String(input.endDate) : null;
  if (endDate && (!isValidDateString(endDate) || endDate < input.effectiveFrom)) {
    throw new AppError(400, "BAD_END", "La fecha de regreso debe ser igual o posterior a la de inicio.");
  }
  const shifts = await getShifts();
  const shift = shifts.find((s) => s.code === input.shiftCode);
  if (!shift) throw new AppError(400, "BAD_SHIFT", "Turno no válido.");
  const dept = await queryOne<{ id: number; name: string }>(`SELECT id, name FROM departments WHERE id = $1`, [Number(input.departmentId)]);
  if (!dept) throw new AppError(400, "BAD_DEPARTMENT", "Área no válida.");
  let subareaId: number | null = null;
  if (input.subareaId) {
    const sub = await queryOne<{ id: number }>(`SELECT id FROM subareas WHERE id = $1 AND department_id = $2`, [Number(input.subareaId), dept.id]);
    if (!sub) throw new AppError(400, "BAD_SUBAREA", "La subárea no pertenece al área seleccionada.");
    subareaId = sub.id;
  }
  const emp = await queryOne<{ id: number; full_name: string; role: string; active: boolean; department_id: number | null }>(
    `SELECT id, full_name, role, active, department_id FROM employees WHERE id = $1`, [Number(input.employeeId)]);
  if (!emp || !emp.active) throw new AppError(404, "NOT_FOUND", "Empleado no encontrado o dado de baja.");
  if (emp.role === "SUPERVISOR") throw new AppError(400, "SUPERVISOR", "Los supervisores no pertenecen a un área.");

  const before = await getPlacement(emp.id, input.effectiveFrom);
  await query(
    `INSERT INTO shift_assignments (employee_id, shift_id, effective_from, created_by, department_id, subarea_id, end_date)
     VALUES ($1, $2, $3, $4, $5, $6, $7)
     ON CONFLICT ON CONSTRAINT shift_assignments_unique
     DO UPDATE SET shift_id = EXCLUDED.shift_id, created_by = EXCLUDED.created_by, created_at = now(),
                   department_id = EXCLUDED.department_id, subarea_id = EXCLUDED.subarea_id, end_date = EXCLUDED.end_date`,
    [emp.id, shift.id, input.effectiveFrom, user.id, dept.id, subareaId, endDate],
  );
  await logAudit({
    actorType: "USER", actorId: user.id, actorLabel: user.displayName, action: endDate ? "AREA_SUPPORT_SET" : "AREA_CHANGED",
    entity: "employee", entityId: emp.id,
    details: {
      employee: emp.full_name, from: before, to: { shift: shift.code, departmentId: dept.id, department: dept.name, subareaId },
      effectiveFrom: input.effectiveFrom, endDate,
    },
    ip,
  });
  return { temporary: !!endDate };
}

/** Termina un apoyo temporal hoy: a partir de mañana regresa a su área y turno. */
export async function endSupport(employeeId: number, user: SessionUser, ip: string, now: Date): Promise<void> {
  const today = getLocalParts(now).date;
  const row = await queryOne<{ id: number; effective_from: string }>(
    `SELECT id, effective_from FROM shift_assignments
     WHERE employee_id = $1 AND end_date IS NOT NULL AND department_id IS NOT NULL
       AND end_date >= $2 ORDER BY effective_from LIMIT 1`, [employeeId, today]);
  if (!row) throw new AppError(404, "NOT_FOUND", "Esta persona no tiene un apoyo vigente o programado.");
  if (row.effective_from > today) {
    await query(`DELETE FROM shift_assignments WHERE id = $1`, [row.id]); // aún no empezaba
  } else {
    await query(`UPDATE shift_assignments SET end_date = $2 WHERE id = $1`, [row.id, today]);
  }
  await logAudit({
    actorType: "USER", actorId: user.id, actorLabel: user.displayName, action: "AREA_SUPPORT_ENDED",
    entity: "employee", entityId: employeeId, details: { date: today }, ip,
  });
}
