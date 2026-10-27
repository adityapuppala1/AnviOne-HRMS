import { test, expect, type Page } from "@playwright/test";

// Every screen must adapt to phones, tablets and desktops: no sideways scroll,
// no clipped content, and touch targets that meet WCAG 2.2 AA (24 CSS px).
const SIZES = [
  { name: "narrowest phone", width: 320, height: 640 },
  { name: "small phone", width: 360, height: 740 },
  { name: "phone", width: 390, height: 844 },
  { name: "tablet portrait", width: 768, height: 1024 },
  { name: "tablet landscape", width: 1024, height: 768 },
  { name: "laptop", width: 1440, height: 900 },
  { name: "wide desktop", width: 1920, height: 1080 },
] as const;
const ROUTES = [
  "/",
  "/people",
  "/teams",
  "/organization",
  "/candidates",
  "/leave",
  "/attendance",
  "/calendar",
  "/approvals",
  "/documents",
  "/preferences",
  "/settings",
  "/tasks",
  "/activity",
  "/insights",
  "/help",
];

async function problems(page: Page, touch: boolean) {
  return page.evaluate((isTouch) => {
    const found: string[] = [];
    const width = window.innerWidth;
    if (document.documentElement.scrollWidth > width)
      found.push(
        `page scrolls sideways (${document.documentElement.scrollWidth} > ${width})`,
      );
    const visible = (el: Element) => {
      const box = el.getBoundingClientRect();
      const style = getComputedStyle(el);
      return (
        box.width > 0 &&
        box.height > 0 &&
        style.visibility !== "hidden" &&
        style.display !== "none"
      );
    };
    const inScroller = (el: Element) => {
      for (let p = el.parentElement; p; p = p.parentElement) {
        const o = getComputedStyle(p).overflowX;
        if (o === "auto" || o === "scroll" || o === "hidden") return true;
      }
      return false;
    };
    for (const el of document.querySelectorAll("main *")) {
      if (!visible(el) || inScroller(el)) continue;
      const box = el.getBoundingClientRect();
      if (box.right > width + 1 && box.left < width)
        found.push(
          `clipped: ${el.tagName.toLowerCase()}.${String(el.className).split(" ")[0]} ends at ${Math.round(box.right)}`,
        );
    }
    if (isTouch) {
      const controls = document.querySelectorAll(
        "a[href], button, select, input:not([type=hidden]), [role=tab]",
      );
      for (const el of controls) {
        if (!visible(el) || el.closest("[aria-hidden=true]")) continue;
        // Inline links inside running text are exempt under WCAG 2.5.8.
        if (el.tagName === "A" && el.closest("p, li, small")) continue;
        const box = el.getBoundingClientRect();
        // Visually hidden inputs are operated through their visible label.
        if (box.width <= 1 && box.height <= 44) continue;
        if (box.width < 24 || box.height < 24)
          found.push(
            `small target: ${el.tagName.toLowerCase()} "${(el.textContent ?? "").trim().slice(0, 24)}" ${Math.round(box.width)}x${Math.round(box.height)}`,
          );
      }
    }
    return [...new Set(found)].slice(0, 8);
  }, touch);
}

test("every screen adapts from phone to wide desktop", async ({ page }) => {
  test.setTimeout(240000);
  await page.goto("/login");
  await page.getByRole("button", { name: "Explore demo workspace" }).click();
  await expect(page.getByRole("heading", { level: 1 }).first()).toBeVisible();
  const report: string[] = [];
  // Load each screen once and resize the window through every size: layouts
  // must adapt live, and it keeps requests well inside the API rate limit.
  for (const route of ROUTES) {
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto(route);
    await expect(page.locator("main").first()).toBeVisible();
    for (const size of SIZES) {
      await page.setViewportSize({ width: size.width, height: size.height });
      // Let layout and count-up settle before measuring.
      await page.waitForTimeout(250);
      const found = await problems(page, size.width < 1100);
      for (const item of found) report.push(`${size.name} ${route}: ${item}`);
    }
  }
  expect(report).toEqual([]);
});

test("phones get a bottom bar; tablets and desktops keep the rail", async ({
  page,
}, info) => {
  test.setTimeout(90000);
  await page.goto("/login");
  await page.getByRole("button", { name: "Explore demo workspace" }).click();
  await expect(page.getByRole("heading", { level: 1 }).first()).toBeVisible();

  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/");
  const bar = page.getByRole("navigation", { name: "Quick navigation" });
  await expect(bar).toBeVisible();
  await expect(bar.getByRole("link")).toHaveCount(4);
  await expect(bar.getByRole("button", { name: "More" })).toBeVisible();
  // The bar never covers the end of the page.
  const clear = await page.evaluate(() => {
    window.scrollTo(0, document.documentElement.scrollHeight);
    const bar = document.querySelector(".bottom-bar")!.getBoundingClientRect();
    const last = document.querySelector("main")!.getBoundingClientRect();
    return last.bottom <= bar.top + 1;
  });
  expect(clear).toBe(true);
  await expect(
    page.getByRole("heading", { name: "Good to see you, Maya." }),
  ).toBeVisible();
  await page.screenshot({ path: info.outputPath("phone-home.png") });
  await bar.getByRole("button", { name: "More" }).click();
  await expect(page.getByRole("dialog")).toBeVisible();
  await page.keyboard.press("Escape");
  await bar.getByRole("link", { name: "Leave" }).click();
  await expect(page).toHaveURL(/\/leave$/);

  for (const width of [768, 1024, 1440]) {
    await page.setViewportSize({ width, height: 900 });
    await expect(bar).toBeHidden();
  }
  await page.setViewportSize({ width: 820, height: 1180 });
  await page.goto("/");
  await expect(
    page.getByRole("heading", { name: "Good to see you, Maya." }),
  ).toBeVisible();
  await page.waitForTimeout(600);
  await page.screenshot({ path: info.outputPath("tablet-home.png") });
});
