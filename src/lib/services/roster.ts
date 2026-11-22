import { query } from "../db";
import { getLocalParts, windowState } from "../time";
import { getDepartments, getShifts, getSubareas, type Department, type Shift, type Subarea } from "./catalog";

export const STATUSES = [
  "CONFIRMADO", "PENDIENTE", "FALTA", "VACACIONES", "INCAPACIDAD", "PSG", "BAJA",
] as const;
export type AttendanceStatus = (typeof STATUSES)[number];

export const INCIDENT_TYPES = ["FALTA", "VACACIONES", "INCAPACIDAD", "PSG", "BAJA"] as const;
export type IncidentType = (typeof INCIDENT_TYPES)[number];

export const STATUS_LABELS: Record<AttendanceStatus, string> = {
  CONFIRMADO: "Confirmado",
  PENDIENTE: "Pendiente",
  FALTA: "Falta",
  VACACIONES: "Vacaciones",
  INCAPACIDAD: "Incapacidad",
  PSG: "PSG",
  BAJA: "Baja",
};

export const ROLE_LABELS: Record<string, string> = {
  EMPLOYEE: "Empleado",
  LEADER: "Líder",
  SUPERVISOR: "Supervisor",
};

export interface RosterRow {
  employeeId: number;
  employeeNumber: string;
  fullName: string;
  role: "EMPLOYEE" | "LEADER" | "SUPERVISOR";
  active: boolean;
  date: string;
  shiftId: number;
  shiftCode: string;
  shiftName: string;
  departmentId: number | null;
  departmentName: string; // incluye la subárea, ej. "Central · PT"
  subareaId: number | null;
  attendanceId: number | null;
  confirmedAt: string | null; // ISO
  status: AttendanceStatus;
  automatic: boolean; // estado calculado automáticamente (falta sin registro)
  incidentId: number | null;
  incidentReason: string | null;
  incidentBy: string | null;
  incidentAt: string | null;
  observations: string;
}

interface RawRow {
  id: number;
  employee_number: string;
  full_name: string;
  role: RosterRow["role"];
  active: boolean;
  terminated_at: string | null;
  shift_id: number;
  department_id: number | null;
  subarea_id: number | null;
  att_id: number | null;
  confirmed_at: Date | null;
  inc_id: number | null;
  inc_type: IncidentType | null;
  inc_reason: string | null;
  inc_at: Date | null;
  inc_by: string | null;
}

export interface RosterFilter {
  date: string;
  shiftId?: number | null;
  departmentId?: number | null;
  status?: AttendanceStatus | null;
}

export interface Catalog {
  shifts: Shift[];
  departments: Department[];
  subareas: Subarea[];
}

export async function loadCatalog(): Promise<Catalog> {
  const [shifts, departments, subareas] = await Promise.all([getShifts(), getDepartments(), getSubareas()]);
  return { shifts, departments, subareas };
}

export async function getRoster(filter: RosterFilter, now: Date, catalog?: Catalog): Promise<RosterRow[]> {
  const { shifts, departments, subareas } = catalog ?? (await loadCatalog());
  const rows = await query<RawRow>(
    `WITH base AS (
       SELECT e.id FROM employees e
        WHERE e.active OR (e.terminated_at IS NOT NULL AND e.terminated_at >= $1)
       UNION
       SELECT employee_id FROM attendance WHERE operational_date = $1
       UNION
       SELECT employee_id FROM incidents WHERE operational_date = $1 AND revoked_at IS NULL
     )
     SELECT e.id, e.employee_number, e.full_name,
            COALESCE(a.role, e.role) AS role, e.active, e.terminated_at,
            COALESCE(a.shift_id, i.shift_id, employee_shift_on(e.id, $1)) AS shift_id,
            CASE WHEN a.id IS NOT NULL THEN a.department_id ELSE e.department_id END AS department_id,
            CASE WHEN a.id IS NOT NULL THEN a.subarea_id ELSE e.subarea_id END AS subarea_id,
            a.id AS att_id, a.confirmed_at,
            i.id AS inc_id, i.type AS inc_type, i.reason AS inc_reason, i.created_at AS inc_at,
            u.display_name AS inc_by
     FROM base b
     JOIN employees e ON e.id = b.id
     LEFT JOIN LATERAL (
       SELECT * FROM attendance a WHERE a.employee_id = e.id AND a.operational_date = $1
       ORDER BY a.confirmed_at LIMIT 1
     ) a ON TRUE
     LEFT JOIN LATERAL (
       SELECT * FROM incidents i WHERE i.employee_id = e.id AND i.operational_date = $1 AND i.revoked_at IS NULL
       ORDER BY i.created_at DESC LIMIT 1
     ) i ON TRUE
     LEFT JOIN users u ON u.id = i.created_by`,
    [filter.date],
  );

  const shiftById = new Map(shifts.map((s) => [s.id, s]));
  const deptById = new Map(departments.map((d) => [d.id, d]));
  const subById = new Map(subareas.map((x) => [x.id, x]));
  const today = getLocalParts(now).date;

  const result: RosterRow[] = rows.map((r) => {
    const shift = shiftById.get(r.shift_id)!;
    const dept = r.department_id != null ? deptById.get(r.department_id) : undefined;
    const sub = r.subarea_id != null ? subById.get(r.subarea_id) : undefined;
    let status: AttendanceStatus;
    let automatic = false;
    let observations = "";

    if (r.att_id) {
      status = "CONFIRMADO";
      if (r.inc_id) observations = `Tenía incidencia ${r.inc_type} registrada: ${r.inc_reason}`;
    } else if (r.inc_type) {
      status = r.inc_type;
      observations = r.inc_reason ?? "";
    } else if (!r.active && r.terminated_at && r.terminated_at <= filter.date) {
      status = "BAJA";
      automatic = true;
      observations = `Baja desde ${r.terminated_at}`;
    } else {
      const state = filter.date > today ? "BEFORE" : windowState(now, shift, filter.date);
      if (state === "CLOSED") {
        status = "FALTA";
        automatic = true;
        observations = "Sin registro de asistencia";
      } else {
        status = "PENDIENTE";
      }
    }

    return {
      employeeId: r.id,
      employeeNumber: r.employee_number,
      fullName: r.full_name,
      role: r.role,
      active: r.active,
      date: filter.date,
      shiftId: shift.id,
      shiftCode: shift.code,
      shiftName: shift.name,
      departmentId: dept?.id ?? null,
      departmentName: dept ? `${dept.name}${sub ? ` · ${sub.name}` : ""}` : (r.role === "SUPERVISOR" ? "Supervisión" : "Sin área"),
      subareaId: sub?.id ?? null,
      attendanceId: r.att_id,
      confirmedAt: r.confirmed_at ? r.confirmed_at.toISOString() : null,
      status,
      automatic,
      incidentId: r.inc_id,
      incidentReason: r.inc_reason,
      incidentBy: r.inc_by,
      incidentAt: r.inc_at ? r.inc_at.toISOString() : null,
      observations,
    };
  });

  const roleOrder: Record<string, number> = { SUPERVISOR: 0, LEADER: 1, EMPLOYEE: 2 };
  const filtered = result.filter(
    (r) =>
      (filter.shiftId == null || r.shiftId === filter.shiftId) &&
      (filter.departmentId == null || r.departmentId === filter.departmentId) &&
      (filter.status == null || r.status === filter.status),
  );
  filtered.sort((a, b) => {
    const sa = shiftById.get(a.shiftId)!.sortOrder - shiftById.get(b.shiftId)!.sortOrder;
    if (sa) return sa;
    const da = (a.departmentId ? deptById.get(a.departmentId)!.sortOrder : -1)
      - (b.departmentId ? deptById.get(b.departmentId)!.sortOrder : -1);
    if (da) return da;
    const sbo = (a.subareaId ? subById.get(a.subareaId)!.sortOrder : 0) - (b.subareaId ? subById.get(b.subareaId)!.sortOrder : 0);
    if (sbo) return sbo;
    const ra = roleOrder[a.role] - roleOrder[b.role];
    if (ra) return ra;
    return a.fullName.localeCompare(b.fullName, "es");
  });
  return filtered;
}

export interface GroupStat {
  key: string;
  label: string;
  total: number;
  confirmed: number;
}

export interface RosterStats {
  total: number;
  confirmed: number;
  pending: number;
  falta: number;
  vacaciones: number;
  incapacidad: number;
  psg: number;
  baja: number;
  percentage: number;
  byDepartment: GroupStat[];
  byShift: GroupStat[];
}

export function computeStats(rows: RosterRow[]): RosterStats {
  const count = (s: AttendanceStatus) => rows.filter((r) => r.status === s).length;
  const active = rows.filter((r) => r.status !== "BAJA");
  const confirmed = count("CONFIRMADO");

  const group = (keyFn: (r: RosterRow) => string, labelFn: (r: RosterRow) => string): GroupStat[] => {
    const map = new Map<string, GroupStat>();
    for (const r of active) {
      const key = keyFn(r);
      const g = map.get(key) ?? { key, label: labelFn(r), total: 0, confirmed: 0 };
      g.total++;
      if (r.status === "CONFIRMADO") g.confirmed++;
      map.set(key, g);
    }
    return [...map.values()];
  };

  return {
    total: active.length,
    confirmed,
    pending: count("PENDIENTE"),
    falta: count("FALTA"),
    vacaciones: count("VACACIONES"),
    incapacidad: count("INCAPACIDAD"),
    psg: count("PSG"),
    baja: count("BAJA"),
    percentage: active.length ? Math.round((confirmed / active.length) * 1000) / 10 : 0,
    byDepartment: group(
      (r) => `${r.shiftCode}-${r.departmentId ?? "SUP"}-${r.subareaId ?? ""}`,
      (r) => `${r.departmentName} · ${r.shiftName}`,
    ),
    byShift: group((r) => r.shiftCode, (r) => r.shiftName),
  };
}
