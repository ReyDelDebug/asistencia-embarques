"use client";

import { useState, type FormEvent } from "react";
import { Alert, api, Button, inputClass } from "./ui";

export default function AdminLoginInline() {
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await api("/api/auth/admin/login", { method: "POST", json: { username, password } });
      window.location.href = "/admin";
    } catch (err) {
      setError((err as Error).message);
      setBusy(false);
    }
  }

  return (
    <form onSubmit={onSubmit} className="space-y-4 rounded-2xl border border-line bg-white p-5 shadow-sm">
      <div>
        <label htmlFor="adm-user" className="mb-1 block text-sm font-semibold text-slate-700">Usuario</label>
        <input id="adm-user" className={`${inputClass} py-3`} autoComplete="username" autoCapitalize="none" required
          value={username} onChange={(e) => setUsername(e.target.value)} />
      </div>
      <div>
        <label htmlFor="adm-pass" className="mb-1 block text-sm font-semibold text-slate-700">Contraseña</label>
        <input id="adm-pass" type="password" className={`${inputClass} py-3`} autoComplete="current-password" required
          value={password} onChange={(e) => setPassword(e.target.value)} />
      </div>
      {error && <Alert>{error}</Alert>}
      <Button variant="brand" type="submit" loading={busy} className="w-full py-3.5 text-base">ENTRAR AL PANEL</Button>
      <p className="text-center text-xs text-slate-500">Acceso exclusivo para supervisores.</p>
    </form>
  );
}
