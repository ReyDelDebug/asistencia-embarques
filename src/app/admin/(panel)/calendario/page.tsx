"use client";

import { useCallback, useEffect, useState } from "react";
import { Alert, api, Button, Card, cx, dateLong, Field, inputClass, Modal } from "@/components/ui";

interface Day {
  date: string; type: string; label: string; works: boolean; overtime: boolean; custom: boolean;
  hours: Record<string, string> | null;
}

const MONTHS = ["Enero", "Febrero", "Marzo", "Abril", "Mayo", "Junio", "Julio", "Agosto", "Septiembre", "Octubre", "Noviembre", "Diciembre"];
const TYPE_LABEL: Record<string, string> = {
  LABORAL: "Laborable", VIERNES: "Viernes · tiempo extra", VIERNES_LARGO: "Viernes · jornada larga",
  NO_LABORAL: "No laborable", FERIADO: "Feriado",
};
const TYPE_STYLE: Record<string, string> = {
  LABORAL: "bg-white",
  VIERNES: "bg-amber-50",
  VIERNES_LARGO: "bg-orange-100",
  NO_LABORAL: "bg-slate-100 text-slate-400",
  FERIADO: "bg-rose-50",
};
const DOT: Record<string, string> = {
  LABORAL: "bg-emerald-500", VIERNES: "bg-amber-500", VIERNES_LARGO: "bg-orange-600", NO_LABORAL: "bg-slate-400", FERIADO: "bg-rose-500",
};

function todayMx() {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "America/Mexico_City" }).format(new Date());
}

export default function CalendarPage() {
  const today = todayMx();
  const [ym, setYm] = useState({ y: Number(today.slice(0, 4)), m: Number(today.slice(5, 7)) });
  const [days, setDays] = useState<Day[]>([]);
  const [sel, setSel] = useState<Day | null>(null);
  const [type, setType] = useState("LABORAL");
  const [label, setLabel] = useState("");
  const [msg, setMsg] = useState<{ kind: "success" | "error"; text: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const month = `${ym.y}-${String(ym.m).padStart(2, "0")}`;

  const load = useCallback(async () => {
    try { setDays((await api<{ days: Day[] }>(`/api/admin/calendar?month=${month}`)).days); }
    catch (e) { setMsg({ kind: "error", text: (e as Error).message }); }
  }, [month]);
  useEffect(() => { load(); }, [load]);

  function open(d: Day) {
    setSel(d);
    setType(d.type);
    setLabel(d.custom ? d.label : "");
  }

  async function save() {
    if (!sel) return;
    setBusy(true);
    try {
      await api("/api/admin/calendar", { method: "PUT", json: { date: sel.date, type, label } });
      setSel(null);
      setMsg({ kind: "success", text: `Se guardó el ${dateLong(sel.date)} como ${TYPE_LABEL[type].toLowerCase()}.` });
      load();
    } catch (e) {
      setMsg({ kind: "error", text: (e as Error).message });
    } finally {
      setBusy(false);
    }
  }

  async function reset() {
    if (!sel) return;
    setBusy(true);
    try {
      await api("/api/admin/calendar", { method: "DELETE", json: { date: sel.date } });
      setSel(null);
      load();
    } finally {
      setBusy(false);
    }
  }

  const firstDow = (new Date(Date.UTC(ym.y, ym.m - 1, 1)).getUTCDay() + 6) % 7;
  const cells: (Day | null)[] = [...Array(firstDow).fill(null), ...days];
  while (cells.length % 7) cells.push(null);
  const move = (delta: number) => setYm(({ y, m }) => {
    const nm = m + delta;
    return nm < 1 ? { y: y - 1, m: 12 } : nm > 12 ? { y: y + 1, m: 1 } : { y, m: nm };
  });
  const isFriday = sel ? new Date(`${sel.date}T12:00:00Z`).getUTCDay() === 5 : false;

  return (
    <div className="space-y-5">
      <div>
        <p className="text-xs font-semibold uppercase tracking-wider text-emerald-700">Jornada</p>
        <h1 className="text-2xl font-bold tracking-tight text-slate-900">Calendario laboral</h1>
        <p className="text-sm text-slate-500">
          Lunes a jueves laborable (día 7:30–7:30 p. m., noche 7:30 p. m.–7:30). Viernes tiempo extra (7:30–5:30): trabajan todos y quien no llega queda en descanso.
          Sábado, domingo y feriados de ley no se trabaja. Toca un día para cambiarlo.
        </p>
      </div>
      {msg && <Alert kind={msg.kind}>{msg.text}</Alert>}

      <Card>
        <div className="flex items-center justify-between border-b border-slate-200 px-4 py-3">
          <h2 className="text-base font-semibold text-slate-900">{MONTHS[ym.m - 1]} {ym.y}</h2>
          <div className="flex gap-1">
            <Button variant="secondary" className="px-2.5 py-1 text-xs" onClick={() => move(-1)}>‹ Anterior</Button>
            <Button variant="secondary" className="px-2.5 py-1 text-xs" onClick={() => setYm({ y: Number(today.slice(0, 4)), m: Number(today.slice(5, 7)) })}>Hoy</Button>
            <Button variant="secondary" className="px-2.5 py-1 text-xs" onClick={() => move(1)}>Siguiente ›</Button>
          </div>
        </div>
        <div className="grid grid-cols-7 border-b border-slate-200 bg-slate-50 text-center text-xs font-semibold uppercase text-slate-500">
          {["Lun", "Mar", "Mié", "Jue", "Vie", "Sáb", "Dom"].map((d) => <div key={d} className="py-2">{d}</div>)}
        </div>
        <div className="grid grid-cols-7">
          {cells.map((d, i) => (
            <button key={i} disabled={!d} onClick={() => d && open(d)}
              className={cx("flex min-h-20 flex-col items-stretch justify-start border-b border-r border-slate-100 p-1.5 text-left sm:min-h-24",
                d ? TYPE_STYLE[d.type] : "bg-slate-50", d && "hover:ring-2 hover:ring-inset hover:ring-emerald-400", d?.date === today && "ring-2 ring-inset ring-emerald-600")}>
              {d && (
                <>
                  <span className="flex items-center justify-between">
                    <span className="text-xs font-semibold text-slate-700">{Number(d.date.slice(8))}</span>
                    <span className={cx("h-2 w-2 rounded-full", DOT[d.type])} />
                  </span>
                  <span className="mt-1 text-[10px] font-medium leading-tight text-slate-600 sm:text-[11px]">
                    {d.type === "LABORAL" ? (d.custom ? d.label : "") : d.label || TYPE_LABEL[d.type]}
                  </span>
                  {d.custom && <span className="mt-auto text-[10px] font-semibold text-emerald-700">● cambiado</span>}
                </>
              )}
            </button>
          ))}
        </div>
        <div className="flex flex-wrap gap-3 px-4 py-2 text-xs text-slate-600">
          {Object.entries(TYPE_LABEL).map(([k, v]) => (
            <span key={k} className="flex items-center gap-1"><span className={cx("h-2 w-2 rounded-full", DOT[k])} />{v}</span>
          ))}
        </div>
      </Card>

      <Modal open={!!sel} title={sel ? dateLong(sel.date) : ""} onClose={() => setSel(null)}
        footer={<>
          {sel?.custom && <Button variant="ghost" onClick={reset} loading={busy}>Restablecer</Button>}
          <Button variant="secondary" onClick={() => setSel(null)}>Cancelar</Button>
          <Button onClick={save} loading={busy}>Guardar</Button>
        </>}>
        {sel && (
          <div className="space-y-3">
            <p className="text-sm text-slate-600">Actualmente: <b>{TYPE_LABEL[sel.type]}</b>{sel.label ? ` (${sel.label})` : ""}</p>
            <Field label="Tipo de día">
              <select className={inputClass} value={type} onChange={(e) => setType(e.target.value)}>
                <option value="LABORAL">Laborable (7:30 a 7:30)</option>
                {isFriday && <option value="VIERNES">Viernes · tiempo extra (7:30 a 5:30)</option>}
                {isFriday && <option value="VIERNES_LARGO">Viernes · jornada larga (7:30 a 7:30)</option>}
                <option value="NO_LABORAL">No se trabaja</option>
                <option value="FERIADO">Feriado</option>
              </select>
            </Field>
            <Field label="Nota (opcional)" hint="Ej. Inventario, Paro técnico, Día de la empresa">
              <input className={inputClass} maxLength={60} value={label} onChange={(e) => setLabel(e.target.value)} />
            </Field>
            <p className="text-xs text-slate-500">En días que no se trabajan nadie tiene que registrar y no se marcan faltas. En viernes, quien no llega queda en descanso.</p>
          </div>
        )}
      </Modal>
    </div>
  );
}
