/**
 * Visual verification for the Phase 4 frontend. Captures the landing page and
 * the design system gallery in both themes at three widths, and reports console
 * errors, page errors and horizontal overflow.
 */
import { chromium } from "playwright";
import { mkdirSync, rmSync, appendFileSync } from "node:fs";
import { join } from "node:path";

const OUT = join(process.cwd(), "_shots");
const BASE = process.env.BASE_URL ?? "http://127.0.0.1:3000";

const PAGES = [
  { name: "landing", path: "/" },
  { name: "design", path: "/design" },
];

const VIEWPORTS = [
  { name: "desktop", width: 1440, height: 1000 },
  { name: "tablet", width: 834, height: 1100 },
  { name: "mobile", width: 390, height: 880 },
];

rmSync(OUT, { recursive: true, force: true });
mkdirSync(OUT, { recursive: true });

const browser = await chromium.launch();
const problems = [];

for (const theme of ["light", "dark"]) {
  for (const page of PAGES) {
    for (const vp of VIEWPORTS) {
      const context = await browser.newContext({
        viewport: { width: vp.width, height: vp.height },
        deviceScaleFactor: 1,
      });

      // Seed the stored choice so next-themes resolves before first paint.
      await context.addInitScript((mode) => {
        try {
          localStorage.setItem("ownex.theme", mode);
        } catch {}
      }, theme);

      const tab = await context.newPage();
      const tag = `${theme}/${page.name}/${vp.name}`;
      tab.on("console", (msg) => {
        if (msg.type() !== "error") return;
        // Every page probes /api/identity/me once to find out whether anybody is
        // signed in, and a 401 is the answer "nobody is". The browser logs it as
        // an error; it is not one.
        if (/status of 401/.test(msg.text())) return;
        problems.push(`${tag} console: ${msg.text()}`);
      });
      tab.on("pageerror", (err) => problems.push(`${tag} pageerror: ${err.message}`));

      await tab.goto(`${BASE}${page.path}`, {
        waitUntil: "networkidle",
        timeout: 90_000,
      });
      await tab.waitForTimeout(1800);

      await tab.screenshot({
        path: join(OUT, `${theme}-${page.name}-${vp.name}.png`),
        animations: "disabled",
      });
      await tab.screenshot({
        path: join(OUT, `${theme}-${page.name}-${vp.name}-full.png`),
        fullPage: true,
        animations: "disabled",
      });

      const metrics = await tab.evaluate(() => {
        const de = document.documentElement;
        return {
          scrollW: de.scrollWidth,
          clientW: de.clientWidth,
          htmlClass: de.className,
          bg: getComputedStyle(document.body).backgroundColor,
        };
      });

      if (metrics.scrollW > metrics.clientW + 1) {
        problems.push(
          `${tag} horizontal overflow: ${metrics.scrollW} > ${metrics.clientW}`,
        );
      }

      appendFileSync(
        join(OUT, "report.txt"),
        `${tag.padEnd(30)} bg=${metrics.bg} class="${metrics.htmlClass.trim()}" scrollW=${metrics.scrollW}\n`,
      );

      await context.close();
    }
  }
}

await browser.close();

appendFileSync(
  join(OUT, "report.txt"),
  problems.length ? `\nPROBLEMS:\n${problems.join("\n")}\n` : "\nPROBLEMS: none\n",
);
console.log(problems.length ? `PROBLEMS:\n${problems.join("\n")}` : "PROBLEMS: none");
