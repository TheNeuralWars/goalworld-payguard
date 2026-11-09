/**
 * Approve a PayPal SANDBOX order as the sandbox personal buyer, headless.
 *
 *   vault-run paypal-sandbox-buyer -- env NODE_PATH=/tmp/ppx/node_modules \
 *     node scripts/sandbox-buyer-approve.cjs <approveUrl> <outDir>
 *
 * Safety:
 *  - Approve URL must be https://www.sandbox.paypal.com/… ; every request to a *.paypal.com host
 *    that is not *.sandbox.paypal.com is aborted (Live PayPal can never be touched).
 *  - Buyer login comes from HERMES_VAULT_SECRET ("EMAIL:PASSWORD") — never printed, never in argv.
 *  - Screenshots are taken only when no password is in any field.
 *  - Captcha / 2FA / security challenge → stop, screenshot (no password), exit 3.
 */
const puppeteer = require("puppeteer-core");
const fs = require("node:fs");
const path = require("node:path");

const url = process.argv[2];
const outDir = process.argv[3] || "/tmp";
const SANDBOX_HOST = /(^|\.)sandbox\.paypal\.com$/i;
if (!url || new URL(url).protocol !== "https:" || new URL(url).host !== "www.sandbox.paypal.com") {
  console.error("refusing: approve URL must be https://www.sandbox.paypal.com/…");
  process.exit(2);
}
const pair = process.env.HERMES_VAULT_SECRET || "";
const i = pair.indexOf(":");
if (i < 1) {
  console.error("no buyer credential in env (run under vault-run paypal-sandbox-buyer)");
  process.exit(2);
}
const EMAIL = pair.slice(0, i);
let PASSWORD = pair.slice(i + 1);
delete process.env.HERMES_VAULT_SECRET;
if (!/@personal\.example\.com$/i.test(EMAIL)) {
  console.error("refusing: buyer must be a sandbox personal.example.com account");
  process.exit(2);
}
const CHROME = process.env.CHROME || "/usr/bin/google-chrome";
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const log = (...a) => console.log(...a);
const blocked = [];

(async () => {
  fs.mkdirSync(outDir, { recursive: true });
  const b = await puppeteer.launch({ executablePath: CHROME, headless: "new", args: ["--no-sandbox", "--lang=en-US"] });
  const p = await b.newPage();
  await p.setViewport({ width: 1280, height: 1000 });
  await p.setRequestInterception(true);
  p.on("request", (req) => {
    let host = "";
    try { host = new URL(req.url()).host; } catch { /* data: etc */ }
    if (/(^|\.)paypal\.com$/i.test(host) && !SANDBOX_HOST.test(host)) {
      blocked.push(host);
      return req.abort();
    }
    return req.continue();
  });

  const passwordInDom = () =>
    p.evaluate(() => [...document.querySelectorAll("input[type=password], input#password")].some((e) => e.value));
  const shot = async (name) => {
    if (await passwordInDom()) {
      await p.evaluate(() => document.querySelectorAll("input[type=password], input#password").forEach((e) => (e.value = "")));
    }
    const f = path.join(outDir, name);
    await p.screenshot({ path: f, fullPage: true });
    log("screenshot →", f);
  };
  const visible = (sel) =>
    p.evaluate((s) => { const e = document.querySelector(s); return !!(e && e.offsetParent !== null); }, sel);
  const challenge = async () =>
    p.evaluate(() => {
      const t = document.body ? document.body.innerText : "";
      const vis = (s) => { const e = document.querySelector(s); return !!(e && e.offsetParent !== null); };
      if (vis("#splitHybridCaptcha") || vis("#splitPasswordCaptcha") || vis("iframe[src*='recaptcha']") || vis("iframe[title*='captcha' i]")) return "captcha";
      if (/security check|controllo di sicurezza|verifica (la tua|che sei)|enter the code|inserisci il codice|confirm it'?s you|conferma che sei tu|one-time code|codice usa e getta/i.test(t)) return "2fa/security challenge";
      return null;
    });
  const stopOn = async (where) => {
    const c = await challenge();
    if (c) {
      log(`STOP: ${c} at ${where} — url=${p.url().split("?")[0]}`);
      await shot(`paypal-sandbox-STOP-${c.replace(/\W+/g, "-")}.png`);
      await b.close();
      process.exit(3);
    }
  };

  try { await p.goto(url, { waitUntil: "load", timeout: 60000 }); } catch (e) { log("goto:", e.message); }
  await p.waitForSelector("#email", { visible: true, timeout: 60000 });
  await sleep(1500);
  await stopOn("email page");
  await p.type("#email", EMAIL, { delay: 30 });
  if (await visible("#btnNext")) {
    await p.click("#btnNext");
    await sleep(4000);
  }
  await stopOn("after email");
  await p.waitForSelector("#password", { visible: true, timeout: 45000 });
  await p.type("#password", PASSWORD, { delay: 30 });
  PASSWORD = "";
  await p.click("#btnLogin");
  // password field is now submitted; wait for review page
  await sleep(9000);
  await stopOn("after login");
  const t0 = Date.now();
  let payBtn = null;
  while (Date.now() - t0 < 60000) {
    payBtn = await p.evaluate(() => {
      const re = /^(pay now|paga ora|complete purchase|completa l'acquisto|continue to review order|continua|continue|agree & pay|accetta e paga|paga)$/i;
      const el = [...document.querySelectorAll("button, input[type=submit]")].find((x) => x.offsetParent !== null && re.test((x.innerText || x.value || "").trim()));
      if (!el) return null;
      el.setAttribute("data-payguard-pay", "1");
      return (el.innerText || el.value || "").trim();
    });
    if (payBtn) break;
    await sleep(2000);
    await stopOn("review page");
  }
  // Prefer the sandbox test card funding source (avoids the SEPA mandate on the sandbox bank).
  const pickedCard = await p.evaluate(() => {
    const rows = [...document.querySelectorAll("label, li, div")].filter((e) => /carta di credito|credit card/i.test(e.innerText || "") && e.querySelector("input[type=radio]"));
    const row = rows.sort((a, b) => a.innerText.length - b.innerText.length)[0];
    const radio = row && row.querySelector("input[type=radio]");
    if (radio && !radio.checked) { radio.click(); return true; }
    return !!(radio && radio.checked);
  });
  log("funding: sandbox card selected =", pickedCard);
  await sleep(2500);
  await shot("paypal-sandbox-buyer-review-post-login.png");
  if (!payBtn) {
    log("STOP: no Pay button found on review page — url=" + p.url().split("?")[0]);
    await b.close();
    process.exit(4);
  }
  log("clicking:", payBtn);
  await p.evaluate(() => document.querySelector("[data-payguard-pay='1']")?.click());
  const t1 = Date.now();
  let mandates = 0;
  while (Date.now() - t1 < 120000) {
    let host = "";
    try { host = new URL(p.url()).host; } catch { /* */ }
    if (!SANDBOX_HOST.test(host)) break;
    // sandbox-only funding confirmations (e.g. SEPA mandate on the fake sandbox bank)
    const confirm = await p.evaluate(() => {
      const el = [...document.querySelectorAll("button")].find((x) => x.offsetParent !== null && /^(accetta e continua|agree and continue|accept and continue)$/i.test((x.innerText || "").trim()));
      if (el) { el.click(); return el.innerText.trim(); }
      return null;
    }).catch(() => null); // navigation in flight (redirect to return_url) — keep polling the URL
    if (confirm && mandates < 2) { mandates++; log("sandbox funding confirmation:", confirm); }
    await stopOn("after pay").catch(() => null);
    await sleep(2500);
  }
  await sleep(5000);
  log("final:", p.url().replace(/PayerID=[^&]+/, "PayerID=<redacted>"));
  await shot("paypal-sandbox-after-pay-redirect.png");
  if (blocked.length) log("blocked non-sandbox paypal hosts:", [...new Set(blocked)].join(","));
  await b.close();
})().catch((e) => {
  console.error(e && e.message ? e.message : e);
  process.exit(1);
});
