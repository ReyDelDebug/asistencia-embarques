import { query, type Queryable } from "../db";
import type { ShiftCode, ShiftWindowConfig } from "../time";

function addMinutes(t: string, m: number): string {
  const [h, mi] = t.split(":").map(Number);
  const total = Math.min(h * 60 + mi + m, 23 * 60 + 59);
  return `${String(Math.floor(total / 60)).padStart(2, "0")}:${String(total % 60).padStart(2, "0")}:00`;
}

export interface Shift extends ShiftWindowConfig {
  reportTitle: string;
  sortOrder: number;
  extensionClose: string; // hasta cuándo vale una extensión (exclusivo)
  lateLimit: string; // hasta cuándo registra quien avisó retardo (exclusivo)
}

export interface Department {
  id: number;
  code: string;
  name: string;
  reportLabel: string;
  sortOrder: number;
  active: boolean;
}

export interface Subarea {
  id: number;
  departmentId: number;
  code: string;
  name: string;
  reportLabel: string;
  sortOrder: number;
}

export async function getSubareas(client?: Queryable): Promise<Subarea[]> {
  const rows = await query<{ id: number; department_id: number; code: string; name: string; report_label: string; sort_order: number }>(
    "SELECT * FROM subareas ORDER BY sort_order, id", [], client);
  return rows.map((r) => ({
    id: r.id, departmentId: r.department_id, code: r.code, name: r.name, reportLabel: r.report_label, sortOrder: r.sort_order,
  }));
}

export async function getShifts(client?: Queryable): Promise<Shift[]> {
  const rows = await query<{
    id: number; code: ShiftCode; name: string; open_time: string; close_time: string;
    report_title: string; sort_order: number; extension_close: string | null; late_limit: string | null;
  }>("SELECT * FROM shifts ORDER BY sort_order, id", [], client);
  return rows.map((r) => ({
    id: r.id,
    code: r.code,
    name: r.name,
    openTime: r.open_time,
    closeTime: r.close_time,
    reportTitle: r.report_title,
    sortOrder: r.sort_order,
    extensionClose: r.extension_close ?? addMinutes(r.close_time, 10),
    lateLimit: r.late_limit ?? addMinutes(r.close_time, 240),
  }));
}

export async function getDepartments(client?: Queryable): Promise<Department[]> {
  const rows = await query<{
    id: number; code: string; name: string; report_label: string; sort_order: number; active: boolean;
  }>("SELECT * FROM departments ORDER BY sort_order, id", [], client);
  return rows.map((r) => ({
    id: r.id,
    code: r.code,
    name: r.name,
    reportLabel: r.report_label,
    sortOrder: r.sort_order,
    active: r.active,
  }));
}

export async function getShiftByCode(code: string, client?: Queryable): Promise<Shift | null> {
  const shifts = await getShifts(client);
  return shifts.find((s) => s.code === code) ?? null;
}
