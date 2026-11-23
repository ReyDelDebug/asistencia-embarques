import { handle, json, requireEmployee } from "@/lib/http";
import { getMyGroup } from "@/lib/services/group";

export const dynamic = "force-dynamic";

export const GET = handle(async (req) => {
  const employee = await requireEmployee(req);
  return json(await getMyGroup(employee, new Date(), req.nextUrl.searchParams.get("shift")));
});
