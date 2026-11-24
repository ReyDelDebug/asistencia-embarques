"use client";

import { useEffect, type ButtonHTMLAttributes, type ReactNode } from "react";

export class ApiError extends Error {
  constructor(public status: number, message: string, public data: Record<string, unknown>) {
    super(message);
  }
}

export async function api<T = unknown>(path: string, init: RequestInit & { json?: unknown } = {}): Promise<T> {
  const { json: body, ...rest } = init;
  const res = await fetch(path, {
    ...rest,
    headers: { ...(body !== undefined ? { "Content-Type": "application/json" } : {}), ...(rest.headers ?? {}) },
    body: body !== undefined ? JSON.stringify(body) : rest.body,
    cache: "no-store",
    credentials: "same-origin",
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new ApiError(res.status, data.error ?? "Error de comunicación con el servidor.", data);
  return data as T;
}

export function cx(...c: (string | false | null | undefined)[]) {
  return c.filter(Boolean).join(" ");
}

type Variant = "primary" | "secondary" | "danger" | "ghost" | "success" | "brand" | "accent" | "outline";

export function Button({
  variant = "primary", className, loading, children, ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: Variant; loading?: boolean }) {
  const styles: Record<Variant, string> = {
    primary: "bg-slate-900 text-white hover:bg-slate-800 disabled:bg-slate-400",
    secondary: "bg-white text-slate-800 border border-slate-300 hover:bg-slate-50 disabled:text-slate-400",
    danger: "bg-red-700 text-white hover:bg-red-800 disabled:bg-red-300",
    success: "bg-emerald-700 text-white hover:bg-emerald-800 disabled:bg-emerald-300",
    ghost: "text-slate-700 hover:bg-slate-100 disabled:text-slate-400",
    brand: "bg-brand text-white hover:bg-brand-dark disabled:bg-brand/40 rounded-xl",
    accent: "bg-accent text-ink hover:bg-accent-dark disabled:bg-accent/50 rounded-2xl shadow-[0_8px_20px_-8px_rgba(229,166,42,0.7)]",
    outline: "bg-white text-ink border border-line hover:bg-ground disabled:text-slate-400 rounded-xl",
  };
  return (
    <button
      {...props}
      disabled={props.disabled || loading}
      className={cx(
        "inline-flex items-center justify-center gap-2 px-3.5 py-2 text-sm font-semibold transition-colors",
        variant === "brand" || variant === "accent" || variant === "outline" ? "" : "rounded-md",
        "focus:outline-none focus-visible:ring-2 focus-visible:ring-slate-500 focus-visible:ring-offset-1 disabled:cursor-not-allowed",
        styles[variant],
        className,
      )}
    >
      {loading && <span className="h-4 w-4 animate-spin rounded-full border-2 border-current border-t-transparent" />}
      {children}
    </button>
  );
}

export function Card({ children, className }: { children: ReactNode; className?: string }) {
  return <div className={cx("rounded-xl border border-slate-200/80 bg-white shadow-sm shadow-slate-200/50", className)}>{children}</div>;
}

export function CardHeader({ title, subtitle, actions }: { title: string; subtitle?: ReactNode; actions?: ReactNode }) {
  return (
    <div className="flex flex-wrap items-start justify-between gap-3 border-b border-slate-200 px-4 py-3">
      <div>
        <h2 className="text-sm font-semibold text-slate-900">{title}</h2>
        {subtitle && <p className="mt-0.5 text-xs text-slate-500">{subtitle}</p>}
      </div>
      {actions && <div className="flex flex-wrap gap-2">{actions}</div>}
    </div>
  );
}

export const STATUS_STYLES: Record<string, string> = {
  CONFIRMADO: "bg-emerald-50 text-emerald-800 ring-emerald-600/20",
  PENDIENTE: "bg-amber-50 text-amber-800 ring-amber-600/20",
  RETARDO: "bg-orange-50 text-orange-800 ring-orange-600/30",
  DESCANSO: "bg-teal-50 text-teal-800 ring-teal-600/20",
  FALTA: "bg-red-50 text-red-800 ring-red-600/20",
  VACACIONES: "bg-sky-50 text-sky-800 ring-sky-600/20",
  INCAPACIDAD: "bg-violet-50 text-violet-800 ring-violet-600/20",
  PSG: "bg-indigo-50 text-indigo-800 ring-indigo-600/20",
  BAJA: "bg-slate-100 text-slate-700 ring-slate-500/20",
};

export const STATUS_LABELS: Record<string, string> = {
  CONFIRMADO: "Confirmado",
  PENDIENTE: "Pendiente",
  RETARDO: "Avisó retardo",
  FALTA: "Falta",
  DESCANSO: "Descanso",
  VACACIONES: "Vacaciones",
  INCAPACIDAD: "Incapacidad",
  PSG: "PSG",
  BAJA: "Baja",
};

export const ROLE_LABELS: Record<string, string> = { EMPLOYEE: "Empleado", LEADER: "Líder", SUPERVISOR: "Supervisor" };

export function Badge({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <span className={cx("inline-flex items-center rounded-md px-2 py-0.5 text-xs font-medium ring-1 ring-inset", className)}>
      {children}
    </span>
  );
}

export function StatusBadge({ status, automatic }: { status: string; automatic?: boolean }) {
  return (
    <Badge className={STATUS_STYLES[status] ?? STATUS_STYLES.BAJA}>
      {STATUS_LABELS[status] ?? status}
      {automatic && status === "FALTA" ? " (sin registro)" : ""}
    </Badge>
  );
}

export function Field({ label, children, hint }: { label: string; children: ReactNode; hint?: string }) {
  return (
    <label className="block">
      <span className="mb-1 block text-xs font-semibold uppercase tracking-wide text-slate-600">{label}</span>
      {children}
      {hint && <span className="mt-1 block text-xs text-slate-500">{hint}</span>}
    </label>
  );
}

export const inputClass =
  "block w-full rounded-md border border-slate-300 bg-white px-3 py-2 text-slate-900 shadow-sm placeholder:text-slate-400 focus:border-slate-500 focus:outline-none focus:ring-1 focus:ring-slate-500 disabled:bg-slate-100";

export function Alert({ kind = "error", children }: { kind?: "error" | "success" | "info" | "warning"; children: ReactNode }) {
  const styles = {
    error: "border-red-200 bg-red-50 text-red-800",
    success: "border-emerald-200 bg-emerald-50 text-emerald-800",
    info: "border-slate-200 bg-slate-50 text-slate-700",
    warning: "border-amber-200 bg-amber-50 text-amber-800",
  };
  return <div role="alert" className={cx("rounded-md border px-3 py-2 text-sm", styles[kind])}>{children}</div>;
}

export function Modal({
  open, title, onClose, children, footer, wide,
}: { open: boolean; title: string; onClose: () => void; children: ReactNode; footer?: ReactNode; wide?: boolean }) {
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);
  if (!open) return null;
  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-slate-900/50 p-0 sm:items-center sm:p-4" onMouseDown={onClose}>
      <div
        role="dialog"
        aria-modal="true"
        aria-label={title}
        className={cx("max-h-[92vh] w-full overflow-y-auto rounded-t-xl bg-white shadow-xl sm:rounded-xl", wide ? "sm:max-w-3xl" : "sm:max-w-md")}
        onMouseDown={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between border-b border-slate-200 px-4 py-3">
          <h3 className="text-base font-semibold text-slate-900">{title}</h3>
          <button onClick={onClose} className="rounded p-1 text-slate-500 hover:bg-slate-100" aria-label="Cerrar">✕</button>
        </div>
        <div className="px-4 py-4">{children}</div>
        {footer && <div className="flex justify-end gap-2 border-t border-slate-200 bg-slate-50 px-4 py-3">{footer}</div>}
      </div>
    </div>
  );
}

export function StatCard({
  label, value, hint, tone = "slate", icon,
}: { label: string; value: ReactNode; hint?: string; tone?: "slate" | "green" | "amber" | "red" | "blue"; icon?: ReactNode }) {
  const tones = {
    slate: { text: "text-slate-900", bg: "bg-slate-100 text-slate-600", bar: "from-slate-400 to-slate-300" },
    green: { text: "text-emerald-700", bg: "bg-emerald-100 text-emerald-700", bar: "from-emerald-500 to-emerald-300" },
    amber: { text: "text-amber-700", bg: "bg-amber-100 text-amber-700", bar: "from-amber-500 to-amber-300" },
    red: { text: "text-red-700", bg: "bg-red-100 text-red-700", bar: "from-red-500 to-red-300" },
    blue: { text: "text-sky-700", bg: "bg-sky-100 text-sky-700", bar: "from-sky-500 to-sky-300" },
  }[tone];
  return (
    <Card className="relative overflow-hidden px-4 py-4">
      <div className={cx("absolute inset-x-0 top-0 h-1 bg-gradient-to-r", tones.bar)} />
      <div className="flex items-start justify-between gap-2">
        <div>
          <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">{label}</p>
          <p className={cx("mt-1 text-3xl font-bold tabular", tones.text)}>{value}</p>
          {hint && <p className="mt-0.5 text-xs text-slate-500">{hint}</p>}
        </div>
        {icon && <span className={cx("flex h-10 w-10 items-center justify-center rounded-xl", tones.bg)}>{icon}</span>}
      </div>
    </Card>
  );
}

/** Hora local de Ciudad de México de un ISO, HH:MM:SS */
export function timeMx(iso: string | null | undefined): string {
  if (!iso) return "—";
  return new Intl.DateTimeFormat("es-MX", {
    timeZone: "America/Mexico_City", hour: "2-digit", minute: "2-digit", second: "2-digit", hourCycle: "h23",
  }).format(new Date(iso));
}

export function dateTimeMx(iso: string | Date | null | undefined): string {
  if (!iso) return "—";
  return new Intl.DateTimeFormat("es-MX", {
    timeZone: "America/Mexico_City", day: "2-digit", month: "2-digit", year: "numeric",
    hour: "2-digit", minute: "2-digit", second: "2-digit", hourCycle: "h23",
  }).format(new Date(iso));
}

/** '2026-11-23' -> '23/11/2026' */
export function dateShort(d: string): string {
  const [y, m, day] = d.split("-");
  return `${day}/${m}/${y}`;
}

/** '05:00:00' -> '05:00 a. m.' */
export function time12(t: string, withSeconds = false): string {
  const [h, m, s] = t.split(":").map(Number);
  const suffix = h < 12 ? "a. m." : "p. m.";
  const h12 = h % 12 === 0 ? 12 : h % 12;
  const base = `${String(h12).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
  return `${withSeconds ? `${base}:${String(s || 0).padStart(2, "0")}` : base} ${suffix}`;
}

/** Fecha larga en español de una fecha 'YYYY-MM-DD'. */
export function dateLong(d: string): string {
  const [y, m, day] = d.split("-").map(Number);
  const t = new Intl.DateTimeFormat("es-MX", { weekday: "long", day: "numeric", month: "long", year: "numeric", timeZone: "UTC" })
    .format(new Date(Date.UTC(y, m - 1, day, 12)));
  return t.charAt(0).toUpperCase() + t.slice(1);
}

/** Foto de perfil con respaldo de iniciales. */
export function Avatar({
  employeeId, name, version, size = 40, className,
}: { employeeId: number; name: string; version: string | null | undefined; size?: number; className?: string }) {
  const initials = name.split(/\s+/).filter(Boolean).slice(0, 2).map((w) => w[0]).join("").toUpperCase();
  const style = { width: size, height: size, fontSize: Math.max(11, Math.round(size * 0.38)) };
  if (version) {
    return (
      // eslint-disable-next-line @next/next/no-img-element
      <img src={`/api/photos/${employeeId}?v=${version}`} alt={name} style={style}
        className={cx("shrink-0 rounded-full object-cover ring-1 ring-slate-200", className)} />
    );
  }
  return (
    <span style={style} aria-label={name}
      className={cx("inline-flex shrink-0 items-center justify-center rounded-full bg-slate-200 font-semibold text-slate-600", className)}>
      {initials}
    </span>
  );
}
