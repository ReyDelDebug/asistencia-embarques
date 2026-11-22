import { NextResponse, type NextRequest } from "next/server";
import { AppError } from "./errors";
import {
  ADMIN_COOKIE, EMPLOYEE_COOKIE, getEmployeeFromToken, getUserFromToken,
  type RequestMeta, type SessionEmployee, type SessionUser,
} from "./services/auth";

export function getClientIp(req: NextRequest): string {
  const xff = req.headers.get("x-forwarded-for");
  if (xff) return xff.split(",")[0].trim().slice(0, 64);
  return (req.headers.get("x-real-ip") ?? "local").slice(0, 64);
}

export function getMeta(req: NextRequest): RequestMeta {
  return {
    ip: getClientIp(req),
    userAgent: req.headers.get("user-agent") ?? "",
    now: new Date(), // Hora del SERVIDOR. Nunca se acepta la hora del cliente.
  };
}

export function json(data: unknown, status = 200): NextResponse {
  return NextResponse.json(data, { status, headers: { "Cache-Control": "no-store" } });
}

/** Protección CSRF: las peticiones que modifican datos deben venir del mismo origen. */
export function assertSameOrigin(req: NextRequest): void {
  if (["GET", "HEAD", "OPTIONS"].includes(req.method)) return;
  const origin = req.headers.get("origin");
  const fetchSite = req.headers.get("sec-fetch-site");
  if (fetchSite && !["same-origin", "none"].includes(fetchSite)) {
    throw new AppError(403, "CSRF", "Origen no permitido.");
  }
  if (origin) {
    const host = req.headers.get("x-forwarded-host") ?? req.headers.get("host");
    let originHost = "";
    try { originHost = new URL(origin).host; } catch { /* inválido */ }
    if (!host || originHost !== host) throw new AppError(403, "CSRF", "Origen no permitido.");
  }
}

export async function readJson<T = Record<string, unknown>>(req: NextRequest): Promise<T> {
  try {
    return (await req.json()) as T;
  } catch {
    throw new AppError(400, "BAD_JSON", "Solicitud no válida.");
  }
}

export function handle<C = unknown>(fn: (req: NextRequest, ctx: C) => Promise<NextResponse>) {
  return async (req: NextRequest, ctx: C): Promise<NextResponse> => {
    try {
      assertSameOrigin(req);
      return await fn(req, ctx);
    } catch (err) {
      if (err instanceof AppError) {
        return json({ error: err.message, code: err.code, ...err.extra }, err.status);
      }
      console.error("[api] error no controlado:", err);
      return json({ error: "Ocurrió un error interno. Intenta de nuevo.", code: "INTERNAL" }, 500);
    }
  };
}

const secureCookies = () => process.env.NODE_ENV === "production" && process.env.INSECURE_COOKIES !== "true";

export function setSessionCookie(res: NextResponse, name: string, token: string, expires: Date): void {
  res.cookies.set(name, token, {
    httpOnly: true,
    secure: secureCookies(),
    sameSite: "lax",
    path: "/",
    expires,
  });
}

export function clearSessionCookie(res: NextResponse, name: string): void {
  res.cookies.set(name, "", { httpOnly: true, secure: secureCookies(), sameSite: "lax", path: "/", maxAge: 0 });
}

export async function requireEmployee(req: NextRequest): Promise<SessionEmployee> {
  const emp = await getEmployeeFromToken(req.cookies.get(EMPLOYEE_COOKIE)?.value);
  if (!emp) throw new AppError(401, "UNAUTHENTICATED", "Tu sesión expiró. Ingresa de nuevo.");
  return emp;
}

export async function requireUser(req: NextRequest): Promise<SessionUser> {
  const user = await getUserFromToken(req.cookies.get(ADMIN_COOKIE)?.value);
  if (!user) throw new AppError(401, "UNAUTHENTICATED", "Sesión no válida. Inicia sesión en el panel.");
  return user;
}

export function intParam(v: string | null): number | null {
  if (v == null || v === "") return null;
  const n = Number(v);
  return Number.isInteger(n) && n > 0 ? n : null;
}
