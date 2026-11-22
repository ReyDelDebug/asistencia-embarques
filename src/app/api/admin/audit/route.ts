import { handle, intParam, json, requireUser } from "@/lib/http";
import { listAudit } from "@/lib/services/audit";

export const dynamic = "force-dynamic";

export const GET = handle(async (req) => {
  await requireUser(req);
  const sp = req.nextUrl.searchParams;
  return json(await listAudit({
    limit: intParam(sp.get("limit")) ?? 50,
    offset: Number(sp.get("offset") ?? 0) || 0,
    action: sp.get("action") || undefined,
    entity: sp.get("entity") || undefined,
    entityId: sp.get("entityId") || undefined,
  }));
});
