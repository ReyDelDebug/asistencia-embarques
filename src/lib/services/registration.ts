/**
 * Reglas para saber si un empleado puede registrar asistencia en este momento:
 *  - NORMAL:       dentro de la ventana del turno (05:00–07:19:59 / 17:00–19:19:59)
 *  - EXTENSION:    el supervisor o su líder le abrió el registro hasta las 07:30 / 19:30
 *  - LATE_NOTICE:  avisó "Llegaré tarde" antes del cierre; registra al llegar (hasta late_limit)
 * Extensiones y retardos aplican solo el mismo día operativo.
 *
 * Además: avisos de retardo y extensiones (crear y consultar).
 */
import { query, queryOne, withTransaction, type Queryable } from "../db";
import { AppError } from "../errors";
import { getLocalParts, lastAllowedSecond, timeToSeconds, windowState, type WindowState } from "../time";
import { logAudit } from "./audit";
import type { SessionEmployee, SessionUser } from "./auth";
import { getShifts, type Shift } from "./catalog";
import { getEffectiveShiftId } from "./rol";

export type RegMode = "NORMAL" | "EXTENSION" | "LATE_NOTICE";

export interface RegistrationState {
  open: boolean;
  state: WindowState; // estado de la ventana NORMAL
  mode: RegMode | null;
  until: string | null; // hora (exclusiva) hasta la que puede registrar
  lastAllowed: string | null;
}

export function evaluateRegistration(
  now: Date,
  shift: Shift,
  date: string,
  opts: { extensionClose?: string | null; hasLateNotice?: boolean },
): RegistrationState {
  const state = windowState(now, shift, date);
  const make = (mode: RegMode, until: string): RegistrationState =>
    ({ open: true, state, mode, until, lastAllowed: lastAllowedSecond(until) });
  if (state === "OPEN") return make("NORMAL", shift.closeTime);
  const local = getLocalParts(now);
  if (state === "CLOSED" && local.date === date) {
    if (opts.hasLateNotice && local.seconds < timeToSeconds(shift.lateLimit)) return make("LATE_NOTICE", shift.lateLimit);
    if (opts.extensionClose && local.seconds < timeToSeconds(opts.extensionClose)) return make("EXTENSION", opts.extensionClose);
  }
  return { open: false, state, mode: null, until: null, lastAllowed: null };
}

export interface ExtensionInfo { closeTime: string; grantedBy: string; createdAt: string }
export interface LateNoticeInfo { eta: string; reason: string; createdAt: string }

export async function getExtension(employeeId: number, date: string, shiftId: number, client?: Queryable): Promise<ExtensionInfo | null> {
  const r = await queryOne<{ close_time: string; granted_by_label: string; created_at: Date }>(
    `SELECT close_time, granted_by_label, created_at FROM attendance_extensions
     WHERE employee_id = $1 AND operational_date = $2 AND shift_id = $3`, [employeeId, date, shiftId], client);
  return r ? { closeTime: r.close_time, grantedBy: r.granted_by_label, createdAt: r.created_at.toISOString() } : null;
}

export async function getLateNotice(employeeId: number, date: string, shiftId: number, client?: Queryable): Promise<LateNoticeInfo | null> {
  const r = await queryOne<{ eta: string; reason: string; created_at: Date }>(
    `SELECT eta, reason, created_at FROM late_notices WHERE employee_id = $1 AND operational_date = $2 AND shift_id = $3`,
    [employeeId, date, shiftId], client);
  return r ? { eta: r.eta, reason: r.reason, createdAt: r.created_at.toISOString() } : null;
}

// ---------------------------------------------------------------------
// Llegaré tarde
// ---------------------------------------------------------------------
export async function createLateNotice(
  employee: SessionEmployee,
  input: { eta: string; reason: string },
  ip: string,
  now: Date,
): Promise<LateNoticeInfo> {
  const reason = String(input.reason ?? "").trim();
  if (reason.length < 3) throw new AppError(400, "REASON_REQUIRED", "Escribe el motivo de tu retardo (obligatorio).");
  if (reason.length > 300) throw new AppError(400, "REASON_TOO_LONG", "El motivo es demasiado largo (máximo 300).");
  const eta = String(input.eta ?? "").trim();
  if (!/^\d{2}:\d{2}(:\d{2})?$/.test(eta)) throw new AppError(400, "BAD_ETA", "Indica a qué hora aproximada llegarás.");
  const etaFull = eta.length === 5 ? `${eta}:00` : eta;

  const shifts = await getShifts();
  const local = getLocalParts(now);
  const shiftId = await getEffectiveShiftId(employee.id, local.date);
  const myShift = shifts.find((s) => s.id === shiftId)!;
  const state = windowState(now, myShift, local.date);
  if (state === "CLOSED") {
    throw new AppError(403, "TOO_LATE", "El aviso de retardo debe enviarse antes del cierre del registro de tu turno.");
  }
  const etaSec = timeToSeconds(etaFull);
  if (etaSec <= timeToSeconds(myShift.openTime) || etaSec >= timeToSeconds(myShift.lateLimit)) {
    throw new AppError(400, "BAD_ETA", `La hora estimada debe estar entre ${myShift.openTime.slice(0, 5)} y ${lastAllowedSecond(myShift.lateLimit).slice(0, 5)}.`);
  }
  const att = await queryOne<{ id: number }>(
    `SELECT id FROM attendance WHERE employee_id = $1 AND operational_date = $2 AND shift_id = $3`, [employee.id, local.date, myShift.id]);
  if (att) throw new AppError(409, "ALREADY_REGISTERED", "Ya registraste tu asistencia hoy.");

  const row = await queryOne<{ created_at: Date }>(
    `INSERT INTO late_notices (employee_id, shift_id, operational_date, eta, reason, created_at)
     VALUES ($1, $2, $3, $4, $5, $6)
     ON CONFLICT ON CONSTRAINT late_notices_unique DO NOTHING RETURNING created_at`,
    [employee.id, myShift.id, local.date, etaFull, reason, now],
  );
  if (!row) throw new AppError(409, "ALREADY_NOTIFIED", "Ya avisaste que llegarás tarde hoy.");
  await logAudit({
    actorType: "EMPLOYEE", actorId: employee.id, actorLabel: employee.fullName, action: "LATE_NOTICE",
    entity: "employee", entityId: employee.id, details: { date: local.date, shift: myShift.code, eta: etaFull, reason }, ip,
  });
  return { eta: etaFull, reason, createdAt: row.created_at.toISOString() };
}

// ---------------------------------------------------------------------
// Extensión del registro (supervisor o líder del área)
// ---------------------------------------------------------------------
export type ExtensionActor =
  | { type: "USER"; user: SessionUser }
  | { type: "LEADER"; employee: SessionEmployee };

export async function grantExtensions(
  employeeIds: number[],
  actor: ExtensionActor,
  ip: string,
  now: Date,
): Promise<{ granted: string[]; skipped: { name: string; reason: string }[]; until: Record<string, string> }> {
  if (!Array.isArray(employeeIds) || employeeIds.length === 0) throw new AppError(400, "EMPTY", "Selecciona al menos a una persona.");
  if (employeeIds.length > 100) throw new AppError(400, "TOO_MANY", "Demasiadas personas a la vez.");
  if (actor.type === "LEADER" && (actor.employee.role !== "LEADER" || actor.employee.departmentId == null)) {
    throw new AppError(403, "FORBIDDEN", "Solo los líderes pueden abrir el registro desde su panel.");
  }
  const shifts = await getShifts();
  const today = getLocalParts(now).date;
  const label = actor.type === "USER" ? actor.user.displayName : `${actor.employee.fullName} (líder)`;

  return withTransaction(async (client) => {
    const granted: string[] = [];
    const skipped: { name: string; reason: string }[] = [];
    const until: Record<string, string> = {};
    for (const rawId of employeeIds) {
      const emp = await queryOne<{ id: number; full_name: string; department_id: number | null; active: boolean }>(
        `SELECT id, full_name, department_id, active FROM employees WHERE id = $1`, [Number(rawId)], client);
      if (!emp || !emp.active) { skipped.push({ name: `#${rawId}`, reason: "no encontrado" }); continue; }
      if (actor.type === "LEADER" && emp.department_id !== actor.employee.departmentId) {
        throw new AppError(403, "FORBIDDEN", "Solo puedes abrir el registro a personas de tu área.");
      }
      const shiftId = await getEffectiveShiftId(emp.id, today, client);
      const sh = shifts.find((s) => s.id === shiftId)!;
      const local = getLocalParts(now);
      if (local.seconds < timeToSeconds(sh.openTime)) { skipped.push({ name: emp.full_name, reason: "su turno aún no abre" }); continue; }
      if (local.seconds >= timeToSeconds(sh.extensionClose)) {
        skipped.push({ name: emp.full_name, reason: `ya pasó la hora límite de extensión (${sh.extensionClose.slice(0, 5)})` });
        continue;
      }
      const att = await queryOne<{ id: number }>(
        `SELECT id FROM attendance WHERE employee_id = $1 AND operational_date = $2`, [emp.id, today], client);
      if (att) { skipped.push({ name: emp.full_name, reason: "ya registró" }); continue; }
      const ins = await queryOne<{ id: number }>(
        `INSERT INTO attendance_extensions (employee_id, shift_id, operational_date, close_time, granted_by_user, granted_by_employee, granted_by_label, created_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
         ON CONFLICT ON CONSTRAINT attendance_extensions_unique DO NOTHING RETURNING id`,
        [emp.id, sh.id, today, sh.extensionClose,
          actor.type === "USER" ? actor.user.id : null, actor.type === "LEADER" ? actor.employee.id : null, label, now],
        client,
      );
      if (!ins) { skipped.push({ name: emp.full_name, reason: "ya tenía extensión" }); continue; }
      granted.push(emp.full_name);
      until[emp.full_name] = sh.extensionClose;
      await logAudit({
        actorType: actor.type === "USER" ? "USER" : "EMPLOYEE",
        actorId: actor.type === "USER" ? actor.user.id : actor.employee.id,
        actorLabel: label, action: "EXTENSION_GRANTED", entity: "employee", entityId: emp.id,
        details: { employee: emp.full_name, date: today, shift: sh.code, until: sh.extensionClose }, ip,
      }, client);
    }
    return { granted, skipped, until };
  });
}

export async function listExtensionsAndNotices(date: string) {
  const ext = await query<{ employee_id: number; shift_id: number; close_time: string; granted_by_label: string }>(
    `SELECT employee_id, shift_id, close_time, granted_by_label FROM attendance_extensions WHERE operational_date = $1`, [date]);
  const late = await query<{ employee_id: number; shift_id: number; eta: string; reason: string }>(
    `SELECT employee_id, shift_id, eta, reason FROM late_notices WHERE operational_date = $1`, [date]);
  return { ext, late };
}
