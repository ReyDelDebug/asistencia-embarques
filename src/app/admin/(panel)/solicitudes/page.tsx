"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { Alert, api, Badge, Button, Card, CardHeader, cx, dateShort, Field, inputClass, Modal } from "@/components/ui";

interface Req {
  id: number; employeeNumber: string; fullName: string; departmentName: string; type: "VACACIONES" | "PSG";
  startDate: string; endDate: string; days: number; reason: string; status: string; createdAt: string;
  decidedBy: string | null; decisionNote: string | null;
}

const MONTHS = ["Enero", "Febrero", "Marzo", "Abril", "Mayo", "Junio", "Julio", "Agosto", "Septiembre", "Octubre", "Noviembre", "Diciembre"];
const STATUS_STYLE: Record<string, string> = {
  PENDIENTE: "bg-amber-50 text-amber-800 ring-amber-600/20",
  APROBADA: "bg-emerald-50 text-emerald-800 ring-emerald-600/20",
  RECHAZADA: "bg-red-50 text-red-800 ring-red-600/20",
  CANCELADA: "bg-slate-100 text-slate-600 ring-slate-400/20",
};

function todayMx() {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "America/Mexico_City" }).format(new Date());
}
const pad = (n: number) => String(n).padStart(2, "0");

export default function LeavePage() {
  const today = todayMx();
  const [ym, setYm] = useState(() => ({ y: Number(today.slice(0, 4)), m: Number(today.slice(5, 7)) }));
  const [pending, setPending] = useState<Req[]>([]);
  const [month, setMonth] = useState<Req[]>([]);
  const [decide, setDecide] = useState<{ req: Req; decision: "APROBAR" | "RECHAZAR" } | null>(null);
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ kind: "success" | "error"; text: string } | null>(null);
  const [selectedDay, setSelectedDay] = useState<string | null>(null);

  const daysInMonth = new Date(Date.UTC(ym.y, ym.m, 0)).getUTCDate();
  const from = `${ym.y}-${pad(ym.m)}-01`;
  const to = `${ym.y}-${pad(ym.m)}-${pad(daysInMonth)}`;

  const load = useCallback(async () => {
    try {
      const [p, m] = await Promise.all([
        api<{ requests: Req[] }>("/api/admin/leave?status=PENDIENTE"),
        api<{ requests: Req[] }>(`/api/admin/leave?from=${from}&to=${to}`),
      ]);
      setPending(p.requests);
      setMonth(m.requests.filter((r) => r.status === "APROBADA" || r.status === "PENDIENTE"));
    } catch (e) {
      setMsg({ kind: "error", text: (e as Error).message });
    }
  }, [from, to]);
  useEffect(() => { load(); }, [load]);

  async function submitDecision() {
    if (!decide) return;
    setBusy(true);
    try {
      const r = await api<{ status: string; daysRegistered: number; skipped: string[] }>(`/api/admin/leave/${decide.req.id}/decide`, {
        method: "POST", json: { decision: decide.decision, note },
      });
      setMsg({
        kind: "success",
        text: r.status === "APROBADA"
          ? `Solicitud aprobada: ${r.daysRegistered} día(s) quedaron como ${decide.req.type === "VACACIONES" ? "vacaciones" : "PSG"}.${r.skipped.length ? ` Se omitieron ${r.skipped.length} día(s) en que ya había confirmado asistencia.` : ""}`
          : "Solicitud rechazada.",
      });
      setDecide(null);
      setNote("");
      load();
    } catch (e) {
      setMsg({ kind: "error", text: (e as Error).message });
    } finally {
      setBusy(false);
    }
  }

  const byDay = useMemo(() => {
    const map = new Map<string, Req[]>();
    for (let d = 1; d <= daysInMonth; d++) {
      const date = `${ym.y}-${pad(ym.m)}-${pad(d)}`;
      map.set(date, month.filter((r) => r.startDate <= date && r.endDate >= date));
    }
    return map;
  }, [month, ym, daysInMonth]);

  const firstDow = (new Date(Date.UTC(ym.y, ym.m - 1, 1)).getUTCDay() + 6) % 7; // lunes = 0
  const cells: (string | null)[] = [...Array(firstDow).fill(null), ...[...byDay.keys()]];
  while (cells.length % 7) cells.push(null);

  const move = (delta: number) => setYm(({ y, m }) => {
    const nm = m + delta;
    return nm < 1 ? { y: y - 1, m: 12 } : nm > 12 ? { y: y + 1, m: 1 } : { y, m: nm };
  });

  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-xl font-bold text-slate-900">Vacaciones y PSG</h1>
        <p className="text-sm text-slate-500">Los trabajadores solicitan desde su celular. Al aprobar, cada día aparece automáticamente como vacaciones o PSG en el panel, el reporte y el Excel.</p>
      </div>
      {msg && <Alert kind={msg.kind}>{msg.text}</Alert>}

      <Card>
        <CardHeader title="Solicitudes pendientes" subtitle={`${pending.length} por revisar`} />
        <ul className="divide-y divide-slate-100">
          {pending.map((r) => (
            <li key={r.id} className="flex flex-wrap items-center justify-between gap-3 px-4 py-3">
              <div>
                <p className="text-sm font-semibold text-slate-900">{r.fullName} <span className="font-normal text-slate-500">#{r.employeeNumber} · {r.departmentName}</span></p>
                <p className="text-sm text-slate-700">
                  <Badge className={r.type === "VACACIONES" ? "bg-sky-50 text-sky-800 ring-sky-600/20" : "bg-indigo-50 text-indigo-800 ring-indigo-600/20"}>{r.type === "VACACIONES" ? "Vacaciones" : "PSG"}</Badge>
                  {" "}{dateShort(r.startDate)}{r.endDate !== r.startDate ? ` al ${dateShort(r.endDate)}` : ""} · {r.days} día(s)
                </p>
                {r.reason && <p className="text-xs text-slate-500">“{r.reason}”</p>}
              </div>
              <div className="flex gap-2">
                <Button variant="success" className="px-3 py-1.5 text-xs" onClick={() => { setNote(""); setDecide({ req: r, decision: "APROBAR" }); }}>Aprobar</Button>
                <Button variant="secondary" className="px-3 py-1.5 text-xs" onClick={() => { setNote(""); setDecide({ req: r, decision: "RECHAZAR" }); }}>Rechazar</Button>
              </div>
            </li>
          ))}
          {pending.length === 0 && <li className="px-4 py-6 text-center text-sm text-slate-500">No hay solicitudes pendientes.</li>}
        </ul>
      </Card>

      <Card>
        <div className="flex items-center justify-between border-b border-slate-200 px-4 py-3">
          <h2 className="text-sm font-semibold text-slate-900">Calendario · {MONTHS[ym.m - 1]} {ym.y}</h2>
          <div className="flex gap-1">
            <Button variant="secondary" className="px-2.5 py-1 text-xs" onClick={() => move(-1)}>‹ Anterior</Button>
            <Button variant="secondary" className="px-2.5 py-1 text-xs" onClick={() => move(1)}>Siguiente ›</Button>
          </div>
        </div>
        <div className="grid grid-cols-7 border-b border-slate-200 bg-slate-50 text-center text-xs font-semibold uppercase text-slate-500">
          {["Lun", "Mar", "Mié", "Jue", "Vie", "Sáb", "Dom"].map((d) => <div key={d} className="py-2">{d}</div>)}
        </div>
        <div className="grid grid-cols-7">
          {cells.map((date, i) => {
            const items = date ? byDay.get(date) ?? [] : [];
            return (
              <button key={i} disabled={!date} onClick={() => date && setSelectedDay(date)}
                className={cx("flex min-h-20 flex-col items-stretch justify-start border-b border-r border-slate-100 p-1 text-left sm:min-h-24",
                  !date && "bg-slate-50", date === today && "bg-amber-50/60", date && "hover:bg-slate-50")}>
                {date && (
                  <>
                    <span className={cx("text-xs font-semibold", date === today ? "text-amber-800" : "text-slate-500")}>{Number(date.slice(8))}</span>
                    <div className="mt-0.5 space-y-0.5">
                      {items.slice(0, 3).map((r) => (
                        <div key={r.id} title={`${r.fullName} · ${r.type}`}
                          className={cx("truncate rounded px-1 text-[10px] leading-4 sm:text-[11px]",
                            r.status === "PENDIENTE" ? "border border-dashed border-amber-500 text-amber-800"
                              : r.type === "VACACIONES" ? "bg-sky-100 text-sky-900" : "bg-indigo-100 text-indigo-900")}>
                          {r.fullName.split(" ")[0]} {r.fullName.split(" ")[1]?.[0] ?? ""}
                        </div>
                      ))}
                      {items.length > 3 && <div className="text-[10px] text-slate-500">+{items.length - 3} más</div>}
                    </div>
                  </>
                )}
              </button>
            );
          })}
        </div>
        <div className="flex flex-wrap gap-3 px-4 py-2 text-xs text-slate-600">
          <span><span className="mr-1 inline-block h-3 w-3 rounded bg-sky-100 align-middle" />Vacaciones</span>
          <span><span className="mr-1 inline-block h-3 w-3 rounded bg-indigo-100 align-middle" />PSG</span>
          <span><span className="mr-1 inline-block h-3 w-3 rounded border border-dashed border-amber-500 align-middle" />Pendiente</span>
        </div>
      </Card>

      <Modal open={!!selectedDay} title={selectedDay ? `Ausencias del ${dateShort(selectedDay)}` : ""} onClose={() => setSelectedDay(null)}>
        <ul className="space-y-2 text-sm">
          {(selectedDay ? byDay.get(selectedDay) ?? [] : []).map((r) => (
            <li key={r.id} className="rounded border border-slate-200 px-3 py-2">
              <div className="flex justify-between"><b>{r.fullName}</b><Badge className={STATUS_STYLE[r.status]}>{r.status.charAt(0) + r.status.slice(1).toLowerCase()}</Badge></div>
              <p className="text-slate-600">{r.type === "VACACIONES" ? "Vacaciones" : "PSG"} · {r.departmentName} · {dateShort(r.startDate)} al {dateShort(r.endDate)}</p>
            </li>
          ))}
          {selectedDay && (byDay.get(selectedDay) ?? []).length === 0 && <li className="text-slate-500">Nadie tiene vacaciones ni PSG este día.</li>}
        </ul>
      </Modal>

      <Modal open={!!decide} title={decide?.decision === "APROBAR" ? "Aprobar solicitud" : "Rechazar solicitud"} onClose={() => setDecide(null)}
        footer={<>
          <Button variant="secondary" onClick={() => setDecide(null)}>Cancelar</Button>
          <Button variant={decide?.decision === "APROBAR" ? "success" : "danger"} onClick={submitDecision} loading={busy}
            disabled={decide?.decision === "RECHAZAR" && note.trim().length < 3}>
            {decide?.decision === "APROBAR" ? "Aprobar" : "Rechazar"}
          </Button>
        </>}>
        {decide && (
          <div className="space-y-3 text-sm">
            <p><b>{decide.req.fullName}</b> · {decide.req.type === "VACACIONES" ? "Vacaciones" : "PSG"} · {dateShort(decide.req.startDate)} al {dateShort(decide.req.endDate)} ({decide.req.days} día(s))</p>
            <Field label={decide.decision === "RECHAZAR" ? "Motivo del rechazo (obligatorio)" : "Comentario (opcional)"}>
              <textarea className={inputClass} rows={3} value={note} onChange={(e) => setNote(e.target.value)} />
            </Field>
          </div>
        )}
      </Modal>
    </div>
  );
}
