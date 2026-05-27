import { PLUGIN_ORDER, type PluginName } from "./types";

const PLUGIN_NAME_SET = new Set<string>(PLUGIN_ORDER);

function readDisabled(): Set<string> {
  const raw = process.env.NEXT_PUBLIC_MARKDOWN_DISABLED_PLUGINS ?? "";
  const parts = raw
    .split(",")
    .map((p) => p.trim())
    .filter((p) => p.length > 0 && PLUGIN_NAME_SET.has(p));
  return new Set(parts);
}

export function isPluginEnabled(name: PluginName): boolean {
  return !readDisabled().has(name);
}

export function getDisabledPlugins(): PluginName[] {
  return Array.from(readDisabled()) as PluginName[];
}
