import { expect, test } from "@playwright/test";

const EIDON_TEST_PASSWORD = process.env.EIDON_TEST_PASSWORD ?? "changeme123";

test("404 page offers a way back home", async ({ page }) => {
  await page.goto("/");
  await expect(page).toHaveURL(/\/login$/);

  await page.getByPlaceholder("Username").fill("admin");
  await page.getByPlaceholder("Password").fill(EIDON_TEST_PASSWORD);
  await page.getByRole("button", { name: "Proceed" }).click();
  await page.waitForURL(/\/(onboarding)?\/?$/, { timeout: 15000 });
  await page.request.put("/api/onboarding", { data: { completed: true } });

  await page.goto("/nonexistent-page-xyz");

  await expect(page.getByText("Page not found")).toBeVisible();
  const goHome = page.getByRole("link", { name: "Go home" });
  await expect(goHome).toBeVisible();

  await goHome.click();
  await page.waitForURL("http://localhost:3117/", { timeout: 15000 });
  await expect(page.getByRole("link", { name: "Open settings" })).toBeVisible({ timeout: 10000 });
});
