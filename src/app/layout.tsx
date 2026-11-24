import type { Metadata, Viewport } from "next";
import { Bricolage_Grotesque, Fraunces, JetBrains_Mono, Plus_Jakarta_Sans } from "next/font/google";
import { DEFAULT_SEED, paletteFromSeed, themeStylesheet } from "@/theme/materialYou";
import { Providers } from "@/components/Providers";
import "./globals.css";

const bricolage = Bricolage_Grotesque({ subsets: ["latin"], variable: "--font-bricolage", axes: ["wdth", "opsz"], display: "swap" });
const jakarta = Plus_Jakarta_Sans({ subsets: ["latin"], variable: "--font-jakarta", display: "swap" });
const jetbrains = JetBrains_Mono({ subsets: ["latin"], variable: "--font-jetbrains", display: "swap" });
const fraunces = Fraunces({ subsets: ["latin"], variable: "--font-fraunces", style: ["normal", "italic"], axes: ["SOFT", "opsz"], display: "swap" });

// Every screen renders data that only exists after it's decrypted on the device,
// so there's nothing meaningful to prerender or validate for instant navigation.
export const instant = false;

export const metadata: Metadata = {
  title: "USMODE",
  description: "A private, end-to-end encrypted room for two.",
  applicationName: "USMODE",
  appleWebApp: { capable: true, title: "USMODE", statusBarStyle: "black-translucent" },
  icons: { icon: "/icons/icon-192.png", apple: "/icons/apple-touch-icon.png" },
  robots: { index: false, follow: false },
  referrer: "no-referrer",
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: paletteFromSeed(DEFAULT_SEED, false).surface },
    { media: "(prefers-color-scheme: dark)", color: paletteFromSeed(DEFAULT_SEED, true).surface },
  ],
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en" className={`${bricolage.variable} ${jakarta.variable} ${jetbrains.variable} ${fraunces.variable}`} suppressHydrationWarning>
      <head>
        {/* Default palette so the first paint is already Material You; the room's seed replaces it. */}
        <style id="md-default-theme" dangerouslySetInnerHTML={{ __html: themeStylesheet(DEFAULT_SEED) }} />
      </head>
      <body className="antialiased">
        <Providers>{children}</Providers>
      </body>
    </html>
  );
}
