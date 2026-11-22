import { EMPLOYEE_COOKIE, loginEmployee } from "@/lib/services/auth";
import { getMeta, handle, json, readJson, setSessionCookie } from "@/lib/http";

export const POST = handle(async (req) => {
  const body = await readJson<{ employeeNumber?: string; pin?: string }>(req);
  const { token, expiresAt, employee } = await loginEmployee(
    { employeeNumber: String(body.employeeNumber ?? ""), pin: String(body.pin ?? "") },
    getMeta(req),
  );
  const res = json({ ok: true, employee: { fullName: employee.fullName } });
  setSessionCookie(res, EMPLOYEE_COOKIE, token, expiresAt);
  return res;
});
