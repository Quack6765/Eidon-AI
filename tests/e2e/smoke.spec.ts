import { expect, test } from "@playwright/test";

test("redirects to login, signs in, opens settings, and creates a chat", async ({ page }) => {
  await page.goto("/");
  await expect(page).toHaveURL(/\/login$/);

  await page.getByPlaceholder("Username").fill("admin");
  await page.getByPlaceholder("Password").fill("changeme123");
  await page.getByRole("button", { name: "Proceed" }).click();
  await page.waitForURL("http://localhost:3117/", { timeout: 15000 });

  await expect(page.getByRole("link", { name: "Open settings" })).toBeVisible({ timeout: 10000 });

  await page.getByRole("link", { name: "Open settings" }).click();
  await expect(page.getByText("Settings")).toBeVisible();

  await page.getByRole("link", { name: "Back to chat" }).click();
  await page.waitForURL("http://localhost:3117/", { timeout: 15000 });

  const newChatButton = page.getByRole("button", { name: "New chat", exact: true });
  await expect(newChatButton).toBeVisible({ timeout: 10000 });
  await expect(newChatButton).toBeEnabled({ timeout: 10000 });
  await newChatButton.click();

  await expect(page).toHaveURL(/\/chat\//, { timeout: 10000 });
});
