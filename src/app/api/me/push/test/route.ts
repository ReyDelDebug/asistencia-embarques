import { handle, json, requireEmployee } from "@/lib/http";
import { sendTestNotification } from "@/lib/services/push";

export const POST = handle(async (req) => {
  const employee = await requireEmployee(req);
  return json({ ok: true, ...(await sendTestNotification(employee)) });
});
