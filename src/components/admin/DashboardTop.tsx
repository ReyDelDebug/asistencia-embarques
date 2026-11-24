"use client";

import { useCallback, useEffect, useState } from "react";
import { Alert, api, ApiError, Button, Card, cx, time12, timeMx } from "../ui";

interface WindowRow {
  code: string; name: string; date: string; open: boolean; normalOpen: string; normalClose: string;
  openTime: string; closeTime: string; override: { setBy: string; updatedAt: string; openAllDay: boolean } | null;
  day: { type: string; label: string; works: boolean };
}

/** Control del supervisor: cerrar antes, abrir todo el día o volver al horario normal. */
export function WindowControl({ onChange }: { onChange?: () => void }) {
  const [rows, setRows] = useState<WindowRow[]>([]);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try { setRows((await api<{ windows: WindowRow[] }>("/api/admin/windows")).windows); } catch { /* sin datos */ }
  }, []);
  useEffect(() => { load(); const t = setInterval(load, 30_000); return () => clearInterval(t); }, [load]);

  async function act(shift: string, action: "OPEN" | "CLOSE" | "RESET") {
    const labels = { OPEN: "abrir el registro para todos", CLOSE: "cerrar el registro ahora", RESET: "volver al horario normal" };
    if (!confirm(`¿Seguro que quieres ${labels[action]} del turno de ${shift === "DIA" ? "día" : "noche"}?`)) return;
    setBusy(shift + action);
    setError(null);
    try {
      const r = await api<{ windows: WindowRow[] }>("/api/admin/windows", { method: "POST", json: { shift, action } });
      setRows(r.windows);
      onChange?.();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(null);
    }
  }

  return (
    <Card className="p-4">
      <div className="mb-3 flex items-center justify-between">
        <div>
          <h2 className="text-sm font-semibold text-slate-900">Registro de asistencia de hoy</h2>
          <p className="text-xs text-slate-500">Horario normal: día {time12("05:00:00")}–{time12("08:00:00")} · noche {time12("17:00:00")}–{time12("20:00:00")}</p>
        </div>
        {rows[0] && (
          <span className={cx("rounded-full px-3 py-1 text-xs font-semibold",
            !rows[0].day.works ? "bg-slate-200 text-slate-700" : rows[0].day.type.startsWith("VIERNES") ? "bg-amber-100 text-amber-900" : "bg-emerald-100 text-emerald-900")}>
            {!rows[0].day.works ? `No laborable${rows[0].day.label ? ` · ${rows[0].day.label}` : ""}`
              : rows[0].day.type === "VIERNES" ? "Viernes · tiempo extra" : rows[0].day.type === "VIERNES_LARGO" ? "Viernes · jornada larga" : "Día laborable"}
          </span>
        )}
      </div>
      <div className="grid gap-3 sm:grid-cols-2">
        {rows.map((w) => (
          <div key={w.code} className={cx("rounded-xl border p-3", w.open ? "border-emerald-200 bg-emerald-50/60" : "border-slate-200 bg-slate-50")}>
            <div className="flex items-center justify-between">
              <p className="text-sm font-semibold text-slate-900">Turno {w.name}</p>
              <span className={cx("inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-xs font-semibold",
                w.open ? "bg-emerald-600 text-white" : "bg-slate-300 text-slate-700")}>
                <span className={cx("h-1.5 w-1.5 rounded-full", w.open ? "animate-pulse bg-white" : "bg-slate-500")} />
                {w.open ? "ABIERTO" : "CERRADO"}
              </span>
            </div>
            <p className="mt-1 text-xs text-slate-600">
              {w.override
                ? w.override.openAllDay
                  ? <>Abierto por <b>{w.override.setBy}</b> hasta que se cierre</>
                  : <>Cerrado por <b>{w.override.setBy}</b> a las {time12(w.closeTime)}</>
                : !w.day.works ? <>Hoy no se trabaja: el registro está cerrado</>
                : <>Horario normal: {time12(w.openTime)} a {time12(w.closeTime)}</>}
            </p>
            <div className="mt-2 flex flex-wrap gap-1.5">
              {w.open
                ? <Button variant="danger" className="px-2.5 py-1 text-xs" loading={busy === w.code + "CLOSE"} onClick={() => act(w.code, "CLOSE")}>Cerrar ahora</Button>
                : <Button variant="success" className="px-2.5 py-1 text-xs" loading={busy === w.code + "OPEN"} onClick={() => act(w.code, "OPEN")}>Abrir registro</Button>}
              {w.override && <Button variant="ghost" className="px-2.5 py-1 text-xs" loading={busy === w.code + "RESET"} onClick={() => act(w.code, "RESET")}>Horario normal</Button>}
            </div>
          </div>
        ))}
      </div>
      {error && <div className="mt-3"><Alert>{error}</Alert></div>}
    </Card>
  );
}

interface MyView {
  shift: { name: string }; windowState: string;
  existing: { confirmedAt: string; via: string } | null;
  lateNotice: { eta: string } | null;
}

/** El supervisor confirma su propia asistencia desde el panel. */
export function MyAttendance({ onChange }: { onChange?: () => void }) {
  const [data, setData] = useState<{ linked: boolean; view?: MyView } | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try { setData(await api<{ linked: boolean; view?: MyView }>("/api/admin/me/attendance")); } catch { setData({ linked: false }); }
  }, []);
  useEffect(() => { load(); }, [load]);

  async function confirmMine() {
    setBusy(true);
    setError(null);
    try {
      await api("/api/admin/me/attendance", { method: "POST" });
      await load();
      onChange?.();
    } catch (e) {
      if (e instanceof ApiError && e.status === 409) await load();
      else setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  if (!data?.linked || !data.view) return null;
  const v = data.view;
  return (
    <Card className="flex flex-col justify-between gap-3 p-4">
      <div>
        <h2 className="text-sm font-semibold text-slate-900">Mi asistencia</h2>
        <p className="text-xs text-slate-500">Turno {v.shift.name}</p>
      </div>
      {v.existing ? (
        <div className="rounded-xl bg-emerald-50 px-3 py-3 text-sm text-emerald-900">
          <p className="font-semibold">✓ Registrada a las {timeMx(v.existing.confirmedAt)}</p>
        </div>
      ) : v.windowState === "OPEN" ? (
        <Button variant="success" onClick={confirmMine} loading={busy} className="w-full py-3">CONFIRMAR MI ASISTENCIA</Button>
      ) : (
        <p className="rounded-xl bg-slate-100 px-3 py-3 text-sm text-slate-600">El registro de tu turno está cerrado. Puedes abrirlo en «Registro de asistencia de hoy».</p>
      )}
      {error && <Alert>{error}</Alert>}
    </Card>
  );
}
