"use client";

import { useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { Alert, api, Button, Field, inputClass } from "@/components/ui";

export default function AdminLoginPage() {
  const router = useRouter();
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
      router.replace("/admin");
      router.refresh();
    } catch (err) {
      setError((err as Error).message);
      setBusy(false);
    }
  }

  return (
    <main className="flex min-h-dvh items-center justify-center px-4">
      <div className="w-full max-w-sm">
        <div className="mb-6 text-center">
          <div className="mx-auto mb-3 flex h-12 w-12 items-center justify-center rounded-lg bg-slate-900 text-lg font-bold text-white">CA</div>
          <h1 className="text-lg font-bold text-slate-900">Panel de supervisión</h1>
          <p className="text-sm text-slate-500">Control de Asistencia · Embarques</p>
        </div>
        <form onSubmit={onSubmit} className="space-y-4 rounded-lg border border-slate-200 bg-white p-5 shadow-sm">
          <Field label="Usuario">
            <input className={inputClass} autoComplete="username" autoCapitalize="none" required value={username}
              onChange={(e) => setUsername(e.target.value)} />
          </Field>
          <Field label="Contraseña">
            <input className={inputClass} type="password" autoComplete="current-password" required value={password}
              onChange={(e) => setPassword(e.target.value)} />
          </Field>
          {error && <Alert>{error}</Alert>}
          <Button type="submit" loading={busy} className="w-full py-2.5">Iniciar sesión</Button>
        </form>
        <p className="mt-4 text-center text-xs text-slate-400">Acceso exclusivo para supervisores.</p>
      </div>
    </main>
  );
}
