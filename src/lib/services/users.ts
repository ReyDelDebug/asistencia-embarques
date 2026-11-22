import { query, queryOne } from "../db";
import { AppError, isUniqueViolation } from "../errors";
import { generatePassword, hashSecret } from "../crypto";
import { logAudit } from "./audit";
import { revokeAllSessions, type SessionUser } from "./auth";

export function assertAdmin(user: SessionUser) {
  if (user.role !== "ADMIN") throw new AppError(403, "FORBIDDEN", "Solo un administrador puede realizar esta acción.");
}

export async function listUsers() {
  return query<{
    id: number; username: string; display_name: string; role: string; active: boolean;
    employee_id: number | null; employee_name: string | null; employee_number: string | null; created_at: Date;
  }>(
    `SELECT u.id, u.username, u.display_name, u.role, u.active, u.employee_id,
            e.full_name AS employee_name, e.employee_number, u.created_at
     FROM users u LEFT JOIN employees e ON e.id = u.employee_id ORDER BY u.active DESC, u.role, u.username`,
  );
}

export async function createUser(
  input: { username: string; displayName: string; role: string; employeeId?: number | null },
  actor: SessionUser,
  ip: string,
): Promise<{ id: number; username: string; password: string }> {
  assertAdmin(actor);
  const username = String(input.username ?? "").trim().toLowerCase();
  if (!/^[a-z0-9._-]{3,40}$/.test(username)) {
    throw new AppError(400, "BAD_USERNAME", "Usuario: 3 a 40 caracteres (letras minúsculas, números, punto, guion).");
  }
  const displayName = String(input.displayName ?? "").trim();
  if (displayName.length < 2) throw new AppError(400, "BAD_NAME", "Nombre para mostrar no válido.");
  const role = input.role === "ADMIN" ? "ADMIN" : "SUPERVISOR";
  const password = generatePassword();
  try {
    const row = await queryOne<{ id: number }>(
      `INSERT INTO users (username, display_name, password_hash, role, employee_id) VALUES ($1, $2, $3, $4, $5) RETURNING id`,
      [username, displayName, await hashSecret(password), role, input.employeeId || null],
    );
    await logAudit({
      actorType: "USER", actorId: actor.id, actorLabel: actor.displayName, action: "USER_CREATED",
      entity: "user", entityId: row!.id, details: { username, role, employeeId: input.employeeId || null }, ip,
    });
    return { id: row!.id, username, password };
  } catch (err) {
    if (isUniqueViolation(err)) throw new AppError(409, "DUPLICATE", "Ese usuario o empleado ya tiene una cuenta.");
    throw err;
  }
}

export async function resetUserPassword(id: number, actor: SessionUser, ip: string): Promise<{ username: string; password: string }> {
  assertAdmin(actor);
  const password = generatePassword();
  const row = await queryOne<{ username: string }>(
    `UPDATE users SET password_hash = $2, failed_attempts = 0, locked_until = NULL, updated_at = now() WHERE id = $1 RETURNING username`,
    [id, await hashSecret(password)],
  );
  if (!row) throw new AppError(404, "NOT_FOUND", "Usuario no encontrado.");
  await revokeAllSessions("USER", id);
  await logAudit({
    actorType: "USER", actorId: actor.id, actorLabel: actor.displayName, action: "USER_PASSWORD_RESET",
    entity: "user", entityId: id, details: { username: row.username }, ip,
  });
  return { username: row.username, password };
}

export async function setUserActive(id: number, active: boolean, actor: SessionUser, ip: string): Promise<void> {
  assertAdmin(actor);
  if (id === actor.id && !active) throw new AppError(400, "SELF", "No puedes desactivar tu propia cuenta.");
  if (!active) {
    const admins = await queryOne<{ n: number }>(
      `SELECT count(*)::int AS n FROM users WHERE role = 'ADMIN' AND active AND id <> $1`, [id],
    );
    const target = await queryOne<{ role: string }>(`SELECT role FROM users WHERE id = $1`, [id]);
    if (target?.role === "ADMIN" && (admins?.n ?? 0) === 0) {
      throw new AppError(400, "LAST_ADMIN", "Debe existir al menos un administrador activo.");
    }
  }
  const row = await queryOne<{ id: number }>(`UPDATE users SET active = $2, updated_at = now() WHERE id = $1 RETURNING id`, [id, active]);
  if (!row) throw new AppError(404, "NOT_FOUND", "Usuario no encontrado.");
  if (!active) await revokeAllSessions("USER", id);
  await logAudit({
    actorType: "USER", actorId: actor.id, actorLabel: actor.displayName,
    action: active ? "USER_ACTIVATED" : "USER_DEACTIVATED", entity: "user", entityId: id, ip,
  });
}
