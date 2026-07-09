#!/usr/bin/env bash
# Infinity PMS — one-shot offline installer
# Sets up dependencies, environment, systemd service, and starts the app.
#
# Usage:  sudo ./scripts/offline-install.sh [/opt/infinity-pms]
#
# Expects to be run from the extracted release bundle directory containing:
#   package.json, package-lock.json, .output/, offline-cache/, and a Node tarball.
set -euo pipefail

TARGET="${1:-/opt/infinity-pms}"
NODE_TARBALL="$(ls node-*-linux-x64.tar.xz 2>/dev/null | head -n1 || true)"
SERVICE_NAME="infinity-pms"
RUN_USER="pms"
PORT="${PORT:-3000}"

log() { printf '\033[1;34m→\033[0m %s\n' "$*"; }
ok()  { printf '\033[1;32m✓\033[0m %s\n' "$*"; }
die() { printf '\033[1;31m✗\033[0m %s\n' "$*" >&2; exit 1; }

[[ $EUID -eq 0 ]] || die "Run as root (sudo)."

# 1. Install Node if missing
if ! command -v node >/dev/null 2>&1; then
  [[ -n "$NODE_TARBALL" ]] || die "node not installed and no node-*-linux-x64.tar.xz in cwd."
  log "Installing Node from $NODE_TARBALL"
  tar -C /usr/local --strip-components=1 -xJf "$NODE_TARBALL"
fi
NODE_VER="$(node -v)"
ok "Node $NODE_VER"

case "$NODE_VER" in
  v20.*|v22.*) ;;
  *) die "Unsupported Node version $NODE_VER — need v20 or v22." ;;
esac

# 2. Create service user
if ! id "$RUN_USER" >/dev/null 2>&1; then
  log "Creating system user $RUN_USER"
  useradd --system --shell /usr/sbin/nologin --home "$TARGET" "$RUN_USER"
fi

# 3. Copy release to $TARGET
log "Deploying to $TARGET"
mkdir -p "$TARGET"
rsync -a --delete --exclude .env --exclude 'node_modules' ./ "$TARGET"/

# 4. Install dependencies from vendored offline cache
if [[ -d "$TARGET/offline-cache" ]]; then
  log "Installing dependencies from offline cache"
  ( cd "$TARGET" && npm ci --offline --cache ./offline-cache --prefer-offline )
else
  log "No offline-cache/ — falling back to online npm ci"
  ( cd "$TARGET" && npm ci )
fi
ok "Dependencies installed"

# 5. Environment file
if [[ ! -f "$TARGET/.env" ]]; then
  log "Creating .env template — EDIT before starting"
  cat > "$TARGET/.env" <<EOF
# ---- Infinity PMS runtime env ----
NODE_ENV=production
PORT=$PORT
SUPABASE_URL=
SUPABASE_PUBLISHABLE_KEY=
VITE_SUPABASE_URL=
VITE_SUPABASE_PUBLISHABLE_KEY=
# CRON_SECRET=$(head -c 32 /dev/urandom | base64 | tr -d '=+/' | head -c 40)
EOF
  chmod 600 "$TARGET/.env"
else
  ok "Existing .env preserved"
fi

chown -R "$RUN_USER:$RUN_USER" "$TARGET"

# 6. systemd unit
UNIT="/etc/systemd/system/${SERVICE_NAME}.service"
log "Writing $UNIT"
cat > "$UNIT" <<EOF
[Unit]
Description=Infinity Hotel PMS
After=network.target

[Service]
Type=simple
User=$RUN_USER
WorkingDirectory=$TARGET
EnvironmentFile=$TARGET/.env
ExecStart=/usr/local/bin/node .output/server/index.mjs
Restart=on-failure
RestartSec=3

[Install]
WantedBy=multi-user.target
EOF

systemctl daemon-reload
systemctl enable "$SERVICE_NAME"

# 7. Start service (only if .env has been filled in)
if grep -q '^SUPABASE_URL=$' "$TARGET/.env"; then
  cat <<'MSG'

────────────────────────────────────────────────────────────
  .env still has empty values.
  Fill in SUPABASE_URL / SUPABASE_PUBLISHABLE_KEY (and VITE_*),
  then start with:  sudo systemctl start infinity-pms
────────────────────────────────────────────────────────────
MSG
  exit 0
fi

log "Starting service"
systemctl restart "$SERVICE_NAME"
sleep 2
systemctl --no-pager --full status "$SERVICE_NAME" || true

# 8. Post-install health probe
if command -v curl >/dev/null 2>&1; then
  log "Probing http://localhost:$PORT/api/public/health"
  curl -sS --max-time 10 "http://localhost:$PORT/api/public/health" | head -c 2000 || true
  echo
fi

ok "Install complete."
