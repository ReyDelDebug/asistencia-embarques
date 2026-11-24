/**
 * Apertura y cierre manual del registro por el supervisor.
 * Para una fecha y turno se puede:
 *  - CERRAR antes de la hora normal (cierra en ese momento)
 *  - ABRIR (aunque ya hayan pasado las 8:00): queda abierto hasta que lo cierre o hasta el fin del día
 *  - Volver al horario normal
 */
import { query, queryOne } from "../db";
import { AppError } from "../errors";
import { getLocalParts, timeToSeconds } from "../time";
import { logAudit } from "./audit";
import type { SessionUser } from "./auth";
import { getShifts, type Shift } from "./catalog";
import { getDayInfo, type DayInfo } from "./calendar";

export const END_OF_DAY = "23:59:59";

export interface WindowOverride { shiftId: number; openTime: string; closeTime: string; setBy: string; updatedAt: string }

export async function getOverrides(date: string): Promise<Map<number, WindowOverride>> {
  const rows = await query<{ shift_id: number; open_time: string; close_time: string; set_by_label: string; updated_at: Date }>(
    `SELECT shift_id, open_time, close_time, set_by_label, updated_at FROM shift_window_overrides WHERE operational_date = $1`, [date]);
  return new Map(rows.map((r) => [r.shift_id, {
    shiftId: r.shift_id, openTime: r.open_time, closeTime: r.close_time, setBy: r.set_by_label, updatedAt: r.updated_at.toISOString(),
  }]));
}

export function applyOverride(shift: Shift, ov: WindowOverride | undefined): Shift {
  return ov ? { ...shift, openTime: ov.openTime, closeTime: ov.closeTime } : shift;
}

/**
 * Turnos con el horario que realmente aplica en esa fecha:
 *  1) apertura/cierre manual del supervisor (si existe) manda;
 *  2) si el día no es laborable (calendario), el registro queda cerrado;
 *  3) si no, el horario normal.
 */
export async function shiftsForDate(date: string, base?: Shift[]): Promise<{ shifts: Shift[]; day: DayInfo }> {
  const [shifts, ovs, day] = await Promise.all([base ? Promise.resolve(base) : getShifts(), getOverrides(date), getDayInfo(date)]);
  return {
    day,
    shifts: shifts.map((s) => {
      const ov = ovs.get(s.id);
      if (ov) return applyOverride(s, ov);
      if (!day.works) return { ...s, openTime: "00:00:00", closeTime: "00:00:00" };
      return s;
    }),
  };
}

export async function getEffectiveShifts(date: string): Promise<Shift[]> {
  return (await shiftsForDate(date)).shifts;
}

const secToTime = (s: number) =>
  [Math.floor(s / 3600), Math.floor((s % 3600) / 60), s % 60].map((n) => String(n).padStart(2, "0")).join(":");

export async function setWindow(
  shiftCode: string,
  action: "OPEN" | "CLOSE" | "RESET",
  user: SessionUser,
  ip: string,
  now: Date,
): Promise<{ date: string; shift: string; openTime: string; closeTime: string; normal: boolean }> {
  const shifts = await getShifts();
  const shift = shifts.find((s) => s.code === shiftCode);
  if (!shift) throw new AppError(400, "BAD_SHIFT", "Turno no válido.");
  const local = getLocalParts(now);
  const date = local.date;
  const nowT = secToTime(local.seconds);

  if (action === "RESET") {
    await query(`DELETE FROM shift_window_overrides WHERE operational_date = $1 AND shift_id = $2`, [date, shift.id]);
  } else {
    const current = (await getOverrides(date)).get(shift.id);
    const baseOpen = current?.openTime ?? shift.openTime;
    let openTime: string;
    let closeTime: string;
    if (action === "OPEN") {
      openTime = timeToSeconds(baseOpen) <= local.seconds ? baseOpen : nowT;
      closeTime = END_OF_DAY;
    } else {
      closeTime = nowT;
      openTime = timeToSeconds(baseOpen) <= local.seconds ? baseOpen : nowT;
    }
    await query(
      `INSERT INTO shift_window_overrides (operational_date, shift_id, open_time, close_time, set_by_user, set_by_label, updated_at)
       VALUES ($1, $2, $3, $4, $5, $6, now())
       ON CONFLICT (operational_date, shift_id) DO UPDATE SET open_time = EXCLUDED.open_time, close_time = EXCLUDED.close_time,
         set_by_user = EXCLUDED.set_by_user, set_by_label = EXCLUDED.set_by_label, updated_at = now()`,
      [date, shift.id, openTime, closeTime, user.id, user.displayName],
    );
  }
  const eff = applyOverride(shift, (await getOverrides(date)).get(shift.id));
  await logAudit({
    actorType: "USER", actorId: user.id, actorLabel: user.displayName,
    action: action === "OPEN" ? "WINDOW_OPENED" : action === "CLOSE" ? "WINDOW_CLOSED" : "WINDOW_RESET",
    entity: "shift", entityId: `${date}/${shift.code}`, details: { date, shift: shift.code, openTime: eff.openTime, closeTime: eff.closeTime }, ip,
  });
  return { date, shift: shift.code, openTime: eff.openTime, closeTime: eff.closeTime, normal: action === "RESET" };
}

export async function getWindowStatus(now: Date) {
  const local = getLocalParts(now);
  const [shifts, ovs] = await Promise.all([getShifts(), getOverrides(local.date)]);
  const { shifts: effList, day } = await shiftsForDate(local.date, shifts);
  return shifts.map((s, i) => {
    const ov = ovs.get(s.id);
    const eff = effList[i];
    const open = local.seconds >= timeToSeconds(eff.openTime) && local.seconds < timeToSeconds(eff.closeTime);
    return {
      code: s.code, name: s.name, date: local.date, open,
      normalOpen: s.openTime, normalClose: s.closeTime,
      openTime: eff.openTime, closeTime: eff.closeTime,
      override: ov ? { setBy: ov.setBy, updatedAt: ov.updatedAt, openAllDay: ov.closeTime === END_OF_DAY } : null,
      day: { type: day.type, label: day.label, works: day.works },
    };
  });
}

export async function hasOverride(date: string, shiftId: number): Promise<boolean> {
  return !!(await queryOne(`SELECT 1 FROM shift_window_overrides WHERE operational_date = $1 AND shift_id = $2`, [date, shiftId]));
}
