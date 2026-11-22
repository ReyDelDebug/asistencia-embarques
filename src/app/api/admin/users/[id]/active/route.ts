import { getMeta, handle, json, readJson, requireUser } from "@/lib/http";
import { setUserActive } from "@/lib/services/users";

export const POST = handle<{ params: Promise<{ id: string }> }>(async (req, { params }) => {
  const user = await requireUser(req);
  const meta = getMeta(req);
  const { id } = await params;
  const b = await readJson<{ active: boolean }>(req);
  await setUserActive(Number(id), Boolean(b.active), user, meta.ip);
  return json({ ok: true });
});
