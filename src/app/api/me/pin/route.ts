import { changeEmployeePin } from "@/lib/services/auth";
import { getMeta, handle, json, readJson, requireEmployee } from "@/lib/http";

export const POST = handle(async (req) => {
  const employee = await requireEmployee(req);
  const b = await readJson<{ currentPin?: string; newPin?: string; newPinConfirm?: string }>(req);
  await changeEmployeePin(employee, {
    currentPin: String(b.currentPin ?? ""), newPin: String(b.newPin ?? ""), newPinConfirm: String(b.newPinConfirm ?? ""),
  }, getMeta(req));
  return json({ ok: true });
});
