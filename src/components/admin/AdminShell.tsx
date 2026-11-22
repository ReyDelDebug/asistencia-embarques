"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { createContext, useContext, type ReactNode } from "react";
import { api, cx } from "../ui";

export interface PanelUser {
  id: number;
  username: string;
  displayName: string;
  role: "ADMIN" | "SUPERVISOR";
}

const UserContext = createContext<PanelUser | null>(null);
export const usePanelUser = () => useContext(UserContext)!;

const NAV = [
  { href: "/admin", label: "Panel" },
  { href: "/admin/rol", label: "Rol de turno" },
  { href: "/admin/solicitudes", label: "Vacaciones y PSG" },
  { href: "/admin/reporte", label: "Reporte WhatsApp" },
  { href: "/admin/exportar", label: "Excel" },
  { href: "/admin/empleados", label: "Empleados" },
  { href: "/admin/auditoria", label: "Auditoría" },
  { href: "/admin/usuarios", label: "Usuarios", adminOnly: true },
  { href: "/admin/cuenta", label: "Mi cuenta" },
];

export default function AdminShell({ user, children }: { user: PanelUser; children: ReactNode }) {
  const pathname = usePathname();
  const router = useRouter();

  async function logout() {
    await api("/api/auth/admin/logout", { method: "POST" }).catch(() => undefined);
    router.replace("/admin/login");
    router.refresh();
  }

  return (
    <UserContext.Provider value={user}>
      <div className="min-h-dvh">
        <header className="sticky top-0 z-40 bg-slate-900 text-white shadow">
          <div className="mx-auto flex max-w-7xl items-center justify-between gap-4 px-4 py-2.5">
            <div className="flex items-center gap-3">
              <div className="flex h-8 w-8 items-center justify-center rounded bg-white text-xs font-bold text-slate-900">CA</div>
              <div className="leading-tight">
                <p className="text-sm font-semibold">Control de Asistencia</p>
                <p className="text-xs text-slate-400">Embarques · Panel de supervisión</p>
              </div>
            </div>
            <div className="flex items-center gap-3">
              <span className="hidden text-right text-xs leading-tight sm:block">
                <span className="block font-semibold">{user.displayName}</span>
                <span className="text-slate-400">{user.role === "ADMIN" ? "Administrador" : "Supervisor"}</span>
              </span>
              <button onClick={logout} className="rounded-md border border-slate-600 px-3 py-1.5 text-xs font-semibold hover:bg-slate-800">
                Cerrar sesión
              </button>
            </div>
          </div>
          <nav className="mx-auto max-w-7xl overflow-x-auto px-2">
            <ul className="flex gap-1 whitespace-nowrap">
              {NAV.filter((n) => !n.adminOnly || user.role === "ADMIN").map((n) => {
                const active = n.href === "/admin" ? pathname === "/admin" : pathname.startsWith(n.href);
                return (
                  <li key={n.href}>
                    <Link
                      href={n.href}
                      className={cx(
                        "inline-block border-b-2 px-3 py-2 text-sm font-medium",
                        active ? "border-white text-white" : "border-transparent text-slate-400 hover:text-white",
                      )}
                    >
                      {n.label}
                    </Link>
                  </li>
                );
              })}
            </ul>
          </nav>
        </header>
        <main className="mx-auto max-w-7xl px-4 py-5">{children}</main>
      </div>
    </UserContext.Provider>
  );
}
