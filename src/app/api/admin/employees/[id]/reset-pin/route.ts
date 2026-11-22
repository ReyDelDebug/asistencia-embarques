import { getMeta, handle, json, requireUser } from "@/lib/http";
import { resetEmployeePin } from "@/lib/services/employees";

export const POST = handle<{ params: Promise<{ id: string }> }>(async (req, { params }) => {
  const user = await requireUser(req);
  const meta = getMeta(req);
  const { id } = await params;
  const result = await resetEmployeePin(Number(id), user, meta.ip);
  return json({ ok: true, ...result });
});
