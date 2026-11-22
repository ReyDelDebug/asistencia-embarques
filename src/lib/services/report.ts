import { query, queryOne, withTransaction } from "../db";
import { AppError } from "../errors";
import { formatDateReport, getLocalParts, isValidDateString, windowState } from "../time";
import { logAudit } from "./audit";
import type { SessionUser } from "./auth";
import { getRoster, loadCatalog, type RosterRow } from "./roster";

export interface OperationalExtra {
  concept: string;
  quantity: number;
  notes: string;
  addToTotal: boolean;
}

export interface OperationalData {
  vacantes: string;
  recoge: string;
  notes: string;
  extras: OperationalExtra[];
  updatedAt: string | null;
  updatedBy: string | null;
}

export async function getOperationalData(date: string, shiftId: number): Promise<OperationalData> {
  const rep = await queryOne<{ id: number; vacantes: string; recoge: string; notes: string; updated_at: Date; updated_by_name: string | null }>(
    `SELECT r.id, r.vacantes, r.recoge, r.notes, r.updated_at, u.display_name AS updated_by_name
     FROM operational_reports r LEFT JOIN users u ON u.id = r.updated_by
     WHERE r.operational_date = $1 AND r.shift_id = $2`,
    [date, shiftId],
  );
  if (!rep) return { vacantes: "", recoge: "", notes: "", extras: [], updatedAt: null, updatedBy: null };
  const extras = await query<{ concept: string; quantity: number; notes: string; add_to_total: boolean }>(
    `SELECT concept, quantity, notes, add_to_total FROM operational_extras WHERE report_id = $1 ORDER BY sort_order, id`,
    [rep.id],
  );
  return {
    vacantes: rep.vacantes,
    recoge: rep.recoge,
    notes: rep.notes,
    extras: extras.map((e) => ({ concept: e.concept, quantity: e.quantity, notes: e.notes, addToTotal: e.add_to_total })),
    updatedAt: rep.updated_at.toISOString(),
    updatedBy: rep.updated_by_name,
  };
}

export async function saveOperationalData(
  date: string,
  shiftId: number,
  input: { vacantes?: string; recoge?: string; notes?: string; extras?: OperationalExtra[] },
  user: SessionUser,
  ip: string,
): Promise<void> {
  if (!isValidDateString(date)) throw new AppError(400, "BAD_DATE", "Fecha no válida.");
  const clean = (s: unknown, max: number) => String(s ?? "").trim().slice(0, max);
  const extras = (input.extras ?? []).slice(0, 30).map((e) => ({
    concept: clean(e.concept, 60).toUpperCase(),
    quantity: Math.trunc(Number(e.quantity)),
    notes: clean(e.notes, 200),
    addToTotal: Boolean(e.addToTotal),
  }));
  for (const e of extras) {
    if (!e.concept) throw new AppError(400, "BAD_EXTRA", "Cada concepto adicional necesita un nombre.");
    if (!Number.isFinite(e.quantity) || e.quantity < 0 || e.quantity > 500) {
      throw new AppError(400, "BAD_EXTRA", `Cantidad no válida para ${e.concept}.`);
    }
  }
  await withTransaction(async (client) => {
    const rep = await queryOne<{ id: number }>(
      `INSERT INTO operational_reports (operational_date, shift_id, vacantes, recoge, notes, updated_by, updated_at)
       VALUES ($1, $2, $3, $4, $5, $6, now())
       ON CONFLICT ON CONSTRAINT operational_reports_unique
       DO UPDATE SET vacantes = EXCLUDED.vacantes, recoge = EXCLUDED.recoge, notes = EXCLUDED.notes,
                     updated_by = EXCLUDED.updated_by, updated_at = now()
       RETURNING id`,
      [date, shiftId, clean(input.vacantes, 500), clean(input.recoge, 500), clean(input.notes, 1000), user.id],
      client,
    );
    await query(`DELETE FROM operational_extras WHERE report_id = $1`, [rep!.id], client);
    for (const [i, e] of extras.entries()) {
      await query(
        `INSERT INTO operational_extras (report_id, concept, quantity, notes, add_to_total, sort_order)
         VALUES ($1, $2, $3, $4, $5, $6)`,
        [rep!.id, e.concept, e.quantity, e.notes, e.addToTotal, i],
        client,
      );
    }
    await logAudit({
      actorType: "USER", actorId: user.id, actorLabel: user.displayName, action: "REPORT_DATA_UPDATED",
      entity: "operational_report", entityId: rep!.id,
      details: { date, shiftId, vacantes: clean(input.vacantes, 500), recoge: clean(input.recoge, 500), extras }, ip,
    }, client);
  });
}

export interface ReportData {
  date: string;
  shiftId: number;
  shiftCode: string;
  shiftName: string;
  title: string;
  windowOpen: boolean;
  supervisors: number;
  departments: { id: number; subareaId: number | null; label: string; employees: number; leaders: number; hasLeader: boolean; plantilla: number }[];
  extras: OperationalExtra[];
  total: number;
  lists: Record<"FALTA" | "PSG" | "VACACIONES" | "INCAPACIDAD" | "BAJA" | "PENDIENTE", string[]>;
  operational: OperationalData;
  text: string;
}

export async function buildReport(date: string, shiftCode: string, now: Date): Promise<ReportData> {
  if (!isValidDateString(date)) throw new AppError(400, "BAD_DATE", "Fecha no válida.");
  const catalog = await loadCatalog();
  const shift = catalog.shifts.find((s) => s.code === shiftCode);
  if (!shift) throw new AppError(400, "BAD_SHIFT", "Turno no válido.");

  const rows = await getRoster({ date, shiftId: shift.id }, now, catalog);
  const operational = await getOperationalData(date, shift.id);
  const confirmed = (r: RosterRow) => r.status === "CONFIRMADO";

  const supervisors = rows.filter((r) => r.role === "SUPERVISOR" && confirmed(r)).length;
  // Un renglón por área y otro por cada subárea (ej. CENTRAL y PT).
  const groups: { departmentId: number; subareaId: number | null; label: string; sort: number }[] = [];
  for (const d of catalog.departments) {
    groups.push({ departmentId: d.id, subareaId: null, label: d.reportLabel, sort: d.sortOrder * 100 });
    for (const sa of catalog.subareas.filter((x) => x.departmentId === d.id)) {
      groups.push({ departmentId: d.id, subareaId: sa.id, label: sa.reportLabel, sort: d.sortOrder * 100 + sa.sortOrder });
    }
  }
  groups.sort((a, b) => a.sort - b.sort);
  const departments = groups
    .map((g) => {
      const inGroup = rows.filter((r) => r.departmentId === g.departmentId && r.subareaId === g.subareaId && r.role !== "SUPERVISOR");
      return {
        id: g.departmentId,
        subareaId: g.subareaId,
        label: g.label,
        employees: inGroup.filter((r) => r.role === "EMPLOYEE" && confirmed(r)).length,
        leaders: inGroup.filter((r) => r.role === "LEADER" && confirmed(r)).length,
        hasLeader: inGroup.some((r) => r.role === "LEADER"),
        plantilla: inGroup.filter((r) => r.status !== "BAJA").length,
      };
    })
    .filter((d) => d.plantilla > 0 || d.employees + d.leaders > 0);

  const extrasTotal = operational.extras.filter((e) => e.addToTotal).reduce((s, e) => s + e.quantity, 0);
  const total = supervisors + departments.reduce((s, d) => s + d.employees + d.leaders, 0) + extrasTotal;

  const nameWithArea = (r: RosterRow) => {
    if (r.role === "SUPERVISOR") return `${r.fullName} (SUPERVISOR)`;
    const sub = catalog.subareas.find((x) => x.id === r.subareaId);
    const dept = catalog.departments.find((d) => d.id === r.departmentId);
    return `${r.fullName} (${sub ? `${dept?.reportLabel} ${sub.reportLabel}` : dept?.reportLabel ?? r.departmentName})`;
  };
  const listOf = (status: RosterRow["status"]) => rows.filter((r) => r.status === status).map(nameWithArea);

  const windowOpen = windowState(now, shift, date) === "OPEN" && getLocalParts(now).date === date;
  const lists = {
    FALTA: listOf("FALTA"),
    PSG: listOf("PSG"),
    VACACIONES: listOf("VACACIONES"),
    INCAPACIDAD: listOf("INCAPACIDAD"),
    BAJA: listOf("BAJA"),
    PENDIENTE: listOf("PENDIENTE"),
  };

  const lines: string[] = [];
  const block = (s: string) => { lines.push(s, ""); };
  block(`*${shift.reportTitle}*`);
  block(`*FECHA:* ${formatDateReport(date)}`);
  block(`*SUPERVISOR:* ${supervisors}`);
  for (const d of departments) {
    block(`*${d.label}:* ${d.hasLeader ? `${d.employees}+${d.leaders}` : d.employees + d.leaders}`);
  }
  for (const e of operational.extras) {
    block(`*${e.concept}:* ${e.quantity}${e.notes ? ` (${e.notes})` : ""}`);
  }
  block(`*TOTAL:* ${total}`);
  const listBlock = (label: string, names: string[]) => {
    lines.push(`*${label}:*`);
    for (const n of names) lines.push(`- ${n}`);
    lines.push("");
  };
  if (lists.PENDIENTE.length > 0) listBlock("PENDIENTES POR CONFIRMAR", lists.PENDIENTE);
  listBlock("FALTA", lists.FALTA);
  listBlock("PSG", lists.PSG);
  listBlock("VACACIONES", lists.VACACIONES);
  listBlock("INCAPACIDAD", lists.INCAPACIDAD);
  listBlock("BAJA", lists.BAJA);
  block(`*VACANTES:*${operational.vacantes ? ` ${operational.vacantes}` : ""}`);
  block(`*RECOGE:*${operational.recoge ? ` ${operational.recoge}` : ""}`);
  if (operational.notes) block(`*OBSERVACIONES:* ${operational.notes}`);
  while (lines.length && lines[lines.length - 1] === "") lines.pop();

  return {
    date,
    shiftId: shift.id,
    shiftCode: shift.code,
    shiftName: shift.name,
    title: shift.reportTitle,
    windowOpen,
    supervisors,
    departments,
    extras: operational.extras,
    total,
    lists,
    operational,
    text: lines.join("\n"),
  };
}

export async function recordReportAction(
  date: string, shiftId: number, action: "COPY" | "SHARE" | "EXPORT", text: string, user: SessionUser, ip: string,
): Promise<void> {
  await query(
    `INSERT INTO operational_reports (operational_date, shift_id, last_generated_text, updated_by, updated_at)
     VALUES ($1, $2, $3, $4, now())
     ON CONFLICT ON CONSTRAINT operational_reports_unique
     DO UPDATE SET last_generated_text = EXCLUDED.last_generated_text`,
    [date, shiftId, text.slice(0, 20000), user.id],
  );
  await logAudit({
    actorType: "USER", actorId: user.id, actorLabel: user.displayName, action: `REPORT_${action}`,
    entity: "operational_report", entityId: `${date}/${shiftId}`, details: { date, shiftId }, ip,
  });
}
