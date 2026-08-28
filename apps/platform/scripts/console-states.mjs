/**
 * Exercises the console's failure states against the live stack.
 *
 *   node scripts/console-states.mjs
 *
 * The happy path is the easy half. These are the states that decide whether the
 * console is trustworthy when something is wrong, and each one is produced for
 * real rather than mocked in the component:
 *
 *   wrong network     the injected wallet reports mainnet instead of 31337
 *   rpc failure       run with the chain stopped (see --expect-rpc-down)
 *   permission denied a plain USER on the audit trail
 *
 * Pass --expect-rpc-down to assert the RPC failure panel instead of the wrong
 * network one.
 */
import { chromium } from "playwright";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { Wallet, toUtf8String } from "ethers";

const BASE = process.env.BASE_URL ?? "http://127.0.0.1:3000";
const OUT = join(process.cwd(), "_shots-console");
const rpcDown = process.argv.includes("--expect-rpc-down");

const ADMIN_PK =
  "0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d";

mkdirSync(OUT, { recursive: true });

function init(address, chainIdHex) {
  return `
    try { localStorage.setItem("ownex.theme", "light"); } catch {}
    const provider = {
      request: async ({ method, params }) => {
        switch (method) {
          case "eth_requestAccounts":
          case "eth_accounts": return [${JSON.stringify(address)}];
          case "eth_chainId": return ${JSON.stringify(chainIdHex)};
          case "net_version": return String(parseInt(${JSON.stringify(chainIdHex)}, 16));
          case "personal_sign": return await window.__ownexSign(params[0]);
          case "wallet_switchEthereumChain":
          case "wallet_addEthereumChain": return null;
          default: throw Object.assign(new Error("unsupported " + method), { code: 4200 });
        }
      },
      on: () => {}, removeListener: () => {},
    };
    const detail = Object.freeze({
      info: { uuid: "u", name: "Test Wallet", icon: "", rdns: "dev.ownex.testwallet" },
      provider,
    });
    const announce = () => window.dispatchEvent(new CustomEvent("eip6963:announceProvider", { detail }));
    window.addEventListener("eip6963:requestProvider", announce);
    announce();
  `;
}

const results = [];
function assert(name, condition, detail = "") {
  results.push({ name, ok: Boolean(condition), detail });
  console.log(`  ${condition ? "PASS" : "FAIL"}  ${name}${detail ? "  " + detail : ""}`);
}

const browser = await chromium.launch();

async function openConsole({ chainIdHex, pk }) {
  const wallet = new Wallet(pk);
  const context = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
  await context.exposeFunction("__ownexSign", async (p) =>
    wallet.signMessage(typeof p === "string" && p.startsWith("0x") ? toUtf8String(p) : String(p)),
  );
  await context.addInitScript(init(wallet.address, chainIdHex));
  const page = await context.newPage();
  await page.goto(`${BASE}/dashboard`, { waitUntil: "networkidle", timeout: 90_000 });
  return { context, page };
}

if (rpcDown) {
  // ── RPC failure ───────────────────────────────────────────────────
  // With the chain stopped, sign-in itself cannot complete, because
  // /api/auth/verify reads identity and memberships from it. That is the state
  // to check: the wallet flow must fail with an explanation, not a spinner.
  console.log("\nrpc failure — chain stopped");
  const { context, page } = await openConsole({ chainIdHex: "0x7a69", pk: ADMIN_PK });

  await page.getByRole("button", { name: "Connect wallet" }).click();
  const alert = page.getByRole("alert").filter({ hasText: "Could not sign in" });
  await alert.waitFor({ timeout: 40_000 }).catch(() => null);

  const text = (await page.locator("body").innerText()).replace(/\s+/g, " ");
  assert(
    "sign-in failure names the chain as the likely cause",
    /could not reach Hardhat Local|npm run dev:chain/i.test(text),
    "",
  );
  await page.screenshot({
    path: join(OUT, "state-rpc-down-signin.png"),
    fullPage: true,
    animations: "disabled",
  });
  await context.close();
} else {
  // ── Wrong network ─────────────────────────────────────────────────
  console.log("\nwrong network — wallet reports chain 1");
  {
    const { context, page } = await openConsole({ chainIdHex: "0x1", pk: ADMIN_PK });
    await page.getByRole("button", { name: "Connect wallet" }).click();
    await page.getByRole("button", { name: "Sign out" }).waitFor({ timeout: 30_000 });

    await page.goto(`${BASE}/dashboard/assets`, { waitUntil: "networkidle" });
    await page.waitForTimeout(1200);

    const body = (await page.locator("body").innerText()).replace(/\s+/g, " ");
    assert(
      "asset vault refuses to show data on the wrong chain",
      /wallet is on the wrong network/i.test(body),
    );
    assert("it names both chains", /chain 1/i.test(body) && /31337/.test(body), "");
    assert(
      "it offers the switch",
      (await page.getByRole("button", { name: /Switch to/ }).count()) > 0,
    );
    assert(
      "no certificate is rendered behind the panel",
      !/Company Laptop 001/.test(body),
    );
    await page.screenshot({
      path: join(OUT, "state-wrong-network.png"),
      fullPage: true,
      animations: "disabled",
    });
    await context.close();
  }

  // ── Permission denied ─────────────────────────────────────────────
  console.log("\npermission denied — plain USER on the audit trail");
  {
    const { context, page } = await openConsole({
      chainIdHex: "0x7a69",
      pk: "0x47e179ec197488593b187f80a00eb0da91f1b9d0b13f8733639f19c30a34926a",
    });
    await page.getByRole("button", { name: "Connect wallet" }).click();
    await page.getByRole("button", { name: "Sign out" }).waitFor({ timeout: 30_000 });

    await page.goto(`${BASE}/dashboard/audit`, { waitUntil: "networkidle" });
    await page.waitForTimeout(1200);

    const body = (await page.locator("body").innerText()).replace(/\s+/g, " ");
    assert("audit is refused, with a reason", /do not have access/i.test(body));
    assert("the caller's role is named", /USER/.test(body));
    assert(
      "no event rows leak behind the refusal",
      !/AssetMinted/.test(body) && !/MemberAdded/.test(body),
    );
    assert(
      "the refresh action is not offered on a screen that cannot be read",
      (await page.getByRole("button", { name: "Refresh from chain" }).count()) === 0,
    );
    await context.close();
  }
}

await browser.close();

const failed = results.filter((r) => !r.ok);
writeFileSync(
  join(OUT, rpcDown ? "states-rpc-down.txt" : "states.txt"),
  results.map((r) => `${r.ok ? "PASS" : "FAIL"}  ${r.name}`).join("\n") + "\n",
);
console.log(`\n${results.length - failed.length} passed, ${failed.length} failed`);
process.exit(failed.length ? 1 : 0);
