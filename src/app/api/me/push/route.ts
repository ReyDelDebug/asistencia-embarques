import { getMeta, handle, json, readJson, requireEmployee } from "@/lib/http";
import { countSubscriptions, removeSubscription, saveSubscription, type PushSub } from "@/lib/services/push";

export const dynamic = "force-dynamic";

export const GET = handle(async (req) => {
  const employee = await requireEmployee(req);
  return json({ subscriptions: await countSubscriptions(employee.id) });
});

export const POST = handle(async (req) => {
  const employee = await requireEmployee(req);
  const b = await readJson<{ subscription?: PushSub }>(req);
  await saveSubscription(employee, b.subscription as PushSub, getMeta(req).userAgent);
  return json({ ok: true }, 201);
});

export const DELETE = handle(async (req) => {
  const employee = await requireEmployee(req);
  const b = await readJson<{ endpoint?: string }>(req);
  await removeSubscription(employee, String(b.endpoint ?? ""));
  return json({ ok: true });
});
