import { query, queryOne } from "../db";
import { AppError } from "../errors";
import { generateToken, hashSecret, isWeakPin, sha256, verifyAgainstDummy, verifySecret } from "../crypto";
import { logAudit } from "./audit";

export const EMPLOYEE_COOKIE = "ea_emp";
export const ADMIN_COOKIE = "ea_adm";

export const EMPLOYEE_SESSION_HOURS = 4;
export const USER_SESSION_HOURS = 12;
export const MAX_FAILED_ATTEMPTS = 5;
export const LOCK_MINUTES = 15;
export const IP_WINDOW_MINUTES = 15;
export const IP_MAX_FAILED = 40;

const GENERIC_EMPLOYEE_ERROR = "Número de empleado o PIN incorrecto.";
const GENERIC_USER_ERROR = "Usuario o contraseña incorrectos.";

export interface RequestMeta {
  ip: string;
  userAgent: string;
  now: Date;
}

// ---------------------------------------------------------------------
// Limitación por IP
// ---------------------------------------------------------------------
async function assertIpNotThrottled(scope: "EMPLOYEE" | "USER", meta: RequestMeta) {
  const since = new Date(meta.now.getTime() - IP_WINDOW_MINUTES * 60_000);
  const row = await queryOne<{ n: number }>(
    `SELECT count(*)::int AS n FROM login_attempts
     WHERE scope = $1 AND ip = $2 AND success = false AND created_at >= $3`,
    [scope, meta.ip, since],
  );
  if ((row?.n ?? 0) >= IP_MAX_FAILED) {
    throw new AppError(429, "TOO_MANY_ATTEMPTS",
      `Demasiados intentos desde esta conexión. Espera ${IP_WINDOW_MINUTES} minutos e intenta de nuevo.`);
  }
}

async function recordAttempt(scope: "EMPLOYEE" | "USER", meta: RequestMeta, identifier: string, success: boolean) {
  await query(
    `INSERT INTO login_attempts (scope, ip, identifier, success, created_at) VALUES ($1, $2, $3, $4, $5)`,
    [scope, meta.ip, identifier.slice(0, 60), success, meta.now],
  );
}

function minutesLeft(until: Date, now: Date): number {
  return Math.max(1, Math.ceil((until.getTime() - now.getTime()) / 60_000));
}

// ---------------------------------------------------------------------
// Sesiones
// ---------------------------------------------------------------------
async function createSession(
  subjectType: "EMPLOYEE" | "USER",
  subjectId: number,
  hours: number,
  meta: RequestMeta,
): Promise<{ token: string; expiresAt: Date }> {
  const token = generateToken();
  const expiresAt = new Date(meta.now.getTime() + hours * 3_600_000);
  await query(
    `INSERT INTO sessions (token_hash, subject_type, subject_id, created_at, expires_at, ip, user_agent)
     VALUES ($1, $2, $3, $4, $5, $6, $7)`,
    [sha256(token), subjectType, subjectId, meta.now, expiresAt, meta.ip, meta.userAgent.slice(0, 300)],
  );
  return { token, expiresAt };
}

export async function revokeSession(token: string | undefined): Promise<void> {
  if (!token) return;
  await query(`UPDATE sessions SET revoked_at = now() WHERE token_hash = $1 AND revoked_at IS NULL`, [sha256(token)]);
}

async function revokeAllSessions(subjectType: "EMPLOYEE" | "USER", subjectId: number): Promise<void> {
  await query(
    `UPDATE sessions SET revoked_at = now() WHERE subject_type = $1 AND subject_id = $2 AND revoked_at IS NULL`,
    [subjectType, subjectId],
  );
}
export { revokeAllSessions };

// ---------------------------------------------------------------------
// Empleados
// ---------------------------------------------------------------------
export interface SessionEmployee {
  id: number;
  employeeNumber: string;
  fullName: string;
  role: "EMPLOYEE" | "LEADER" | "SUPERVISOR";
  departmentId: number | null;
  departmentName: string | null;
  subareaId: number | null;
  subareaName: string | null;
  shiftId: number;
  shiftCode: "DIA" | "NOCHE";
  shiftName: string;
}

interface EmployeeRow {
  id: number;
  employee_number: string;
  full_name: string;
  role: SessionEmployee["role"];
  department_id: number | null;
  department_name: string | null;
  subarea_id: number | null;
  subarea_name: string | null;
  shift_id: number;
  shift_code: "DIA" | "NOCHE";
  shift_name: string;
  pin_hash: string | null;
  active: boolean;
  failed_attempts: number;
  locked_until: Date | null;
}

const EMPLOYEE_SELECT = `
  SELECT e.id, e.employee_number, e.full_name, e.role, e.department_id, d.name AS department_name,
         e.subarea_id, sa.name AS subarea_name,
         e.shift_id, s.code AS shift_code, s.name AS shift_name, e.pin_hash, e.active,
         e.failed_attempts, e.locked_until
  FROM employees e
  JOIN shifts s ON s.id = e.shift_id
  LEFT JOIN departments d ON d.id = e.department_id
  LEFT JOIN subareas sa ON sa.id = e.subarea_id`;

function toSessionEmployee(r: EmployeeRow): SessionEmployee {
  return {
    id: r.id,
    employeeNumber: r.employee_number,
    fullName: r.full_name,
    role: r.role,
    departmentId: r.department_id,
    departmentName: r.department_name,
    subareaId: r.subarea_id,
    subareaName: r.subarea_name,
    shiftId: r.shift_id,
    shiftCode: r.shift_code,
    shiftName: r.shift_name,
  };
}

export async function loginEmployee(
  input: { employeeNumber: string; pin: string },
  meta: RequestMeta,
): Promise<{ token: string; expiresAt: Date; employee: SessionEmployee }> {
  const employeeNumber = String(input.employeeNumber ?? "").trim();
  const pin = String(input.pin ?? "").trim();

  await assertIpNotThrottled("EMPLOYEE", meta);

  if (!/^\d{3,10}$/.test(employeeNumber) || !/^\d{4,6}$/.test(pin)) {
    await recordAttempt("EMPLOYEE", meta, employeeNumber, false);
    throw new AppError(401, "INVALID_CREDENTIALS", GENERIC_EMPLOYEE_ERROR);
  }

  const emp = await queryOne<EmployeeRow>(`${EMPLOYEE_SELECT} WHERE e.employee_number = $1`, [employeeNumber]);

  if (!emp || !emp.active) {
    await verifyAgainstDummy(pin);
    await recordAttempt("EMPLOYEE", meta, employeeNumber, false);
    await logAudit({
      actorType: "ANONYMOUS", action: "EMPLOYEE_LOGIN_FAILED", entity: "employee",
      entityId: emp?.id ?? null, details: { employeeNumber, reason: emp ? "inactive" : "not_found" }, ip: meta.ip,
    });
    throw new AppError(401, "INVALID_CREDENTIALS", GENERIC_EMPLOYEE_ERROR);
  }
  if (!emp.pin_hash) {
    throw new AppError(409, "PIN_SETUP_REQUIRED", "Aún no has creado tu PIN. Créalo para continuar.");
  }

  if (emp.locked_until && emp.locked_until > meta.now) {
    await recordAttempt("EMPLOYEE", meta, employeeNumber, false);
    throw new AppError(423, "ACCOUNT_LOCKED",
      `Cuenta bloqueada temporalmente por intentos fallidos. Intenta de nuevo en ${minutesLeft(emp.locked_until, meta.now)} minuto(s) o pide a tu supervisor que restablezca tu PIN.`);
  }

  const ok = await verifySecret(pin, emp.pin_hash);
  if (!ok) {
    await recordAttempt("EMPLOYEE", meta, employeeNumber, false);
    const failed = emp.failed_attempts + 1;
    if (failed >= MAX_FAILED_ATTEMPTS) {
      const until = new Date(meta.now.getTime() + LOCK_MINUTES * 60_000);
      await query(`UPDATE employees SET failed_attempts = 0, locked_until = $2 WHERE id = $1`, [emp.id, until]);
      await logAudit({
        actorType: "ANONYMOUS", action: "EMPLOYEE_LOCKED", entity: "employee", entityId: emp.id,
        details: { employeeNumber, minutes: LOCK_MINUTES }, ip: meta.ip,
      });
      throw new AppError(423, "ACCOUNT_LOCKED",
        `Demasiados intentos fallidos. Tu cuenta quedó bloqueada ${LOCK_MINUTES} minutos.`);
    }
    await query(`UPDATE employees SET failed_attempts = $2 WHERE id = $1`, [emp.id, failed]);
    await logAudit({
      actorType: "ANONYMOUS", action: "EMPLOYEE_LOGIN_FAILED", entity: "employee", entityId: emp.id,
      details: { employeeNumber, reason: "bad_pin", failed }, ip: meta.ip,
    });
    throw new AppError(401, "INVALID_CREDENTIALS", GENERIC_EMPLOYEE_ERROR, {
      attemptsLeft: MAX_FAILED_ATTEMPTS - failed,
    });
  }

  await query(`UPDATE employees SET failed_attempts = 0, locked_until = NULL WHERE id = $1`, [emp.id]);
  await recordAttempt("EMPLOYEE", meta, employeeNumber, true);
  const session = await createSession("EMPLOYEE", emp.id, EMPLOYEE_SESSION_HOURS, meta);
  await logAudit({
    actorType: "EMPLOYEE", actorId: emp.id, actorLabel: emp.full_name, action: "EMPLOYEE_LOGIN",
    entity: "employee", entityId: emp.id, ip: meta.ip,
  });
  return { ...session, employee: toSessionEmployee(emp) };
}

// ---------------------------------------------------------------------
// Alta del trabajador: identificación por número y creación de PIN propio
// ---------------------------------------------------------------------
export async function identifyEmployee(
  employeeNumberRaw: string,
  meta: RequestMeta,
): Promise<{ status: "PIN" | "SETUP"; firstName: string }> {
  const employeeNumber = String(employeeNumberRaw ?? "").trim();
  await assertIpNotThrottled("EMPLOYEE", meta);
  const emp = /^\d{3,10}$/.test(employeeNumber)
    ? await queryOne<{ id: number; full_name: string; active: boolean; pin_hash: string | null }>(
        `SELECT id, full_name, active, pin_hash FROM employees WHERE employee_number = $1`, [employeeNumber])
    : null;
  if (!emp || !emp.active) {
    await recordAttempt("EMPLOYEE", meta, employeeNumber, false);
    throw new AppError(404, "NOT_REGISTERED",
      "Ese número de empleado no está registrado. Pide a tu supervisor que te dé de alta.");
  }
  return { status: emp.pin_hash ? "PIN" : "SETUP", firstName: emp.full_name.split(" ")[0] };
}

export function validateNewPin(pin: string, confirm: string): void {
  if (!/^\d{4,6}$/.test(pin)) throw new AppError(400, "BAD_PIN", "El PIN debe tener de 4 a 6 números.");
  if (isWeakPin(pin)) {
    throw new AppError(400, "WEAK_PIN", "Ese PIN es muy fácil de adivinar (números repetidos o seguidos). Elige otro.");
  }
  if (pin !== confirm) throw new AppError(400, "PIN_MISMATCH", "Los dos PIN no coinciden.");
}

export async function setupEmployeePin(
  input: { employeeNumber: string; pin: string; pinConfirm: string },
  meta: RequestMeta,
): Promise<{ token: string; expiresAt: Date; employee: SessionEmployee }> {
  const employeeNumber = String(input.employeeNumber ?? "").trim();
  const pin = String(input.pin ?? "").trim();
  await assertIpNotThrottled("EMPLOYEE", meta);
  validateNewPin(pin, String(input.pinConfirm ?? "").trim());
  const updated = await queryOne<{ id: number }>(
    `UPDATE employees SET pin_hash = $2, failed_attempts = 0, locked_until = NULL, updated_at = now()
     WHERE employee_number = $1 AND active AND pin_hash IS NULL RETURNING id`,
    [employeeNumber, await hashSecret(pin)],
  );
  if (!updated) {
    await recordAttempt("EMPLOYEE", meta, employeeNumber, false);
    throw new AppError(409, "PIN_ALREADY_SET",
      "Este número ya tiene un PIN. Ingresa con tu PIN o pide a tu supervisor que lo restablezca.");
  }
  const emp = (await queryOne<EmployeeRow>(`${EMPLOYEE_SELECT} WHERE e.id = $1`, [updated.id]))!;
  await recordAttempt("EMPLOYEE", meta, employeeNumber, true);
  const session = await createSession("EMPLOYEE", emp.id, EMPLOYEE_SESSION_HOURS, meta);
  await logAudit({
    actorType: "EMPLOYEE", actorId: emp.id, actorLabel: emp.full_name, action: "EMPLOYEE_PIN_CREATED",
    entity: "employee", entityId: emp.id, ip: meta.ip,
  });
  return { ...session, employee: toSessionEmployee(emp) };
}

export async function getEmployeeFromToken(token: string | undefined, now = new Date()): Promise<SessionEmployee | null> {
  if (!token) return null;
  const row = await queryOne<EmployeeRow>(
    `${EMPLOYEE_SELECT}
     JOIN sessions ss ON ss.subject_type = 'EMPLOYEE' AND ss.subject_id = e.id
     WHERE ss.token_hash = $1 AND ss.revoked_at IS NULL AND ss.expires_at > $2 AND e.active`,
    [sha256(token), now],
  );
  return row ? toSessionEmployee(row) : null;
}

// ---------------------------------------------------------------------
// Usuarios del panel
// ---------------------------------------------------------------------
export interface SessionUser {
  id: number;
  username: string;
  displayName: string;
  role: "ADMIN" | "SUPERVISOR";
  employeeId: number | null;
}

interface UserRow {
  id: number;
  username: string;
  display_name: string;
  role: SessionUser["role"];
  employee_id: number | null;
  password_hash: string;
  active: boolean;
  failed_attempts: number;
  locked_until: Date | null;
}

function toSessionUser(r: UserRow): SessionUser {
  return { id: r.id, username: r.username, displayName: r.display_name, role: r.role, employeeId: r.employee_id };
}

export async function loginUser(
  input: { username: string; password: string },
  meta: RequestMeta,
): Promise<{ token: string; expiresAt: Date; user: SessionUser }> {
  const username = String(input.username ?? "").trim().toLowerCase();
  const password = String(input.password ?? "");

  await assertIpNotThrottled("USER", meta);

  const user = username && password
    ? await queryOne<UserRow>(`SELECT * FROM users WHERE username = $1`, [username])
    : null;

  if (!user || !user.active) {
    await verifyAgainstDummy(password || "x");
    await recordAttempt("USER", meta, username, false);
    await logAudit({
      actorType: "ANONYMOUS", action: "USER_LOGIN_FAILED", entity: "user", entityId: user?.id ?? null,
      details: { username, reason: user ? "inactive" : "not_found" }, ip: meta.ip,
    });
    throw new AppError(401, "INVALID_CREDENTIALS", GENERIC_USER_ERROR);
  }

  if (user.locked_until && user.locked_until > meta.now) {
    await recordAttempt("USER", meta, username, false);
    throw new AppError(423, "ACCOUNT_LOCKED",
      `Cuenta bloqueada temporalmente. Intenta de nuevo en ${minutesLeft(user.locked_until, meta.now)} minuto(s).`);
  }

  if (!(await verifySecret(password, user.password_hash))) {
    await recordAttempt("USER", meta, username, false);
    const failed = user.failed_attempts + 1;
    if (failed >= MAX_FAILED_ATTEMPTS) {
      const until = new Date(meta.now.getTime() + LOCK_MINUTES * 60_000);
      await query(`UPDATE users SET failed_attempts = 0, locked_until = $2 WHERE id = $1`, [user.id, until]);
      await logAudit({ actorType: "ANONYMOUS", action: "USER_LOCKED", entity: "user", entityId: user.id, ip: meta.ip });
      throw new AppError(423, "ACCOUNT_LOCKED", `Demasiados intentos fallidos. Cuenta bloqueada ${LOCK_MINUTES} minutos.`);
    }
    await query(`UPDATE users SET failed_attempts = $2 WHERE id = $1`, [user.id, failed]);
    await logAudit({
      actorType: "ANONYMOUS", action: "USER_LOGIN_FAILED", entity: "user", entityId: user.id,
      details: { username, reason: "bad_password", failed }, ip: meta.ip,
    });
    throw new AppError(401, "INVALID_CREDENTIALS", GENERIC_USER_ERROR);
  }

  await query(`UPDATE users SET failed_attempts = 0, locked_until = NULL WHERE id = $1`, [user.id]);
  await recordAttempt("USER", meta, username, true);
  const session = await createSession("USER", user.id, USER_SESSION_HOURS, meta);
  await logAudit({
    actorType: "USER", actorId: user.id, actorLabel: user.display_name, action: "USER_LOGIN",
    entity: "user", entityId: user.id, ip: meta.ip,
  });
  return { ...session, user: toSessionUser(user) };
}

export async function getUserFromToken(token: string | undefined, now = new Date()): Promise<SessionUser | null> {
  if (!token) return null;
  const row = await queryOne<UserRow>(
    `SELECT u.* FROM users u
     JOIN sessions ss ON ss.subject_type = 'USER' AND ss.subject_id = u.id
     WHERE ss.token_hash = $1 AND ss.revoked_at IS NULL AND ss.expires_at > $2 AND u.active`,
    [sha256(token), now],
  );
  return row ? toSessionUser(row) : null;
}

export async function changeOwnPassword(
  user: SessionUser,
  currentPassword: string,
  newPassword: string,
  ip: string,
): Promise<void> {
  const row = await queryOne<{ password_hash: string }>(`SELECT password_hash FROM users WHERE id = $1`, [user.id]);
  if (!row || !(await verifySecret(currentPassword, row.password_hash))) {
    throw new AppError(400, "BAD_PASSWORD", "La contraseña actual no es correcta.");
  }
  validatePasswordStrength(newPassword);
  await query(`UPDATE users SET password_hash = $2, updated_at = now() WHERE id = $1`, [user.id, await hashSecret(newPassword)]);
  await logAudit({
    actorType: "USER", actorId: user.id, actorLabel: user.displayName, action: "USER_PASSWORD_CHANGED",
    entity: "user", entityId: user.id, ip,
  });
}

export function validatePasswordStrength(pw: string): void {
  if (typeof pw !== "string" || pw.length < 10) {
    throw new AppError(400, "WEAK_PASSWORD", "La contraseña debe tener al menos 10 caracteres.");
  }
  if (!/[A-Za-z]/.test(pw) || !/\d/.test(pw)) {
    throw new AppError(400, "WEAK_PASSWORD", "La contraseña debe incluir letras y números.");
  }
}
