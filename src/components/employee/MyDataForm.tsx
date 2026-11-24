"use client";

import { useCallback, useEffect, useState, type FormEvent } from "react";
import { Alert, api, Button, cx, dateShort, inputClass } from "../ui";

interface Profile { fullName: string; phone: string | null; birthDate: string | null; bootSize: number | null; vestSize: string | null; complete: boolean; missing: string[] }
interface Vacations { assigned: number | null; periodStart: string; used: number; pending: number; available: number | null; requestable: number | null }

const BOOTS = Array.from({ length: 29 }, (_, i) => 22 + i * 0.5); // 22 a 36

export function VacationCard({ v }: { v: Vacations | null }) {
  if (!v) return null;
  return (
    <div className="rounded-lg border border-slate-200 bg-white p-4 shadow-sm">
      <p className="text-sm font-bold text-slate-900">🏖️ Mis vacaciones</p>
      {v.assigned == null ? (
        <p className="mt-1 text-sm text-slate-600">Tu supervisor aún no registra tus días de vacaciones.</p>
      ) : (
        <>
          <div className="mt-3 grid grid-cols-3 gap-2 text-center">
            <div className="rounded-md bg-emerald-50 px-2 py-2"><p className="text-2xl font-bold tabular text-emerald-800">{v.available}</p><p className="text-xs text-emerald-900">Disponibles</p></div>
            <div className="rounded-md bg-slate-50 px-2 py-2"><p className="text-2xl font-bold tabular text-slate-800">{v.used}</p><p className="text-xs text-slate-600">Tomados</p></div>
            <div className="rounded-md bg-slate-50 px-2 py-2"><p className="text-2xl font-bold tabular text-slate-800">{v.assigned}</p><p className="text-xs text-slate-600">Asignados</p></div>
          </div>
          <p className="mt-2 text-xs text-slate-500">
            Periodo desde el {dateShort(v.periodStart)}{v.pending ? ` · ${v.pending} día(s) en solicitudes pendientes` : ""}.
          </p>
        </>
      )}
    </div>
  );
}

export default function MyDataForm({ onSaved }: { onSaved?: () => void }) {
  const [profile, setProfile] = useState<Profile | null>(null);
  const [vac, setVac] = useState<Vacations | null>(null);
  const [form, setForm] = useState({ fullName: "", phone: "", birthDate: "", bootSize: "", vestSize: "" });
  const [msg, setMsg] = useState<{ kind: "success" | "error"; text: string } | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    const r = await api<{ profile: Profile; vacations: Vacations }>("/api/me/profile");
    setProfile(r.profile);
    setVac(r.vacations);
    setForm({
      fullName: r.profile.fullName, phone: r.profile.phone ?? "", birthDate: r.profile.birthDate ?? "",
      bootSize: r.profile.bootSize != null ? String(r.profile.bootSize) : "", vestSize: r.profile.vestSize ?? "",
    });
  }, []);
  useEffect(() => { load().catch(() => undefined); }, [load]);

  async function save(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setMsg(null);
    try {
      await api("/api/me/profile", { method: "PUT", json: { ...form, bootSize: Number(form.bootSize) } });
      setMsg({ kind: "success", text: "Tus datos se guardaron." });
      await load();
      onSaved?.();
    } catch (err) {
      setMsg({ kind: "error", text: (err as Error).message });
    } finally {
      setBusy(false);
    }
  }

  if (!profile) return null;
  const nameOk = /^[A-Za-zÁÉÍÓÚÜÑáéíóúüñ]+(?: [A-Za-zÁÉÍÓÚÜÑáéíóúüñ]+)+$/.test(form.fullName.trim().replace(/\s+/g, " "));

  return (
    <>
      <VacationCard v={vac} />
      <form onSubmit={save} className="space-y-3 rounded-lg border border-slate-200 bg-white p-5 shadow-sm">
        <div>
          <p className="text-base font-bold text-slate-900">Mis datos</p>
          {!profile.complete && <p className="mt-1 text-sm text-amber-700">Te falta: {profile.missing.join(", ")}.</p>}
        </div>
        <label className="block text-sm">
          <span className="mb-1 block font-semibold text-slate-700">Nombre completo *</span>
          <input required maxLength={80} value={form.fullName} placeholder="Nombre y apellidos"
            onChange={(e) => setForm({ ...form, fullName: e.target.value.replace(/[^A-Za-zÁÉÍÓÚÜÑáéíóúüñ ]/g, "") })}
            className={cx(inputClass, form.fullName && !nameOk && "border-amber-500")} />
          <span className="mt-1 block text-xs text-slate-500">Solo letras; se permiten acentos y ñ. Escribe nombre y apellidos.</span>
        </label>
        <label className="block text-sm">
          <span className="mb-1 block font-semibold text-slate-700">Teléfono (10 dígitos) *</span>
          <input required inputMode="tel" maxLength={10} value={form.phone} placeholder="4421234567"
            onChange={(e) => setForm({ ...form, phone: e.target.value.replace(/\D/g, "") })} className={inputClass} />
        </label>
        <label className="block text-sm">
          <span className="mb-1 block font-semibold text-slate-700">Fecha de nacimiento *</span>
          <input required type="date" value={form.birthDate} max="2012-12-31" onChange={(e) => setForm({ ...form, birthDate: e.target.value })} className={inputClass} />
        </label>
        <div className="grid grid-cols-2 gap-3">
          <label className="block text-sm">
            <span className="mb-1 block font-semibold text-slate-700">Número de botas *</span>
            <select required value={form.bootSize} onChange={(e) => setForm({ ...form, bootSize: e.target.value })} className={inputClass}>
              <option value="">Elegir…</option>
              {BOOTS.map((b) => <option key={b} value={b}>{b % 1 ? b.toFixed(1) : b}</option>)}
            </select>
          </label>
          <label className="block text-sm">
            <span className="mb-1 block font-semibold text-slate-700">Talla de chaleco *</span>
            <select required value={form.vestSize} onChange={(e) => setForm({ ...form, vestSize: e.target.value })} className={inputClass}>
              <option value="">Elegir…</option>
              <option value="CHICO">Chico</option>
              <option value="MEDIANO">Mediano</option>
              <option value="GRANDE">Grande</option>
            </select>
          </label>
        </div>
        {msg && <Alert kind={msg.kind}>{msg.text}</Alert>}
        <Button type="submit" loading={busy} disabled={!nameOk} className="w-full">Guardar mis datos</Button>
      </form>
    </>
  );
}
