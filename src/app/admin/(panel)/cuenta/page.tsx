"use client";

import { useState, type FormEvent } from "react";
import { usePanelUser } from "@/components/admin/AdminShell";
import { Alert, api, Button, Card, CardHeader, Field, inputClass } from "@/components/ui";

export default function AccountPage() {
  const me = usePanelUser();
  const [current, setCurrent] = useState("");
  const [next, setNext] = useState("");
  const [repeat, setRepeat] = useState("");
  const [msg, setMsg] = useState<{ kind: "success" | "error"; text: string } | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (next !== repeat) { setMsg({ kind: "error", text: "Las contraseñas nuevas no coinciden." }); return; }
    setBusy(true);
    setMsg(null);
    try {
      await api("/api/admin/me/password", { method: "POST", json: { currentPassword: current, newPassword: next } });
      setMsg({ kind: "success", text: "Contraseña actualizada." });
      setCurrent(""); setNext(""); setRepeat("");
    } catch (err) {
      setMsg({ kind: "error", text: (err as Error).message });
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="mx-auto max-w-md space-y-5">
      <h1 className="text-xl font-bold text-slate-900">Mi cuenta</h1>
      <Card>
        <CardHeader title={me.displayName} subtitle={`Usuario: ${me.username}`} />
        <form onSubmit={submit} className="space-y-3 p-4">
          <Field label="Contraseña actual"><input type="password" className={inputClass} autoComplete="current-password" value={current} onChange={(e) => setCurrent(e.target.value)} required /></Field>
          <Field label="Nueva contraseña" hint="Mínimo 10 caracteres, con letras y números."><input type="password" className={inputClass} autoComplete="new-password" value={next} onChange={(e) => setNext(e.target.value)} required /></Field>
          <Field label="Repite la nueva contraseña"><input type="password" className={inputClass} autoComplete="new-password" value={repeat} onChange={(e) => setRepeat(e.target.value)} required /></Field>
          {msg && <Alert kind={msg.kind}>{msg.text}</Alert>}
          <Button type="submit" loading={busy} className="w-full">Cambiar contraseña</Button>
        </form>
      </Card>
    </div>
  );
}
