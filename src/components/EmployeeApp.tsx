"use client";

import { useCallback, useEffect, useState, type FormEvent } from "react";
import { Alert, api, ApiError, Avatar, Badge, Button, cx, dateLong, dateShort, time12, timeMx } from "./ui";
import GroupTab from "./employee/GroupTab";
import ProfileTab from "./employee/ProfileTab";
import LateNoticeForm from "./employee/LateNoticeForm";
import NotificationsCard from "./employee/NotificationsCard";
import AdminLoginInline from "./AdminLoginInline";
import { VacationCard } from "./employee/MyDataForm";
import { useServerClock } from "./useServerClock";

interface View {
  employee: { id: number; fullName: string; employeeNumber: string; role: string; departmentName: string | null; subareaName: string | null };
  localDate: string;
  shift: { code: string; name: string; openTime: string; closeTime: string; lastAllowed: string; extensionClose: string; lateLastAllowed: string };
  operationalDate: string;
  windowState: "BEFORE" | "OPEN" | "CLOSED";
  baseWindowState: "BEFORE" | "OPEN" | "CLOSED";
  registration: { mode: "NORMAL" | "EXTENSION" | "LATE_NOTICE" | null; lastAllowed: string | null };
  extension: { closeTime: string; grantedBy: string } | null;
  lateNotice: { eta: string; reason: string } | null;
  canNotifyLate: boolean;
  existing: { operationalDate: string; confirmedAt: string; via: "NORMAL" | "EXTENSION" | "LATE_NOTICE" } | null;
  nextChange: { date: string; shiftCode: string; shiftName: string } | null;
  photoVersion: string | null;
  profileMissing: string[];
  placement: { departmentName: string | null; subareaName: string | null; support: boolean; until: string | null; homeDepartmentName: string | null };
  day: { type: string; label: string; works: boolean; overtime: boolean; hours: string | null };
  tomorrow: { date: string; type: string; label: string; works: boolean; hours: string | null };
}

interface LeaveReq {
  id: number; type: string; startDate: string; endDate: string; days: number; reason: string;
  status: "PENDIENTE" | "APROBADA" | "RECHAZADA" | "CANCELADA"; decisionNote: string | null;
}

type Screen = "loading" | "number" | "pin" | "setup" | "main" | "success" | "leave";

const LEAVE_STATUS: Record<string, string> = {
  PENDIENTE: "bg-amber-50 text-amber-800 ring-amber-600/20",
  APROBADA: "bg-emerald-50 text-emerald-800 ring-emerald-600/20",
  RECHAZADA: "bg-red-50 text-red-800 ring-red-600/20",
  CANCELADA: "bg-slate-100 text-slate-600 ring-slate-400/20",
};

function areaLabel(v: View) {
  if (v.employee.role === "SUPERVISOR") return "Supervisión";
  const p = v.placement;
  return `${p.departmentName ?? "—"}${p.subareaName ? ` · ${p.subareaName}` : ""}`;
}

function headerDate(iso: string) {
  const t = new Intl.DateTimeFormat("es-MX", { timeZone: "UTC", weekday: "short", day: "numeric", month: "short" }).format(new Date(`${iso}T12:00:00Z`));
  return t.replace(/\./g, "");
}

function todayMx() {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "America/Mexico_City" }).format(new Date());
}

export default function EmployeeApp() {
  const clock = useServerClock();
  const [screen, setScreen] = useState<Screen>("loading");
  const [view, setView] = useState<View | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [employeeNumber, setEmployeeNumber] = useState("");
  const [firstName, setFirstName] = useState("");
  const [pin, setPin] = useState("");
  const [pin2, setPin2] = useState("");
  const [justRegistered, setJustRegistered] = useState(false);
  const [tab, setTab] = useState<"asistencia" | "grupo" | "perfil">("asistencia");
  const [showLateForm, setShowLateForm] = useState(false);
  const [loginAs, setLoginAs] = useState<"empleado" | "admin">("empleado");

  const loadView = useCallback(async () => {
    try {
      const v = await api<View>("/api/attendance");
      setView(v);
      setScreen((s) => (s === "leave" ? s : v.existing ? "success" : "main"));
    } catch (e) {
      if (e instanceof ApiError && e.status === 401) setScreen("number");
      else { setError((e as Error).message); setScreen("number"); }
    }
  }, []);

  useEffect(() => { loadView(); }, [loadView]);

  useEffect(() => {
    if (screen !== "main") return;
    const t = setInterval(loadView, 30_000);
    return () => clearInterval(t);
  }, [screen, loadView]);

  async function onIdentify(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setBusy(true);
    try {
      const r = await api<{ status: "PIN" | "SETUP"; firstName: string }>("/api/auth/employee/identify", {
        method: "POST", json: { employeeNumber: employeeNumber.trim() },
      });
      setFirstName(r.firstName);
      setPin(""); setPin2("");
      setScreen(r.status === "PIN" ? "pin" : "setup");
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  async function onLogin(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setBusy(true);
    try {
      await api("/api/auth/employee/login", { method: "POST", json: { employeeNumber: employeeNumber.trim(), pin } });
      setPin("");
      await loadView();
    } catch (err) {
      if (err instanceof ApiError && err.data.code === "PIN_SETUP_REQUIRED") { setScreen("setup"); setPin(""); return; }
      const data = err instanceof ApiError ? err.data : {};
      const left = typeof data.attemptsLeft === "number" ? ` Te quedan ${data.attemptsLeft} intento(s).` : "";
      setError((err as Error).message + left);
    } finally {
      setBusy(false);
    }
  }

  async function onSetup(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setBusy(true);
    try {
      await api("/api/auth/employee/setup-pin", { method: "POST", json: { employeeNumber: employeeNumber.trim(), pin, pinConfirm: pin2 } });
      setPin(""); setPin2("");
      await loadView();
    } catch (err) {
      if (err instanceof ApiError && err.data.code === "PIN_ALREADY_SET") setScreen("pin");
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  async function onConfirm() {
    setError(null);
    setBusy(true);
    try {
      await api("/api/attendance", { method: "POST" });
      setJustRegistered(true);
      await loadView();
    } catch (err) {
      if (err instanceof ApiError && (err.status === 409 || err.status === 403)) {
        await loadView();
        if (err.status === 403) setError(err.message);
      } else if (err instanceof ApiError && err.status === 401) {
        setScreen("number");
        setError(err.message);
      } else {
        setError((err as Error).message);
      }
    } finally {
      setBusy(false);
    }
  }

  async function onLogout() {
    await api("/api/auth/employee/logout", { method: "POST" }).catch(() => undefined);
    setView(null);
    setJustRegistered(false);
    setEmployeeNumber("");
    setError(null);
    setTab("asistencia");
    setScreen("number");
  }

  const pinInput = (id: string, value: string, set: (v: string) => void, label: string, autoComplete: string) => (
    <div>
      <label htmlFor={id} className="mb-1.5 block text-sm font-semibold text-muted">{label}</label>
      <input
        id={id} type="password" inputMode="numeric" pattern="[0-9]*" autoComplete={autoComplete}
        required minLength={4} maxLength={6} value={value}
        onChange={(e) => set(e.target.value.replace(/\D/g, ""))}
        className={`${fieldClass} text-center text-xl tracking-[0.5em]`} placeholder="••••••"
      />
    </div>
  );

  const loggedIn = !!view && ["main", "success", "leave"].includes(screen);
  const firstOf = (n: string) => n.split(/\s+/)[0] ?? n;

  return (
    <main className="font-app flex min-h-dvh flex-col bg-ground text-ink">
      {!loggedIn ? (
        <header className="rounded-b-[28px] bg-brand px-5 pb-20 pt-8 text-white">
          <div className="mx-auto flex w-full max-w-md items-center gap-3">
            <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-accent font-display text-lg font-bold text-ink shadow-md">CA</div>
            <div>
              <h1 className="font-display text-xl font-bold leading-tight tracking-tight">CONTROL DE ASISTENCIA</h1>
              <p className="text-sm text-onbrand">Embarques</p>
            </div>
          </div>
        </header>
      ) : (
        <header className="rounded-b-[28px] bg-brand px-4 pb-16 pt-5 text-white">
          <div className="mx-auto w-full max-w-md">
            <div className="flex items-center gap-3">
              <div className="rounded-full bg-accent p-0.5">
                <Avatar employeeId={view!.employee.id} name={view!.employee.fullName} version={view!.photoVersion} size={46} />
              </div>
              <div className="min-w-0 flex-1">
                <p className="text-xs text-onbrand">Hola,</p>
                <p className="truncate font-display text-lg font-bold leading-tight">{view!.employee.fullName}</p>
                <p className="truncate text-xs text-onbrand">{areaLabel(view!)} · No. {view!.employee.employeeNumber}</p>
              </div>
              <div className="text-right">
                <p className="font-display text-base font-bold tabular" suppressHydrationWarning>{clock.timeText.replace(/:\d{2}(?=\s)/, "")}</p>
                <p className="text-[11px] text-onbrand" suppressHydrationWarning>{headerDate(view!.localDate)}</p>
              </div>
            </div>
            <nav className="mt-4 grid grid-cols-3 gap-1 rounded-2xl bg-white/10 p-1" aria-label="Secciones">
              {([["asistencia", "Asistencia"], ["grupo", "Mi grupo"], ["perfil", "Mi perfil"]] as const).map(([k, l]) => (
                <button key={k} onClick={() => { setTab(k); setError(null); if (k !== "asistencia" && screen === "leave") setScreen(view!.existing ? "success" : "main"); }}
                  aria-current={tab === k ? "page" : undefined}
                  className={cx("rounded-xl px-2 py-2 text-sm font-semibold transition-colors", tab === k ? "bg-white text-brand shadow-sm" : "text-onbrand hover:bg-white/10")}>
                  {l}
                </button>
              ))}
            </nav>
          </div>
        </header>
      )}

      <div className={cx("mx-auto w-full max-w-md flex-1 px-4", loggedIn ? "-mt-11" : "-mt-14")}>
        {!loggedIn && (
          <div className="mb-4 rounded-2xl bg-white px-5 py-4 text-center shadow-[0_10px_30px_-12px_rgba(14,77,100,0.35)]">
            <p className="text-sm text-muted" suppressHydrationWarning>{clock.dateText}</p>
            <p className="font-display text-4xl font-bold tabular text-brand" suppressHydrationWarning>{clock.timeText}</p>
            <p className="mt-1 text-xs text-muted">Hora oficial del servidor</p>
          </div>
        )}

        {screen === "loading" && <div className="flex justify-center py-10 text-muted">Cargando…</div>}

        {screen === "number" && (
          <div className="mb-4 grid grid-cols-2 gap-1 rounded-2xl border border-line bg-white p-1" role="tablist" aria-label="Tipo de acceso">
            {([["empleado", "Empleado"], ["admin", "Admin"]] as const).map(([k, l]) => (
              <button key={k} role="tab" aria-selected={loginAs === k} onClick={() => { setLoginAs(k); setError(null); }}
                className={cx("rounded-xl px-3 py-2.5 text-sm font-semibold transition-colors", loginAs === k ? "bg-brand text-white shadow-sm" : "text-muted hover:bg-ground")}>
                {l}
              </button>
            ))}
          </div>
        )}

        {screen === "number" && loginAs === "admin" && <AdminLoginInline />}

        {screen === "number" && loginAs === "empleado" && (
          <form onSubmit={onIdentify} className={cx(cardClass, "space-y-4 p-5")}>
            <div>
              <label htmlFor="num" className="mb-1.5 block text-sm font-semibold text-muted">Número de empleado</label>
              <input
                id="num" name="employeeNumber" inputMode="numeric" pattern="[0-9]*" autoComplete="username"
                required maxLength={10} value={employeeNumber}
                onChange={(e) => setEmployeeNumber(e.target.value.replace(/\D/g, ""))}
                className={`${fieldClass} text-lg tracking-wider`} placeholder="Tu número de empleado"
              />
            </div>
            {error && <Alert>{error}</Alert>}
            <Button type="submit" variant="brand" loading={busy} className="w-full py-3.5 text-base">CONTINUAR</Button>
          </form>
        )}

        {screen === "pin" && (
          <form onSubmit={onLogin} className={cx(cardClass, "space-y-4 p-5")}>
            <div>
              <p className="font-display text-lg font-bold text-ink">Hola, {firstName}</p>
              <p className="text-sm text-muted">Número de empleado {employeeNumber}</p>
            </div>
            {pinInput("pin", pin, setPin, "PIN", "current-password")}
            {error && <Alert>{error}</Alert>}
            <Button type="submit" variant="brand" loading={busy} className="w-full py-3.5 text-base">INGRESAR</Button>
            <button type="button" className="w-full text-sm font-semibold text-brand underline underline-offset-2"
              onClick={() => { setError(null); setScreen("number"); }}>No soy yo / cambiar número</button>
          </form>
        )}

        {screen === "setup" && (
          <form onSubmit={onSetup} className={cx(cardClass, "space-y-4 p-5")}>
            <div>
              <p className="font-display text-lg font-bold text-ink">Hola, {firstName}. Crea tu PIN</p>
              <p className="mt-1 text-sm text-muted">
                Es tu primera vez. Elige un PIN de 4 a 6 números; lo usarás junto con tu número de empleado ({employeeNumber}) cada vez que registres tu asistencia. No lo compartas con nadie.
              </p>
            </div>
            {pinInput("newpin", pin, setPin, "Nuevo PIN", "new-password")}
            {pinInput("newpin2", pin2, setPin2, "Repite tu PIN", "new-password")}
            {error && <Alert>{error}</Alert>}
            <Button type="submit" variant="brand" loading={busy} className="w-full py-3.5 text-base">GUARDAR PIN E INGRESAR</Button>
            <button type="button" className="w-full text-sm font-semibold text-brand underline underline-offset-2"
              onClick={() => { setError(null); setScreen("number"); }}>No soy yo / cambiar número</button>
          </form>
        )}

        {loggedIn && tab === "grupo" && <GroupTab />}

        {loggedIn && tab === "perfil" && (
          <>
            <ProfileTab employeeId={view!.employee.id} fullName={view!.employee.fullName} employeeNumber={view!.employee.employeeNumber}
              area={areaLabel(view!)} photoVersion={view!.photoVersion} onPhotoChanged={loadView} />
            <Button variant="ghost" onClick={onLogout} className="mt-4 w-full">Cerrar sesión</Button>
          </>
        )}

        {tab === "asistencia" && (screen === "main" || screen === "success") && view && (
          <ShiftCard view={view} />
        )}

        {tab === "asistencia" && (screen === "main" || screen === "success") && view && view.profileMissing.length > 0 && (
          <button onClick={() => setTab("perfil")}
            className="mt-3 w-full rounded-2xl border border-accent bg-[#FFF6E0] px-4 py-3 text-left text-sm text-[#6B4700]">
            <b>Completa tu perfil.</b> Te falta: {view.profileMissing.join(", ")}. Toca aquí.
          </button>
        )}

        {tab === "asistencia" && screen === "main" && view && (
          <section className="mt-4 space-y-3">
            {view.registration.mode === "EXTENSION" && view.extension && (
              <div className="rounded-2xl border border-sky-200 bg-sky-50 p-3 text-sm text-sky-900">
                <b>{view.extension.grantedBy}</b> te abrió el registro hasta las <b>{time12(view.extension.closeTime)}</b>.
              </div>
            )}
            {view.lateNotice && (
              <div className="rounded-2xl border border-orange-200 bg-orange-50 p-3 text-sm text-orange-900">
                Avisaste que llegarás tarde (~{time12(view.lateNotice.eta)}). Motivo: {view.lateNotice.reason}.
                {view.registration.mode === "LATE_NOTICE" || view.baseWindowState !== "CLOSED"
                  ? <> Cuando llegues, confirma tu asistencia (tienes hasta las {time12(view.shift.lateLastAllowed)}).</>
                  : null}
              </div>
            )}
            {view.windowState === "OPEN" ? (
              <>
                {error && <Alert>{error}</Alert>}
                <Button variant="accent" onClick={onConfirm} loading={busy} className="w-full py-5 text-lg font-bold tracking-wide">
                  {!busy && <CheckIcon className="h-6 w-6" />}
                  CONFIRMAR MI ASISTENCIA
                </Button>
                <p className="text-center text-xs text-muted">
                  La hora se toma del servidor al presionar el botón.
                  {view.registration.lastAllowed && view.registration.mode !== "NORMAL" ? ` Disponible hasta las ${time12(view.registration.lastAllowed, true)}.` : ""}
                </p>
              </>
            ) : (
              <div className="rounded-2xl border border-red-200 bg-red-50 p-5 text-center">
                <p className="text-base font-bold text-red-800">EL REGISTRO DE ASISTENCIA SE ENCUENTRA CERRADO.</p>
                <p className="mt-2 text-sm text-red-700">
                  {view.windowState === "BEFORE"
                    ? `Tu turno (${view.shift.name.toLowerCase()}) abre el registro a las ${time12(view.shift.openTime)}`
                    : `El registro de tu turno (${view.shift.name.toLowerCase()}) cerró a las ${time12(view.shift.closeTime)}`}
                </p>
                <p className="mt-1 text-xs text-red-700">Si necesitas ayuda, comunícate con tu líder o supervisor.</p>
              </div>
            )}
            {view.canNotifyLate && !showLateForm && (
              <Button variant="outline" onClick={() => setShowLateForm(true)} className="w-full py-3.5 text-base">
                <ClockIcon className="h-5 w-5 text-brand" />
                Llegaré tarde
              </Button>
            )}
            {view.canNotifyLate && showLateForm && (
              <LateNoticeForm onCancel={() => setShowLateForm(false)} onDone={() => { setShowLateForm(false); loadView(); }} />
            )}
            <p className="px-1 pt-2 text-xs font-bold uppercase tracking-wider text-muted">Accesos rápidos</p>
            <NotificationsCard />
            <LeaveRow onOpen={() => { setError(null); setScreen("leave"); }} />
            <Button variant="ghost" onClick={onLogout} className="w-full">Cerrar sesión</Button>
          </section>
        )}

        {tab === "asistencia" && screen === "success" && view?.existing && (
          <section className="mt-4 space-y-3">
            <div className={cx(cardClass, "p-6 text-center")}>
              <div className="mx-auto mb-4 flex h-20 w-20 items-center justify-center rounded-full bg-[#E3F4EA] ring-8 ring-[#E3F4EA]/50">
                <span className="flex h-14 w-14 items-center justify-center rounded-full bg-[#1E8C4E] text-white">
                  <CheckIcon className="h-8 w-8" />
                </span>
              </div>
              <p className="font-display text-2xl font-bold text-[#17663A]">¡ASISTENCIA REGISTRADA!</p>
              {!justRegistered && <p className="mt-1 text-sm text-muted">Ya habías registrado tu asistencia para este turno.</p>}
              {view.existing.via !== "NORMAL" && (
                <p className="mt-2 inline-block rounded-full bg-orange-50 px-3 py-1 text-xs font-semibold text-orange-800">
                  {view.existing.via === "EXTENSION" ? "Registrado con extensión" : "Llegada tarde (con aviso)"}
                </p>
              )}
              <div className="mt-5 rounded-2xl bg-ground px-4 py-4">
                <p className="text-xs font-semibold tracking-wide text-muted">Hora exacta</p>
                <p className="font-display text-4xl font-bold tabular text-brand">{timeMx(view.existing.confirmedAt)}</p>
              </div>
              <dl className="mt-4 space-y-2 text-left text-sm">
                <Row label="Nombre" value={view.employee.fullName} />
                <Row label="Área" value={areaLabel(view)} />
                <Row label="Turno" value={view.shift.name} />
                <Row label="Fecha" value={dateLong(view.existing.operationalDate)} />
              </dl>
            </div>
            <LeaveRow onOpen={() => { setError(null); setScreen("leave"); }} />
            <Button variant="ghost" onClick={onLogout} className="w-full">Cerrar sesión</Button>
          </section>
        )}

        {tab === "asistencia" && screen === "leave" && (
          <LeaveScreen onBack={() => { setScreen(view?.existing ? "success" : "main"); loadView(); }} />
        )}
      </div>

      <footer className="pb-5 pt-6 text-center text-xs text-muted/70">Hora oficial: servidor · Ciudad de México</footer>
    </main>
  );
}

const cardClass = "rounded-2xl border border-line bg-white shadow-[0_6px_20px_-12px_rgba(16,32,46,0.25)]";
const fieldClass =
  "block w-full rounded-xl border border-line bg-ground px-4 py-3 text-ink placeholder:text-slate-400 focus:border-brand focus:bg-white focus:outline-none focus:ring-2 focus:ring-brand/25";

function CheckIcon({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" className={className} fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <path d="M20 6 9 17l-5-5" />
    </svg>
  );
}

function ClockIcon({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" className={className} fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <circle cx="12" cy="12" r="9" /><path d="M12 7v5l3 2" />
    </svg>
  );
}

function Tile({ label, value, wide }: { label: string; value: string; wide?: boolean }) {
  return (
    <div className={cx("rounded-xl bg-ground px-3 py-2.5", wide && "col-span-2")}>
      <dt className="text-[11px] font-semibold uppercase tracking-wider text-muted">{label}</dt>
      <dd className="mt-0.5 text-sm font-semibold text-ink">{value}</dd>
    </div>
  );
}

function ShiftCard({ view }: { view: View }) {
  const chip = !view.day.works
    ? { text: "No laborable", cls: "bg-slate-100 text-muted" }
    : view.day.overtime
      ? { text: view.day.type === "VIERNES_LARGO" ? "Viernes · jornada larga" : "Viernes · tiempo extra", cls: "bg-accent/25 text-[#6B4700]" }
      : { text: "Día laborable", cls: "bg-[#E3F4EA] text-[#17663A]" };
  const tomorrow = view.tomorrow.works
    ? `Se trabaja${view.tomorrow.hours ? ` (${view.tomorrow.hours})` : ""}`
    : `No se trabaja${view.tomorrow.label ? ` (${view.tomorrow.label})` : ""}`;
  return (
    <div className={cx(cardClass, "p-5")}>
      <div className="flex items-start justify-between gap-2">
        <p className="text-xs font-bold uppercase tracking-wider text-muted">Tu turno de hoy</p>
        <span className={cx("shrink-0 rounded-full px-2.5 py-1 text-[11px] font-semibold", chip.cls)}>{chip.text}</span>
      </div>
      <p className="mt-1 font-display text-3xl font-bold text-brand">{view.shift.name.toUpperCase()}</p>
      {!view.day.works && <p className="text-sm text-muted">Hoy no se trabaja{view.day.label ? ` (${view.day.label})` : ""}</p>}
      <dl className="mt-4 grid grid-cols-2 gap-2">
        <Tile label="Registro" value={`${time12(view.shift.openTime)} – ${time12(view.shift.lastAllowed, true)}`} />
        <Tile label="Jornada" value={view.day.hours ?? "—"} />
        <Tile label="Área" value={areaLabel(view)} />
        <Tile label="Mañana" value={tomorrow} />
      </dl>
      {view.placement.support && (
        <p className="mt-3 rounded-xl bg-sky-50 px-3 py-2 text-sm text-sky-900">
          Estás en <b>apoyo en {view.placement.departmentName}</b>{view.placement.until ? ` hasta el ${dateLong(view.placement.until)}` : ""}.
        </p>
      )}
      {view.nextChange && (
        <p className="mt-3 rounded-xl bg-[#FFF6E0] px-3 py-2 text-sm text-[#6B4700]">
          A partir del {dateLong(view.nextChange.date)} tu turno será: <b>{view.nextChange.shiftName}</b>
        </p>
      )}
      <p className="mt-3 text-xs text-muted">Fecha operativa: {dateLong(view.operationalDate)}</p>
    </div>
  );
}

function LeaveRow({ onOpen }: { onOpen: () => void }) {
  const [available, setAvailable] = useState<number | null>(null);
  useEffect(() => {
    api<{ vacations: { available: number | null } | null }>("/api/me/profile")
      .then((r) => setAvailable(r.vacations?.available ?? null)).catch(() => undefined);
  }, []);
  return (
    <button onClick={onOpen} className={cx(cardClass, "flex w-full items-center gap-3 p-4 text-left hover:bg-white/80")}>
      <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-accent/25 text-[#8A5A00]" aria-hidden>
        <svg viewBox="0 0 24 24" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="3" y="4" width="18" height="18" rx="2" /><path d="M16 2v4M8 2v4M3 10h18" /></svg>
      </span>
      <span className="min-w-0 flex-1">
        <span className="block text-sm font-bold text-ink">Solicitar vacaciones o PSG</span>
        <span className="block text-xs text-muted">{available != null ? `Te quedan ${available} día(s) de vacaciones` : "Vacaciones y permisos sin goce"}</span>
      </span>
      <svg viewBox="0 0 24 24" className="h-5 w-5 text-muted" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden><path d="m9 18 6-6-6-6" /></svg>
    </button>
  );
}

function LeaveBalance() {
  const [v, setV] = useState<Parameters<typeof VacationCard>[0]["v"]>(null);
  useEffect(() => { api<{ vacations: NonNullable<Parameters<typeof VacationCard>[0]["v"]> }>("/api/me/profile").then((r) => setV(r.vacations)).catch(() => undefined); }, []);
  return <VacationCard v={v} />;
}

function LeaveScreen({ onBack }: { onBack: () => void }) {
  const [type, setType] = useState("VACACIONES");
  const [start, setStart] = useState(todayMx());
  const [end, setEnd] = useState(todayMx());
  const [reason, setReason] = useState("");
  const [list, setList] = useState<LeaveReq[]>([]);
  const [msg, setMsg] = useState<{ kind: "success" | "error"; text: string } | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    try {
      const r = await api<{ requests: LeaveReq[] }>("/api/leave");
      setList(r.requests);
    } catch (e) {
      if (e instanceof ApiError && e.status === 401) onBack();
    }
  }, [onBack]);
  useEffect(() => { load(); }, [load]);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setMsg(null);
    try {
      await api("/api/leave", { method: "POST", json: { type, startDate: start, endDate: end < start ? start : end, reason } });
      setMsg({ kind: "success", text: "Solicitud enviada. Tu supervisor la revisará." });
      setReason("");
      load();
    } catch (err) {
      setMsg({ kind: "error", text: (err as Error).message });
    } finally {
      setBusy(false);
    }
  }

  async function cancel(id: number) {
    try {
      await api(`/api/leave/${id}/cancel`, { method: "POST" });
      load();
    } catch (err) {
      setMsg({ kind: "error", text: (err as Error).message });
    }
  }

  return (
    <section className="space-y-4">
      <LeaveBalance />
      <form onSubmit={submit} className={cx(cardClass, "space-y-3 p-5")}>
        <p className="font-display text-lg font-bold text-ink">Solicitar vacaciones o PSG</p>
        <div className="grid grid-cols-2 gap-2">
          {["VACACIONES", "PSG"].map((t) => (
            <button key={t} type="button" onClick={() => setType(t)}
              className={`rounded-xl border px-3 py-3 text-sm font-semibold ${type === t ? "border-brand bg-brand text-white" : "border-line bg-white text-muted"}`}>
              {t === "VACACIONES" ? "Vacaciones" : "PSG (permiso sin goce)"}
            </button>
          ))}
        </div>
        <div className="grid grid-cols-2 gap-2">
          <label className="block text-sm"><span className="mb-1 block font-semibold text-slate-700">Desde</span>
            <input type="date" className={fieldClass} value={start} min={todayMx()} required
              onChange={(e) => { setStart(e.target.value); if (end < e.target.value) setEnd(e.target.value); }} /></label>
          <label className="block text-sm"><span className="mb-1 block font-semibold text-slate-700">Hasta</span>
            <input type="date" className={fieldClass} value={end} min={start} required onChange={(e) => setEnd(e.target.value)} /></label>
        </div>
        <label className="block text-sm"><span className="mb-1 block font-semibold text-slate-700">Comentario (opcional)</span>
          <textarea className={fieldClass} rows={2} maxLength={300} value={reason} onChange={(e) => setReason(e.target.value)} /></label>
        {msg && <Alert kind={msg.kind}>{msg.text}</Alert>}
        <Button type="submit" variant="brand" loading={busy} className="w-full py-3">ENVIAR SOLICITUD</Button>
      </form>

      <div className={cx(cardClass, "p-5")}>
        <p className="mb-3 text-sm font-bold text-ink">Mis solicitudes</p>
        {list.length === 0 && <p className="text-sm text-slate-500">Aún no tienes solicitudes.</p>}
        <ul className="space-y-2">
          {list.map((r) => (
            <li key={r.id} className="rounded-xl border border-line px-3 py-2 text-sm">
              <div className="flex items-center justify-between gap-2">
                <b>{r.type === "VACACIONES" ? "Vacaciones" : "PSG"}</b>
                <Badge className={LEAVE_STATUS[r.status]}>{r.status.charAt(0) + r.status.slice(1).toLowerCase()}</Badge>
              </div>
              <p className="text-slate-600">{dateShort(r.startDate)}{r.endDate !== r.startDate ? ` al ${dateShort(r.endDate)}` : ""} · {r.days} día(s)</p>
              {r.decisionNote && <p className="text-xs text-slate-500">Supervisor: {r.decisionNote}</p>}
              {r.status === "PENDIENTE" && (
                <button className="mt-1 text-xs font-semibold text-red-700" onClick={() => cancel(r.id)}>Cancelar solicitud</button>
              )}
            </li>
          ))}
        </ul>
      </div>
      <Button variant="outline" onClick={onBack} className="w-full py-3">Regresar</Button>
    </section>
  );
}

function Row({ label, value, strong }: { label: string; value: string; strong?: boolean }) {
  return (
    <div className="flex justify-between gap-4 border-b border-line/60 pb-2 last:border-0">
      <dt className="text-muted">{label}:</dt>
      <dd className={`text-right font-semibold ${strong ? "text-lg tabular text-slate-900" : ""}`}>{value}</dd>
    </div>
  );
}
