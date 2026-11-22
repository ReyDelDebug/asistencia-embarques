import { getMeta, handle, json, readJson, requireUser } from "@/lib/http";
import { revokeIncident } from "@/lib/services/incidents";

export const POST = handle<{ params: Promise<{ id: string }> }>(async (req, { params }) => {
  const user = await requireUser(req);
  const meta = getMeta(req);
  const { id } = await params;
  const b = await readJson<{ reason: string }>(req);
  await revokeIncident(Number(id), b.reason, user, meta.ip, meta.now);
  return json({ ok: true });
});
