import { NextResponse } from "next/server";
import { AppError } from "@/lib/errors";
import { handle } from "@/lib/http";
import { ADMIN_COOKIE, EMPLOYEE_COOKIE, getEmployeeFromToken, getUserFromToken } from "@/lib/services/auth";
import { getPhotoFor } from "@/lib/services/photos";

export const dynamic = "force-dynamic";

export const GET = handle<{ params: Promise<{ id: string }> }>(async (req, { params }) => {
  const { id } = await params;
  const targetId = Number(id);
  if (!Number.isInteger(targetId) || targetId <= 0) throw new AppError(404, "NOT_FOUND", "Foto no encontrada.");
  const user = await getUserFromToken(req.cookies.get(ADMIN_COOKIE)?.value);
  const employee = user ? null : await getEmployeeFromToken(req.cookies.get(EMPLOYEE_COOKIE)?.value);
  if (!user && !employee) throw new AppError(401, "UNAUTHENTICATED", "Sesión no válida.");
  const photo = await getPhotoFor(targetId, user ? { type: "USER" } : { type: "EMPLOYEE", employee: employee! });
  if (!photo) throw new AppError(404, "NOT_FOUND", "Foto no encontrada.");
  return new NextResponse(new Uint8Array(photo.data), {
    headers: {
      "Content-Type": photo.contentType,
      "Cache-Control": "private, max-age=600",
      "X-Content-Type-Options": "nosniff",
      "Content-Security-Policy": "default-src 'none'",
    },
  });
});
