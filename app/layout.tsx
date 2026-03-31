import type { Metadata } from "next";
import { Inter, Instrument_Serif } from "next/font/google";

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

export const metadata: Metadata = {
  title: APP_NAME,
  description: "Self-hosted chat UI with streaming and lossless context compaction."
};

export default function RootLayout({
  children
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" className={`${bodyFont.variable} ${displayFont.variable}`} suppressHydrationWarning>
      <body>{children}</body>
    </html>
  );
}
