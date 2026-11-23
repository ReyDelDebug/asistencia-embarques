import { getMeta, handle, json, readJson, requireEmployee } from "@/lib/http";
import { deleteEmployeePhoto, setEmployeePhoto } from "@/lib/services/photos";

export const PUT = handle(async (req) => {
  const employee = await requireEmployee(req);
  const b = await readJson<{ image?: string }>(req);
  return json({ ok: true, ...(await setEmployeePhoto(employee, String(b.image ?? ""), getMeta(req).ip)) });
});

export const DELETE = handle(async (req) => {
  const employee = await requireEmployee(req);
  await deleteEmployeePhoto(employee.id, { type: "EMPLOYEE", employee }, getMeta(req).ip);
  return json({ ok: true });
});
