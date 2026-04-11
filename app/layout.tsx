import type { Metadata, Viewport } from "next";
import { Inter, Instrument_Serif, Orbitron } from "next/font/google";

import { APP_NAME } from "@/lib/constants";

import "@/app/globals.css";

const bodyFont = Inter({
  variable: "--font-body",
  subsets: ["latin"]
});

const displayFont = Instrument_Serif({
  variable: "--font-display",
  subsets: ["latin"],
  weight: "400"
});

const wordmarkFont = Orbitron({
  variable: "--font-wordmark",
  subsets: ["latin"],
  weight: "600",
});

export const metadata: Metadata = {
  title: APP_NAME,
  description: "Self-hosted chat UI with streaming and lossless context compaction.",
  manifest: "/manifest.webmanifest",
  icons: {
    icon: [
      {
        url: "/icon-192.png",
        sizes: "192x192",
        type: "image/png"
      },
      {
        url: "/icon-512.png",
        sizes: "512x512",
        type: "image/png"
      }
    ],
    apple: {
      url: "/apple-touch-icon.png",
      sizes: "180x180",
      type: "image/png"
    }
  },
  appleWebApp: {
    capable: true,
    title: APP_NAME,
    statusBarStyle: "black-translucent"
  }
};

export const viewport: Viewport = {
  themeColor: "#0a0a0a",
  colorScheme: "dark"
};

export default function RootLayout({
  children
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" className={`${bodyFont.variable} ${displayFont.variable} ${wordmarkFont.variable}`} suppressHydrationWarning>
      <body>{children}</body>
    </html>
  );
}
