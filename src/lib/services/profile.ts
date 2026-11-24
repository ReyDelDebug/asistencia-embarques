/**
 * Perfil del trabajador (nombre completo, teléfono, nacimiento, botas, chaleco),
 * saldo de vacaciones y ficha del empleado para el supervisor.
 */
import { query, queryOne } from "../db";
import { AppError } from "../errors";
import { addDays, daysBetween, getLocalParts, isValidDateString } from "../time";
import { logAudit } from "./audit";
import type { SessionEmployee, SessionUser } from "./auth";
import { getRoster } from "./roster";
import { mondayOf } from "./rol";
import { getDaysInfo } from "./calendar";

export const VEST_SIZES = ["CHICO", "MEDIANO", "GRANDE"] as const;
/** Solo letras (incluye acentos, ñ y ü) y espacios; mínimo nombre y apellido. */
export const FULL_NAME_RE = /^[A-Za-zÁÉÍÓÚÜÑáéíóúüñ]+(?: [A-Za-zÁÉÍÓÚÜÑáéíóúüñ]+)+$/;

export function normalizeName(raw: string): string {
  return String(raw ?? "").trim().replace(/\s+/g, " ");
}

export function validateFullName(raw: string): string {
  const name = normalizeName(raw);
  if (!name) throw new AppError(400, "NAME_REQUIRED", "El nombre completo es obligatorio.");
  if (name.length > 80) throw new AppError(400, "BAD_NAME", "El nombre es demasiado largo.");
  if (!FULL_NAME_RE.test(name)) {
    throw new AppError(400, "BAD_NAME",
      "Escribe tu nombre completo (nombre y apellidos) solo con letras. Se permiten acentos y ñ; no números ni símbolos.");
  }
  return name;
}

export interface ProfileData {
  fullName: string;
  phone: string | null;
  birthDate: string | null;
  bootSize: number | null;
  vestSize: (typeof VEST_SIZES)[number] | null;
  complete: boolean;
  missing: string[];
}

function missingFields(r: { full_name: string; phone: string | null; birth_date: string | null; boot_size: string | null; vest_size: string | null }) {
  const m: string[] = [];
  if (!FULL_NAME_RE.test(r.full_name)) m.push("nombre completo");
  if (!r.phone) m.push("teléfono");
  if (!r.birth_date) m.push("fecha de nacimiento");
  if (r.boot_size == null) m.push("número de botas");
  if (!r.vest_size) m.push("talla de chaleco");
  return m;
}

export async function getProfile(employeeId: number): Promise<ProfileData> {
  const r = await queryOne<{ full_name: string; phone: string | null; birth_date: string | null; boot_size: string | null; vest_size: ProfileData["vestSize"] }>(
    `SELECT full_name, phone, birth_date, boot_size::text, vest_size FROM employees WHERE id = $1`, [employeeId]);
  if (!r) throw new AppError(404, "NOT_FOUND", "Empleado no encontrado.");
  const missing = missingFields(r);
  return {
    fullName: r.full_name, phone: r.phone, birthDate: r.birth_date,
    bootSize: r.boot_size != null ? Number(r.boot_size) : null, vestSize: r.vest_size,
    complete: missing.length === 0, missing,
  };
}

interface ProfileInput { fullName: string; phone: string; birthDate: string; bootSize: number | string; vestSize: string }

function validateProfile(input: ProfileInput, now: Date) {
  const fullName = validateFullName(input.fullName);
  const phone = String(input.phone ?? "").replace(/\D/g, "");
  if (!/^\d{10}$/.test(phone)) throw new AppError(400, "BAD_PHONE", "El teléfono debe tener 10 dígitos.");
  const birthDate = String(input.birthDate ?? "");
  if (!isValidDateString(birthDate)) throw new AppError(400, "BAD_BIRTH", "Fecha de nacimiento no válida.");
  const age = daysBetween(birthDate, getLocalParts(now).date) / 365.25;
  if (age < 16 || age > 85) throw new AppError(400, "BAD_BIRTH", "Revisa la fecha de nacimiento.");
  const bootSize = Number(input.bootSize);
  if (!Number.isFinite(bootSize) || bootSize < 15 || bootSize > 40 || Math.round(bootSize * 2) !== bootSize * 2) {
    throw new AppError(400, "BAD_BOOT", "Número de botas no válido (ej. 26 o 26.5).");
  }
  const vestSize = String(input.vestSize ?? "").toUpperCase();
  if (!(VEST_SIZES as readonly string[]).includes(vestSize)) throw new AppError(400, "BAD_VEST", "Elige la talla de chaleco.");
  return { fullName, phone, birthDate, bootSize, vestSize };
}

export async function updateMyProfile(employee: SessionEmployee, input: ProfileInput, ip: string, now: Date): Promise<ProfileData> {
  const v = validateProfile(input, now);
  const before = await getProfile(employee.id);
  await query(
    `UPDATE employees SET full_name = $2, phone = $3, birth_date = $4, boot_size = $5, vest_size = $6, updated_at = now() WHERE id = $1`,
    [employee.id, v.fullName, v.phone, v.birthDate, v.bootSize, v.vestSize],
  );
  await logAudit({
    actorType: "EMPLOYEE", actorId: employee.id, actorLabel: v.fullName, action: "PROFILE_UPDATED",
    entity: "employee", entityId: employee.id,
    details: { nameChanged: before.fullName !== v.fullName ? { antes: before.fullName, despues: v.fullName } : null }, ip,
  });
  return getProfile(employee.id);
}

/** El supervisor corrige datos del perfil y captura los días de vacaciones. Todos opcionales. */
export async function updateEmployeeDetailsByAdmin(
  id: number,
  input: Partial<ProfileInput> & { vacationDays?: number | string | null; vacationPeriodStart?: string | null },
  user: SessionUser,
  ip: string,
  now: Date,
): Promise<void> {
  const sets: string[] = [];
  const params: unknown[] = [id];
  const add = (col: string, val: unknown) => { params.push(val); sets.push(`${col} = $${params.length}`); };
  if (input.phone !== undefined) {
    const phone = String(input.phone ?? "").replace(/\D/g, "");
    if (phone && !/^\d{10}$/.test(phone)) throw new AppError(400, "BAD_PHONE", "El teléfono debe tener 10 dígitos.");
    add("phone", phone || null);
  }
  if (input.birthDate !== undefined) {
    const b = String(input.birthDate ?? "");
    if (b && !isValidDateString(b)) throw new AppError(400, "BAD_BIRTH", "Fecha de nacimiento no válida.");
    if (b) {
      const age = daysBetween(b, getLocalParts(now).date) / 365.25;
      if (age < 16 || age > 85) throw new AppError(400, "BAD_BIRTH", "Revisa la fecha de nacimiento.");
    }
    add("birth_date", b || null);
  }
  if (input.bootSize !== undefined) {
    const raw = input.bootSize;
    if (raw === "" || raw == null) add("boot_size", null);
    else {
      const n = Number(raw);
      if (!Number.isFinite(n) || n < 15 || n > 40 || Math.round(n * 2) !== n * 2) throw new AppError(400, "BAD_BOOT", "Número de botas no válido.");
      add("boot_size", n);
    }
  }
  if (input.vestSize !== undefined) {
    const v = String(input.vestSize ?? "").toUpperCase();
    if (v && !(VEST_SIZES as readonly string[]).includes(v)) throw new AppError(400, "BAD_VEST", "Talla de chaleco no válida.");
    add("vest_size", v || null);
  }
  if (input.vacationDays !== undefined) {
    const raw = input.vacationDays;
    if (raw === "" || raw == null) add("vacation_days", null);
    else {
      const n = Number(raw);
      if (!Number.isInteger(n) || n < 0 || n > 90) throw new AppError(400, "BAD_VACATION", "Días de vacaciones no válidos (0 a 90).");
      add("vacation_days", n);
    }
  }
  if (input.vacationPeriodStart !== undefined) {
    const d = String(input.vacationPeriodStart ?? "");
    if (d && !isValidDateString(d)) throw new AppError(400, "BAD_DATE", "Fecha de inicio del periodo no válida.");
    add("vacation_period_start", d || null);
  }
  if (!sets.length) return;
  const row = await queryOne<{ id: number }>(`UPDATE employees SET ${sets.join(", ")}, updated_at = now() WHERE id = $1 RETURNING id`, params);
  if (!row) throw new AppError(404, "NOT_FOUND", "Empleado no encontrado.");
  await logAudit({
    actorType: "USER", actorId: user.id, actorLabel: user.displayName, action: "EMPLOYEE_DETAILS_UPDATED",
    entity: "employee", entityId: id,
    details: { phone: input.phone, birthDate: input.birthDate, bootSize: input.bootSize, vestSize: input.vestSize, vacationDays: input.vacationDays, vacationPeriodStart: input.vacationPeriodStart },
    ip,
  });
}

// ---------------------------------------------------------------------
// Vacaciones
// ---------------------------------------------------------------------
export interface VacationSummary {
  assigned: number | null; // null = el supervisor aún no los captura
  periodStart: string;
  used: number; // días de vacaciones ya registrados (aprobados) en el periodo
  pending: number; // días en solicitudes pendientes
  available: number | null; // asignados − usados
  requestable: number | null; // disponibles − pendientes
}

export async function getVacationSummary(employeeId: number, now: Date): Promise<VacationSummary> {
  const r = await queryOne<{ vacation_days: number | null; vacation_period_start: string | null }>(
    `SELECT vacation_days, vacation_period_start FROM employees WHERE id = $1`, [employeeId]);
  if (!r) throw new AppError(404, "NOT_FOUND", "Empleado no encontrado.");
  const periodStart = r.vacation_period_start ?? `${getLocalParts(now).date.slice(0, 4)}-01-01`;
  const used = await queryOne<{ n: number }>(
    `SELECT count(DISTINCT operational_date)::int n FROM incidents
     WHERE employee_id = $1 AND type = 'VACACIONES' AND revoked_at IS NULL AND operational_date >= $2`, [employeeId, periodStart]);
  const pendingReqs = await query<{ start_date: string; end_date: string }>(
    `SELECT start_date, end_date FROM leave_requests
     WHERE employee_id = $1 AND type = 'VACACIONES' AND status = 'PENDIENTE' AND end_date >= $2`, [employeeId, periodStart]);
  let pendingDays = 0;
  for (const p of pendingReqs) {
    pendingDays += (await getDaysInfo(p.start_date, p.end_date)).filter((d) => d.works && !d.overtime).length;
  }
  const pending = { n: pendingDays };
  const assigned = r.vacation_days;
  const available = assigned == null ? null : assigned - (used?.n ?? 0);
  return {
    assigned, periodStart, used: used?.n ?? 0, pending: pending?.n ?? 0,
    available, requestable: available == null ? null : available - (pending?.n ?? 0),
  };
}

// ---------------------------------------------------------------------
// Ficha del empleado (panel del supervisor)
// ---------------------------------------------------------------------
export async function getEmployeeDetail(id: number, now: Date) {
  const e = await queryOne<{
    id: number; employee_number: string; full_name: string; role: string; active: boolean; created_at: Date;
    department_name: string | null; subarea_name: string | null; shift_name: string; terminated_at: string | null;
    phone: string | null; birth_date: string | null; boot_size: string | null; vest_size: string | null;
    vacation_days: number | null; vacation_period_start: string | null; has_pin: boolean; photo_at: Date | null;
  }>(
    `SELECT e.id, e.employee_number, e.full_name, e.role, e.active, e.created_at, e.terminated_at,
            d.name AS department_name, sa.name AS subarea_name, cs.name AS shift_name,
            e.phone, e.birth_date, e.boot_size::text, e.vest_size, e.vacation_days, e.vacation_period_start,
            (e.pin_hash IS NOT NULL) AS has_pin, p.updated_at AS photo_at
     FROM employees e
     LEFT JOIN departments d ON d.id = e.department_id
     LEFT JOIN subareas sa ON sa.id = e.subarea_id
     JOIN shifts cs ON cs.id = employee_shift_on(e.id, $2)
     LEFT JOIN employee_photos p ON p.employee_id = e.id
     WHERE e.id = $1`,
    [id, getLocalParts(now).date],
  );
  if (!e) throw new AppError(404, "NOT_FOUND", "Empleado no encontrado.");

  const today = getLocalParts(now).date;
  const monthStart = `${today.slice(0, 7)}-01`;
  const weekStart = mondayOf(today);
  const rangeStart = [addDays(weekStart, -7 * 7), `${addDays(monthStart, -150).slice(0, 7)}-01`].sort()[0];
  const since = getLocalParts(e.created_at).date; // no se cuentan días antes de darlo de alta
  const from = rangeStart > since ? rangeStart : since;

  const days = from <= today ? await query<{ d: string; att: boolean; inc: string | null }>(
    `SELECT d::date::text AS d,
            EXISTS (SELECT 1 FROM attendance a WHERE a.employee_id = $1 AND a.operational_date = d::date) AS att,
            (SELECT i.type FROM incidents i WHERE i.employee_id = $1 AND i.operational_date = d::date AND i.revoked_at IS NULL
              ORDER BY i.created_at DESC LIMIT 1) AS inc
     FROM generate_series($2::date, $3::date, interval '1 day') d`,
    [id, from, addDays(today, -1)],
  ) : [];
  const faltaDates = new Set<string>();
  const cal = days.length ? new Map((await getDaysInfo(days[0].d, days[days.length - 1].d)).map((x) => [x.date, x])) : new Map();
  for (const day of days) {
    if (e.terminated_at && day.d >= e.terminated_at) continue;
    const info = cal.get(day.d);
    if (info && (!info.works || info.overtime) && day.inc !== "FALTA") continue; // descanso / viernes: no es falta
    if (!day.att && (day.inc === "FALTA" || day.inc == null)) faltaDates.add(day.d);
  }
  // Hoy: según el estado actual (si el registro sigue abierto, aún no es falta)
  if (today >= since) {
    const todayRows = await getRoster({ date: today }, now);
    const mine = todayRows.find((r) => r.employeeId === id);
    if (mine?.status === "FALTA") faltaDates.add(today);
  }
  const count = (fromD: string, toD: string) => [...faltaDates].filter((d) => d >= fromD && d <= toD).length;

  const weeks = Array.from({ length: 8 }, (_, i) => {
    const ws = addDays(weekStart, -7 * i);
    return { weekStart: ws, faltas: count(ws, addDays(ws, 6)) };
  });
  const months = Array.from({ length: 6 }, (_, i) => {
    const [y, m] = monthStart.split("-").map(Number);
    const dt = new Date(Date.UTC(y, m - 1 - i, 1));
    const ms = dt.toISOString().slice(0, 10);
    const me = new Date(Date.UTC(dt.getUTCFullYear(), dt.getUTCMonth() + 1, 0)).toISOString().slice(0, 10);
    return { month: ms.slice(0, 7), faltas: count(ms, me) };
  });

  const missing = missingFields({ full_name: e.full_name, phone: e.phone, birth_date: e.birth_date, boot_size: e.boot_size, vest_size: e.vest_size });
  return {
    employee: {
      id: e.id, employeeNumber: e.employee_number, fullName: e.full_name, role: e.role, active: e.active,
      area: e.department_name ? `${e.department_name}${e.subarea_name ? ` · ${e.subarea_name}` : ""}` : "Supervisión",
      shiftName: e.shift_name, hasPin: e.has_pin, photoVersion: e.photo_at ? String(e.photo_at.getTime()) : null,
      phone: e.phone, birthDate: e.birth_date, bootSize: e.boot_size != null ? Number(e.boot_size) : null, vestSize: e.vest_size,
      vacationDays: e.vacation_days, vacationPeriodStart: e.vacation_period_start, profileMissing: missing,
    },
    vacations: await getVacationSummary(id, now),
    faltas: { week: count(weekStart, today), month: count(monthStart, today), weeks, months, countingSince: since },
  };
}
