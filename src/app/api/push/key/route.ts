import { handle, json } from "@/lib/http";
import { pushConfig } from "@/lib/services/push";

export const dynamic = "force-dynamic";

/** Llave PÚBLICA VAPID (no es secreta). enabled=false si el servidor no tiene llaves. */
export const GET = handle(async () => {
  const cfg = pushConfig();
  return json({ enabled: !!cfg, publicKey: cfg?.publicKey ?? null });
});
