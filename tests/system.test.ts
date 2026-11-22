/**
 * Pruebas de integración contra PostgreSQL real.
 * La hora se inyecta explícitamente (es la misma función que usa la API con new Date()).
 */
import ExcelJS from "exceljs";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { query, queryOne } from "../src/lib/db";
import { verifySecret } from "../src/lib/crypto";
import { confirmAttendance, getAttendanceView } from "../src/lib/services/attendance";
import {
  getEmployeeFromToken, getUserFromToken, identifyEmployee, loginEmployee, loginUser, setupEmployeePin, type SessionUser,
} from "../src/lib/services/auth";
import { buildAttendanceWorkbook } from "../src/lib/services/excel";
import { createEmployee, resetEmployeePin, terminateEmployee, updateEmployee } from "../src/lib/services/employees";
import { cancelMyLeaveRequest, createLeaveRequest, decideLeaveRequest, listLeaveRequests } from "../src/lib/services/leave";
import { getRol, mondayOf, saveRol } from "../src/lib/services/rol";
import { revokeIncident, setIncident } from "../src/lib/services/incidents";
import { buildReport, saveOperationalData } from "../src/lib/services/report";
import { computeStats, getRoster } from "../src/lib/services/roster";
import { seed, type SeedResult } from "../scripts/seed";
import { activateAll, closePool, employeeByName, meta, mx, pinOf, resetDatabase, TEST_PIN } from "./helpers";

let S: SeedResult;
let admin: SessionUser;
const D1 = "2026-11-23";

beforeAll(async () => {
  S = await resetDatabase();
  await activateAll(["Wenceslao Félix", "Gustavo Mata"]); // estos dos aún no crean su PIN
  const login = await loginUser({ username: "manuel", password: S.admin.password! }, meta(mx(`${D1}T04:00:00`)));
  admin = login.user;
});
afterAll(async () => { await closePool(); });

async function confirmAt(name: string, local: string) {
  const emp = await employeeByName(name);
  return confirmAttendance(emp.id, meta(mx(local)));
}

describe("Carga inicial", () => {
  it("registra exactamente 36 empleados + supervisor de día, sin duplicar al repetir", async () => {
    const count = await queryOne<{ n: number }>("SELECT count(*)::int n FROM employees WHERE role <> 'SUPERVISOR'");
    expect(count!.n).toBe(36);
    const again = await seed({ writeFiles: false, log: false });
    expect(again.createdEmployees).toHaveLength(0);
    expect(again.admin.created).toBe(false);
    const total = await queryOne<{ n: number }>("SELECT count(*)::int n FROM employees");
    expect(total!.n).toBe(37);
  });

  it("áreas: Central (con subárea PT), RC y Lavadoras", async () => {
    const d = await query<{ code: string; name: string; report_label: string }>("SELECT code, name, report_label FROM departments ORDER BY sort_order");
    expect(d.map((x) => x.name)).toEqual(["Central", "RC", "Lavadoras"]);
    const sub = await query<{ name: string; dept: string }>("SELECT s.name, d.code dept FROM subareas s JOIN departments d ON d.id=s.department_id");
    expect(sub).toEqual([{ name: "PT", dept: "CENTRAL" }]);
  });

  it("líderes: Central Isaías Romero y Javier Ángeles, PT Manuel Cruz, RC Gerardo Marroquín y Gerardo González, Lavadoras Jonathan Cruz", async () => {
    const rows = await query<{ full_name: string; area: string }>(
      `SELECT e.full_name, d.name || COALESCE(' · ' || sa.name, '') AS area FROM employees e
       JOIN departments d ON d.id=e.department_id LEFT JOIN subareas sa ON sa.id=e.subarea_id
       WHERE e.role='LEADER' ORDER BY d.sort_order, sa.sort_order NULLS FIRST, e.full_name`);
    expect(rows.map((r) => [r.area, r.full_name])).toEqual([
      ["Central", "Isaías Romero"], ["Central", "Javier Ángeles"], ["Central · PT", "Manuel Cruz"],
      ["RC", "Gerardo González"], ["RC", "Gerardo Marroquín"], ["Lavadoras", "Jonathan Cruz"],
    ]);
  });

  it("estructura: Central día 11 (incluye PT); Manuel Cruz (PT) es distinto del supervisor Manuel", async () => {
    const rows = await query<{ full_name: string; role: string }>(
      `SELECT e.full_name, e.role FROM employees e JOIN shifts s ON s.id=e.shift_id JOIN departments d ON d.id=e.department_id
       WHERE s.code='DIA' AND d.code='CENTRAL'`);
    expect(rows).toHaveLength(11);
    expect(rows.find((r) => r.full_name === "Manuel Cruz")!.role).toBe("LEADER");
    const sup = await queryOne<{ role: string; department_id: number | null }>("SELECT role, department_id FROM employees WHERE employee_number='9001'");
    expect(sup).toEqual({ role: "SUPERVISOR", department_id: null });
    expect(admin.role).toBe("ADMIN");
  });

  it("los empleados se cargan SIN PIN (cada trabajador crea el suyo)", async () => {
    expect(S.createdEmployees).toHaveLength(37);
    const r = await queryOne<{ pin_hash: string | null }>("SELECT pin_hash FROM employees WHERE full_name='Wenceslao Félix'");
    expect(r!.pin_hash).toBeNull();
  });

  it("los PIN se guardan con hash (nunca en texto plano)", async () => {
    const r = await queryOne<{ pin_hash: string }>("SELECT pin_hash FROM employees WHERE full_name='Christian Tapia'");
    expect(r!.pin_hash.startsWith("scrypt$")).toBe(true);
    expect(r!.pin_hash).not.toContain(pinOf(S, "Christian Tapia"));
    expect(await verifySecret(pinOf(S, "Christian Tapia"), r!.pin_hash)).toBe(true);
  });
});

describe("1–2. Inicio de sesión", () => {
  it("1. inicio de sesión correcto crea una sesión válida", async () => {
    const emp = await employeeByName("Christian Tapia");
    const r = await loginEmployee({ employeeNumber: emp.employee_number, pin: pinOf(S, "Christian Tapia") }, meta(mx(`${D1}T05:30:00`)));
    expect(r.employee.fullName).toBe("Christian Tapia");
    expect(r.employee.departmentName).toBe("Central");
    const fromToken = await getEmployeeFromToken(r.token, mx(`${D1}T05:31:00`));
    expect(fromToken?.id).toBe(emp.id);
  });

  it("2. PIN incorrecto es rechazado con mensaje genérico", async () => {
    const emp = await employeeByName("Antonio Rosado");
    await expect(loginEmployee({ employeeNumber: emp.employee_number, pin: "000001" }, meta(mx(`${D1}T05:30:00`))))
      .rejects.toMatchObject({ status: 401, message: "Número de empleado o PIN incorrecto." });
    await expect(loginEmployee({ employeeNumber: "8888", pin: "123123" }, meta(mx(`${D1}T05:30:00`))))
      .rejects.toMatchObject({ status: 401, message: "Número de empleado o PIN incorrecto." });
  });
});

describe("3–9. Restricción de horarios", () => {
  it("3. registro antes de las 05:00 (04:59:59) -> cerrado", async () => {
    await expect(confirmAt("Alexis Altamirano", `${D1}T04:59:59`))
      .rejects.toMatchObject({ status: 403, code: "REGISTRATION_CLOSED", message: "EL REGISTRO DE ASISTENCIA SE ENCUENTRA CERRADO." });
  });
  it("4. registro a las 05:00:00 -> aceptado, con fecha operativa y hora del servidor", async () => {
    const r = await confirmAt("Alexis Altamirano", `${D1}T05:00:00`);
    expect(r.operationalDate).toBe(D1);
    expect(r.confirmedAt).toBe(mx(`${D1}T05:00:00`).toISOString());
  });
  it("5. registro a las 07:39:59 -> aceptado", async () => {
    const r = await confirmAt("Julio César", `${D1}T07:39:59`);
    expect(r.confirmedAt).toBe(mx(`${D1}T07:39:59`).toISOString());
  });
  it("6. registro a las 07:40:00 -> cerrado", async () => {
    await expect(confirmAt("Maximiliano", `${D1}T07:40:00`)).rejects.toMatchObject({ status: 403, code: "REGISTRATION_CLOSED" });
  });
  it("7. noche a las 17:00:00 -> aceptado", async () => {
    const r = await confirmAt("Enrique González", `${D1}T17:00:00`);
    expect(r.shiftCode).toBe("NOCHE");
    expect(r.operationalDate).toBe(D1);
  });
  it("8. noche a las 19:39:59 -> aceptado", async () => {
    const r = await confirmAt("Javier Ángeles", `${D1}T19:39:59`);
    expect(r.confirmedAt).toBe(mx(`${D1}T19:39:59`).toISOString());
  });
  it("9. noche a las 19:40:00 -> cerrado", async () => {
    await expect(confirmAt("Gregorio Meraz", `${D1}T19:40:00`)).rejects.toMatchObject({ status: 403, code: "REGISTRATION_CLOSED" });
  });
});

describe("10–14. Reglas por empleado", () => {
  it("10. registro duplicado bloqueado; se devuelve el registro original intacto", async () => {
    const first = await confirmAt("Christian Tapia", `${D1}T06:00:00`);
    await expect(confirmAt("Christian Tapia", `${D1}T06:05:00`)).rejects.toMatchObject({
      status: 409, code: "ALREADY_REGISTERED", extra: { existing: { confirmedAt: first.confirmedAt } },
    });
    const n = await queryOne<{ n: number }>("SELECT count(*)::int n FROM attendance a JOIN employees e ON e.id=a.employee_id WHERE e.full_name='Christian Tapia'");
    expect(n!.n).toBe(1);
  });

  it("10b. la hora de confirmación es inmutable a nivel base de datos", async () => {
    await expect(query("UPDATE attendance SET confirmed_at = now()")).rejects.toThrow(/no pueden modificarse/);
    await expect(query("DELETE FROM attendance")).rejects.toThrow(/no pueden modificarse/);
  });

  it("11. empleado de día: no puede registrar en la ventana de noche", async () => {
    await expect(confirmAt("Arturo Mata", `${D1}T17:30:00`)).rejects.toMatchObject({ code: "REGISTRATION_CLOSED" });
    const r = await confirmAt("Arturo Mata", `${D1}T06:30:00`);
    expect(r.shiftCode).toBe("DIA");
  });

  it("12. empleado de noche: no puede registrar en la ventana de día", async () => {
    await expect(confirmAt("Jair Nájera", `${D1}T06:00:00`)).rejects.toMatchObject({ code: "REGISTRATION_CLOSED" });
    const r = await confirmAt("Jair Nájera", `${D1}T17:45:00`);
    expect(r.shiftCode).toBe("NOCHE");
  });

  it("13. líder de Central registra y se cuenta como líder (+1)", async () => {
    await confirmAt("Isaías Romero", `${D1}T05:10:00`);
    const rep = await buildReport(D1, "DIA", mx(`${D1}T06:00:00`));
    const central = rep.departments.find((d) => d.label === "CENTRAL")!;
    expect(central.leaders).toBe(1);
    expect(central.hasLeader).toBe(true);
  });

  it("14. supervisor de día registra con su número y cuenta en SUPERVISOR", async () => {
    const sup = await queryOne<{ id: number }>("SELECT id FROM employees WHERE employee_number='9001'");
    await confirmAttendance(sup!.id, meta(mx(`${D1}T05:05:00`)));
    const rep = await buildReport(D1, "DIA", mx(`${D1}T06:00:00`));
    expect(rep.supervisors).toBe(1);
    expect(rep.text).toContain("*SUPERVISOR:* 1");
  });

  it("vista del empleado: muestra su registro existente", async () => {
    const emp = await employeeByName("Christian Tapia");
    const login = await loginEmployee({ employeeNumber: emp.employee_number, pin: pinOf(S, "Christian Tapia") }, meta(mx(`${D1}T07:00:00`)));
    const view = await getAttendanceView(login.employee, mx(`${D1}T07:00:00`));
    expect(view.existing?.confirmedAt).toBe(mx(`${D1}T06:00:00`).toISOString());
    expect(view.windowState).toBe("OPEN");
  });
});

describe("15. Incidencias", () => {
  it("cambia estado de un empleado sin confirmar, con motivo y auditoría", async () => {
    const emp = await employeeByName("Maximiliano");
    await expect(setIncident({ employeeId: emp.id, date: D1, type: "VACACIONES", reason: "" }, admin, "1.1.1.1", mx(`${D1}T08:00:00`)))
      .rejects.toMatchObject({ code: "REASON_REQUIRED" });
    const r = await setIncident({ employeeId: emp.id, date: D1, type: "VACACIONES", reason: "Periodo vacacional autorizado" }, admin, "1.1.1.1", mx(`${D1}T08:00:00`));
    const audit = await queryOne<{ actor_label: string; details: { reason: string; type: string } }>(
      "SELECT actor_label, details FROM audit_logs WHERE action='INCIDENT_SET' ORDER BY id DESC LIMIT 1");
    expect(audit!.actor_label).toBe("Manuel (Supervisor de día)");
    expect(audit!.details).toMatchObject({ type: "VACACIONES", reason: "Periodo vacacional autorizado" });

    // Reemplazo: la anterior queda revocada, no se borra
    await setIncident({ employeeId: emp.id, date: D1, type: "PSG", reason: "Corrección: era permiso" }, admin, "1.1.1.1", mx(`${D1}T08:05:00`));
    const all = await query<{ id: number; type: string; revoked_at: Date | null }>(
      "SELECT id, type, revoked_at FROM incidents WHERE employee_id=$1 ORDER BY id", [emp.id]);
    expect(all).toHaveLength(2);
    expect(all[0].revoked_at).not.toBeNull();
    expect(all[1]).toMatchObject({ type: "PSG", revoked_at: null });

    await revokeIncident(all[1].id, "Se capturó por error", admin, "1.1.1.1", mx(`${D1}T08:10:00`));
    await setIncident({ employeeId: emp.id, date: D1, type: "PSG", reason: "Permiso sin goce confirmado" }, admin, "1.1.1.1", mx(`${D1}T08:15:00`));
    expect(r.id).toBeGreaterThan(0);
  });

  it("no permite cambiar el estado de quien ya confirmó", async () => {
    const emp = await employeeByName("Christian Tapia");
    await expect(setIncident({ employeeId: emp.id, date: D1, type: "FALTA", reason: "Prueba de bloqueo" }, admin, "1.1.1.1", mx(`${D1}T08:00:00`)))
      .rejects.toMatchObject({ status: 409, code: "ALREADY_CONFIRMED" });
  });

  it("el historial de auditoría no puede alterarse", async () => {
    await expect(query("UPDATE audit_logs SET action='X'")).rejects.toThrow(/no puede modificarse/);
  });
});

describe("16. Reporte automático (día completo)", () => {
  const D2 = "2026-11-24";
  it("con los 23 del turno de día confirmados: SUPERVISOR 1, CENTRAL 9+1, PT 0+1, RAMPA C 5+1, LAVADORAS 4+1, TOTAL 23", async () => {
    const dayStaff = await query<{ id: number }>(
      "SELECT e.id FROM employees e JOIN shifts s ON s.id=e.shift_id WHERE s.code='DIA' AND e.active");
    expect(dayStaff).toHaveLength(23);
    for (const [i, e] of dayStaff.entries()) {
      await confirmAttendance(e.id, meta(mx(`${D2}T05:${String(10 + i).padStart(2, "0")}:00`)));
    }
    const rep = await buildReport(D2, "DIA", mx(`${D2}T07:45:00`));
    expect(rep.text).toBe([
      "*BUENOS DÍAS ASISTENCIA (HG) EMBARQUES*", "",
      "*FECHA:* 24 DE NOVIEMBRE", "",
      "*SUPERVISOR:* 1", "",
      "*CENTRAL:* 9+1", "",
      "*PT:* 0+1", "",
      "*RAMPA C:* 5+1", "",
      "*LAVADORAS:* 4+1", "",
      "*TOTAL:* 23", "",
      "*FALTA:*", "",
      "*PSG:*", "",
      "*VACACIONES:*", "",
      "*INCAPACIDAD:*", "",
      "*BAJA:*", "",
      "*VACANTES:*", "",
      "*RECOGE:*",
    ].join("\n"));
  });

  it("calcula faltas, incidencias, vacantes y personal adicional (sin cantidades fijas)", async () => {
    // D1: confirmados día = Alexis, Julio, Christian, Arturo Mata, Isaías, Manuel(sup)
    await saveOperationalData(D1, 1, {
      vacantes: "1", recoge: "Unidad 3",
      extras: [{ concept: "Descarga", quantity: 2, notes: "", addToTotal: true }, { concept: "BANDA", quantity: 1, notes: "apoyo", addToTotal: false }],
    }, admin, "1.1.1.1");
    const rep = await buildReport(D1, "DIA", mx(`${D1}T09:00:00`));
    expect(rep.supervisors).toBe(1);
    expect(rep.departments.map((d) => [d.label, d.employees, d.leaders])).toEqual([
      ["CENTRAL", 3, 1], ["PT", 0, 0], ["RAMPA C", 1, 0], ["LAVADORAS", 0, 0],
    ]);
    expect(rep.total).toBe(1 + 4 + 1 + 0 + 2); // descarga suma al total, banda no
    expect(rep.text).toContain("*CENTRAL:* 3+1");
    expect(rep.text).toContain("*DESCARGA:* 2");
    expect(rep.text).toContain("*BANDA:* 1 (apoyo)");
    expect(rep.text).toContain("*TOTAL:* 8");
    expect(rep.text).toContain("- Maximiliano (CENTRAL)\n");
    expect(rep.lists.PSG).toEqual(["Maximiliano (CENTRAL)"]);
    expect(rep.lists.FALTA).toContain("Wenceslao Félix (RAMPA C)");
    expect(rep.text).toContain("*VACANTES:* 1");
    expect(rep.text).toContain("*RECOGE:* Unidad 3");
    expect(rep.text).toContain("*RAMPA C:* 1+0");
  });

  it("reporte de noche: solo áreas con personal de noche", async () => {
    const rep = await buildReport(D1, "NOCHE", mx(`${D1}T20:00:00`));
    expect(rep.text.startsWith("*BUENAS NOCHES ASISTENCIA (HG) EMBARQUES*")).toBe(true);
    expect(rep.departments.map((d) => d.label)).toEqual(["CENTRAL", "RAMPA C"]);
    expect(rep.text).toContain("*CENTRAL:* 1+1"); // Enrique González + líder Javier Ángeles
    expect(rep.text).toContain("*RAMPA C:* 1+0"); // Jair Nájera; líder Gerardo González no registró
    expect(rep.supervisors).toBe(0);
    expect(rep.text).toContain("*TOTAL:* 3");
  });

  it("estadísticas del panel", async () => {
    const rows = await getRoster({ date: D1, shiftId: 1 }, mx(`${D1}T09:00:00`));
    const s = computeStats(rows);
    expect(s.total).toBe(23);
    expect(s.confirmed).toBe(6);
    expect(s.psg).toBe(1);
    expect(s.falta).toBe(16);
    expect(s.pending).toBe(0);
  });
});

describe("17. Exportación a Excel", () => {
  it("genera 3 hojas con encabezados, filtros y formatos de fecha/hora", async () => {
    const { buffer, filename } = await buildAttendanceWorkbook({ from: D1, to: "2026-11-24" }, mx("2026-11-24T21:00:00"));
    expect(filename).toBe("asistencia_2026-11-23_a_2026-11-24.xlsx");
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(buffer as unknown as ArrayBuffer);
    expect(wb.worksheets.map((w) => w.name)).toEqual(["ASISTENCIA GENERAL", "RESUMEN", "HISTORIAL"]);
    const ws = wb.getWorksheet("ASISTENCIA GENERAL")!;
    expect(ws.getRow(4).values).toEqual([undefined, "Número de empleado", "Nombre", "Área", "Puesto", "Turno", "Fecha", "Hora de confirmación", "Estado", "Observaciones"]);
    expect(ws.rowCount - 4).toBe(37 * 2);
    expect(ws.autoFilter).toBeTruthy();
    const alexis = ws.getRows(5, ws.rowCount - 4)!.find((r) => r.getCell(2).value === "Alexis Altamirano" && (r.getCell(6).value as Date).toISOString().startsWith(D1))!;
    expect(alexis.getCell(6).numFmt).toBe("dd/mm/yyyy");
    expect(alexis.getCell(7).numFmt).toBe("hh:mm:ss");
    expect((alexis.getCell(7).value as Date).toISOString()).toBe(`${D1}T05:00:00.000Z`);
    expect(alexis.getCell(8).value).toBe("Confirmado");
    const resumen = wb.getWorksheet("RESUMEN")!;
    const values = resumen.getColumn(1).values as string[];
    expect(values).toContain("Confirmados");
    expect(values).toContain("PSG");
    const hist = wb.getWorksheet("HISTORIAL")!;
    expect(hist.rowCount).toBeGreaterThan(30);

    const filtered = await buildAttendanceWorkbook({ from: D1, to: D1, shiftId: 2, departmentId: 2 }, mx("2026-11-24T21:00:00"));
    const wb2 = new ExcelJS.Workbook();
    await wb2.xlsx.load(filtered.buffer as unknown as ArrayBuffer);
    expect(wb2.getWorksheet("ASISTENCIA GENERAL")!.rowCount - 4).toBe(6); // RC noche
  });

  it("rechaza periodos inválidos", async () => {
    await expect(buildAttendanceWorkbook({ from: "2026-11-24", to: "2026-11-23" }, new Date())).rejects.toMatchObject({ code: "BAD_RANGE" });
    await expect(buildAttendanceWorkbook({ from: "2026-01-01", to: "2026-12-31" }, new Date())).rejects.toMatchObject({ code: "RANGE_TOO_LONG" });
  });
});

describe("19. Intentos repetidos de PIN", () => {
  it("bloquea la cuenta tras 5 intentos fallidos aunque después use el PIN correcto", async () => {
    const emp = await employeeByName("David Ponce");
    const t = mx(`${D1}T05:20:00`);
    for (let i = 0; i < 4; i++) {
      await expect(loginEmployee({ employeeNumber: emp.employee_number, pin: "909090" }, meta(t, "10.9.9.9")))
        .rejects.toMatchObject({ status: 401 });
    }
    await expect(loginEmployee({ employeeNumber: emp.employee_number, pin: "909090" }, meta(t, "10.9.9.9")))
      .rejects.toMatchObject({ status: 423, code: "ACCOUNT_LOCKED" });
    await expect(loginEmployee({ employeeNumber: emp.employee_number, pin: pinOf(S, "David Ponce") }, meta(t, "10.9.9.9")))
      .rejects.toMatchObject({ status: 423 });
    // Pasados 15 minutos vuelve a funcionar
    const later = await loginEmployee({ employeeNumber: emp.employee_number, pin: pinOf(S, "David Ponce") }, meta(mx(`${D1}T05:36:00`), "10.9.9.9"));
    expect(later.employee.fullName).toBe("David Ponce");
  });

  it("el supervisor puede restablecer el PIN: el anterior deja de servir y el trabajador crea uno nuevo", async () => {
    const emp = await employeeByName("Gerardo Marroquín");
    await resetEmployeePin(emp.id, admin, "1.1.1.1");
    await expect(loginEmployee({ employeeNumber: emp.employee_number, pin: TEST_PIN }, meta(mx(`${D1}T05:40:00`), "10.8.8.8")))
      .rejects.toMatchObject({ status: 409, code: "PIN_SETUP_REQUIRED" });
    await setupEmployeePin({ employeeNumber: emp.employee_number, pin: "731904", pinConfirm: "731904" }, meta(mx(`${D1}T05:41:00`), "10.8.8.8"));
    const ok = await loginEmployee({ employeeNumber: emp.employee_number, pin: "731904" }, meta(mx(`${D1}T05:41:30`), "10.8.8.8"));
    expect(ok.employee.id).toBe(emp.id);
  });

  it("limita por IP (40 fallos en 15 minutos)", async () => {
    const t = mx(`${D1}T10:00:00`);
    for (let i = 0; i < 40; i++) {
      await loginEmployee({ employeeNumber: "7777", pin: "1234" }, meta(t, "66.66.66.66")).catch(() => undefined);
    }
    await expect(loginEmployee({ employeeNumber: "7777", pin: "1234" }, meta(t, "66.66.66.66")))
      .rejects.toMatchObject({ status: 429 });
  });
});

describe("Administración de empleados", () => {
  it("crear empleado genera número y PIN; baja revoca acceso", async () => {
    const shift = await queryOne<{ id: number }>("SELECT id FROM shifts WHERE code='NOCHE'");
    const created = await createEmployee({ fullName: "Supervisor Noche Prueba", role: "SUPERVISOR", departmentId: null, shiftId: shift!.id }, admin, "1.1.1.1");
    expect(created.employeeNumber).toBe("9002");
    const login = await setupEmployeePin({ employeeNumber: created.employeeNumber, pin: TEST_PIN, pinConfirm: TEST_PIN }, meta(mx(`${D1}T18:00:00`), "10.7.7.7"));
    await terminateEmployee(created.id, "Prueba de baja", undefined, admin, "1.1.1.1", mx(`${D1}T18:10:00`));
    expect(await getEmployeeFromToken(login.token, mx(`${D1}T18:11:00`))).toBeNull();
    await expect(loginEmployee({ employeeNumber: created.employeeNumber, pin: TEST_PIN }, meta(mx(`${D1}T18:12:00`), "10.7.7.7")))
      .rejects.toMatchObject({ status: 401 });
  });

  it("contraseña de administrador incorrecta es rechazada; sesión de panel válida", async () => {
    await expect(loginUser({ username: "manuel", password: "incorrecta123" }, meta(mx(`${D1}T09:00:00`), "10.5.5.5")))
      .rejects.toMatchObject({ status: 401 });
    const ok = await loginUser({ username: "manuel", password: S.admin.password! }, meta(new Date(), "10.5.5.5"));
    expect((await getUserFromToken(ok.token))?.username).toBe("manuel");
  });
});

describe("Alta del trabajador: número de empleado + PIN propio", () => {
  const t = () => meta(mx("2026-11-23T10:00:00"), "10.4.4.4");
  it("primera vez: pide crear PIN, valida el PIN y crea la sesión", async () => {
    const emp = await employeeByName("Wenceslao Félix");
    expect(await identifyEmployee(emp.employee_number, t())).toEqual({ status: "SETUP", firstName: "Wenceslao" });
    await expect(loginEmployee({ employeeNumber: emp.employee_number, pin: "482915" }, t()))
      .rejects.toMatchObject({ status: 409, code: "PIN_SETUP_REQUIRED" });
    await expect(setupEmployeePin({ employeeNumber: emp.employee_number, pin: "12", pinConfirm: "12" }, t()))
      .rejects.toMatchObject({ code: "BAD_PIN" });
    await expect(setupEmployeePin({ employeeNumber: emp.employee_number, pin: "123456", pinConfirm: "123456" }, t()))
      .rejects.toMatchObject({ code: "WEAK_PIN" });
    await expect(setupEmployeePin({ employeeNumber: emp.employee_number, pin: "583920", pinConfirm: "583921" }, t()))
      .rejects.toMatchObject({ code: "PIN_MISMATCH" });
    const ok = await setupEmployeePin({ employeeNumber: emp.employee_number, pin: "583920", pinConfirm: "583920" }, t());
    expect(ok.employee.fullName).toBe("Wenceslao Félix");
    expect((await getEmployeeFromToken(ok.token, mx("2026-11-23T10:01:00")))?.id).toBe(emp.id);
  });

  it("nadie puede volver a 'crear' el PIN de alguien que ya lo tiene", async () => {
    const emp = await employeeByName("Wenceslao Félix");
    await expect(setupEmployeePin({ employeeNumber: emp.employee_number, pin: "604817", pinConfirm: "604817" }, t()))
      .rejects.toMatchObject({ status: 409, code: "PIN_ALREADY_SET" });
    expect((await identifyEmployee(emp.employee_number, t())).status).toBe("PIN");
    const ok = await loginEmployee({ employeeNumber: emp.employee_number, pin: "583920" }, t());
    expect(ok.employee.id).toBe(emp.id);
  });

  it("número no registrado", async () => {
    await expect(identifyEmployee("55555", t())).rejects.toMatchObject({ status: 404, code: "NOT_REGISTERED" });
  });
});

describe("Rol de turno (semanal, vigente hasta que se cambie)", () => {
  const before = mx("2026-12-01T10:00:00");
  it("mondayOf", () => {
    expect(mondayOf("2026-12-09")).toBe("2026-12-07");
    expect(mondayOf("2026-12-13")).toBe("2026-12-07");
    expect(mondayOf("2026-12-07")).toBe("2026-12-07");
  });

  it("no permite aplicar el rol en fechas pasadas", async () => {
    const e = await employeeByName("Enrique González");
    await expect(saveRol("2026-11-30", [{ employeeId: e.id, shiftCode: "DIA" }], admin, "1.1.1.1", before))
      .rejects.toMatchObject({ code: "PAST_DATE" });
  });

  it("el supervisor cambia a Enrique González de Noche a Día a partir del lunes; sin cambios no registra nada", async () => {
    const enrique = await employeeByName("Enrique González");
    const christian = await employeeByName("Christian Tapia");
    const antonio = await employeeByName("Antonio Rosado");
    const r = await saveRol("2026-12-07", [
      { employeeId: enrique.id, shiftCode: "DIA" },
      { employeeId: christian.id, shiftCode: "NOCHE" },
      { employeeId: antonio.id, shiftCode: "DIA" }, // ya es de día: no cuenta como cambio
    ], admin, "1.1.1.1", before);
    expect(r.changed).toBe(2);
    const rol = await getRol("2026-12-07");
    expect(rol.find((x) => x.fullName === "Enrique González")).toMatchObject({ shiftCode: "DIA", since: "2026-12-07" });
    const rolBefore = await getRol("2026-12-04");
    expect(rolBefore.find((x) => x.fullName === "Enrique González")).toMatchObject({
      shiftCode: "NOCHE", nextChange: { date: "2026-12-07", shiftCode: "DIA" },
    });
  });

  it("la asistencia se valida contra el turno asignado en el rol", async () => {
    // Antes del cambio: sigue de noche
    await expect(confirmAt("Enrique González", "2026-12-04T06:00:00")).rejects.toMatchObject({ code: "REGISTRATION_CLOSED" });
    // Desde el lunes: de día
    await expect(confirmAt("Enrique González", "2026-12-07T17:30:00")).rejects.toMatchObject({ code: "REGISTRATION_CLOSED" });
    expect((await confirmAt("Enrique González", "2026-12-07T06:00:00")).shiftCode).toBe("DIA");
    // Christian ahora es de noche
    await expect(confirmAt("Christian Tapia", "2026-12-08T06:00:00")).rejects.toMatchObject({ code: "REGISTRATION_CLOSED" });
    expect((await confirmAt("Christian Tapia", "2026-12-08T17:15:00")).shiftCode).toBe("NOCHE");
  });

  it("si no se cambia, sigue igual (rotación cada 15 días)", async () => {
    const rol = await getRol("2026-12-21");
    expect(rol.find((x) => x.fullName === "Enrique González")!.shiftCode).toBe("DIA");
    const enrique = await employeeByName("Enrique González");
    await saveRol("2026-12-21", [{ employeeId: enrique.id, shiftCode: "NOCHE" }], admin, "1.1.1.1", before);
    expect((await getRol("2026-12-20")).find((x) => x.fullName === "Enrique González")!.shiftCode).toBe("DIA");
    expect((await getRol("2026-12-21")).find((x) => x.fullName === "Enrique González")!.shiftCode).toBe("NOCHE");
  });

  it("el panel, las faltas y el reporte usan el turno del rol", async () => {
    const day = await getRoster({ date: "2026-12-07", shiftId: 1 }, mx("2026-12-07T09:00:00"));
    const night = await getRoster({ date: "2026-12-07", shiftId: 2 }, mx("2026-12-07T21:00:00"));
    expect(day.find((r) => r.fullName === "Enrique González")!.status).toBe("CONFIRMADO");
    expect(night.find((r) => r.fullName === "Enrique González")).toBeUndefined();
    expect(night.find((r) => r.fullName === "Christian Tapia")!.status).toBe("FALTA");
    expect(day.find((r) => r.fullName === "Christian Tapia")).toBeUndefined();
    const audit = await queryOne<{ n: number }>("SELECT count(*)::int n FROM audit_logs WHERE action='ROL_UPDATED'");
    expect(audit!.n).toBe(2);
  });
});

describe("Falta automática al cerrar el registro (07:40) y en el Excel", () => {
  const D = "2026-12-02";
  it("07:39:59 pendiente; 07:40:00 falta", async () => {
    const at = async (t: string) => (await getRoster({ date: D, shiftId: 1 }, mx(`${D}T${t}`))).find((r) => r.fullName === "Antonio Rosado")!.status;
    expect(await at("07:39:59")).toBe("PENDIENTE");
    expect(await at("07:40:00")).toBe("FALTA");
  });

  it("el Excel exporta como Falta a quien no registró antes de las 07:40", async () => {
    const { buffer } = await buildAttendanceWorkbook({ from: D, to: D, shiftId: 1 }, mx(`${D}T07:40:00`));
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(buffer as unknown as ArrayBuffer);
    const ws = wb.getWorksheet("ASISTENCIA GENERAL")!;
    const row = ws.getRows(5, ws.rowCount - 4)!.find((r) => r.getCell(2).value === "Antonio Rosado")!;
    expect(row.getCell(8).value).toBe("Falta");
    expect(row.getCell(9).value).toContain("Sin registro");
  });
});

describe("Solicitudes de vacaciones / PSG", () => {
  const now = mx("2026-12-01T12:00:00");
  let reqId = 0;
  const sessionOf = async (name: string) => {
    const e = await employeeByName(name);
    return (await loginEmployee({ employeeNumber: e.employee_number, pin: TEST_PIN }, meta(now, "10.3.3.3"))).employee;
  };

  it("el trabajador solicita; se validan fechas y traslapes", async () => {
    const jc = await sessionOf("Jonathan Cruz");
    await expect(createLeaveRequest(jc, { type: "VACACIONES", startDate: "2026-11-30", endDate: "2026-12-02" }, "ip", now))
      .rejects.toMatchObject({ code: "PAST_DATE" });
    await expect(createLeaveRequest(jc, { type: "VACACIONES", startDate: "2026-12-10", endDate: "2027-02-10" }, "ip", now))
      .rejects.toMatchObject({ code: "TOO_LONG" });
    const r = await createLeaveRequest(jc, { type: "VACACIONES", startDate: "2026-12-14", endDate: "2026-12-16", reason: "Viaje familiar" }, "ip", now);
    expect(r).toMatchObject({ status: "PENDIENTE", days: 3, fullName: "Jonathan Cruz" });
    reqId = r.id;
    await expect(createLeaveRequest(jc, { type: "PSG", startDate: "2026-12-16", endDate: "2026-12-17" }, "ip", now))
      .rejects.toMatchObject({ code: "OVERLAP" });
  });

  it("mientras está pendiente NO cuenta como vacaciones", async () => {
    const rows = await getRoster({ date: "2026-12-15", shiftId: 1 }, mx("2026-12-15T09:00:00"));
    expect(rows.find((r) => r.fullName === "Jonathan Cruz")!.status).toBe("FALTA");
  });

  it("rechazar exige motivo; aprobar registra cada día como VACACIONES", async () => {
    await expect(decideLeaveRequest(reqId, "RECHAZAR", "", admin, "1.1.1.1", now)).rejects.toMatchObject({ code: "REASON_REQUIRED" });
    const r = await decideLeaveRequest(reqId, "APROBAR", "Autorizado", admin, "1.1.1.1", now);
    expect(r).toMatchObject({ status: "APROBADA", daysRegistered: 3 });
    await expect(decideLeaveRequest(reqId, "APROBAR", "", admin, "1.1.1.1", now)).rejects.toMatchObject({ code: "ALREADY_DECIDED" });
    for (const d of ["2026-12-14", "2026-12-15", "2026-12-16"]) {
      const rows = await getRoster({ date: d, shiftId: 1 }, mx(`${d}T09:00:00`));
      expect(rows.find((x) => x.fullName === "Jonathan Cruz")!.status).toBe("VACACIONES");
    }
    const rows17 = await getRoster({ date: "2026-12-17", shiftId: 1 }, mx("2026-12-17T09:00:00"));
    expect(rows17.find((x) => x.fullName === "Jonathan Cruz")!.status).toBe("FALTA");
  });

  it("aparece en el reporte, el Excel y el calendario", async () => {
    const rep = await buildReport("2026-12-15", "DIA", mx("2026-12-15T09:00:00"));
    expect(rep.text).toContain("*VACACIONES:*\n- Jonathan Cruz (LAVADORAS)");
    const { buffer } = await buildAttendanceWorkbook({ from: "2026-12-15", to: "2026-12-15", shiftId: 1 }, mx("2026-12-15T09:00:00"));
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(buffer as unknown as ArrayBuffer);
    const ws = wb.getWorksheet("ASISTENCIA GENERAL")!;
    expect(ws.getRows(5, ws.rowCount - 4)!.find((x) => x.getCell(2).value === "Jonathan Cruz")!.getCell(8).value).toBe("Vacaciones");
    const cal = await listLeaveRequests({ from: "2026-12-01", to: "2026-12-31" });
    expect(cal.map((x) => [x.fullName, x.status])).toContainEqual(["Jonathan Cruz", "APROBADA"]);
  });

  it("PSG: el trabajador puede cancelar mientras está pendiente; el rechazo no registra días", async () => {
    const mc = await sessionOf("Miguel Cruz");
    const a = await createLeaveRequest(mc, { type: "PSG", startDate: "2026-12-18", endDate: "2026-12-18" }, "ip", now);
    await cancelMyLeaveRequest(mc, a.id, "ip");
    const b = await createLeaveRequest(mc, { type: "PSG", startDate: "2026-12-18", endDate: "2026-12-18" }, "ip", now);
    const r = await decideLeaveRequest(b.id, "RECHAZAR", "Día de inventario", admin, "1.1.1.1", now);
    expect(r).toMatchObject({ status: "RECHAZADA", daysRegistered: 0 });
    const c = await createLeaveRequest(mc, { type: "PSG", startDate: "2026-12-19", endDate: "2026-12-19" }, "ip", now);
    await decideLeaveRequest(c.id, "APROBAR", "", admin, "1.1.1.1", now);
    const rep = await buildReport("2026-12-19", "DIA", mx("2026-12-19T09:00:00"));
    expect(rep.lists.PSG).toEqual(["Miguel Cruz (LAVADORAS)"]);
  });
});

describe("Subárea PT dentro de Central (dos líderes en Central)", () => {
  it("el reporte muestra CENTRAL y PT por separado, cada uno con su líder", async () => {
    const central = await queryOne<{ id: number }>("SELECT id FROM departments WHERE code='CENTRAL'");
    const pt = await queryOne<{ id: number }>("SELECT id FROM subareas WHERE code='PT'");
    const luna = await employeeByName("Jonathan Luna");
    await updateEmployee(luna.id, { fullName: "Jonathan Luna", role: "EMPLOYEE", departmentId: central!.id, subareaId: pt!.id, shiftId: 1 }, admin, "1.1.1.1");
    const D = "2026-12-03";
    await confirmAt("Isaías Romero", `${D}T05:30:00`);
    await confirmAt("Manuel Cruz", `${D}T05:31:00`);
    await confirmAt("Jonathan Luna", `${D}T05:32:00`);
    await confirmAt("Moisés Muñoz", `${D}T05:33:00`);
    const rep = await buildReport(D, "DIA", mx(`${D}T08:00:00`));
    expect(rep.text).toContain("*CENTRAL:* 1+1\n\n*PT:* 1+1\n\n*RAMPA C:* 0+0");
    expect(rep.total).toBe(4);
    const rows = await getRoster({ date: D, shiftId: 1 }, mx(`${D}T08:00:00`));
    expect(rows.find((r) => r.fullName === "Manuel Cruz")!.departmentName).toBe("Central · PT");
  });

  it("la subárea debe pertenecer al área", async () => {
    const rc = await queryOne<{ id: number }>("SELECT id FROM departments WHERE code='RC'");
    const pt = await queryOne<{ id: number }>("SELECT id FROM subareas WHERE code='PT'");
    const e = await employeeByName("David Ponce");
    await expect(updateEmployee(e.id, { fullName: "David Ponce", role: "EMPLOYEE", departmentId: rc!.id, subareaId: pt!.id, shiftId: 1 }, admin, "1.1.1.1"))
      .rejects.toMatchObject({ code: "BAD_SUBAREA" });
  });
});
