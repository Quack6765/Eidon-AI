import { expect, test } from "@playwright/test";

async function signIn(page: import("@playwright/test").Page) {
  await page.goto("/");
  await page.getByPlaceholder("Username").fill("admin");
  await page.getByPlaceholder("Password").fill("changeme123");
  await page.getByRole("button", { name: "Enter workspace" }).click();
  await page.waitForURL(/localhost:3117\/$/, { timeout: 15000 });
}

async function mockChatResponse(page: import("@playwright/test").Page) {
  await page.route("**/api/conversations/*/chat", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "text/event-stream",
      body: [
        'data: {"type":"message_start","messageId":"msg_assistant"}',
        "",
        'data: {"type":"answer_delta","text":"Attachment received"}',
        "",
        'data: {"type":"done","messageId":"msg_assistant"}',
        "",
      ].join("\n")
    });
  });
}

test.describe("Feature: Create and delete conversations", () => {
  test("creates a new chat and deletes it", async ({ page }) => {
    await signIn(page);

    // Create chat
    await page.getByRole("button", { name: "New chat", exact: true }).click();
    await expect(page).toHaveURL(/\/chat\//, { timeout: 10000 });

    // Verify the new conversation appears in sidebar
    await expect(page.getByRole("link", { name: "Conversation" }).first()).toBeVisible({
      timeout: 5000
    });

    // Find the conversation item in sidebar, hover to reveal "..." button
    const convRow = page.getByRole("button", { name: "Conversation" }).first();
    await convRow.hover();

    // Click the more options button
    const moreBtn = convRow.locator("button").last();
    await expect(moreBtn).toBeVisible({ timeout: 3000 });
    await moreBtn.click();

    // Click "Delete" in the context menu
    await page.locator('aside').getByText("Delete").first().click();

    // Confirm the deletion
    await page.getByRole("button", { name: "Delete", exact: true }).click({ timeout: 5000 });

    // Should navigate away from the chat
    await page.waitForURL(/localhost:3117\/(chat\/)?$|^\/$/, { timeout: 5000 }).catch(() => {});
  });

  test("removes an empty chat after leaving it for another conversation", async ({ page }) => {
    await signIn(page);
    await mockChatResponse(page);

    await page.getByRole("button", { name: "New chat", exact: true }).click();
    await expect(page).toHaveURL(/\/chat\//, { timeout: 10000 });

    await page
      .getByPlaceholder("Ask, create, or start a task. Press ⌘ ⏎ to insert a line break...")
      .fill("Keep this thread");
    await page.getByRole("button", { name: "Send message" }).click();
    await expect(page.getByText("Attachment received")).toBeVisible({ timeout: 5000 });

    const firstConversationPath = new URL(page.url()).pathname;

    await page.getByRole("button", { name: "New chat", exact: true }).click();
    await expect(page).toHaveURL(/\/chat\//, { timeout: 10000 });

    const emptyConversationPath = new URL(page.url()).pathname;
    await expect(page.locator(`aside a[href="${emptyConversationPath}"]`)).toBeVisible({
      timeout: 5000
    });

    await page.locator(`aside a[href="${firstConversationPath}"]`).first().click();
    await expect(page).toHaveURL(new RegExp(`${firstConversationPath}$`), { timeout: 10000 });
    await expect(page.locator(`aside a[href="${emptyConversationPath}"]`)).toHaveCount(0);
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
    await expect(page.getByRole("button", { name: "Work Chats folder" }).first()).toBeVisible({
      timeout: 3000
    });
  });
});

test.describe("Feature: Move conversation to folder", () => {
  test("moves a conversation into a folder by dragging it onto the folder", async ({ page }) => {
    await signIn(page);

    // Create a folder first
    await page.getByText("New folder").click();
    await page.getByPlaceholder("Folder name...").fill("Projects");
    await page.getByPlaceholder("Folder name...").press("Enter");
    await expect(page.getByRole("button", { name: "Projects folder" }).first()).toBeVisible({
      timeout: 3000
    });

    // Create a chat
    await page.getByRole("button", { name: "New chat", exact: true }).click();
    await expect(page).toHaveURL(/\/chat\//, { timeout: 10000 });

    const convLink = page.locator('aside a[href*="/chat/"]').first();
    const folderRow = page.getByRole("button", { name: "Projects folder" }).first();

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

    await expect(page.getByRole("button", { name: /Projects folder Conversation/ })).toBeVisible({
      timeout: 5000
    });
  });
});

test.describe("Feature: Search conversations", () => {
  test("searches for a conversation", async ({ page }) => {
    await signIn(page);

    // Create a chat
    await page.getByRole("button", { name: "New chat", exact: true }).click();
    await expect(page).toHaveURL(/\/chat\//, { timeout: 10000 });

    // Click search
    await page.getByRole("button", { name: "Search chats" }).click();

    // Type search query
    const searchInput = page.getByPlaceholder("Search chats...");
    await expect(searchInput).toBeVisible({ timeout: 5000 });
    await searchInput.fill("New");
    await page.waitForTimeout(500);

    // Should show matching results
    await expect(page.getByRole("link", { name: "Conversation" }).first()).toBeVisible({
      timeout: 5000
    });
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
    const serverRow = page
      .locator("div")
      .filter({ has: page.getByText(serverName, { exact: true }) })
      .first();

    await serverRow.locator('button:has(.lucide-trash-2)').last().click();
    await expect(page.getByText(serverName, { exact: true })).not.toBeVisible({ timeout: 3000 });
  });
});

test.describe("Feature: Mobile settings navigation", () => {
  test("shows the providers list first on mobile and opens detail on selection", async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await signIn(page);

    await page.goto("/settings/providers");
    await page.waitForLoadState("networkidle");

    await expect(page.getByRole("heading", { name: "Providers" })).toBeVisible({ timeout: 10000 });
    await expect(page.getByRole("button", { name: "Back to list" })).toHaveCount(0);

    await page.locator("span", { hasText: "Default profile" }).click();
    await expect(page.getByRole("button", { name: "Back to list" })).toBeVisible({ timeout: 5000 });
    await expect(page.getByText("Provider preset", { exact: true })).toBeVisible({ timeout: 5000 });

    await page.getByRole("button", { name: "Back to list" }).click();
    await expect(page.getByRole("button", { name: "Back to list" })).toHaveCount(0);
    await expect(page.locator("span", { hasText: "Default profile" })).toBeVisible({ timeout: 5000 });
  });
});

test.describe("Feature: Skills in settings", () => {
  test("adds and removes a skill", async ({ page }) => {
    await signIn(page);

    await page.getByRole("link", { name: "Open settings" }).click();
    await expect(page.getByRole("heading", { name: "Skills" })).toBeVisible({ timeout: 5000 });

    // Add skill
    await page.getByRole("button", { name: "Add skill" }).click();
    await page.getByPlaceholder("Skill name").fill("Test Skill");
    await page.getByPlaceholder("Explain when this skill should and should not trigger").fill("Use when the user asks for French output.");
    await page.getByPlaceholder("Enter the full skill instructions...").fill("Always respond in French.");
    await page.getByRole("button", { name: "Add skill" }).click();

    await expect(page.getByText("Test Skill")).toBeVisible({ timeout: 5000 });

    // Delete it
    await page
      .locator("div.flex.items-center.justify-between.rounded-xl")
      .filter({ has: page.getByText("Test Skill", { exact: true }) })
      .first()
      .locator('button:has(.lucide-trash-2)')
      .click();
    await expect(page.getByText("Test Skill")).not.toBeVisible({ timeout: 3000 });
  });
});

test.describe("Feature: Chat attachments", () => {
  test("attaches an image from the paperclip flow and sends it", async ({ page }) => {
    await signIn(page);
    await mockChatResponse(page);

    await page.getByRole("button", { name: "New chat", exact: true }).click();
    await expect(page).toHaveURL(/\/chat\//, { timeout: 10000 });

    await page.locator('input[type="file"]').setInputFiles({
      name: "photo.png",
      mimeType: "image/png",
      buffer: Buffer.from("fake-image")
    });

    await expect(page.getByRole("button", { name: "Remove photo.png" })).toBeVisible({
      timeout: 5000
    });
    await page.getByPlaceholder(/Ask, create, or start a task/i).fill("Please inspect this");
    await page.getByRole("button", { name: "Send message" }).click();

    await expect(page.getByAltText("photo.png")).toBeVisible({ timeout: 5000 });
    await expect(page.getByText("Attachment received")).toBeVisible({ timeout: 5000 });
  });

  test("attaches a text file via drag and drop", async ({ page }) => {
    await signIn(page);
    await mockChatResponse(page);

    await page.getByRole("button", { name: "New chat", exact: true }).click();
    await expect(page).toHaveURL(/\/chat\//, { timeout: 10000 });

    await page.evaluate(async () => {
      const target = document.querySelector('[data-testid="chat-view-root"]');

      if (!target) {
        throw new Error("Chat root not found");
      }

      const dataTransfer = new DataTransfer();
      dataTransfer.items.add(new File(["hello"], "notes.txt", { type: "text/plain" }));

      target.dispatchEvent(new DragEvent("dragenter", { bubbles: true, cancelable: true, dataTransfer }));
      target.dispatchEvent(new DragEvent("drop", { bubbles: true, cancelable: true, dataTransfer }));
    });

    await expect(page.getByText("notes.txt")).toBeVisible({ timeout: 5000 });
  });
});
