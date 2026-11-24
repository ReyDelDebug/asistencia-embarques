/**
 * Fotos de perfil. El celular recorta y comprime la imagen antes de subirla
 * (320×320 JPEG). Aquí se valida el tipo real por sus bytes y el tamaño.
 * Quién puede ver una foto: el propio empleado, sus compañeros de la misma
 * área y los usuarios del panel.
 */
import { query, queryOne } from "../db";
import { AppError } from "../errors";
import { logAudit } from "./audit";
import type { SessionEmployee, SessionUser } from "./auth";
import { getLocalParts } from "../time";

export const MAX_PHOTO_BYTES = 300 * 1024;

function detectType(buf: Buffer): "image/jpeg" | "image/png" | "image/webp" | null {
  if (buf.length > 3 && buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return "image/jpeg";
  if (buf.length > 8 && buf.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return "image/png";
  if (buf.length > 12 && buf.toString("ascii", 0, 4) === "RIFF" && buf.toString("ascii", 8, 12) === "WEBP") return "image/webp";
  return null;
}

/** Acepta un data URL ("data:image/jpeg;base64,...") o base64 puro. */
export function decodeImage(input: string): { buf: Buffer; type: string } {
  if (typeof input !== "string" || input.length < 50) throw new AppError(400, "BAD_IMAGE", "Imagen no válida.");
  const b64 = input.includes(",") ? input.slice(input.indexOf(",") + 1) : input;
  if (b64.length > Math.ceil((MAX_PHOTO_BYTES * 4) / 3) + 8) {
    throw new AppError(413, "IMAGE_TOO_LARGE", "La foto es demasiado grande (máximo 300 KB).");
  }
  const buf = Buffer.from(b64, "base64");
  const type = detectType(buf);
  if (!type) throw new AppError(400, "BAD_IMAGE", "Formato no permitido. Usa una foto JPG, PNG o WEBP.");
  if (buf.length > MAX_PHOTO_BYTES) throw new AppError(413, "IMAGE_TOO_LARGE", "La foto es demasiado grande (máximo 300 KB).");
  return { buf, type };
}

export async function setEmployeePhoto(employee: SessionEmployee, image: string, ip: string): Promise<{ updatedAt: string }> {
  const { buf, type } = decodeImage(image);
  const row = await queryOne<{ updated_at: Date }>(
    `INSERT INTO employee_photos (employee_id, content_type, data, updated_at) VALUES ($1, $2, $3, now())
     ON CONFLICT (employee_id) DO UPDATE SET content_type = EXCLUDED.content_type, data = EXCLUDED.data, updated_at = now()
     RETURNING updated_at`,
    [employee.id, type, buf],
  );
  await logAudit({
    actorType: "EMPLOYEE", actorId: employee.id, actorLabel: employee.fullName, action: "PHOTO_UPDATED",
    entity: "employee", entityId: employee.id, details: { bytes: buf.length, type }, ip,
  });
  return { updatedAt: row!.updated_at.toISOString() };
}

export async function deleteEmployeePhoto(
  employeeId: number,
  actor: { type: "EMPLOYEE"; employee: SessionEmployee } | { type: "USER"; user: SessionUser },
  ip: string,
): Promise<void> {
  if (actor.type === "EMPLOYEE" && actor.employee.id !== employeeId) {
    throw new AppError(403, "FORBIDDEN", "Solo puedes quitar tu propia foto.");
  }
  await query(`DELETE FROM employee_photos WHERE employee_id = $1`, [employeeId]);
  await logAudit({
    actorType: actor.type,
    actorId: actor.type === "EMPLOYEE" ? actor.employee.id : actor.user.id,
    actorLabel: actor.type === "EMPLOYEE" ? actor.employee.fullName : actor.user.displayName,
    action: "PHOTO_DELETED", entity: "employee", entityId: employeeId, ip,
  });
}

/** Devuelve la foto si el solicitante tiene permiso de verla; si no, null. */
export async function getPhotoFor(
  targetId: number,
  viewer: { type: "EMPLOYEE"; employee: SessionEmployee } | { type: "USER" },
): Promise<{ data: Buffer; contentType: string; updatedAt: Date } | null> {
  const today = getLocalParts(new Date()).date;
  const row = await queryOne<{ data: Buffer; content_type: string; updated_at: Date; department_id: number | null; active: boolean; viewer_dept: number | null }>(
    `SELECT p.data, p.content_type, p.updated_at, (SELECT department_id FROM employee_placement_on(e.id, $2)) AS department_id, e.active,
            (SELECT department_id FROM employee_placement_on($3, $2)) AS viewer_dept
     FROM employee_photos p JOIN employees e ON e.id = p.employee_id WHERE p.employee_id = $1`,
    [targetId, today, viewer.type === "EMPLOYEE" ? viewer.employee.id : 0],
  );
  if (!row) return null;
  if (viewer.type === "USER") return { data: row.data, contentType: row.content_type, updatedAt: row.updated_at };
  const me = viewer.employee;
  const allowed = me.id === targetId
    || (row.active && row.viewer_dept != null && row.department_id === row.viewer_dept);
  return allowed ? { data: row.data, contentType: row.content_type, updatedAt: row.updated_at } : null;
}

export async function getPhotoVersion(employeeId: number): Promise<string | null> {
  const r = await queryOne<{ updated_at: Date }>(`SELECT updated_at FROM employee_photos WHERE employee_id = $1`, [employeeId]);
  return r ? String(r.updated_at.getTime()) : null;
}
