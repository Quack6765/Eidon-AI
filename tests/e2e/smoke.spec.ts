import { expect, test } from "@playwright/test";

test("redirects to login, signs in, opens settings, and creates a chat", async ({ page }) => {
  await page.goto("/");
  await expect(page).toHaveURL(/\/login$/);

  await page.getByPlaceholder("Username").fill("admin");
  await page.getByPlaceholder("Password").fill("changeme123");
  await page.getByRole("button", { name: "Enter workspace" }).click();
  await page.waitForURL("http://localhost:3117/", { timeout: 15000 });

  await expect(page.getByRole("link", { name: "Open settings" })).toBeVisible();

  await page.getByRole("link", { name: "Open settings" }).click();
  await expect(page.getByRole("heading", { name: "Settings" })).toBeVisible();

  await page.getByRole("link", { name: "Back to chat" }).click();
  await page.getByRole("button", { name: "New chat" }).click();

  await expect(page).toHaveURL(/\/chat\//);
  await expect(page.getByText("Active conversation")).toBeVisible();
});
