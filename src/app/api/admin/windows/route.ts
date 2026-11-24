import { AppError } from "@/lib/errors";
import { getMeta, handle, json, readJson, requireUser } from "@/lib/http";
import { getWindowStatus, setWindow } from "@/lib/services/windows";

export const dynamic = "force-dynamic";

export const GET = handle(async (req) => {
  await requireUser(req);
  return json({ windows: await getWindowStatus(new Date()) });
});

export const POST = handle(async (req) => {
  const user = await requireUser(req);
  const meta = getMeta(req);
  const b = await readJson<{ shift?: string; action?: string }>(req);
  if (!["OPEN", "CLOSE", "RESET"].includes(String(b.action))) throw new AppError(400, "BAD_ACTION", "Acción no válida.");
  const r = await setWindow(String(b.shift), b.action as "OPEN", user, meta.ip, meta.now);
  return json({ ok: true, ...r, windows: await getWindowStatus(meta.now) });
});
