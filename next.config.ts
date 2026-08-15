import type { NextConfig } from "next";
import path from "node:path";

const nextConfig: NextConfig = {
  output: "standalone",
  outputFileTracingRoot: path.resolve(),
  serverExternalPackages: [
    "onnxruntime-node",
    "@huggingface/transformers",
    "pdfjs-dist",
    "sherpa-onnx-node",
    "ws"
  ],
  experimental: {
    middlewareClientMaxBodySize: "100mb"
  }
};

export default nextConfig;
