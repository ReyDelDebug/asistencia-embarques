import { handle, json, requireUser } from "@/lib/http";

export const dynamic = "force-dynamic";

export const GET = handle(async (req) => json({ user: await requireUser(req) }));
