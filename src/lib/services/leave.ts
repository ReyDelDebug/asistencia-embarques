/**
 * Solicitudes de vacaciones y PSG.
 * El trabajador solicita desde su celular → queda PENDIENTE → el supervisor
 * aprueba o rechaza. Al aprobar, cada día del periodo queda registrado como
 * incidencia VACACIONES / PSG y aparece así en el panel, el reporte y el Excel.
 */
import { query, queryOne, withTransaction } from "../db";
import { AppError } from "../errors";
import { addDays, daysBetween, getLocalParts, isValidDateString } from "../time";
import { logAudit } from "./audit";
import type { SessionEmployee, SessionUser } from "./auth";
import { getEffectiveShiftId } from "./rol";

export const LEAVE_TYPES = ["VACACIONES", "PSG"] as const;
export const MAX_LEAVE_DAYS = 31;

export interface LeaveRequest {
  id: number;
  employeeId: number;
  employeeNumber: string;
  fullName: string;
  departmentName: string;
  type: "VACACIONES" | "PSG";
  startDate: string;
  endDate: string;
  days: number;
  reason: string;
  status: "PENDIENTE" | "APROBADA" | "RECHAZADA" | "CANCELADA";
  createdAt: string;
  decidedBy: string | null;
  decidedAt: string | null;
  decisionNote: string | null;
}

const SELECT = `
  SELECT lr.*, e.employee_number, e.full_name,
         COALESCE(d.name || COALESCE(' · ' || sa.name, ''), 'Supervisión') AS department_name,
         u.display_name AS decided_by_name
  FROM leave_requests lr
  JOIN employees e ON e.id = lr.employee_id
  LEFT JOIN departments d ON d.id = e.department_id
  LEFT JOIN subareas sa ON sa.id = e.subarea_id
  LEFT JOIN users u ON u.id = lr.decided_by`;

interface Raw {
  id: number; employee_id: number; employee_number: string; full_name: string; department_name: string;
  type: LeaveRequest["type"]; start_date: string; end_date: string; reason: string; status: LeaveRequest["status"];
  created_at: Date; decided_by_name: string | null; decided_at: Date | null; decision_note: string | null;
}

function map(r: Raw): LeaveRequest {
  return {
    id: r.id,
    employeeId: r.employee_id,
    employeeNumber: r.employee_number,
    fullName: r.full_name,
    departmentName: r.department_name,
    type: r.type,
    startDate: r.start_date,
    endDate: r.end_date,
    days: daysBetween(r.start_date, r.end_date) + 1,
    reason: r.reason,
    status: r.status,
    createdAt: r.created_at.toISOString(),
    decidedBy: r.decided_by_name,
    decidedAt: r.decided_at ? r.decided_at.toISOString() : null,
    decisionNote: r.decision_note,
  };
}

export async function createLeaveRequest(
  employee: SessionEmployee,
  input: { type: string; startDate: string; endDate: string; reason?: string },
  ip: string,
  now: Date,
): Promise<LeaveRequest> {
  const type = String(input.type ?? "").toUpperCase();
  if (!(LEAVE_TYPES as readonly string[]).includes(type)) throw new AppError(400, "BAD_TYPE", "Elige Vacaciones o PSG.");
  const { startDate, endDate } = input;
  if (!isValidDateString(startDate) || !isValidDateString(endDate)) throw new AppError(400, "BAD_DATE", "Fechas no válidas.");
  if (endDate < startDate) throw new AppError(400, "BAD_RANGE", "La fecha final no puede ser anterior a la inicial.");
  const today = getLocalParts(now).date;
  if (startDate < today) throw new AppError(400, "PAST_DATE", "No puedes solicitar días que ya pasaron.");
  if (daysBetween(today, startDate) > 365) throw new AppError(400, "TOO_FAR", "Solo puedes solicitar hasta un año por adelantado.");
  if (daysBetween(startDate, endDate) + 1 > MAX_LEAVE_DAYS) {
    throw new AppError(400, "TOO_LONG", `Cada solicitud puede abarcar máximo ${MAX_LEAVE_DAYS} días.`);
  }
  const reason = String(input.reason ?? "").trim().slice(0, 300);

  const overlap = await queryOne<{ id: number }>(
    `SELECT id FROM leave_requests WHERE employee_id = $1 AND status IN ('PENDIENTE', 'APROBADA')
     AND start_date <= $3 AND end_date >= $2 LIMIT 1`,
    [employee.id, startDate, endDate],
  );
  if (overlap) throw new AppError(409, "OVERLAP", "Ya tienes una solicitud pendiente o aprobada en esas fechas.");

  const row = await queryOne<{ id: number }>(
    `INSERT INTO leave_requests (employee_id, type, start_date, end_date, reason, created_at)
     VALUES ($1, $2, $3, $4, $5, $6) RETURNING id`,
    [employee.id, type, startDate, endDate, reason, now],
  );
  await logAudit({
    actorType: "EMPLOYEE", actorId: employee.id, actorLabel: employee.fullName, action: "LEAVE_REQUESTED",
    entity: "employee", entityId: employee.id, details: { requestId: row!.id, type, startDate, endDate, reason }, ip,
  });
  return (await getLeaveRequest(row!.id))!;
}

export async function getLeaveRequest(id: number): Promise<LeaveRequest | null> {
  const r = await queryOne<Raw>(`${SELECT} WHERE lr.id = $1`, [id]);
  return r ? map(r) : null;
}

export async function listMyLeaveRequests(employeeId: number): Promise<LeaveRequest[]> {
  const rows = await query<Raw>(`${SELECT} WHERE lr.employee_id = $1 ORDER BY lr.start_date DESC, lr.id DESC LIMIT 50`, [employeeId]);
  return rows.map(map);
}

export async function cancelMyLeaveRequest(employee: SessionEmployee, id: number, ip: string): Promise<void> {
  const row = await queryOne<{ id: number }>(
    `UPDATE leave_requests SET status = 'CANCELADA' WHERE id = $1 AND employee_id = $2 AND status = 'PENDIENTE' RETURNING id`,
    [id, employee.id],
  );
  if (!row) throw new AppError(404, "NOT_FOUND", "Solo puedes cancelar solicitudes pendientes.");
  await logAudit({
    actorType: "EMPLOYEE", actorId: employee.id, actorLabel: employee.fullName, action: "LEAVE_CANCELLED",
    entity: "employee", entityId: employee.id, details: { requestId: id }, ip,
  });
}

export async function listLeaveRequests(opts: { status?: string | null; from?: string | null; to?: string | null }): Promise<LeaveRequest[]> {
  const where: string[] = [];
  const params: unknown[] = [];
  if (opts.status) { params.push(opts.status); where.push(`lr.status = $${params.length}`); }
  if (opts.from) { params.push(opts.from); where.push(`lr.end_date >= $${params.length}`); }
  if (opts.to) { params.push(opts.to); where.push(`lr.start_date <= $${params.length}`); }
  const rows = await query<Raw>(
    `${SELECT} ${where.length ? `WHERE ${where.join(" AND ")}` : ""}
     ORDER BY CASE lr.status WHEN 'PENDIENTE' THEN 0 ELSE 1 END, lr.start_date, lr.id LIMIT 500`,
    params,
  );
  return rows.map(map);
}

export async function decideLeaveRequest(
  id: number,
  decision: "APROBAR" | "RECHAZAR",
  note: string,
  user: SessionUser,
  ip: string,
  now: Date,
): Promise<{ status: string; daysRegistered: number; skipped: string[] }> {
  const n = String(note ?? "").trim().slice(0, 300);
  if (decision === "RECHAZAR" && n.length < 3) {
    throw new AppError(400, "REASON_REQUIRED", "Indica el motivo del rechazo (mínimo 3 caracteres).");
  }
  return withTransaction(async (client) => {
    const req = await queryOne<{ id: number; employee_id: number; type: string; start_date: string; end_date: string; reason: string; status: string; full_name: string }>(
      `SELECT lr.*, e.full_name FROM leave_requests lr JOIN employees e ON e.id = lr.employee_id WHERE lr.id = $1 FOR UPDATE OF lr`,
      [id], client,
    );
    if (!req) throw new AppError(404, "NOT_FOUND", "Solicitud no encontrada.");
    if (req.status !== "PENDIENTE") throw new AppError(409, "ALREADY_DECIDED", "Esta solicitud ya fue atendida.");

    const status = decision === "APROBAR" ? "APROBADA" : "RECHAZADA";
    await query(
      `UPDATE leave_requests SET status = $2, decided_by = $3, decided_at = $4, decision_note = $5 WHERE id = $1`,
      [id, status, user.id, now, n || null], client,
    );

    let daysRegistered = 0;
    const skipped: string[] = [];
    if (status === "APROBADA") {
      const span = daysBetween(req.start_date, req.end_date) + 1;
      for (let i = 0; i < span; i++) {
        const date = addDays(req.start_date, i);
        const att = await queryOne<{ id: number }>(
          `SELECT id FROM attendance WHERE employee_id = $1 AND operational_date = $2`, [req.employee_id, date], client,
        );
        if (att) { skipped.push(date); continue; } // ya confirmó asistencia ese día: no se altera
        const shiftId = await getEffectiveShiftId(req.employee_id, date, client);
        await query(
          `UPDATE incidents SET revoked_at = $4, revoked_by = $5, revoke_reason = $6
           WHERE employee_id = $1 AND operational_date = $2 AND shift_id = $3 AND revoked_at IS NULL`,
          [req.employee_id, date, shiftId, now, user.id, `Reemplazada por solicitud #${id} aprobada`], client,
        );
        await query(
          `INSERT INTO incidents (employee_id, shift_id, operational_date, type, reason, created_by, created_at, leave_request_id)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
          [req.employee_id, shiftId, date, req.type,
            `Solicitud #${id} aprobada${req.reason ? `: ${req.reason}` : ""}`, user.id, now, id],
          client,
        );
        daysRegistered++;
      }
    }

    await logAudit({
      actorType: "USER", actorId: user.id, actorLabel: user.displayName,
      action: status === "APROBADA" ? "LEAVE_APPROVED" : "LEAVE_REJECTED",
      entity: "employee", entityId: req.employee_id,
      details: { requestId: id, employee: req.full_name, type: req.type, startDate: req.start_date, endDate: req.end_date, note: n, daysRegistered, skipped },
      ip,
    }, client);
    return { status, daysRegistered, skipped };
  });
}
