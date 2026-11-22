import { EMPLOYEE_COOKIE, setupEmployeePin } from "@/lib/services/auth";
import { getMeta, handle, json, readJson, setSessionCookie } from "@/lib/http";

export const POST = handle(async (req) => {
  const b = await readJson<{ employeeNumber?: string; pin?: string; pinConfirm?: string }>(req);
  const { token, expiresAt, employee } = await setupEmployeePin(
    { employeeNumber: String(b.employeeNumber ?? ""), pin: String(b.pin ?? ""), pinConfirm: String(b.pinConfirm ?? "") },
    getMeta(req),
  );
  const res = json({ ok: true, employee: { fullName: employee.fullName } }, 201);
  setSessionCookie(res, EMPLOYEE_COOKIE, token, expiresAt);
  return res;
});
