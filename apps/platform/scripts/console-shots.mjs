/**
 * Visual verification for the console.
 *
 *   node scripts/console-shots.mjs
 *
 * `shots.mjs` only reaches the landing page and `/design`, because every console
 * screen is behind a wallet signature. So this script brings its own wallet: it
 * injects an EIP-6963 provider that announces itself exactly as a real one does,
 * and signs the challenge with a Hardhat test key through an exposed binding.
 * The signature is real, the SIWE handshake is the real one, and the session
 * cookie is issued by the real endpoint — nothing is stubbed on the server side.
 *
 * Captures both themes at 1440 and 390, and reports console errors, page errors
 * and any element wider than the viewport.
 *
 * Prerequisites: a running chain, a seeded org, and this app on :3000.
 */
import { chromium } from "playwright";
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { Wallet, toUtf8String } from "ethers";

const BASE = process.env.BASE_URL ?? "http://localhost:3000";
const OUT = join(process.cwd(), "_shots-console");
const CHAIN_ID_HEX = "0x7a69"; // 31337

/** Publicly known Hardhat keys. Local test ETH only. */
const ACTORS = [
  {
    key: "admin",
    pk: "0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d",
    label: "Priya Sharma, root ADMIN",
    full: true,
  },
  {
    key: "user",
    pk: "0x47e179ec197488593b187f80a00eb0da91f1b9d0b13f8733639f19c30a34926a",
    label: "Arjun Mehta, plain USER",
    full: false,
  },
];

const ROUTES = [
  { name: "overview", path: "/dashboard" },
  { name: "identity", path: "/dashboard/identity" },
  { name: "members", path: "/dashboard/members" },
  { name: "roles", path: "/dashboard/roles" },
  { name: "assets", path: "/dashboard/assets" },
  { name: "asset-1", path: "/dashboard/assets/1" },
  { name: "mint", path: "/dashboard/assets/new" },
  { name: "applications", path: "/dashboard/applications" },
  { name: "audit", path: "/dashboard/audit" },
];

const VIEWPORTS = [
  { name: "1440", width: 1440, height: 1000 },
  { name: "390", width: 390, height: 880 },
];

/**
 * The injected provider, as a string because it has to run in the page before
 * any application script does.
 *
 * `personal_sign` is the only method that needs real cryptography, and it is
 * handed back to Node through a binding rather than reimplemented here.
 */
function initScript({ address, chainIdHex, theme }) {
  return `
    try { localStorage.setItem("ownex.theme", ${JSON.stringify(theme)}); } catch {}

    const provider = {
      request: async ({ method, params }) => {
        switch (method) {
          case "eth_requestAccounts":
          case "eth_accounts":
            return [${JSON.stringify(address)}];
          case "eth_chainId":
            return ${JSON.stringify(chainIdHex)};
          case "net_version":
            return String(parseInt(${JSON.stringify(chainIdHex)}, 16));
          case "personal_sign":
            return await window.__ownexSign(params[0]);
          case "wallet_switchEthereumChain":
          case "wallet_addEthereumChain":
            return null;
          default:
            throw Object.assign(new Error("unsupported method " + method), { code: 4200 });
        }
      },
      on: () => {},
      removeListener: () => {},
    };

    const detail = Object.freeze({
      info: {
        uuid: "11111111-2222-3333-4444-555555555555",
        name: "Test Wallet",
        icon: "",
        rdns: "dev.ownex.testwallet",
      },
      provider,
    });
    try { Object.defineProperty(window, "ethereum", { value: provider, configurable: true }); } catch {}

    const announce = () =>
      window.dispatchEvent(new CustomEvent("eip6963:announceProvider", { detail }));

    window.addEventListener("eip6963:requestProvider", announce);
    announce();
  `;
}

/** Every element that widens the page, ignoring deliberate scroll containers. */
const OVERFLOW_PROBE = () => {
  const vw = document.documentElement.clientWidth;
  const describe = (el) => ({
    tag: el.tagName.toLowerCase(),
    cls: (el.className || "").toString().slice(0, 80),
    left: Math.round(el.getBoundingClientRect().left),
    right: Math.round(el.getBoundingClientRect().right),
    text: (el.textContent || "").trim().slice(0, 40),
  });

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
  // An absolutely positioned element whose containing block is outside its
  // scroll container escapes the clip entirely: a visually hidden label inside a
  // scrolling table did exactly that and widened the document by 332px. The
  // scroller exemption above would hide it, so it is reported separately.
  const escapees = [];

  for (const el of document.querySelectorAll("*")) {
    const r = el.getBoundingClientRect();
    if (r.width === 0 && r.height === 0) continue;
    if (r.right <= vw + 0.5 && r.left >= -0.5) continue;

    const cs = getComputedStyle(el);
    if (cs.position === "absolute" || cs.position === "fixed") {
      const parent = el.offsetParent;
      if (!parent || parent === document.body || parent === document.documentElement) {
        escapees.push({ ...describe(el), position: cs.position });
        continue;
      }
    }

    if (inScroller(el)) continue;
    offenders.push(describe(el));
  }

  return {
    vw,
    scrollW: document.documentElement.scrollWidth,
    offenders: offenders.slice(0, 8),
    escapees: escapees.slice(0, 8),
  };
};

rmSync(OUT, { recursive: true, force: true });
mkdirSync(OUT, { recursive: true });

const browser = await chromium.launch();
const problems = [];
const report = [];

for (const actor of ACTORS) {
  const wallet = new Wallet(actor.pk);
  const themes = actor.full ? ["light", "dark"] : ["light"];
  const viewports = actor.full ? VIEWPORTS : [VIEWPORTS[0]];

  for (const theme of themes) {
    for (const vp of viewports) {
      const context = await browser.newContext({
        viewport: { width: vp.width, height: vp.height },
        deviceScaleFactor: 1,
      });

      await context.exposeFunction("__ownexSign", async (payload) => {
        // ethers sends personal_sign with the message hex-encoded.
        const message =
          typeof payload === "string" && payload.startsWith("0x")
            ? toUtf8String(payload)
            : String(payload);
        return wallet.signMessage(message);
      });

      await context.addInitScript(
        initScript({ address: wallet.address, chainIdHex: CHAIN_ID_HEX, theme }),
      );

      const page = await context.newPage();
      const tag = `${actor.key}/${theme}/${vp.name}`;

      /**
       * Two network responses are expected rather than wrong, and both surface
       * as a browser console error that is not the application's fault:
       *
       *   401  `/api/identity/me` on first load, before anybody has signed in.
       *        That is how the shell learns it is signed out.
       *   403  a plain USER reading `/api/audit`. Being refused is the point of
       *        the screen; rendering the refusal is what is being verified.
       */
      const expectedStatus = /status of (401|403)/;

      page.on("console", (msg) => {
        if (msg.type() !== "error") return;
        if (expectedStatus.test(msg.text())) return;
        problems.push(`${tag} console: ${msg.text()}`);
      });
      page.on("pageerror", (err) => problems.push(`${tag} pageerror: ${err.message}`));

      // ── sign in once per context ────────────────────────────────────
      await page.goto(`${BASE}/dashboard`, { waitUntil: "networkidle", timeout: 90_000 });
      await page.getByRole("button", { name: "Connect wallet" }).click();
      await page.getByRole("button", { name: "Sign out" }).waitFor({ timeout: 30_000 });

      const routes = actor.full ? ROUTES : ROUTES.filter((r) => r.name !== "asset-1" && r.name !== "mint");

      for (const route of routes) {
        await page.goto(`${BASE}${route.path}`, {
          waitUntil: "networkidle",
          timeout: 90_000,
        });
        // Let the staggered row reveals and any second fetch settle.
        await page.waitForTimeout(1400);

        const shot = `${actor.key}-${theme}-${vp.name}-${route.name}`;
        await page.screenshot({
          path: join(OUT, `${shot}.png`),
          fullPage: true,
          animations: "disabled",
        });

        const metrics = await page.evaluate(OVERFLOW_PROBE);
        const heading = await page
          .getByRole("heading", { level: 1 })
          .first()
          .textContent()
          .catch(() => null);

        if (metrics.scrollW > metrics.vw + 1) {
          problems.push(
            `${tag}/${route.name} horizontal overflow: ${metrics.scrollW} > ${metrics.vw}`,
          );
          for (const o of metrics.offenders) {
            problems.push(
              `    ${o.tag} l=${o.left} r=${o.right} | ${o.cls} | "${o.text}"`,
            );
          }
          for (const o of metrics.escapees) {
            problems.push(
              `    escaped its scroller: ${o.position} ${o.tag} l=${o.left} r=${o.right} | ${o.cls} | "${o.text}"`,
            );
          }
        }

        report.push(
          `${tag.padEnd(20)} ${route.name.padEnd(10)} scrollW=${String(metrics.scrollW).padEnd(5)} h1="${(heading ?? "").trim().slice(0, 44)}"`,
        );
      }

      await context.close();
    }
  }
}

await browser.close();

const summary = problems.length
  ? `PROBLEMS (${problems.length}):\n${problems.join("\n")}`
  : "PROBLEMS: none";

writeFileSync(join(OUT, "report.txt"), `${report.join("\n")}\n\n${summary}\n`);
console.log(report.join("\n"));
console.log(`\n${summary}`);
process.exit(problems.length ? 1 : 0);
