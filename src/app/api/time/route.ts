import { getLocalParts } from "@/lib/time";
import { handle, json } from "@/lib/http";

export const dynamic = "force-dynamic";

export const GET = handle(async () => {
  const now = new Date();
  const local = getLocalParts(now);
  return json({ serverTime: now.toISOString(), localDate: local.date, localTime: local.time });
});
