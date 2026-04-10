import { dirname } from "node:path";
import { fileURLToPath } from "node:url";

import { FlatCompat } from "@eslint/eslintrc";

const compat = new FlatCompat({
  baseDirectory: dirname(fileURLToPath(import.meta.url))
});

const config = [
  {
    ignores: [
      ".next/**",
      ".test-data/**",
      "coverage/**",
      "node_modules/**",
      ".e2e-data/**",
      "test-results/**"
    ]
  },
  ...compat.extends("next/core-web-vitals")
];

export default config;
