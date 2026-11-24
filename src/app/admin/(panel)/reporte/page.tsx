"use client";

import { Suspense, useCallback, useEffect, useState } from "react";
import { useSearchParams } from "next/navigation";
import { Alert, api, Button, Card, CardHeader, cx, dateLong, Field, inputClass } from "@/components/ui";

interface Extra { concept: string; quantity: number; notes: string; addToTotal: boolean }
interface Report {
  date: string; shiftCode: string; shiftName: string; windowOpen: boolean; supervisors: number; total: number;
  departments: { id: number; subareaId: number | null; label: string; employees: number; leaders: number; hasLeader: boolean; plantilla: number }[];
  lists: Record<string, string[]>;
  operational: { vacantes: string; recoge: string; notes: string; extras: Extra[]; updatedAt: string | null; updatedBy: string | null };
  text: string;
}

function todayMx() {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "America/Mexico_City" }).format(new Date());
}

function ReportInner() {
  const sp = useSearchParams();
  const [date, setDate] = useState(sp.get("date") || todayMx());
  const [shift, setShift] = useState(sp.get("shift") || "DIA");
  const [report, setReport] = useState<Report | null>(null);
  const [form, setForm] = useState<{ vacantes: string; recoge: string; notes: string; extras: Extra[] }>({ vacantes: "", recoge: "", notes: "", extras: [] });
  const [dirty, setDirty] = useState(false);
  const [msg, setMsg] = useState<{ kind: "success" | "error"; text: string } | null>(null);
  const [saving, setSaving] = useState(false);

  const load = useCallback(async () => {
    try {
      const r = await api<Report>(`/api/admin/report?date=${date}&shift=${shift}`);
      setReport(r);
      setForm({ vacantes: r.operational.vacantes, recoge: r.operational.recoge, notes: r.operational.notes, extras: r.operational.extras });
      setDirty(false);
    } catch (e) {
      setMsg({ kind: "error", text: (e as Error).message });
    }
  }, [date, shift]);

  useEffect(() => { load(); }, [load]);

  async function save() {
    setSaving(true);
    setMsg(null);
    try {
      const r = await api<Report>("/api/admin/report", { method: "PUT", json: { date, shift, ...form } });
      setReport(r);
      setDirty(false);
      setMsg({ kind: "success", text: "Datos del reporte guardados." });
    } catch (e) {
      setMsg({ kind: "error", text: (e as Error).message });
    } finally {
      setSaving(false);
    }
  }

  async function logAction(action: "COPY" | "SHARE") {
    await api("/api/admin/report/action", { method: "POST", json: { date, shift, action } }).catch(() => undefined);
  }

  async function copy() {
    if (!report) return;
    try {
      await navigator.clipboard.writeText(report.text);
    } catch {
      const ta = document.createElement("textarea");
      ta.value = report.text;
      document.body.appendChild(ta);
      ta.select();
      document.execCommand("copy");
      ta.remove();
    }
    setMsg({ kind: "success", text: "Mensaje copiado. Pégalo en el grupo de WhatsApp." });
    logAction("COPY");
  }

  function share() {
    if (!report) return;
    logAction("SHARE");
    window.open(`https://wa.me/?text=${encodeURIComponent(report.text)}`, "_blank", "noopener");
  }

  const setExtra = (i: number, patch: Partial<Extra>) => {
    setForm((f) => ({ ...f, extras: f.extras.map((e, j) => (j === i ? { ...e, ...patch } : e)) }));
    setDirty(true);
  };

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-slate-900">Reporte para WhatsApp</h1>
          <p className="text-sm text-slate-500">{dateLong(date)}</p>
        </div>
        <div className="flex flex-wrap items-end gap-2">
          <Field label="Fecha">
            <input type="date" className={inputClass} value={date} onChange={(e) => setDate(e.target.value)} />
          </Field>
          <div className="inline-flex overflow-hidden rounded-md border border-slate-300">
            {[["DIA", "Reporte de día"], ["NOCHE", "Reporte de noche"]].map(([code, label]) => (
              <button key={code} onClick={() => setShift(code)}
                className={cx("px-3 py-2 text-sm font-semibold", shift === code ? "bg-slate-900 text-white" : "bg-white text-slate-700 hover:bg-slate-50")}>
                {label}
              </button>
            ))}
          </div>
        </div>
      </div>

      {msg && <Alert kind={msg.kind}>{msg.text}</Alert>}
      {report?.windowOpen && (
        <Alert kind="warning">El registro de este turno sigue abierto. El reporte incluye a los pendientes por confirmar y se actualiza al recargar.</Alert>
      )}

      <div className="grid gap-5 lg:grid-cols-5">
        <Card className="lg:col-span-3">
          <CardHeader
            title="Mensaje generado"
            subtitle="Calculado con los registros reales y la plantilla"
            actions={<Button variant="ghost" className="text-xs" onClick={load}>Actualizar</Button>}
          />
          <div className="p-4">
            <pre className="max-h-[60vh] overflow-auto whitespace-pre-wrap rounded-md border border-slate-200 bg-slate-50 p-4 font-mono text-sm leading-relaxed text-slate-800">
              {report?.text ?? "Generando…"}
            </pre>
            <div className="mt-4 grid grid-cols-2 gap-2 sm:grid-cols-4">
              <Button onClick={copy} disabled={!report || dirty}>Copiar mensaje</Button>
              <Button variant="success" onClick={share} disabled={!report || dirty}>Compartir por WhatsApp</Button>
              <a href={`/api/admin/report/download?date=${date}&shift=${shift}`} className={cx(dirty && "pointer-events-none opacity-50")}>
                <Button variant="secondary" className="w-full">Exportar (.txt)</Button>
              </a>
              <a href={`/api/admin/export?from=${date}&to=${date}&shift=${shift}`}>
                <Button variant="secondary" className="w-full">DESCARGAR EXCEL</Button>
              </a>
            </div>
            {dirty && <p className="mt-2 text-xs text-amber-700">Guarda los datos operativos para actualizar el mensaje.</p>}
          </div>
        </Card>

        <div className="space-y-5 lg:col-span-2">
          {report && (
            <Card>
              <CardHeader title="Conteo" subtitle="Confirmados por área" />
              <table className="w-full text-sm">
                <tbody className="divide-y divide-slate-100">
                  <tr><td className="px-4 py-2">Supervisor</td><td className="px-4 py-2 text-right font-semibold tabular">{report.supervisors}</td></tr>
                  {report.departments.map((d) => (
                    <tr key={`${d.id}-${d.subareaId}`}>
                      <td className="px-4 py-2">{d.label}<span className="ml-1 text-xs text-slate-500">(plantilla {d.plantilla})</span></td>
                      <td className="px-4 py-2 text-right font-semibold tabular">{d.hasLeader ? `${d.employees}+${d.leaders}` : d.employees + d.leaders}</td>
                    </tr>
                  ))}
                  <tr className="bg-slate-50"><td className="px-4 py-2 font-bold">TOTAL</td><td className="px-4 py-2 text-right font-bold tabular">{report.total}</td></tr>
                </tbody>
              </table>
            </Card>
          )}

          <Card>
            <CardHeader title="Datos operativos" subtitle={report?.operational.updatedBy ? `Última edición: ${report.operational.updatedBy}` : "Faltas, PSG, vacaciones, incapacidades y bajas se toman del panel"} />
            <div className="space-y-3 p-4">
              <Field label="Vacantes">
                <input className={inputClass} value={form.vacantes} maxLength={500}
                  onChange={(e) => { setForm({ ...form, vacantes: e.target.value }); setDirty(true); }} placeholder="Ej. 2 (Central)" />
              </Field>
              <Field label="Recoge">
                <input className={inputClass} value={form.recoge} maxLength={500}
                  onChange={(e) => { setForm({ ...form, recoge: e.target.value }); setDirty(true); }} />
              </Field>
              <Field label="Observaciones (opcional)">
                <textarea className={inputClass} rows={2} value={form.notes} maxLength={1000}
                  onChange={(e) => { setForm({ ...form, notes: e.target.value }); setDirty(true); }} />
              </Field>

              <div>
                <p className="mb-1 text-xs font-semibold uppercase tracking-wide text-slate-600">Personal adicional por concepto</p>
                <p className="mb-2 text-xs text-slate-500">Descarga, banda, elevador, etc. Solo cantidades; no se crean empleados.</p>
                <div className="space-y-2">
                  {form.extras.map((e, i) => (
                    <div key={i} className="rounded-md border border-slate-200 p-2">
                      <div className="grid grid-cols-5 gap-2">
                        <input className={`${inputClass} col-span-3`} placeholder="Concepto" value={e.concept}
                          onChange={(ev) => setExtra(i, { concept: ev.target.value })} />
                        <input className={`${inputClass} col-span-2`} type="number" min={0} max={500} inputMode="numeric" value={e.quantity}
                          onChange={(ev) => setExtra(i, { quantity: Number(ev.target.value) })} />
                      </div>
                      <input className={`${inputClass} mt-2`} placeholder="Nota (opcional)" value={e.notes}
                        onChange={(ev) => setExtra(i, { notes: ev.target.value })} />
                      <div className="mt-2 flex items-center justify-between">
                        <label className="flex items-center gap-2 text-xs text-slate-700">
                          <input type="checkbox" checked={e.addToTotal} onChange={(ev) => setExtra(i, { addToTotal: ev.target.checked })} />
                          Sumar al TOTAL
                        </label>
                        <button className="text-xs font-semibold text-red-700"
                          onClick={() => { setForm((f) => ({ ...f, extras: f.extras.filter((_, j) => j !== i) })); setDirty(true); }}>
                          Quitar
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
                <div className="mt-2 flex flex-wrap gap-2">
                  {["DESCARGA", "BANDA", "ELEVADOR", "OTRO"].map((c) => (
                    <Button key={c} variant="secondary" className="px-2.5 py-1 text-xs"
                      onClick={() => { setForm((f) => ({ ...f, extras: [...f.extras, { concept: c === "OTRO" ? "" : c, quantity: 1, notes: "", addToTotal: false }] })); setDirty(true); }}>
                      + {c === "OTRO" ? "Otro" : c}
                    </Button>
                  ))}
                </div>
              </div>
              <Button onClick={save} loading={saving} disabled={!dirty} className="w-full">Guardar datos del reporte</Button>
            </div>
          </Card>
        </div>
      </div>
    </div>
  );
}

export default function ReportPage() {
  return (
    <Suspense fallback={<div className="py-20 text-center text-slate-500">Cargando…</div>}>
      <ReportInner />
    </Suspense>
  );
}
