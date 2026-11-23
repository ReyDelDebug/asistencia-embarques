"use client";

import { useCallback, useEffect, useState, type FormEvent } from "react";
import { Alert, api, ApiError, Avatar, Badge, Button, cx, dateLong, dateShort, inputClass, time12, timeMx } from "./ui";
import GroupTab from "./employee/GroupTab";
import ProfileTab from "./employee/ProfileTab";
import { useServerClock } from "./useServerClock";

interface View {
  employee: { id: number; fullName: string; employeeNumber: string; role: string; departmentName: string | null; subareaName: string | null };
  localDate: string;
  shift: { code: string; name: string; openTime: string; closeTime: string; lastAllowed: string };
  operationalDate: string;
  windowState: "BEFORE" | "OPEN" | "CLOSED";
  existing: { operationalDate: string; confirmedAt: string } | null;
  nextChange: { date: string; shiftCode: string; shiftName: string } | null;
  photoVersion: string | null;
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
  return `${v.employee.departmentName ?? "—"}${v.employee.subareaName ? ` · ${v.employee.subareaName}` : ""}`;
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
      <label htmlFor={id} className="mb-1 block text-sm font-semibold text-slate-700">{label}</label>
      <input
        id={id} type="password" inputMode="numeric" pattern="[0-9]*" autoComplete={autoComplete}
        required minLength={4} maxLength={6} value={value}
        onChange={(e) => set(e.target.value.replace(/\D/g, ""))}
        className={`${inputClass} py-3 text-lg tracking-[0.4em]`} placeholder="••••••"
      />
    </div>
  );

  return (
    <main className="mx-auto flex min-h-dvh w-full max-w-md flex-col px-4 py-6">
      <header className="mb-5 text-center">
        <div className="mx-auto mb-3 flex h-12 w-12 items-center justify-center rounded-lg bg-slate-900 text-lg font-bold text-white">CA</div>
        <h1 className="text-xl font-bold tracking-tight text-slate-900">CONTROL DE ASISTENCIA</h1>
        <p className="text-sm text-slate-500">Embarques</p>
        <div className="mt-3 rounded-lg border border-slate-200 bg-white px-4 py-2">
          <p className="text-sm text-slate-600" suppressHydrationWarning>{clock.dateText}</p>
          <p className="text-2xl font-bold tabular text-slate-900" suppressHydrationWarning>{clock.timeText}</p>
        </div>
      </header>

      {screen === "loading" && <div className="flex flex-1 items-center justify-center text-slate-500">Cargando…</div>}

      {screen === "number" && (
        <form onSubmit={onIdentify} className="space-y-4 rounded-lg border border-slate-200 bg-white p-5 shadow-sm">
          <div>
            <label htmlFor="num" className="mb-1 block text-sm font-semibold text-slate-700">Número de empleado</label>
            <input
              id="num" name="employeeNumber" inputMode="numeric" pattern="[0-9]*" autoComplete="username"
              required maxLength={10} value={employeeNumber}
              onChange={(e) => setEmployeeNumber(e.target.value.replace(/\D/g, ""))}
              className={`${inputClass} py-3 text-lg tracking-wider`} placeholder="Tu número de empleado"
            />
          </div>
          {error && <Alert>{error}</Alert>}
          <Button type="submit" loading={busy} className="w-full py-3.5 text-base">CONTINUAR</Button>
        </form>
      )}

      {screen === "pin" && (
        <form onSubmit={onLogin} className="space-y-4 rounded-lg border border-slate-200 bg-white p-5 shadow-sm">
          <p className="text-base font-semibold text-slate-900">Hola, {firstName}</p>
          <p className="-mt-3 text-sm text-slate-500">Número de empleado {employeeNumber}</p>
          {pinInput("pin", pin, setPin, "PIN", "current-password")}
          {error && <Alert>{error}</Alert>}
          <Button type="submit" loading={busy} className="w-full py-3.5 text-base">INGRESAR</Button>
          <button type="button" className="w-full text-sm font-semibold text-slate-600 underline"
            onClick={() => { setError(null); setScreen("number"); }}>No soy yo / cambiar número</button>
        </form>
      )}

      {screen === "setup" && (
        <form onSubmit={onSetup} className="space-y-4 rounded-lg border border-slate-200 bg-white p-5 shadow-sm">
          <div>
            <p className="text-base font-semibold text-slate-900">Hola, {firstName}. Crea tu PIN</p>
            <p className="mt-1 text-sm text-slate-600">
              Es tu primera vez. Elige un PIN de 4 a 6 números; lo usarás junto con tu número de empleado ({employeeNumber}) cada vez que registres tu asistencia. No lo compartas con nadie.
            </p>
          </div>
          {pinInput("newpin", pin, setPin, "Nuevo PIN", "new-password")}
          {pinInput("newpin2", pin2, setPin2, "Repite tu PIN", "new-password")}
          {error && <Alert>{error}</Alert>}
          <Button type="submit" loading={busy} className="w-full py-3.5 text-base">GUARDAR PIN E INGRESAR</Button>
          <button type="button" className="w-full text-sm font-semibold text-slate-600 underline"
            onClick={() => { setError(null); setScreen("number"); }}>No soy yo / cambiar número</button>
        </form>
      )}

      {view && ["main", "success", "leave"].includes(screen) && (
        <nav className="mb-4 grid grid-cols-3 gap-1 rounded-lg border border-slate-200 bg-white p-1 shadow-sm" aria-label="Secciones">
          {([["asistencia", "Asistencia"], ["grupo", "Mi grupo"], ["perfil", "Mi perfil"]] as const).map(([k, l]) => (
            <button key={k} onClick={() => { setTab(k); setError(null); if (k !== "asistencia" && screen === "leave") setScreen(view.existing ? "success" : "main"); }}
              aria-current={tab === k ? "page" : undefined}
              className={cx("rounded-md px-2 py-2 text-sm font-semibold", tab === k ? "bg-slate-900 text-white" : "text-slate-600 hover:bg-slate-50")}>
              {l}
            </button>
          ))}
        </nav>
      )}

      {view && tab === "grupo" && ["main", "success", "leave"].includes(screen) && <GroupTab />}

      {view && tab === "perfil" && ["main", "success", "leave"].includes(screen) && (
        <>
          <ProfileTab employeeId={view.employee.id} fullName={view.employee.fullName} employeeNumber={view.employee.employeeNumber}
            area={areaLabel(view)} photoVersion={view.photoVersion} onPhotoChanged={loadView} />
          <Button variant="ghost" onClick={onLogout} className="mt-4 w-full">Cerrar sesión</Button>
        </>
      )}

      {tab === "asistencia" && (screen === "main" || screen === "success") && view && (
        <ShiftCard view={view} />
      )}

      {tab === "asistencia" && screen === "main" && view && (
        <section className="mt-4 space-y-4">
          {view.windowState === "OPEN" ? (
            <>
              {error && <Alert>{error}</Alert>}
              <Button variant="success" onClick={onConfirm} loading={busy} className="w-full py-5 text-lg">
                CONFIRMAR MI ASISTENCIA
              </Button>
              <p className="text-center text-xs text-slate-500">La hora se toma del servidor al presionar el botón.</p>
            </>
          ) : (
            <div className="rounded-lg border border-red-200 bg-red-50 p-5 text-center">
              <p className="text-base font-bold text-red-800">EL REGISTRO DE ASISTENCIA SE ENCUENTRA CERRADO.</p>
              <p className="mt-2 text-sm text-red-700">
                {view.windowState === "BEFORE"
                  ? `Tu turno (${view.shift.name.toLowerCase()}) abre el registro a las ${time12(view.shift.openTime)}`
                  : `El registro de tu turno (${view.shift.name.toLowerCase()}) cerró a las ${time12(view.shift.closeTime)}`}
              </p>
              <p className="mt-1 text-xs text-red-700">Si necesitas ayuda, comunícate con tu supervisor.</p>
            </div>
          )}
          <Button variant="secondary" onClick={() => { setError(null); setScreen("leave"); }} className="w-full">Solicitar vacaciones o PSG</Button>
          <Button variant="ghost" onClick={onLogout} className="w-full">Cerrar sesión</Button>
        </section>
      )}

      {tab === "asistencia" && screen === "success" && view?.existing && (
        <section className="mt-4 space-y-4">
          <div className="rounded-lg border border-emerald-200 bg-white p-6 text-center shadow-sm">
            <div className="mx-auto mb-3 flex h-14 w-14 items-center justify-center rounded-full bg-emerald-100 text-3xl text-emerald-700">✓</div>
            <p className="text-xl font-bold text-emerald-800">¡ASISTENCIA REGISTRADA!</p>
            {!justRegistered && <p className="mt-1 text-sm text-slate-500">Ya habías registrado tu asistencia para este turno.</p>}
            <dl className="mt-5 space-y-2 text-left text-sm">
              <Row label="Nombre" value={view.employee.fullName} />
              <Row label="Área" value={areaLabel(view)} />
              <Row label="Turno" value={view.shift.name} />
              <Row label="Fecha" value={dateLong(view.existing.operationalDate)} />
              <Row label="Hora exacta" value={timeMx(view.existing.confirmedAt)} strong />
            </dl>
          </div>
          <Button variant="secondary" onClick={() => { setError(null); setScreen("leave"); }} className="w-full">Solicitar vacaciones o PSG</Button>
          <Button variant="ghost" onClick={onLogout} className="w-full">Cerrar sesión</Button>
        </section>
      )}

      {tab === "asistencia" && screen === "leave" && (
        <LeaveScreen onBack={() => { setScreen(view?.existing ? "success" : "main"); loadView(); }} />
      )}

      <footer className="mt-auto pt-6 text-center text-xs text-slate-400">Hora oficial: servidor · Ciudad de México</footer>
    </main>
  );
}

function ShiftCard({ view }: { view: View }) {
  return (
    <div className="rounded-lg border border-slate-200 bg-white p-5 shadow-sm">
      <div className="flex items-center gap-3">
        <Avatar employeeId={view.employee.id} name={view.employee.fullName} version={view.photoVersion} size={52} />
        <div className="min-w-0">
          <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">Empleado</p>
          <p className="truncate text-lg font-bold text-slate-900">{view.employee.fullName}</p>
        </div>
      </div>
      <div className="mt-3 rounded-md bg-slate-900 px-4 py-3 text-white">
        <p className="text-xs uppercase tracking-wide text-slate-300">Tu turno asignado</p>
        <p className="text-2xl font-bold">{view.shift.name.toUpperCase()}</p>
        <p className="text-sm text-slate-300">Registro de {time12(view.shift.openTime)} a {time12(view.shift.lastAllowed, true)}</p>
      </div>
      {view.nextChange && (
        <p className="mt-2 rounded-md bg-amber-50 px-3 py-2 text-sm text-amber-800">
          A partir del {dateLong(view.nextChange.date)} tu turno será: <b>{view.nextChange.shiftName}</b>
        </p>
      )}
      <dl className="mt-3 grid grid-cols-2 gap-3 text-sm">
        <div><dt className="text-slate-500">Área</dt><dd className="font-semibold">{areaLabel(view)}</dd></div>
        <div><dt className="text-slate-500">Número</dt><dd className="font-semibold">{view.employee.employeeNumber}</dd></div>
        <div className="col-span-2"><dt className="text-slate-500">Fecha operativa</dt><dd className="font-semibold">{dateLong(view.operationalDate)}</dd></div>
      </dl>
    </div>
  );
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
      <form onSubmit={submit} className="space-y-3 rounded-lg border border-slate-200 bg-white p-5 shadow-sm">
        <p className="text-base font-bold text-slate-900">Solicitar vacaciones o PSG</p>
        <div className="grid grid-cols-2 gap-2">
          {["VACACIONES", "PSG"].map((t) => (
            <button key={t} type="button" onClick={() => setType(t)}
              className={`rounded-md border px-3 py-3 text-sm font-semibold ${type === t ? "border-slate-900 bg-slate-900 text-white" : "border-slate-300 bg-white text-slate-700"}`}>
              {t === "VACACIONES" ? "Vacaciones" : "PSG (permiso sin goce)"}
            </button>
          ))}
        </div>
        <div className="grid grid-cols-2 gap-2">
          <label className="block text-sm"><span className="mb-1 block font-semibold text-slate-700">Desde</span>
            <input type="date" className={inputClass} value={start} min={todayMx()} required
              onChange={(e) => { setStart(e.target.value); if (end < e.target.value) setEnd(e.target.value); }} /></label>
          <label className="block text-sm"><span className="mb-1 block font-semibold text-slate-700">Hasta</span>
            <input type="date" className={inputClass} value={end} min={start} required onChange={(e) => setEnd(e.target.value)} /></label>
        </div>
        <label className="block text-sm"><span className="mb-1 block font-semibold text-slate-700">Comentario (opcional)</span>
          <textarea className={inputClass} rows={2} maxLength={300} value={reason} onChange={(e) => setReason(e.target.value)} /></label>
        {msg && <Alert kind={msg.kind}>{msg.text}</Alert>}
        <Button type="submit" loading={busy} className="w-full py-3">ENVIAR SOLICITUD</Button>
      </form>

      <div className="rounded-lg border border-slate-200 bg-white p-5 shadow-sm">
        <p className="mb-3 text-sm font-bold text-slate-900">Mis solicitudes</p>
        {list.length === 0 && <p className="text-sm text-slate-500">Aún no tienes solicitudes.</p>}
        <ul className="space-y-2">
          {list.map((r) => (
            <li key={r.id} className="rounded-md border border-slate-200 px-3 py-2 text-sm">
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
      <Button variant="secondary" onClick={onBack} className="w-full">Regresar</Button>
    </section>
  );
}

function Row({ label, value, strong }: { label: string; value: string; strong?: boolean }) {
  return (
    <div className="flex justify-between gap-4 border-b border-slate-100 pb-2 last:border-0">
      <dt className="text-slate-500">{label}:</dt>
      <dd className={`text-right font-semibold ${strong ? "text-lg tabular text-slate-900" : ""}`}>{value}</dd>
    </div>
  );
}
