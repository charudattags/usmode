import type { MetadataRoute } from "next";
import { DEFAULT_SEED, paletteFromSeed } from "@/theme/materialYou";

export default function manifest(): MetadataRoute.Manifest {
  const p = paletteFromSeed(DEFAULT_SEED, false);
  return {
    name: "USMODE",
    short_name: "USMODE",
    description: "A private, end-to-end encrypted room for two.",
    id: "/",
    start_url: "/",
    scope: "/",
    display: "standalone",
    orientation: "portrait",
    background_color: p.surface,
    theme_color: p.primary,
    categories: ["lifestyle", "social", "productivity"],
    icons: [
      { src: "/icons/icon-192.png", sizes: "192x192", type: "image/png" },
      { src: "/icons/icon-512.png", sizes: "512x512", type: "image/png" },
      { src: "/icons/icon-maskable-512.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
    ],
  };
}
