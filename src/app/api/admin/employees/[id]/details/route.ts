import { getMeta, handle, json, readJson, requireUser } from "@/lib/http";
import { updateEmployeeDetailsByAdmin } from "@/lib/services/profile";

export const PUT = handle<{ params: Promise<{ id: string }> }>(async (req, { params }) => {
  const user = await requireUser(req);
  const meta = getMeta(req);
  const { id } = await params;
  const b = await readJson<Record<string, string | number | null>>(req);
  await updateEmployeeDetailsByAdmin(Number(id), b as never, user, meta.ip, meta.now);
  return json({ ok: true });
});
