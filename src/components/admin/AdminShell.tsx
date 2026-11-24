"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { createContext, useContext, useEffect, useState, type ReactNode } from "react";
import { api, cx } from "../ui";

export interface PanelUser {
  id: number;
  username: string;
  displayName: string;
  role: "ADMIN" | "SUPERVISOR";
  employeeId?: number | null;
}

const UserContext = createContext<PanelUser | null>(null);
export const usePanelUser = () => useContext(UserContext)!;

/** Íconos de línea (24×24) dibujados a mano. */
const ICONS: Record<string, ReactNode> = {
  panel: <path d="M3 13h8V3H3v10zm0 8h8v-6H3v6zm10 0h8V11h-8v10zm0-18v6h8V3h-8z" />,
  rol: <><path d="M12 3v2M12 19v2M4.2 4.2l1.4 1.4M18.4 18.4l1.4 1.4M3 12h2M19 12h2" /><circle cx="12" cy="12" r="4" /></>,
  vac: <><path d="M12 3c-4 3-6 6-6 9a6 6 0 0 0 12 0c0-3-2-6-6-9z" /><path d="M12 13v8" /></>,
  cal: <><rect x="3" y="5" width="18" height="16" rx="2" /><path d="M3 10h18M8 3v4M16 3v4" /><path d="M8 14h2M14 14h2M8 17h2" /></>,
  rep: <path d="M4 5h16v11H8l-4 4V5z" />,
  xls: <><path d="M6 3h9l5 5v13H6z" /><path d="M9 13l4 5M13 13l-4 5" /></>,
  emp: <><circle cx="9" cy="8" r="3.5" /><path d="M2.5 20c.8-3.5 3.4-5.5 6.5-5.5s5.7 2 6.5 5.5" /><circle cx="17" cy="9" r="2.5" /><path d="M17 14c2.3 0 4 1.5 4.5 4" /></>,
  aud: <><path d="M12 3l8 3v6c0 4.5-3.4 8.2-8 9-4.6-.8-8-4.5-8-9V6z" /><path d="M9 12l2 2 4-4" /></>,
  usr: <><circle cx="12" cy="8" r="4" /><path d="M4 21c1-4 4.2-6 8-6s7 2 8 6" /></>,
  cta: <><circle cx="12" cy="12" r="3" /><path d="M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z" /></>,
};

export function Icon({ name, className }: { name: keyof typeof ICONS | string; className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round"
      className={cx("h-5 w-5 shrink-0", className)} aria-hidden="true">
      {ICONS[name]}
    </svg>
  );
}

const NAV = [
  { href: "/admin", label: "Panel", icon: "panel" },
  { href: "/admin/rol", label: "Rol de turno", icon: "rol" },
  { href: "/admin/calendario", label: "Calendario laboral", icon: "cal" },
  { href: "/admin/solicitudes", label: "Vacaciones y PSG", icon: "vac" },
  { href: "/admin/reporte", label: "Reporte WhatsApp", icon: "rep" },
  { href: "/admin/exportar", label: "Excel", icon: "xls" },
  { href: "/admin/empleados", label: "Empleados", icon: "emp" },
  { href: "/admin/auditoria", label: "Auditoría", icon: "aud" },
  { href: "/admin/usuarios", label: "Usuarios", icon: "usr", adminOnly: true },
  { href: "/admin/cuenta", label: "Mi cuenta", icon: "cta" },
];

export default function AdminShell({ user, children }: { user: PanelUser; children: ReactNode }) {
  const pathname = usePathname();
  const router = useRouter();
  const [open, setOpen] = useState(false);

  useEffect(() => { setOpen(false); }, [pathname]);

  async function logout() {
    await api("/api/auth/admin/logout", { method: "POST" }).catch(() => undefined);
    router.replace("/");
    router.refresh();
  }

  const initials = user.displayName.replace(/\(.*?\)/g, "").replace(/[^A-Za-zÁÉÍÓÚÜÑáéíóúüñ ]/g, "")
    .split(/\s+/).filter(Boolean).slice(0, 2).map((w) => w[0]).join("").toUpperCase() || "CA";
  const nav = (
    <nav className="flex-1 space-y-0.5 px-3 py-4" aria-label="Menú principal">
      {NAV.filter((n) => !n.adminOnly || user.role === "ADMIN").map((n) => {
        const active = n.href === "/admin" ? pathname === "/admin" : pathname.startsWith(n.href);
        return (
          <Link key={n.href} href={n.href}
            className={cx(
              "flex items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium transition-colors",
              active ? "bg-white/10 text-white shadow-inner" : "text-slate-400 hover:bg-white/5 hover:text-white",
            )}>
            <Icon name={n.icon} className={active ? "text-emerald-400" : ""} />
            {n.label}
          </Link>
        );
      })}
    </nav>
  );

  const sidebar = (
    <div className="flex h-full flex-col bg-gradient-to-b from-slate-900 to-slate-950 text-white">
      <div className="flex items-center gap-3 border-b border-white/10 px-5 py-4">
        <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-emerald-500 text-sm font-bold text-slate-950">CA</div>
        <div className="leading-tight">
          <p className="text-sm font-semibold">Control de Asistencia</p>
          <p className="text-xs text-slate-400">Embarques</p>
        </div>
      </div>
      {nav}
      <div className="border-t border-white/10 p-4">
        <div className="flex items-center gap-3">
          <span className="flex h-9 w-9 items-center justify-center rounded-full bg-slate-700 text-xs font-semibold">{initials}</span>
          <div className="min-w-0 leading-tight">
            <p className="truncate text-sm font-semibold">{user.displayName}</p>
            <p className="text-xs text-slate-400">{user.role === "ADMIN" ? "Administrador" : "Supervisor"}</p>
          </div>
        </div>
        <button onClick={logout} className="mt-3 w-full rounded-lg border border-white/15 px-3 py-2 text-xs font-semibold text-slate-200 hover:bg-white/10">
          Cerrar sesión
        </button>
      </div>
    </div>
  );

  return (
    <UserContext.Provider value={user}>
      <div className="min-h-dvh bg-slate-50">
        <aside className="fixed inset-y-0 left-0 z-40 hidden w-64 lg:block">{sidebar}</aside>

        {/* Móvil: barra superior + menú desplegable */}
        <header className="sticky top-0 z-30 flex items-center justify-between bg-slate-900 px-4 py-3 text-white lg:hidden">
          <button onClick={() => setOpen(true)} aria-label="Abrir menú" className="rounded-md p-1.5 hover:bg-white/10">
            <svg viewBox="0 0 24 24" className="h-6 w-6" fill="none" stroke="currentColor" strokeWidth={2}><path d="M4 6h16M4 12h16M4 18h16" /></svg>
          </button>
          <p className="text-sm font-semibold">Control de Asistencia</p>
          <span className="flex h-8 w-8 items-center justify-center rounded-full bg-emerald-500 text-xs font-bold text-slate-950">{initials}</span>
        </header>
        {open && (
          <div className="fixed inset-0 z-50 lg:hidden">
            <div className="absolute inset-0 bg-slate-950/60" onClick={() => setOpen(false)} />
            <div className="absolute inset-y-0 left-0 w-72 shadow-2xl">{sidebar}</div>
          </div>
        )}

        <main className="px-4 py-6 lg:ml-64 lg:px-8">
          <div className="mx-auto max-w-7xl">{children}</div>
        </main>
      </div>
    </UserContext.Provider>
  );
}
