/**
 * Approve a PayPal SANDBOX order as a guest card buyer in headless Chrome
 * (stands in for the human payer; sandbox only — refuses anything else).
 *
 *   NODE_PATH=/tmp/ppx/node_modules node scripts/sandbox-guest-approve.cjs <approveUrl> [screenshotDir]
 *
 * Uses PayPal's documented sandbox test Visa (no real card, no real money).
 * Needs puppeteer-core (not a project dependency): npm i --prefix /tmp/ppx puppeteer-core
 */
const puppeteer = require("puppeteer-core");
const fs = require("node:fs");
const path = require("node:path");

const url = process.argv[2];
const outDir = process.argv[3] || "/tmp";
if (!url || !/^https:\/\/www\.sandbox\.paypal\.com\//.test(url)) {
  console.error("refusing: approve URL must be https://www.sandbox.paypal.com/…");
  process.exit(2);
}
const CHROME = process.env.CHROME || "/usr/bin/google-chrome";
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const BUYER = {
  email: "payguard.guest.buyer@example.com",
  phone: "4155551234",
  // PayPal sandbox test cards (override: PAYGUARD_TEST_CARD="number|MM/YY|cvv")
  card: (process.env.PAYGUARD_TEST_CARD || "4032039317984658|12/30|123").split("|")[0],
  exp: (process.env.PAYGUARD_TEST_CARD || "4032039317984658|12/30|123").split("|")[1],
  cvv: (process.env.PAYGUARD_TEST_CARD || "4032039317984658|12/30|123").split("|")[2],
  first: "Pay",
  last: "Guard",
  line1: "2211 N First Street",
  city: "San Jose",
  state: "CA",
  zip: "95131",
};

(async () => {
  fs.mkdirSync(outDir, { recursive: true });
  const b = await puppeteer.launch({ executablePath: CHROME, headless: "new", args: ["--no-sandbox", "--lang=en-US"] });
  const p = await b.newPage();
  await p.setExtraHTTPHeaders({ "Accept-Language": "en-US,en;q=0.9" });
  await p.setViewport({ width: 1280, height: 1000 });
  const shot = async (name) => {
    const f = path.join(outDir, name);
    await p.screenshot({ path: f, fullPage: true });
    console.log("screenshot →", f);
  };
  try {
    await p.goto(url, { waitUntil: "load", timeout: 60000 });
  } catch (e) {
    console.log("goto:", e.message);
  }
  await p.waitForSelector("#createAccount", { visible: true, timeout: 60000 });
  await sleep(1500);
  await p.click("#createAccount"); // "Pay with debit or credit card"
  await p.waitForSelector("#cardNumber", { visible: true, timeout: 60000 });
  await sleep(1500);

  // Switch billing country to US for a stable form
  await p.select("#country", "US").catch(() => {});
  await sleep(5000);
  await p.waitForSelector("#cardNumber", { visible: true, timeout: 30000 });

  const type = async (sel, val) => {
    const el = await p.$(sel);
    if (!el) return false;
    const visible = await el.evaluate((e) => e.offsetParent !== null);
    if (!visible) return false;
    await el.click({ clickCount: 3 });
    await el.type(val, { delay: 25 });
    return true;
  };
  await type("#email", BUYER.email);
  await type("#phone", BUYER.phone);
  await type("#cardNumber", BUYER.card);
  await type("#cardExpiry", BUYER.exp);
  await type("#cardCvv", BUYER.cvv);
  await type("#firstName", BUYER.first);
  await type("#lastName", BUYER.last);
  await type("#billingLine1", BUYER.line1);
  await type("#billingCity", BUYER.city);
  await p.select("#billingState", BUYER.state).catch(() => {});
  await type("#billingPostalCode", BUYER.zip);
  // guest checkout: do NOT create a PayPal account
  await p.evaluate(() => {
    const sw = document.querySelector('input[value="signup"]');
    if (sw && sw.checked) sw.click();
  });
  await sleep(1500);
  await shot("paypal-sandbox-guest-form.png");

  const clicked = await p.evaluate(() => {
    // Guest only — never "Create Account & Pay Now".
    const all = [...document.querySelectorAll("button, a")];
    const btn =
      all.find((x) => /pay now as guest|paga come ospite/i.test(x.innerText || "")) ||
      all.find((x) => /^(pay now|agree and pay|continue)$/i.test((x.innerText || "").trim()));
    if (btn) { btn.click(); return btn.innerText.trim(); }
    return null;
  });
  console.log("submit:", clicked);
  // wait for PayPal to redirect to our return_url
  const start = Date.now();
  while (Date.now() - start < 90000) {
    const u = p.url();
    if (!/paypal\.com/.test(u)) break;
    await sleep(2000);
  }
  console.log("final URL:", p.url().replace(/PayerID=[^&]+/, "PayerID=<redacted>"));
  await sleep(2000);
  await shot("paypal-sandbox-after-approve.png");
  const errs = await p.evaluate(() => [...document.querySelectorAll('[role="alert"], .error, [class*="error"]')].map((e) => e.innerText.trim()).filter(Boolean).slice(0, 5));
  if (errs.length) console.log("page alerts:", errs.join(" | "));
  await b.close();
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
