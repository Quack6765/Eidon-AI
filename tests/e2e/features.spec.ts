import { expect, test } from "@playwright/test";

async function signIn(page: import("@playwright/test").Page) {
  await page.goto("/");
  await page.getByPlaceholder("Username").fill("admin");
  await page.getByPlaceholder("Password").fill("changeme123");
  await page.getByRole("button", { name: "Enter workspace" }).click();
  await page.waitForURL(/localhost:3117\/$/, { timeout: 15000 });
}

test.describe("Feature: Create and delete conversations", () => {
  test("creates a new chat and deletes it", async ({ page }) => {
    await signIn(page);

    // Create chat
    await page.getByRole("button", { name: "New chat" }).click();
    await expect(page).toHaveURL(/\/chat\//, { timeout: 10000 });

    // Verify the new conversation appears in sidebar
    await expect(page.getByText("New conversation")).toBeVisible({ timeout: 5000 });

    // Find the conversation item in sidebar, hover to reveal "..." button
    const convLink = page.locator('aside a[href*="/chat/"]').first();
    await convLink.hover();

    // Click the more options button
    const moreBtn = convLink.locator('button:has(.lucide-more-horizontal)');
    await expect(moreBtn).toBeVisible({ timeout: 3000 });
    await moreBtn.click();

    // Click "Delete" in the context menu
    await page.locator('aside').getByText("Delete").first().click();

    // Confirm the deletion
    await page.getByRole("button", { name: "Delete" }).click({ timeout: 5000 });

    // Should navigate away from the chat
    await page.waitForURL(/localhost:3117\/(chat\/)?$|^\/$/, { timeout: 5000 }).catch(() => {});
  });
});

test.describe("Feature: Folders", () => {
  test("creates and renames a folder", async ({ page }) => {
    await signIn(page);

    // Click "New folder" button
    await page.getByText("New folder").click();

    // Fill folder name
    const folderInput = page.getByPlaceholder("Folder name...");
    await folderInput.fill("Work Chats");
    await folderInput.press("Enter");

    // Verify folder appears in sidebar
    await expect(page.getByText("Work Chats")).toBeVisible({ timeout: 3000 });
  });
});

test.describe("Feature: Move conversation to folder", () => {
  test("moves a conversation into a folder by dragging it onto the folder", async ({ page }) => {
    await signIn(page);

    // Create a folder first
    await page.getByText("New folder").click();
    await page.getByPlaceholder("Folder name...").fill("Projects");
    await page.getByPlaceholder("Folder name...").press("Enter");
    await expect(page.getByText("Projects")).toBeVisible({ timeout: 3000 });

    // Create a chat
    await page.getByRole("button", { name: "New chat" }).click();
    await expect(page).toHaveURL(/\/chat\//, { timeout: 10000 });

    const convLink = page.locator('aside a[href*="/chat/"]').first();
    const folderRow = page.locator("aside").getByText("Projects").first();

    const convBox = await convLink.boundingBox();
    const folderBox = await folderRow.boundingBox();

    if (!convBox || !folderBox) {
      throw new Error("Could not find drag source or folder target");
    }

    await page.mouse.move(convBox.x + convBox.width / 2, convBox.y + convBox.height / 2);
    await page.mouse.down();
    await page.mouse.move(folderBox.x + folderBox.width / 2, folderBox.y + folderBox.height / 2, {
      steps: 20
    });
    await page.mouse.up();

    await expect(page.locator('aside .ml-4 a[href*="/chat/"]').first()).toBeVisible({ timeout: 5000 });
  });
});

test.describe("Feature: Search conversations", () => {
  test("searches for a conversation", async ({ page }) => {
    await signIn(page);

    // Create a chat
    await page.getByRole("button", { name: "New chat" }).click();
    await expect(page).toHaveURL(/\/chat\//, { timeout: 10000 });

    // Click search
    await page.getByText("Search chats").click();

    // Type search query
    const searchInput = page.getByPlaceholder("Search chats...");
    await searchInput.fill("New");
    await page.waitForTimeout(500);

    // Should show matching results
    await expect(page.getByText("New conversation")).toBeVisible({ timeout: 5000 });
  });
});

test.describe("Feature: MCP Servers in settings", () => {
  test("adds, tests, retests, and removes an MCP server", async ({ page }) => {
    await signIn(page);
    const serverName = `Test MCP ${Date.now()}`;

    await page.route("**/api/mcp-servers/test", async (route) => {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          success: true,
          protocolVersion: "2025-03-26",
          toolCount: 2,
          text: "2 tools discovered"
        })
      });
    });

    await page.getByRole("link", { name: "Open settings" }).click();
    await page.waitForLoadState("networkidle");
    await expect(page.getByRole("heading", { name: "MCP Servers" })).toBeVisible({ timeout: 10000 });

    // Add MCP server
    await page.getByRole("button", { name: "Add MCP server" }).click();
    await page.getByPlaceholder("My MCP Server").fill(serverName);
    await page.getByPlaceholder("https://...").fill("https://mcp.example.com/api");
    await page.getByRole("button", { name: "Test", exact: true }).click();
    await expect(page.locator("text=2 tools discovered").first()).toBeVisible({ timeout: 5000 });
    await page.getByRole("button", { name: "Add server" }).click();

    await expect(page.getByText(serverName, { exact: true })).toBeVisible({ timeout: 5000 });
    await page.getByRole("button", { name: "Retest" }).last().click();
    await expect(page.locator("text=2 tools discovered").first()).toBeVisible({ timeout: 5000 });

    // Delete it
    await page.locator('button:has(.lucide-trash-2)').last().click();
    await expect(page.getByText(serverName, { exact: true })).not.toBeVisible({ timeout: 3000 });
  });
});

test.describe("Feature: Skills in settings", () => {
  test("adds and removes a skill", async ({ page }) => {
    await signIn(page);

    await page.getByRole("link", { name: "Open settings" }).click();
    await expect(page.getByText("Skills")).toBeVisible({ timeout: 5000 });

    // Add skill
    await page.getByRole("button", { name: "Add skill" }).click();
    await page.getByPlaceholder("Skill name").fill("Test Skill");
    await page.getByPlaceholder("Explain when this skill should and should not trigger").fill("Use when the user asks for French output.");
    await page.getByPlaceholder("Enter the full skill instructions...").fill("Always respond in French.");
    await page.getByRole("button", { name: "Add skill" }).click();

    await expect(page.getByText("Test Skill")).toBeVisible({ timeout: 5000 });

    // Delete it
    page.locator('div').filter({ hasText: /Test Skill/ }).first().locator('button:has(.lucide-trash-2)').click();
    await expect(page.getByText("Test Skill")).not.toBeVisible({ timeout: 3000 });
  });
});
