"use client";

import { useEffect, useState } from "react";

const dateFmt = new Intl.DateTimeFormat("es-MX", {
  timeZone: "America/Mexico_City", weekday: "long", day: "numeric", month: "long", year: "numeric",
});
const timeFmt = new Intl.DateTimeFormat("es-MX", {
  timeZone: "America/Mexico_City", hour: "2-digit", minute: "2-digit", second: "2-digit", hour12: true,
});

/**
 * Reloj sincronizado con la hora del SERVIDOR (solo para mostrar).
 * La validación real de horarios siempre ocurre en el servidor.
 */
export function useServerClock() {
  const [offset, setOffset] = useState<number | null>(null);
  const [now, setNow] = useState<number>(() => Date.now());

  useEffect(() => {
    let cancelled = false;
    const sync = async () => {
      try {
        const t0 = Date.now();
        const res = await fetch("/api/time", { cache: "no-store" });
        const data = await res.json();
        const t1 = Date.now();
        if (!cancelled) setOffset(new Date(data.serverTime).getTime() - (t0 + t1) / 2);
      } catch { /* sin conexión: se muestra la hora local */ }
    };
    sync();
    const resync = setInterval(sync, 5 * 60_000);
    const tick = setInterval(() => setNow(Date.now()), 1000);
    return () => { cancelled = true; clearInterval(resync); clearInterval(tick); };
  }, []);

  const d = new Date(now + (offset ?? 0));
  const date = dateFmt.format(d);
  return {
    ready: offset !== null,
    dateText: date.charAt(0).toUpperCase() + date.slice(1),
    timeText: timeFmt.format(d),
  };
}
