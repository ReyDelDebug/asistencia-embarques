import { getMeta, handle, json, readJson, requireUser } from "@/lib/http";
import { terminateEmployee } from "@/lib/services/employees";

export const POST = handle<{ params: Promise<{ id: string }> }>(async (req, { params }) => {
  const user = await requireUser(req);
  const meta = getMeta(req);
  const { id } = await params;
  const b = await readJson<{ reason: string; date?: string }>(req);
  await terminateEmployee(Number(id), b.reason, b.date, user, meta.ip, meta.now);
  return json({ ok: true });
});
