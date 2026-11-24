import { getMeta, handle, json, readJson, requireUser } from "@/lib/http";
import { revokeExtension } from "@/lib/services/registration";

export const POST = handle(async (req) => {
  const user = await requireUser(req);
  const meta = getMeta(req);
  const b = await readJson<{ employeeId?: number }>(req);
  await revokeExtension(Number(b.employeeId), { type: "USER", user }, meta.ip, meta.now);
  return json({ ok: true });
});
