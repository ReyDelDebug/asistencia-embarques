import { getMeta, handle, json, requireUser } from "@/lib/http";
import { resetUserPassword } from "@/lib/services/users";

export const POST = handle<{ params: Promise<{ id: string }> }>(async (req, { params }) => {
  const user = await requireUser(req);
  const meta = getMeta(req);
  const { id } = await params;
  return json({ ok: true, ...(await resetUserPassword(Number(id), user, meta.ip)) });
});
