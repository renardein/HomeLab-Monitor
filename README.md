# Proxmox Monitor

[Switch to Russian](./RU_README.md)

![Dashboard](./assets/Screenshot_1.png)

## Project Description
**Proxmox Monitor** is a web application for real-time monitoring of Proxmox VE clusters. The application provides a user-friendly interface for tracking node status, storage, backup jobs, and overall cluster health.

## Features

### Core Functions
- 🖥️ **Node Monitoring** — display status, CPU load, RAM usage, and uptime for each node
- 💾 **Storage Monitoring** — information about all cluster storages with detailed space usage
- 📦 **Backup Jobs** — view and monitor all backup jobs
- 🏛️ **Cluster Quorum** — track quorum status and node votes
- 🔄 **Auto Refresh** — customizable data update intervals
- 🌐 **Multilingual** — support for Russian and English languages
- 🎨 **Themes** — light and dark themes
- 🔐 **Security** — authorization via Proxmox API tokens
- 💾 **Caching** — intelligent data caching with different TTLs for different data types

### Interface
- Responsive design based on Bootstrap 5
- Tables with sorting and search (DataTables)
- Visual status indicators with configurable thresholds
- Toast notifications for events
- Monitor mode for large screen display
- Demo mode for testing without cluster connection

## Project Architecture
```
proxmox-monitor/
├── server.js                 # Main Express server file
├── package.json              # npm dependencies and scripts
├── .env                      # Environment variables
├── public/                   # Frontend static files
│   ├── index.html           # Main HTML file
│   ├── css/
│   │   └── styles.css       # Application styles
│   └── js/
│       └── app.js           # Client-side logic
├── modules/                  # Server modules
│   ├── config.js            # Application configuration
│   ├── proxmox-api.js       # Proxmox API client
│   ├── cache.js             # Caching system
│   ├── i18n.js              # Internationalization
│   ├── locales.js           # Translations (RU/EN)
│   ├── utils.js             # Utilities
│   ├── middleware/
│   │   └── auth.js          # Authorization middleware
│   └── routes/              # API routes
│       ├── status.js        # Server status
│       ├── auth.js          # Authorization routes
│       ├── cluster.js       # Cluster data
│       ├── nodes.js         # Node data
│       ├── storage.js       # Storage data
│       └── backups.js       # Backup data
└── node_modules/            # npm dependencies
```

## Installation

### Requirements
- Node.js version 14 or higher
- Access to Proxmox VE cluster (API)
- Proxmox API token with required permissions (Sys.Audit, Sys.Monitor, VM.Audit, VM.Monitor)

### Installation Steps

1. **Clone the repository**
```bash
git clone <repository-url>
cd proxmox-monitor
```

2. **Install dependencies**
```bash
npm install
```

3. **Configure environment variables**
Copy the `.env` file and adjust the settings:
```bash
# Server settings
PORT=81
NODE_ENV=production

# Proxmox settings
PROXMOX_HOST=10.200.0.1
PROXMOX_PORT=8006

# Security settings
CORS_ORIGIN=*

# Cache settings
CACHE_TTL=30

# Default language (ru or en)
DEFAULT_LANGUAGE=en
```