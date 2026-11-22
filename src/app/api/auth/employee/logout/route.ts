import { EMPLOYEE_COOKIE, revokeSession } from "@/lib/services/auth";
import { clearSessionCookie, handle, json } from "@/lib/http";

export const POST = handle(async (req) => {
  await revokeSession(req.cookies.get(EMPLOYEE_COOKIE)?.value);
  const res = json({ ok: true });
  clearSessionCookie(res, EMPLOYEE_COOKIE);
  return res;
});
