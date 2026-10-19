import type { Metadata, Viewport } from "next";
import { cookies } from "next/headers";
import "./globals.css";
import { HydrationMarker } from "@/components/layout/hydration-marker";
import { ThemeProvider } from "@/components/layout/theme-provider";
import { PrivacyProvider } from "@/components/layout/privacy-provider";
import { PRIVACY_COOKIE } from "@/lib/privacy";

export const metadata: Metadata = {
  title: { default: "UOVP — Uma Outra Verdade Possível", template: "%s · UOVP" },
  description: "Carteira, orçamento e ferramentas financeiras em um só lugar.",
  applicationName: "UOVP",
  manifest: "/manifest.webmanifest",
  icons: {
    icon: [
      { url: "/favicon.ico", sizes: "32x32" },
      { url: "/icons/uovp-192.png", type: "image/png", sizes: "192x192" },
    ],
    apple: [{ url: "/apple-touch-icon.png", sizes: "180x180", type: "image/png" }],
  },
  appleWebApp: {
    capable: true,
    title: "UOVP",
    statusBarStyle: "black-translucent",
  },
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#f4f3ed" },
    { media: "(prefers-color-scheme: dark)", color: "#11120f" },
  ],
};

export default async function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  const valuesHidden = (await cookies()).get(PRIVACY_COOKIE)?.value === "true";
  return (
    <html lang="pt-BR" data-private-values={String(valuesHidden)} suppressHydrationWarning>
      <body>
        <ThemeProvider attribute="class" defaultTheme="dark" enableSystem>
          <PrivacyProvider initialHidden={valuesHidden}>
            <HydrationMarker />
            {children}
          </PrivacyProvider>
        </ThemeProvider>
      </body>
    </html>
  );
}
