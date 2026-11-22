import { AppError } from "@/lib/errors";
import { getMeta, handle, json, readJson, requireUser } from "@/lib/http";
import { decideLeaveRequest } from "@/lib/services/leave";

export const POST = handle<{ params: Promise<{ id: string }> }>(async (req, { params }) => {
  const user = await requireUser(req);
  const meta = getMeta(req);
  const { id } = await params;
  const b = await readJson<{ decision: string; note?: string }>(req);
  if (b.decision !== "APROBAR" && b.decision !== "RECHAZAR") throw new AppError(400, "BAD_DECISION", "Decisión no válida.");
  return json({ ok: true, ...(await decideLeaveRequest(Number(id), b.decision, b.note ?? "", user, meta.ip, meta.now)) });
});
