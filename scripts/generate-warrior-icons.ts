import path from "node:path";

import { generateWarriorIconAssets } from "@/lib/warrior-icon-assets";

async function main() {
  const projectRoot = process.cwd();

  await generateWarriorIconAssets({
    sourcePath: path.join(projectRoot, "public/eidon-banner.png"),
    outputDir: path.join(projectRoot, "public")
  });

  console.log("Generated warrior icon assets in public/");
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
