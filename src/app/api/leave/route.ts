import { getMeta, handle, json, readJson, requireEmployee } from "@/lib/http";
import { createLeaveRequest, listMyLeaveRequests } from "@/lib/services/leave";

export const dynamic = "force-dynamic";

export const GET = handle(async (req) => {
  const employee = await requireEmployee(req);
  return json({ requests: await listMyLeaveRequests(employee.id) });
});

export const POST = handle(async (req) => {
  const employee = await requireEmployee(req);
  const meta = getMeta(req);
  const b = await readJson<{ type: string; startDate: string; endDate: string; reason?: string }>(req);
  return json({ ok: true, request: await createLeaveRequest(employee, b, meta.ip, meta.now) }, 201);
});
