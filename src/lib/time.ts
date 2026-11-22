// Utilidades de fecha/hora. TODA la lógica de horarios usa la hora del
// SERVIDOR convertida a America/Mexico_City. Nunca la del dispositivo.

export const TIMEZONE = "America/Mexico_City";

export type ShiftCode = "DIA" | "NOCHE";

export interface ShiftWindowConfig {
  id: number;
  code: ShiftCode;
  name: string;
  openTime: string; // 'HH:MM:SS' inclusivo
  closeTime: string; // 'HH:MM:SS' EXCLUSIVO
}

const partsFormatter = new Intl.DateTimeFormat("en-CA", {
  timeZone: TIMEZONE,
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
  second: "2-digit",
  hourCycle: "h23",
});

export interface LocalParts {
  date: string; // YYYY-MM-DD
  time: string; // HH:MM:SS
  seconds: number; // segundos desde la medianoche local
}

export function getLocalParts(d: Date): LocalParts {
  const p: Record<string, string> = {};
  for (const part of partsFormatter.formatToParts(d)) p[part.type] = part.value;
  const hour = p.hour === "24" ? "00" : p.hour;
  return {
    date: `${p.year}-${p.month}-${p.day}`,
    time: `${hour}:${p.minute}:${p.second}`,
    seconds: Number(hour) * 3600 + Number(p.minute) * 60 + Number(p.second),
  };
}

export function timeToSeconds(t: string): number {
  const [h, m, s] = t.split(":").map(Number);
  return h * 3600 + m * 60 + (s || 0);
}

export function isValidDateString(s: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) return false;
  const d = new Date(`${s}T12:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === s;
}

export function addDays(date: string, n: number): string {
  const d = new Date(`${date}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

export function daysBetween(from: string, to: string): number {
  const a = new Date(`${from}T12:00:00Z`).getTime();
  const b = new Date(`${to}T12:00:00Z`).getTime();
  return Math.round((b - a) / 86_400_000);
}

/** Estado de la ventana de registro de un turno para una fecha operativa. */
export type WindowState = "BEFORE" | "OPEN" | "CLOSED";

export function windowState(now: Date, shift: ShiftWindowConfig, operationalDate: string): WindowState {
  const local = getLocalParts(now);
  if (operationalDate > local.date) return "BEFORE";
  if (operationalDate < local.date) return "CLOSED";
  const open = timeToSeconds(shift.openTime);
  const close = timeToSeconds(shift.closeTime);
  if (local.seconds < open) return "BEFORE";
  if (local.seconds < close) return "OPEN";
  return "CLOSED";
}

/** Turno cuya ventana está abierta en este momento (o null). */
export function findOpenShift(
  now: Date,
  shifts: ShiftWindowConfig[],
): { shift: ShiftWindowConfig; operationalDate: string } | null {
  const local = getLocalParts(now);
  for (const shift of shifts) {
    if (windowState(now, shift, local.date) === "OPEN") {
      return { shift, operationalDate: local.date };
    }
  }
  return null;
}

/**
 * Contexto operativo "actual" para el panel: el turno que abrió más
 * recientemente. Antes de las 05:00 se considera la noche del día anterior.
 */
export function currentOperationalContext(
  now: Date,
  shifts: ShiftWindowConfig[],
): { date: string; shiftCode: ShiftCode } {
  const local = getLocalParts(now);
  const day = shifts.find((s) => s.code === "DIA");
  const night = shifts.find((s) => s.code === "NOCHE");
  const dayOpen = day ? timeToSeconds(day.openTime) : 5 * 3600;
  const nightOpen = night ? timeToSeconds(night.openTime) : 17 * 3600;
  if (local.seconds >= nightOpen) return { date: local.date, shiftCode: "NOCHE" };
  if (local.seconds < dayOpen) return { date: addDays(local.date, -1), shiftCode: "NOCHE" };
  return { date: local.date, shiftCode: "DIA" };
}

const MONTHS = [
  "ENERO", "FEBRERO", "MARZO", "ABRIL", "MAYO", "JUNIO",
  "JULIO", "AGOSTO", "SEPTIEMBRE", "OCTUBRE", "NOVIEMBRE", "DICIEMBRE",
];
const WEEKDAYS = ["domingo", "lunes", "martes", "miércoles", "jueves", "viernes", "sábado"];

/** '2026-11-23' -> '23 DE NOVIEMBRE' */
export function formatDateReport(date: string): string {
  const [, m, d] = date.split("-").map(Number);
  return `${d} DE ${MONTHS[m - 1]}`;
}

/** '2026-11-23' -> 'lunes 23 de noviembre de 2026' */
export function formatDateLong(date: string): string {
  const [y, m, d] = date.split("-").map(Number);
  const wd = new Date(Date.UTC(y, m - 1, d, 12)).getUTCDay();
  return `${WEEKDAYS[wd]} ${d} de ${MONTHS[m - 1].toLowerCase()} de ${y}`;
}

/** '2026-11-23' -> '23/11/2026' */
export function formatDateShort(date: string): string {
  const [y, m, d] = date.split("-");
  return `${d}/${m}/${y}`;
}

/** Hora local HH:MM:SS de un instante. */
export function formatTimeLocal(d: Date | string): string {
  return getLocalParts(typeof d === "string" ? new Date(d) : d).time;
}

/** '07:40:00' -> '07:40 a. m.' ; '19:39:59' -> '07:39:59 p. m.' */
export function formatTime12(t: string, withSeconds = false): string {
  const [h, m, s] = t.split(":").map(Number);
  const suffix = h < 12 ? "a. m." : "p. m.";
  const h12 = h % 12 === 0 ? 12 : h % 12;
  const base = `${String(h12).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
  return `${withSeconds ? `${base}:${String(s || 0).padStart(2, "0")}` : base} ${suffix}`;
}

/** Último segundo permitido de una ventana: '07:40:00' -> '07:39:59' */
export function lastAllowedSecond(closeTime: string): string {
  const s = timeToSeconds(closeTime) - 1;
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  return [h, m, sec].map((n) => String(n).padStart(2, "0")).join(":");
}
