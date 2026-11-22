"use client";

import { useCallback, useEffect, useState } from "react";
import {
  Alert, api, Badge, Button, Card, CardHeader, dateShort, dateTimeMx, Field, inputClass, Modal, ROLE_LABELS, STATUS_LABELS, timeMx,
} from "@/components/ui";

interface Emp {
  id: number; employee_number: string; full_name: string; role: string; department_id: number | null;
  department_name: string | null; subarea_id: number | null; subarea_name: string | null; shift_id: number; shift_code: string;
  shift_name: string; current_shift_code: string; current_shift_name: string; active: boolean;
  terminated_at: string | null; has_pin: boolean; locked_until: string | null; panel_username: string | null;
}
interface Catalog {
  shifts: { id: number; code: string; name: string }[];
  departments: { id: number; name: string }[];
  subareas: { id: number; departmentId: number; name: string }[];
}
interface FormState { id?: number; employeeNumber: string; fullName: string; role: string; departmentId: string; subareaId: string; shiftId: string }

export default function EmployeesPage() {
  const [list, setList] = useState<Emp[]>([]);
  const [catalog, setCatalog] = useState<Catalog>({ shifts: [], departments: [], subareas: [] });
  const [q, setQ] = useState("");
  const [shiftF, setShiftF] = useState("");
  const [showInactive, setShowInactive] = useState(false);
  const [form, setForm] = useState<FormState | null>(null);
  const [formError, setFormError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [secret, setSecret] = useState<{ title: string; note: string; lines: [string, string][] } | null>(null);
  const [confirmReset, setConfirmReset] = useState<Emp | null>(null);
  const [terminate, setTerminate] = useState<{ emp: Emp; reactivate: boolean } | null>(null);
  const [reason, setReason] = useState("");
  const [history, setHistory] = useState<{ emp: Emp; data: History | null } | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const [e, d] = await Promise.all([
        api<{ employees: Emp[] }>("/api/admin/employees"),
        api<Catalog>("/api/admin/dashboard?shift="),
      ]);
      setList(e.employees);
      setCatalog({ shifts: d.shifts, departments: d.departments, subareas: d.subareas });
    } catch (err) {
      setError((err as Error).message);
    }
  }, []);
  useEffect(() => { load(); }, [load]);

  const rows = list.filter((e) =>
    (showInactive || e.active) &&
    (!shiftF || e.current_shift_code === shiftF) &&
    (!q || `${e.full_name} ${e.employee_number}`.toLowerCase().includes(q.toLowerCase())));

  async function suggestNumber(f: FormState) {
    const shift = catalog.shifts.find((s) => String(s.id) === f.shiftId)?.code ?? "DIA";
    const r = await api<{ employeeNumber: string }>(`/api/admin/employees/next-number?shift=${shift}&role=${f.role}`);
    setForm({ ...f, employeeNumber: r.employeeNumber });
  }

  async function saveForm() {
    if (!form) return;
    setBusy(true);
    setFormError(null);
    const payload = {
      employeeNumber: form.employeeNumber || undefined,
      fullName: form.fullName,
      role: form.role,
      departmentId: form.role === "SUPERVISOR" ? null : Number(form.departmentId) || null,
      subareaId: form.role === "SUPERVISOR" ? null : Number(form.subareaId) || null,
      shiftId: Number(form.shiftId),
    };
    try {
      if (form.id) {
        await api(`/api/admin/employees/${form.id}`, { method: "PATCH", json: payload });
        setForm(null);
      } else {
        const r = await api<{ employeeNumber: string }>("/api/admin/employees", { method: "POST", json: payload });
        setForm(null);
        setSecret({ title: "Trabajador registrado", note: "Dile que entre al enlace con este número de empleado: la primera vez creará su propio PIN.", lines: [["Nombre", payload.fullName], ["Número de empleado", r.employeeNumber]] });
      }
      load();
    } catch (e) {
      setFormError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  async function doReset(emp: Emp) {
    setBusy(true);
    try {
      const r = await api<{ employeeNumber: string; fullName: string }>(`/api/admin/employees/${emp.id}/reset-pin`, { method: "POST", json: {} });
      setConfirmReset(null);
      setSecret({ title: "PIN restablecido", note: "El PIN anterior ya no funciona. Al entrar con su número de empleado, el trabajador creará uno nuevo.", lines: [["Nombre", r.fullName], ["Número de empleado", r.employeeNumber]] });
      load();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  async function doTerminate() {
    if (!terminate) return;
    setBusy(true);
    try {
      const action = terminate.reactivate ? "reactivate" : "terminate";
      await api(`/api/admin/employees/${terminate.emp.id}/${action}`, { method: "POST", json: { reason } });
      setTerminate(null);
      setReason("");
      load();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  async function openHistory(emp: Emp) {
    setHistory({ emp, data: null });
    const data = await api<History>(`/api/admin/employees/${emp.id}/history`);
    setHistory({ emp, data });
  }

  const newForm = (): FormState => ({ employeeNumber: "", fullName: "", role: "EMPLOYEE", departmentId: String(catalog.departments[0]?.id ?? ""), subareaId: "", shiftId: String(catalog.shifts[0]?.id ?? "") });

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-xl font-bold text-slate-900">Empleados</h1>
          <p className="text-sm text-slate-500">{list.filter((e) => e.active).length} activos · {list.filter((e) => !e.active).length} dados de baja</p>
        </div>
        <Button onClick={() => { setFormError(null); setForm(newForm()); }}>+ Registrar trabajador</Button>
      </div>

      {error && <Alert>{error}</Alert>}

      <Card className="p-4">
        <div className="grid gap-3 sm:grid-cols-3">
          <input className={inputClass} placeholder="Buscar por nombre o número" value={q} onChange={(e) => setQ(e.target.value)} />
          <select className={inputClass} value={shiftF} onChange={(e) => setShiftF(e.target.value)}>
            <option value="">Ambos turnos</option>
            {catalog.shifts.map((s) => <option key={s.code} value={s.code}>{s.name}</option>)}
          </select>
          <label className="flex items-center gap-2 text-sm text-slate-700">
            <input type="checkbox" checked={showInactive} onChange={(e) => setShowInactive(e.target.checked)} /> Mostrar bajas
          </label>
        </div>
      </Card>

      <Card>
        <CardHeader title="Plantilla" subtitle={`${rows.length} empleado(s)`} />
        <div className="overflow-x-auto">
          <table className="min-w-full divide-y divide-slate-200 text-sm">
            <thead className="bg-slate-50 text-left text-xs font-semibold uppercase tracking-wide text-slate-600">
              <tr>
                <th className="px-4 py-2.5">Número</th><th className="px-4 py-2.5">Nombre</th><th className="px-4 py-2.5">Puesto</th>
                <th className="px-4 py-2.5">Área</th><th className="px-4 py-2.5">Turno actual</th><th className="px-4 py-2.5">PIN</th><th className="px-4 py-2.5">Estado</th>
                <th className="px-4 py-2.5 text-right">Acciones</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {rows.map((e) => (
                <tr key={e.id} className={e.active ? "" : "bg-slate-50 text-slate-500"}>
                  <td className="px-4 py-2.5 font-mono">{e.employee_number}</td>
                  <td className="px-4 py-2.5 font-semibold">{e.full_name}{e.panel_username && <span className="ml-2 text-xs font-normal text-slate-500">(panel: {e.panel_username})</span>}</td>
                  <td className="px-4 py-2.5">{ROLE_LABELS[e.role]}</td>
                  <td className="px-4 py-2.5">{e.department_name ? `${e.department_name}${e.subarea_name ? ` · ${e.subarea_name}` : ""}` : "Supervisión"}</td>
                  <td className="px-4 py-2.5">{e.current_shift_name}</td>
                  <td className="px-4 py-2.5">{e.has_pin ? <span className="text-emerald-700">Creado</span> : <span className="text-amber-700">Pendiente</span>}</td>
                  <td className="px-4 py-2.5">
                    {e.active
                      ? e.locked_until ? <Badge className="bg-red-50 text-red-800 ring-red-600/20">Bloqueado</Badge> : <Badge className="bg-emerald-50 text-emerald-800 ring-emerald-600/20">Activo</Badge>
                      : <Badge className="bg-slate-100 text-slate-700 ring-slate-500/20">Baja {e.terminated_at ? dateShort(e.terminated_at) : ""}</Badge>}
                  </td>
                  <td className="px-4 py-2.5">
                    <div className="flex flex-wrap justify-end gap-1">
                      {e.active && <Button variant="secondary" className="px-2 py-1 text-xs"
                        onClick={() => { setFormError(null); setForm({ id: e.id, employeeNumber: e.employee_number, fullName: e.full_name, role: e.role, departmentId: String(e.department_id ?? ""), subareaId: String(e.subarea_id ?? ""), shiftId: String(e.shift_id) }); }}>Editar</Button>}
                      {e.active && <Button variant="secondary" className="px-2 py-1 text-xs" onClick={() => setConfirmReset(e)}>Restablecer PIN</Button>}
                      <Button variant="ghost" className="px-2 py-1 text-xs" onClick={() => openHistory(e)}>Historial</Button>
                      {e.active
                        ? <Button variant="ghost" className="px-2 py-1 text-xs text-red-700" onClick={() => { setReason(""); setTerminate({ emp: e, reactivate: false }); }}>Dar de baja</Button>
                        : <Button variant="ghost" className="px-2 py-1 text-xs" onClick={() => { setReason(""); setTerminate({ emp: e, reactivate: true }); }}>Reactivar</Button>}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>

      <Modal open={!!form} title={form?.id ? "Editar empleado" : "Agregar empleado"} onClose={() => setForm(null)}
        footer={<><Button variant="secondary" onClick={() => setForm(null)}>Cancelar</Button><Button onClick={saveForm} loading={busy}>Guardar</Button></>}>
        {form && (
          <div className="space-y-3">
            <Field label="Nombre completo">
              <input className={inputClass} value={form.fullName} onChange={(e) => setForm({ ...form, fullName: e.target.value })} />
            </Field>
            <div className="grid grid-cols-2 gap-3">
              <Field label="Puesto">
                <select className={inputClass} value={form.role} onChange={(e) => setForm({ ...form, role: e.target.value })}>
                  <option value="EMPLOYEE">Empleado</option><option value="LEADER">Líder</option><option value="SUPERVISOR">Supervisor</option>
                </select>
              </Field>
              <Field label={form.id ? "Turno base" : "Turno inicial"}>
                <select className={inputClass} value={form.shiftId} onChange={(e) => setForm({ ...form, shiftId: e.target.value })}>
                  {catalog.shifts.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
                </select>
              </Field>
            </div>
            {form.role !== "SUPERVISOR" && (
              <Field label="Área">
                <select className={inputClass} value={form.departmentId} onChange={(e) => setForm({ ...form, departmentId: e.target.value, subareaId: "" })}>
                  {catalog.departments.map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}
                </select>
              </Field>
            )}
            {form.role !== "SUPERVISOR" && catalog.subareas.some((x) => String(x.departmentId) === form.departmentId) && (
              <Field label="Subárea" hint="Ej. PT dentro de Central. El líder de PT se marca con puesto Líder y subárea PT.">
                <select className={inputClass} value={form.subareaId} onChange={(e) => setForm({ ...form, subareaId: e.target.value })}>
                  <option value="">— {catalog.departments.find((d) => String(d.id) === form.departmentId)?.name} (general) —</option>
                  {catalog.subareas.filter((x) => String(x.departmentId) === form.departmentId).map((x) => <option key={x.id} value={x.id}>{x.name}</option>)}
                </select>
              </Field>
            )}
            {form.id && <p className="text-xs text-slate-500">Para rotar día/noche usa la sección <b>Rol de turno</b>; el turno base solo aplica si nunca se le ha asignado un rol.</p>}
            <Field label="Número de empleado" hint="Captura el número real de empleado del trabajador. Si lo dejas vacío se asigna uno provisional.">
              <div className="flex gap-2">
                <input className={inputClass} inputMode="numeric" value={form.employeeNumber}
                  onChange={(e) => setForm({ ...form, employeeNumber: e.target.value.replace(/\D/g, "") })} />
                <Button variant="secondary" type="button" onClick={() => suggestNumber(form)}>Generar</Button>
              </div>
            </Field>
            {!form.id && <p className="text-xs text-slate-500">El trabajador creará su propio PIN la primera vez que entre con su número.</p>}
            {formError && <Alert>{formError}</Alert>}
          </div>
        )}
      </Modal>

      <Modal open={!!confirmReset} title="Restablecer PIN" onClose={() => setConfirmReset(null)}
        footer={<><Button variant="secondary" onClick={() => setConfirmReset(null)}>Cancelar</Button><Button onClick={() => doReset(confirmReset!)} loading={busy}>Restablecer PIN</Button></>}>
        <p className="text-sm text-slate-700">Se borrará el PIN de <b>{confirmReset?.full_name}</b>, se desbloqueará su cuenta y se cerrarán sus sesiones. La próxima vez que entre con su número de empleado creará un PIN nuevo.</p>
      </Modal>

      <Modal open={!!secret} title={secret?.title ?? ""} onClose={() => setSecret(null)} footer={<Button onClick={() => setSecret(null)}>Listo</Button>}>
        {secret && (
          <div className="space-y-3">
            <Alert kind="info">{secret.note}</Alert>
            <dl className="divide-y divide-slate-100 rounded-md border border-slate-200">
              {secret.lines.map(([k, v]) => (
                <div key={k} className="flex justify-between px-3 py-2 text-sm"><dt className="text-slate-500">{k}</dt><dd className="font-mono text-base font-bold">{v}</dd></div>
              ))}
            </dl>
          </div>
        )}
      </Modal>

      <Modal open={!!terminate} title={terminate?.reactivate ? "Reactivar empleado" : "Dar de baja"} onClose={() => setTerminate(null)}
        footer={<><Button variant="secondary" onClick={() => setTerminate(null)}>Cancelar</Button>
          <Button variant={terminate?.reactivate ? "primary" : "danger"} onClick={doTerminate} loading={busy} disabled={reason.trim().length < 3}>Confirmar</Button></>}>
        <div className="space-y-3">
          <p className="text-sm">{terminate?.emp.full_name}</p>
          <Field label="Motivo (obligatorio)"><textarea className={inputClass} rows={3} value={reason} onChange={(e) => setReason(e.target.value)} /></Field>
        </div>
      </Modal>

      <Modal wide open={!!history} title={`Historial · ${history?.emp.full_name ?? ""}`} onClose={() => setHistory(null)}>
        {!history?.data ? <p className="text-sm text-slate-500">Cargando…</p> : <HistoryView data={history.data} />}
      </Modal>
    </div>
  );
}

interface History {
  attendance: { id: number; operational_date: string; confirmed_at: string; shift_name: string; department_name: string | null }[];
  incidents: { id: number; operational_date: string; shift_name: string; type: string; reason: string; created_at: string; created_by_name: string; revoked_at: string | null; revoked_by_name: string | null; revoke_reason: string | null }[];
  audit: { id: number; action: string; actor_label: string | null; created_at: string; details: unknown }[];
}

function HistoryView({ data }: { data: History }) {
  return (
    <div className="space-y-5 text-sm">
      <section>
        <h4 className="mb-2 font-semibold">Asistencias confirmadas ({data.attendance.length})</h4>
        <div className="max-h-56 overflow-y-auto rounded border border-slate-200">
          <table className="w-full"><tbody className="divide-y divide-slate-100">
            {data.attendance.map((a) => (
              <tr key={a.id}><td className="px-3 py-1.5">{dateShort(a.operational_date)}</td><td className="px-3 py-1.5">{a.shift_name}</td><td className="px-3 py-1.5 tabular">{timeMx(a.confirmed_at)}</td></tr>
            ))}
            {data.attendance.length === 0 && <tr><td className="px-3 py-2 text-slate-500">Sin registros.</td></tr>}
          </tbody></table>
        </div>
      </section>
      <section>
        <h4 className="mb-2 font-semibold">Incidencias ({data.incidents.length})</h4>
        <ul className="space-y-2">
          {data.incidents.map((i) => (
            <li key={i.id} className="rounded border border-slate-200 px-3 py-2">
              <div className="flex justify-between"><b>{STATUS_LABELS[i.type]} · {dateShort(i.operational_date)} ({i.shift_name})</b>{i.revoked_at && <Badge className="bg-slate-100 ring-slate-400/20">Retirada</Badge>}</div>
              <p className="text-slate-600">{i.reason}</p>
              <p className="text-xs text-slate-500">Registró {i.created_by_name} · {dateTimeMx(i.created_at)}</p>
              {i.revoked_at && <p className="text-xs text-slate-500">Retiró {i.revoked_by_name} · {dateTimeMx(i.revoked_at)} · {i.revoke_reason}</p>}
            </li>
          ))}
          {data.incidents.length === 0 && <li className="text-slate-500">Sin incidencias.</li>}
        </ul>
      </section>
      <section>
        <h4 className="mb-2 font-semibold">Movimientos administrativos</h4>
        <ul className="max-h-56 space-y-1 overflow-y-auto text-xs">
          {data.audit.map((a) => (
            <li key={a.id} className="rounded bg-slate-50 px-2 py-1"><b>{a.action}</b> · {a.actor_label ?? "—"} · {dateTimeMx(a.created_at)}</li>
          ))}
        </ul>
      </section>
    </div>
  );
}
