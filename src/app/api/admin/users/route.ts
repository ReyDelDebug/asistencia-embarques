import { getMeta, handle, json, readJson, requireUser } from "@/lib/http";
import { assertAdmin, createUser, listUsers } from "@/lib/services/users";

export const dynamic = "force-dynamic";

export const GET = handle(async (req) => {
  const user = await requireUser(req);
  assertAdmin(user);
  return json({ users: await listUsers() });
});

export const POST = handle(async (req) => {
  const user = await requireUser(req);
  const meta = getMeta(req);
  const b = await readJson<{ username: string; displayName: string; role: string; employeeId?: number | null }>(req);
  return json({ ok: true, ...(await createUser(b, user, meta.ip)) }, 201);
});
