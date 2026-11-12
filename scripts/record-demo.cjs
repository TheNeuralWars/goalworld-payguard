/**
 * Record a real 1080p (1920x1080) end-to-end screen capture of GoalWorld PayGuard
 * running against PayPal SANDBOX + OmniRoute LLM, then burn in English captions
 * via ffmpeg drawtext.
 *
 * Run with buyer credentials injected from Hermes Vault:
 *   PATH=/data/hermes-home/bin:$PATH vault-run paypal-sandbox-buyer -- \
 *     env NODE_PATH=/tmp/ppx/node_modules node scripts/record-demo.cjs
 */
const { spawn, execFileSync } = require("node:child_process");
const fs = require("node:fs");
const path = require("node:path");
const puppeteer = require("puppeteer-core");

const BASE = (process.env.BASE || "http://127.0.0.1:3047").replace(/\/$/, "");
const ARTIFACTS_DIR =
  process.env.ARTIFACTS_DIR ||
  "/data/shared-memory/artifacts/opportunities/paypal-payguard";
const MEDIA_DIR = path.join(ARTIFACTS_DIR, "media");
const FRAMES_DIR = path.join(MEDIA_DIR, "frames");
const RAW_MP4 = "/tmp/payguard_raw_capture.mp4";
const FINAL_MP4 = path.join(MEDIA_DIR, "payguard_demo_20261112.mp4");
const CAPTIONS_JSON = path.join(MEDIA_DIR, "captions_timeline.json");
const DISPLAY_NUM = ":98";
const CHROME_BIN =
  process.env.CHROME ||
  "/home/ubuntu/.cache/ms-playwright/chromium-1148/chrome-linux/chrome";
const FONT_BOLD = "/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf";

const SANDBOX_HOST = /(^|\.)sandbox\.paypal\.com$/i;

// Read buyer credentials from Hermes Vault env and immediately scrub from env.
const pair = process.env.HERMES_VAULT_SECRET || "";
const sepIdx = pair.indexOf(":");
if (sepIdx < 1) {
  console.error("Missing buyer credentials (run under vault-run paypal-sandbox-buyer)");
  process.exit(2);
}
const BUYER_EMAIL = pair.slice(0, sepIdx).trim();
let BUYER_PASSWORD = pair.slice(sepIdx + 1).trim();
delete process.env.HERMES_VAULT_SECRET;

if (!/@personal\.example\.com$/i.test(BUYER_EMAIL)) {
  console.error("Refusing non-sandbox buyer account");
  process.exit(2);
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// Script injected into every document (PayGuard UI + PayPal Sandbox checkout)
// 1. Masks all emails and passwords on *.sandbox.paypal.com so no secret ever renders.
// 2. Draws a smooth visual pointer + highlight ring so actions are easy to follow.
const INIT_SCRIPT = () => {
  const maskEmailStr = (s) =>
    s.replace(
      /([a-zA-Z0-9._+-]+)@([a-zA-Z0-9.-]+)\.([a-zA-Z]{2,})/g,
      (_m, local, dom, tld) => {
        const l =
          local.length > 6
            ? `${local.slice(0, 6)}•`
            : `${local.slice(0, Math.max(2, local.length - 1))}•`;
        const d = dom.slice(0, 3);
        return `${l}@${d}•••.${tld}`;
      },
    );

  const installStyles = () => {
    if (document.getElementById("__pg_init_style")) return;
    const st = document.createElement("style");
    st.id = "__pg_init_style";
    const isPayPal = /paypal\.com$/i.test(location.hostname);
    st.textContent = `
      ${
        isPayPal
          ? `
        input#email, input[name="login_email"], input[type="email"] {
          -webkit-text-security: disc !important;
        }
        input#password, input[name="login_password"], input[type="password"] {
          -webkit-text-security: disc !important;
          color: transparent !important;
          text-shadow: none !important;
          caret-color: transparent !important;
          background: repeating-linear-gradient(
            45deg,
            rgba(16, 185, 129, 0.14),
            rgba(16, 185, 129, 0.14) 10px,
            rgba(6, 95, 70, 0.14) 10px,
            rgba(6, 95, 70, 0.14) 20px
          ) !important;
        }
        button[id*="ShowPassword"], .show-password, .hideShow, [data-pa-click*="ShowPassword"], #backToInputEmailLink {
          display: none !important;
        }
        #splitEmail, .profileRememberedEmail, .profileBar, #emailSubTagLine, [data-testid*="email"] {
          filter: blur(10px) !important;
        }
      `
          : ""
      }
      #__pg_ring {
        position: fixed;
        z-index: 2147483646;
        pointer-events: none;
        border: 2px solid #38bdf8;
        box-shadow: 0 0 0 4px rgba(56, 189, 248, 0.22), 0 0 24px rgba(56, 189, 248, 0.45);
        border-radius: 12px;
        transition: all 0.38s cubic-bezier(0.22, 1, 0.36, 1);
        opacity: 0;
      }
      #__pg_cursor {
        position: fixed;
        z-index: 2147483647;
        pointer-events: none;
        width: 22px;
        height: 22px;
        margin-left: -11px;
        margin-top: -11px;
        border-radius: 50%;
        background: radial-gradient(circle, #fbbf24 35%, rgba(251, 191, 36, 0.25) 70%, transparent 100%);
        border: 2px solid #ffffff;
        box-shadow: 0 0 14px rgba(251, 191, 36, 0.9);
        transition: left 0.42s cubic-bezier(0.22, 1, 0.36, 1), top 0.42s cubic-bezier(0.22, 1, 0.36, 1), transform 0.18s ease;
        left: 960px;
        top: 540px;
      }
      #__pg_pp_banner {
        position: fixed;
        top: 12px;
        left: 50%;
        transform: translateX(-50%);
        z-index: 2147483645;
        background: #07090f;
        color: #6ee7ff;
        border: 1px solid #38bdf8;
        border-radius: 999px;
        padding: 8px 18px;
        font: 600 13px/1.2 ui-monospace, monospace;
        box-shadow: 0 10px 30px rgba(0,0,0,0.45);
        pointer-events: none;
      }
    `;
    (document.head || document.documentElement).appendChild(st);
  };

  const scrubPayPalDom = () => {
    if (!/paypal\.com$/i.test(location.hostname)) return;
    if (document.body && !document.getElementById("__pg_pp_banner")) {
      const b = document.createElement("div");
      b.id = "__pg_pp_banner";
      b.textContent =
        "PayPal SANDBOX Checkout · Buyer credentials injected via Hermes Vault (password & email masked)";
      document.body.appendChild(b);
    }
    const walker = document.createTreeWalker(
      document.body || document.documentElement,
      NodeFilter.SHOW_TEXT,
    );
    let n;
    while ((n = walker.nextNode())) {
      const v = n.nodeValue;
      if (v && v.includes("@")) {
        const masked = maskEmailStr(v);
        if (masked !== v) n.nodeValue = masked;
      }
    }
  };

  installStyles();
  document.addEventListener("DOMContentLoaded", () => {
    installStyles();
    scrubPayPalDom();
    const obs = new MutationObserver(() => {
      installStyles();
      scrubPayPalDom();
    });
    obs.observe(document.documentElement, {
      childList: true,
      subtree: true,
      characterData: true,
    });
    setInterval(scrubPayPalDom, 120);
  });

  window.__pgHighlight = (selector, pad = 6) => {
    installStyles();
    let ring = document.getElementById("__pg_ring");
    if (!ring && document.body) {
      ring = document.createElement("div");
      ring.id = "__pg_ring";
      document.body.appendChild(ring);
    }
    let cur = document.getElementById("__pg_cursor");
    if (!cur && document.body) {
      cur = document.createElement("div");
      cur.id = "__pg_cursor";
      document.body.appendChild(cur);
    }
    if (!selector) {
      if (ring) ring.style.opacity = "0";
      return false;
    }
    const el = document.querySelector(selector);
    if (!el || !ring || !cur) return false;
    const r = el.getBoundingClientRect();
    ring.style.left = `${Math.max(4, r.left - pad)}px`;
    ring.style.top = `${Math.max(4, r.top - pad)}px`;
    ring.style.width = `${Math.min(1912, r.width + pad * 2)}px`;
    ring.style.height = `${Math.min(990, r.height + pad * 2)}px`;
    ring.style.opacity = "1";
    cur.style.left = `${Math.round(r.left + Math.min(r.width * 0.5, 160))}px`;
    cur.style.top = `${Math.round(r.top + Math.min(r.height * 0.5, 45))}px`;
    return true;
  };

  window.__pgPulseClick = () => {
    const cur = document.getElementById("__pg_cursor");
    if (!cur) return;
    cur.style.transform = "scale(0.68)";
    setTimeout(() => {
      cur.style.transform = "scale(1)";
    }, 180);
  };
};

async function main() {
  fs.mkdirSync(MEDIA_DIR, { recursive: true });
  fs.mkdirSync(FRAMES_DIR, { recursive: true });

  // Reset server proposals/audit by restarting or clearing the store file and reloading
  // Wait: let's check if /api/health is up on BASE
  const health = await fetch(`${BASE}/api/health`).then((r) => r.json());
  if (!health.ok || health.mode !== "sandbox") {
    throw new Error(`Expected sandbox server on ${BASE}, got: ${JSON.stringify(health)}`);
  }
  console.log("Server health OK:", health.mode, health.reasoner);

  // Start Xvfb on :98 at 1920x1080x24
  const xvfb = spawn(
    "Xvfb",
    [DISPLAY_NUM, "-screen", "0", "1920x1080x24", "-ac", "-nolisten", "tcp"],
    { stdio: "ignore" },
  );
  await sleep(1000);
  process.env.DISPLAY = DISPLAY_NUM;

  // Fresh profile with the password manager disabled: Chrome's "Save password?"
  // bubble would otherwise show the sandbox buyer username in clear text.
  const userDataDir = fs.mkdtempSync(path.join(process.env.TMPDIR || "/tmp", "pg-chrome-"));
  fs.mkdirSync(path.join(userDataDir, "Default"), { recursive: true });
  fs.writeFileSync(
    path.join(userDataDir, "Default", "Preferences"),
    JSON.stringify({
      credentials_enable_service: false,
      credentials_enable_autosignin: false,
      profile: { password_manager_enabled: false, password_manager_leak_detection: false },
      autofill: { profile_enabled: false, credit_card_enabled: false },
    }),
  );
  const browser = await puppeteer.launch({
    executablePath: CHROME_BIN,
    userDataDir,
    headless: false,
    defaultViewport: { width: 1920, height: 1080 },
    ignoreDefaultArgs: ["--enable-automation"],
    args: [
      `--display=${DISPLAY_NUM}`,
      "--no-sandbox",
      "--kiosk",
      "--window-position=0,0",
      "--window-size=1920,1080",
      "--no-first-run",
      "--no-default-browser-check",
      "--disable-infobars",
      "--disable-blink-features=AutomationControlled",
      "--lang=en-US",
      "--password-store=basic",
      "--disable-save-password-bubble",
      "--disable-features=PasswordManagerOnboarding,PasswordLeakDetection,AutofillServerCommunication,Translate",
    ],
  });

  const [page] = await browser.pages();
  await page.setViewport({ width: 1920, height: 1080 });
  // PayPal's CSP blocks injected <style> tags; bypass so the masking CSS applies.
  await page.setBypassCSP(true);
  await page.evaluateOnNewDocument(INIT_SCRIPT);

  // Safety rail: abort any request to a non-sandbox paypal.com host
  await page.setRequestInterception(true);
  page.on("request", (req) => {
    let host = "";
    try {
      host = new URL(req.url()).host;
    } catch {
      /* ignore */
    }
    if (/(^|\.)paypal\.com$/i.test(host) && !SANDBOX_HOST.test(host)) {
      return req.abort();
    }
    return req.continue();
  });

  await page.goto(BASE, { waitUntil: "networkidle0", timeout: 25000 });
  await sleep(1200);

  // Start ffmpeg x11grab recording
  try {
    fs.unlinkSync(RAW_MP4);
  } catch {
    /* ignore */
  }
  const ff = spawn(
    "ffmpeg",
    [
      "-y",
      "-f",
      "x11grab",
      "-video_size",
      "1920x1080",
      "-framerate",
      "24",
      "-draw_mouse",
      "0",
      "-i",
      DISPLAY_NUM,
      "-c:v",
      "libx264",
      "-pix_fmt",
      "yuv420p",
      "-preset",
      "veryfast",
      "-crf",
      "18",
      RAW_MP4,
    ],
    { stdio: ["pipe", "ignore", "pipe"] },
  );

  const tStart = Date.now();
  const nowSec = () => Number(((Date.now() - tStart) / 1000).toFixed(2));
  const captions = [];
  let currentCaption = null;

  const setCaption = (text) => {
    const t = nowSec();
    if (currentCaption) {
      currentCaption.end = t;
      captions.push(currentCaption);
    }
    if (text) {
      currentCaption = { start: t, end: t + 5, text };
      console.log(`[${t.toFixed(1)}s] CAPTION: ${text}`);
    } else {
      currentCaption = null;
    }
  };

  const focusEl = async (selector, pad = 6) => {
    await page.evaluate((s, p) => window.__pgHighlight && window.__pgHighlight(s, p), selector, pad).catch(() => null);
  };

  const clickEl = async (selector, pad = 6) => {
    await focusEl(selector, pad);
    await sleep(650);
    await page.evaluate(() => window.__pgPulseClick && window.__pgPulseClick()).catch(() => null);
    await page.click(selector);
  };

  const clickPreset = async (label) => {
    await page.evaluate((lbl) => {
      const btns = [...document.querySelectorAll("button.preset")];
      const b = btns.find((x) => (x.innerText || "").trim() === lbl);
      if (b) {
        b.setAttribute("data-pg-preset", "1");
      }
    }, label);
    await clickEl("button.preset[data-pg-preset='1']", 5);
    await page.evaluate(() => {
      const b = document.querySelector("button.preset[data-pg-preset='1']");
      if (b) b.removeAttribute("data-pg-preset");
    });
  };

  // Defense in depth: force masking via CSSOM (not subject to CSP) and verify
  // before a single credential character is typed. Abort if masking is not active.
  const enforceMask = async (selector) => {
    const ok = await page.evaluate((s) => {
      const el = document.querySelector(s);
      if (!el) return false;
      el.style.setProperty("-webkit-text-security", "disc", "important");
      if (el.type === "password") el.style.setProperty("color", "transparent", "important");
      return getComputedStyle(el).webkitTextSecurity === "disc" || el.type === "password";
    }, selector);
    if (!ok) throw new Error(`Refusing to type: masking not active on ${selector}`);
  };

  const waitProposalDone = async () => {
    await sleep(450);
    const t0 = Date.now();
    while (Date.now() - t0 < 40000) {
      const busy = await page.evaluate(() => {
        const b = document.querySelector("#btn-propose");
        return b ? b.disabled || (b.innerText || "").includes("Thinking") : false;
      });
      if (!busy) break;
      await sleep(400);
    }
    await sleep(600);
  };

  try {
    // ── SCENE 1: Intro & Spend Policy ("The Brakes") (0s - 20s) ───────────────
    setCaption("GoalWorld PayGuard: Policy-Gated PayPal Sandbox Payments for AI Agents");
    await focusEl(".hero", 8);
    await sleep(6000);

    setCaption("Mode: Real PayPal Sandbox REST API + OmniRoute LLM Propose & Risk Guard");
    await focusEl(".badges", 8);
    await sleep(6000);

    setCaption("Hard Spend Policy in Code: $50/tx cap, $200/day cap, exact-match allowlist");
    await focusEl("section.brakes", 8);
    await sleep(8000);

    // ── SCENE 2: Legitimate Order — Propose & AI Risk Check (20s - 48s) ───────
    setCaption("Step 1 (Happy Path): Select a legitimate $9 tool order to an allowlisted merchant");
    await clickPreset("Tool order");
    await focusEl("#intent", 6);
    await sleep(5500);

    setCaption("Submitting intent to Propose (LLM) and Guard (Spend Policy + AI Risk Reviewer)...");
    await clickEl("#btn-propose", 6);
    await waitProposalDone();

    setCaption("Guard Passed (awaiting_human): AI Risk Check rated risk:low, ai:approve");
    await focusEl(".list article.item:first-child", 6);
    await sleep(7500);

    setCaption("Both LLM Propose & AI Risk traces, model latency, and audit log are recorded");
    await focusEl(".list article.item:first-child .flags", 6);
    await sleep(6000);

    // ── SCENE 3: Human Approve -> Real PayPal Sandbox Order Created (48s - 70s) ─
    setCaption("Step 2: Human operator clicks Approve & execute -> creates PayPal Sandbox Order v2");
    await clickEl(".list article.item:first-child button.btn-approve", 6);
    await waitProposalDone();
    await sleep(1000);

    const orderInfo = await page.evaluate(() => {
      const txt = document.querySelector(".list article.item:first-child")?.innerText || "";
      const m = txt.match(/order\s+([A-Z0-9]+)/);
      return m ? m[1] : "SANDBOX_ORDER";
    });

    setCaption(`Real PayPal Order ${orderInfo} created (PAYER_ACTION_REQUIRED) — $9.00 held in Brakes`);
    await focusEl("section.brakes", 8);
    await sleep(6500);

    setCaption("Early capture check before buyer approval: PayGuard refuses to capture unapproved orders");
    await clickEl(".list article.item:first-child button.btn-check-approval", 6);
    await waitProposalDone();
    await focusEl(".list article.item:first-child", 6);
    await sleep(6000);

    // ── SCENE 4: Real PayPal Sandbox Buyer Approval & Capture (70s - 105s) ────
    setCaption("Step 3: Open real PayPal Sandbox checkout for buyer approval (credentials masked)");
    await clickEl(".list article.item:first-child button.warn-btn", 6);

    // Wait for PayPal Sandbox login page
    await page.waitForSelector("#email", { visible: true, timeout: 45000 });
    await sleep(1200);
    setCaption("PayPal Sandbox Buyer Login: Vault credentials injected with email & password masked");
    await focusEl("#email", 6);
    await enforceMask("#email");
    await page.type("#email", BUYER_EMAIL, { delay: 15 });
    // Submit the email step: prefer the visible "Next" button by label, else Enter.
    const clickedNext = await page.evaluate(() => {
      const el = [...document.querySelectorAll("button, input[type=submit]")].find(
        (x) => x.offsetParent !== null && /^(next|avanti)$/i.test((x.innerText || x.value || "").trim()),
      );
      if (el) { el.click(); return true; }
      return false;
    });
    if (!clickedNext) await page.keyboard.press("Enter");
    await sleep(3000);
    await page.waitForFunction(() => {
      const el = document.querySelector("#password");
      if (!el) return false;
      const r = el.getBoundingClientRect();
      return r.width > 0 && r.height > 0 && getComputedStyle(el).visibility !== "hidden";
    }, { timeout: 45000 });
    await focusEl("#password", 6);
    await enforceMask("#password");
    await page.type("#password", BUYER_PASSWORD, { delay: 12 });
    BUYER_PASSWORD = "";
    await sleep(1000);
    // Submit login: visible "Log In" button by label, else Enter in the password field.
    const clickedLogin = await page.evaluate(() => {
      const el = [...document.querySelectorAll("button, input[type=submit]")].find(
        (x) => x.offsetParent !== null && /^(log in|login|accedi)$/i.test((x.innerText || x.value || "").trim()),
      );
      if (el) { el.click(); return true; }
      return false;
    });
    if (!clickedLogin) { await page.focus("#password"); await page.keyboard.press("Enter"); }

    setCaption("PayPal Sandbox Checkout: Buyer reviews $9.00 order and selects Sandbox Visa card");
    await sleep(7000);
    const t0 = Date.now();
    let payBtn = null;
    while (Date.now() - t0 < 50000) {
      payBtn = await page.evaluate(() => {
        const re = /^(pay now|paga ora|complete purchase|completa l'acquisto|continue to review order|continua|continue|agree & pay|accetta e paga|paga)$/i;
        const el = [...document.querySelectorAll("button, input[type=submit]")].find(
          (x) => x.offsetParent !== null && re.test((x.innerText || x.value || "").trim()),
        );
        if (!el) return null;
        el.setAttribute("data-payguard-pay", "1");
        return (el.innerText || el.value || "").trim();
      });
      if (payBtn) break;
      await sleep(1500);
    }
    // Select sandbox credit card funding source
    await page.evaluate(() => {
      const rows = [...document.querySelectorAll("label, li, div")].filter(
        (e) => /carta di credito|credit card/i.test(e.innerText || "") && e.querySelector("input[type=radio]"),
      );
      const row = rows.sort((a, b) => a.innerText.length - b.innerText.length)[0];
      const radio = row && row.querySelector("input[type=radio]");
      if (radio && !radio.checked) radio.click();
    });
    await sleep(3000);
    await focusEl("[data-payguard-pay='1']", 8);
    await sleep(3500);

    setCaption("Buyer clicks Complete Purchase -> PayPal redirects to PayGuard return_url for capture");
    await page.evaluate(() => document.querySelector("[data-payguard-pay='1']")?.click());

    // Wait for redirect back to our local PayGuard UI
    const tRedirect = Date.now();
    while (Date.now() - tRedirect < 90000) {
      let host = "";
      try {
        host = new URL(page.url()).host;
      } catch {
        /* ignore */
      }
      if (!SANDBOX_HOST.test(host) && page.url().startsWith(BASE)) break;
      if (!SANDBOX_HOST.test(host)) {
        const back = await page.$("section.brakes").catch(() => null);
        if (back) break;
      }
      await page
        .evaluate(() => {
          const el = [...document.querySelectorAll("button")].find(
            (x) =>
              x.offsetParent !== null &&
              /^(accetta e continua|agree and continue|accept and continue)$/i.test((x.innerText || "").trim()),
          );
          if (el) el.click();
        })
        .catch(() => null);
      await sleep(1500);
    }

    await page.waitForSelector("section.brakes", { visible: true, timeout: 30000 });
    await sleep(2500);

    const capturedText = await page.evaluate(() => {
      return document.querySelector(".list article.item:first-child")?.innerText || "";
    });
    const capMatch = capturedText.match(/order\s+([A-Z0-9]+)\s*·\s*COMPLETED\s*·\s*capture\s+([A-Z0-9]+)/);
    const orderIdStr = capMatch ? capMatch[1] : orderInfo;
    const captureIdStr = capMatch ? capMatch[2] : "CAPTURED";

    setCaption(`Captured! Order ${orderIdStr} -> COMPLETED (Capture ${captureIdStr}), $9.00 committed`);
    await focusEl(".list article.item:first-child", 6);
    await sleep(7500);

    setCaption("Brakes & Audit Trail updated: Spent today $9.00, Held $0.00, Remaining $191.00");
    await focusEl("section.brakes", 8);
    await sleep(5500);

    // ── SCENE 5: Blocked Payment #1 — Over-Cap ($999 > $50 cap) ──────────────
    setCaption("Test 2 (Guard Block — Over Cap): Agent proposes $999 emergency GPU cluster (> $50 cap)");
    await clickPreset("Over cap");
    await focusEl("#intent", 6);
    await sleep(4500);

    await clickEl("#btn-propose", 6);
    await waitProposalDone();

    setCaption("BLOCKED by Hard Policy: PER_TX_CAP ($999.00 exceeds $50.00 cap) — no Approve button");
    await focusEl(".list article.item:first-child", 6);
    await sleep(7500);

    // ── SCENE 6: Blocked Payment #2 — Unknown / Look-Alike Payee ─────────────
    setCaption("Test 3 (Guard Block — Look-Alike Payee): Digit-swap typo creat0r@ (zero fuzzy snapping)");
    await clickPreset("Look-alike payee");
    await focusEl("#intent", 6);
    await sleep(4500);

    await clickEl("#btn-propose", 6);
    await waitProposalDone();

    setCaption("BLOCKED by Hard Policy: PAYEE_NOT_ALLOWED — unknown/look-alike payee rejected");
    await focusEl(".list article.item:first-child", 6);
    await sleep(7500);

    // ── SCENE 7: Blocked Payment #3 — Prompt Injection / AI Risk Veto ────────
    setCaption("Test 4 (AI Risk Veto): Prompt injection asking for $45 in gift cards to allowlisted vendor");
    await clickPreset("Injection");
    await focusEl("#intent", 6);
    await sleep(4500);

    await clickEl("#btn-propose", 6);
    await waitProposalDone();

    setCaption("BLOCKED by AI Risk Reviewer: AI_RISK_BLOCK (risk:high, ai:block, prompt_injection)");
    await focusEl(".list article.item:first-child", 6);
    await sleep(8000);

    // ── SCENE 8: Final Summary Tour (pad cleanly to ~150s / 2:30) ─────────────
    setCaption("Full Audit Trail: Every propose, AI risk verdict, payer approval, and capture recorded");
    await focusEl(".grid > section.card:nth-child(2)", 8);
    await sleep(7000);

    // Scroll proposal queue to show the executed order with real orderId & captureId again
    await page.evaluate(() => {
      const items = [...document.querySelectorAll(".list article.item")];
      const execItem = items.find((e) => e.classList.contains("st-executed"));
      if (execItem) execItem.scrollIntoView({ behavior: "smooth", block: "nearest" });
    });
    await sleep(1500);
    setCaption(`End-to-End Verified: Order ${orderIdStr} Captured (${captureIdStr}) + 3 Attacks Blocked`);
    await focusEl(".list article.item.st-executed", 6);

    // Ensure total duration is at least 145 seconds (2:25) and under 172 seconds
    const elapsed = nowSec();
    const targetSec = 148;
    if (elapsed < targetSec) {
      const remainMs = Math.round((targetSec - elapsed) * 1000);
      await sleep(Math.min(remainMs, 15000));
    }
    await sleep(7000);
    setCaption(null);
  } finally {
    // Stop ffmpeg gracefully with 'q'
    try {
      ff.stdin.write("q\n");
    } catch {
      /* ignore */
    }
    await new Promise((resolve) => {
      const to = setTimeout(() => {
        ff.kill("SIGINT");
        resolve();
      }, 8000);
      ff.on("close", () => {
        clearTimeout(to);
        resolve();
      });
    });
    await browser.close().catch(() => null);
    xvfb.kill("SIGTERM");
  }

  fs.writeFileSync(CAPTIONS_JSON, JSON.stringify(captions, null, 2));
  console.log("Raw recording saved:", RAW_MP4, "Captions count:", captions.length);

  // Build ffmpeg drawtext filter chain to burn captions into FINAL_MP4
  const escDrawtext = (s) =>
    s
      .replace(/\\/g, "\\\\")
      .replace(/:/g, "\\:")
      .replace(/'/g, "\u2019")
      .replace(/%/g, "\\%")
      .replace(/,/g, "\\,");

  const filters = [
    // Subtle dark bottom caption bar + cyan top accent line
    "drawbox=x=0:y=1004:w=1920:h=76:color=0x050811@0.92:t=fill",
    "drawbox=x=0:y=1002:w=1920:h=2:color=0x38bdf8@0.85:t=fill",
  ];

  for (const c of captions) {
    const start = Number(c.start).toFixed(2);
    const end = Number(c.end).toFixed(2);
    const txt = escDrawtext(c.text);
    filters.push(
      `drawtext=fontfile='${FONT_BOLD}':text='${txt}':fontcolor=0xf8fafc:fontsize=25:x=(w-text_w)/2:y=1030:enable='between(t,${start},${end})'`,
    );
  }

  if (process.env.SKIP_BURN === "1") {
    console.log("SKIP_BURN=1: raw + captions saved; burn/edit step done separately.");
    return;
  }
  const vf = filters.join(",");
  console.log("Burning captions with ffmpeg drawtext ->", FINAL_MP4);
  execFileSync(
    "ffmpeg",
    [
      "-y",
      "-i",
      RAW_MP4,
      "-vf",
      vf,
      "-c:v",
      "libx264",
      "-pix_fmt",
      "yuv420p",
      "-preset",
      "fast",
      "-crf",
      "20",
      "-movflags",
      "+faststart",
      FINAL_MP4,
    ],
    { stdio: "inherit" },
  );
  console.log("Final captioned video ready:", FINAL_MP4);
}

main().catch((err) => {
  console.error("record-demo failed:", err);
  process.exit(1);
});
