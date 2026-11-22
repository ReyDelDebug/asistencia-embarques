import { AppError } from "@/lib/errors";
import { handle, intParam, json, requireUser } from "@/lib/http";
import { computeStats, getRoster, loadCatalog, STATUSES, type AttendanceStatus } from "@/lib/services/roster";
import { currentOperationalContext, getLocalParts, isValidDateString } from "@/lib/time";

export const dynamic = "force-dynamic";

export const GET = handle(async (req) => {
  await requireUser(req);
  const now = new Date();
  const sp = req.nextUrl.searchParams;
  const catalog = await loadCatalog();
  const context = currentOperationalContext(now, catalog.shifts);

  const date = sp.get("date") || context.date;
  if (!isValidDateString(date)) throw new AppError(400, "BAD_DATE", "Fecha no válida.");
  const shiftParam = sp.has("shift") ? sp.get("shift") : context.shiftCode;
  const shift = shiftParam ? catalog.shifts.find((s) => s.code === shiftParam) : null;
  if (shiftParam && !shift) throw new AppError(400, "BAD_SHIFT", "Turno no válido.");
  const statusParam = sp.get("status");
  const status = statusParam && (STATUSES as readonly string[]).includes(statusParam) ? (statusParam as AttendanceStatus) : null;
  const departmentId = intParam(sp.get("dept"));

  // Estadísticas: todo el turno/área (sin filtro de estado); tabla: con filtro de estado.
  const all = await getRoster({ date, shiftId: shift?.id ?? null, departmentId }, now, catalog);
  const rows = status ? all.filter((r) => r.status === status) : all;
  const local = getLocalParts(now);

  return json({
    date,
    shiftCode: shift?.code ?? null,
    departmentId,
    status,
    context,
    serverTime: now.toISOString(),
    localTime: local.time,
    shifts: catalog.shifts,
    departments: catalog.departments,
    subareas: catalog.subareas,
    stats: computeStats(all),
    rows,
  });
});
