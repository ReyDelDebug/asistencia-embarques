import { query, type Queryable } from "../db";

export type ActorType = "USER" | "EMPLOYEE" | "SYSTEM" | "ANONYMOUS";

export interface AuditEntry {
  actorType: ActorType;
  actorId?: number | null;
  actorLabel?: string | null;
  action: string;
  entity?: string | null;
  entityId?: string | number | null;
  details?: Record<string, unknown>;
  ip?: string | null;
}

export async function logAudit(entry: AuditEntry, client?: Queryable): Promise<void> {
  await query(
    `INSERT INTO audit_logs (actor_type, actor_id, actor_label, action, entity, entity_id, details, ip)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
    [
      entry.actorType,
      entry.actorId ?? null,
      entry.actorLabel ?? null,
      entry.action,
      entry.entity ?? null,
      entry.entityId != null ? String(entry.entityId) : null,
      JSON.stringify(entry.details ?? {}),
      entry.ip ?? null,
    ],
    client,
  );
}

export interface AuditRow {
  id: number;
  actor_type: ActorType;
  actor_id: number | null;
  actor_label: string | null;
  action: string;
  entity: string | null;
  entity_id: string | null;
  details: Record<string, unknown>;
  ip: string | null;
  created_at: Date;
}

export async function listAudit(opts: {
  limit?: number;
  offset?: number;
  entity?: string;
  entityId?: string;
  action?: string;
}): Promise<{ rows: AuditRow[]; total: number }> {
  const where: string[] = [];
  const params: unknown[] = [];
  if (opts.entity) { params.push(opts.entity); where.push(`entity = $${params.length}`); }
  if (opts.entityId) { params.push(opts.entityId); where.push(`entity_id = $${params.length}`); }
  if (opts.action) { params.push(`${opts.action}%`); where.push(`action LIKE $${params.length}`); }
  const w = where.length ? `WHERE ${where.join(" AND ")}` : "";
  const totalRow = await query<{ n: number }>(`SELECT count(*)::int AS n FROM audit_logs ${w}`, params);
  params.push(Math.min(opts.limit ?? 50, 500), opts.offset ?? 0);
  const rows = await query<AuditRow>(
    `SELECT * FROM audit_logs ${w} ORDER BY created_at DESC, id DESC
     LIMIT $${params.length - 1} OFFSET $${params.length}`,
    params,
  );
  return { rows, total: totalRow[0]?.n ?? 0 };
}
