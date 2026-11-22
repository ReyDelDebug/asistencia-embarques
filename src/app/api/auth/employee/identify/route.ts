import { identifyEmployee } from "@/lib/services/auth";
import { getMeta, handle, json, readJson } from "@/lib/http";

export const POST = handle(async (req) => {
  const body = await readJson<{ employeeNumber?: string }>(req);
  return json(await identifyEmployee(String(body.employeeNumber ?? ""), getMeta(req)));
});
