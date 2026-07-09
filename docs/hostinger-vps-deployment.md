# Hostinger VPS Deployment

This project is a TanStack Start app served by Nitro from `.output/server/index.mjs`.
Use Node 22.12 or newer on the VPS.

## 1. Prepare the VPS

SSH into the Hostinger VPS as root or a sudo user:

```bash
sudo apt update
sudo apt install -y git curl nginx certbot python3-certbot-nginx
curl -fsSL https://deb.nodesource.com/setup_22.x | sudo -E bash -
sudo apt install -y nodejs
node -v
```

The version should be `v22.12.0` or newer.

Create a locked service user:

```bash
sudo useradd --system --home /opt/infinity-pms --shell /usr/sbin/nologin pms || true
```

## 2. Clone the GitHub repository

```bash
sudo mkdir -p /opt/infinity-pms
sudo chown "$USER:$USER" /opt/infinity-pms
git clone https://github.com/awuahagyekum20/hotelms.git /opt/infinity-pms
cd /opt/infinity-pms
```

If the directory already exists:

```bash
cd /opt/infinity-pms
git pull --ff-only origin main
```

## 3. Configure environment

```bash
cp .env.production.example .env.production
nano .env.production
chmod 600 .env.production
```

Set these values from the new Supabase project:

- `SUPABASE_PROJECT_ID`
- `SUPABASE_URL`
- `SUPABASE_PUBLISHABLE_KEY`
- `SUPABASE_SERVICE_ROLE_KEY`
- `VITE_SUPABASE_PROJECT_ID`
- `VITE_SUPABASE_URL`
- `VITE_SUPABASE_PUBLISHABLE_KEY`

Set `SITE_URL` to the final public URL, for example `https://pms.example.com`.
Generate a strong `CRON_SECRET`:

```bash
openssl rand -base64 32
```

Important: Vite embeds `VITE_*` values at build time, so rebuild after changing Supabase browser keys.

## 4. Build and install the service

```bash
npm ci
npm run build

sudo cp deploy/hostinger/infinity-pms.service /etc/systemd/system/infinity-pms.service
sudo systemctl daemon-reload
sudo systemctl enable infinity-pms

sudo chown -R pms:pms /opt/infinity-pms
sudo systemctl start infinity-pms
sudo systemctl status infinity-pms
```

Health check:

```bash
curl http://127.0.0.1:3000/api/public/health
```

## 5. Configure Nginx

```bash
sudo cp deploy/hostinger/nginx.conf.example /etc/nginx/sites-available/infinity-pms
sudo nano /etc/nginx/sites-available/infinity-pms
sudo ln -sfn /etc/nginx/sites-available/infinity-pms /etc/nginx/sites-enabled/infinity-pms
sudo nginx -t
sudo systemctl reload nginx
```

Replace `YOUR_DOMAIN` before reloading Nginx.

Issue TLS after DNS points to the VPS:

```bash
sudo certbot --nginx -d YOUR_DOMAIN -d www.YOUR_DOMAIN
```

## 6. Deploy updates

After pushing changes to GitHub:

```bash
cd /opt/infinity-pms
git pull --ff-only origin main
sudo -E bash scripts/deploy-hostinger.sh
```

## 7. Useful commands

```bash
sudo journalctl -u infinity-pms -n 100 --no-pager
sudo systemctl restart infinity-pms
bash scripts/healthcheck.sh https://YOUR_DOMAIN
```
