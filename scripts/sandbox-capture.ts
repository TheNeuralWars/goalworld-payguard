/**
 * Inspect / capture one sandbox order by id (after the payer approved it).
 *   PAYGUARD_MODE=sandbox vault-run paypal-sandbox -- npx tsx scripts/sandbox-capture.ts <orderId> [--capture]
 */
import { loadConfig } from "../src/lib/config";
import { createPayPalAdapter } from "../src/lib/paypal/factory";

async function main() {
  const [id, flag] = process.argv.slice(2);
  if (!id) throw new Error("usage: sandbox-capture.ts <orderId> [--capture]");
  const cfg = loadConfig();
  if (cfg.mode !== "sandbox") throw new Error("PAYGUARD_MODE=sandbox required");
  const a = createPayPalAdapter(cfg);
  const o = await a.getOrder(id);
  console.log(`order ${o.id} status=${o.status}`);
  if (flag === "--capture" && o.status === "APPROVED") {
    const c = await a.captureOrder(id, `manual-${id}`);
    console.log(`captured ${c.id} status=${c.status} capture=${c.captureId} capture_status=${c.captureStatus}`);
  }
}
main().catch((e) => {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
});
