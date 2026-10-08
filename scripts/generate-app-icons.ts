import path from "node:path";

import { generateAppIconAssets } from "@/lib/app-icon-assets";

async function main() {
  const projectRoot = process.cwd();

  await generateAppIconAssets({
    sourcePath: path.join(projectRoot, "public/bots/bot-violet.svg"),
    outputDir: path.join(projectRoot, "public")
  });

  console.log("Generated app icon assets in public/");
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
