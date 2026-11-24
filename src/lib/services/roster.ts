import { query } from "../db";
import { getLocalParts, timeToSeconds, windowState } from "../time";
import { getDepartments, getShifts, getSubareas, type Department, type Shift, type Subarea } from "./catalog";
import { shiftsForDate } from "./windows";

export const STATUSES = [
  "CONFIRMADO", "PENDIENTE", "RETARDO", "FALTA", "DESCANSO", "VACACIONES", "INCAPACIDAD", "PSG", "BAJA",
] as const;
export type AttendanceStatus = (typeof STATUSES)[number];

export const INCIDENT_TYPES = ["FALTA", "VACACIONES", "INCAPACIDAD", "PSG", "BAJA"] as const;
export type IncidentType = (typeof INCIDENT_TYPES)[number];

export const STATUS_LABELS: Record<AttendanceStatus, string> = {
  CONFIRMADO: "Confirmado",
  PENDIENTE: "Pendiente",
  RETARDO: "Avisó retardo",
  FALTA: "Falta",
  DESCANSO: "Descanso",
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
  via: "NORMAL" | "EXTENSION" | "LATE_NOTICE" | null; // cómo registró
  late: boolean; // registró después del cierre normal (extensión o aviso de retardo)
  lateEta: string | null; // hora estimada del aviso "Llegaré tarde"
  lateReason: string | null;
  extensionUntil: string | null; // extensión vigente/otorgada (hora de cierre)
  extensionBy: string | null;
  canExtend: boolean; // se le puede abrir el registro en este momento
  support: boolean; // está apoyando en un área distinta a la suya
  homeDepartmentName: string | null;
  supportUntil: string | null;
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
  home_department_id: number | null;
  support_until: string | null;
  att_id: number | null;
  confirmed_at: Date | null;
  inc_id: number | null;
  inc_type: IncidentType | null;
  inc_reason: string | null;
  inc_at: Date | null;
  inc_by: string | null;
  via: RosterRow["via"];
  late_eta: string | null;
  late_reason: string | null;
  ext_close: string | null;
  ext_by: string | null;
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
            COALESCE(a.shift_id, i.shift_id, pl.shift_id) AS shift_id,
            CASE WHEN a.id IS NOT NULL THEN a.department_id ELSE pl.department_id END AS department_id,
            CASE WHEN a.id IS NOT NULL THEN a.subarea_id ELSE pl.subarea_id END AS subarea_id,
            e.department_id AS home_department_id, pl.until_date AS support_until,
            a.id AS att_id, a.confirmed_at,
            i.id AS inc_id, i.type AS inc_type, i.reason AS inc_reason, i.created_at AS inc_at,
            u.display_name AS inc_by, a.via,
            ln.eta AS late_eta, ln.reason AS late_reason, ex.close_time AS ext_close, ex.granted_by_label AS ext_by
     FROM base b
     JOIN employees e ON e.id = b.id
     CROSS JOIN LATERAL employee_placement_on(e.id, $1) pl
     LEFT JOIN LATERAL (
       SELECT * FROM attendance a WHERE a.employee_id = e.id AND a.operational_date = $1
       ORDER BY a.confirmed_at LIMIT 1
     ) a ON TRUE
     LEFT JOIN LATERAL (
       SELECT * FROM incidents i WHERE i.employee_id = e.id AND i.operational_date = $1 AND i.revoked_at IS NULL
       ORDER BY i.created_at DESC LIMIT 1
     ) i ON TRUE
     LEFT JOIN users u ON u.id = i.created_by
     LEFT JOIN late_notices ln ON ln.employee_id = e.id AND ln.operational_date = $1
     LEFT JOIN attendance_extensions ex ON ex.employee_id = e.id AND ex.operational_date = $1 AND ex.revoked_at IS NULL`,
    [filter.date],
  );

  const { shifts: effShifts, day } = await shiftsForDate(filter.date, shifts);
  const shiftById = new Map(effShifts.map((s) => [s.id, s]));
  const deptById = new Map(departments.map((d) => [d.id, d]));
  const subById = new Map(subareas.map((x) => [x.id, x]));
  const local = getLocalParts(now);
  const today = local.date;

  const result: RosterRow[] = rows.map((r) => {
    const shift = shiftById.get(r.shift_id)!;
    const dept = r.department_id != null ? deptById.get(r.department_id) : undefined;
    const sub = r.subarea_id != null ? subById.get(r.subarea_id) : undefined;
    let status: AttendanceStatus;
    let automatic = false;
    let observations = "";

    const home = r.home_department_id != null ? deptById.get(r.home_department_id) : undefined;
    const support = r.role !== "SUPERVISOR" && r.department_id != null && r.department_id !== r.home_department_id;
    const supportNote = support ? `Apoyo en ${dept?.name ?? "otra área"}${home ? ` (de ${home.name})` : ""}` : "";
    const lateNote = r.late_eta ? `Avisó retardo (llega ~${r.late_eta.slice(0, 5)}): ${r.late_reason}` : "";
    const extNote = r.ext_close ? `Registro abierto por ${r.ext_by}` : "";

    if (r.att_id) {
      status = "CONFIRMADO";
      observations = [
        r.via === "LATE_NOTICE" ? `Llegó tarde. ${lateNote}` : r.via === "EXTENSION" ? `Registró tarde (registro abierto por ${r.ext_by ?? "supervisor"})` : "",
        r.inc_id ? `Tenía incidencia ${r.inc_type} registrada: ${r.inc_reason}` : "",
      ].filter(Boolean).join(" · ");
    } else if (r.inc_type) {
      status = r.inc_type;
      observations = r.inc_reason ?? "";
    } else if (!r.active && r.terminated_at && r.terminated_at <= filter.date) {
      status = "BAJA";
      automatic = true;
      observations = `Baja desde ${r.terminated_at}`;
    } else {
      const state = filter.date > today ? "BEFORE" : windowState(now, shift, filter.date);
      const isToday = filter.date === today;
      if (filter.date > today && !day.works) {
        status = "DESCANSO";
        automatic = true;
        observations = `Día no laborable${day.label ? ` (${day.label})` : ""}`;
      } else if (state !== "CLOSED") {
        status = r.late_eta ? "RETARDO" : "PENDIENTE";
        observations = lateNote || extNote;
      } else if (r.late_eta && isToday && local.seconds < timeToSeconds(shift.lateLimit)) {
        status = "RETARDO"; // avisó y aún puede llegar a registrar
        observations = lateNote;
      } else if (r.ext_close && isToday && local.seconds < timeToSeconds(r.ext_close)) {
        status = "PENDIENTE"; // tiene extensión vigente
        observations = extNote;
      } else if (!day.works || day.overtime) {
        // Día no laborable, o viernes de tiempo extra: quien no llega queda en descanso (no es falta)
        status = "DESCANSO";
        automatic = true;
        observations = !day.works ? `Día no laborable${day.label ? ` (${day.label})` : ""}` : "No asistió al tiempo extra del viernes";
      } else {
        status = "FALTA";
        automatic = true;
        observations = [r.late_eta ? `${lateNote}. No registró` : "Sin registro de asistencia", extNote].filter(Boolean).join(" · ");
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
      observations: [supportNote, observations].filter(Boolean).join(" · "),
      via: r.via,
      late: r.via === "EXTENSION" || r.via === "LATE_NOTICE",
      lateEta: r.late_eta,
      lateReason: r.late_reason,
      extensionUntil: r.ext_close,
      extensionBy: r.ext_by,
      canExtend: !r.att_id && !r.inc_id && r.active && !r.ext_close && (status === "FALTA" || status === "DESCANSO")
        && filter.date === today && local.seconds >= timeToSeconds(shift.openTime),
      support,
      homeDepartmentName: home?.name ?? null,
      supportUntil: support ? r.support_until : null,
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
  retardo: number; // avisaron retardo y aún no llegan
  lateArrivals: number; // registraron tarde (extensión o aviso)
  falta: number;
  descanso: number;
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
    retardo: count("RETARDO"),
    lateArrivals: rows.filter((r) => r.status === "CONFIRMADO" && r.late).length,
    falta: count("FALTA"),
    descanso: count("DESCANSO"),
    vacaciones: count("VACACIONES"),
    incapacidad: count("INCAPACIDAD"),
    psg: count("PSG"),
    baja: count("BAJA"),
    percentage: active.length - count("DESCANSO") > 0
      ? Math.round((confirmed / (active.length - count("DESCANSO"))) * 1000) / 10 : 0,
    byDepartment: group(
      (r) => `${r.shiftCode}-${r.departmentId ?? "SUP"}-${r.subareaId ?? ""}`,
      (r) => `${r.departmentName} · ${r.shiftName}`,
    ),
    byShift: group((r) => r.shiftCode, (r) => r.shiftName),
  };
}
