/**
 * "Mi grupo": cada empleado ve únicamente a los compañeros de SU área
 * (Central —incluida PT—, RC o Lavadoras). Los líderes además ven quién ha
 * registrado asistencia en su área (sin motivos ni datos administrativos).
 */
import { query } from "../db";
import { AppError } from "../errors";
import { currentOperationalContext, getLocalParts } from "../time";
import type { SessionEmployee } from "./auth";
import { getRoster, loadCatalog, type AttendanceStatus } from "./roster";
import { getEffectiveShiftId, getPlacement } from "./rol";

export interface GroupMember {
  employeeId: number;
  fullName: string;
  role: "EMPLOYEE" | "LEADER";
  subareaName: string | null;
  shiftName: string; // turno vigente hoy según el rol
  photoVersion: string | null;
  isMe: boolean;
}

export interface LeaderAttendanceRow {
  employeeId: number;
  fullName: string;
  role: string;
  subareaName: string | null;
  status: AttendanceStatus;
  confirmedAt: string | null;
  photoVersion: string | null;
  late: boolean;
  lateEta: string | null;
  lateReason: string | null; // el líder sí ve el motivo del aviso de retardo
  extensionUntil: string | null;
  canExtend: boolean;
  support: boolean;
  homeDepartmentName: string | null;
}

export interface MyGroup {
  departmentName: string | null;
  members: GroupMember[];
  isLeader: boolean;
  leaderView: null | {
    date: string;
    shiftCode: string;
    shiftName: string;
    extensionClose: string;
    confirmed: number;
    total: number;
    rows: LeaderAttendanceRow[];
  };
}

export async function getMyGroup(me: SessionEmployee, now: Date, shiftCodeParam?: string | null): Promise<MyGroup> {
  const today = getLocalParts(now).date;
  // El área que cuenta es la VIGENTE hoy (si está en apoyo en otra área, ve a esa área)
  const myPlacement = await getPlacement(me.id, today);
  const myDept = myPlacement.departmentId;
  if (myDept == null) {
    return { departmentName: null, members: [], isLeader: false, leaderView: null };
  }
  const deptName = (await query<{ name: string }>(`SELECT name FROM departments WHERE id = $1`, [myDept]))[0]?.name ?? null;
  const members = await query<{
    id: number; full_name: string; role: "EMPLOYEE" | "LEADER"; subarea_name: string | null; shift_name: string; photo_at: Date | null;
  }>(
    `SELECT e.id, e.full_name, e.role, sa.name AS subarea_name, s.name AS shift_name, p.updated_at AS photo_at
     FROM employees e
     CROSS JOIN LATERAL employee_placement_on(e.id, $2) pl
     LEFT JOIN subareas sa ON sa.id = pl.subarea_id
     JOIN shifts s ON s.id = pl.shift_id
     LEFT JOIN employee_photos p ON p.employee_id = e.id
     WHERE e.active AND e.role <> 'SUPERVISOR' AND pl.department_id = $1
     ORDER BY CASE e.role WHEN 'LEADER' THEN 0 ELSE 1 END, sa.sort_order NULLS FIRST, e.full_name`,
    [myDept, today],
  );

  const isLeader = me.role === "LEADER";
  let leaderView: MyGroup["leaderView"] = null;
  if (isLeader) {
    const catalog = await loadCatalog();
    const ctx = currentOperationalContext(now, catalog.shifts);
    // Por defecto, el turno que el propio líder tiene asignado hoy.
    const ownShiftId = await getEffectiveShiftId(me.id, today);
    const shift = shiftCodeParam
      ? catalog.shifts.find((s) => s.code === shiftCodeParam)
      : catalog.shifts.find((s) => s.id === ownShiftId);
    if (!shift) throw new AppError(400, "BAD_SHIFT", "Turno no válido.");
    // Fecha: la del contexto operativo si coincide el turno (ej. madrugada = noche anterior); si no, hoy.
    const date = shift.code === ctx.shiftCode ? ctx.date : today;
    const photoBy = new Map(members.map((m) => [m.id, m.photo_at ? String(m.photo_at.getTime()) : null]));
    const roster = await getRoster({ date, shiftId: shift.id, departmentId: myDept }, now, catalog);
    const rows = roster
      .filter((r) => r.role !== "SUPERVISOR")
      .map((r) => ({
        employeeId: r.employeeId,
        fullName: r.fullName,
        role: r.role,
        subareaName: r.subareaId ? catalog.subareas.find((x) => x.id === r.subareaId)?.name ?? null : null,
        status: r.status,
        confirmedAt: r.confirmedAt,
        photoVersion: photoBy.get(r.employeeId) ?? null,
        late: r.late,
        lateEta: r.lateEta,
        lateReason: r.lateReason,
        extensionUntil: r.extensionUntil,
        canExtend: r.canExtend && r.employeeId !== me.id,
        support: r.support,
        homeDepartmentName: r.homeDepartmentName,
      }));
    leaderView = {
      date,
      shiftCode: shift.code,
      shiftName: shift.name,
      extensionClose: shift.extensionClose,
      confirmed: rows.filter((r) => r.status === "CONFIRMADO").length,
      total: rows.filter((r) => r.status !== "BAJA").length,
      rows,
    };
  }

  return {
    departmentName: deptName,
    members: members.map((m) => ({
      employeeId: m.id,
      fullName: m.full_name,
      role: m.role,
      subareaName: m.subarea_name,
      shiftName: m.shift_name,
      photoVersion: m.photo_at ? String(m.photo_at.getTime()) : null,
      isMe: m.id === me.id,
    })),
    isLeader,
    leaderView,
  };
}
