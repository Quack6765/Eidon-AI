import fs from "node:fs";
import path from "node:path";

async function main() {
  process.env.EIDON_DATA_DIR ??= ".context/readme-demo-data";

  const [{ resetDbForTests }, { env }, { README_DEMO_FIXTURES, seedReadmeDemoData }] =
    await Promise.all([
      import("@/lib/db"),
      import("@/lib/env"),
      import("@/lib/readme-demo")
    ]);
  const dataDir = path.resolve(env.EIDON_DATA_DIR);
  const marker = path.basename(dataDir).toLowerCase();

  if (!marker.includes("readme-demo")) {
    throw new Error(
      `Refusing to seed non-demo data directory: ${dataDir}. Set EIDON_DATA_DIR to a path containing "readme-demo".`
    );
  }

  resetDbForTests();
  fs.rmSync(dataDir, {
    recursive: true,
    force: true,
    maxRetries: 5,
    retryDelay: 50
  });

  const seeded = await seedReadmeDemoData();

  console.log(
    JSON.stringify(
      {
        dataDir,
        login: {
          username: README_DEMO_FIXTURES.localAdmin.username,
          password: README_DEMO_FIXTURES.localAdmin.password
        },
        seeded
      },
      null,
      2
    )
  );
}

main().catch((error) => {
  console.error(
    error instanceof Error ? error.message : "Unknown README demo seeding failure"
  );
  process.exitCode = 1;
});
