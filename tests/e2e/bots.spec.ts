import { expect, test } from "@playwright/test";

const EIDON_TEST_PASSWORD = process.env.EIDON_TEST_PASSWORD ?? "changeme123";

async function signIn(page: import("@playwright/test").Page) {
  await page.goto("/");
  await expect(page).toHaveURL(/\/login$/);

  await page.getByPlaceholder("Username").fill("admin");
  await page.getByPlaceholder("Password").fill(EIDON_TEST_PASSWORD);
  await page.getByRole("button", { name: "Proceed" }).click();
  await page.waitForURL("http://localhost:3117/", { timeout: 15000 });
}

test("agents roster shows the chief and supports creating a bot", async ({ page }) => {
  await signIn(page);

  await page.goto("/agents");
  await expect(page.getByText("Chief of Staff").first()).toBeVisible({ timeout: 15_000 });

  const newBotButton = page.getByRole("button", { name: "New bot" });
  await expect(newBotButton).toBeVisible({ timeout: 10_000 });
  await newBotButton.click();

  const nameInput = page.getByLabel("Bot name");
  await expect(nameInput).toBeVisible({ timeout: 10_000 });
  await nameInput.fill("E2E Scout");
  await page.getByLabel("Bot title").fill("E2E lookouts");
  await page.getByLabel("Bot description").fill("Created by the agents e2e test.");

  await page.getByRole("button", { name: "Create bot" }).click();

  await expect(page).toHaveURL(/\/agents\/bot_/, { timeout: 15_000 });
  await expect(page.getByText("E2E Scout").first()).toBeVisible({ timeout: 10_000 });
  await expect(page.getByText("E2E lookouts").first()).toBeVisible({ timeout: 10_000 });

  await page.goto("/agents");
  await expect(page.getByText("E2E Scout").first()).toBeVisible({ timeout: 10_000 });
});

test("bot detail page exposes sandbox actions and edit", async ({ page }) => {
  await signIn(page);

  await page.goto("/agents");
  await expect(page.getByText("Chief of Staff").first()).toBeVisible({ timeout: 15_000 });

  const chiefRow = page.getByRole("link", { name: /Chief of Staff/ }).first();
  await chiefRow.click();
  await expect(page).toHaveURL(/\/agents\/bot_/, { timeout: 15_000 });
  await expect(page.getByText("Coordinates your team of bots").first()).toBeVisible({
    timeout: 10_000
  });

  await expect(page.getByRole("button", { name: "Edit" })).toBeVisible({ timeout: 10_000 });
  await expect(page.getByText("Sandbox").first()).toBeVisible({ timeout: 10_000 });
});
