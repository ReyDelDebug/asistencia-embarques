import type { Metadata, Viewport } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Control de Asistencia · Embarques",
  description: "Registro de asistencia del personal de Embarques",
  robots: { index: false, follow: false },
  appleWebApp: { capable: true, title: "Asistencia", statusBarStyle: "default" },
  icons: { icon: "/icon-192.png", apple: "/apple-touch-icon.png" },
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  themeColor: "#0f172a",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="es" className="h-full antialiased">
      <body className="min-h-full bg-slate-100 text-slate-900">{children}</body>
    </html>
  );
}
