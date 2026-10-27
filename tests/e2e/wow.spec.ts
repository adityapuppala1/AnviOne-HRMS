import { test, expect, type Page } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";

async function accessible(page: Page) {
  const result = await new AxeBuilder({ page })
    .withTags(["wcag2a", "wcag2aa", "wcag21aa", "wcag22aa"])
    .analyze();
  expect(
    result.violations.map((v) => ({
      id: v.id,
      nodes: v.nodes.map((n) => n.target),
    })),
  ).toEqual([]);
}
async function enter(page: Page) {
  await page.goto("/login");
  await page.getByRole("button", { name: "Explore demo workspace" }).click();
  await expect(
    page.getByRole("heading", { name: "Good to see you, Maya." }),
  ).toBeVisible();
}
// How many canvas pixels carry any colour at all.
const paintedPixels = (page: Page) =>
  page.evaluate(() => {
    const canvas = document.querySelector<HTMLCanvasElement>(".holo-globe");
    const data = canvas
      ?.getContext("2d")
      ?.getImageData(0, 0, canvas.width, canvas.height).data;
    let count = 0;
    if (data)
      for (let i = 3; i < data.length; i += 4) if (data[i]! > 0) count++;
    return count;
  });
const frame = (page: Page) =>
  page.evaluate(() =>
    document.querySelector<HTMLCanvasElement>(".holo-globe")!.toDataURL(),
  );

test("sign-in opens on a living globe", async ({ page }, info) => {
  test.setTimeout(90000);
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto("/login");
  const canvas = page.locator(".holo-globe");
  await expect(canvas).toHaveAttribute("data-ready", "true");
  expect(await paintedPixels(page)).toBeGreaterThan(5000);
  await expect(page.locator(".orbit-pin")).toHaveCount(6);
  await expect(page.locator(".float-card")).toHaveCount(3);

  // The globe turns on its own.
  const before = await frame(page);
  await page.waitForTimeout(900);
  expect(await frame(page)).not.toBe(before);

  // Dragging anywhere on the globe spins it, even under the orbit rings.
  const box = (await canvas.boundingBox())!;
  const centre = { x: box.x + box.width / 2, y: box.y + box.height / 2 };
  const beforeDrag = await frame(page);
  await page.mouse.move(centre.x - 60, centre.y);
  await page.mouse.down();
  await page.mouse.move(centre.x + 60, centre.y, { steps: 8 });
  await page.mouse.up();
  expect(await frame(page)).not.toBe(beforeDrag);

  // The scene leans toward the pointer and a light follows it.
  await page.mouse.move(80, 80);
  await page.mouse.move(1360, 820, { steps: 12 });
  await expect
    .poll(() =>
      page
        .locator(".globe-stage")
        .evaluate((el) => parseFloat(el.style.getPropertyValue("--px") || "0")),
    )
    .toBeGreaterThan(0.3);
  await expect(page.locator(".cursor-glow[data-active]")).toHaveCount(1);

  await accessible(page);
  await page.screenshot({
    path: info.outputPath("wow-login.png"),
    fullPage: true,
  });

  // No sideways scroll on phones, where the globe is replaced by the form.
  await page.setViewportSize({ width: 390, height: 844 });
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth,
    ),
  ).toBe(true);
});

test("home counts up, shows Anvi Assist honestly and respects dark mode", async ({
  page,
}, info) => {
  test.setTimeout(90000);
  await page.setViewportSize({ width: 1440, height: 1000 });
  await enter(page);
  await expect(page.locator(".loom-band .holo-globe")).toHaveAttribute(
    "data-ready",
    "true",
  );
  await expect(page.locator(".loom-band .orbit-pin").first()).toBeVisible();

  // Count-up numbers settle on whole values.
  const total = page.locator(".loom-stat-value").first();
  await expect(total).toHaveText(/^\d{2,}$/);

  const assist = page.getByRole("region", { name: "Anvi Assist" });
  await expect(assist).toBeVisible();
  await expect(assist).toContainText("AI helper is off");
  await expect(
    assist.getByRole("heading", { name: "Suggested next steps" }),
  ).toBeVisible();
  expect(await assist.getByRole("link").count()).toBeGreaterThan(0);

  await accessible(page);
  await page.screenshot({
    path: info.outputPath("wow-home.png"),
    fullPage: true,
  });

  await page.getByRole("button", { name: "Use dark theme" }).click();
  await accessible(page);
  await page.screenshot({
    path: info.outputPath("wow-home-dark.png"),
    fullPage: true,
  });
  await page.getByRole("button", { name: "Use light theme" }).click();

  await page.setViewportSize({ width: 390, height: 900 });
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth,
    ),
  ).toBe(true);
  await page.screenshot({
    path: info.outputPath("wow-home-mobile.png"),
    fullPage: true,
  });
});

test("reduced motion holds every effect still", async ({ page }) => {
  test.setTimeout(90000);
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto("/login");
  await expect(page.locator(".holo-globe")).toHaveAttribute(
    "data-ready",
    "true",
  );
  // The globe is painted once and never redrawn.
  expect(await paintedPixels(page)).toBeGreaterThan(5000);
  const still = await frame(page);
  await page.waitForTimeout(800);
  expect(await frame(page)).toBe(still);
  // No decorative animation is running.
  const running = await page.evaluate(
    () =>
      document
        .getAnimations()
        .filter((a) =>
          (a.effect as KeyframeEffect | null)?.target?.closest?.(
            ".login-story, .ambient, .cursor-glow",
          ),
        ).length,
  );
  expect(running).toBe(0);
  await expect(page.locator(".cursor-glow")).toBeHidden();
  await accessible(page);
});
