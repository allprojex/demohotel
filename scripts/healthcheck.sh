#!/usr/bin/env bash
# Infinity PMS — health check
# Usage: ./scripts/healthcheck.sh [URL]
#   URL defaults to http://localhost:3000
# Exit codes: 0 healthy · 1 degraded · 2 unreachable
set -euo pipefail

URL="${1:-http://localhost:3000}"
ENDPOINT="${URL%/}/api/public/health"

echo "→ Probing $ENDPOINT"

if ! command -v curl >/dev/null 2>&1; then
  echo "curl is required" >&2
  exit 2
fi

TMP="$(mktemp)"
trap 'rm -f "$TMP"' EXIT

HTTP_CODE="$(curl -sS -o "$TMP" -w '%{http_code}' --max-time 10 "$ENDPOINT" || echo 000)"

if [[ "$HTTP_CODE" == "000" ]]; then
  echo "✗ Unreachable (network / server down)"
  exit 2
fi

echo "HTTP $HTTP_CODE"
if command -v jq >/dev/null 2>&1; then
  jq . "$TMP"
else
  cat "$TMP"
  echo
fi

case "$HTTP_CODE" in
  200) echo "✓ Healthy"; exit 0 ;;
  503) echo "✗ Degraded — see checks above"; exit 1 ;;
  *)   echo "✗ Unexpected status $HTTP_CODE"; exit 1 ;;
esac
