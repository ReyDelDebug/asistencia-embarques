"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { Alert, api, Badge, Button, Card, cx, dateLong, dateShort, Field, inputClass, Modal, ROLE_LABELS } from "@/components/ui";

interface RolRow {
  employeeId: number; employeeNumber: string; fullName: string; role: string;
  departmentId: number | null; departmentName: string; subareaId: number | null; subareaName: string | null;
  shiftCode: string; since: string | null; nextChange: { date: string; shiftCode: string; shiftName: string } | null;
  temporary: boolean; until: string | null; homeDepartmentName: string | null; support: boolean;
}
interface RolData {
  date: string; today: string; currentMonday: string; rows: RolRow[];
  departments: { id: number; name: string }[]; subareas: { id: number; departmentId: number; name: string }[];
}
interface AreaForm { row: RolRow; shiftCode: string; departmentId: string; subareaId: string; from: string; until: string; temporary: boolean }

function addDays(date: string, n: number) {
  const d = new Date(`${date}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

function defaultDate(today: string, monday: string) {
  return today === monday ? today : addDays(monday, 7);
}

const SHIFT_LABEL: Record<string, string> = { DIA: "Día", NOCHE: "Noche" };

export default function RolPage() {
  const [date, setDate] = useState<string | null>(null);
  const [data, setData] = useState<RolData | null>(null);
  const [changes, setChanges] = useState<Record<number, string>>({});
  const [msg, setMsg] = useState<{ kind: "success" | "error"; text: string } | null>(null);
  const [saving, setSaving] = useState(false);
  const [q, setQ] = useState("");
  const [area, setArea] = useState<AreaForm | null>(null);
  const [areaBusy, setAreaBusy] = useState(false);
  const [areaErr, setAreaErr] = useState<string | null>(null);

  const load = useCallback(async (d: string | null) => {
    try {
      const r = await api<RolData>(`/api/admin/rol${d ? `?date=${d}` : ""}`);
      if (!d) {
        const def = defaultDate(r.today, r.currentMonday);
        setDate(def);
        return;
      }
      setData(r);
      setChanges({});
    } catch (e) {
      setMsg({ kind: "error", text: (e as Error).message });
    }
  }, []);

  useEffect(() => { load(date); }, [date, load]);

  const groups = useMemo(() => {
    const map = new Map<string, RolRow[]>();
    for (const r of data?.rows ?? []) {
      if (q && !`${r.fullName} ${r.employeeNumber}`.toLowerCase().includes(q.toLowerCase())) continue;
      const key = r.subareaName ? `${r.departmentName} · ${r.subareaName}` : r.departmentName;
      map.set(key, [...(map.get(key) ?? []), r]);
    }
    return [...map.entries()];
  }, [data, q]);

  const shiftOf = (r: RolRow) => changes[r.employeeId] ?? r.shiftCode;
  const setShift = (r: RolRow, code: string) => {
    if (r.temporary) return; // en apoyo temporal: primero terminar el apoyo
    setChanges((c) => {
      const n = { ...c };
      if (code === r.shiftCode) delete n[r.employeeId]; else n[r.employeeId] = code;
      return n;
    });
  };

  async function save() {
    if (!date) return;
    setSaving(true);
    setMsg(null);
    try {
      const items = Object.entries(changes).map(([employeeId, shiftCode]) => ({ employeeId: Number(employeeId), shiftCode }));
      const r = await api<{ changed: number }>("/api/admin/rol", { method: "PUT", json: { effectiveFrom: date, items } });
      setMsg({ kind: "success", text: `Rol guardado: ${r.changed} cambio(s) a partir del ${dateLong(date)}. Quien no cambió sigue en su mismo turno.` });
      await load(date);
    } catch (e) {
      setMsg({ kind: "error", text: (e as Error).message });
    } finally {
      setSaving(false);
    }
  }

  function openArea(r: RolRow) {
    setAreaErr(null);
    setArea({
      row: r, shiftCode: r.shiftCode, departmentId: String(r.departmentId ?? data?.departments[0]?.id ?? ""), subareaId: String(r.subareaId ?? ""),
      from: date ?? data?.today ?? "", until: "", temporary: true,
    });
  }

  async function saveArea() {
    if (!area) return;
    setAreaBusy(true);
    setAreaErr(null);
    try {
      await api("/api/admin/rol/area", {
        method: "POST",
        json: {
          employeeId: area.row.employeeId, shiftCode: area.shiftCode, departmentId: Number(area.departmentId),
          subareaId: area.subareaId ? Number(area.subareaId) : null, effectiveFrom: area.from,
          endDate: area.temporary ? area.until || null : null,
        },
      });
      setMsg({ kind: "success", text: `${area.row.fullName}: cambio de área guardado.` });
      setArea(null);
      await load(date);
    } catch (e) {
      setAreaErr((e as Error).message);
    } finally {
      setAreaBusy(false);
    }
  }

  async function finishSupport(r: RolRow) {
    if (!confirm(`¿Terminar el apoyo de ${r.fullName}? A partir de mañana regresa a ${r.homeDepartmentName ?? "su área"}.`)) return;
    try {
      await api("/api/admin/rol/area/end", { method: "POST", json: { employeeId: r.employeeId } });
      setMsg({ kind: "success", text: `Apoyo de ${r.fullName} terminado.` });
      await load(date);
    } catch (e) {
      setMsg({ kind: "error", text: (e as Error).message });
    }
  }

  const pending = Object.keys(changes).length;
  const total = (code: string) => (data?.rows ?? []).filter((r) => shiftOf(r) === code).length;

  return (
    <div className="space-y-5 pb-24">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-slate-900">Rol de turno</h1>
          <p className="text-sm text-slate-500">Asigna Día o Noche por persona. El cambio aplica desde la fecha elegida y sigue igual hasta que lo vuelvas a cambiar.</p>
        </div>
        {data && (
          <div className="flex gap-2 text-sm">
            <Badge className="bg-amber-50 text-amber-900 ring-amber-600/20">Día: {total("DIA")}</Badge>
            <Badge className="bg-indigo-50 text-indigo-900 ring-indigo-600/20">Noche: {total("NOCHE")}</Badge>
          </div>
        )}
      </div>

      <Card className="p-4">
        <div className="flex flex-wrap items-end gap-3">
          <label className="block">
            <span className="mb-1 block text-xs font-semibold uppercase tracking-wide text-slate-600">Aplicar a partir de</span>
            <input type="date" className={inputClass} value={date ?? ""} min={data?.today}
              onChange={(e) => { if (!pending || confirm("Tienes cambios sin guardar. ¿Descartarlos?")) setDate(e.target.value); }} />
          </label>
          {data && (
            <div className="flex flex-wrap gap-2">
              <Button variant="secondary" className="text-xs" onClick={() => setDate(data.today)}>Hoy</Button>
              <Button variant="secondary" className="text-xs" onClick={() => setDate(addDays(data.currentMonday, 7))}>Próximo lunes</Button>
              <Button variant="secondary" className="text-xs" onClick={() => setDate(addDays(data.currentMonday, 14))}>Lunes en 2 semanas</Button>
            </div>
          )}
          <input className={`${inputClass} sm:ml-auto sm:w-64`} placeholder="Buscar persona" value={q} onChange={(e) => setQ(e.target.value)} />
        </div>
        {date && <p className="mt-2 text-sm text-slate-600">Mostrando el turno vigente el <b>{dateLong(date)}</b>.</p>}
      </Card>

      {msg && <Alert kind={msg.kind}>{msg.text}</Alert>}

      <div className="grid gap-4 lg:grid-cols-2">
        {groups.map(([label, rows]) => {
          const leaders = rows.filter((r) => r.role === "LEADER");
          const isSup = label === "Supervisión";
          return (
            <Card key={label}>
              <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-200 px-4 py-3">
                <div>
                  <h2 className="text-sm font-semibold text-slate-900">{label}</h2>
                  <p className="text-xs text-slate-500">
                    {rows.length} persona(s) · Día {rows.filter((r) => shiftOf(r) === "DIA").length} · Noche {rows.filter((r) => shiftOf(r) === "NOCHE").length}
                    {!isSup && <> · Líder: {leaders.length ? leaders.map((l) => l.fullName).join(", ") : <span className="font-semibold text-amber-700">sin asignar</span>}</>}
                  </p>
                </div>
                <div className="flex gap-1">
                  <Button variant="ghost" className="px-2 py-1 text-xs" onClick={() => rows.forEach((r) => setShift(r, "DIA"))}>Todos a Día</Button>
                  <Button variant="ghost" className="px-2 py-1 text-xs" onClick={() => rows.forEach((r) => setShift(r, "NOCHE"))}>Todos a Noche</Button>
                </div>
              </div>
              <ul className="divide-y divide-slate-100">
                {rows.map((r) => {
                  const current = shiftOf(r);
                  const changed = r.employeeId in changes;
                  return (
                    <li key={r.employeeId} className={cx("flex items-center justify-between gap-3 px-4 py-2", changed && "bg-amber-50")}>
                      <div className="min-w-0">
                        <p className="truncate text-sm font-semibold text-slate-900">
                          {r.fullName}
                          {r.role !== "EMPLOYEE" && <Badge className="ml-2 bg-slate-900 text-white ring-slate-900">{ROLE_LABELS[r.role]}</Badge>}
                        </p>
                        <p className="text-xs text-slate-500">
                          #{r.employeeNumber}
                          {changed ? <> · <b className="text-amber-800">cambia de {SHIFT_LABEL[r.shiftCode]} a {SHIFT_LABEL[current]}</b></>
                            : r.since ? ` · ${SHIFT_LABEL[r.shiftCode]} desde ${dateShort(r.since)}` : ""}
                          {r.nextChange && !changed && ` · pasa a ${r.nextChange.shiftName} el ${dateShort(r.nextChange.date)}`}
                        </p>
                        {r.support && (
                          <p className="text-xs font-semibold text-sky-800">
                            {r.temporary ? `Apoyo hasta el ${dateShort(r.until!)}` : "Cambio de área"}{r.homeDepartmentName ? ` · de ${r.homeDepartmentName}` : ""}
                            {r.temporary && <> · <button className="underline" onClick={() => finishSupport(r)}>Terminar apoyo</button></>}
                          </p>
                        )}
                        {r.role !== "SUPERVISOR" && (
                          <button className="text-xs font-semibold text-slate-600 underline hover:text-emerald-700" onClick={() => openArea(r)}>
                            Cambiar área
                          </button>
                        )}
                      </div>
                      <div className="inline-flex shrink-0 overflow-hidden rounded-md border border-slate-300">
                        {["DIA", "NOCHE"].map((code) => (
                          <button key={code} onClick={() => setShift(r, code)} aria-pressed={current === code} disabled={r.temporary}
                            title={r.temporary ? "Está en apoyo temporal" : undefined}
                            className={cx("px-3 py-1.5 text-xs font-semibold disabled:cursor-not-allowed disabled:opacity-60",
                              current === code ? (code === "DIA" ? "bg-amber-500 text-white" : "bg-indigo-700 text-white") : "bg-white text-slate-600 hover:bg-slate-50")}>
                            {SHIFT_LABEL[code]}
                          </button>
                        ))}
                      </div>
                    </li>
                  );
                })}
              </ul>
            </Card>
          );
        })}
      </div>

      <Modal open={!!area} title={area ? `Cambiar área · ${area.row.fullName}` : ""} onClose={() => setArea(null)}
        footer={<><Button variant="secondary" onClick={() => setArea(null)}>Cancelar</Button><Button onClick={saveArea} loading={areaBusy}>Guardar cambio</Button></>}>
        {area && data && (
          <div className="space-y-3">
            <p className="text-sm text-slate-600">Ahora: {area.row.departmentName}{area.row.subareaName ? ` · ${area.row.subareaName}` : ""} · {SHIFT_LABEL[area.row.shiftCode]}</p>
            <div className="grid grid-cols-2 gap-3">
              <Field label="Turno destino">
                <select className={inputClass} value={area.shiftCode} onChange={(e) => setArea({ ...area, shiftCode: e.target.value })}>
                  <option value="DIA">Día</option><option value="NOCHE">Noche</option>
                </select>
              </Field>
              <Field label="Área destino">
                <select className={inputClass} value={area.departmentId} onChange={(e) => setArea({ ...area, departmentId: e.target.value, subareaId: "" })}>
                  {data.departments.map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}
                </select>
              </Field>
            </div>
            {data.subareas.some((x) => String(x.departmentId) === area.departmentId) && (
              <Field label="Subárea">
                <select className={inputClass} value={area.subareaId} onChange={(e) => setArea({ ...area, subareaId: e.target.value })}>
                  <option value="">— General —</option>
                  {data.subareas.filter((x) => String(x.departmentId) === area.departmentId).map((x) => <option key={x.id} value={x.id}>{x.name}</option>)}
                </select>
              </Field>
            )}
            <div className="inline-flex w-full overflow-hidden rounded-md border border-slate-300">
              {[[true, "Apoyo temporal"], [false, "Cambio permanente"]].map(([v, l]) => (
                <button key={String(v)} type="button" onClick={() => setArea({ ...area, temporary: v as boolean })}
                  className={cx("flex-1 px-3 py-2 text-sm font-semibold", area.temporary === v ? "bg-slate-900 text-white" : "bg-white text-slate-700")}>
                  {l as string}
                </button>
              ))}
            </div>
            <div className="grid grid-cols-2 gap-3">
              <Field label="A partir de">
                <input type="date" className={inputClass} min={data.today} value={area.from} onChange={(e) => setArea({ ...area, from: e.target.value })} />
              </Field>
              {area.temporary && (
                <Field label="Hasta (último día)">
                  <input type="date" className={inputClass} min={area.from} value={area.until} onChange={(e) => setArea({ ...area, until: e.target.value })} />
                </Field>
              )}
            </div>
            <p className="text-xs text-slate-500">
              {area.temporary
                ? "Al terminar el apoyo regresa solo a su área y turno. Mientras tanto cuenta en el área destino y solo lo ve el líder de esa área."
                : "Queda en la nueva área hasta que lo vuelvas a cambiar."}
            </p>
            {areaErr && <Alert>{areaErr}</Alert>}
          </div>
        )}
      </Modal>

      <div className="fixed inset-x-0 bottom-0 z-30 border-t border-slate-200 bg-white/95 px-4 py-3 shadow-lg backdrop-blur lg:left-64">
        <div className="mx-auto flex max-w-7xl items-center justify-between gap-3">
          <p className="text-sm text-slate-700">{pending ? <><b>{pending}</b> cambio(s) sin guardar · aplicarán desde el {date ? dateShort(date) : ""}</> : "Sin cambios pendientes"}</p>
          <div className="flex gap-2">
            {pending > 0 && <Button variant="secondary" onClick={() => setChanges({})}>Descartar</Button>}
            <Button onClick={save} loading={saving} disabled={!pending}>Guardar rol</Button>
          </div>
        </div>
      </div>
    </div>
  );
}
