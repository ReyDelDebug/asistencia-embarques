import { handle, json, requireUser } from "@/lib/http";
import { nextEmployeeNumber, type EmployeeRole } from "@/lib/services/employees";

export const dynamic = "force-dynamic";

export const GET = handle(async (req) => {
  await requireUser(req);
  const sp = req.nextUrl.searchParams;
  const role = (sp.get("role") ?? "EMPLOYEE") as EmployeeRole;
  return json({ employeeNumber: await nextEmployeeNumber(sp.get("shift") ?? "DIA", role) });
});
