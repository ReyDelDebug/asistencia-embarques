import { NextResponse } from "next/server";
import { getMeta, handle, requireUser } from "@/lib/http";
import { buildReport, recordReportAction } from "@/lib/services/report";

export const dynamic = "force-dynamic";

export const GET = handle(async (req) => {
  const user = await requireUser(req);
  const meta = getMeta(req);
  const sp = req.nextUrl.searchParams;
  const report = await buildReport(sp.get("date") ?? "", sp.get("shift") ?? "", meta.now);
  await recordReportAction(report.date, report.shiftId, "EXPORT", report.text, user, meta.ip);
  const filename = `reporte_${report.shiftCode.toLowerCase()}_${report.date}.txt`;
  return new NextResponse("﻿" + report.text.replace(/\n/g, "\r\n"), {
    headers: {
      "Content-Type": "text/plain; charset=utf-8",
      "Content-Disposition": `attachment; filename="${filename}"`,
      "Cache-Control": "no-store",
    },
  });
});
