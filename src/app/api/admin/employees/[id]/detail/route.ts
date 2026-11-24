import { handle, json, requireUser } from "@/lib/http";
import { getEmployeeDetail } from "@/lib/services/profile";

export const dynamic = "force-dynamic";

export const GET = handle<{ params: Promise<{ id: string }> }>(async (req, { params }) => {
  await requireUser(req);
  const { id } = await params;
  return json(await getEmployeeDetail(Number(id), new Date()));
});
