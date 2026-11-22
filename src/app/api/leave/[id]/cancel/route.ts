import { getMeta, handle, json, requireEmployee } from "@/lib/http";
import { cancelMyLeaveRequest } from "@/lib/services/leave";

export const POST = handle<{ params: Promise<{ id: string }> }>(async (req, { params }) => {
  const employee = await requireEmployee(req);
  const { id } = await params;
  await cancelMyLeaveRequest(employee, Number(id), getMeta(req).ip);
  return json({ ok: true });
});
