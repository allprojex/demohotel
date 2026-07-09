# Offline Deployment Guide — Infinity Hotel PMS

Runtime: **Node.js 20 LTS or 22 LTS** (verified with Node v22).
Package manager: **Bun** (preferred) or **npm**.
Framework: TanStack Start v1 (Vite 7 + React 19), server target: Cloudflare Workers-compatible.

This guide covers preparing an **offline bundle** on an internet-connected workstation, then deploying it on an air-gapped Linux server. Instructions cover **Kali Linux**, **Ubuntu 22.04/24.04**, and **VS Code** for admin editing.

---

## 1. Verify the runtime

The app is built with Node.js. Confirm on any target machine:

```bash
node -v      # expect v20.x or v22.x
npm -v
```

If Node is missing, install it (see section 3).

---

## 2. Prepare the offline bundle (online machine)

```bash
# 1. Clone / copy the source
git clone <repo-url> infinity-pms && cd infinity-pms

# 2. Install and build with all deps cached
npm ci
npm run build

# 3. Download the exact Node runtime for the target arch
NODE_VER=v22.11.0
curl -LO https://nodejs.org/dist/${NODE_VER}/node-${NODE_VER}-linux-x64.tar.xz

# 4. Vendor npm packages so the offline box needs no registry
npm pack --pack-destination ./offline-cache $(node -e "const p=require('./package.json');console.log(Object.keys({...p.dependencies,...p.devDependencies}).join(' '))")

# 5. Bundle everything for transfer
tar czf infinity-pms-offline.tgz \
    package.json package-lock.json \
    src/ public/ vite.config.ts tsconfig.json \
    .output/ node-${NODE_VER}-linux-x64.tar.xz offline-cache/
```

Copy `infinity-pms-offline.tgz` to the offline server via USB, SFTP over LAN, or approved transfer media.

---

## 3. Install Node.js on the target server (offline)

### Ubuntu 22.04 / 24.04

```bash
sudo tar -C /usr/local --strip-components=1 -xJf node-v22.11.0-linux-x64.tar.xz
node -v && npm -v
```

Or from Ubuntu repos (online only):
```bash
sudo apt update && sudo apt install -y nodejs npm
```

### Kali Linux

```bash
# Offline (using the tarball you shipped):
sudo tar -C /usr/local --strip-components=1 -xJf node-v22.11.0-linux-x64.tar.xz

# Online alternative:
sudo apt update && sudo apt install -y nodejs npm git curl
```

### Optional: Bun (faster installs)

```bash
curl -fsSL https://bun.sh/install | bash        # online
# offline: copy the bun binary to /usr/local/bin/bun and chmod +x
bun -v
```

---

## 4. Deploy the app (offline server)

```bash
tar xzf infinity-pms-offline.tgz && cd infinity-pms

# Install from the vendored cache — no registry contact
npm ci --offline --cache ./offline-cache --prefer-offline

# Run the built server
node .output/server/index.mjs
# App listens on http://localhost:3000 by default
```

### Run under systemd

```bash
sudo tee /etc/systemd/system/infinity-pms.service >/dev/null <<'EOF'
[Unit]
Description=Infinity Hotel PMS
After=network.target

[Service]
Type=simple
User=pms
WorkingDirectory=/opt/infinity-pms
Environment=NODE_ENV=production
Environment=PORT=3000
ExecStart=/usr/local/bin/node .output/server/index.mjs
Restart=on-failure

[Install]
WantedBy=multi-user.target
EOF

sudo systemctl daemon-reload
sudo systemctl enable --now infinity-pms
sudo systemctl status infinity-pms
```

### Reverse proxy with Nginx (optional)

```bash
sudo apt install -y nginx
sudo tee /etc/nginx/sites-available/pms >/dev/null <<'EOF'
server {
  listen 80;
  server_name pms.local;
  location / {
    proxy_pass http://127.0.0.1:3000;
    proxy_set_header Host $host;
    proxy_set_header X-Forwarded-For $remote_addr;
    proxy_http_version 1.1;
    proxy_set_header Upgrade $http_upgrade;
    proxy_set_header Connection "upgrade";
  }
}
EOF
sudo ln -s /etc/nginx/sites-available/pms /etc/nginx/sites-enabled/
sudo nginx -t && sudo systemctl reload nginx
```

---

## 5. Environment variables

Copy `.env` from the online machine (or create it):

```bash
cat > .env <<'EOF'
VITE_SUPABASE_URL=https://<your-project>.supabase.co
VITE_SUPABASE_PUBLISHABLE_KEY=<publishable-key>
SUPABASE_URL=https://<your-project>.supabase.co
SUPABASE_PUBLISHABLE_KEY=<publishable-key>
NODE_ENV=production
PORT=3000
EOF
chmod 600 .env
```

Never commit `.env` or the service-role key to source control.

---

## 6. VS Code (admin editing)

### Install on Ubuntu / Kali

```bash
# Online
sudo apt install -y wget gpg
wget -qO- https://packages.microsoft.com/keys/microsoft.asc | \
  gpg --dearmor | sudo tee /usr/share/keyrings/microsoft.gpg >/dev/null
echo "deb [arch=amd64 signed-by=/usr/share/keyrings/microsoft.gpg] \
  https://packages.microsoft.com/repos/code stable main" | \
  sudo tee /etc/apt/sources.list.d/vscode.list
sudo apt update && sudo apt install -y code

# Offline: transfer the .deb and install
sudo dpkg -i code_*.deb || sudo apt -f install
```

### Recommended extensions (offline: use `.vsix`)

```bash
code --install-extension dbaeumer.vscode-eslint
code --install-extension esbenp.prettier-vscode
code --install-extension bradlc.vscode-tailwindcss
code --install-extension ms-vscode.vscode-typescript-next
```

Offline install:
```bash
code --install-extension /path/to/extension.vsix
```

### Open the project

```bash
cd /opt/infinity-pms && code .
```

---

## 7. Health checks after deployment

```bash
# 1. Process is running
systemctl is-active infinity-pms

# 2. Server responds
curl -I http://localhost:3000

# 3. Node version matches
node -v

# 4. No unresolved dependencies
npm ls --production --depth=0
```

If any check fails, review `journalctl -u infinity-pms -n 200 --no-pager`.

---

## 8. Updating an offline install

1. On the online machine, repeat section 2 to build a new `infinity-pms-offline.tgz`.
2. On the server:
   ```bash
   sudo systemctl stop infinity-pms
   sudo tar xzf infinity-pms-offline.tgz -C /opt/infinity-pms --strip-components=0
   cd /opt/infinity-pms
   npm ci --offline --cache ./offline-cache
   sudo systemctl start infinity-pms
   ```

---

## 9. Backups

- Database: run the **Admin → Backups** feature in the app, or `pg_dump` against your Postgres if self-hosted.
- Files: back up `/opt/infinity-pms` (excluding `node_modules`) and `.env` to encrypted storage.

---

**Verified runtime:** Node.js v22.22.0 (LTS-compatible). The app is 100% JavaScript/TypeScript running on Node — no Python, Java, or .NET runtime required on the server.
