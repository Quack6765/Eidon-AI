import fs from "node:fs";
import path from "node:path";

async function main() {
  const [{ getDb, resetDbForTests }, { env }, { encryptValue }, { seedReadmeDemoData }, attachments, conversations] =
    await Promise.all([
      import("@/lib/db"),
      import("@/lib/env"),
      import("@/lib/crypto"),
      import("@/lib/readme-demo"),
      import("@/lib/attachments"),
      import("@/lib/conversations")
    ]);
  const dataDir = path.resolve(env.EIDON_DATA_DIR);
  if (
    process.env.EIDON_NATIVE_TEST_SEED_ENABLED !== "true" ||
    path.basename(dataDir).toLowerCase() !== "native-test"
  ) {
    throw new Error(`Refusing to seed non-native-test data directory: ${dataDir}`);
  }

  const markerPath = path.join(dataDir, ".seeded");
  if (fs.existsSync(markerPath)) return;

  resetDbForTests();
  fs.rmSync(dataDir, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 });
  const seeded = await seedReadmeDemoData();
  const db = getDb();
  db.prepare(
    `UPDATE provider_profiles
     SET api_base_url = ?, api_key_encrypted = ?, model = ?, api_mode = 'chat_completions'
     WHERE provider_kind = 'openai_compatible'`
  ).run(
    "http://fake-provider:4010/v1",
    encryptValue("native-test-provider-key"),
    "eidon-native-test"
  );

  const snapshot = conversations.getConversationSnapshot(
    seeded.primaryConversationId,
    seeded.envSuperAdminId
  );
  const targetMessage = snapshot?.messages.find((message) => message.role === "user");
  if (targetMessage) {
    const created = await attachments.createAttachmentsFromBytes(
      seeded.primaryConversationId,
      [{
        filename: "native-test-checklist.txt",
        mimeType: "text/plain",
        bytes: Buffer.from("Mobile API v1 fixture attachment\n", "utf8")
      }]
    );
    attachments.assignAttachmentsToMessage(
      seeded.primaryConversationId,
      targetMessage.id,
      created.map((attachment) => attachment.id)
    );
  }

  fs.mkdirSync(dataDir, { recursive: true });
  fs.writeFileSync(markerPath, new Date().toISOString(), { mode: 0o600 });
  console.log(JSON.stringify({ seeded: true, dataDir }));
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : "Native test seeding failed");
  process.exitCode = 1;
});
