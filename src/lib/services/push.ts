/**
 * Notificaciones push (Web Push con llaves VAPID).
 * Un programador externo (Supabase pg_cron) llama a /api/cron/reminders a las
 * 7:05, 7:15, 19:05 y 19:15. Aquí se decide a quién avisar: empleados cuyo
 * turno de HOY cierra pronto, que no han registrado, sin incidencia y sin
 * aviso de retardo. Cada recordatorio se manda una sola vez por persona.
 */
import { sendNotification } from "web-push";
import { query, queryOne } from "../db";
import { AppError } from "../errors";
import { formatTime12, getLocalParts, timeToSeconds } from "../time";
import { logAudit } from "./audit";
import type { SessionEmployee } from "./auth";
import { getShifts } from "./catalog";

export interface PushSub { endpoint: string; keys: { p256dh: string; auth: string } }
export type PushSender = (sub: PushSub, payload: string) => Promise<{ statusCode: number }>;

export function pushConfig(): { publicKey: string; privateKey: string; subject: string } | null {
  const publicKey = process.env.VAPID_PUBLIC_KEY?.trim();
  const privateKey = process.env.VAPID_PRIVATE_KEY?.trim();
  const subject = process.env.VAPID_SUBJECT?.trim() || "mailto:soporte@example.com";
  return publicKey && privateKey ? { publicKey, privateKey, subject } : null;
}

export const webPushSender: PushSender = async (sub, payload) => {
  const cfg = pushConfig();
  if (!cfg) throw new AppError(503, "PUSH_DISABLED", "Las notificaciones no están configuradas en el servidor.");
  try {
    const r = await sendNotification(sub, payload, {
      vapidDetails: { subject: cfg.subject, publicKey: cfg.publicKey, privateKey: cfg.privateKey },
      TTL: 15 * 60,
      urgency: "high",
    });
    return { statusCode: r.statusCode };
  } catch (err) {
    const e = err as { statusCode?: number };
    return { statusCode: e.statusCode ?? 500 };
  }
};

export async function saveSubscription(employee: SessionEmployee, sub: PushSub, userAgent: string): Promise<void> {
  const endpoint = String(sub?.endpoint ?? "");
  let url: URL;
  try { url = new URL(endpoint); } catch { throw new AppError(400, "BAD_SUBSCRIPTION", "Suscripción no válida."); }
  if (url.protocol !== "https:" || endpoint.length > 1000) throw new AppError(400, "BAD_SUBSCRIPTION", "Suscripción no válida.");
  const p256dh = String(sub?.keys?.p256dh ?? "");
  const auth = String(sub?.keys?.auth ?? "");
  if (!/^[A-Za-z0-9_-]{40,200}={0,2}$/.test(p256dh) || !/^[A-Za-z0-9_-]{10,100}={0,2}$/.test(auth)) {
    throw new AppError(400, "BAD_SUBSCRIPTION", "Suscripción no válida.");
  }
  await query(
    `INSERT INTO push_subscriptions (employee_id, endpoint, p256dh, auth, user_agent) VALUES ($1, $2, $3, $4, $5)
     ON CONFLICT (endpoint) DO UPDATE SET employee_id = EXCLUDED.employee_id, p256dh = EXCLUDED.p256dh,
       auth = EXCLUDED.auth, user_agent = EXCLUDED.user_agent, failures = 0`,
    [employee.id, endpoint, p256dh, auth, userAgent.slice(0, 300)],
  );
  await logAudit({ actorType: "EMPLOYEE", actorId: employee.id, actorLabel: employee.fullName, action: "PUSH_ENABLED", entity: "employee", entityId: employee.id });
}

export async function removeSubscription(employee: SessionEmployee, endpoint: string): Promise<void> {
  await query(`DELETE FROM push_subscriptions WHERE employee_id = $1 AND endpoint = $2`, [employee.id, String(endpoint ?? "")]);
}

export async function countSubscriptions(employeeId: number): Promise<number> {
  const r = await queryOne<{ n: number }>(`SELECT count(*)::int n FROM push_subscriptions WHERE employee_id = $1`, [employeeId]);
  return r?.n ?? 0;
}

async function deliver(employeeId: number, payload: object, sender: PushSender): Promise<{ sent: number; removed: number }> {
  const subs = await query<{ id: number; endpoint: string; p256dh: string; auth: string }>(
    `SELECT id, endpoint, p256dh, auth FROM push_subscriptions WHERE employee_id = $1`, [employeeId]);
  let sent = 0;
  let removed = 0;
  for (const s of subs) {
    const r = await sender({ endpoint: s.endpoint, keys: { p256dh: s.p256dh, auth: s.auth } }, JSON.stringify(payload));
    if (r.statusCode >= 200 && r.statusCode < 300) {
      sent++;
      await query(`UPDATE push_subscriptions SET last_success_at = now(), failures = 0 WHERE id = $1`, [s.id]);
    } else if (r.statusCode === 404 || r.statusCode === 410) {
      removed++; // la suscripción ya no existe (desinstaló o revocó el permiso)
      await query(`DELETE FROM push_subscriptions WHERE id = $1`, [s.id]);
    } else {
      await query(`UPDATE push_subscriptions SET failures = failures + 1 WHERE id = $1`, [s.id]);
      await query(`DELETE FROM push_subscriptions WHERE id = $1 AND failures >= 5`, [s.id]);
    }
  }
  return { sent, removed };
}

export async function sendTestNotification(employee: SessionEmployee, sender: PushSender = webPushSender) {
  const r = await deliver(employee.id, {
    title: "Control de Asistencia",
    body: "Así te llegarán los recordatorios cuando estés cerca de la hora límite.",
    url: "/",
    tag: "prueba",
  }, sender);
  if (r.sent === 0) throw new AppError(409, "NO_SUBSCRIPTION", "No se pudo enviar. Vuelve a activar los avisos en este celular.");
  return r;
}

/** Recordatorios: 15 min antes (7:05 / 19:05) y 5 min antes (7:15 / 19:15) del cierre. */
export const REMINDERS = [
  { kind: "R15", minLeft: 10 * 60, maxLeft: 17 * 60 },
  { kind: "R5", minLeft: 1, maxLeft: 8 * 60 },
] as const;

export async function sendReminders(now: Date, sender: PushSender = webPushSender) {
  const shifts = await getShifts();
  const local = getLocalParts(now);
  const results: { shift: string; kind: string; targets: number; sent: number; removed: number }[] = [];

  for (const shift of shifts) {
    const left = timeToSeconds(shift.closeTime) - local.seconds;
    const reminder = REMINDERS.find((r) => left >= r.minLeft && left <= r.maxLeft);
    if (!reminder) continue;
    const minutes = Math.max(1, Math.round(left / 60));
    const targets = await query<{ id: number; full_name: string }>(
      `SELECT e.id, e.full_name FROM employees e
       WHERE e.active
         AND employee_shift_on(e.id, $1) = $2
         AND EXISTS (SELECT 1 FROM push_subscriptions ps WHERE ps.employee_id = e.id)
         AND NOT EXISTS (SELECT 1 FROM attendance a WHERE a.employee_id = e.id AND a.operational_date = $1)
         AND NOT EXISTS (SELECT 1 FROM incidents i WHERE i.employee_id = e.id AND i.operational_date = $1 AND i.revoked_at IS NULL)
         AND NOT EXISTS (SELECT 1 FROM late_notices ln WHERE ln.employee_id = e.id AND ln.operational_date = $1)`,
      [local.date, shift.id],
    );
    let sent = 0;
    let removed = 0;
    for (const t of targets) {
      const fresh = await queryOne<{ employee_id: number }>(
        `INSERT INTO push_reminders_sent (employee_id, operational_date, shift_id, kind) VALUES ($1, $2, $3, $4)
         ON CONFLICT DO NOTHING RETURNING employee_id`,
        [t.id, local.date, shift.id, reminder.kind],
      );
      if (!fresh) continue; // ya se le envió este recordatorio
      const close = formatTime12(shift.closeTime);
      const r = await deliver(t.id, {
        title: reminder.kind === "R15" ? "⏰ Aún no registras tu asistencia" : "⚠️ Últimos minutos para registrar",
        body: reminder.kind === "R15"
          ? `${t.full_name.split(" ")[0]}, el registro cierra a las ${close} (faltan ${minutes} min).`
          : `Faltan ${minutes} min: registra antes de las ${close}. Si vas a llegar tarde, avisa en la app.`,
        url: "/",
        tag: `recordatorio-${local.date}-${shift.code}`,
      }, sender);
      sent += r.sent;
      removed += r.removed;
    }
    results.push({ shift: shift.code, kind: reminder.kind, targets: targets.length, sent, removed });
  }
  return { localTime: local.time, results };
}
