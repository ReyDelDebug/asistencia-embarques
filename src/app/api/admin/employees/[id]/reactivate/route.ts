import { getMeta, handle, json, readJson, requireUser } from "@/lib/http";
import { reactivateEmployee } from "@/lib/services/employees";

export const POST = handle<{ params: Promise<{ id: string }> }>(async (req, { params }) => {
  const user = await requireUser(req);
  const meta = getMeta(req);
  const { id } = await params;
  const b = await readJson<{ reason: string }>(req);
  await reactivateEmployee(Number(id), b.reason, user, meta.ip);
  return json({ ok: true });
});
