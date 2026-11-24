/**
 * Pruebas de extremo a extremo: servidor Next.js real (next start) + PostgreSQL real
 * + navegador Chrome real con emulación de celular.
 *
 * Requiere `npm run build` previo. Para poder registrar asistencia por HTTP con la
 * hora REAL del servidor (sin trucos de reloj), la prueba ajusta temporalmente en la
 * BASE DE PRUEBAS la ventana de un turno para que incluya la hora actual.
 */
import { spawn, type ChildProcess } from "node:child_process";
import { mkdirSync, readFileSync } from "node:fs";
import ExcelJS from "exceljs";
import puppeteer, { type Browser } from "puppeteer-core";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { query } from "../../src/lib/db";
import { getLocalParts } from "../../src/lib/time";
import type { SeedResult } from "../../scripts/seed";
import { activateAll, closePool, pinOf, resetDatabase } from "../helpers";

const PORT = Number(process.env.E2E_PORT ?? 3100);
const BASE = `http://localhost:${PORT}`;
const CHROME = process.env.CHROME_PATH ?? "/usr/bin/google-chrome";
const SHOTS = "tests/e2e/screenshots";

let server: ChildProcess;
let S: SeedResult;
let browser: Browser;

function secondsToTime(s: number) {
  const c = Math.max(0, Math.min(86399, s));
  return [Math.floor(c / 3600), Math.floor((c % 3600) / 60), c % 60].map((n) => String(n).padStart(2, "0")).join(":");
}

/** Abre la ventana del turno indicado alrededor de la hora actual y cierra la del otro. */
/** Las pruebas por HTTP usan la fecha real: se marca hoy como laborable para no depender del día de la semana. */
async function todayLaboral() {
  await query(`INSERT INTO work_calendar (day, day_type, label) VALUES ($1, 'LABORAL', 'pruebas')
               ON CONFLICT (day) DO UPDATE SET day_type = 'LABORAL'`, [getLocalParts(new Date()).date]);
}

async function openWindowNow(code: "DIA" | "NOCHE") {
  await todayLaboral();
  const sec = getLocalParts(new Date()).seconds;
  await query(`UPDATE shifts SET open_time = '00:00:00', close_time = '00:00:01'`);
  await query(`UPDATE shifts SET open_time = $2, close_time = $3 WHERE code = $1`,
    [code, secondsToTime(sec - 1800), secondsToTime(sec + 1800)]);
}
/** Ventana normal ya cerrada, pero dentro de la extensión y del límite de retardo. */
async function afterCloseNow(code: "DIA" | "NOCHE") {
  await todayLaboral();
  const sec = getLocalParts(new Date()).seconds;
  await query(`UPDATE shifts SET open_time = '00:00:00', close_time = '00:00:01'`);
  await query(`UPDATE shifts SET open_time = $2, close_time = $3, extension_close = $4, late_limit = $5 WHERE code = $1`,
    [code, secondsToTime(sec - 3600), secondsToTime(sec - 120), secondsToTime(sec + 900), secondsToTime(sec + 3000)]);
}
async function closeAllWindows() {
  await query(`UPDATE shifts SET open_time = '00:00:00', close_time = '00:00:01'`);
}

async function waitForServer() {
  for (let i = 0; i < 60; i++) {
    try {
      const r = await fetch(`${BASE}/api/time`);
      if (r.ok) return;
    } catch { /* aún no */ }
    await new Promise((r) => setTimeout(r, 500));
  }
  throw new Error("El servidor no inició");
}

class Client {
  cookies = new Map<string, string>();
  async req(path: string, init: RequestInit & { json?: unknown } = {}) {
    const headers: Record<string, string> = { ...(init.headers as Record<string, string>) };
    if (init.json !== undefined) headers["Content-Type"] = "application/json";
    if (this.cookies.size) headers.Cookie = [...this.cookies].map(([k, v]) => `${k}=${v}`).join("; ");
    const res = await fetch(`${BASE}${path}`, {
      ...init, headers, redirect: "manual",
      body: init.json !== undefined ? JSON.stringify(init.json) : init.body,
    });
    for (const c of res.headers.getSetCookie()) {
      const [pair] = c.split(";");
      const [k, v] = pair.split("=");
      if (v) this.cookies.set(k, v); else this.cookies.delete(k);
    }
    return res;
  }
}

beforeAll(async () => {
  S = await resetDatabase();
  await activateAll(["Enrique Suárez"]); // Enrique Suárez creará su PIN desde el navegador
  const busy = await fetch(`${BASE}/api/time`).then(() => true).catch(() => false);
  if (busy) throw new Error(`El puerto ${PORT} ya está en uso; detén ese proceso antes de las pruebas.`);
  server = spawn(process.execPath, ["node_modules/next/dist/bin/next", "start", "-p", String(PORT)], {
    env: {
      ...process.env, DATABASE_URL: process.env.DATABASE_URL!, NODE_ENV: "production",
      // Llaves VAPID SOLO de prueba (generadas para las pruebas; no se usan en producción)
      VAPID_PUBLIC_KEY: "BI1yyXhARyfUsd26oIBEAbxOA2_s-gWqnvzIiYLgIFkQb9gm4s8Kd78jmfEzFY8DA_aTxK5FnKR8EQZNZr3V3kY",
      VAPID_PRIVATE_KEY: "pMmFGVmLsIzyMROEirsQLOmHkF9qELbtcRhNrFXiVAw",
      VAPID_SUBJECT: "mailto:pruebas@example.com",
      CRON_SECRET: "secreto-de-pruebas-e2e-123456",
    },
    stdio: "pipe",
  });
  server.stderr?.on("data", (d) => process.stderr.write(`[next] ${d}`));
  await waitForServer();
  mkdirSync(SHOTS, { recursive: true });
  browser = await puppeteer.launch({
    executablePath: CHROME, headless: true, args: ["--no-sandbox", "--disable-dev-shm-usage"],
  });
}, 120_000);

afterAll(async () => {
  await browser?.close();
  server?.kill("SIGTERM");
  await closePool();
});

describe("API por HTTP", () => {
  it("1/2. login de empleado: PIN incorrecto 401, correcto 200 con cookie httpOnly", async () => {
    const c = new Client();
    const bad = await c.req("/api/auth/employee/login", { method: "POST", json: { employeeNumber: "1001", pin: "000009" } });
    expect(bad.status).toBe(401);
    const ok = await c.req("/api/auth/employee/login", { method: "POST", json: { employeeNumber: "1001", pin: pinOf(S, "Christian Tapia") } });
    expect(ok.status).toBe(200);
    const setCookie = ok.headers.getSetCookie().join(";");
    expect(setCookie).toMatch(/ea_emp=/);
    expect(setCookie.toLowerCase()).toContain("httponly");
    expect(setCookie.toLowerCase()).toContain("samesite=lax");
  });

  it("fuera de horario: 403 con el mensaje de registro cerrado (hora real del servidor)", async () => {
    await closeAllWindows();
    const c = new Client();
    await c.req("/api/auth/employee/login", { method: "POST", json: { employeeNumber: "1002", pin: pinOf(S, "Antonio Rosado") } });
    const view = await (await c.req("/api/attendance")).json();
    expect(view.windowState).not.toBe("OPEN");
    const r = await c.req("/api/attendance", { method: "POST" });
    expect(r.status).toBe(403);
    expect((await r.json()).error).toBe("EL REGISTRO DE ASISTENCIA SE ENCUENTRA CERRADO.");
  });

  it("10. confirmación por HTTP y bloqueo de duplicado", async () => {
    await openWindowNow("DIA");
    const c = new Client();
    await c.req("/api/auth/employee/login", { method: "POST", json: { employeeNumber: "1002", pin: pinOf(S, "Antonio Rosado") } });
    const r1 = await c.req("/api/attendance", { method: "POST" });
    expect(r1.status).toBe(201);
    const body = await r1.json();
    expect(body.record.employeeName).toBe("Antonio Rosado");
    expect(Math.abs(new Date(body.record.confirmedAt).getTime() - Date.now())).toBeLessThan(10_000);
    const r2 = await c.req("/api/attendance", { method: "POST" });
    expect(r2.status).toBe(409);
    expect((await r2.json()).existing.confirmedAt).toBe(body.record.confirmedAt);
  });

  it("el empleado no puede alterar la hora ni registrar a otra persona", async () => {
    const c = new Client();
    await c.req("/api/auth/employee/login", { method: "POST", json: { employeeNumber: "1003", pin: pinOf(S, "Alexis Altamirano") } });
    const r = await c.req("/api/attendance", {
      method: "POST", json: { employeeId: 1, confirmedAt: "2020-01-01T00:00:00Z", employeeNumber: "1004" },
    });
    const body = await r.json();
    expect(body.record.employeeName).toBe("Alexis Altamirano");
    expect(new Date(body.record.confirmedAt).getUTCFullYear()).toBe(new Date().getUTCFullYear());
  });

  it("18. acceso no autorizado al panel", async () => {
    const anon = new Client();
    expect((await anon.req("/api/admin/dashboard")).status).toBe(401);
    expect((await anon.req("/api/admin/export")).status).toBe(401);
    const page = await anon.req("/admin");
    expect([307, 308]).toContain(page.status);
    expect(page.headers.get("location")).toContain("/admin/login");

    // Una sesión de EMPLEADO no sirve para el panel
    const emp = new Client();
    await emp.req("/api/auth/employee/login", { method: "POST", json: { employeeNumber: "1005", pin: pinOf(S, "Maximiliano") } });
    expect((await emp.req("/api/admin/dashboard")).status).toBe(401);
    expect((await emp.req("/api/admin/incidents", { method: "POST", json: {} })).status).toBe(401);

    // Cookie inventada
    const fake = new Client();
    fake.cookies.set("ea_adm", "token-falso");
    expect((await fake.req("/api/admin/dashboard")).status).toBe(401);
  });

  it("protección CSRF: rechaza peticiones de otro origen", async () => {
    const c = new Client();
    const r = await c.req("/api/auth/admin/login", {
      method: "POST", json: { username: "manuel", password: "x" }, headers: { Origin: "https://sitio-malicioso.com" },
    });
    expect(r.status).toBe(403);
  });

  it("14/16/17. supervisor: panel, incidencia, reporte y Excel por HTTP", async () => {
    const c = new Client();
    const login = await c.req("/api/auth/admin/login", { method: "POST", json: { username: "manuel", password: S.admin.password } });
    expect(login.status).toBe(200);
    const today = getLocalParts(new Date()).date;

    const dash = await (await c.req(`/api/admin/dashboard?date=${today}&shift=DIA`)).json();
    expect(dash.stats.total).toBe(23);
    expect(dash.stats.confirmed).toBe(2);
    const maxi = dash.rows.find((r: { fullName: string }) => r.fullName === "Maximiliano");
    const inc = await c.req("/api/admin/incidents", {
      method: "POST", json: { employeeId: maxi.employeeId, date: today, shiftId: maxi.shiftId, type: "INCAPACIDAD", reason: "Incapacidad IMSS" },
    });
    expect(inc.status).toBe(201);

    const rep = await (await c.req(`/api/admin/report?date=${today}&shift=DIA`)).json();
    expect(rep.text).toContain("*CENTRAL:* 2+0");
    expect(rep.text).toContain("*INCAPACIDAD:*\n- Maximiliano (CENTRAL)");
    expect(rep.text).toContain("*PENDIENTES POR CONFIRMAR:*");

    const txt = await c.req(`/api/admin/report/download?date=${today}&shift=DIA`);
    expect(txt.headers.get("content-disposition")).toContain(".txt");

    const x = await c.req(`/api/admin/export?from=${today}&to=${today}`);
    expect(x.status).toBe(200);
    expect(x.headers.get("content-type")).toContain("spreadsheetml");
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(await x.arrayBuffer());
    expect(wb.worksheets.map((w) => w.name)).toEqual(["ASISTENCIA GENERAL", "RESUMEN", "HISTORIAL"]);

    const audit = await (await c.req("/api/admin/audit?limit=200")).json();
    const actions = audit.rows.map((r: { action: string }) => r.action);
    expect(actions).toEqual(expect.arrayContaining(["INCIDENT_SET", "EXCEL_EXPORTED", "REPORT_EXPORT", "ATTENDANCE_CONFIRMED", "USER_LOGIN"]));

    const out = await c.req("/api/auth/admin/logout", { method: "POST" });
    expect(out.status).toBe(200);
    expect((await c.req("/api/admin/dashboard")).status).toBe(401);
  });

  it("rol de turno y solicitud de vacaciones por HTTP", async () => {
    const adm = new Client();
    await adm.req("/api/auth/admin/login", { method: "POST", json: { username: "manuel", password: S.admin.password } });
    const rol = await (await adm.req("/api/admin/rol")).json();
    const enrique = rol.rows.find((r: { fullName: string }) => r.fullName === "Enrique González");
    expect(enrique.shiftCode).toBe("NOCHE");
    const put = await adm.req("/api/admin/rol", {
      method: "PUT", json: { effectiveFrom: rol.today, items: [{ employeeId: enrique.employeeId, shiftCode: "DIA" }] },
    });
    expect((await put.json()).changed).toBe(1);

    const emp = new Client();
    const id = await emp.req("/api/auth/employee/identify", { method: "POST", json: { employeeNumber: "2001" } });
    expect((await id.json()).status).toBe("PIN");
    await emp.req("/api/auth/employee/login", { method: "POST", json: { employeeNumber: "2001", pin: pinOf(S, "Enrique González") } });
    const view = await (await emp.req("/api/attendance")).json();
    expect(view.shift.code).toBe("DIA");

    // Próximo día laborable (lunes a jueves) dentro de 2+ días
    let tomorrow = getLocalParts(new Date(Date.now() + 86_400_000 * 2)).date;
    while (![1, 2, 3, 4].includes(new Date(`${tomorrow}T12:00:00Z`).getUTCDay())) {
      tomorrow = new Date(new Date(`${tomorrow}T12:00:00Z`).getTime() + 86_400_000).toISOString().slice(0, 10);
    }
    const lr = await emp.req("/api/leave", { method: "POST", json: { type: "PSG", startDate: tomorrow, endDate: tomorrow, reason: "Trámite" } });
    expect(lr.status).toBe(201);
    const pending = await (await adm.req("/api/admin/leave?status=PENDIENTE")).json();
    expect(pending.requests).toHaveLength(1);
    const dec = await adm.req(`/api/admin/leave/${pending.requests[0].id}/decide`, { method: "POST", json: { decision: "APROBAR" } });
    expect((await dec.json()).daysRegistered).toBe(1);
    const mine = await (await emp.req("/api/leave")).json();
    expect(mine.requests[0].status).toBe("APROBADA");

    // Un empleado no puede aprobar solicitudes
    expect((await emp.req(`/api/admin/leave/${pending.requests[0].id}/decide`, { method: "POST", json: { decision: "APROBAR" } })).status).toBe(401);

    // Regresa a Enrique a su turno para las siguientes pruebas
    await adm.req("/api/admin/rol", { method: "PUT", json: { effectiveFrom: rol.today, items: [{ employeeId: enrique.employeeId, shiftCode: "NOCHE" }] } });
  });

  it("turno de NOCHE por HTTP: el de noche registra, el de día no", async () => {
    await openWindowNow("NOCHE");
    const night = new Client();
    await night.req("/api/auth/employee/login", { method: "POST", json: { employeeNumber: "2003", pin: pinOf(S, "Gregorio Meraz") } });
    const v = await (await night.req("/api/attendance")).json();
    expect(v).toMatchObject({ windowState: "OPEN", shift: { code: "NOCHE" } });
    const r = await night.req("/api/attendance", { method: "POST" });
    expect(r.status).toBe(201);
    expect((await r.json()).record.shiftCode).toBe("NOCHE");

    const day = new Client();
    await day.req("/api/auth/employee/login", { method: "POST", json: { employeeNumber: "1004", pin: pinOf(S, "Julio César") } });
    expect((await day.req("/api/attendance", { method: "POST" })).status).toBe(403);
  });

  it("foto de perfil y Mi grupo por HTTP: cada área solo ve a la suya", async () => {
    const central = new Client();
    await central.req("/api/auth/employee/login", { method: "POST", json: { employeeNumber: "1003", pin: pinOf(S, "Alexis Altamirano") } });
    const jpeg = "data:image/jpeg;base64," + readFileSync("tests/e2e/fixtures/foto-prueba.jpg").toString("base64");
    const up = await central.req("/api/me/photo", { method: "PUT", json: { image: jpeg } });
    expect(up.status).toBe(200);
    const me = await (await central.req("/api/attendance")).json();
    const id = me.employee.id;

    const mate = new Client();
    await mate.req("/api/auth/employee/login", { method: "POST", json: { employeeNumber: "1005", pin: pinOf(S, "Maximiliano") } });
    const ok = await mate.req(`/api/photos/${id}`);
    expect(ok.status).toBe(200);
    expect(ok.headers.get("content-type")).toBe("image/jpeg");

    const rc = new Client();
    await rc.req("/api/auth/employee/login", { method: "POST", json: { employeeNumber: "1013", pin: pinOf(S, "Arturo Mata") } });
    expect((await rc.req(`/api/photos/${id}`)).status).toBe(404);
    expect((await new Client().req(`/api/photos/${id}`)).status).toBe(401);
    const g = await (await rc.req("/api/me/group")).json();
    expect(g.departmentName).toBe("RC");
    expect(g.members.map((m: { fullName: string }) => m.fullName)).not.toContain("Alexis Altamirano");
    expect(g.leaderView).toBeNull();

    const pinChange = await central.req("/api/me/pin", { method: "POST", json: { currentPin: "000000", newPin: "702913", newPinConfirm: "702913" } });
    expect(pinChange.status).toBe(400);
  });

  it("llegaré tarde y extensión por HTTP (líder y supervisor)", async () => {
    await openWindowNow("DIA");
    const emp = new Client();
    await emp.req("/api/auth/employee/login", { method: "POST", json: { employeeNumber: "1011", pin: pinOf(S, "Arturo Martínez") } });
    const noReason = await emp.req("/api/me/late", { method: "POST", json: { eta: "23:00", reason: "" } });
    expect(noReason.status).toBe(400);

    await afterCloseNow("DIA");
    // Ya cerró: no puede registrar ni avisar retardo
    expect((await emp.req("/api/attendance", { method: "POST" })).status).toBe(403);
    expect((await emp.req("/api/me/late", { method: "POST", json: { eta: "23:00", reason: "Tráfico" } })).status).toBe(403);

    // El líder de Central le abre el registro
    const leader = new Client();
    await leader.req("/api/auth/employee/login", { method: "POST", json: { employeeNumber: "1006", pin: pinOf(S, "Isaías Romero") } });
    const g = await (await leader.req("/api/me/group")).json();
    const row = g.leaderView.rows.find((r: { fullName: string }) => r.fullName === "Arturo Martínez");
    expect(row.canExtend).toBe(true);
    const ext = await leader.req("/api/me/extensions", { method: "POST", json: { employeeIds: [row.employeeId] } });
    expect((await ext.json()).granted).toEqual(["Arturo Martínez"]);
    // Un empleado normal no puede abrir registros
    expect((await emp.req("/api/me/extensions", { method: "POST", json: { employeeIds: [row.employeeId] } })).status).toBe(403);
    const ok = await emp.req("/api/attendance", { method: "POST" });
    expect(ok.status).toBe(201);
    expect((await ok.json()).record.via).toBe("EXTENSION");

    // El supervisor abre a alguien de RC
    const adm = new Client();
    await adm.req("/api/auth/admin/login", { method: "POST", json: { username: "manuel", password: S.admin.password } });
    const dash = await (await adm.req("/api/admin/dashboard?shift=DIA")).json();
    const rc = dash.rows.find((r: { fullName: string }) => r.fullName === "Isaac Antonio");
    expect(rc.canExtend).toBe(true);
    const r2 = await adm.req("/api/admin/extensions", { method: "POST", json: { employeeIds: [rc.employeeId] } });
    expect((await r2.json()).granted).toEqual(["Isaac Antonio"]);
  });

  it("notificaciones: llave pública, suscripción y endpoint programado protegido", async () => {
    const key = await (await fetch(`${BASE}/api/push/key`)).json();
    expect(key.enabled).toBe(true);
    expect(key.publicKey).toMatch(/^B/);
    const emp = new Client();
    await emp.req("/api/auth/employee/login", { method: "POST", json: { employeeNumber: "1019", pin: pinOf(S, "Carlos González") } });
    const sub = { endpoint: "https://push.example.com/e2e", keys: { p256dh: "B".repeat(87), auth: "A".repeat(22) } };
    expect((await emp.req("/api/me/push", { method: "POST", json: { subscription: sub } })).status).toBe(201);
    expect((await (await emp.req("/api/me/push")).json()).subscriptions).toBe(1);

    expect((await fetch(`${BASE}/api/cron/reminders`, { method: "POST" })).status).toBe(401);
    expect((await fetch(`${BASE}/api/cron/reminders`, { method: "POST", headers: { Authorization: "Bearer incorrecto" } })).status).toBe(401);
    const ok = await fetch(`${BASE}/api/cron/reminders`, { method: "POST", headers: { Authorization: "Bearer secreto-de-pruebas-e2e-123456" } });
    expect(ok.status).toBe(200);
    expect((await ok.json()).ok).toBe(true);
    const sw = await fetch(`${BASE}/sw.js`);
    expect(sw.status).toBe(200);
    expect(await sw.text()).toContain("showNotification");
    const manifest = await (await fetch(`${BASE}/manifest.webmanifest`)).json();
    expect(manifest.display).toBe("standalone");
  });

  it("perfil del trabajador, ficha del supervisor, control del registro y asistencia del supervisor", async () => {
    // El trabajador completa su perfil
    const emp = new Client();
    await emp.req("/api/auth/employee/login", { method: "POST", json: { employeeNumber: "1015", pin: pinOf(S, "Isaac Antonio") } });
    const bad = await emp.req("/api/me/profile", { method: "PUT", json: { fullName: "Isaac 123", phone: "4421112233", birthDate: "1995-02-03", bootSize: 27, vestSize: "MEDIANO" } });
    expect(bad.status).toBe(400);
    const ok = await emp.req("/api/me/profile", { method: "PUT", json: { fullName: "Isaac Antonio Pérez", phone: "4421112233", birthDate: "1995-02-03", bootSize: 27, vestSize: "MEDIANO" } });
    expect(ok.status).toBe(200);
    expect((await ok.json()).profile.complete).toBe(true);

    // El supervisor ve la ficha y le asigna vacaciones
    const adm = new Client();
    await adm.req("/api/auth/admin/login", { method: "POST", json: { username: "manuel", password: S.admin.password } });
    const me = await (await emp.req("/api/attendance")).json();
    const put = await adm.req(`/api/admin/employees/${me.employee.id}/details`, { method: "PUT", json: { vacationDays: 12 } });
    expect(put.status).toBe(200);
    const detail = await (await adm.req(`/api/admin/employees/${me.employee.id}/detail`)).json();
    expect(detail.employee).toMatchObject({ fullName: "Isaac Antonio Pérez", phone: "4421112233", bootSize: 27, vestSize: "MEDIANO" });
    expect(detail.vacations).toMatchObject({ assigned: 12, available: 12 });
    const prof = await (await emp.req("/api/me/profile")).json();
    expect(prof.vacations.available).toBe(12);
    // Un empleado no puede ver fichas ni cambiar el horario
    expect((await emp.req(`/api/admin/employees/${me.employee.id}/detail`)).status).toBe(401);
    expect((await emp.req("/api/admin/windows", { method: "POST", json: { shift: "DIA", action: "OPEN" } })).status).toBe(401);

    // Control del registro: cerrar y abrir para todos
    await openWindowNow("DIA");
    let r = await (await adm.req("/api/admin/windows", { method: "POST", json: { shift: "DIA", action: "CLOSE" } })).json();
    expect(r.windows.find((w: { code: string }) => w.code === "DIA").open).toBe(false);
    const sup = await (await adm.req("/api/admin/me/attendance")).json();
    expect(sup).toMatchObject({ linked: true, view: { windowState: "CLOSED" } });
    r = await (await adm.req("/api/admin/windows", { method: "POST", json: { shift: "DIA", action: "OPEN" } })).json();
    expect(r.windows.find((w: { code: string }) => w.code === "DIA")).toMatchObject({ open: true, closeTime: "23:59:59" });
    // El supervisor registra su asistencia desde el panel
    const mine = await adm.req("/api/admin/me/attendance", { method: "POST" });
    expect(mine.status).toBe(201);
    expect((await mine.json()).record.employeeName).toBe("Manuel");
    await adm.req("/api/admin/windows", { method: "POST", json: { shift: "DIA", action: "RESET" } });
  });

  it("calendario laboral y cambio de área por HTTP", async () => {
    const adm = new Client();
    await adm.req("/api/auth/admin/login", { method: "POST", json: { username: "manuel", password: S.admin.password } });
    const cal = await (await adm.req("/api/admin/calendar?month=2026-12")).json();
    expect(cal.days.find((d: { date: string }) => d.date === "2026-12-25")).toMatchObject({ type: "FERIADO", label: "Navidad" });
    expect(cal.days.find((d: { date: string }) => d.date === "2026-12-04")).toMatchObject({ type: "VIERNES" });
    const put = await adm.req("/api/admin/calendar", { method: "PUT", json: { date: "2026-12-04", type: "NO_LABORAL", label: "Puente" } });
    expect((await put.json()).day).toMatchObject({ type: "NO_LABORAL", custom: true });

    const rol = await (await adm.req("/api/admin/rol")).json();
    const gus = rol.rows.find((r: { fullName: string }) => r.fullName === "Gustavo Mata");
    const central = rol.departments.find((d: { code: string }) => d.code === "CENTRAL");
    const ch = await adm.req("/api/admin/rol/area", { method: "POST", json: {
      employeeId: gus.employeeId, shiftCode: "NOCHE", departmentId: central.id, effectiveFrom: rol.today, endDate: rol.today,
    } });
    expect((await ch.json()).temporary).toBe(true);
    const after = await (await adm.req("/api/admin/rol")).json();
    expect(after.rows.find((r: { fullName: string }) => r.fullName === "Gustavo Mata")).toMatchObject({ departmentName: "Central", support: true, temporary: true });
    expect((await adm.req("/api/admin/rol/area/end", { method: "POST", json: { employeeId: gus.employeeId } })).status).toBe(200);
  });

  it("encabezados de seguridad", async () => {
    const r = await fetch(`${BASE}/`);
    expect(r.headers.get("x-frame-options")).toBe("DENY");
    expect(r.headers.get("x-content-type-options")).toBe("nosniff");
    expect(r.headers.get("x-powered-by")).toBeNull();
    const html = await r.text();
    expect(html).not.toMatch(new RegExp(S.admin.password!));
  });
});

describe("20. Funcionamiento desde celular (Chrome con emulación)", () => {
  const devices = [
    { name: "iphone", viewport: { width: 390, height: 844, deviceScaleFactor: 2, isMobile: true, hasTouch: true },
      ua: "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1",
      emp: { number: "1008", name: "Jonathan Luna" }, setup: false },
    { name: "android", viewport: { width: 412, height: 915, deviceScaleFactor: 2.6, isMobile: true, hasTouch: true },
      ua: "Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Mobile Safari/537.36",
      emp: { number: "1012", name: "Enrique Suárez" }, setup: true },
  ];

  for (const d of devices) {
    it(`flujo completo del empleado en ${d.name}`, async () => {
      await openWindowNow("DIA");
      const ctx = await browser.createBrowserContext();
      const page = await ctx.newPage();
      await page.setViewport(d.viewport);
      await page.setUserAgent({ userAgent: d.ua });
      await page.goto(`${BASE}/`, { waitUntil: "networkidle0" });
      await page.waitForSelector("#num");
      await page.screenshot({ path: `${SHOTS}/${d.name}-1-login.png` });

      await page.type("#num", d.emp.number);
      await page.click("button[type=submit]");
      if (d.setup) {
        // Primera vez: crea su propio PIN
        await page.waitForSelector("#newpin");
        await page.screenshot({ path: `${SHOTS}/${d.name}-1b-crear-pin.png` });
        await page.type("#newpin", "123456");
        await page.type("#newpin2", "123456");
        await page.click("button[type=submit]");
        await page.waitForSelector("[role=alert]");
        expect(await page.$eval("[role=alert]", (e) => e.textContent)).toContain("fácil de adivinar");
        await page.click("#newpin", { count: 3 });
        for (let i = 0; i < 6; i++) await page.keyboard.press("Backspace");
        await page.click("#newpin2", { count: 3 });
        for (let i = 0; i < 6; i++) await page.keyboard.press("Backspace");
        await page.type("#newpin", "582047");
        await page.type("#newpin2", "582047");
        await page.click("button[type=submit]");
      } else {
        await page.waitForSelector("#pin");
        // PIN incorrecto
        await page.type("#pin", "000007");
        await page.click("button[type=submit]");
        await page.waitForSelector("[role=alert]");
        expect(await page.$eval("[role=alert]", (e) => e.textContent)).toContain("incorrecto");
        await page.click("#pin", { count: 3 });
        for (let i = 0; i < 6; i++) await page.keyboard.press("Backspace");
        await page.type("#pin", pinOf(S, d.emp.name));
        await page.click("button[type=submit]");
      }
      await page.waitForFunction(() => document.body.innerText.includes("CONFIRMAR MI ASISTENCIA"));
      const mainText = await page.evaluate(() => document.body.innerText);
      expect(mainText).toContain(d.emp.name);
      expect(mainText.toUpperCase()).toContain("TU TURNO DE HOY");
      await page.screenshot({ path: `${SHOTS}/${d.name}-2-confirmar.png` });

      const btn = await page.waitForSelector("xpath/.//button[contains(., 'CONFIRMAR MI ASISTENCIA')]");
      await btn!.tap();
      await page.waitForFunction(() => document.body.innerText.includes("¡ASISTENCIA REGISTRADA!"));
      const text = await page.evaluate(() => document.body.innerText);
      expect(text).toContain("Hora exacta");
      expect(text).not.toContain("CONFIRMAR MI ASISTENCIA");
      await page.screenshot({ path: `${SHOTS}/${d.name}-3-exito.png` });

      // Pestaña Mi perfil: subir foto (se recorta y comprime en el navegador)
      const perfil = await page.waitForSelector("xpath/.//nav//button[contains(., 'Mi perfil')]");
      await perfil!.tap();
      await page.waitForFunction(() => document.body.innerText.includes("Restablecer mi PIN"));
      const input = await page.$("input[type=file]");
      await (input as unknown as { uploadFile: (p: string) => Promise<void> }).uploadFile("tests/e2e/fixtures/foto-prueba.jpg");
      await page.waitForFunction(() => document.body.innerText.includes("Foto actualizada"));
      await page.waitForSelector("img[src^='/api/photos/']");
      await page.screenshot({ path: `${SHOTS}/${d.name}-4-perfil.png` });

      // Pestaña Mi grupo
      const grupo = await page.waitForSelector("xpath/.//nav//button[contains(., 'Mi grupo')]");
      await grupo!.tap();
      await page.waitForFunction(() => document.body.innerText.includes("Mi grupo ·"));
      await page.screenshot({ path: `${SHOTS}/${d.name}-5-grupo.png`, fullPage: true });
      const asis = await page.waitForSelector("xpath/.//nav//button[contains(., 'Asistencia')]");
      await asis!.tap();
      await page.waitForFunction(() => document.body.innerText.includes("¡ASISTENCIA REGISTRADA!"));

      // Sin desbordamiento horizontal
      const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
      expect(overflow).toBeLessThanOrEqual(0);

      // Recargar: muestra el registro existente
      await page.reload({ waitUntil: "networkidle0" });
      await page.waitForFunction(() => document.body.innerText.includes("Ya habías registrado"));
      await ctx.close();
    });
  }

  it("líder ve en su celular quién registró asistencia en su área", async () => {
    await openWindowNow("DIA");
    const ctx = await browser.createBrowserContext();
    const page = await ctx.newPage();
    await page.setViewport(devices[0].viewport);
    await page.goto(`${BASE}/`, { waitUntil: "networkidle0" });
    await page.type("#num", "1006");
    await page.click("button[type=submit]");
    await page.waitForSelector("#pin");
    await page.type("#pin", pinOf(S, "Isaías Romero"));
    await page.click("button[type=submit]");
    await page.waitForFunction(() => document.body.innerText.includes("CONFIRMAR MI ASISTENCIA"));
    const grupo = await page.waitForSelector("xpath/.//nav//button[contains(., 'Mi grupo')]");
    await grupo!.tap();
    await page.waitForFunction(() => document.body.innerText.includes("Asistencia de Central"));
    const text = await page.evaluate(() => document.body.innerText);
    expect(text).toContain("Jonathan Luna"); // registró en la prueba del iPhone
    expect(text).not.toContain("Enrique Suárez"); // es de RC
    await page.screenshot({ path: `${SHOTS}/lider-grupo.png`, fullPage: true });
    await ctx.close();
  });

  it("botón Llegaré tarde y recordatorios en el celular", async () => {
    await openWindowNow("DIA");
    const nowSec = getLocalParts(new Date()).seconds;
    await query(`UPDATE shifts SET late_limit = $1 WHERE code = 'DIA'`, [secondsToTime(nowSec + 5400)]);
    const eta = secondsToTime(nowSec + 2400).slice(0, 5);
    const ctx = await browser.createBrowserContext();
    const page = await ctx.newPage();
    await page.setViewport(devices[1].viewport);
    await page.goto(`${BASE}/`, { waitUntil: "networkidle0" });
    await page.type("#num", "1018");
    await page.click("button[type=submit]");
    await page.waitForSelector("#pin");
    await page.type("#pin", pinOf(S, "Norberto Sánchez"));
    await page.click("button[type=submit]");
    await page.waitForFunction(() => document.body.innerText.includes("Llegaré tarde"));
    await page.waitForFunction(() => document.body.innerText.includes("Recordatorios"));
    const btn = await page.waitForSelector("xpath/.//button[contains(., 'Llegaré tarde')]");
    await btn!.tap();
    await page.waitForSelector("input[type=time]");
    await page.$eval("input[type=time]", (el, v) => {
      const set = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!;
      set.call(el, v);
      el.dispatchEvent(new Event("input", { bubbles: true }));
    }, eta);
    await page.type("textarea", "Se descompuso el transporte");
    await page.screenshot({ path: `${SHOTS}/android-6-llegare-tarde.png`, fullPage: true });
    const send = await page.waitForSelector("xpath/.//button[contains(., 'Enviar aviso')]");
    await send!.tap();
    await page.waitForFunction(() => document.body.innerText.includes("Avisaste que llegarás tarde"));
    await page.screenshot({ path: `${SHOTS}/android-7-aviso-enviado.png`, fullPage: true });
    await ctx.close();
  });

  it("pantalla de registro cerrado en celular", async () => {
    await closeAllWindows();
    const ctx = await browser.createBrowserContext();
    const page = await ctx.newPage();
    await page.setViewport(devices[0].viewport);
    await page.goto(`${BASE}/`, { waitUntil: "networkidle0" });
    await page.type("#num", "2001");
    await page.click("button[type=submit]");
    await page.waitForSelector("#pin");
    await page.type("#pin", pinOf(S, "Enrique González"));
    await page.click("button[type=submit]");
    await page.waitForFunction(() => document.body.innerText.includes("EL REGISTRO DE ASISTENCIA SE ENCUENTRA CERRADO."));
    await page.screenshot({ path: `${SHOTS}/iphone-4-cerrado.png` });
    await ctx.close();
  });

  it("panel del supervisor en celular y en computadora", async () => {
    await openWindowNow("DIA");
    const ctx = await browser.createBrowserContext();
    const page = await ctx.newPage();
    await page.setViewport({ width: 390, height: 844, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
    await page.goto(`${BASE}/admin`, { waitUntil: "networkidle0" });
    expect(page.url()).toContain("/admin/login");
    await page.type("input[autocomplete=username]", "manuel");
    await page.type("input[type=password]", S.admin.password!);
    await page.click("button[type=submit]");
    await page.waitForFunction(() => document.body.innerText.toLowerCase().includes("total de empleados"), { timeout: 20_000 });
    await page.screenshot({ path: `${SHOTS}/panel-movil.png`, fullPage: true });

    await page.setViewport({ width: 1366, height: 900 });
    await page.reload({ waitUntil: "networkidle0" });
    await page.waitForFunction(() => document.body.innerText.toLowerCase().includes("total de empleados"));
    await page.screenshot({ path: `${SHOTS}/panel-escritorio.png`, fullPage: true });

    await page.goto(`${BASE}/admin/reporte?shift=DIA`, { waitUntil: "networkidle0" });
    await page.waitForFunction(() => document.body.innerText.includes("BUENOS DÍAS ASISTENCIA"));
    await page.screenshot({ path: `${SHOTS}/reporte-escritorio.png`, fullPage: true });

    await page.goto(`${BASE}/admin/calendario`, { waitUntil: "networkidle0" });
    await page.waitForFunction(() => document.body.innerText.includes("Calendario laboral"));
    await page.screenshot({ path: `${SHOTS}/calendario-escritorio.png`, fullPage: true });

    await page.goto(`${BASE}/admin/rol`, { waitUntil: "networkidle0" });
    await page.waitForFunction(() => document.body.innerText.includes("Enrique González"));
    await page.screenshot({ path: `${SHOTS}/rol-escritorio.png`, fullPage: true });

    await page.goto(`${BASE}/admin/solicitudes`, { waitUntil: "networkidle0" });
    await page.waitForFunction(() => document.body.innerText.includes("Calendario"));
    await page.screenshot({ path: `${SHOTS}/solicitudes-escritorio.png`, fullPage: true });

    await page.goto(`${BASE}/admin/empleados`, { waitUntil: "networkidle0" });
    await page.waitForFunction(() => document.body.innerText.includes("Isaías Romero"));
    await page.screenshot({ path: `${SHOTS}/empleados-escritorio.png` });
    const ficha = await page.waitForSelector("xpath/.//button[contains(., 'Isaac Antonio')]");
    await ficha!.click();
    await page.waitForFunction(() => document.body.innerText.includes("Faltas por semana"));
    await page.screenshot({ path: `${SHOTS}/ficha-escritorio.png` });
    await ctx.close();
  });
});
