import { handle, json, requireUser } from "@/lib/http";
import { listLeaveRequests } from "@/lib/services/leave";
import { isValidDateString } from "@/lib/time";

export const dynamic = "force-dynamic";

export const GET = handle(async (req) => {
  await requireUser(req);
  const sp = req.nextUrl.searchParams;
  const status = sp.get("status");
  const from = sp.get("from");
  const to = sp.get("to");
  return json({
    requests: await listLeaveRequests({
      status: status && ["PENDIENTE", "APROBADA", "RECHAZADA", "CANCELADA"].includes(status) ? status : null,
      from: from && isValidDateString(from) ? from : null,
      to: to && isValidDateString(to) ? to : null,
    }),
  });
});
