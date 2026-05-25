import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  output: "standalone",
  serverExternalPackages: ["onnxruntime-node", "@huggingface/transformers"],
};

export default nextConfig;
