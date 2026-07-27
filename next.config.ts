import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  output: "standalone",
  serverExternalPackages: [
    "onnxruntime-node",
    "@huggingface/transformers",
    "pdfjs-dist",
    "sherpa-onnx-node"
  ],
  experimental: {
    middlewareClientMaxBodySize: "100mb"
  }
};

export default nextConfig;
