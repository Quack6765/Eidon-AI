"use client";

import { useEffect, useMemo, useState } from "react";
import { createCodePlugin } from "@streamdown/code";

export const codePlugin = createCodePlugin({ themes: ["dracula", "dracula"] });

type MermaidPlugin = typeof import("@streamdown/mermaid")["mermaid"];

let mermaidPluginPromise: Promise<MermaidPlugin> | null = null;
let loadedMermaidPlugin: MermaidPlugin | null = null;

export function contentHasMermaid(content: string) {
  return content.includes("```mermaid");
}

export function useStreamdownPlugins(content: string) {
  const needsMermaid = contentHasMermaid(content);
  const [mermaidPlugin, setMermaidPlugin] = useState<MermaidPlugin | null>(loadedMermaidPlugin);

  useEffect(() => {
    if (!needsMermaid || mermaidPlugin) {
      return;
    }

    mermaidPluginPromise ??= import("@streamdown/mermaid").then((module) => {
      loadedMermaidPlugin = module.mermaid;
      return module.mermaid;
    });

    let active = true;
    void mermaidPluginPromise.then((plugin) => {
      if (active) {
        setMermaidPlugin(plugin);
      }
    });

    return () => {
      active = false;
    };
  }, [needsMermaid, mermaidPlugin]);

  return useMemo(
    () => (mermaidPlugin ? { code: codePlugin, mermaid: mermaidPlugin } : { code: codePlugin }),
    [mermaidPlugin]
  );
}
