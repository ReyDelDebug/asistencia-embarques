import { getMeta, handle, json, readJson, requireUser } from "@/lib/http";
import { endSupport } from "@/lib/services/rol";

export const POST = handle(async (req) => {
  const user = await requireUser(req);
  const meta = getMeta(req);
  const b = await readJson<{ employeeId: number }>(req);
  await endSupport(Number(b.employeeId), user, meta.ip, meta.now);
  return json({ ok: true });
});
