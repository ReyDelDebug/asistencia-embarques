import { handle, json, requireUser } from "@/lib/http";
import { getEmployeeHistory } from "@/lib/services/incidents";

export const dynamic = "force-dynamic";

export const GET = handle<{ params: Promise<{ id: string }> }>(async (req, { params }) => {
  await requireUser(req);
  const { id } = await params;
  return json(await getEmployeeHistory(Number(id)));
});
