import { getMeta, handle, json, requireUser } from "@/lib/http";
import { deleteEmployeePhoto } from "@/lib/services/photos";

export const DELETE = handle<{ params: Promise<{ id: string }> }>(async (req, { params }) => {
  const user = await requireUser(req);
  const { id } = await params;
  await deleteEmployeePhoto(Number(id), { type: "USER", user }, getMeta(req).ip);
  return json({ ok: true });
});
