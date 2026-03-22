# HomeLab Monitor

[English](./README.md) | [Русский](./RU_README.md)

Local web dashboard for Proxmox and TrueNAS with separate dashboard and monitor layouts.

## Features

- Proxmox VE cluster monitoring
- TrueNAS CORE/SCALE monitoring
- Service checks via TCP, UDP, HTTP(S), SNMP, and NUT
- VM / CT monitor cards with custom icons and colors
- UPS and SNMP network device monitoring
- Speedtest screen
- Extra Proxmox host metrics: CPU temperature and link speed via the [Node.js agent](./docs/proxmox_agent_manual.md)
- Fullscreen monitor mode with swipe / arrow navigation
- Monitor mode uses the light theme by default
- Settings password protection, import / export, and local SQLite storage
- **First-run setup wizard**: language, Proxmox or TrueNAS path, connection, or **import a full JSON backup** (same format as Settings → export) to restore configuration in one step
- **Telegram integration**: bot token, notification rules by event type (services, VM/CT, nodes, SNMP slots, host CPU temperature, link speed), optional **custom message templates** with type-specific placeholders (edited in a dedicated dialog)
- **Host metrics agent**: install or remove the agent on a Proxmox node **via SSH from the UI**, and remove the agent from a node when no longer needed

## UI Mockup

The current interface demo is available in the repository: [`demo/index.html`](./demo/index.html).

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
http://localhost:81
```

## Configuration

1. Open the application in your browser. On first launch (or after a full settings reset), complete the **initial setup wizard** or import a backup JSON.
2. Add a Proxmox and/or TrueNAS connection in `Settings` if you did not do it in the wizard.
3. Configure services, VM / CT, UPS, SNMP devices, Speedtest, and host metrics.
4. Adjust monitor screen order, themes, display options, and monitor visibility.
5. Optionally configure **Telegram** rules under Settings.
6. Optionally enable settings password protection and use import / export.

## Notes

- PBS is not supported at the moment.
- The demo pages in [`demo/`](./demo/) reflect the current repository UI mockup.

## Donations

If the project is useful for you, you can support its development:

- ETH: `0xEe57816adDf7169CfebB54Ce77dA407b6fca9815`
- BTC: `bc1qlejccr50w24ujw2yeet985whgg7p96r8e8g5ng`
- USDT TRC20: `TEMp44kLxh51SGLoZZLVvnxvzs6g1taBaN`
- TON: `UQDGINS0CtpgF6J7CFrih8SS45AutPHUViz5xWKt3siODj3x`