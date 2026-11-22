import { getMeta, handle, json, readJson, requireUser } from "@/lib/http";
import { changeOwnPassword } from "@/lib/services/auth";

export const POST = handle(async (req) => {
  const user = await requireUser(req);
  const meta = getMeta(req);
  const b = await readJson<{ currentPassword: string; newPassword: string }>(req);
  await changeOwnPassword(user, String(b.currentPassword ?? ""), String(b.newPassword ?? ""), meta.ip);
  return json({ ok: true });
});
