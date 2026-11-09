#!/usr/bin/env bash
# Boot a throwaway PayGuard (mock PayPal + OmniRoute LLM), drive the jury scenarios,
# and capture headless-Chromium screenshots.
#   npm run build && npm run screenshot -- [outdir]
set -euo pipefail
cd "$(dirname "$0")/.."
OUT="${1:-artifacts/evidence}"
PORT="${SHOT_PORT:-3049}"
TAG="${SHOT_TAG:-mock}"   # SHOT_TAG=sandbox with PAYGUARD_MODE=sandbox under vault-run
STORE="$(mktemp -u /tmp/payguard-shot-XXXX).json"
mkdir -p "$OUT"
CHROME="$(command -v google-chrome || command -v chromium-browser || command -v chromium)"

PAYGUARD_AUDIT_PATH="$STORE" PAYGUARD_APP_BASE_URL="http://127.0.0.1:$PORT" \
  scripts/with-omniroute.sh npx next start -H 127.0.0.1 -p "$PORT" >/tmp/payguard-shot-server.log 2>&1 &
SRV=$!
trap 'kill $SRV 2>/dev/null || true; rm -f "$STORE"' EXIT
for _ in $(seq 1 60); do curl -sf "http://127.0.0.1:$PORT/api/health" >/dev/null && break; sleep 1; done

BASE="http://127.0.0.1:$PORT" npx tsx scripts/drive-ui.ts | tee "$OUT/ui-drive-$TAG.txt"
CHECKOUT="$(grep '^CHECKOUT_URL=' "$OUT/ui-drive-$TAG.txt" | cut -d= -f2-)"

shot() {
  timeout 90 "$CHROME" --headless=new --no-sandbox --disable-gpu --hide-scrollbars \
    --virtual-time-budget=8000 --window-size="$2" --screenshot="$3" "$1" >/dev/null 2>&1
  echo "screenshot → $3"
}
shot "http://127.0.0.1:$PORT/" 1440,2600 "$OUT/payguard-ui-$TAG.png"
if [[ "$CHECKOUT" == http://127.0.0.1* ]]; then shot "$CHECKOUT" 1000,800 "$OUT/payguard-mock-paypal-approval.png"; fi
curl -s "http://127.0.0.1:$PORT/api/policy" > "$OUT/policy-after-ui-$TAG.json"
