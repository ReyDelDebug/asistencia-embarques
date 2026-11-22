import { AppError } from "@/lib/errors";
import { getMeta, handle, json, readJson, requireUser } from "@/lib/http";
import { buildReport, recordReportAction } from "@/lib/services/report";

export const POST = handle(async (req) => {
  const user = await requireUser(req);
  const meta = getMeta(req);
  const b = await readJson<{ date: string; shift: string; action: string }>(req);
  if (!["COPY", "SHARE", "EXPORT"].includes(b.action)) throw new AppError(400, "BAD_ACTION", "Acción no válida.");
  const report = await buildReport(String(b.date), String(b.shift), meta.now);
  await recordReportAction(report.date, report.shiftId, b.action as "COPY", report.text, user, meta.ip);
  return json({ ok: true, text: report.text });
});
