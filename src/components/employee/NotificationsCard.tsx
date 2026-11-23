"use client";

import { useCallback, useEffect, useState } from "react";
import { Alert, api, Button } from "../ui";

type Status = "loading" | "hidden" | "ios-install" | "unsupported" | "denied" | "off" | "on";

function urlBase64ToUint8Array(base64: string) {
  const padding = "=".repeat((4 - (base64.length % 4)) % 4);
  const raw = atob((base64 + padding).replace(/-/g, "+").replace(/_/g, "/"));
  return Uint8Array.from([...raw].map((c) => c.charCodeAt(0)));
}

const isIOS = () => typeof navigator !== "undefined" && /iPhone|iPad|iPod/i.test(navigator.userAgent);
const isStandalone = () =>
  typeof window !== "undefined" &&
  (window.matchMedia("(display-mode: standalone)").matches || (navigator as unknown as { standalone?: boolean }).standalone === true);

export default function NotificationsCard() {
  const [status, setStatus] = useState<Status>("loading");
  const [publicKey, setPublicKey] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ kind: "success" | "error"; text: string } | null>(null);

  const refresh = useCallback(async () => {
    try {
      const cfg = await api<{ enabled: boolean; publicKey: string | null }>("/api/push/key");
      if (!cfg.enabled) { setStatus("hidden"); return; }
      setPublicKey(cfg.publicKey);
      const supported = "serviceWorker" in navigator && "PushManager" in window && "Notification" in window;
      if (!supported) { setStatus(isIOS() && !isStandalone() ? "ios-install" : "unsupported"); return; }
      if (Notification.permission === "denied") { setStatus("denied"); return; }
      const reg = await navigator.serviceWorker.register("/sw.js");
      const sub = await reg.pushManager.getSubscription();
      setStatus(sub && Notification.permission === "granted" ? "on" : "off");
    } catch {
      setStatus("unsupported");
    }
  }, []);

  useEffect(() => { refresh(); }, [refresh]);

  async function enable() {
    if (!publicKey) return;
    setBusy(true);
    setMsg(null);
    try {
      const permission = await Notification.requestPermission();
      if (permission !== "granted") { setStatus(permission === "denied" ? "denied" : "off"); return; }
      const reg = await navigator.serviceWorker.register("/sw.js");
      await navigator.serviceWorker.ready;
      const sub = (await reg.pushManager.getSubscription())
        ?? (await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: urlBase64ToUint8Array(publicKey) }));
      await api("/api/me/push", { method: "POST", json: { subscription: sub.toJSON() } });
      setStatus("on");
      setMsg({ kind: "success", text: "Avisos activados. Te recordaremos registrar tu asistencia antes de la hora límite." });
    } catch (e) {
      setMsg({ kind: "error", text: (e as Error).message || "No se pudieron activar los avisos." });
    } finally {
      setBusy(false);
    }
  }

  async function disable() {
    setBusy(true);
    try {
      const reg = await navigator.serviceWorker.getRegistration("/");
      const sub = await reg?.pushManager.getSubscription();
      if (sub) {
        await api("/api/me/push", { method: "DELETE", json: { endpoint: sub.endpoint } }).catch(() => undefined);
        await sub.unsubscribe();
      }
      setStatus("off");
      setMsg(null);
    } finally {
      setBusy(false);
    }
  }

  async function test() {
    setBusy(true);
    setMsg(null);
    try {
      await api("/api/me/push/test", { method: "POST" });
      setMsg({ kind: "success", text: "Aviso de prueba enviado. Debe aparecer en unos segundos." });
    } catch (e) {
      setMsg({ kind: "error", text: (e as Error).message });
    } finally {
      setBusy(false);
    }
  }

  if (status === "loading" || status === "hidden") return null;

  return (
    <div className="rounded-lg border border-slate-200 bg-white p-4 text-sm shadow-sm">
      <p className="font-bold text-slate-900">🔔 Recordatorios</p>
      {status === "on" && (
        <>
          <p className="mt-1 text-slate-600">Avisos activados en este celular. Te avisaremos 15 y 5 minutos antes del cierre si no has registrado.</p>
          <div className="mt-3 grid grid-cols-2 gap-2">
            <Button variant="secondary" onClick={test} loading={busy}>Enviar prueba</Button>
            <Button variant="ghost" onClick={disable} disabled={busy}>Desactivar</Button>
          </div>
        </>
      )}
      {status === "off" && (
        <>
          <p className="mt-1 text-slate-600">Recibe un aviso 15 y 5 minutos antes del cierre si aún no registras tu asistencia.</p>
          <Button onClick={enable} loading={busy} className="mt-3 w-full">Activar avisos</Button>
        </>
      )}
      {status === "ios-install" && (
        <p className="mt-1 text-slate-600">
          En iPhone, primero agrega esta página a tu pantalla de inicio: toca <b>Compartir</b> (cuadro con flecha) → <b>Agregar a inicio</b>. Ábrela desde ese ícono y aquí aparecerá el botón para activar los avisos (requiere iOS 16.4 o superior).
        </p>
      )}
      {status === "denied" && (
        <p className="mt-1 text-slate-600">Bloqueaste las notificaciones. Actívalas en la configuración del navegador para este sitio y recarga la página.</p>
      )}
      {status === "unsupported" && <p className="mt-1 text-slate-600">Este navegador no permite notificaciones. Prueba con Chrome.</p>}
      {msg && <div className="mt-3"><Alert kind={msg.kind}>{msg.text}</Alert></div>}
    </div>
  );
}
