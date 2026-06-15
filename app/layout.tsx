import type { Metadata, Viewport } from "next";
import { Inter, Instrument_Serif, Orbitron, Geist } from "next/font/google";

import { APP_NAME } from "@/lib/constants";
import { ServiceWorkerRegistration } from "@/components/service-worker-registration";

import "@/app/globals.css";
import { cn } from "@/lib/utils";

const geist = Geist({subsets:['latin'],variable:'--font-sans'});

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
  colorScheme: "dark",
  viewportFit: "cover"
};

export default function RootLayout({
  children
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" className={cn(bodyFont.variable, displayFont.variable, wordmarkFont.variable, "font-sans", geist.variable)} suppressHydrationWarning>
      <body>
        <ServiceWorkerRegistration />
        {children}
      </body>
    </html>
  );
}
