import { getMeta, handle, json, readJson, requireUser } from "@/lib/http";
import { updateEmployee, type EmployeeRole } from "@/lib/services/employees";

export const PATCH = handle<{ params: Promise<{ id: string }> }>(async (req, { params }) => {
  const user = await requireUser(req);
  const meta = getMeta(req);
  const { id } = await params;
  const b = await readJson<{ employeeNumber?: string; fullName: string; role: EmployeeRole; departmentId: number | null; shiftId: number }>(req);
  await updateEmployee(Number(id), b, user, meta.ip);
  return json({ ok: true });
});
