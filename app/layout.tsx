import type { Metadata, Viewport } from "next";
import { Cormorant_Garamond, Inter } from "next/font/google";
import "./globals.css";

// DESIGN.md substitutes: Cormorant Garamond (display, for Copernicus) and
// Inter (body/UI, for StyreneB). Self-hosted by next/font at build time —
// no runtime requests to Google.
const display = Cormorant_Garamond({
  subsets: ["latin"],
  weight: ["500", "600"],
  variable: "--font-display-src",
  display: "swap",
});

const sans = Inter({
  subsets: ["latin"],
  variable: "--font-sans-src",
  display: "swap",
});

export const metadata: Metadata = {
  title: { default: "Learning Platform", template: "%s · Learning Platform" },
  description: "Your courses, lectures, and exams — all in one place.",
  icons: { icon: "/icon.svg" },
};

export const viewport: Viewport = {
  themeColor: "#faf9f5",
  width: "device-width",
  initialScale: 1,
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en" className={`${display.variable} ${sans.variable} h-full antialiased`}>
      <body className="flex min-h-full flex-col bg-canvas text-body">{children}</body>
    </html>
  );
}
