import { test, type Page } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
import fs from "node:fs";
import path from "node:path";
import { loginAs, type PersonaKey } from "../support/personas";

// UI audit harness. Run with `pnpm test:audit` (HEADED=1 to watch in Chrome,
// SLOWMO=250 to slow it down). Not part of `pnpm test:e2e`.
// Output: test-results/audit/report.json, docs/acceptance-evidence/ui-audit.md,
// screenshots of failing pages in test-results/audit/.

type Severity = "high" | "medium" | "low";
type Finding = {
  persona: string;
  route: string;
  viewport: string;
  theme: string;
  state: string;
  kind: string;
  severity: Severity;
  detail: string;
};

const OUT = path.resolve("test-results/audit");
const REPORT_MD = path.resolve("docs/acceptance-evidence/ui-audit.md");
const ONLY = process.env.AUDIT_PERSONAS?.split(",");
const personaKeys = (
  ["employee", "manager", "hr", "auditor", "platform", "maya"] as PersonaKey[]
).filter((p) => !ONLY || ONLY.includes(p));
const VIEWPORTS = [
  { name: "1440x900", width: 1440, height: 900, theme: "light" },
  { name: "390x844", width: 390, height: 844, theme: "light" },
];
const findings: Finding[] = [];
const visits: { persona: string; route: string; viewport: string }[] = [];
let shots = 0;

// Runs inside the page. Returns raw findings (kind, severity, detail).
function domChecks(opts: { narrow: boolean }) {
  const out: { kind: string; severity: string; detail: string }[] = [];
  const add = (kind: string, severity: string, detail: string) =>
    out.push({ kind, severity, detail });
  const visible = (el: Element) => {
    const r = el.getBoundingClientRect();
    const s = getComputedStyle(el);
    return (
      r.width > 0 &&
      r.height > 0 &&
      s.visibility !== "hidden" &&
      s.display !== "none" &&
      Number(s.opacity) > 0
    );
  };
  const label = (el: Element) => {
    const t = (el.textContent ?? "").trim().replace(/\s+/g, " ").slice(0, 40);
    const cls =
      typeof el.className === "string"
        ? el.className.split(" ").slice(0, 2).join(".")
        : "";
    return `${el.tagName.toLowerCase()}${cls ? "." + cls : ""} "${t}"`;
  };
  const root = document.documentElement;
  // (a) page overflow
  if (root.scrollWidth > window.innerWidth + 1) {
    let worst: Element | null = null;
    let max = 0;
    for (const el of Array.from(document.body.querySelectorAll("*"))) {
      const r = el.getBoundingClientRect();
      if (
        r.width > 0 &&
        r.right > max &&
        getComputedStyle(el).position !== "fixed"
      ) {
        max = r.right;
        worst = el;
      }
    }
    add(
      "page-overflow",
      "high",
      `scrollWidth ${root.scrollWidth} > ${window.innerWidth}; widest: ${worst ? label(worst) : "?"} right=${Math.round(max)}`,
    );
  }
  // (b) clipped text
  const clipped: string[] = [];
  for (const el of Array.from(document.body.querySelectorAll("*"))) {
    if (clipped.length >= 8) break;
    const he = el as HTMLElement;
    if (he.scrollWidth <= he.clientWidth + 1 || he.clientWidth < 24) continue;
    if (
      el.closest(
        "[aria-hidden=true], [data-react-aria-prevent-focus], .sr-only",
      ) ||
      el.matches("caption")
    )
      continue;
    if (!visible(el)) continue;
    const s = getComputedStyle(el);
    const clips =
      s.textOverflow === "ellipsis" ||
      s.overflowX === "hidden" ||
      s.overflowX === "clip";
    if (!clips) continue;
    if (!(el.textContent ?? "").trim()) continue;
    // Overflow caused only by decorative art (svg, aria-hidden) is not clipped text.
    {
      const box = el.getBoundingClientRect();
      const culprit = Array.from(el.querySelectorAll("*")).find(
        (k) =>
          k.getBoundingClientRect().right > box.right + 1 &&
          k.getBoundingClientRect().width > 0,
      );
      if (
        culprit &&
        (culprit.closest("svg") ||
          culprit.closest("[aria-hidden=true]") ||
          culprit.closest(".aurora"))
      )
        continue;
    }
    if (
      el.closest("[title],[aria-label],[data-tooltip]") &&
      (el.getAttribute("title") || el.getAttribute("aria-label"))
    )
      continue;
    if (el.hasAttribute("title")) continue;
    clipped.push(label(el));
  }
  for (const c of clipped) add("clipped-text", "medium", c);
  // (c) overlapping siblings in headers/toolbars
  const bars = document.querySelectorAll(
    "header, [role=toolbar], [class*=toolbar], .page-heading, .page-heading-actions, [class*=filters]",
  );
  let overlaps = 0;
  for (const bar of Array.from(bars)) {
    if (overlaps >= 5) break;
    const kids = Array.from(bar.children).filter((k) => {
      if (!visible(k)) return false;
      const p = getComputedStyle(k).position;
      return p !== "absolute" && p !== "fixed" && p !== "sticky";
    });
    for (let i = 0; i < kids.length && overlaps < 5; i++)
      for (let j = i + 1; j < kids.length; j++) {
        const a = kids[i]!.getBoundingClientRect();
        const b = kids[j]!.getBoundingClientRect();
        const w = Math.min(a.right, b.right) - Math.max(a.left, b.left);
        const h = Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top);
        if (w > 4 && h > 4) {
          overlaps++;
          add("overlap", "high", `${label(kids[i]!)} x ${label(kids[j]!)}`);
          break;
        }
      }
  }
  // (d) small targets on phones
  if (opts.narrow) {
    const small: string[] = [];
    const sel =
      "a[href], button, input:not([type=hidden]), select, textarea, [role=button], [role=tab], [role=menuitem], [role=option], [role=checkbox], [role=radio], [role=switch]";
    for (const el of Array.from(document.querySelectorAll(sel))) {
      if (!visible(el)) continue;
      const r = el.getBoundingClientRect();
      if (r.height >= 43.5 || r.width <= 2) continue;
      const s = getComputedStyle(el);
      if (el.tagName === "A" && s.display === "inline") continue; // inline text link
      if (el.closest("[inert],[aria-hidden=true]")) continue;
      if (el.tagName === "INPUT") {
        const t = (el as HTMLInputElement).type;
        if (t === "checkbox" || t === "radio") {
          const lab = el.closest("label");
          if (lab && lab.getBoundingClientRect().height >= 43.5) continue;
        }
      }
      small.push(`${label(el)} ${Math.round(r.width)}x${Math.round(r.height)}`);
    }
    for (const s of small.slice(0, 10)) add("small-target", "medium", s);
    if (small.length > 10)
      add("small-target", "medium", `... and ${small.length - 10} more`);
  }
  // (e) exactly one h1
  const h1 = Array.from(document.querySelectorAll("h1")).filter(visible);
  if (h1.length !== 1) add("h1-count", "high", `${h1.length} visible h1`);
  // (h) long lists without pagination
  const hasPager = Boolean(
    document.querySelector(
      "[aria-label*=agination i], nav[aria-label*=page i], [data-pagination]",
    ) ||
    Array.from(document.querySelectorAll("button, a")).some((b) =>
      /^(next|next page|load more|show more)$/i.test(
        (b.getAttribute("aria-label") ?? b.textContent ?? "").trim(),
      ),
    ),
  );
  if (!hasPager) {
    for (const parent of Array.from(
      document.querySelectorAll("tbody, ul, ol, div, section"),
    )) {
      const kids = Array.from(parent.children).filter(visible);
      if (kids.length <= 25) continue;
      const tag = kids[0]!.tagName;
      const same = kids.filter((k) => k.tagName === tag).length;
      if (
        same > 25 &&
        !parent.closest("select, [role=listbox], [role=menu]") &&
        !/calendar|attendance-grid|month/i.test(String(parent.className))
      )
        add(
          "no-pagination",
          "medium",
          `${label(parent)} renders ${same} ${tag.toLowerCase()} items`,
        );
    }
  }
  // (i) dialogs taller than the viewport without scrolling
  for (const d of Array.from(document.querySelectorAll("[role=dialog]"))) {
    if (!visible(d)) continue;
    const r = d.getBoundingClientRect();
    if (
      r.height <= window.innerHeight + 1 &&
      r.bottom <= window.innerHeight + 1
    )
      continue;
    const scrolls = [d, ...Array.from(d.querySelectorAll("*"))].some((n) => {
      const s = getComputedStyle(n);
      return (
        (s.overflowY === "auto" || s.overflowY === "scroll") &&
        (n as HTMLElement).scrollHeight > (n as HTMLElement).clientHeight
      );
    });
    // an ancestor (the modal overlay) may scroll instead
    let anc: Element | null = d.parentElement;
    let ancScrolls = false;
    while (anc) {
      const s = getComputedStyle(anc);
      if (s.overflowY === "auto" || s.overflowY === "scroll") ancScrolls = true;
      anc = anc.parentElement;
    }
    if (!scrolls && !ancScrolls)
      add(
        "dialog-overflow",
        "high",
        `${label(d)} height ${Math.round(r.height)} > ${window.innerHeight}`,
      );
  }
  // (j) error / empty states where data is expected
  const main = document.querySelector("main") ?? document.body;
  const text = (main as HTMLElement).innerText ?? "";
  const err = text.match(
    /(couldn.?t load[^\n]{0,60}|something went wrong[^\n]{0,40}|failed to [^\n]{0,50})/i,
  );
  if (err) add("error-state", "medium", err[0]);
  const empty = text.match(
    /(no [a-z ]{3,30} (yet|found)[^\n]{0,30}|nothing (here|to show)[^\n]{0,30})/i,
  );
  if (empty) add("empty-state", "low", empty[0]);
  return out;
}

async function settle(page: Page) {
  await page.waitForLoadState("domcontentloaded");
  await page
    .locator("main h1, h1")
    .first()
    .waitFor({ timeout: 8000 })
    .catch(() => undefined);
  await page
    .waitForLoadState("networkidle", { timeout: 4000 })
    .catch(() => undefined);
  await page.waitForTimeout(250);
}

function slug(s: string) {
  return s.replace(/[^a-z0-9]+/gi, "-").replace(/^-|-$/g, "") || "root";
}

test.describe.configure({ mode: "serial" });

for (const persona of personaKeys) {
  test(`audit ${persona}`, async ({ page: page0, browser, baseURL }) => {
    let page = page0;
    test.setTimeout(25 * 60 * 1000);
    const noise: { kind: string; severity: Severity; detail: string }[] = [];
    const attach = (p: Page) => {
      p.on("console", (m) => {
        if (m.type() !== "error") return;
        const t = m.text();
        if (/status of (401|403|429|502|503|504)/.test(t)) return;
        noise.push({
          kind: "console-error",
          severity: "high",
          detail: t.slice(0, 200),
        });
      });
      p.on("pageerror", (e) =>
        noise.push({
          kind: "page-error",
          severity: "high",
          detail: e.message.slice(0, 200),
        }),
      );
      p.on("response", (r) => {
        const s = r.status();
        if (s < 400 || s === 401 || s === 403 || s === 429) return;
        // 502-504 mean the dev API restarted mid-run: environment, not UI.
        const infra = s >= 502 && s <= 504;
        noise.push({
          kind: infra ? "infra-gateway" : "http-" + (s >= 500 ? "5xx" : "4xx"),
          severity: infra ? "low" : s >= 500 ? "high" : "medium",
          detail: `${s} ${r.request().method()} ${new URL(r.url()).pathname}`,
        });
      });
    };
    attach(page);

    await page.setViewportSize({ width: 1440, height: 900 });
    await loginAs(page, persona);
    const links = await page
      .locator("nav[aria-label] a[href]")
      .evaluateAll((as) =>
        Array.from(new Set(as.map((a) => a.getAttribute("href") ?? ""))).filter(
          (h) => h.startsWith("/"),
        ),
      );
    const routes = Array.from(new Set(["/", ...links]));

    const runChecks = async (
      route: string,
      vp: (typeof VIEWPORTS)[number],
      theme: string,
      state: string,
    ) => {
      const push = (kind: string, severity: string, detail: string) =>
        findings.push({
          persona,
          route,
          viewport: vp.name,
          theme,
          state,
          kind,
          severity: severity as Severity,
          detail,
        });
      const before = findings.length;
      const infra = noise.some((n) => n.kind === "infra-gateway");
      for (const f of await page.evaluate(domChecks, {
        narrow: vp.width < 600,
      }))
        if (!(infra && f.kind === "h1-count"))
          push(f.kind, f.severity, f.detail);
      try {
        const axe = await new AxeBuilder({ page })
          .withTags(["wcag2a", "wcag2aa", "wcag21aa", "wcag22aa"])
          .analyze();
        for (const v of axe.violations)
          push(
            "axe:" + v.id,
            v.impact === "critical" || v.impact === "serious"
              ? "high"
              : "medium",
            `${v.nodes.length} node(s), e.g. ${v.nodes[0]?.target.join(" ")}`,
          );
      } catch (e) {
        push("axe-error", "low", String(e).slice(0, 120));
      }
      for (const n of noise.splice(0)) push(n.kind, n.severity, n.detail);
      const added = findings.slice(before);
      if (added.some((f) => f.severity !== "low") && shots < 150) {
        shots++;
        fs.mkdirSync(OUT, { recursive: true });
        await page
          .screenshot({
            path: path.join(
              OUT,
              `${persona}-${vp.name}-${theme}-${slug(route)}-${slug(state)}.png`,
            ),
            fullPage: false,
          })
          .catch(() => undefined);
      }
    };

    const matrix = [
      ...VIEWPORTS.map((vp) => ({ vp, theme: "light" })),
      ...(persona === "maya" ? [{ vp: VIEWPORTS[0]!, theme: "dark" }] : []),
    ];
    for (const { vp, theme } of matrix) {
      if (vp.width < 600) {
        // Phones are touch devices: coarse pointer, so the 44px rules apply.
        const context = await browser.newContext({
          baseURL,
          viewport: { width: vp.width, height: vp.height },
          isMobile: true,
          hasTouch: true,
          deviceScaleFactor: 2,
          storageState: await page0.context().storageState(),
        });
        page = await context.newPage();
        attach(page);
      } else {
        page = page0;
        await page.setViewportSize({ width: vp.width, height: vp.height });
      }
      await page.emulateMedia({ colorScheme: theme as "light" | "dark" });
      await page.addInitScript((t) => {
        try {
          document.documentElement.setAttribute("data-theme", t);
        } catch {
          /* ignore */
        }
      }, theme);
      for (const route of routes) {
        visits.push({
          persona,
          route,
          viewport: vp.name + (theme === "dark" ? "-dark" : ""),
        });
        noise.length = 0;
        await page.goto(route).catch(() => undefined);
        await settle(page);
        await runChecks(route, vp, theme, "page");
        // every tab
        const tabCount = await page.getByRole("tab").count();
        for (let i = 0; i < Math.min(tabCount, 12); i++) {
          const tab = page.getByRole("tab").nth(i);
          if (!(await tab.isVisible().catch(() => false))) continue;
          const name = ((await tab.innerText().catch(() => "")) || `tab ${i}`)
            .trim()
            .slice(0, 30);
          await tab.click({ timeout: 3000 }).catch(() => undefined);
          await page.waitForTimeout(300);
          await page
            .waitForLoadState("networkidle", { timeout: 3000 })
            .catch(() => undefined);
          await runChecks(route, vp, theme, `tab:${name}`);
        }
        // first dialog trigger, then Escape
        const trigger = page
          .locator("main")
          .getByRole("button", {
            name: /^(new|add|create|request|apply|log|submit|record|raise|start|invite|upload|view|details|open)/i,
          })
          .first();
        if (await trigger.isVisible().catch(() => false)) {
          await trigger.click({ timeout: 3000 }).catch(() => undefined);
          await page.waitForTimeout(400);
          if (
            await page
              .getByRole("dialog")
              .first()
              .isVisible()
              .catch(() => false)
          ) {
            await runChecks(route, vp, theme, "dialog");
            await page.keyboard.press("Escape");
            await page.waitForTimeout(200);
          }
        }
        // first table row / card
        const row = page
          .locator("main tbody [role=row], main tbody tr")
          .first();
        if (await row.isVisible().catch(() => false)) {
          const url = page.url();
          await row
            .click({ timeout: 3000, position: { x: 8, y: 8 } })
            .catch(() => undefined);
          await page.waitForTimeout(400);
          if (
            await page
              .getByRole("dialog")
              .first()
              .isVisible()
              .catch(() => false)
          ) {
            await runChecks(route, vp, theme, "row-dialog");
            await page.keyboard.press("Escape");
          } else if (page.url() !== url) {
            await settle(page);
            await runChecks(route, vp, theme, "row-detail");
          }
        }
      }
    }
  });
}

test.afterAll(() => {
  fs.mkdirSync(OUT, { recursive: true });
  // Merge with earlier partial runs only when AUDIT_PERSONAS limits this one.
  const reportFile = path.join(OUT, "report.json");
  const baselineFile = path.resolve(
    "docs/acceptance-evidence/ui-audit-baseline.json",
  );
  const all = findings;
  fs.writeFileSync(
    reportFile,
    JSON.stringify({ visits: visits.length, findings: all }, null, 1),
  );
  const key = (f: Finding) =>
    `${f.route}|${f.kind}|${f.viewport.replace("-dark", "")}`;
  const baseline: Finding[] | null = fs.existsSync(baselineFile)
    ? (
        JSON.parse(fs.readFileSync(baselineFile, "utf8")) as {
          findings: Finding[];
        }
      ).findings
    : null;
  const group = (list: Finding[]) => {
    const m = new Map<
      string,
      {
        sample: Finding;
        n: number;
        personas: Set<string>;
        details: Set<string>;
      }
    >();
    for (const f of list) {
      const k = key(f);
      const g = m.get(k) ?? {
        sample: f,
        n: 0,
        personas: new Set(),
        details: new Set(),
      };
      g.n++;
      g.personas.add(f.persona);
      if (g.details.size < 2) g.details.add(f.detail);
      m.set(k, g);
    }
    return m;
  };
  const cur = group(all);
  const base = baseline ? group(baseline) : null;
  const rank = { high: 0, medium: 1, low: 2 } as const;
  const count = (m: ReturnType<typeof group>, sev: Severity) =>
    Array.from(m.values()).filter((g) => g.sample.severity === sev).length;
  const routes = Array.from(new Set(all.map((f) => f.route))).sort();
  const lines: string[] = [];
  lines.push("# UI audit", "");
  lines.push(
    `Generated by \`pnpm test:audit\` (tests/e2e/audit/ui-audit.spec.ts). ${visits.length} page visits across personas, 1440x900 and 390x844 light, plus 1440 dark for the all-roles persona. Each visit also opens every tab, the first dialog trigger and the first table row.`,
    "",
    "Findings are grouped by route, check and viewport (one row = distinct problem, repeated across personas). Severity: high = broken layout, a11y serious/critical, errors; medium = clipping, small targets, missing pagination, moderate a11y; low = informational empty states.",
    "",
  );
  lines.push("## Totals", "", "| | High | Medium | Low |", "|---|---|---|---|");
  lines.push(
    `| Now | ${count(cur, "high")} | ${count(cur, "medium")} | ${count(cur, "low")} |`,
  );
  if (base)
    lines.push(
      `| Baseline | ${count(base, "high")} | ${count(base, "medium")} | ${count(base, "low")} |`,
    );
  lines.push(
    "",
    "## By route",
    "",
    "| Route | High | Medium | Low |",
    "|---|---|---|---|",
  );
  for (const r of routes) {
    const g = Array.from(cur.values()).filter((x) => x.sample.route === r);
    const c = (s: Severity) => g.filter((x) => x.sample.severity === s).length;
    lines.push(`| ${r} | ${c("high")} | ${c("medium")} | ${c("low")} |`);
  }
  lines.push(
    "",
    "## Findings",
    "",
    "| Status | Sev | Route | Check | Viewport | Personas | Detail |",
    "|---|---|---|---|---|---|---|",
  );
  const sorted = Array.from(cur.entries()).sort(
    (a, b) =>
      rank[a[1].sample.severity] - rank[b[1].sample.severity] ||
      a[0].localeCompare(b[0]),
  );
  for (const [k, g] of sorted) {
    const status = base ? (base.has(k) ? "open" : "new") : "baseline";
    lines.push(
      `| ${status} | ${g.sample.severity} | ${g.sample.route} | ${g.sample.kind} | ${g.sample.viewport} | ${Array.from(g.personas).join(", ")} | ${Array.from(g.details).join("; ").replace(/\|/g, "/").slice(0, 160)} |`,
    );
  }
  if (base) {
    lines.push("", "## Fixed since baseline", "");
    const fixed = Array.from(base.entries()).filter(([k]) => !cur.has(k));
    for (const [k, g] of fixed) lines.push(`- ${g.sample.severity}: ${k}`);
    if (!fixed.length) lines.push("- none");
  }
  // Hand-written status (what was fixed, what is pending) lives beside the spec.
  const notes = path.resolve("tests/e2e/audit/audit-notes.md");
  if (fs.existsSync(notes)) lines.push("", fs.readFileSync(notes, "utf8"));
  lines.push("");
  fs.mkdirSync(path.dirname(REPORT_MD), { recursive: true });
  fs.writeFileSync(REPORT_MD, lines.join("\n"));
  if (!baseline) fs.copyFileSync(reportFile, baselineFile);
});
