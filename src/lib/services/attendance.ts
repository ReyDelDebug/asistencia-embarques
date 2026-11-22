import { queryOne } from "../db";
import { AppError } from "../errors";
import {
  addDays, findOpenShift, getLocalParts, lastAllowedSecond, timeToSeconds, windowState, type WindowState,
} from "../time";
import { logAudit } from "./audit";
import type { RequestMeta, SessionEmployee } from "./auth";
import { getShifts, type Shift } from "./catalog";
import { getEffectiveShiftId, getNextChange, type NextChange } from "./rol";

export const CLOSED_MESSAGE = "EL REGISTRO DE ASISTENCIA SE ENCUENTRA CERRADO.";

export interface AttendanceRecord {
  id: number;
  operationalDate: string;
  confirmedAt: string; // ISO
  shiftCode: string;
}

export interface AttendanceView {
  employee: SessionEmployee;
  serverTime: string;
  localDate: string;
  localTime: string;
  shift: { code: string; name: string; openTime: string; closeTime: string; lastAllowed: string };
  operationalDate: string;
  windowState: WindowState;
  openShiftNow: string | null;
  existing: AttendanceRecord | null;
  nextChange: NextChange | null;
}

async function findRecord(employeeId: number, shiftId: number, date: string): Promise<AttendanceRecord | null> {
  const row = await queryOne<{ id: number; operational_date: string; confirmed_at: Date; code: string }>(
    `SELECT a.id, a.operational_date, a.confirmed_at, s.code
     FROM attendance a JOIN shifts s ON s.id = a.shift_id
     WHERE a.employee_id = $1 AND a.shift_id = $2 AND a.operational_date = $3`,
    [employeeId, shiftId, date],
  );
  return row
    ? { id: row.id, operationalDate: row.operational_date, confirmedAt: row.confirmed_at.toISOString(), shiftCode: row.code }
    : null;
}

function shiftInfo(shift: Shift) {
  return {
    code: shift.code,
    name: shift.name,
    openTime: shift.openTime,
    closeTime: shift.closeTime,
    lastAllowed: lastAllowedSecond(shift.closeTime),
  };
}

export async function getAttendanceView(employee: SessionEmployee, now: Date): Promise<AttendanceView> {
  const shifts = await getShifts();
  const local = getLocalParts(now);
  // Turno según el ROL vigente hoy (no un turno fijo).
  const shiftId = await getEffectiveShiftId(employee.id, local.date);
  const shift = shifts.find((s) => s.id === shiftId);
  if (!shift) throw new AppError(500, "SHIFT_NOT_FOUND", "Turno no configurado.");
  const state = windowState(now, shift, local.date);

  let existing = await findRecord(employee.id, shift.id, local.date);
  // Madrugada (antes de que abra el turno de día): mostrar el registro de la noche anterior.
  const dayShift = shifts.find((s) => s.code === "DIA");
  const night = shifts.find((s) => s.code === "NOCHE");
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
    windowState: state,
    openShiftNow: findOpenShift(now, shifts)?.shift.code ?? null,
    existing,
    nextChange: await getNextChange(employee.id, local.date),
  };
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

  const shifts = await getShifts();
  const local = getLocalParts(meta.now);
  const shiftId = await getEffectiveShiftId(emp.id, local.date);
  const shift = shifts.find((s) => s.id === shiftId)!;
  const state = windowState(meta.now, shift, local.date);

  if (state !== "OPEN") {
    await logAudit({
      actorType: "EMPLOYEE", actorId: emp.id, actorLabel: emp.full_name, action: "ATTENDANCE_REJECTED_CLOSED",
      entity: "employee", entityId: emp.id, details: { localTime: local.time, shift: shift.code, state }, ip: meta.ip,
    });
    throw new AppError(403, "REGISTRATION_CLOSED", CLOSED_MESSAGE, {
      windowState: state, shift: shiftInfo(shift), localTime: local.time,
    });
  }

  const inserted = await queryOne<{ id: number; confirmed_at: Date; operational_date: string }>(
    `INSERT INTO attendance (employee_id, shift_id, department_id, role, operational_date, confirmed_at, ip, user_agent, subarea_id)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
     ON CONFLICT ON CONSTRAINT attendance_unique_per_day DO NOTHING
     RETURNING id, confirmed_at, operational_date`,
    [emp.id, shift.id, emp.department_id, emp.role, local.date, meta.now, meta.ip, meta.userAgent.slice(0, 300), emp.subarea_id],
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
    details: { operationalDate: inserted.operational_date, shift: shift.code, localTime: local.time },
    ip: meta.ip,
  });

  return {
    id: inserted.id,
    operationalDate: inserted.operational_date,
    confirmedAt: inserted.confirmed_at.toISOString(),
    shiftCode: shift.code,
    employeeName: emp.full_name,
    departmentName: emp.department_name,
    shiftName: shift.name,
  };
}
