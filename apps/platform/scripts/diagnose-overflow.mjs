/** Reports every element wider than the viewport, so overflow is fixed at source. */
import { chromium } from "playwright";

const BASE = process.env.BASE_URL ?? "http://127.0.0.1:3000";
const browser = await chromium.launch();

for (const theme of ["dark", "light"]) {
  const context = await browser.newContext({
    viewport: { width: 390, height: 880 },
  });
  await context.addInitScript((mode) => {
    try {
      localStorage.setItem("ownex.theme", mode);
    } catch {}
  }, theme);

  const page = await context.newPage();
  await page.goto(`${BASE}/`, { waitUntil: "networkidle", timeout: 90_000 });
  await page.waitForTimeout(1500);

  const result = await page.evaluate(() => {
    const vw = document.documentElement.clientWidth;

    // An element inside a deliberately scrollable strip is allowed to sit past
    // the viewport; that is what the strip is for. Only report elements that
    // actually widen the page.
    const inScroller = (el) => {
      let node = el.parentElement;
      while (node && node !== document.body) {
        const overflowX = getComputedStyle(node).overflowX;
        if (overflowX === "auto" || overflowX === "scroll") return true;
        node = node.parentElement;
      }
      return false;
    };

    const offenders = [];
    for (const el of document.querySelectorAll("*")) {
      const r = el.getBoundingClientRect();
      if (r.width === 0 && r.height === 0) continue;
      if (r.right <= vw + 0.5 && r.left >= -0.5) continue;
      if (inScroller(el)) continue;
      offenders.push({
        tag: el.tagName.toLowerCase(),
        cls: (el.className || "").toString().slice(0, 90),
        left: Math.round(r.left),
        right: Math.round(r.right),
        width: Math.round(r.width),
        text: (el.textContent || "").trim().slice(0, 34),
      });
    }
    return {
      vw,
      scrollW: document.documentElement.scrollWidth,
      offenders: offenders.slice(0, 12),
    };
  });

  console.log(`\n[${theme}] viewport=${result.vw} scrollWidth=${result.scrollW}`);
  if (result.offenders.length === 0) {
    console.log("  no overflowing elements");
  } else {
    for (const o of result.offenders) {
      console.log(
        `  ${o.tag} l=${o.left} r=${o.right} w=${o.width} | ${o.cls} | "${o.text}"`,
      );
    }
  }

  await context.close();
}

await browser.close();
