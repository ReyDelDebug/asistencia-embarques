"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { IncidentModal, RevokeModal, type IncidentTarget } from "@/components/admin/IncidentModal";
import {
  Alert, api, ApiError, Badge, Button, Card, CardHeader, dateLong, Field, inputClass, ROLE_LABELS, StatCard,
  StatusBadge, STATUS_LABELS, timeMx,
} from "@/components/ui";

interface Row {
  employeeId: number; employeeNumber: string; fullName: string; role: string; date: string;
  shiftId: number; shiftCode: string; shiftName: string; departmentId: number | null; departmentName: string;
  confirmedAt: string | null; status: string; automatic: boolean; incidentId: number | null;
  incidentReason: string | null; incidentBy: string | null; observations: string;
  late: boolean; lateEta: string | null; lateReason: string | null; extensionUntil: string | null; extensionBy: string | null;
  canExtend: boolean;
}
interface Group { key: string; label: string; total: number; confirmed: number }
interface Dashboard {
  date: string; shiftCode: string | null; departmentId: number | null; status: string | null;
  context: { date: string; shiftCode: string }; localTime: string;
  shifts: { id: number; code: string; name: string; openTime: string; closeTime: string }[];
  departments: { id: number; name: string }[];
  stats: {
    total: number; confirmed: number; pending: number; retardo: number; lateArrivals: number; falta: number; vacaciones: number; incapacidad: number;
    psg: number; baja: number; percentage: number; byDepartment: Group[]; byShift: Group[];
  };
  rows: Row[];
}

export default function DashboardPage() {
  const [data, setData] = useState<Dashboard | null>(null);
  const [filters, setFilters] = useState<{ date?: string; shift?: string; dept?: string; status?: string }>({});
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [incidentTarget, setIncidentTarget] = useState<IncidentTarget | null>(null);
  const [revoke, setRevoke] = useState<{ id: number; label: string } | null>(null);
  const [lastUpdate, setLastUpdate] = useState<string>("");
  const [extMsg, setExtMsg] = useState<{ kind: "success" | "error"; text: string } | null>(null);
  const [extBusy, setExtBusy] = useState(false);

  async function extend(ids: number[]) {
    setExtBusy(true);
    setExtMsg(null);
    try {
      const r = await api<{ granted: string[]; skipped: { name: string; reason: string }[] }>("/api/admin/extensions", {
        method: "POST", json: { employeeIds: ids },
      });
      const parts = [];
      if (r.granted.length) parts.push(`Registro abierto hasta las 7:30 para: ${r.granted.join(", ")}.`);
      if (r.skipped.length) parts.push(`Sin cambio: ${r.skipped.map((x) => `${x.name} (${x.reason})`).join(", ")}.`);
      setExtMsg({ kind: r.granted.length ? "success" : "error", text: parts.join(" ") });
      load();
    } catch (e) {
      setExtMsg({ kind: "error", text: (e as Error).message });
    } finally {
      setExtBusy(false);
    }
  }

  const load = useCallback(async () => {
    const qs = new URLSearchParams();
    if (filters.date) qs.set("date", filters.date);
    if (filters.shift !== undefined) qs.set("shift", filters.shift);
    if (filters.dept) qs.set("dept", filters.dept);
    if (filters.status) qs.set("status", filters.status);
    try {
      const d = await api<Dashboard>(`/api/admin/dashboard?${qs}`);
      setData(d);
      setError(null);
      setLastUpdate(d.localTime);
    } catch (e) {
      if (e instanceof ApiError && e.status === 401) window.location.href = "/admin/login";
      else setError((e as Error).message);
    }
  }, [filters]);

  useEffect(() => { load(); }, [load]);
  useEffect(() => {
    const t = setInterval(load, 15_000); // actualización en tiempo real
    return () => clearInterval(t);
  }, [load]);

  if (!data) return <div className="py-20 text-center text-slate-500">{error ?? "Cargando panel…"}</div>;

  const s = data.stats;
  const rows = data.rows.filter((r) =>
    !search || `${r.fullName} ${r.employeeNumber}`.toLowerCase().includes(search.toLowerCase()));
  const exportQs = new URLSearchParams({ from: data.date, to: data.date });
  if (data.shiftCode) exportQs.set("shift", data.shiftCode);
  if (data.departmentId) exportQs.set("dept", String(data.departmentId));

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-xl font-bold text-slate-900">Asistencia del día</h1>
          <p className="text-sm text-slate-500">
            {dateLong(data.date)} · {data.shiftCode ? `Turno ${data.shifts.find((x) => x.code === data.shiftCode)?.name}` : "Ambos turnos"}
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Link href={`/admin/reporte?date=${data.date}&shift=${data.shiftCode ?? data.context.shiftCode}`}>
            <Button>Generar reporte WhatsApp</Button>
          </Link>
          <a href={`/api/admin/export?${exportQs}`}><Button variant="secondary">DESCARGAR EXCEL</Button></a>
        </div>
      </div>

      <Card className="p-4">
        <div className="grid grid-cols-2 gap-3 md:grid-cols-5">
          <Field label="Fecha">
            <input type="date" className={inputClass} value={data.date}
              onChange={(e) => setFilters((f) => ({ ...f, date: e.target.value, shift: f.shift ?? data.shiftCode ?? "" }))} />
          </Field>
          <Field label="Turno">
            <select className={inputClass} value={data.shiftCode ?? ""}
              onChange={(e) => setFilters((f) => ({ ...f, date: f.date ?? data.date, shift: e.target.value }))}>
              <option value="">Ambos</option>
              {data.shifts.map((x) => <option key={x.code} value={x.code}>{x.name}</option>)}
            </select>
          </Field>
          <Field label="Área">
            <select className={inputClass} value={data.departmentId ?? ""}
              onChange={(e) => setFilters((f) => ({ ...f, date: f.date ?? data.date, shift: f.shift ?? data.shiftCode ?? "", dept: e.target.value }))}>
              <option value="">Todas</option>
              {data.departments.map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}
            </select>
          </Field>
          <Field label="Estado">
            <select className={inputClass} value={data.status ?? ""}
              onChange={(e) => setFilters((f) => ({ ...f, date: f.date ?? data.date, shift: f.shift ?? data.shiftCode ?? "", status: e.target.value }))}>
              <option value="">Todos</option>
              {Object.entries(STATUS_LABELS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
            </select>
          </Field>
          <Field label="Buscar">
            <input className={inputClass} placeholder="Nombre o número" value={search} onChange={(e) => setSearch(e.target.value)} />
          </Field>
        </div>
        <div className="mt-3 flex flex-wrap items-center justify-between gap-2 text-xs text-slate-500">
          <span>Actualización automática cada 15 s · Última: {lastUpdate}</span>
          <button className="font-semibold text-slate-700 underline" onClick={() => { setFilters({}); setSearch(""); }}>
            Volver al turno actual
          </button>
        </div>
      </Card>

      {error && <Alert>{error}</Alert>}

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <StatCard label="Total de empleados" value={s.total} hint="Plantilla activa en el filtro" />
        <StatCard label="Confirmados" value={s.confirmed} tone="green" />
        <StatCard label="Pendientes" value={s.pending} tone="amber"
          hint={[s.retardo ? `${s.retardo} avisaron retardo` : "", s.lateArrivals ? `${s.lateArrivals} llegaron tarde` : ""].filter(Boolean).join(" · ") || undefined} />
        <StatCard label="Asistencia" value={`${s.percentage}%`} />
      </div>

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-5">
        {([["Faltas", s.falta], ["Vacaciones", s.vacaciones], ["Incapacidad", s.incapacidad], ["PSG", s.psg], ["Bajas", s.baja]] as const).map(([l, v]) => (
          <Card key={l} className="flex items-center justify-between px-3 py-2">
            <span className="text-xs font-semibold uppercase text-slate-500">{l}</span>
            <span className="text-lg font-bold tabular">{v}</span>
          </Card>
        ))}
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <Distribution title="Distribución por área" groups={s.byDepartment} />
        <Distribution title="Distribución por turno" groups={s.byShift} />
      </div>

      {extMsg && <Alert kind={extMsg.kind}>{extMsg.text}</Alert>}
      <Card>
        <CardHeader title="Personal" subtitle={`${rows.length} registro(s)`}
          actions={rows.filter((r) => r.canExtend).length > 0 ? (
            <Button variant="secondary" className="text-xs" loading={extBusy}
              onClick={() => extend(rows.filter((r) => r.canExtend).map((r) => r.employeeId))}>
              Abrir hasta 7:30 a los {rows.filter((r) => r.canExtend).length} sin registro mostrados
            </Button>
          ) : undefined} />
        <div className="overflow-x-auto">
          <table className="min-w-full divide-y divide-slate-200 text-sm">
            <thead className="bg-slate-50 text-left text-xs font-semibold uppercase tracking-wide text-slate-600">
              <tr>
                <th className="px-4 py-2.5">Empleado</th>
                <th className="px-4 py-2.5">Área</th>
                <th className="px-4 py-2.5">Turno</th>
                <th className="px-4 py-2.5">Hora</th>
                <th className="px-4 py-2.5">Estado</th>
                <th className="px-4 py-2.5 text-right">Acciones</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {rows.map((r) => (
                <tr key={`${r.employeeId}-${r.shiftId}`} className="hover:bg-slate-50">
                  <td className="px-4 py-2.5">
                    <div className="font-semibold text-slate-900">{r.fullName}</div>
                    <div className="text-xs text-slate-500">
                      #{r.employeeNumber}
                      {r.role !== "EMPLOYEE" && <Badge className="ml-2 bg-slate-900 text-white ring-slate-900">{ROLE_LABELS[r.role]}</Badge>}
                    </div>
                  </td>
                  <td className="px-4 py-2.5">{r.departmentName}</td>
                  <td className="px-4 py-2.5">{r.shiftName}</td>
                  <td className="px-4 py-2.5 tabular">
                    {timeMx(r.confirmedAt)}
                    {r.late && <div className="text-xs font-semibold text-orange-700">llegó tarde</div>}
                  </td>
                  <td className="px-4 py-2.5">
                    <StatusBadge status={r.status} automatic={r.automatic} />
                    {r.incidentReason && <div className="mt-1 max-w-xs text-xs text-slate-500">{r.incidentReason}{r.incidentBy ? ` · ${r.incidentBy}` : ""}</div>}
                    {r.lateEta && <div className="mt-1 max-w-xs text-xs text-orange-800">Avisó retardo: llega ~{r.lateEta.slice(0, 5)} · {r.lateReason}</div>}
                    {r.extensionUntil && <div className="mt-1 max-w-xs text-xs text-sky-800">Extensión hasta {r.extensionUntil.slice(0, 5)} · {r.extensionBy}</div>}
                  </td>
                  <td className="px-4 py-2.5 text-right">
                    {r.status !== "CONFIRMADO" && (
                      <div className="flex flex-wrap justify-end gap-1">
                        {r.canExtend && (
                          <Button variant="secondary" className="px-2.5 py-1 text-xs" disabled={extBusy} onClick={() => extend([r.employeeId])}>
                            Abrir hasta 7:30
                          </Button>
                        )}
                        <Button variant="secondary" className="px-2.5 py-1 text-xs"
                          onClick={() => setIncidentTarget({ employeeId: r.employeeId, fullName: r.fullName, date: r.date, shiftId: r.shiftId, shiftName: r.shiftName, currentStatus: r.status })}>
                          Cambiar estado
                        </Button>
                        {r.incidentId && (
                          <Button variant="ghost" className="px-2.5 py-1 text-xs"
                            onClick={() => setRevoke({ id: r.incidentId!, label: `${r.fullName}: retirar ${STATUS_LABELS[r.status]}` })}>
                            Retirar
                          </Button>
                        )}
                      </div>
                    )}
                  </td>
                </tr>
              ))}
              {rows.length === 0 && (
                <tr><td colSpan={6} className="px-4 py-10 text-center text-slate-500">Sin registros con estos filtros.</td></tr>
              )}
            </tbody>
          </table>
        </div>
      </Card>

      <IncidentModal target={incidentTarget} onClose={() => setIncidentTarget(null)} onSaved={load} />
      <RevokeModal incidentId={revoke?.id ?? null} label={revoke?.label ?? ""} onClose={() => setRevoke(null)} onSaved={load} />
    </div>
  );
}

function Distribution({ title, groups }: { title: string; groups: Group[] }) {
  return (
    <Card>
      <CardHeader title={title} subtitle="Confirmados / plantilla" />
      <ul className="space-y-3 px-4 py-3">
        {groups.map((g) => {
          const pct = g.total ? Math.round((g.confirmed / g.total) * 100) : 0;
          return (
            <li key={g.key}>
              <div className="mb-1 flex justify-between text-sm">
                <span className="font-medium text-slate-700">{g.label}</span>
                <span className="tabular text-slate-600">{g.confirmed} / {g.total} · {pct}%</span>
              </div>
              <div className="h-2 rounded-full bg-slate-100">
                <div className="h-2 rounded-full bg-slate-700" style={{ width: `${pct}%` }} />
              </div>
            </li>
          );
        })}
        {groups.length === 0 && <li className="text-sm text-slate-500">Sin datos.</li>}
      </ul>
    </Card>
  );
}
