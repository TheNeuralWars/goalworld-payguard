#!/usr/bin/env bash
# Run a command with the Hermes fleet OmniRoute key exported as PAYGUARD_LLM_API_KEY.
# The key is read from the Hermes env file on the Goalchain VPS and never printed.
#   scripts/with-omniroute.sh npm run demo
set -euo pipefail
ENV_FILE="${HERMES_ENV_FILE:-/data/hermes-home/.env}"
if [ -z "${PAYGUARD_LLM_API_KEY:-}" ] && [ -z "${OMNIROUTE_API_KEY:-}" ]; then
  if [ -r "$ENV_FILE" ]; then
    key="$(grep -E '^OMNIROUTE_API_KEY=' "$ENV_FILE" | head -1 | cut -d= -f2- | sed -e 's/^["'\'']//' -e 's/["'\'']$//')"
    if [ -n "$key" ]; then export PAYGUARD_LLM_API_KEY="$key"; fi
    unset key
  else
    echo "with-omniroute: $ENV_FILE not readable — running without LLM (heuristic fallback)" >&2
  fi
fi
export PAYGUARD_LLM_BASE_URL="${PAYGUARD_LLM_BASE_URL:-http://127.0.0.1:20128/v1}"
export PAYGUARD_LLM_MODEL="${PAYGUARD_LLM_MODEL:-free-smart}"
exec "$@"
