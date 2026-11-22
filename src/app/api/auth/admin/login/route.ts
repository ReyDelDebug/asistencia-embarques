import { ADMIN_COOKIE, loginUser } from "@/lib/services/auth";
import { getMeta, handle, json, readJson, setSessionCookie } from "@/lib/http";

export const POST = handle(async (req) => {
  const body = await readJson<{ username?: string; password?: string }>(req);
  const { token, expiresAt, user } = await loginUser(
    { username: String(body.username ?? ""), password: String(body.password ?? "") },
    getMeta(req),
  );
  const res = json({ ok: true, user: { displayName: user.displayName, role: user.role } });
  setSessionCookie(res, ADMIN_COOKIE, token, expiresAt);
  return res;
});
