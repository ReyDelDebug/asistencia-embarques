"use client";

import { useCallback, useEffect, useState } from "react";
import { Alert, api, Avatar, Badge, Button, cx, dateLong, StatusBadge, time12, timeMx } from "../ui";

interface Member {
  employeeId: number; fullName: string; role: string; subareaName: string | null; shiftName: string;
  photoVersion: string | null; isMe: boolean;
}
interface LeaderRow {
  employeeId: number; fullName: string; role: string; subareaName: string | null; status: string;
  confirmedAt: string | null; photoVersion: string | null;
  late: boolean; lateEta: string | null; lateReason: string | null; extensionUntil: string | null; canExtend: boolean;
  support: boolean; homeDepartmentName: string | null;
}
interface Group {
  departmentName: string | null;
  members: Member[];
  isLeader: boolean;
  leaderView: null | {
    date: string; shiftCode: string; shiftName: string; extensionClose: string; confirmed: number; total: number; rows: LeaderRow[];
  };
}

export default function GroupTab() {
  const [data, setData] = useState<Group | null>(null);
  const [shift, setShift] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<{ kind: "success" | "error"; text: string } | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    try {
      setData(await api<Group>(`/api/me/group${shift ? `?shift=${shift}` : ""}`));
      setError(null);
    } catch (e) {
      setError((e as Error).message);
    }
  }, [shift]);

  useEffect(() => { load(); }, [load]);
  useEffect(() => {
    if (!data?.isLeader) return;
    const t = setInterval(load, 30_000);
    return () => clearInterval(t);
  }, [data?.isLeader, load]);

  async function extend(ids: number[]) {
    setBusy(true);
    setNotice(null);
    try {
      const r = await api<{ granted: string[]; skipped: { name: string; reason: string }[] }>("/api/me/extensions", {
        method: "POST", json: { employeeIds: ids },
      });
      const parts = [];
      if (r.granted.length) parts.push(`Registro abierto para: ${r.granted.join(", ")}.`);
      if (r.skipped.length) parts.push(`Sin cambio: ${r.skipped.map((x) => `${x.name} (${x.reason})`).join(", ")}.`);
      setNotice({ kind: r.granted.length ? "success" : "error", text: parts.join(" ") });
      load();
    } catch (e) {
      setNotice({ kind: "error", text: (e as Error).message });
    } finally {
      setBusy(false);
    }
  }

  async function revoke(id: number) {
    setBusy(true);
    try {
      await api("/api/me/extensions/revoke", { method: "POST", json: { employeeId: id } });
      load();
    } catch (e) {
      setNotice({ kind: "error", text: (e as Error).message });
    } finally {
      setBusy(false);
    }
  }

  if (error) return <Alert>{error}</Alert>;
  if (!data) return <p className="py-10 text-center text-sm text-slate-500">Cargando…</p>;
  if (!data.departmentName) {
    return <Alert kind="info">Como supervisor, consulta a todo el personal desde el panel de supervisión.</Alert>;
  }

  const lv = data.leaderView;
  return (
    <section className="space-y-4">
      {lv && (
        <div className="rounded-lg border border-slate-200 bg-white shadow-sm">
          <div className="border-b border-slate-200 px-4 py-3">
            <div className="flex items-center justify-between gap-2">
              <p className="text-sm font-bold text-slate-900">Asistencia de {data.departmentName}</p>
              <div className="inline-flex overflow-hidden rounded-md border border-slate-300">
                {[["DIA", "Día"], ["NOCHE", "Noche"]].map(([code, label]) => (
                  <button key={code} onClick={() => setShift(code)}
                    className={cx("px-3 py-1 text-xs font-semibold", lv.shiftCode === code ? "bg-slate-900 text-white" : "bg-white text-slate-700")}>
                    {label}
                  </button>
                ))}
              </div>
            </div>
            <p className="mt-1 text-xs text-slate-500">{dateLong(lv.date)} · Turno {lv.shiftName}</p>
            <p className="mt-2 text-2xl font-bold tabular text-slate-900">{lv.confirmed} <span className="text-base font-medium text-slate-500">de {lv.total} registrados</span></p>
            {lv.rows.filter((r) => r.canExtend).length > 1 && (
              <Button variant="secondary" className="mt-2 w-full text-xs" loading={busy}
                onClick={() => extend(lv.rows.filter((r) => r.canExtend).map((r) => r.employeeId))}>
                Abrir registro a todos los que faltan ({lv.rows.filter((r) => r.canExtend).length})
              </Button>
            )}
            {notice && <div className="mt-2"><Alert kind={notice.kind}>{notice.text}</Alert></div>}
          </div>
          <ul className="divide-y divide-slate-100">
            {lv.rows.map((r) => (
              <li key={r.employeeId} className="flex items-center gap-3 px-4 py-2">
                <Avatar employeeId={r.employeeId} name={r.fullName} version={r.photoVersion} size={36} />
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-semibold text-slate-900">{r.fullName}</p>
                  <p className="text-xs text-slate-500">
                    {r.role === "LEADER" ? "Líder" : "Empleado"}{r.subareaName ? ` · ${r.subareaName}` : ""}
                    {r.confirmedAt ? ` · ${timeMx(r.confirmedAt)}` : ""}
                    {r.late && <span className="font-semibold text-orange-700"> · llegó tarde</span>}
                    {r.support && <span className="font-semibold text-sky-700"> · apoyo{r.homeDepartmentName ? ` de ${r.homeDepartmentName}` : ""}</span>}
                  </p>
                  {r.lateEta && r.status !== "CONFIRMADO" && (
                    <p className="text-xs text-orange-800">Llega ~{time12(r.lateEta)} · {r.lateReason}</p>
                  )}
                  {r.extensionUntil && r.status !== "CONFIRMADO" && (
                    <p className="text-xs text-sky-800">
                      Registro abierto ·{" "}
                      <button disabled={busy} onClick={() => revoke(r.employeeId)} className="font-semibold underline disabled:opacity-50">Cerrar</button>
                    </p>
                  )}
                  {r.canExtend && (
                    <button disabled={busy} onClick={() => extend([r.employeeId])}
                      className="mt-1 text-xs font-semibold text-sky-800 underline disabled:opacity-50">
                      Abrir registro
                    </button>
                  )}
                </div>
                <StatusBadge status={r.status} />
              </li>
            ))}
            {lv.rows.length === 0 && <li className="px-4 py-4 text-sm text-slate-500">Nadie de tu área tiene asignado este turno.</li>}
          </ul>
          <p className="px-4 py-2 text-xs text-slate-400">Como líder solo ves la asistencia de tu área. Se actualiza cada 30 s.</p>
        </div>
      )}

      <div className="rounded-lg border border-slate-200 bg-white shadow-sm">
        <div className="border-b border-slate-200 px-4 py-3">
          <p className="text-sm font-bold text-slate-900">Mi grupo · {data.departmentName}</p>
          <p className="text-xs text-slate-500">{data.members.length} compañero(s)</p>
        </div>
        <ul className="divide-y divide-slate-100">
          {data.members.map((m) => (
            <li key={m.employeeId} className={cx("flex items-center gap-3 px-4 py-2.5", m.isMe && "bg-slate-50")}>
              <Avatar employeeId={m.employeeId} name={m.fullName} version={m.photoVersion} size={44} />
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-semibold text-slate-900">
                  {m.fullName}{m.isMe && <span className="ml-1 text-xs font-normal text-slate-500">(tú)</span>}
                </p>
                <p className="text-xs text-slate-500">{m.subareaName ? `${m.subareaName} · ` : ""}Turno {m.shiftName}</p>
              </div>
              {m.role === "LEADER" && <Badge className="bg-slate-900 text-white ring-slate-900">Líder</Badge>}
            </li>
          ))}
        </ul>
      </div>
    </section>
  );
}
