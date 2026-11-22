import { getMeta, handle, json, readJson, requireUser } from "@/lib/http";
import { setIncident } from "@/lib/services/incidents";

export const POST = handle(async (req) => {
  const user = await requireUser(req);
  const meta = getMeta(req);
  const b = await readJson<{ employeeId: number; date: string; shiftId?: number; type: string; reason: string }>(req);
  const result = await setIncident(
    { employeeId: Number(b.employeeId), date: String(b.date), shiftId: b.shiftId ? Number(b.shiftId) : null, type: b.type, reason: b.reason },
    user, meta.ip, meta.now,
  );
  return json({ ok: true, ...result }, 201);
});
