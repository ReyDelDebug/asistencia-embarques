import { getMeta, handle, json, readJson, requireUser } from "@/lib/http";
import { createEmployee, listEmployees, type EmployeeRole } from "@/lib/services/employees";

export const dynamic = "force-dynamic";

export const GET = handle(async (req) => {
  await requireUser(req);
  return json({ employees: await listEmployees() });
});

export const POST = handle(async (req) => {
  const user = await requireUser(req);
  const meta = getMeta(req);
  const b = await readJson<{ employeeNumber?: string; fullName: string; role: EmployeeRole; departmentId: number | null; shiftId: number }>(req);
  const created = await createEmployee(b, user, meta.ip);
  return json({ ok: true, ...created }, 201);
});
