import { AppError } from "@/lib/errors";
import { getMeta, handle, json, requireUser } from "@/lib/http";
import { queryOne } from "@/lib/db";
import { confirmAttendance, getAttendanceView } from "@/lib/services/attendance";
import type { SessionEmployee } from "@/lib/services/auth";

export const dynamic = "force-dynamic";

/** El supervisor registra SU asistencia desde el panel (usa su ficha de empleado vinculada). */
async function linkedEmployee(employeeId: number | null): Promise<SessionEmployee> {
  if (!employeeId) throw new AppError(404, "NO_EMPLOYEE", "Tu usuario no está vinculado a un número de empleado.");
  const e = await queryOne<{
    id: number; employee_number: string; full_name: string; role: SessionEmployee["role"]; department_id: number | null;
    department_name: string | null; subarea_id: number | null; subarea_name: string | null; shift_id: number; shift_code: "DIA" | "NOCHE"; shift_name: string; active: boolean;
  }>(
    `SELECT e.id, e.employee_number, e.full_name, e.role, e.department_id, d.name AS department_name, e.subarea_id, sa.name AS subarea_name,
            e.shift_id, s.code AS shift_code, s.name AS shift_name, e.active
     FROM employees e JOIN shifts s ON s.id = e.shift_id LEFT JOIN departments d ON d.id = e.department_id
     LEFT JOIN subareas sa ON sa.id = e.subarea_id WHERE e.id = $1`, [employeeId]);
  if (!e || !e.active) throw new AppError(404, "NO_EMPLOYEE", "Tu ficha de empleado no está activa.");
  return {
    id: e.id, employeeNumber: e.employee_number, fullName: e.full_name, role: e.role, departmentId: e.department_id,
    departmentName: e.department_name, subareaId: e.subarea_id, subareaName: e.subarea_name, shiftId: e.shift_id,
    shiftCode: e.shift_code, shiftName: e.shift_name,
  };
}

export const GET = handle(async (req) => {
  const user = await requireUser(req);
  if (!user.employeeId) return json({ linked: false });
  return json({ linked: true, view: await getAttendanceView(await linkedEmployee(user.employeeId), new Date()) });
});

export const POST = handle(async (req) => {
  const user = await requireUser(req);
  const emp = await linkedEmployee(user.employeeId);
  return json({ ok: true, record: await confirmAttendance(emp.id, getMeta(req)) }, 201);
});
