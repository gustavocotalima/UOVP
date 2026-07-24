import type { Metadata } from "next";
import "./globals.css";
import { HydrationMarker } from "@/components/layout/hydration-marker";
import { ThemeProvider } from "@/components/layout/theme-provider";

export const metadata: Metadata = {
  title: { default: "UOVP — Uma Outra Verdade Possível", template: "%s · UOVP" },
  description: "Carteira, orçamento e ferramentas financeiras em um só lugar.",
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="pt-BR" suppressHydrationWarning>
      <body>
        <ThemeProvider attribute="class" defaultTheme="dark" enableSystem>
          <HydrationMarker />
          {children}
        </ThemeProvider>
      </body>
    </html>
  );
}
