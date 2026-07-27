import type { MetadataRoute } from "next";

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "UOVP — Uma Outra Verdade Possível",
    short_name: "UOVP",
    description: "Carteira, orçamento e ferramentas financeiras em um só lugar.",
    start_url: "/home?source=pwa",
    scope: "/",
    display: "standalone",
    background_color: "#11120f",
    theme_color: "#11120f",
    icons: [
      {
        src: "/icons/uovp-192.png",
        sizes: "192x192",
        type: "image/png",
        purpose: "any",
      },
      {
        src: "/icons/uovp-512.png",
        sizes: "512x512",
        type: "image/png",
        purpose: "any",
      },
      {
        src: "/icons/uovp-maskable-512.png",
        sizes: "512x512",
        type: "image/png",
        purpose: "maskable",
      },
    ],
  };
}
