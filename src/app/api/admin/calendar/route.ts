import { AppError } from "@/lib/errors";
import { getMeta, handle, json, readJson, requireUser } from "@/lib/http";
import { getDaysInfo, resetCalendarDay, setCalendarDay } from "@/lib/services/calendar";

export const dynamic = "force-dynamic";

export const GET = handle(async (req) => {
  await requireUser(req);
  const month = req.nextUrl.searchParams.get("month") ?? "";
  if (!/^\d{4}-\d{2}$/.test(month)) throw new AppError(400, "BAD_MONTH", "Mes no válido.");
  const [y, m] = month.split("-").map(Number);
  const last = new Date(Date.UTC(y, m, 0)).getUTCDate();
  return json({ days: await getDaysInfo(`${month}-01`, `${month}-${String(last).padStart(2, "0")}`) });
});

export const PUT = handle(async (req) => {
  const user = await requireUser(req);
  const b = await readJson<{ date: string; type: string; label?: string }>(req);
  return json({ ok: true, day: await setCalendarDay(String(b.date), String(b.type), String(b.label ?? ""), user, getMeta(req).ip) });
});

export const DELETE = handle(async (req) => {
  const user = await requireUser(req);
  const b = await readJson<{ date: string }>(req);
  return json({ ok: true, day: await resetCalendarDay(String(b.date), user, getMeta(req).ip) });
});
