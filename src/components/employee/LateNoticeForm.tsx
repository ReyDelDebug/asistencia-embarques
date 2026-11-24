"use client";

import { useState, type FormEvent } from "react";
import { Alert, api, Button, inputClass } from "../ui";

export default function LateNoticeForm({ onDone, onCancel }: { onDone: () => void; onCancel: () => void }) {
  const [eta, setEta] = useState("");
  const [reason, setReason] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setBusy(true);
    try {
      await api("/api/me/late", { method: "POST", json: { eta, reason } });
      onDone();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={submit} className="space-y-3 rounded-lg border border-orange-200 bg-orange-50 p-4">
      <p className="text-base font-bold text-orange-900">Avisar que llegaré tarde</p>
      <label className="block text-sm">
        <span className="mb-1 block font-semibold text-slate-700">¿A qué hora aproximada llegarás?</span>
        <input type="time" required value={eta} onChange={(e) => setEta(e.target.value)} className={inputClass} />
      </label>
      <label className="block text-sm">
        <span className="mb-1 block font-semibold text-slate-700">Motivo (obligatorio)</span>
        <textarea required minLength={3} maxLength={300} rows={2} value={reason} onChange={(e) => setReason(e.target.value)}
          className={inputClass} placeholder="Ej. Se descompuso el transporte" />
      </label>
      {error && <Alert>{error}</Alert>}
      <div className="grid grid-cols-2 gap-2">
        <Button type="button" variant="secondary" onClick={onCancel}>Cancelar</Button>
        <Button variant="brand" type="submit" loading={busy} disabled={reason.trim().length < 3 || !eta}>Enviar aviso</Button>
      </div>
      <p className="text-xs text-orange-800">Tu líder y tu supervisor verán el aviso. Cuando llegues, entra y confirma tu asistencia.</p>
    </form>
  );
}
