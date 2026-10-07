import type { NextConfig } from "next";
import path from "node:path";

const nextConfig: NextConfig = {
  output: "standalone",
  outputFileTracingRoot: path.resolve(),
  outputFileTracingExcludes: {
    "*": [".data/**"]
  },
  serverExternalPackages: [
    "onnxruntime-node",
    "@huggingface/transformers",
    "heic-decode",
    "pdfjs-dist",
    "sherpa-onnx-node",
    "undici",
    "ws"
  ],
  experimental: {
    middlewareClientMaxBodySize: "128mb"
  }
};

export default nextConfig;
