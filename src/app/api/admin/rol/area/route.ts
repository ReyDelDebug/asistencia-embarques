import { getMeta, handle, json, readJson, requireUser } from "@/lib/http";
import { changeArea } from "@/lib/services/rol";

export const POST = handle(async (req) => {
  const user = await requireUser(req);
  const meta = getMeta(req);
  const b = await readJson<{ employeeId: number; shiftCode: string; departmentId: number; subareaId?: number | null; effectiveFrom: string; endDate?: string | null }>(req);
  return json({ ok: true, ...(await changeArea(b, user, meta.ip, meta.now)) });
});
