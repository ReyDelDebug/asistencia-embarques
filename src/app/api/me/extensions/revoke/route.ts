import { getMeta, handle, json, readJson, requireEmployee } from "@/lib/http";
import { revokeExtension } from "@/lib/services/registration";

export const POST = handle(async (req) => {
  const employee = await requireEmployee(req);
  const meta = getMeta(req);
  const b = await readJson<{ employeeId?: number }>(req);
  await revokeExtension(Number(b.employeeId), { type: "LEADER", employee }, meta.ip, meta.now);
  return json({ ok: true });
});
