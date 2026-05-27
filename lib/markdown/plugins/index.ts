import type { Pluggable, PluggableList } from "unified";
import { PLUGIN_ORDER, type PluginName } from "../types";
import { isPluginEnabled } from "../feature-flags";

const REGISTRY: Record<PluginName, Pluggable | undefined> = {
  "fix-block-spacing": undefined,
  "extract-inline-thematic-breaks": undefined,
  "split-inline-table": undefined,
  "fix-inline-fences": undefined,
  "merge-unclosed-inline-code": undefined,
  "close-unbalanced-emphasis": undefined,
  "normalize-mixed-emphasis": undefined,
  "normalize-list-indentation": undefined,
  "merge-orphaned-list-fragments": undefined,
  "renumber-ordered-lists": undefined,
  "tighten-lists": undefined,
  "normalize-blockquote-nesting": undefined,
};

/**
 * Ordered list of remark plugins applied to assistant markdown. Each plugin
 * is registered above in the order it should run. The array filters out plugins
 * disabled via the NEXT_PUBLIC_MARKDOWN_DISABLED_PLUGINS env var.
 */
export const MARKDOWN_REMARK_PLUGINS: PluggableList = PLUGIN_ORDER
  .filter((name) => isPluginEnabled(name) && REGISTRY[name] !== undefined)
  .map((name) => REGISTRY[name] as Pluggable);
