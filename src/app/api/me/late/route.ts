import { getMeta, handle, json, readJson, requireEmployee } from "@/lib/http";
import { createLateNotice } from "@/lib/services/registration";

export const POST = handle(async (req) => {
  const employee = await requireEmployee(req);
  const meta = getMeta(req);
  const b = await readJson<{ eta?: string; reason?: string }>(req);
  return json({ ok: true, notice: await createLateNotice(employee, { eta: String(b.eta ?? ""), reason: String(b.reason ?? "") }, meta.ip, meta.now) }, 201);
});
