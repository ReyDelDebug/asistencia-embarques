import { AppError } from "@/lib/errors";
import { getMeta, handle, json, readJson, requireUser } from "@/lib/http";
import { getShiftByCode } from "@/lib/services/catalog";
import { buildReport, saveOperationalData, type OperationalExtra } from "@/lib/services/report";

export const dynamic = "force-dynamic";

export const GET = handle(async (req) => {
  await requireUser(req);
  const sp = req.nextUrl.searchParams;
  const date = sp.get("date") ?? "";
  const shift = sp.get("shift") ?? "";
  return json(await buildReport(date, shift, new Date()));
});

export const PUT = handle(async (req) => {
  const user = await requireUser(req);
  const meta = getMeta(req);
  const b = await readJson<{ date: string; shift: string; vacantes?: string; recoge?: string; notes?: string; extras?: OperationalExtra[] }>(req);
  const shift = await getShiftByCode(String(b.shift));
  if (!shift) throw new AppError(400, "BAD_SHIFT", "Turno no válido.");
  await saveOperationalData(String(b.date), shift.id, b, user, meta.ip);
  return json(await buildReport(String(b.date), shift.code, meta.now));
});
