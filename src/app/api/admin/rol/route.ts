import { getMeta, handle, json, readJson, requireUser } from "@/lib/http";
import { loadCatalog } from "@/lib/services/roster";
import { getRol, mondayOf, saveRol } from "@/lib/services/rol";
import { getLocalParts } from "@/lib/time";

export const dynamic = "force-dynamic";

export const GET = handle(async (req) => {
  await requireUser(req);
  const today = getLocalParts(new Date()).date;
  const date = req.nextUrl.searchParams.get("date") || today;
  const catalog = await loadCatalog();
  return json({ date, today, currentMonday: mondayOf(today), rows: await getRol(date), ...catalog });
});

export const PUT = handle(async (req) => {
  const user = await requireUser(req);
  const meta = getMeta(req);
  const b = await readJson<{ effectiveFrom: string; items: { employeeId: number; shiftCode: string }[] }>(req);
  const result = await saveRol(String(b.effectiveFrom), b.items, user, meta.ip, meta.now);
  return json({ ok: true, ...result });
});
