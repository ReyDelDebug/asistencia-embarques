"use client";

import { useEffect, useState } from "react";
import { Alert, api, Button, Field, inputClass, Modal, STATUS_LABELS } from "../ui";

export interface IncidentTarget {
  employeeId: number;
  fullName: string;
  date: string;
  shiftId: number;
  shiftName: string;
  currentStatus: string;
}

const TYPES = ["FALTA", "VACACIONES", "INCAPACIDAD", "PSG", "BAJA"];

export function IncidentModal({ target, onClose, onSaved }: { target: IncidentTarget | null; onClose: () => void; onSaved: () => void }) {
  const [type, setType] = useState("FALTA");
  const [reason, setReason] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (target) {
      setType(TYPES.includes(target.currentStatus) ? target.currentStatus : "FALTA");
      setReason("");
      setError(null);
    }
  }, [target]);

  async function save() {
    if (!target) return;
    setBusy(true);
    setError(null);
    try {
      await api("/api/admin/incidents", {
        method: "POST",
        json: { employeeId: target.employeeId, date: target.date, shiftId: target.shiftId, type, reason },
      });
      onSaved();
      onClose();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal
      open={!!target}
      title="Cambiar estado"
      onClose={onClose}
      footer={<>
        <Button variant="secondary" onClick={onClose}>Cancelar</Button>
        <Button onClick={save} loading={busy} disabled={reason.trim().length < 3}>Guardar cambio</Button>
      </>}
    >
      {target && (
        <div className="space-y-4">
          <div className="rounded-md bg-slate-50 px-3 py-2 text-sm">
            <p className="font-semibold">{target.fullName}</p>
            <p className="text-slate-600">Turno {target.shiftName} · {target.date.split("-").reverse().join("/")} · Estado actual: {STATUS_LABELS[target.currentStatus] ?? target.currentStatus}</p>
          </div>
          <Field label="Nuevo estado">
            <select className={inputClass} value={type} onChange={(e) => setType(e.target.value)}>
              {TYPES.map((t) => <option key={t} value={t}>{STATUS_LABELS[t]}</option>)}
            </select>
          </Field>
          <Field label="Motivo (obligatorio)" hint="Queda registrado en el historial de auditoría con tu usuario, fecha y hora.">
            <textarea className={inputClass} rows={3} maxLength={500} value={reason} onChange={(e) => setReason(e.target.value)}
              placeholder="Ej. Avisó por teléfono que está enfermo" />
          </Field>
          {error && <Alert>{error}</Alert>}
        </div>
      )}
    </Modal>
  );
}

export function RevokeModal({ incidentId, label, onClose, onSaved }: { incidentId: number | null; label: string; onClose: () => void; onSaved: () => void }) {
  const [reason, setReason] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  useEffect(() => { setReason(""); setError(null); }, [incidentId]);

  async function save() {
    setBusy(true);
    setError(null);
    try {
      await api(`/api/admin/incidents/${incidentId}/revoke`, { method: "POST", json: { reason } });
      onSaved();
      onClose();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal open={incidentId != null} title="Retirar incidencia" onClose={onClose}
      footer={<>
        <Button variant="secondary" onClick={onClose}>Cancelar</Button>
        <Button variant="danger" onClick={save} loading={busy} disabled={reason.trim().length < 3}>Retirar</Button>
      </>}>
      <div className="space-y-4">
        <p className="text-sm text-slate-700">{label}</p>
        <Field label="Motivo (obligatorio)">
          <textarea className={inputClass} rows={3} value={reason} onChange={(e) => setReason(e.target.value)} />
        </Field>
        {error && <Alert>{error}</Alert>}
      </div>
    </Modal>
  );
}
