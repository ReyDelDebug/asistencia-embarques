import { queryOne } from "@/lib/db";
import { handle, json } from "@/lib/http";

export const dynamic = "force-dynamic";

export const GET = handle(async () => {
  const row = await queryOne<{ n: number }>("SELECT count(*)::int AS n FROM employees WHERE active");
  return json({ ok: true, database: "ok", activeEmployees: row?.n ?? 0 });
});
