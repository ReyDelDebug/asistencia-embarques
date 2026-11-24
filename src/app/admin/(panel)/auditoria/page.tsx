"use client";

import { useCallback, useEffect, useState } from "react";
import { Alert, api, Button, Card, CardHeader, dateTimeMx, inputClass } from "@/components/ui";

interface AuditRow {
  id: number; actor_type: string; actor_label: string | null; action: string; entity: string | null;
  entity_id: string | null; details: Record<string, unknown>; ip: string | null; created_at: string;
}

const ACTION_LABELS: Record<string, string> = {
  ATTENDANCE_CONFIRMED: "Asistencia confirmada",
  ATTENDANCE_DUPLICATE_BLOCKED: "Registro duplicado bloqueado",
  ATTENDANCE_REJECTED_CLOSED: "Intento fuera de horario",
  EMPLOYEE_LOGIN: "Ingreso de empleado",
  EMPLOYEE_LOGIN_FAILED: "PIN incorrecto",
  EMPLOYEE_LOCKED: "Cuenta de empleado bloqueada",
  EMPLOYEE_CREATED: "Empleado creado",
  EMPLOYEE_UPDATED: "Empleado modificado",
  EMPLOYEE_PIN_RESET: "PIN restablecido",
  EMPLOYEE_TERMINATED: "Baja de empleado",
  EMPLOYEE_REACTIVATED: "Empleado reactivado",
  EMPLOYEE_SEEDED: "Carga inicial",
  INCIDENT_SET: "Cambio de estado",
  INCIDENT_REVOKED: "Incidencia retirada",
  REPORT_DATA_UPDATED: "Datos del reporte",
  REPORT_COPY: "Reporte copiado",
  REPORT_SHARE: "Reporte compartido",
  REPORT_EXPORT: "Reporte exportado",
  EXCEL_EXPORTED: "Excel descargado",
  USER_LOGIN: "Ingreso al panel",
  USER_LOGIN_FAILED: "Contraseña incorrecta (panel)",
  USER_LOCKED: "Usuario del panel bloqueado",
  USER_CREATED: "Usuario creado",
  USER_PASSWORD_RESET: "Contraseña restablecida",
  USER_PASSWORD_CHANGED: "Contraseña cambiada",
  USER_ACTIVATED: "Usuario activado",
  USER_DEACTIVATED: "Usuario desactivado",
  USER_SEEDED: "Carga inicial (usuario)",
};

const PAGE = 50;

export default function AuditPage() {
  const [rows, setRows] = useState<AuditRow[]>([]);
  const [total, setTotal] = useState(0);
  const [offset, setOffset] = useState(0);
  const [action, setAction] = useState("");
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const qs = new URLSearchParams({ limit: String(PAGE), offset: String(offset) });
      if (action) qs.set("action", action);
      const r = await api<{ rows: AuditRow[]; total: number }>(`/api/admin/audit?${qs}`);
      setRows(r.rows);
      setTotal(r.total);
    } catch (e) {
      setError((e as Error).message);
    }
  }, [offset, action]);
  useEffect(() => { load(); }, [load]);

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-slate-900">Auditoría</h1>
          <p className="text-sm text-slate-500">Registro inalterable de movimientos del sistema</p>
        </div>
        <select className={`${inputClass} w-auto`} value={action} onChange={(e) => { setOffset(0); setAction(e.target.value); }}>
          <option value="">Todos los movimientos</option>
          <option value="ATTENDANCE">Asistencia</option>
          <option value="INCIDENT">Incidencias</option>
          <option value="EMPLOYEE">Empleados</option>
          <option value="REPORT">Reportes</option>
          <option value="EXCEL">Excel</option>
          <option value="USER">Usuarios del panel</option>
        </select>
      </div>
      {error && <Alert>{error}</Alert>}
      <Card>
        <CardHeader title="Movimientos" subtitle={`${total} en total`} />
        <div className="overflow-x-auto">
          <table className="min-w-full divide-y divide-slate-200 text-sm">
            <thead className="bg-slate-50 text-left text-xs font-semibold uppercase tracking-wide text-slate-600">
              <tr><th className="px-4 py-2.5">Fecha y hora</th><th className="px-4 py-2.5">Movimiento</th><th className="px-4 py-2.5">Usuario</th><th className="px-4 py-2.5">Detalle</th><th className="px-4 py-2.5">IP</th></tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {rows.map((r) => (
                <tr key={r.id} className="align-top">
                  <td className="whitespace-nowrap px-4 py-2 tabular">{dateTimeMx(r.created_at)}</td>
                  <td className="px-4 py-2 font-medium">{ACTION_LABELS[r.action] ?? r.action}</td>
                  <td className="px-4 py-2">{r.actor_label ?? (r.actor_type === "ANONYMOUS" ? "Sin sesión" : r.actor_type)}</td>
                  <td className="max-w-md px-4 py-2 font-mono text-xs text-slate-600 break-words">{Object.keys(r.details ?? {}).length ? JSON.stringify(r.details) : "—"}</td>
                  <td className="px-4 py-2 text-xs text-slate-500">{r.ip ?? "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <div className="flex items-center justify-between border-t border-slate-200 px-4 py-2 text-sm">
          <span className="text-slate-500">{total ? `${offset + 1}–${Math.min(offset + PAGE, total)} de ${total}` : "Sin movimientos"}</span>
          <div className="flex gap-2">
            <Button variant="secondary" disabled={offset === 0} onClick={() => setOffset(Math.max(0, offset - PAGE))}>Anterior</Button>
            <Button variant="secondary" disabled={offset + PAGE >= total} onClick={() => setOffset(offset + PAGE)}>Siguiente</Button>
          </div>
        </div>
      </Card>
    </div>
  );
}
