"use client";

import { useEffect, useMemo, useState } from "react";
import { createCodePlugin } from "@streamdown/code";
import type { MermaidConfig } from "@streamdown/mermaid";

const codePlugin = createCodePlugin({ themes: ["dracula", "dracula"] });

const mermaidConfig: MermaidConfig = {
  theme: "default",
  htmlLabels: false,
  themeVariables: {
    darkMode: true,
    background: "#0a0a0a",
    primaryColor: "#f4f4f5",
    primaryTextColor: "#0a0a0a",
    primaryBorderColor: "#71717a",
    secondaryColor: "#18181b",
    secondaryTextColor: "#f4f4f5",
    secondaryBorderColor: "#27272a",
    tertiaryColor: "#18181b",
    tertiaryTextColor: "#f4f4f5",
    tertiaryBorderColor: "#27272a",
    textColor: "#f4f4f5",
    nodeTextColor: "#0a0a0a",
    classText: "#0a0a0a",
    lineColor: "#71717a",
    arrowheadColor: "#71717a",
    defaultLinkColor: "#71717a",
    titleColor: "#f4f4f5",
    edgeLabelBackground: "#18181b",
    actorBkg: "#f4f4f5",
    actorTextColor: "#0a0a0a",
    actorBorder: "#71717a",
    actorLineColor: "#71717a",
    signalColor: "#71717a",
    signalTextColor: "#f4f4f5",
    labelBoxBkgColor: "#f4f4f5",
    labelBoxBorderColor: "#71717a",
    labelTextColor: "#0a0a0a",
    loopTextColor: "#f4f4f5",
    altSectionBkgColor: "#f4f4f5",
    excludeBkgColor: "#d4d4d8",
    activationBkgColor: "#d4d4d8",
    activationBorderColor: "#71717a",
    sequenceNumberColor: "#f4f4f5",
    stateBkg: "#f4f4f5",
    stateLabelColor: "#0a0a0a",
    labelBackgroundColor: "#f4f4f5",
    transitionColor: "#71717a",
    transitionLabelColor: "#0a0a0a",
    compositeBackground: "#18181b",
    compositeTitleBackground: "#f4f4f5",
    compositeBorder: "#71717a",
    innerEndBackground: "#71717a",
    attributeBackgroundColorOdd: "#f4f4f5",
    attributeBackgroundColorEven: "#d4d4d8",
    pieTitleTextColor: "#f4f4f5",
    pieSectionTextColor: "#0a0a0a",
    pieLegendTextColor: "#f4f4f5",
    pieStrokeColor: "#0a0a0a",
    pieOuterStrokeColor: "#71717a",
    pieOpacity: "1",
    pie1: "#b9a3f8",
    pie2: "#8ee6f5",
    pie3: "#a5b1f9",
    pie4: "#86e0a8",
    pie5: "#f2dd80",
    pie6: "#f3a1a1",
    pie7: "#cbb6fb",
    pie8: "#7dd3fc",
    pie9: "#f9c2d1",
    pie10: "#a8e6cf",
    pie11: "#d6c6a1",
    pie12: "#c4cfd9",
    taskBkgColor: "#f4f4f5",
    taskTextColor: "#0a0a0a",
    taskTextLightColor: "#f4f4f5",
    taskTextDarkColor: "#0a0a0a",
    taskTextOutsideColor: "#f4f4f5",
    taskTextClickableColor: "#818cf8",
    taskBorderColor: "#71717a",
    activeTaskBkgColor: "#d4d4d8",
    activeTaskBorderColor: "#f4f4f5",
    doneTaskBkgColor: "#d4d4d8",
    doneTaskBorderColor: "#71717a",
    gridColor: "#27272a",
    todayLineColor: "#ef4444",
    sectionBkgColor: "#18181b",
    sectionBkgColor2: "#27272a"
  }
};

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
      loadedMermaidPlugin = module.createMermaidPlugin({ config: mermaidConfig });
      return loadedMermaidPlugin;
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
