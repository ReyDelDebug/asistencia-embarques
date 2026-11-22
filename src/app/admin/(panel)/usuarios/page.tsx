"use client";

import { useCallback, useEffect, useState } from "react";
import { usePanelUser } from "@/components/admin/AdminShell";
import { Alert, api, Badge, Button, Card, CardHeader, Field, inputClass, Modal } from "@/components/ui";

interface U { id: number; username: string; display_name: string; role: string; active: boolean; employee_name: string | null; employee_number: string | null }
interface E { id: number; full_name: string; employee_number: string; role: string; active: boolean; panel_username: string | null }

export default function UsersPage() {
  const me = usePanelUser();
  const [users, setUsers] = useState<U[]>([]);
  const [emps, setEmps] = useState<E[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [form, setForm] = useState<{ username: string; displayName: string; role: string; employeeId: string } | null>(null);
  const [secret, setSecret] = useState<{ username: string; password: string } | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    try {
      const [u, e] = await Promise.all([api<{ users: U[] }>("/api/admin/users"), api<{ employees: E[] }>("/api/admin/employees")]);
      setUsers(u.users);
      setEmps(e.employees);
    } catch (err) {
      setError((err as Error).message);
    }
  }, []);
  useEffect(() => { load(); }, [load]);

  if (me.role !== "ADMIN") return <Alert>Solo un administrador puede gestionar usuarios del panel.</Alert>;

  async function create() {
    if (!form) return;
    setBusy(true);
    setError(null);
    try {
      const r = await api<{ username: string; password: string }>("/api/admin/users", {
        method: "POST", json: { ...form, employeeId: form.employeeId ? Number(form.employeeId) : null },
      });
      setForm(null);
      setSecret(r);
      load();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  async function reset(u: U) {
    try {
      const r = await api<{ username: string; password: string }>(`/api/admin/users/${u.id}/reset-password`, { method: "POST" });
      setSecret(r);
    } catch (e) { setError((e as Error).message); }
  }

  async function toggle(u: U) {
    try {
      await api(`/api/admin/users/${u.id}/active`, { method: "POST", json: { active: !u.active } });
      load();
    } catch (e) { setError((e as Error).message); }
  }

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-xl font-bold text-slate-900">Usuarios del panel</h1>
          <p className="text-sm text-slate-500">Supervisores con acceso al panel administrativo</p>
        </div>
        <Button onClick={() => setForm({ username: "", displayName: "", role: "SUPERVISOR", employeeId: "" })}>+ Crear supervisor</Button>
      </div>
      <Alert kind="info">
        Para registrar al supervisor o líder de noche: primero agrégalo en <b>Empleados</b> (puesto Supervisor o Líder, turno Noche) y después crea aquí su usuario del panel vinculándolo.
      </Alert>
      {error && <Alert>{error}</Alert>}
      <Card>
        <CardHeader title="Usuarios" />
        <div className="overflow-x-auto">
          <table className="min-w-full divide-y divide-slate-200 text-sm">
            <thead className="bg-slate-50 text-left text-xs font-semibold uppercase tracking-wide text-slate-600">
              <tr><th className="px-4 py-2.5">Usuario</th><th className="px-4 py-2.5">Nombre</th><th className="px-4 py-2.5">Rol</th><th className="px-4 py-2.5">Empleado vinculado</th><th className="px-4 py-2.5">Estado</th><th className="px-4 py-2.5 text-right">Acciones</th></tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {users.map((u) => (
                <tr key={u.id}>
                  <td className="px-4 py-2.5 font-mono">{u.username}</td>
                  <td className="px-4 py-2.5">{u.display_name}</td>
                  <td className="px-4 py-2.5">{u.role === "ADMIN" ? "Administrador" : "Supervisor"}</td>
                  <td className="px-4 py-2.5">{u.employee_name ? `${u.employee_name} (#${u.employee_number})` : "—"}</td>
                  <td className="px-4 py-2.5">{u.active ? <Badge className="bg-emerald-50 text-emerald-800 ring-emerald-600/20">Activo</Badge> : <Badge className="bg-slate-100 ring-slate-400/20">Inactivo</Badge>}</td>
                  <td className="px-4 py-2.5 text-right">
                    <div className="flex justify-end gap-1">
                      <Button variant="secondary" className="px-2 py-1 text-xs" onClick={() => reset(u)}>Restablecer contraseña</Button>
                      {u.id !== me.id && <Button variant="ghost" className="px-2 py-1 text-xs" onClick={() => toggle(u)}>{u.active ? "Desactivar" : "Activar"}</Button>}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>

      <Modal open={!!form} title="Crear usuario del panel" onClose={() => setForm(null)}
        footer={<><Button variant="secondary" onClick={() => setForm(null)}>Cancelar</Button><Button onClick={create} loading={busy}>Crear</Button></>}>
        {form && (
          <div className="space-y-3">
            <Field label="Usuario (para iniciar sesión)"><input className={inputClass} autoCapitalize="none" value={form.username} onChange={(e) => setForm({ ...form, username: e.target.value.toLowerCase() })} /></Field>
            <Field label="Nombre para mostrar"><input className={inputClass} value={form.displayName} onChange={(e) => setForm({ ...form, displayName: e.target.value })} /></Field>
            <Field label="Rol">
              <select className={inputClass} value={form.role} onChange={(e) => setForm({ ...form, role: e.target.value })}>
                <option value="SUPERVISOR">Supervisor</option><option value="ADMIN">Administrador</option>
              </select>
            </Field>
            <Field label="Empleado vinculado (opcional)">
              <select className={inputClass} value={form.employeeId} onChange={(e) => setForm({ ...form, employeeId: e.target.value })}>
                <option value="">— Ninguno —</option>
                {emps.filter((e) => e.active && !e.panel_username).map((e) => <option key={e.id} value={e.id}>{e.full_name} (#{e.employee_number})</option>)}
              </select>
            </Field>
            <p className="text-xs text-slate-500">Se generará una contraseña aleatoria que se mostrará una sola vez.</p>
          </div>
        )}
      </Modal>

      <Modal open={!!secret} title="Credenciales" onClose={() => setSecret(null)} footer={<Button onClick={() => setSecret(null)}>Listo</Button>}>
        {secret && (
          <div className="space-y-3">
            <Alert kind="warning">Entrega esta contraseña de forma privada. No se volverá a mostrar; el usuario puede cambiarla en “Mi cuenta”.</Alert>
            <div className="rounded-md border border-slate-200 p-3 text-sm">
              <p>Usuario: <b className="font-mono">{secret.username}</b></p>
              <p>Contraseña: <b className="font-mono text-base">{secret.password}</b></p>
            </div>
          </div>
        )}
      </Modal>
    </div>
  );
}
