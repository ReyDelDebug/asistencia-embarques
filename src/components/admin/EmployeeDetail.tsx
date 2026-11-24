"use client";

import { useCallback, useEffect, useState, type FormEvent } from "react";
import { Alert, api, Avatar, Badge, Button, cx, dateShort, inputClass, Modal, ROLE_LABELS } from "../ui";

interface Detail {
  employee: {
    id: number; employeeNumber: string; fullName: string; role: string; active: boolean; area: string; shiftName: string;
    hasPin: boolean; photoVersion: string | null; phone: string | null; birthDate: string | null; bootSize: number | null;
    vestSize: string | null; vacationDays: number | null; vacationPeriodStart: string | null; profileMissing: string[];
  };
  vacations: { assigned: number | null; periodStart: string; used: number; pending: number; available: number | null };
  faltas: { week: number; month: number; weeks: { weekStart: string; faltas: number }[]; months: { month: string; faltas: number }[]; countingSince: string };
}

const MONTHS = ["Ene", "Feb", "Mar", "Abr", "May", "Jun", "Jul", "Ago", "Sep", "Oct", "Nov", "Dic"];
const VEST: Record<string, string> = { CHICO: "Chico", MEDIANO: "Mediano", GRANDE: "Grande" };
const BOOTS = Array.from({ length: 29 }, (_, i) => 22 + i * 0.5);

function age(birth: string | null) {
  if (!birth) return null;
  const [y, m, d] = birth.split("-").map(Number);
  const now = new Date();
  let a = now.getFullYear() - y;
  if (now.getMonth() + 1 < m || (now.getMonth() + 1 === m && now.getDate() < d)) a--;
  return a;
}

function Bars({ items, labelOf }: { items: { key: string; value: number }[]; labelOf: (k: string) => string }) {
  const max = Math.max(1, ...items.map((i) => i.value));
  return (
    <div className="flex h-28 items-end gap-1.5">
      {[...items].reverse().map((i) => (
        <div key={i.key} className="flex flex-1 flex-col items-center gap-1">
          <span className="text-[10px] font-semibold tabular text-slate-600">{i.value}</span>
          <div className={cx("w-full rounded-t", i.value ? "bg-red-400" : "bg-slate-200")} style={{ height: `${Math.max(4, (i.value / max) * 72)}px` }} />
          <span className="text-[10px] text-slate-500">{labelOf(i.key)}</span>
        </div>
      ))}
    </div>
  );
}

export default function EmployeeDetail({ employeeId, onClose, onChanged }: { employeeId: number | null; onClose: () => void; onChanged: () => void }) {
  const [d, setD] = useState<Detail | null>(null);
  const [editing, setEditing] = useState(false);
  const [form, setForm] = useState({ phone: "", birthDate: "", bootSize: "", vestSize: "", vacationDays: "", vacationPeriodStart: "" });
  const [msg, setMsg] = useState<{ kind: "success" | "error"; text: string } | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    if (employeeId == null) return;
    const r = await api<Detail>(`/api/admin/employees/${employeeId}/detail`);
    setD(r);
    const e = r.employee;
    setForm({
      phone: e.phone ?? "", birthDate: e.birthDate ?? "", bootSize: e.bootSize != null ? String(e.bootSize) : "",
      vestSize: e.vestSize ?? "", vacationDays: e.vacationDays != null ? String(e.vacationDays) : "", vacationPeriodStart: e.vacationPeriodStart ?? "",
    });
  }, [employeeId]);

  useEffect(() => { setD(null); setEditing(false); setMsg(null); load().catch((e) => setMsg({ kind: "error", text: e.message })); }, [load]);

  async function save(ev: FormEvent) {
    ev.preventDefault();
    setBusy(true);
    setMsg(null);
    try {
      await api(`/api/admin/employees/${employeeId}/details`, { method: "PUT", json: form });
      setEditing(false);
      setMsg({ kind: "success", text: "Datos actualizados." });
      await load();
      onChanged();
    } catch (e) {
      setMsg({ kind: "error", text: (e as Error).message });
    } finally {
      setBusy(false);
    }
  }

  const e = d?.employee;
  return (
    <Modal wide open={employeeId != null} title="Ficha del empleado" onClose={onClose}>
      {!d || !e ? <p className="text-sm text-slate-500">{msg?.text ?? "Cargando…"}</p> : (
        <div className="space-y-5">
          <div className="flex flex-wrap items-center gap-4">
            <Avatar employeeId={e.id} name={e.fullName} version={e.photoVersion} size={72} />
            <div className="min-w-0 flex-1">
              <p className="text-xl font-bold text-slate-900">{e.fullName}</p>
              <p className="text-sm text-slate-600">#{e.employeeNumber} · {e.area} · Turno {e.shiftName}</p>
              <div className="mt-1 flex flex-wrap gap-1.5">
                <Badge className="bg-slate-900 text-white ring-slate-900">{ROLE_LABELS[e.role]}</Badge>
                {!e.active && <Badge className="bg-slate-100 ring-slate-400/20">Baja</Badge>}
                {!e.hasPin && <Badge className="bg-amber-50 text-amber-800 ring-amber-600/20">Sin PIN</Badge>}
                {e.profileMissing.length > 0 && <Badge className="bg-amber-50 text-amber-800 ring-amber-600/20">Perfil incompleto</Badge>}
              </div>
            </div>
          </div>

          <div className="grid gap-3 sm:grid-cols-4">
            {[
              ["Teléfono", e.phone ? <a key="p" className="font-semibold text-sky-700 underline" href={`tel:${e.phone}`}>{e.phone}</a> : "—"],
              ["Nacimiento", e.birthDate ? `${dateShort(e.birthDate)} (${age(e.birthDate)} años)` : "—"],
              ["Botas", e.bootSize ?? "—"],
              ["Chaleco", e.vestSize ? VEST[e.vestSize] : "—"],
            ].map(([k, v]) => (
              <div key={String(k)} className="rounded-xl border border-slate-200 bg-slate-50 px-3 py-2">
                <p className="text-xs text-slate-500">{k}</p>
                <p className="text-sm font-semibold text-slate-900">{v}</p>
              </div>
            ))}
          </div>

          <div className="grid gap-4 sm:grid-cols-2">
            <div className="rounded-xl border border-slate-200 p-4">
              <p className="text-sm font-semibold text-slate-900">Vacaciones</p>
              {d.vacations.assigned == null ? (
                <p className="mt-1 text-sm text-amber-700">Aún no tiene días asignados. Captúralos en “Editar datos”.</p>
              ) : (
                <div className="mt-3 grid grid-cols-3 gap-2 text-center">
                  <div className="rounded-lg bg-emerald-50 py-2"><p className="text-2xl font-bold tabular text-emerald-800">{d.vacations.available}</p><p className="text-xs text-emerald-900">Disponibles</p></div>
                  <div className="rounded-lg bg-slate-50 py-2"><p className="text-2xl font-bold tabular">{d.vacations.used}</p><p className="text-xs text-slate-600">Tomados</p></div>
                  <div className="rounded-lg bg-slate-50 py-2"><p className="text-2xl font-bold tabular">{d.vacations.assigned}</p><p className="text-xs text-slate-600">Asignados</p></div>
                </div>
              )}
              <p className="mt-2 text-xs text-slate-500">Periodo desde {dateShort(d.vacations.periodStart)}{d.vacations.pending ? ` · ${d.vacations.pending} día(s) pendientes de aprobar` : ""}</p>
            </div>
            <div className="rounded-xl border border-slate-200 p-4">
              <p className="text-sm font-semibold text-slate-900">Faltas</p>
              <div className="mt-3 grid grid-cols-2 gap-2 text-center">
                <div className="rounded-lg bg-red-50 py-2"><p className="text-2xl font-bold tabular text-red-700">{d.faltas.week}</p><p className="text-xs text-red-900">Esta semana</p></div>
                <div className="rounded-lg bg-red-50 py-2"><p className="text-2xl font-bold tabular text-red-700">{d.faltas.month}</p><p className="text-xs text-red-900">Este mes</p></div>
              </div>
              <p className="mt-2 text-xs text-slate-500">Se cuentan desde el {dateShort(d.faltas.countingSince)} (alta en el sistema).</p>
            </div>
          </div>

          <div className="grid gap-4 sm:grid-cols-2">
            <div className="rounded-xl border border-slate-200 p-4">
              <p className="mb-2 text-sm font-semibold text-slate-900">Faltas por semana</p>
              <Bars items={d.faltas.weeks.map((w) => ({ key: w.weekStart, value: w.faltas }))} labelOf={(k) => `${k.slice(8)}/${k.slice(5, 7)}`} />
            </div>
            <div className="rounded-xl border border-slate-200 p-4">
              <p className="mb-2 text-sm font-semibold text-slate-900">Faltas por mes</p>
              <Bars items={d.faltas.months.map((m) => ({ key: m.month, value: m.faltas }))} labelOf={(k) => MONTHS[Number(k.slice(5)) - 1]} />
            </div>
          </div>

          {msg && <Alert kind={msg.kind}>{msg.text}</Alert>}

          {!editing ? (
            <Button variant="secondary" onClick={() => setEditing(true)}>Editar datos</Button>
          ) : (
            <form onSubmit={save} className="space-y-3 rounded-xl border border-slate-200 bg-slate-50 p-4">
              <div className="grid gap-3 sm:grid-cols-2">
                <label className="text-sm"><span className="mb-1 block font-semibold">Teléfono</span>
                  <input className={inputClass} inputMode="tel" maxLength={10} value={form.phone} onChange={(ev) => setForm({ ...form, phone: ev.target.value.replace(/\D/g, "") })} /></label>
                <label className="text-sm"><span className="mb-1 block font-semibold">Fecha de nacimiento</span>
                  <input className={inputClass} type="date" value={form.birthDate} onChange={(ev) => setForm({ ...form, birthDate: ev.target.value })} /></label>
                <label className="text-sm"><span className="mb-1 block font-semibold">Número de botas</span>
                  <select className={inputClass} value={form.bootSize} onChange={(ev) => setForm({ ...form, bootSize: ev.target.value })}>
                    <option value="">—</option>{BOOTS.map((b) => <option key={b} value={b}>{b % 1 ? b.toFixed(1) : b}</option>)}
                  </select></label>
                <label className="text-sm"><span className="mb-1 block font-semibold">Talla de chaleco</span>
                  <select className={inputClass} value={form.vestSize} onChange={(ev) => setForm({ ...form, vestSize: ev.target.value })}>
                    <option value="">—</option><option value="CHICO">Chico</option><option value="MEDIANO">Mediano</option><option value="GRANDE">Grande</option>
                  </select></label>
                <label className="text-sm"><span className="mb-1 block font-semibold">Días de vacaciones asignados</span>
                  <input className={inputClass} type="number" min={0} max={90} value={form.vacationDays} onChange={(ev) => setForm({ ...form, vacationDays: ev.target.value })} /></label>
                <label className="text-sm"><span className="mb-1 block font-semibold">Inicio del periodo de vacaciones</span>
                  <input className={inputClass} type="date" value={form.vacationPeriodStart} onChange={(ev) => setForm({ ...form, vacationPeriodStart: ev.target.value })} />
                  <span className="mt-1 block text-xs text-slate-500">Vacío = desde el 1 de enero de este año.</span></label>
              </div>
              <div className="flex gap-2">
                <Button type="submit" loading={busy}>Guardar</Button>
                <Button type="button" variant="ghost" onClick={() => setEditing(false)}>Cancelar</Button>
              </div>
              <p className="text-xs text-slate-500">El nombre, número, área y puesto se cambian con el botón “Editar” de la lista.</p>
            </form>
          )}
        </div>
      )}
    </Modal>
  );
}
