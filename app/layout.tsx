import type { Metadata } from "next";
import { Instrument_Serif, Manrope } from "next/font/google";

import { APP_NAME } from "@/lib/constants";

import "@/app/globals.css";

const displayFont = Instrument_Serif({
  variable: "--font-display",
  subsets: ["latin"],
  weight: "400"
});

const bodyFont = Manrope({
  variable: "--font-body",
  subsets: ["latin"]
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
    <html lang="en" className={`${displayFont.variable} ${bodyFont.variable}`}>
      <body>{children}</body>
    </html>
  );
}
