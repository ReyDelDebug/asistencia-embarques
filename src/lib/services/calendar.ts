/**
 * Calendario laboral.
 *  - Lunes a jueves: LABORAL (día 7:30–19:30, noche 19:30–7:30)
 *  - Viernes: VIERNES = tiempo extra (día 7:30–17:30, noche 17:30–5:30). Trabajan todos;
 *    quien no llega queda como DESCANSO (no falta). Puede cambiarse a VIERNES_LARGO (7:30–7:30).
 *  - Sábado y domingo: NO_LABORAL. Feriados de ley (LFT art. 74): FERIADO.
 * Solo se guardan en la base los días que el supervisor cambia.
 */
import { query } from "../db";
import { AppError } from "../errors";
import { addDays, isValidDateString } from "../time";
import { logAudit } from "./audit";
import type { SessionUser } from "./auth";

export const DAY_TYPES = ["LABORAL", "VIERNES", "VIERNES_LARGO", "NO_LABORAL", "FERIADO"] as const;
export type DayType = (typeof DAY_TYPES)[number];

export const DAY_TYPE_LABELS: Record<DayType, string> = {
  LABORAL: "Laborable",
  VIERNES: "Viernes · tiempo extra",
  VIERNES_LARGO: "Viernes · jornada larga",
  NO_LABORAL: "No laborable",
  FERIADO: "Feriado",
};

const HOURS: Record<"NORMAL" | "VIERNES", Record<string, string>> = {
  NORMAL: { DIA: "7:30 a. m. – 7:30 p. m.", NOCHE: "7:30 p. m. – 7:30 a. m." },
  VIERNES: { DIA: "7:30 a. m. – 5:30 p. m.", NOCHE: "5:30 p. m. – 5:30 a. m." },
};

export interface DayInfo {
  date: string;
  type: DayType;
  label: string;
  works: boolean; // se espera asistencia
  overtime: boolean; // viernes: quien no llega queda en DESCANSO
  custom: boolean; // cambiado por el supervisor
  hours: Record<string, string> | null;
}

function weekday(date: string): number {
  return new Date(`${date}T12:00:00Z`).getUTCDay(); // 0 domingo … 6 sábado
}

function nthMonday(year: number, month: number, n: number): string {
  const first = new Date(Date.UTC(year, month - 1, 1, 12));
  const offset = (8 - first.getUTCDay()) % 7; // días hasta el primer lunes
  const d = new Date(Date.UTC(year, month - 1, 1 + offset + (n - 1) * 7, 12));
  return d.toISOString().slice(0, 10);
}

/** Días de descanso obligatorio (Ley Federal del Trabajo, art. 74). */
export function lftHolidays(year: number): { date: string; label: string }[] {
  const list = [
    { date: `${year}-01-01`, label: "Año Nuevo" },
    { date: nthMonday(year, 2, 1), label: "Día de la Constitución" },
    { date: nthMonday(year, 3, 3), label: "Natalicio de Benito Juárez" },
    { date: `${year}-05-01`, label: "Día del Trabajo" },
    { date: `${year}-09-16`, label: "Día de la Independencia" },
    { date: nthMonday(year, 11, 3), label: "Día de la Revolución" },
    { date: `${year}-12-25`, label: "Navidad" },
  ];
  if ((year - 2024) % 6 === 0) list.push({ date: `${year}-10-01`, label: "Transmisión del Poder Ejecutivo" });
  return list.sort((a, b) => a.date.localeCompare(b.date));
}

function defaultDay(date: string): { type: DayType; label: string } {
  const h = lftHolidays(Number(date.slice(0, 4))).find((x) => x.date === date);
  if (h) return { type: "FERIADO", label: h.label };
  const wd = weekday(date);
  if (wd === 0 || wd === 6) return { type: "NO_LABORAL", label: wd === 0 ? "Domingo" : "Sábado" };
  if (wd === 5) return { type: "VIERNES", label: "Tiempo extra" };
  return { type: "LABORAL", label: "" };
}

function build(date: string, type: DayType, label: string, custom: boolean): DayInfo {
  const works = type === "LABORAL" || type === "VIERNES" || type === "VIERNES_LARGO";
  return {
    date, type, label, custom, works,
    overtime: type === "VIERNES" || type === "VIERNES_LARGO",
    hours: !works ? null : type === "VIERNES" ? HOURS.VIERNES : HOURS.NORMAL,
  };
}

export async function getDaysInfo(from: string, to: string): Promise<DayInfo[]> {
  if (!isValidDateString(from) || !isValidDateString(to) || to < from) throw new AppError(400, "BAD_RANGE", "Rango no válido.");
  const rows = await query<{ day: string; day_type: DayType; label: string }>(
    `SELECT day::text AS day, day_type, label FROM work_calendar WHERE day BETWEEN $1 AND $2`, [from, to]);
  const custom = new Map(rows.map((r) => [r.day, r]));
  const out: DayInfo[] = [];
  for (let d = from; d <= to; d = addDays(d, 1)) {
    const c = custom.get(d);
    if (c) {
      const def = defaultDay(d);
      const fallback = c.day_type === def.type ? def.label
        : ({ LABORAL: "Laborable", VIERNES: "Tiempo extra", VIERNES_LARGO: "Jornada larga", NO_LABORAL: "No laborable", FERIADO: "Feriado" } as const)[c.day_type];
      out.push(build(d, c.day_type, c.label || fallback, true));
    }
    else {
      const def = defaultDay(d);
      out.push(build(d, def.type, def.label, false));
    }
    if (out.length > 400) break;
  }
  return out;
}

export async function getDayInfo(date: string): Promise<DayInfo> {
  return (await getDaysInfo(date, date))[0];
}

export async function setCalendarDay(date: string, type: string, label: string, user: SessionUser, ip: string): Promise<DayInfo> {
  if (!isValidDateString(date)) throw new AppError(400, "BAD_DATE", "Fecha no válida.");
  if (!(DAY_TYPES as readonly string[]).includes(type)) throw new AppError(400, "BAD_TYPE", "Tipo de día no válido.");
  const isFriday = weekday(date) === 5;
  if ((type === "VIERNES" || type === "VIERNES_LARGO") && !isFriday) {
    throw new AppError(400, "BAD_TYPE", "Los tipos de viernes solo aplican a viernes. Usa “Laborable” para otros días.");
  }
  const lbl = String(label ?? "").trim().slice(0, 60);
  await query(
    `INSERT INTO work_calendar (day, day_type, label, set_by, set_by_label, updated_at) VALUES ($1, $2, $3, $4, $5, now())
     ON CONFLICT (day) DO UPDATE SET day_type = EXCLUDED.day_type, label = EXCLUDED.label, set_by = EXCLUDED.set_by,
       set_by_label = EXCLUDED.set_by_label, updated_at = now()`,
    [date, type, lbl, user.id, user.displayName],
  );
  await logAudit({
    actorType: "USER", actorId: user.id, actorLabel: user.displayName, action: "CALENDAR_DAY_SET",
    entity: "calendar", entityId: date, details: { date, type, label: lbl }, ip,
  });
  return getDayInfo(date);
}

export async function resetCalendarDay(date: string, user: SessionUser, ip: string): Promise<DayInfo> {
  if (!isValidDateString(date)) throw new AppError(400, "BAD_DATE", "Fecha no válida.");
  await query(`DELETE FROM work_calendar WHERE day = $1`, [date]);
  await logAudit({
    actorType: "USER", actorId: user.id, actorLabel: user.displayName, action: "CALENDAR_DAY_RESET",
    entity: "calendar", entityId: date, ip,
  });
  return getDayInfo(date);
}
