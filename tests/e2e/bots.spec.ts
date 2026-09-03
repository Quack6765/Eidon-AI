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

  await expect(page).toHaveURL(/\/agents\/bot/, { timeout: 15_000 });
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
  await expect(page).toHaveURL(/\/agents\/bot/, { timeout: 15_000 });
  await expect(page.getByText("Coordinates your team of bots").first()).toBeVisible({
    timeout: 10_000
  });

  await expect(page.getByRole("button", { name: "Edit" })).toBeVisible({ timeout: 10_000 });
  await page.getByRole("button", { name: "Details" }).click();
  await expect(page.getByText("Workspace").first()).toBeVisible({ timeout: 10_000 });
});

test("bot detail manages workspace skills from the details panel", async ({ page }) => {
  await signIn(page);

  await page.goto("/agents");
  await expect(page.getByText("Chief of Staff").first()).toBeVisible({ timeout: 15_000 });

  const newBotButton = page.getByRole("button", { name: "New bot" });
  await expect(newBotButton).toBeVisible({ timeout: 10_000 });
  await newBotButton.click();

  await page.getByLabel("Bot name").fill("E2E Skill Keeper");
  await page.getByLabel("Bot description").fill("Created by the skills e2e test.");
  await page.getByRole("button", { name: "Create bot" }).click();
  await expect(page).toHaveURL(/\/agents\/bot/, { timeout: 15_000 });

  await page.getByRole("button", { name: "Details" }).click();
  const skillsSection = page.locator("section", { has: page.getByText("Skills", { exact: true }) }).first();
  await expect(skillsSection.getByText("No skills yet.")).toBeVisible({ timeout: 10_000 });

  await skillsSection.getByRole("button", { name: "Add skill" }).click();
  const createDialog = page.getByRole("dialog", { name: "Add skill" });
  await createDialog.getByLabel("Skill name").fill("Meeting notes");
  await createDialog.getByLabel("Skill description").fill("Summarize meetings.");
  await createDialog.getByLabel("Skill instructions").fill("Capture action items and owners.");
  await createDialog.getByRole("button", { name: "Save" }).click();

  await expect(skillsSection.getByText("Meeting notes")).toBeVisible({ timeout: 10_000 });
  await expect(skillsSection.getByText("Summarize meetings.")).toBeVisible({ timeout: 10_000 });

  await skillsSection.getByRole("button", { name: "Edit skill Meeting notes" }).click();
  const editDialog = page.getByRole("dialog", { name: "Edit skill" });
  await expect(editDialog.getByLabel("Skill name")).toHaveValue("Meeting notes");
  await expect(editDialog.getByLabel("Skill instructions")).toHaveValue("Capture action items and owners.");
  await editDialog.getByLabel("Skill name").fill("Deep research");
  await editDialog.getByRole("button", { name: "Save" }).click();

  await expect(skillsSection.getByText("Deep research")).toBeVisible({ timeout: 10_000 });
  await expect(skillsSection.getByText("Meeting notes")).toHaveCount(0);

  await skillsSection.getByRole("button", { name: "Delete skill Deep research" }).click();
  const deleteDialog = page.getByRole("dialog", { name: "Delete skill?" });
  await deleteDialog.getByRole("button", { name: "Delete" }).click();

  await expect(skillsSection.getByText("No skills yet.")).toBeVisible({ timeout: 10_000 });
});
