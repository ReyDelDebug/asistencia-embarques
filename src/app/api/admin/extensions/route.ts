import { getMeta, handle, json, readJson, requireUser } from "@/lib/http";
import { grantExtensions } from "@/lib/services/registration";

/** El SUPERVISOR abre el registro hasta las 7:30 a una o varias personas. */
export const POST = handle(async (req) => {
  const user = await requireUser(req);
  const meta = getMeta(req);
  const b = await readJson<{ employeeIds?: number[] }>(req);
  return json({ ok: true, ...(await grantExtensions(b.employeeIds ?? [], { type: "USER", user }, meta.ip, meta.now)) });
});
