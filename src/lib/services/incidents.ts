import { query, queryOne, withTransaction } from "../db";
import { AppError, isUniqueViolation } from "../errors";
import { daysBetween, getLocalParts, isValidDateString } from "../time";
import { logAudit } from "./audit";
import type { SessionUser } from "./auth";
import { INCIDENT_TYPES, type IncidentType } from "./roster";

export async function setIncident(
  input: { employeeId: number; date: string; shiftId?: number | null; type: string; reason: string },
  user: SessionUser,
  ip: string,
  now: Date,
): Promise<{ id: number }> {
  const type = String(input.type ?? "").toUpperCase() as IncidentType;
  const reason = String(input.reason ?? "").trim();
  if (!INCIDENT_TYPES.includes(type)) throw new AppError(400, "BAD_TYPE", "Tipo de incidencia no válido.");
  if (reason.length < 3) throw new AppError(400, "REASON_REQUIRED", "Debes indicar un motivo (mínimo 3 caracteres).");
  if (reason.length > 500) throw new AppError(400, "REASON_TOO_LONG", "El motivo es demasiado largo (máximo 500).");
  if (!isValidDateString(input.date)) throw new AppError(400, "BAD_DATE", "Fecha no válida.");
  const today = getLocalParts(now).date;
  if (Math.abs(daysBetween(today, input.date)) > 366) {
    throw new AppError(400, "BAD_DATE", "La fecha está fuera del rango permitido (±1 año).");
  }

  const emp = await queryOne<{ id: number; full_name: string; shift_id: number }>(
    `SELECT id, full_name, shift_id FROM employees WHERE id = $1`, [input.employeeId],
  );
  if (!emp) throw new AppError(404, "NOT_FOUND", "Empleado no encontrado.");
  const shiftId = input.shiftId ?? emp.shift_id;

  return withTransaction(async (client) => {
    const att = await queryOne<{ id: number }>(
      `SELECT id FROM attendance WHERE employee_id = $1 AND operational_date = $2`, [emp.id, input.date], client,
    );
    if (att) {
      throw new AppError(409, "ALREADY_CONFIRMED",
        "El empleado ya confirmó su asistencia en esta fecha. Su registro no puede modificarse.");
    }
    // Bloquea la fila del empleado para serializar cambios concurrentes.
    await query(`SELECT id FROM employees WHERE id = $1 FOR UPDATE`, [emp.id], client);
    const previous = await queryOne<{ id: number; type: string; reason: string }>(
      `SELECT id, type, reason FROM incidents
       WHERE employee_id = $1 AND operational_date = $2 AND shift_id = $3 AND revoked_at IS NULL`,
      [emp.id, input.date, shiftId], client,
    );
    if (previous) {
      await query(
        `UPDATE incidents SET revoked_at = $2, revoked_by = $3, revoke_reason = $4 WHERE id = $1`,
        [previous.id, now, user.id, `Reemplazada por ${type}: ${reason}`], client,
      );
    }
    let inserted: { id: number } | null;
    try {
      inserted = await queryOne<{ id: number }>(
        `INSERT INTO incidents (employee_id, shift_id, operational_date, type, reason, created_by, created_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING id`,
        [emp.id, shiftId, input.date, type, reason, user.id, now], client,
      );
    } catch (err) {
      if (isUniqueViolation(err)) throw new AppError(409, "CONFLICT", "Otro usuario modificó este registro. Recarga e intenta de nuevo.");
      throw err;
    }
    await logAudit({
      actorType: "USER", actorId: user.id, actorLabel: user.displayName, action: "INCIDENT_SET",
      entity: "employee", entityId: emp.id,
      details: {
        incidentId: inserted!.id, employee: emp.full_name, date: input.date, shiftId, type, reason,
        previous: previous ? { id: previous.id, type: previous.type, reason: previous.reason } : null,
      },
      ip,
    }, client);
    return { id: inserted!.id };
  });
}

export async function revokeIncident(
  incidentId: number,
  reason: string,
  user: SessionUser,
  ip: string,
  now: Date,
): Promise<void> {
  const r = String(reason ?? "").trim();
  if (r.length < 3) throw new AppError(400, "REASON_REQUIRED", "Debes indicar un motivo (mínimo 3 caracteres).");
  const inc = await queryOne<{ id: number; employee_id: number; type: string; operational_date: string; revoked_at: Date | null }>(
    `SELECT id, employee_id, type, operational_date, revoked_at FROM incidents WHERE id = $1`, [incidentId],
  );
  if (!inc) throw new AppError(404, "NOT_FOUND", "Incidencia no encontrada.");
  if (inc.revoked_at) throw new AppError(409, "ALREADY_REVOKED", "La incidencia ya fue retirada.");
  await withTransaction(async (client) => {
    await query(
      `UPDATE incidents SET revoked_at = $2, revoked_by = $3, revoke_reason = $4 WHERE id = $1`,
      [incidentId, now, user.id, r], client,
    );
    await logAudit({
      actorType: "USER", actorId: user.id, actorLabel: user.displayName, action: "INCIDENT_REVOKED",
      entity: "employee", entityId: inc.employee_id,
      details: { incidentId, type: inc.type, date: inc.operational_date, reason: r }, ip,
    }, client);
  });
}

export interface IncidentHistoryRow {
  id: number;
  operational_date: string;
  shift_name: string;
  type: string;
  reason: string;
  created_at: Date;
  created_by_name: string;
  revoked_at: Date | null;
  revoked_by_name: string | null;
  revoke_reason: string | null;
}

export async function getEmployeeHistory(employeeId: number, limit = 120) {
  const attendance = await query<{ id: number; operational_date: string; confirmed_at: Date; shift_name: string; department_name: string | null }>(
    `SELECT a.id, a.operational_date, a.confirmed_at, s.name AS shift_name, d.name AS department_name
     FROM attendance a JOIN shifts s ON s.id = a.shift_id LEFT JOIN departments d ON d.id = a.department_id
     WHERE a.employee_id = $1 ORDER BY a.operational_date DESC, a.confirmed_at DESC LIMIT $2`,
    [employeeId, limit],
  );
  const incidents = await query<IncidentHistoryRow>(
    `SELECT i.id, i.operational_date, s.name AS shift_name, i.type, i.reason, i.created_at,
            u.display_name AS created_by_name, i.revoked_at, ru.display_name AS revoked_by_name, i.revoke_reason
     FROM incidents i JOIN shifts s ON s.id = i.shift_id
     JOIN users u ON u.id = i.created_by LEFT JOIN users ru ON ru.id = i.revoked_by
     WHERE i.employee_id = $1 ORDER BY i.operational_date DESC, i.created_at DESC LIMIT $2`,
    [employeeId, limit],
  );
  const audit = await query<{ id: number; action: string; actor_label: string | null; details: unknown; created_at: Date }>(
    `SELECT id, action, actor_label, details, created_at FROM audit_logs
     WHERE entity = 'employee' AND entity_id = $1 AND action NOT IN ('EMPLOYEE_LOGIN')
     ORDER BY created_at DESC LIMIT $2`,
    [String(employeeId), limit],
  );
  return { attendance, incidents, audit };
}
