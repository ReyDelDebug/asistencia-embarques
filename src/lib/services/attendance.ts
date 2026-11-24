import { queryOne } from "../db";
import { AppError } from "../errors";
import {
  addDays, findOpenShift, getLocalParts, lastAllowedSecond, timeToSeconds, type WindowState,
} from "../time";
import { logAudit } from "./audit";
import type { RequestMeta, SessionEmployee } from "./auth";
import { getShifts, type Shift } from "./catalog";
import { getEffectiveShifts } from "./windows";
import { getProfile } from "./profile";
import { getDaysInfo, type DayInfo } from "./calendar";
import { getEffectiveShiftId, getNextChange, getPlacement, type NextChange } from "./rol";
import { getPhotoVersion } from "./photos";
import { evaluateRegistration, getExtension, getLateNotice, type ExtensionInfo, type LateNoticeInfo, type RegMode } from "./registration";

export const CLOSED_MESSAGE = "EL REGISTRO DE ASISTENCIA SE ENCUENTRA CERRADO.";

export interface AttendanceRecord {
  id: number;
  operationalDate: string;
  confirmedAt: string; // ISO
  shiftCode: string;
  via: RegMode;
}

export interface AttendanceView {
  employee: SessionEmployee;
  serverTime: string;
  localDate: string;
  localTime: string;
  shift: {
    code: string; name: string; openTime: string; closeTime: string; lastAllowed: string;
    extensionClose: string; lateLastAllowed: string;
  };
  operationalDate: string;
  windowState: WindowState; // OPEN también cuando hay extensión o aviso de retardo vigente
  baseWindowState: WindowState; // ventana normal del turno
  registration: { mode: RegMode | null; lastAllowed: string | null };
  extension: ExtensionInfo | null;
  lateNotice: LateNoticeInfo | null;
  canNotifyLate: boolean;
  openShiftNow: string | null;
  existing: AttendanceRecord | null;
  nextChange: NextChange | null;
  photoVersion: string | null;
  profileMissing: string[];
  placement: { departmentName: string | null; subareaName: string | null; support: boolean; until: string | null; homeDepartmentName: string | null };
  day: { type: string; label: string; works: boolean; overtime: boolean; hours: string | null };
  tomorrow: { date: string; type: string; label: string; works: boolean; hours: string | null };
}

async function findRecord(employeeId: number, shiftId: number, date: string): Promise<AttendanceRecord | null> {
  const row = await queryOne<{ id: number; operational_date: string; confirmed_at: Date; code: string; via: RegMode }>(
    `SELECT a.id, a.operational_date, a.confirmed_at, s.code, a.via
     FROM attendance a JOIN shifts s ON s.id = a.shift_id
     WHERE a.employee_id = $1 AND a.shift_id = $2 AND a.operational_date = $3`,
    [employeeId, shiftId, date],
  );
  return row
    ? { id: row.id, operationalDate: row.operational_date, confirmedAt: row.confirmed_at.toISOString(), shiftCode: row.code, via: row.via }
    : null;
}

function shiftInfo(shift: Shift) {
  return {
    code: shift.code,
    name: shift.name,
    openTime: shift.openTime,
    closeTime: shift.closeTime,
    lastAllowed: lastAllowedSecond(shift.closeTime),
    extensionClose: shift.extensionClose,
    lateLastAllowed: lastAllowedSecond(shift.lateLimit),
  };
}

export async function getAttendanceView(employee: SessionEmployee, now: Date): Promise<AttendanceView> {
  const local = getLocalParts(now);
  const shifts = await getEffectiveShifts(local.date);
  // Turno según el ROL vigente hoy (no un turno fijo).
  const shiftId = await getEffectiveShiftId(employee.id, local.date);
  const shift = shifts.find((s) => s.id === shiftId);
  if (!shift) throw new AppError(500, "SHIFT_NOT_FOUND", "Turno no configurado.");
  const extension = await getExtension(employee.id, local.date, shift.id);
  const lateNotice = await getLateNotice(employee.id, local.date, shift.id);
  const reg = evaluateRegistration(now, shift, local.date, { extensionClose: extension?.closeTime, hasLateNotice: !!lateNotice });

  let existing = await findRecord(employee.id, shift.id, local.date);
  // Madrugada (antes de que abra el turno de día): mostrar el registro de la noche anterior.
  const baseShifts = await getShifts(); // horario normal (sin calendario ni cambios manuales)
  const dayShift = baseShifts.find((s) => s.code === "DIA");
  const night = baseShifts.find((s) => s.code === "NOCHE");
  if (!existing && night && dayShift && local.seconds < timeToSeconds(dayShift.openTime)) {
    existing = await findRecord(employee.id, night.id, addDays(local.date, -1));
  }

  return {
    employee,
    serverTime: now.toISOString(),
    localDate: local.date,
    localTime: local.time,
    shift: shiftInfo(shift),
    operationalDate: existing?.operationalDate ?? local.date,
    windowState: reg.open ? "OPEN" : reg.state,
    baseWindowState: reg.state,
    registration: { mode: reg.mode, lastAllowed: reg.lastAllowed },
    extension,
    lateNotice,
    canNotifyLate: !existing && !lateNotice && reg.state !== "CLOSED",
    openShiftNow: findOpenShift(now, shifts)?.shift.code ?? null,
    existing,
    nextChange: await getNextChange(employee.id, local.date),
    photoVersion: await getPhotoVersion(employee.id),
    profileMissing: (await getProfile(employee.id)).missing,
    placement: await placementInfo(employee, local.date),
    ...(await dayInfoFor(shift.code, local.date)),
  };
}

async function placementInfo(employee: SessionEmployee, date: string) {
  const p = await getPlacement(employee.id, date);
  const names = await queryOne<{ dept: string | null; sub: string | null }>(
    `SELECT (SELECT name FROM departments WHERE id = $1) AS dept, (SELECT name FROM subareas WHERE id = $2) AS sub`,
    [p.departmentId, p.subareaId]);
  return {
    departmentName: names?.dept ?? null, subareaName: names?.sub ?? null,
    support: employee.role !== "SUPERVISOR" && p.departmentId !== employee.departmentId,
    until: p.temporary ? p.until : null, homeDepartmentName: employee.departmentName,
  };
}

async function dayInfoFor(shiftCode: string, date: string) {
  const days = await getDaysInfo(date, addDays(date, 1));
  const fmt = (d: DayInfo) => ({ type: d.type, label: d.label, works: d.works, overtime: d.overtime, hours: d.hours?.[shiftCode] ?? null });
  const t = fmt(days[1]);
  return { day: fmt(days[0]), tomorrow: { date: days[1].date, type: t.type, label: t.label, works: t.works, hours: t.hours } };
}

export async function confirmAttendance(employeeId: number, meta: RequestMeta): Promise<AttendanceRecord & {
  employeeName: string; departmentName: string | null; shiftName: string;
}> {
  const emp = await queryOne<{
    id: number; full_name: string; role: string; department_id: number | null; department_name: string | null;
    subarea_id: number | null; active: boolean;
  }>(
    `SELECT e.id, e.full_name, e.role, e.department_id,
            d.name || COALESCE(' · ' || sa.name, '') AS department_name, e.subarea_id, e.active
     FROM employees e LEFT JOIN departments d ON d.id = e.department_id
     LEFT JOIN subareas sa ON sa.id = e.subarea_id WHERE e.id = $1`,
    [employeeId],
  );
  if (!emp || !emp.active) throw new AppError(403, "EMPLOYEE_INACTIVE", "Empleado no activo.");

  const local = getLocalParts(meta.now);
  const shifts = await getEffectiveShifts(local.date);
  const placement = await getPlacement(emp.id, local.date);
  const shift = shifts.find((s) => s.id === placement.shiftId)!;
  const extension = await getExtension(emp.id, local.date, shift.id);
  const lateNotice = await getLateNotice(emp.id, local.date, shift.id);
  const reg = evaluateRegistration(meta.now, shift, local.date, { extensionClose: extension?.closeTime, hasLateNotice: !!lateNotice });
  const state = reg.state;

  if (!reg.open) {
    await logAudit({
      actorType: "EMPLOYEE", actorId: emp.id, actorLabel: emp.full_name, action: "ATTENDANCE_REJECTED_CLOSED",
      entity: "employee", entityId: emp.id, details: { localTime: local.time, shift: shift.code, state }, ip: meta.ip,
    });
    throw new AppError(403, "REGISTRATION_CLOSED", CLOSED_MESSAGE, {
      windowState: state, shift: shiftInfo(shift), localTime: local.time,
    });
  }

  const inserted = await queryOne<{ id: number; confirmed_at: Date; operational_date: string }>(
    `INSERT INTO attendance (employee_id, shift_id, department_id, role, operational_date, confirmed_at, ip, user_agent, subarea_id, via)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
     ON CONFLICT ON CONSTRAINT attendance_unique_per_day DO NOTHING
     RETURNING id, confirmed_at, operational_date`,
    [emp.id, shift.id, placement.departmentId, emp.role, local.date, meta.now, meta.ip, meta.userAgent.slice(0, 300), placement.subareaId, reg.mode],
  );

  if (!inserted) {
    const existing = await findRecord(emp.id, shift.id, local.date);
    await logAudit({
      actorType: "EMPLOYEE", actorId: emp.id, actorLabel: emp.full_name, action: "ATTENDANCE_DUPLICATE_BLOCKED",
      entity: "attendance", entityId: existing?.id ?? null, ip: meta.ip,
    });
    throw new AppError(409, "ALREADY_REGISTERED", "Ya registraste tu asistencia para este turno.", { existing });
  }

  await logAudit({
    actorType: "EMPLOYEE", actorId: emp.id, actorLabel: emp.full_name, action: "ATTENDANCE_CONFIRMED",
    entity: "attendance", entityId: inserted.id,
    details: { operationalDate: inserted.operational_date, shift: shift.code, localTime: local.time, via: reg.mode },
    ip: meta.ip,
  });

  return {
    id: inserted.id,
    operationalDate: inserted.operational_date,
    confirmedAt: inserted.confirmed_at.toISOString(),
    shiftCode: shift.code,
    via: reg.mode!,
    employeeName: emp.full_name,
    departmentName: emp.department_name,
    shiftName: shift.name,
  };
}
