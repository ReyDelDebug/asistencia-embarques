import type { MetadataRoute } from "next";

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "Control de Asistencia · Embarques",
    short_name: "Asistencia",
    description: "Registro de asistencia del personal de Embarques",
    start_url: "/",
    scope: "/",
    display: "standalone",
    background_color: "#F2F5F7",
    theme_color: "#0E4D64",
    lang: "es-MX",
    icons: [
      { src: "/icon-192.png", sizes: "192x192", type: "image/png" },
      { src: "/icon-512.png", sizes: "512x512", type: "image/png" },
      { src: "/icon-512.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
    ],
  };
}
