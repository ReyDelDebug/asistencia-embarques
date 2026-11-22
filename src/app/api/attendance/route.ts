import { confirmAttendance, getAttendanceView } from "@/lib/services/attendance";
import { getMeta, handle, json, requireEmployee } from "@/lib/http";

export const dynamic = "force-dynamic";

export const GET = handle(async (req) => {
  const employee = await requireEmployee(req);
  return json(await getAttendanceView(employee, new Date()));
});

export const POST = handle(async (req) => {
  const employee = await requireEmployee(req);
  const record = await confirmAttendance(employee.id, getMeta(req));
  return json({ ok: true, record }, 201);
});
