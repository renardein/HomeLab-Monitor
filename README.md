# HomeLab Monitor

[English](./README.md) | [Русский](./RU_README.md)

Local web dashboard for Proxmox and TrueNAS with separate dashboard and monitor layouts.

## Features

- **Proxmox VE**: nodes, storage, VMs/CTs, backups, and quorum on the cluster screen
- **TrueNAS**: CORE/SCALE system overview
- **Service checks**: TCP, UDP, HTTP(S), SNMP, and NUT
- **VM / CT monitor**: Iconify icons and colors; show or hide each card in monitor mode
- **UPS and SNMP**: NUT UPS units and SNMP network devices
- **Cluster tiles**: up to 12 KPIs (service, VM/CT, SNMP device, UPS, or Speedtest) on the Cluster screen
- **Time and weather**: timezone and city; separate visibility on the dashboard and in monitor mode
- **Speedtest**: scheduled runs via the Ookla CLI (see [Environment variables](#environment-variables))
- **Backup jobs**: execution status in monitor mode
- **Host metrics**: CPU temperature and link speed via the [Node.js agent](./docs/proxmox_agent_manual.md); cluster discovery; install or remove the agent over SSH from the UI
- **Monitor mode**: fullscreen screens, order, swipe and arrow navigation; light theme by default
- **Telegram**: bot token; optional proxy for `api.telegram.org`; rules by event type; custom message templates with placeholders
- **First run**: setup wizard or full JSON import (same format as Settings → export)
- **Settings**: password, session TTL, import/export, SQLite storage
- **Display**: refresh interval, custom CSS, style presets, CPU/RAM gauge thresholds
- **Diagnostics**: debug panel, About (markdown), GitHub release check
- **Localization**: multiple languages
- **HTTPS**: optional TLS (`certs/` or `SSL_*`); `TRUST_PROXY` behind a reverse proxy ([Environment variables](#environment-variables))

## UI Mockup

The current interface demo is in [`docs/demo/index.html`](./docs/demo/index.html) (root [`demo/index.html`](./demo/index.html) redirects there).

## Quick Start

Requirements:

- Node.js 16+

Install dependencies:

```bash
npm install
```

Run the app:

```bash
npm start
```

Development mode:

```bash
npm run dev
```

Host metrics agent:

```bash
npm run host-metrics-agent
```

Default address:

```text
http://localhost:3000
```

(Override with `PORT` in `.env`; the value `81` in older docs was an example only.)

## Environment variables

Optional: copy [`.env.example`](./.env.example) to `.env` in the project root. Variables are read by [`modules/config.js`](./modules/config.js) via `dotenv` when the server starts.

| Variable | Description |
|----------|-------------|
| **Server** | |
| `PORT` | HTTP/HTTPS listen port (default: `3000`). |
| `NODE_ENV` | `development` or `production` (affects cookies `Secure` together with TLS). |
| `BIND_HOST` | Bind address (default: `0.0.0.0`). |
| `PUBLIC_URL` / `APP_URL` | Public base URL without trailing slash, e.g. `https://monitor.example.com` (logging / diagnostics). |
| **TLS (HTTPS)** | |
| `SSL_KEY_PATH` | Path to private key (PEM or DER PKCS#8/PKCS#1). |
| `SSL_CERT_PATH` | Path to certificate (PEM or DER `.cer`). |
| `SSL_CA_PATH` | Optional intermediate / chain file. |
| — | If unset, the app auto-enables HTTPS when **`certs/privkey.pem` + `certs/fullchain.pem`** or **`certs/private.key` + `certs/certificate.cer`** exist. See [`certs/README.md`](./certs/README.md). |
| `TRUST_PROXY` | `1` or a number of hops: use behind nginx/Caddy so `X-Forwarded-*` and HTTPS are correct. |
| `COOKIE_SECURE` | `0` / `1` to force non-secure or secure cookies; otherwise auto (HTTPS or `production`). |
| **Default API hosts** (fallback when no connection is stored in the UI) | |
| `PROXMOX_HOST` / `PROXMOX_PORT` | Default Proxmox API host and port (defaults: `10.200.0.1`, `8006`). |
| `TRUENAS_HOST` / `TRUENAS_PORT` | Default TrueNAS API host and port (defaults: `10.200.0.2`, `443`). |
| **Other** | |
| `CORS_ORIGIN` | CORS origin for the Express API (default: `*`). |
| `CACHE_TTL` | In-memory API cache TTL in seconds (default: `30`). |
| `DEFAULT_LANGUAGE` | Default server-side language code (default: `ru`). |
| `LOG_DIR` | Directory for `app.log` (default: `./data/logs`). |
| `LOG_MAX_BYTES` | Log rotation size (default: 5 MiB). |
| `LOG_BACKUPS` | Number of rotated log files to keep (default: `5`). |
| `SPEEDTEST_CLI` / `SPEEDTEST_PATH` | Path to the Speedtest/Ookla CLI binary. |
| **Host metrics agent** (only for `npm run host-metrics-agent`, not the main app) | |
| `HOST_METRICS_AGENT_HOST` | Listen address (default: `0.0.0.0`). |
| `HOST_METRICS_AGENT_PORT` | Listen port (default: `9105`). |
| `HOST_METRICS_AGENT_BASE_PATH` | HTTP base path (default: `/host-metrics`). |
| `HOST_METRICS_SENSORS_BIN` / `HOST_METRICS_ETHTOOL_BIN` | Paths to `sensors` and `ethtool`. |
| `HOST_METRICS_COMMAND_TIMEOUT_MS` | Command timeout (default: `3000`). |

## Configuration

1. Open the application in your browser. On first launch (or after a full settings reset), complete the **initial setup wizard** or import a backup JSON.
2. Add a Proxmox and/or TrueNAS connection in `Settings` if you did not do it in the wizard.
3. Configure services, VM / CT, UPS, SNMP devices, Speedtest, and host metrics.
4. Adjust monitor screen order, themes, display options, and monitor visibility.
5. Optionally configure **Telegram** rules under Settings.
6. Optionally enable settings password protection and use import / export.

## Notes

- PBS is not supported at the moment.
- The demo pages in [`docs/demo/`](./docs/demo/) reflect the current repository UI mockup.

## Donations

If the project is useful for you, you can support its development:

- ETH: `0xEe57816adDf7169CfebB54Ce77dA407b6fca9815`
- BTC: `bc1qlejccr50w24ujw2yeet985whgg7p96r8e8g5ng`
- USDT TRC20: `TEMp44kLxh51SGLoZZLVvnxvzs6g1taBaN`
- TON: `UQDGINS0CtpgF6J7CFrih8SS45AutPHUViz5xWKt3siODj3x`