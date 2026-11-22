import { NextResponse } from "next/server";
import { getMeta, handle, intParam, requireUser } from "@/lib/http";
import { logAudit } from "@/lib/services/audit";
import { getShiftByCode } from "@/lib/services/catalog";
import { buildAttendanceWorkbook } from "@/lib/services/excel";
import { getLocalParts } from "@/lib/time";

export const dynamic = "force-dynamic";

export const GET = handle(async (req) => {
  const user = await requireUser(req);
  const meta = getMeta(req);
  const sp = req.nextUrl.searchParams;
  const today = getLocalParts(meta.now).date;
  const from = sp.get("from") || sp.get("date") || today;
  const to = sp.get("to") || from;
  const shiftCode = sp.get("shift");
  const shift = shiftCode ? await getShiftByCode(shiftCode) : null;
  const departmentId = intParam(sp.get("dept"));
  const { buffer, filename } = await buildAttendanceWorkbook({ from, to, shiftId: shift?.id ?? null, departmentId }, meta.now);
  await logAudit({
    actorType: "USER", actorId: user.id, actorLabel: user.displayName, action: "EXCEL_EXPORTED",
    entity: "export", details: { from, to, shift: shift?.code ?? null, departmentId }, ip: meta.ip,
  });
  return new NextResponse(new Uint8Array(buffer), {
    headers: {
      "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "Content-Disposition": `attachment; filename="${filename}"`,
      "Cache-Control": "no-store",
    },
  });
});
