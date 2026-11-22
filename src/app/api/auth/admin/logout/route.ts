import { ADMIN_COOKIE, revokeSession } from "@/lib/services/auth";
import { clearSessionCookie, handle, json } from "@/lib/http";

export const POST = handle(async (req) => {
  await revokeSession(req.cookies.get(ADMIN_COOKIE)?.value);
  const res = json({ ok: true });
  clearSessionCookie(res, ADMIN_COOKIE);
  return res;
});
