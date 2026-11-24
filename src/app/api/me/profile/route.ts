import { getMeta, handle, json, readJson, requireEmployee } from "@/lib/http";
import { getProfile, getVacationSummary, updateMyProfile } from "@/lib/services/profile";

export const dynamic = "force-dynamic";

export const GET = handle(async (req) => {
  const employee = await requireEmployee(req);
  const now = new Date();
  return json({ profile: await getProfile(employee.id), vacations: await getVacationSummary(employee.id, now) });
});

export const PUT = handle(async (req) => {
  const employee = await requireEmployee(req);
  const meta = getMeta(req);
  const b = await readJson<{ fullName: string; phone: string; birthDate: string; bootSize: number | string; vestSize: string }>(req);
  return json({ ok: true, profile: await updateMyProfile(employee, b, meta.ip, meta.now) });
});
