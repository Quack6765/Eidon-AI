import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  output: "standalone",
  serverExternalPackages: ["onnxruntime-node", "@huggingface/transformers", "pdfjs-dist"],
};

export default nextConfig;
