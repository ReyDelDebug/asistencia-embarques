import { getMeta, handle, json, readJson, requireEmployee } from "@/lib/http";
import { grantExtensions } from "@/lib/services/registration";

/** El LÍDER abre el registro hasta las 7:30 a personas de su área. */
export const POST = handle(async (req) => {
  const employee = await requireEmployee(req);
  const meta = getMeta(req);
  const b = await readJson<{ employeeIds?: number[] }>(req);
  return json({ ok: true, ...(await grantExtensions(b.employeeIds ?? [], { type: "LEADER", employee }, meta.ip, meta.now)) });
});
