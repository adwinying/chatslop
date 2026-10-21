import { expect, test } from "@playwright/test";

// Matches dev.env, which `pnpm seed` applies.
const admin = {
  username: "admin",
  email: "admin@chatslop.invalid",
  password: "chatslop-dev-admin",
};

test("a signed-out visit redirects to /login", async ({ page }) => {
  await page.goto("/");
  await expect(page).toHaveURL("/login");
});

test("signup is rejected", async ({ request }) => {
  const res = await request.post("/api/auth/sign-up/email", {
    headers: { Origin: "http://localhost:3000" },
    data: { email: "intruder@example.com", password: "intruder-password", name: "Intruder" },
  });
  expect(res.status()).toBe(400);
  expect(await res.json()).toMatchObject({ code: "EMAIL_PASSWORD_SIGN_UP_DISABLED" });
});

test("the seeded Admin logs in, sees the shell over /convex, and logs out", async ({ page }) => {
  const sockets: string[] = [];
  page.on("websocket", (ws) => sockets.push(ws.url()));

  await page.goto("/login");
  await page.getByLabel("Username or email").fill(admin.username);
  await page.getByLabel("Password").fill(admin.password);
  await page.getByRole("button", { name: "Log in" }).click();

  await expect(page).toHaveURL("/");
  const sidebar = page.getByRole("complementary");
  await expect(sidebar.getByText("chatslop")).toBeVisible();
  await expect(sidebar.getByRole("button", { name: "New Chat" })).toBeVisible();
  // The footer's role comes from a Convex query, so it proves the socket works.
  await expect(sidebar.getByText("Admin", { exact: true })).toBeVisible();
  expect(sockets.some((url) => new URL(url).pathname.startsWith("/convex/api/"))).toBe(true);

  await sidebar.getByRole("button", { name: "Log out" }).click();
  await expect(page).toHaveURL("/login");
  await page.goto("/");
  await expect(page).toHaveURL("/login");
});

test("a wrong password shows an error", async ({ page }) => {
  await page.goto("/login");
  await page.getByLabel("Username or email").fill(admin.email);
  await page.getByLabel("Password").fill("wrong-password");
  await page.getByRole("button", { name: "Log in" }).click();

  await expect(page.getByRole("alert")).toBeVisible();
  await expect(page).toHaveURL("/login");
});
