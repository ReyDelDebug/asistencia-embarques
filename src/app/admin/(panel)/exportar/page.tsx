"use client";

import { useEffect, useState } from "react";
import { Alert, api, Button, Card, CardHeader, cx, Field, inputClass } from "@/components/ui";

function todayMx() {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "America/Mexico_City" }).format(new Date());
}

export default function ExportPage() {
  const [mode, setMode] = useState<"day" | "range">("day");
  const [from, setFrom] = useState(todayMx());
  const [to, setTo] = useState(todayMx());
  const [shift, setShift] = useState("");
  const [dept, setDept] = useState("");
  const [departments, setDepartments] = useState<{ id: number; name: string }[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    api<{ departments: { id: number; name: string }[] }>("/api/admin/dashboard?shift=")
      .then((d) => setDepartments(d.departments)).catch(() => undefined);
  }, []);

  async function download() {
    setError(null);
    setBusy(true);
    const qs = new URLSearchParams({ from, to: mode === "day" ? from : to });
    if (shift) qs.set("shift", shift);
    if (dept) qs.set("dept", dept);
    try {
      const res = await fetch(`/api/admin/export?${qs}`, { cache: "no-store" });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error ?? "No se pudo generar el archivo.");
      }
      const blob = await res.blob();
      const name = /filename="([^"]+)"/.exec(res.headers.get("Content-Disposition") ?? "")?.[1] ?? "asistencia.xlsx";
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = name;
      a.click();
      URL.revokeObjectURL(url);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="mx-auto max-w-2xl space-y-5">
      <h1 className="text-2xl font-bold tracking-tight text-slate-900">Exportación a Excel</h1>
      <Card>
        <CardHeader title="Parámetros" subtitle="El archivo incluye: Asistencia general, Resumen e Historial" />
        <div className="space-y-4 p-4">
          <div className="inline-flex overflow-hidden rounded-md border border-slate-300">
            {([["day", "Un día"], ["range", "Periodo personalizado"]] as const).map(([k, l]) => (
              <button key={k} onClick={() => setMode(k)}
                className={cx("px-3 py-2 text-sm font-semibold", mode === k ? "bg-slate-900 text-white" : "bg-white text-slate-700")}>
                {l}
              </button>
            ))}
          </div>
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label={mode === "day" ? "Fecha" : "Desde"}>
              <input type="date" className={inputClass} value={from} onChange={(e) => setFrom(e.target.value)} />
            </Field>
            {mode === "range" && (
              <Field label="Hasta" hint="Máximo 93 días">
                <input type="date" className={inputClass} value={to} onChange={(e) => setTo(e.target.value)} />
              </Field>
            )}
            <Field label="Turno">
              <select className={inputClass} value={shift} onChange={(e) => setShift(e.target.value)}>
                <option value="">Ambos turnos</option>
                <option value="DIA">Día</option>
                <option value="NOCHE">Noche</option>
              </select>
            </Field>
            <Field label="Área">
              <select className={inputClass} value={dept} onChange={(e) => setDept(e.target.value)}>
                <option value="">Todas las áreas</option>
                {departments.map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}
              </select>
            </Field>
          </div>
          {error && <Alert>{error}</Alert>}
          <Button onClick={download} loading={busy} className="w-full py-3">DESCARGAR EXCEL</Button>
        </div>
      </Card>
    </div>
  );
}
