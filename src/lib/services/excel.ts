import ExcelJS from "exceljs";
import { query } from "../db";
import { AppError } from "../errors";
import { addDays, daysBetween, formatDateShort, getLocalParts, isValidDateString } from "../time";
import { computeStats, getRoster, loadCatalog, ROLE_LABELS, STATUS_LABELS, type RosterRow } from "./roster";

export interface ExportFilter {
  from: string;
  to: string;
  shiftId?: number | null;
  departmentId?: number | null;
}

export const MAX_EXPORT_DAYS = 93;

const HEADER_FILL: ExcelJS.Fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FF1E293B" } };
const HEADER_FONT: Partial<ExcelJS.Font> = { bold: true, color: { argb: "FFFFFFFF" }, size: 11 };

function dateCell(date: string): Date {
  const [y, m, d] = date.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d));
}

/** Instante -> Date "local" (componentes de Ciudad de México expresados en UTC) para Excel. */
function localDateTimeCell(iso: string | Date): Date {
  const p = getLocalParts(typeof iso === "string" ? new Date(iso) : iso);
  const [y, m, d] = p.date.split("-").map(Number);
  const [hh, mm, ss] = p.time.split(":").map(Number);
  return new Date(Date.UTC(y, m - 1, d, hh, mm, ss));
}

function styleHeader(ws: ExcelJS.Worksheet, rowNumber: number, columnCount: number) {
  const row = ws.getRow(rowNumber);
  row.height = 22;
  for (let c = 1; c <= columnCount; c++) {
    const cell = row.getCell(c);
    cell.fill = HEADER_FILL;
    cell.font = HEADER_FONT;
    cell.alignment = { vertical: "middle", horizontal: "center", wrapText: true };
    cell.border = { bottom: { style: "thin", color: { argb: "FF94A3B8" } } };
  }
}

function titleBlock(ws: ExcelJS.Worksheet, title: string, subtitle: string, width: number) {
  ws.mergeCells(1, 1, 1, width);
  ws.getCell(1, 1).value = title;
  ws.getCell(1, 1).font = { bold: true, size: 14, color: { argb: "FF0F172A" } };
  ws.mergeCells(2, 1, 2, width);
  ws.getCell(2, 1).value = subtitle;
  ws.getCell(2, 1).font = { size: 10, color: { argb: "FF475569" } };
}

export async function buildAttendanceWorkbook(filter: ExportFilter, now: Date): Promise<{ buffer: Buffer; filename: string }> {
  if (!isValidDateString(filter.from) || !isValidDateString(filter.to)) {
    throw new AppError(400, "BAD_DATE", "Rango de fechas no válido.");
  }
  if (filter.to < filter.from) throw new AppError(400, "BAD_RANGE", "La fecha final es anterior a la inicial.");
  const span = daysBetween(filter.from, filter.to) + 1;
  if (span > MAX_EXPORT_DAYS) throw new AppError(400, "RANGE_TOO_LONG", `El periodo máximo es de ${MAX_EXPORT_DAYS} días.`);

  const catalog = await loadCatalog();
  const shiftName = filter.shiftId ? catalog.shifts.find((s) => s.id === filter.shiftId)?.name : "Todos";
  const deptName = filter.departmentId ? catalog.departments.find((d) => d.id === filter.departmentId)?.name : "Todas";

  const rows: RosterRow[] = [];
  for (let i = 0; i < span; i++) {
    const date = addDays(filter.from, i);
    rows.push(...(await getRoster({ date, shiftId: filter.shiftId, departmentId: filter.departmentId }, now, catalog)));
  }

  const periodLabel = filter.from === filter.to
    ? formatDateShort(filter.from)
    : `${formatDateShort(filter.from)} al ${formatDateShort(filter.to)}`;
  const subtitle = `Periodo: ${periodLabel}  ·  Turno: ${shiftName}  ·  Área: ${deptName}  ·  Generado: ${formatDateShort(getLocalParts(now).date)} ${getLocalParts(now).time}`;

  const wb = new ExcelJS.Workbook();
  wb.creator = "Control de Asistencia – Embarques";
  wb.created = now;

  // ---------------- HOJA 1: ASISTENCIA GENERAL ----------------
  const ws1 = wb.addWorksheet("ASISTENCIA GENERAL", { views: [{ state: "frozen", ySplit: 4 }] });
  const cols1 = [
    { header: "Número de empleado", width: 14 },
    { header: "Nombre", width: 28 },
    { header: "Área", width: 14 },
    { header: "Puesto", width: 12 },
    { header: "Turno", width: 10 },
    { header: "Fecha", width: 12 },
    { header: "Hora de confirmación", width: 14 },
    { header: "Estado", width: 13 },
    { header: "Observaciones", width: 48 },
  ];
  titleBlock(ws1, "ASISTENCIA GENERAL – EMBARQUES", subtitle, cols1.length);
  ws1.getRow(4).values = cols1.map((c) => c.header);
  cols1.forEach((c, i) => (ws1.getColumn(i + 1).width = c.width));
  styleHeader(ws1, 4, cols1.length);
  for (const r of rows) {
    const obs = [r.observations, r.incidentBy ? `Registrado por ${r.incidentBy}` : ""].filter(Boolean).join(" · ");
    const row = ws1.addRow([
      r.employeeNumber,
      r.fullName,
      r.departmentName,
      ROLE_LABELS[r.role],
      r.shiftName,
      dateCell(r.date),
      r.confirmedAt ? localDateTimeCell(r.confirmedAt) : null,
      STATUS_LABELS[r.status],
      obs,
    ]);
    row.getCell(6).numFmt = "dd/mm/yyyy";
    row.getCell(7).numFmt = "hh:mm:ss";
    row.getCell(1).alignment = { horizontal: "center" };
    const statusCell = row.getCell(8);
    const color = r.status === "CONFIRMADO" ? "FF166534" : r.status === "PENDIENTE" ? "FF92400E" : r.status === "FALTA" ? "FF991B1B" : "FF334155";
    statusCell.font = { bold: true, color: { argb: color } };
  }
  ws1.autoFilter = { from: { row: 4, column: 1 }, to: { row: Math.max(4, ws1.rowCount), column: cols1.length } };

  // ---------------- HOJA 2: RESUMEN ----------------
  const ws2 = wb.addWorksheet("RESUMEN");
  titleBlock(ws2, "RESUMEN DE ASISTENCIA", subtitle, 5);
  const stats = computeStats(rows);
  const days = span;
  ws2.getRow(4).values = ["Concepto", "Cantidad"];
  styleHeader(ws2, 4, 2);
  const summary: [string, number | string][] = [
    [days > 1 ? "Total de registros esperados (empleado × día)" : "Total de empleados", stats.total],
    ["Confirmados", stats.confirmed],
    ["Pendientes", stats.pending],
    ["Faltas", stats.falta],
    ["Vacaciones", stats.vacaciones],
    ["Incapacidades", stats.incapacidad],
    ["PSG", stats.psg],
    ["Bajas", stats.baja],
    ["Porcentaje de asistencia", stats.percentage / 100],
  ];
  for (const [k, v] of summary) {
    const row = ws2.addRow([k, v]);
    row.getCell(1).font = { bold: true };
    if (k.startsWith("Porcentaje")) row.getCell(2).numFmt = "0.0%";
  }
  ws2.getColumn(1).width = 46;
  ws2.getColumn(2).width = 14;
  ws2.getColumn(3).width = 14;
  ws2.getColumn(4).width = 14;
  ws2.getColumn(5).width = 14;

  ws2.addRow([]);
  const distHeader = ws2.addRow(["Distribución por área", "Plantilla", "Confirmados", "No confirmados", "% asistencia"]);
  styleHeader(ws2, distHeader.number, 5);
  const distStart = distHeader.number + 1;
  for (const g of stats.byDepartment) {
    const row = ws2.addRow([g.label, g.total, g.confirmed, g.total - g.confirmed, g.total ? g.confirmed / g.total : 0]);
    row.getCell(5).numFmt = "0.0%";
  }
  ws2.autoFilter = { from: { row: distHeader.number, column: 1 }, to: { row: Math.max(distStart, ws2.rowCount), column: 5 } };

  ws2.addRow([]);
  const shiftHeader = ws2.addRow(["Distribución por turno", "Plantilla", "Confirmados", "No confirmados", "% asistencia"]);
  styleHeader(ws2, shiftHeader.number, 5);
  for (const g of stats.byShift) {
    const row = ws2.addRow([g.label, g.total, g.confirmed, g.total - g.confirmed, g.total ? g.confirmed / g.total : 0]);
    row.getCell(5).numFmt = "0.0%";
  }

  // ---------------- HOJA 3: HISTORIAL ----------------
  const ws3 = wb.addWorksheet("HISTORIAL", { views: [{ state: "frozen", ySplit: 4 }] });
  const cols3 = [
    { header: "Fecha operativa", width: 13 },
    { header: "Fecha y hora del movimiento", width: 20 },
    { header: "Movimiento", width: 22 },
    { header: "Número de empleado", width: 14 },
    { header: "Empleado", width: 28 },
    { header: "Área", width: 14 },
    { header: "Turno", width: 10 },
    { header: "Detalle", width: 50 },
    { header: "Registrado por", width: 22 },
  ];
  titleBlock(ws3, "HISTORIAL DE MOVIMIENTOS", subtitle, cols3.length);
  ws3.getRow(4).values = cols3.map((c) => c.header);
  cols3.forEach((c, i) => (ws3.getColumn(i + 1).width = c.width));
  styleHeader(ws3, 4, cols3.length);

  const params: unknown[] = [filter.from, filter.to];
  let extraAtt = "";
  let extraInc = "";
  if (filter.shiftId) {
    params.push(filter.shiftId);
    extraAtt += ` AND a.shift_id = $${params.length}`;
    extraInc += ` AND i.shift_id = $${params.length}`;
  }
  if (filter.departmentId) {
    params.push(filter.departmentId);
    extraAtt += ` AND a.department_id = $${params.length}`;
    extraInc += ` AND e.department_id = $${params.length}`;
  }
  const history = await query<{
    operational_date: string; at: Date; kind: string; employee_number: string; full_name: string;
    department_name: string | null; shift_name: string; detail: string; by_name: string | null;
  }>(
    `SELECT a.operational_date, a.confirmed_at AS at, 'Asistencia confirmada' AS kind, e.employee_number, e.full_name,
            d.name AS department_name, s.name AS shift_name,
            concat('Confirmada por el empleado', CASE WHEN a.ip IS NOT NULL THEN concat(' · IP ', a.ip) END) AS detail,
            e.full_name AS by_name
     FROM attendance a JOIN employees e ON e.id = a.employee_id JOIN shifts s ON s.id = a.shift_id
     LEFT JOIN departments d ON d.id = a.department_id
     WHERE a.operational_date BETWEEN $1 AND $2 ${extraAtt}
     UNION ALL
     SELECT i.operational_date, i.created_at, concat('Incidencia: ', i.type), e.employee_number, e.full_name,
            d.name, s.name, i.reason, u.display_name
     FROM incidents i JOIN employees e ON e.id = i.employee_id JOIN shifts s ON s.id = i.shift_id
     LEFT JOIN departments d ON d.id = e.department_id JOIN users u ON u.id = i.created_by
     WHERE i.operational_date BETWEEN $1 AND $2 ${extraInc}
     UNION ALL
     SELECT i.operational_date, i.revoked_at, concat('Incidencia retirada: ', i.type), e.employee_number, e.full_name,
            d.name, s.name, i.revoke_reason, u.display_name
     FROM incidents i JOIN employees e ON e.id = i.employee_id JOIN shifts s ON s.id = i.shift_id
     LEFT JOIN departments d ON d.id = e.department_id JOIN users u ON u.id = i.revoked_by
     WHERE i.revoked_at IS NOT NULL AND i.operational_date BETWEEN $1 AND $2 ${extraInc}
     ORDER BY 1, 2`,
    params,
  );
  for (const h of history) {
    const row = ws3.addRow([
      dateCell(h.operational_date),
      localDateTimeCell(h.at),
      h.kind,
      h.employee_number,
      h.full_name,
      h.department_name ?? "Supervisión",
      h.shift_name,
      h.detail,
      h.by_name ?? "",
    ]);
    row.getCell(1).numFmt = "dd/mm/yyyy";
    row.getCell(2).numFmt = "dd/mm/yyyy hh:mm:ss";
  }
  ws3.autoFilter = { from: { row: 4, column: 1 }, to: { row: Math.max(4, ws3.rowCount), column: cols3.length } };

  const buffer = Buffer.from(await wb.xlsx.writeBuffer());
  const filename = filter.from === filter.to
    ? `asistencia_${filter.from}.xlsx`
    : `asistencia_${filter.from}_a_${filter.to}.xlsx`;
  return { buffer, filename };
}
