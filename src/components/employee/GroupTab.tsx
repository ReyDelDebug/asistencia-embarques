"use client";

import { useCallback, useEffect, useState } from "react";
import { Alert, api, Avatar, Badge, cx, dateLong, StatusBadge, timeMx } from "../ui";

interface Member {
  employeeId: number; fullName: string; role: string; subareaName: string | null; shiftName: string;
  photoVersion: string | null; isMe: boolean;
}
interface LeaderRow {
  employeeId: number; fullName: string; role: string; subareaName: string | null; status: string;
  confirmedAt: string | null; photoVersion: string | null;
}
interface Group {
  departmentName: string | null;
  members: Member[];
  isLeader: boolean;
  leaderView: null | { date: string; shiftCode: string; shiftName: string; confirmed: number; total: number; rows: LeaderRow[] };
}

export default function GroupTab() {
  const [data, setData] = useState<Group | null>(null);
  const [shift, setShift] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

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
                  </p>
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
