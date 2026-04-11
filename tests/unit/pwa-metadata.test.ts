import { vi } from "vitest";

vi.mock("next/font/google", () => ({
  Inter: () => ({ variable: "--font-body" }),
  Instrument_Serif: () => ({ variable: "--font-display" }),
  Orbitron: () => ({ variable: "--font-wordmark" })
}));

import { metadata, viewport } from "@/app/layout";
import { manifest } from "@/app/manifest";

describe("PWA shell metadata", () => {
  it("exports the root metadata needed for installable web app behavior", () => {
    const icons = metadata.icons as {
      icon?: Array<string | { url: string }> | string | { url: string };
      apple?: Array<string | { url: string }> | string | { url: string };
    };

    const toUrls = (value?: Array<string | { url: string }> | string | { url: string }) => {
      if (!value) {
        return [];
      }

      const list = Array.isArray(value) ? value : [value];

      return list.map((icon) => (typeof icon === "string" ? icon : icon.url));
    };

    const iconUrls = [...toUrls(icons.icon), ...toUrls(icons.apple)].sort();

    expect(metadata.manifest).toBe("/manifest.webmanifest");
    expect(iconUrls).toEqual(
      expect.arrayContaining(["/apple-touch-icon.png", "/icon-192.png", "/icon-512.png"])
    );
    expect(metadata.appleWebApp).toEqual({
      capable: true,
      title: "Eidon",
      statusBarStyle: "black-translucent"
    });
    expect(viewport).toEqual({
      themeColor: "#0a0a0a",
      colorScheme: "dark"
    });
  });

  it("returns a standalone manifest with generated icon assets", () => {
    const data = manifest();

    expect(data).toEqual(
      expect.objectContaining({
        name: "Eidon",
        short_name: "Eidon",
        start_url: "/",
        scope: "/",
        display: "standalone",
        theme_color: "#0a0a0a",
        background_color: "#0a0a0a"
      })
    );

    expect(data.icons?.map((icon) => icon.src)).toEqual(
      expect.arrayContaining(["/icon-192.png", "/icon-512.png"])
    );
  });
});
