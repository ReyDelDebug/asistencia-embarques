import { timingSafeEqual } from "node:crypto";
import type { NextRequest } from "next/server";
import { AppError } from "@/lib/errors";
import { handle, json } from "@/lib/http";
import { logAudit } from "@/lib/services/audit";
import { pushConfig, sendReminders } from "@/lib/services/push";

export const dynamic = "force-dynamic";

function authorize(req: NextRequest) {
  const secret = process.env.CRON_SECRET ?? "";
  if (secret.length < 16) throw new AppError(503, "CRON_DISABLED", "CRON_SECRET no está configurado (mínimo 16 caracteres).");
  const header = req.headers.get("authorization") ?? "";
  const given = Buffer.from(header.replace(/^Bearer\s+/i, ""));
  const expected = Buffer.from(secret);
  if (given.length !== expected.length || !timingSafeEqual(given, expected)) {
    throw new AppError(401, "UNAUTHORIZED", "No autorizado.");
  }
}

async function run(req: NextRequest) {
  authorize(req);
  if (!pushConfig()) throw new AppError(503, "PUSH_DISABLED", "Faltan las llaves VAPID en el servidor.");
  const result = await sendReminders(new Date());
  if (result.results.length) {
    await logAudit({ actorType: "SYSTEM", actorLabel: "recordatorios", action: "PUSH_REMINDERS_SENT", entity: "push", details: result });
  }
  return json({ ok: true, ...result });
}

export const GET = handle(run);
export const POST = handle(run);
