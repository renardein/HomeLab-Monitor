const fs = require('fs');
const path = require('path');

const rootDir = path.join(__dirname, '..');
const demoDir = path.join(rootDir, 'docs', 'demo');
const publicCssPath = path.join(rootDir, 'public', 'css', 'styles.css');
const demoCssPath = path.join(demoDir, 'demo.css');

fs.mkdirSync(demoDir, { recursive: true });

const settingsPages = [
    { key: 'connection', file: 'settings-connection.html', title: 'Connection', icon: 'key' },
    { key: 'display', file: 'settings-display.html', title: 'Display', icon: 'eye' },
    { key: 'styles', file: 'settings-styles.html', title: 'Styles', icon: 'palette' },
    { key: 'thresholds', file: 'settings-thresholds.html', title: 'Thresholds', icon: 'speedometer2' },
    { key: 'services', file: 'settings-services.html', title: 'Service Monitoring', icon: 'activity' },
    { key: 'ups', file: 'settings-ups.html', title: 'UPS', icon: 'lightning' },
    { key: 'netdevices', file: 'settings-netdevices.html', title: 'Network Devices', icon: 'diagram-3' },
    { key: 'hostmetrics', file: 'settings-hostmetrics.html', title: 'Host Metrics', icon: 'thermometer-half' },
    { key: 'speedtest', file: 'settings-speedtest.html', title: 'Speedtest', icon: 'wifi' },
    { key: 'security', file: 'settings-security.html', title: 'Security', icon: 'shield-lock' },
    { key: 'import', file: 'settings-import.html', title: 'Import / Export', icon: 'upload' },
    { key: 'debug', file: 'settings-debug.html', title: 'Debug', icon: 'bug' },
    { key: 'about', file: 'settings-about.html', title: 'About', icon: 'info-circle' }
];

const normalPages = [
    { key: 'nodes', file: 'normal-nodes.html', title: 'Nodes' },
    { key: 'storage', file: 'normal-storage.html', title: 'Storage' },
    { key: 'servers', file: 'normal-servers.html', title: 'Servers' },
    { key: 'backups', file: 'normal-backups.html', title: 'Backups' },
    { key: 'quorum', file: 'normal-quorum.html', title: 'Quorum' },
    { key: 'services', file: 'normal-services.html', title: 'Service Monitoring' },
    { key: 'vms', file: 'normal-vms.html', title: 'VM / CT Monitor' },
    { key: 'netdev', file: 'normal-netdev.html', title: 'Network Devices' },
    { key: 'speedtest', file: 'normal-speedtest.html', title: 'Speedtest' }
];

const monitorPages = [
    { key: 'cluster', file: 'monitor-cluster.html', title: 'Cluster' },
    { key: 'services', file: 'monitor-services.html', title: 'Services' },
    { key: 'vms', file: 'monitor-vms.html', title: 'VM / CT' },
    { key: 'ups', file: 'monitor-ups.html', title: 'UPS' },
    { key: 'netdev', file: 'monitor-netdev.html', title: 'Network Devices' },
    { key: 'speedtest', file: 'monitor-speedtest.html', title: 'Speedtest' },
    { key: 'backupRuns', file: 'monitor-backups.html', title: 'Backups' }
];

const head = (title, monitor = false) => `<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>${title}</title>
    <link href="https://cdn.jsdelivr.net/npm/bootstrap@5.3.2/dist/css/bootstrap.min.css" rel="stylesheet">
    <link rel="stylesheet" href="https://cdn.jsdelivr.net/npm/bootstrap-icons@1.11.3/font/bootstrap-icons.min.css">
    <link rel="stylesheet" href="./demo.css">
</head>
<body${monitor ? ' class="monitor-mode"' : ''}>`;

const navbar = ({ serverType = 'Proxmox', currentServer = 'Cluster A' } = {}) => `
    <nav class="navbar navbar-expand-lg bg-white rounded-3 shadow-sm mb-4 p-3">
        <div class="container-fluid">
            <a class="navbar-brand fw-bold" href="./index.html">
                <i class="bi bi-diagram-3 text-primary me-2"></i>
                <span>HomeLab Monitor</span>
            </a>
            <div class="collapse navbar-collapse justify-content-end show">
                <ul class="navbar-nav align-items-center">
                    <li class="nav-item me-3">
                        <a class="btn btn-outline-primary btn-sm" href="./settings.html">
                            <i class="bi bi-sliders"></i> <span>Settings</span>
                        </a>
                    </li>
                    <li class="nav-item dropdown me-2">
                        <a class="btn btn-outline-secondary btn-sm dropdown-toggle" href="#">
                            <i class="bi bi-server me-1"></i><span>${serverType}</span>
                        </a>
                    </li>
                    <li class="nav-item me-2">
                        <a class="btn btn-outline-info btn-sm" href="./monitor.html" title="Monitor mode">
                            <i class="bi bi-display"></i> <span>Monitor</span>
                        </a>
                    </li>
                    <li class="nav-item">
                        <span class="badge bg-success">
                            <i class="bi bi-check-circle"></i> <span>Server OK</span>
                        </span>
                    </li>
                    <li class="nav-item">
                        <span class="badge bg-success-subtle text-success me-2">
                            <i class="bi bi-wifi"></i> <span>Connected</span>
                        </span>
                    </li>
                    <li class="nav-item me-3">
                        <span class="badge bg-info">
                            <i class="bi bi-server me-1"></i> <span>${currentServer}</span>
                        </span>
                    </li>
                    <li class="nav-item">
                        <button class="btn btn-primary" type="button">
                            <i class="bi bi-arrow-repeat me-2"></i><span>Refresh</span>
                        </button>
                    </li>
                </ul>
            </div>
        </div>
    </nav>`;

const footer = `
        <footer class="d-flex flex-wrap justify-content-between align-items-center py-3 my-4 border-top">
            <div class="col-md-4 d-flex align-items-center">
                <span class="mb-3 mb-md-0 text-body-secondary">© 2026 renardein</span>
                <span class="text-body-secondary ms-2 small">0.38-alpha</span>
            </div>
            <ul class="nav col-md-4 justify-content-end list-unstyled d-flex">
                <li class="ms-3"><span class="badge bg-secondary">EN</span></li>
                <li class="ms-3"><button class="btn btn-outline-dark btn-sm" type="button"><i class="bi bi-moon-stars-fill"></i></button></li>
            </ul>
        </footer>`;

const pageShell = (title, content, options = {}) => `${head(title, options.monitor)}
    <div class="container">
        ${options.monitor ? '' : navbar(options.navbar)}
        ${content}
        ${options.monitor ? '' : footer}
    </div>
</body>
</html>
`;

const settingsSidebar = (active) => settingsPages.map((item) => `
                            <a class="nav-link${item.key === active ? ' active' : ''}" href="./${item.file}" role="tab">
                                <i class="bi bi-${item.icon} me-2"></i><span>${item.title}</span>
                            </a>`).join('');

const settingLayout = (active, content) => `
        <div id="configSection" class="card" style="display: block;">
            <div class="card-body p-4">
                <div class="row">
                    <div class="col-md-3 col-lg-2 mb-3 mb-md-0 d-flex flex-column">
                        <nav class="nav flex-column nav-pills" role="tablist">
${settingsSidebar(active)}
                        </nav>
                        <div class="mt-auto pt-3 border-top">
                            <button class="btn btn-outline-secondary w-100" type="button">
                                <i class="bi bi-box-arrow-right me-1"></i><span>Exit Settings</span>
                            </button>
                        </div>
                    </div>
                    <div class="col-md-9 col-lg-10">
                        ${content}
                    </div>
                </div>
            </div>
        </div>`;

const monitorOrderList = `
<ul class="list-group list-group-flush border rounded overflow-hidden">
    <li class="list-group-item d-flex justify-content-between align-items-center"><span>Cluster</span><span class="text-muted small">1</span></li>
    <li class="list-group-item d-flex justify-content-between align-items-center"><span>UPS</span><span class="text-muted small">2</span></li>
    <li class="list-group-item d-flex justify-content-between align-items-center"><span>Network Devices</span><span class="text-muted small">3</span></li>
    <li class="list-group-item d-flex justify-content-between align-items-center"><span>Speedtest</span><span class="text-muted small">4</span></li>
    <li class="list-group-item d-flex justify-content-between align-items-center"><span>VM / CT</span><span class="text-muted small">5</span></li>
    <li class="list-group-item d-flex justify-content-between align-items-center"><span>Services</span><span class="text-muted small">6</span></li>
    <li class="list-group-item d-flex justify-content-between align-items-center"><span>Backups</span><span class="text-muted small">7</span></li>
</ul>`;

const settingsContent = {
    connection: `
<div class="tab-pane fade show active" role="tabpanel">
    <div class="settings-section mb-4">
        <h5 class="mb-3"><i class="bi bi-diagram-3 me-2"></i><span>Proxmox Connection</span></h5>
        <div class="alert alert-info py-2">
            <i class="bi bi-info-circle me-2"></i>
            <span>Enter the API token used to connect to the Proxmox cluster.</span>
        </div>
        <div class="mb-3">
            <label class="form-label fw-bold">API Token</label>
            <div class="row g-2">
                <div class="col-md-7">
                    <input type="text" class="form-control form-control-lg" value="root@pam!monitoring">
                    <div class="form-text">Part before "="</div>
                </div>
                <div class="col-md-5">
                    <input type="password" class="form-control form-control-lg" value="demo-secret">
                    <div class="form-text">Secret after "="</div>
                </div>
            </div>
            <div class="form-text">Format: user@realm!tokenid=secret</div>
        </div>
        <div class="mb-3">
            <label class="form-label fw-bold">Proxmox Servers</label>
            <div class="row g-2">
                <div class="col-12"><input type="text" class="form-control" value="https://10.200.0.1:8006"></div>
                <div class="col-12"><input type="text" class="form-control" value="https://10.200.0.2:8006"></div>
                <div class="col-12"><input type="text" class="form-control" value="https://10.200.0.3:8006"></div>
            </div>
            <button class="btn btn-outline-primary btn-sm mt-2" type="button"><i class="bi bi-plus-lg me-1"></i>Add Server</button>
            <div class="form-text">Fallback nodes are used when the primary endpoint is unavailable.</div>
        </div>
        <div class="d-grid gap-2">
            <button class="btn btn-outline-primary" type="button"><i class="bi bi-wifi me-2"></i>Test Connection</button>
            <button class="btn btn-primary btn-lg" type="button"><i class="bi bi-plug me-2"></i>Connect</button>
        </div>
        <div class="mt-3 text-center">
            <span class="badge bg-success"><i class="bi bi-circle-fill me-1"></i>Connected</span>
        </div>
    </div>
    <div class="settings-section">
        <h5 class="mb-3"><i class="bi bi-hdd-stack me-2"></i><span>TrueNAS Connection</span></h5>
        <div class="alert alert-info py-2">
            <i class="bi bi-info-circle me-2"></i>
            <span>Enter the API key used to connect to TrueNAS.</span>
        </div>
        <div class="mb-3">
            <label class="form-label fw-bold">TrueNAS API Key</label>
            <input type="password" class="form-control form-control-lg" value="truenas-demo-key">
            <div class="form-text">Paste the API key created in TrueNAS.</div>
        </div>
        <div class="mb-3">
            <label class="form-label fw-bold">TrueNAS Servers</label>
            <div class="row g-2">
                <div class="col-12"><input type="text" class="form-control" value="https://192.168.1.2"></div>
            </div>
            <button class="btn btn-outline-primary btn-sm mt-2" type="button"><i class="bi bi-plus-lg me-1"></i>Add Server</button>
        </div>
        <div class="d-grid gap-2">
            <button class="btn btn-outline-primary" type="button"><i class="bi bi-wifi me-2"></i>Test Connection</button>
            <button class="btn btn-primary btn-lg" type="button"><i class="bi bi-plug me-2"></i>Connect</button>
        </div>
    </div>
</div>`,
    display: `
<div class="tab-pane fade show active" role="tabpanel">
    <div class="settings-section">
        <h5 class="mb-3"><i class="bi bi-eye me-2"></i><span>Display</span></h5>
        <div class="row">
            <div class="col-md-6">
                <div class="mb-3">
                    <label class="form-label fw-bold">Refresh Interval</label>
                    <select class="form-select">
                        <option>5 sec</option>
                        <option>10 sec</option>
                        <option selected>30 sec</option>
                        <option>1 min</option>
                    </select>
                </div>
            </div>
            <div class="col-md-6">
                <div class="mb-3">
                    <label class="form-label fw-bold">Theme</label>
                    <div class="btn-group w-100" role="group">
                        <button class="btn btn-outline-primary" type="button"><i class="bi bi-sun me-1"></i>Light</button>
                        <button class="btn btn-outline-dark active" type="button"><i class="bi bi-moon me-1"></i>Dark</button>
                    </div>
                </div>
            </div>
        </div>
        <div class="row">
            <div class="col-md-6">
                <div class="mb-3">
                    <label class="form-label fw-bold">Default Language</label>
                    <select class="form-select">
                        <option selected>EN</option>
                        <option>RU</option>
                    </select>
                </div>
            </div>
        </div>
        <div class="mb-3">
            <label class="form-label fw-bold">Units</label>
            <div class="btn-group w-100" role="group">
                <button class="btn btn-outline-primary active" type="button">GB / TB</button>
                <button class="btn btn-outline-primary" type="button">GiB / TiB</button>
            </div>
        </div>
        <hr class="my-4">
        <div class="mb-2">
            <label class="form-label fw-bold">Time and Weather</label>
            <p class="text-muted small mb-3">Settings for the fourth card in the Cluster top row.</p>
            <div class="row g-3">
                <div class="col-md-6">
                    <label class="form-label fw-bold">City</label>
                    <input type="text" class="form-control" value="Berlin">
                    <div class="form-text">Used to resolve the current weather.</div>
                </div>
                <div class="col-md-6">
                    <label class="form-label fw-bold">Time zone</label>
                    <input type="text" class="form-control" value="Europe/Berlin">
                    <div class="form-text">Use an IANA time zone such as Europe/Berlin.</div>
                </div>
            </div>
            <button class="btn btn-primary btn-sm mt-3" type="button"><i class="bi bi-save me-1"></i>Save time and weather</button>
        </div>
        <hr class="my-4">
        <div class="mb-2">
            <label class="form-label fw-bold">Monitor Screen Order</label>
            <p class="text-muted small mb-2">Order used by swipe gestures and toolbar arrows. Backup screen is available only for Proxmox.</p>
            <ul class="list-group list-group-flush border rounded overflow-hidden">
                <li class="list-group-item d-flex align-items-center justify-content-between gap-2 py-2">
                    <span class="text-truncate"><i class="bi bi-display me-2 text-muted"></i>Cluster</span>
                    <span class="btn-group btn-group-sm flex-shrink-0" role="group">
                        <button type="button" class="btn btn-outline-secondary" disabled><i class="bi bi-arrow-up"></i></button>
                        <button type="button" class="btn btn-outline-secondary"><i class="bi bi-arrow-down"></i></button>
                    </span>
                </li>
                <li class="list-group-item d-flex align-items-center justify-content-between gap-2 py-2">
                    <span class="text-truncate"><i class="bi bi-display me-2 text-muted"></i>UPS</span>
                    <span class="btn-group btn-group-sm flex-shrink-0" role="group">
                        <button type="button" class="btn btn-outline-secondary"><i class="bi bi-arrow-up"></i></button>
                        <button type="button" class="btn btn-outline-secondary"><i class="bi bi-arrow-down"></i></button>
                    </span>
                </li>
                <li class="list-group-item d-flex align-items-center justify-content-between gap-2 py-2">
                    <span class="text-truncate"><i class="bi bi-display me-2 text-muted"></i>Network Devices</span>
                    <span class="btn-group btn-group-sm flex-shrink-0" role="group">
                        <button type="button" class="btn btn-outline-secondary"><i class="bi bi-arrow-up"></i></button>
                        <button type="button" class="btn btn-outline-secondary"><i class="bi bi-arrow-down"></i></button>
                    </span>
                </li>
                <li class="list-group-item d-flex align-items-center justify-content-between gap-2 py-2">
                    <span class="text-truncate"><i class="bi bi-display me-2 text-muted"></i>Speedtest</span>
                    <span class="btn-group btn-group-sm flex-shrink-0" role="group">
                        <button type="button" class="btn btn-outline-secondary"><i class="bi bi-arrow-up"></i></button>
                        <button type="button" class="btn btn-outline-secondary"><i class="bi bi-arrow-down"></i></button>
                    </span>
                </li>
                <li class="list-group-item d-flex align-items-center justify-content-between gap-2 py-2">
                    <span class="text-truncate"><i class="bi bi-display me-2 text-muted"></i>VM / CT</span>
                    <span class="btn-group btn-group-sm flex-shrink-0" role="group">
                        <button type="button" class="btn btn-outline-secondary"><i class="bi bi-arrow-up"></i></button>
                        <button type="button" class="btn btn-outline-secondary"><i class="bi bi-arrow-down"></i></button>
                    </span>
                </li>
                <li class="list-group-item d-flex align-items-center justify-content-between gap-2 py-2">
                    <span class="text-truncate"><i class="bi bi-display me-2 text-muted"></i>Services</span>
                    <span class="btn-group btn-group-sm flex-shrink-0" role="group">
                        <button type="button" class="btn btn-outline-secondary"><i class="bi bi-arrow-up"></i></button>
                        <button type="button" class="btn btn-outline-secondary"><i class="bi bi-arrow-down"></i></button>
                    </span>
                </li>
                <li class="list-group-item d-flex align-items-center justify-content-between gap-2 py-2">
                    <span class="text-truncate"><i class="bi bi-display me-2 text-muted"></i>Backups</span>
                    <span class="btn-group btn-group-sm flex-shrink-0" role="group">
                        <button type="button" class="btn btn-outline-secondary"><i class="bi bi-arrow-up"></i></button>
                        <button type="button" class="btn btn-outline-secondary" disabled><i class="bi bi-arrow-down"></i></button>
                    </span>
                </li>
            </ul>
        </div>
        <hr class="my-4">
        <div class="mb-2">
            <label class="form-label fw-bold">Cluster Screen Tiles</label>
            <p class="text-muted small mb-2">Build up to 12 tiles for the Cluster screen from UPS, VM / CT, services, SNMP devices, and Speedtest. They scroll horizontally on the screen.</p>
            <div class="border rounded p-3 mb-2">
                <div class="row g-2 align-items-end">
                    <div class="col-md-4">
                        <label class="form-label fw-bold small mb-1">Tile Type</label>
                        <select class="form-select">
                            <option selected>UPS</option>
                            <option>Service</option>
                            <option>VM / CT</option>
                            <option>SNMP Device</option>
                            <option>Speedtest</option>
                        </select>
                    </div>
                    <div class="col-md-5">
                        <label class="form-label fw-bold small mb-1">Data Source</label>
                        <select class="form-select">
                            <option selected>UPS 1: ups</option>
                            <option>UPS 2: rack-ups</option>
                        </select>
                    </div>
                    <div class="col-md-3">
                        <div class="d-flex gap-2 justify-content-md-end">
                            <button type="button" class="btn btn-outline-secondary btn-sm" disabled><i class="bi bi-arrow-up"></i></button>
                            <button type="button" class="btn btn-outline-secondary btn-sm"><i class="bi bi-arrow-down"></i></button>
                            <button type="button" class="btn btn-outline-danger btn-sm"><i class="bi bi-trash"></i></button>
                        </div>
                    </div>
                </div>
            </div>
            <div class="border rounded p-3 mb-2">
                <div class="row g-2 align-items-end">
                    <div class="col-md-4">
                        <label class="form-label fw-bold small mb-1">Tile Type</label>
                        <select class="form-select">
                            <option>UPS</option>
                            <option selected>Service</option>
                            <option>VM / CT</option>
                            <option>SNMP Device</option>
                            <option>Speedtest</option>
                        </select>
                    </div>
                    <div class="col-md-5">
                        <label class="form-label fw-bold small mb-1">Data Source</label>
                        <select class="form-select">
                            <option selected>Vaultwarden</option>
                            <option>Traefik</option>
                            <option>Grafana</option>
                        </select>
                    </div>
                    <div class="col-md-3">
                        <div class="d-flex gap-2 justify-content-md-end">
                            <button type="button" class="btn btn-outline-secondary btn-sm"><i class="bi bi-arrow-up"></i></button>
                            <button type="button" class="btn btn-outline-secondary btn-sm"><i class="bi bi-arrow-down"></i></button>
                            <button type="button" class="btn btn-outline-danger btn-sm"><i class="bi bi-trash"></i></button>
                        </div>
                    </div>
                </div>
            </div>
            <div class="d-flex gap-2 flex-wrap mt-3">
                <button class="btn btn-outline-primary btn-sm" type="button"><i class="bi bi-plus-lg me-1"></i>Add Tile</button>
                <button class="btn btn-primary btn-sm" type="button"><i class="bi bi-save me-1"></i>Save Tiles</button>
            </div>
        </div>
    </div>
</div>`,
    styles: `
<div class="tab-pane fade show active" role="tabpanel">
    <div class="settings-section">
        <h5 class="mb-3"><i class="bi bi-palette me-2"></i><span>Styles</span></h5>
        <div class="mb-3">
            <label class="form-label fw-bold">Editable Variant</label>
            <select class="form-select">
                <option selected>normalLight</option>
                <option>normalDark</option>
                <option>monitorLight</option>
                <option>monitorDark</option>
            </select>
            <div class="form-text">Overrides apply only to the selected visual variant.</div>
        </div>
        <hr class="my-4">
        <div class="row g-3">
            <div class="col-md-6"><label class="form-label fw-bold">Card Background</label><input type="text" class="form-control" value="#ffffff"></div>
            <div class="col-md-6"><label class="form-label fw-bold">Card Text Color</label><input type="text" class="form-control" value="#2d3748"></div>
            <div class="col-md-6"><label class="form-label fw-bold">Header Gradient Start</label><input type="text" class="form-control" value="#667eea"></div>
            <div class="col-md-6"><label class="form-label fw-bold">Header Gradient End</label><input type="text" class="form-control" value="#764ba2"></div>
            <div class="col-md-6"><label class="form-label fw-bold">Header Text Color</label><input type="text" class="form-control" value="#ffffff"></div>
            <div class="col-md-6"><label class="form-label fw-bold">Stat Value Color</label><input type="text" class="form-control" value="#333333"></div>
            <div class="col-md-6"><label class="form-label fw-bold">Stat Label Color</label><input type="text" class="form-control" value="#666666"></div>
            <div class="col-md-6"><label class="form-label fw-bold">Table Header Background</label><input type="text" class="form-control" value="#f8f9fa"></div>
            <div class="col-md-6"><label class="form-label fw-bold">Table Header Text</label><input type="text" class="form-control" value="#2d3748"></div>
            <div class="col-md-6"><label class="form-label fw-bold">Table Cell Text</label><input type="text" class="form-control" value="#2d3748"></div>
            <div class="col-md-6"><label class="form-label fw-bold">Table Border Color</label><input type="text" class="form-control" value="rgba(0,0,0,0.125)"></div>
            <div class="col-md-6"><label class="form-label fw-bold">Hover Row Background</label><input type="text" class="form-control" value="rgba(0,0,0,0.03)"></div>
            <div class="col-md-6"><label class="form-label fw-bold">Progress Background</label><input type="text" class="form-control" value="#e2e8f0"></div>
            <div class="col-md-6"><label class="form-label fw-bold">Monitor Card Background</label><input type="text" class="form-control" value="#1a2740"></div>
        </div>
        <div class="d-flex gap-2 flex-wrap mt-4 mb-2">
            <button class="btn btn-primary btn-sm" type="button"><i class="bi bi-save me-1"></i>Save</button>
            <button class="btn btn-outline-secondary btn-sm" type="button"><i class="bi bi-eraser me-1"></i>Reset Variant</button>
        </div>
        <hr class="my-4">
        <div class="d-flex gap-2 flex-wrap mb-2">
            <button class="btn btn-outline-primary btn-sm" type="button"><i class="bi bi-box-arrow-down me-1"></i>Export JSON</button>
            <button class="btn btn-outline-primary btn-sm" type="button"><i class="bi bi-box-arrow-in-up me-1"></i>Import JSON</button>
            <button class="btn btn-outline-danger btn-sm" type="button"><i class="bi bi-trash me-1"></i>Disable Custom Styles</button>
        </div>
    </div>
</div>`,
    thresholds: `
<div class="tab-pane fade show active" role="tabpanel">
    <div class="settings-section">
        <h5 class="mb-3"><i class="bi bi-speedometer2 me-2"></i><span>Thresholds</span></h5>
        <div class="mb-3">
            <div class="threshold-label"><span>CPU Green Up To</span><input type="number" class="form-control form-control-sm threshold-input" min="0" max="100" step="1" value="70"></div>
        </div>
        <div class="mb-3">
            <div class="threshold-label"><span>CPU Yellow Up To</span><input type="number" class="form-control form-control-sm threshold-input" min="0" max="100" step="1" value="90"></div>
        </div>
        <div class="mb-3">
            <div class="threshold-label"><span>CPU Red Up To</span><input type="number" class="form-control form-control-sm threshold-input" min="0" max="100" step="1" value="100"></div>
        </div>
        <div class="mb-3">
            <div class="threshold-label"><span>RAM Green Up To</span><input type="number" class="form-control form-control-sm threshold-input" min="0" max="100" step="1" value="70"></div>
        </div>
        <div class="mb-3">
            <div class="threshold-label"><span>RAM Yellow Up To</span><input type="number" class="form-control form-control-sm threshold-input" min="0" max="100" step="1" value="90"></div>
        </div>
        <div class="mb-4">
            <div class="threshold-label"><span>RAM Red Up To</span><input type="number" class="form-control form-control-sm threshold-input" min="0" max="100" step="1" value="100"></div>
        </div>
        <div class="text-end">
            <button class="btn btn-outline-secondary btn-sm" type="button"><i class="bi bi-arrow-counterclockwise me-1"></i>Reset Thresholds</button>
        </div>
    </div>
</div>`,
    services: `
<div class="tab-pane fade show active" role="tabpanel">
    <div class="settings-section mb-4" id="servicesHostsSettingsWrap">
        <h5 class="mb-3"><i class="bi bi-activity me-2"></i><span>Hosts for Monitoring</span></h5>
        <p class="text-muted small mb-3">Add hosts or URLs to check availability. The Service Monitoring screen itself shows only list and status.</p>
        <div class="row g-3 align-items-end mb-3">
            <div class="col-md-2"><label class="form-label fw-bold">Name</label><input type="text" class="form-control" value="Vaultwarden"></div>
            <div class="col-md-2"><label class="form-label fw-bold">Type</label><select class="form-select"><option>TCP</option><option>UDP</option><option selected>HTTP(S)</option><option>SNMP</option><option>NUT</option></select></div>
            <div class="col-md-2 d-none"><label class="form-label fw-bold">Host</label><input type="text" class="form-control" value=""></div>
            <div class="col-md-2 d-none"><label class="form-label fw-bold">Port</label><input type="number" class="form-control" value=""></div>
            <div class="col-md-3"><label class="form-label fw-bold">URL</label><input type="text" class="form-control" value="https://vault.example.local/"></div>
            <div class="col-md-2 d-grid"><button class="btn btn-outline-primary" type="button"><i class="bi bi-plus-lg me-1"></i>Add</button></div>
        </div>
        <div class="table-responsive mb-4">
            <table class="table table-sm table-hover align-middle mb-0">
                <thead>
                    <tr><th>Name</th><th>Type</th><th>Address / URL</th><th>Icon</th><th class="text-center">In monitor mode</th><th>Actions</th></tr>
                </thead>
                <tbody>
                    <tr>
                        <td><div class="d-flex align-items-center gap-2"><span class="service-icon service-settings-icon text-success"><i class="bi bi-shield-check"></i></span><span>Vaultwarden</span></div></td>
                        <td><span class="badge bg-secondary">HTTP</span></td>
                        <td><code>https://vault.example.local/</code></td>
                        <td style="min-width: 230px;">
                            <div class="icon-setting-control">
                                <button type="button" class="btn btn-sm btn-outline-secondary icon-picker-trigger"><span class="service-icon service-settings-icon text-success"><i class="bi bi-shield-check"></i></span></button>
                                <div class="icon-setting-control__meta"><div class="small text-truncate">bi-shield-check</div></div>
                                <input type="color" class="form-control form-control-color icon-color-input" value="#16a34a">
                                <button type="button" class="btn btn-sm btn-outline-secondary"><i class="bi bi-x-lg"></i></button>
                            </div>
                        </td>
                        <td class="text-center align-middle"><input type="checkbox" class="form-check-input" checked></td>
                        <td class="text-nowrap"><button class="btn btn-sm btn-outline-danger"><i class="bi bi-trash"></i></button></td>
                    </tr>
                    <tr>
                        <td><div class="d-flex align-items-center gap-2"><span class="service-icon service-settings-icon text-warning"><i class="bi bi-bar-chart"></i></span><span>Grafana</span></div></td>
                        <td><span class="badge bg-secondary">HTTP</span></td>
                        <td><code>https://grafana.example.local/</code></td>
                        <td style="min-width: 230px;">
                            <div class="icon-setting-control">
                                <button type="button" class="btn btn-sm btn-outline-secondary icon-picker-trigger"><span class="service-icon service-settings-icon text-warning"><i class="bi bi-bar-chart"></i></span></button>
                                <div class="icon-setting-control__meta"><div class="small text-truncate">bi-bar-chart</div></div>
                                <input type="color" class="form-control form-control-color icon-color-input" value="#f59e0b">
                                <button type="button" class="btn btn-sm btn-outline-secondary"><i class="bi bi-x-lg"></i></button>
                            </div>
                        </td>
                        <td class="text-center align-middle"><input type="checkbox" class="form-check-input" checked></td>
                        <td class="text-nowrap"><button class="btn btn-sm btn-outline-danger"><i class="bi bi-trash"></i></button></td>
                    </tr>
                </tbody>
            </table>
        </div>
    </div>
    <div class="settings-section" id="vmsForMonitoringSettingsWrap">
        <h5 class="mb-3"><i class="bi bi-hdd-network me-2"></i><span>VM / CT for Monitoring</span></h5>
        <p class="text-muted small mb-3">Enter a VM / CT ID or name and click Add. The list is refreshed from Proxmox separately.</p>
        <div class="row g-3 align-items-end mb-3">
            <div class="col-md-5"><label class="form-label fw-bold">ID or Name</label><input type="text" class="form-control" value="104"></div>
            <div class="col-md-2 d-grid"><button class="btn btn-outline-primary" type="button"><i class="bi bi-plus-lg me-1"></i>Add</button></div>
            <div class="col-md-3 d-grid"><button class="btn btn-outline-secondary btn-sm" type="button"><i class="bi bi-arrow-clockwise me-1"></i>Refresh VM / CT List</button></div>
        </div>
        <div class="table-responsive">
            <table class="table table-sm table-hover align-middle mb-0">
                <thead>
                    <tr><th>Name</th><th>Type</th><th>Status</th><th>Note</th><th>Icon</th><th class="text-center">In monitor mode</th><th>Actions</th></tr>
                </thead>
                <tbody>
                    <tr>
                        <td><div class="d-flex align-items-center gap-2"><span class="vm-icon vm-settings-icon text-success"><i class="bi bi-shield-lock"></i></span><span>vaultwarden</span></div></td>
                        <td><span class="badge bg-secondary">CT</span></td>
                        <td><span class="badge bg-success">Running</span></td>
                        <td><span class="text-muted small">pve-01 / 104</span></td>
                        <td style="min-width: 230px;">
                            <div class="icon-setting-control">
                                <button type="button" class="btn btn-sm btn-outline-secondary icon-picker-trigger"><span class="vm-icon vm-settings-icon text-success"><i class="bi bi-shield-lock"></i></span></button>
                                <div class="icon-setting-control__meta"><div class="small text-truncate">bi-shield-lock</div></div>
                                <input type="color" class="form-control form-control-color icon-color-input" value="#22c55e">
                                <button type="button" class="btn btn-sm btn-outline-secondary"><i class="bi bi-x-lg"></i></button>
                            </div>
                        </td>
                        <td class="text-center align-middle"><input type="checkbox" class="form-check-input" checked></td>
                        <td class="text-nowrap"><button class="btn btn-sm btn-outline-danger"><i class="bi bi-trash"></i></button></td>
                    </tr>
                    <tr>
                        <td><div class="d-flex align-items-center gap-2"><span class="vm-icon vm-settings-icon text-primary"><i class="bi bi-hdd-network"></i></span><span>proxy-01</span></div></td>
                        <td><span class="badge bg-secondary">VM</span></td>
                        <td><span class="badge bg-success">Running</span></td>
                        <td><span class="text-muted small">pve-02 / 118</span></td>
                        <td style="min-width: 230px;">
                            <div class="icon-setting-control">
                                <button type="button" class="btn btn-sm btn-outline-secondary icon-picker-trigger"><span class="vm-icon vm-settings-icon text-primary"><i class="bi bi-hdd-network"></i></span></button>
                                <div class="icon-setting-control__meta"><div class="small text-truncate">bi-hdd-network</div></div>
                                <input type="color" class="form-control form-control-color icon-color-input" value="#3b82f6">
                                <button type="button" class="btn btn-sm btn-outline-secondary"><i class="bi bi-x-lg"></i></button>
                            </div>
                        </td>
                        <td class="text-center align-middle"><input type="checkbox" class="form-check-input" checked></td>
                        <td class="text-nowrap"><button class="btn btn-sm btn-outline-danger"><i class="bi bi-trash"></i></button></td>
                    </tr>
                </tbody>
            </table>
        </div>
    </div>
</div>`,
    ups: `
<div class="tab-pane fade show active" role="tabpanel">
    <div id="upsSettingsCardWrap">
        <div class="settings-section mb-4">
            <h5 class="mb-3"><i class="bi bi-lightning-charge me-2"></i><span>UPS (NUT / SNMP)</span></h5>
            <div class="row g-3 align-items-end mb-3">
                <div class="col-md-3">
                    <label class="form-label fw-bold mb-2">UPS Slot</label>
                    <div class="nav nav-pills">
                        <button class="nav-link active py-1" type="button">1</button>
                        <button class="nav-link py-1" type="button">2</button>
                        <button class="nav-link py-1" type="button">3</button>
                        <button class="nav-link py-1" type="button">4</button>
                    </div>
                </div>
                <div class="col-md-3"><label class="form-label fw-bold">Enabled</label><select class="form-select"><option>No</option><option selected>Yes</option></select></div>
                <div class="col-md-3"><label class="form-label fw-bold">Type</label><select class="form-select"><option selected>NUT</option><option>SNMP</option></select></div>
                <div class="col-md-3"><label class="form-label fw-bold">Host</label><input type="text" class="form-control" value="10.200.0.5"></div>
                <div class="col-md-3"><label class="form-label fw-bold">Port</label><input type="number" class="form-control" value="3493"></div>
            </div>
            <div class="row g-3">
                <div class="col-md-4"><label class="form-label fw-bold">UPS Name</label><input type="text" class="form-control" value="ups"></div>
                <div class="col-md-4"><label class="form-label fw-bold">Status VAR</label><input type="text" class="form-control" value="ups.status"></div>
                <div class="col-md-4"><label class="form-label fw-bold">Charge VAR</label><input type="text" class="form-control" value="battery.charge"></div>
                <div class="col-md-4"><label class="form-label fw-bold">Runtime VAR</label><input type="text" class="form-control" value="battery.runtime"></div>
                <div class="col-md-4"><label class="form-label fw-bold">Input Voltage VAR</label><input type="text" class="form-control" value="input.voltage"></div>
                <div class="col-md-4"><label class="form-label fw-bold">Output Voltage VAR</label><input type="text" class="form-control" value="output.voltage"></div>
            </div>
            <hr class="my-4">
            <div class="row g-3 mb-3">
                <div class="col-md-6"><label class="form-label fw-bold">Show in Normal Mode on the UPS Screen</label><select class="form-select"><option>No</option><option selected>Yes</option></select></div>
                <div class="col-md-6"><label class="form-label fw-bold">Show in Monitor Mode on the UPS Screen</label><select class="form-select"><option>No</option><option selected>Yes</option></select></div>
            </div>
            <div class="d-flex justify-content-end"><button class="btn btn-primary" type="button"><i class="bi bi-save me-2"></i>Save UPS</button></div>
        </div>
    </div>
</div>`,
    netdevices: `
<div class="tab-pane fade show active" role="tabpanel">
    <div id="netdevSettingsCardWrap">
        <div class="settings-section mb-4">
            <h5 class="mb-3"><i class="bi bi-diagram-3 me-2"></i><span>Network Devices (SNMP)</span></h5>
            <div class="row g-3 align-items-end mb-3">
                <div class="col-md-3">
                    <label class="form-label fw-bold mb-2">Device Slot</label>
                    <div class="nav nav-pills">
                        <button class="nav-link active py-1" type="button">1</button>
                        <button class="nav-link py-1" type="button">2</button>
                        <button class="nav-link py-1" type="button">3</button>
                    </div>
                </div>
                <div class="col-md-3"><label class="form-label fw-bold">Enabled</label><select class="form-select"><option>No</option><option selected>Yes</option></select></div>
                <div class="col-md-3"><label class="form-label fw-bold">Host</label><input type="text" class="form-control" value="10.200.0.254"></div>
                <div class="col-md-3"><label class="form-label fw-bold">SNMP Port</label><input type="number" class="form-control" value="161"></div>
            </div>
            <div class="row g-3 align-items-end mb-3">
                <div class="col-md-4"><label class="form-label fw-bold">Community</label><input type="text" class="form-control" value="public"></div>
                <div class="col-md-4"><label class="form-label fw-bold">Device Name</label><input type="text" class="form-control" value="router-core"></div>
                <div class="col-md-4"><label class="form-label fw-bold">Name OID</label><input type="text" class="form-control" value="1.3.6.1.2.1.1.5.0"></div>
            </div>
            <div class="mb-3">
                <h6 class="fw-semibold mb-2"><i class="bi bi-list-columns me-2"></i><span>Fields (up to 15)</span></h6>
                <div id="netdevFieldsInputsWrap">
                    <div id="netdevFieldsEditorsRoot">
                        <div class="netdev-field-block border-bottom pb-3 mb-3" data-netdev-row="0">
                            <div class="row g-2 align-items-center mb-2 flex-wrap">
                                <div class="col"><span class="fw-semibold">Field 1</span></div>
                                <div class="col-auto">
                                    <div class="form-check form-switch m-0">
                                        <input class="form-check-input" type="checkbox" checked>
                                        <label class="form-check-label small">Poll</label>
                                    </div>
                                </div>
                                <div class="col-auto"><button type="button" class="btn btn-sm btn-outline-danger">Remove</button></div>
                            </div>
                            <div class="row g-3 align-items-end">
                                <div class="col-lg-3 col-md-4"><label class="form-label fw-bold">Field 1 Name</label><input type="text" class="form-control" value="WAN RX"></div>
                                <div class="col-lg-5 col-md-5"><label class="form-label fw-bold">OID</label><input type="text" class="form-control" value="1.3.6.1.2.1.31.1.1.1.6.2"></div>
                                <div class="col-lg-4 col-md-3"><label class="form-label fw-bold">Format</label><select class="form-select"><option>Text</option><option>Time</option><option selected>MB / GB</option><option>GB</option><option>Boot</option><option>Status</option></select></div>
                            </div>
                        </div>
                        <div class="netdev-field-block border-bottom pb-3 mb-3" data-netdev-row="1">
                            <div class="row g-2 align-items-center mb-2 flex-wrap">
                                <div class="col"><span class="fw-semibold">Field 2</span></div>
                                <div class="col-auto">
                                    <div class="form-check form-switch m-0">
                                        <input class="form-check-input" type="checkbox" checked>
                                        <label class="form-check-label small">Poll</label>
                                    </div>
                                </div>
                                <div class="col-auto"><button type="button" class="btn btn-sm btn-outline-danger">Remove</button></div>
                            </div>
                            <div class="row g-3 align-items-end">
                                <div class="col-lg-3 col-md-4"><label class="form-label fw-bold">Field 2 Name</label><input type="text" class="form-control" value="Ports Up"></div>
                                <div class="col-lg-5 col-md-5"><label class="form-label fw-bold">OID</label><input type="text" class="form-control" value="1.3.6.1.2.1.2.2.1.8.1"></div>
                                <div class="col-lg-4 col-md-3"><label class="form-label fw-bold">Format</label><select class="form-select"><option>Text</option><option>Time</option><option>MB / GB</option><option>GB</option><option>Boot</option><option selected>Status</option></select></div>
                            </div>
                            <div class="row g-2 mt-1">
                                <div class="col-12 small text-muted mb-0">Use status mapping to convert raw SNMP values into Connected / Disconnected.</div>
                                <div class="col-md-6"><label class="form-label small mb-1">"Connected" values</label><input type="text" class="form-control form-control-sm" value="1, up, true"></div>
                                <div class="col-md-6"><label class="form-label small mb-1">"Disconnected" values</label><input type="text" class="form-control form-control-sm" value="0, 2, down"></div>
                            </div>
                        </div>
                    </div>
                    <div class="mt-2 d-flex flex-wrap align-items-center gap-2">
                        <button type="button" class="btn btn-outline-primary btn-sm" id="netdevAddFieldBtn">Add Field</button>
                        <span class="small text-muted" id="netdevFieldsCountHint">2 / 15</span>
                    </div>
                </div>
                <div class="form-text">Rows can be added or removed. Empty OIDs are not shown on dashboard or monitor screens.</div>
            </div>
            <hr class="my-4">
            <div class="row g-3 mb-3">
                <div class="col-md-6"><label class="form-label fw-bold">Show in Normal Mode on the SNMP Screen</label><select class="form-select"><option>No</option><option selected>Yes</option></select></div>
                <div class="col-md-6"><label class="form-label fw-bold">Show in Monitor Mode on the SNMP Screen</label><select class="form-select"><option>No</option><option selected>Yes</option></select></div>
            </div>
            <div class="d-flex justify-content-end"><button class="btn btn-primary" type="button"><i class="bi bi-save me-2"></i>Save Network Devices</button></div>
        </div>
    </div>
</div>`,
    hostmetrics: `
<div class="tab-pane fade show active" role="tabpanel">
    <div id="hostMetricsSettingsWrap" style="display: block;">
        <div class="settings-section mb-4">
            <h5 class="mb-3"><i class="bi bi-thermometer-half me-2"></i><span>Proxmox Host Metrics</span></h5>
            <p class="text-muted small mb-3">For each node you can select an agent endpoint, CPU temperature sensor, and network interface for link speed.</p>
            <div class="row g-3 align-items-end mb-3">
                <div class="col-md-6 col-lg-3"><label class="form-label fw-bold">Poll Interval, sec</label><input type="number" class="form-control" value="10"><div class="form-text">Backend will not poll sources faster than this interval.</div></div>
                <div class="col-md-6 col-lg-3"><label class="form-label fw-bold">Timeout, ms</label><input type="number" class="form-control" value="3000"><div class="form-text">How long to wait for a node endpoint.</div></div>
                <div class="col-md-6 col-lg-3"><label class="form-label fw-bold">Cache TTL, sec</label><input type="number" class="form-control" value="8"><div class="form-text">Fresh data is served from cache within this TTL.</div></div>
                <div class="col-md-6 col-lg-3"><label class="form-label fw-bold">Critical CPU Temperature, C</label><input type="number" class="form-control" value="85"><div class="form-text">A warning badge appears next to the node.</div></div>
                <div class="col-md-6 col-lg-3"><label class="form-label fw-bold">Minimum Link Speed, Mbps</label><input type="number" class="form-control" value="1000"><div class="form-text">Warn if link speed drops below threshold or goes down.</div></div>
                <div class="col-12 col-lg-3 d-flex gap-2"><button class="btn btn-outline-secondary flex-fill" type="button"><i class="bi bi-arrow-clockwise me-1"></i>Refresh Sensors</button></div>
            </div>
            <div class="table-responsive">
                <table class="table table-sm table-hover align-middle mb-0">
                    <thead><tr><th>Node</th><th>Enabled</th><th>Agent URL</th><th>CPU Sensor</th><th>Interface</th><th>Discovery</th></tr></thead>
                    <tbody>
                        <tr>
                            <td><div class="fw-semibold">pve-01</div><div class="small text-muted">Local HTTP endpoint on the node</div></td>
                            <td><select class="form-select form-select-sm"><option>No</option><option selected>Yes</option></select></td>
                            <td><input type="text" class="form-control form-control-sm" value="http://pve-01:9105/host-metrics"></td>
                            <td><input type="text" class="form-control form-control-sm" value="Package id 0"></td>
                            <td><input type="text" class="form-control form-control-sm" value="eno1"></td>
                            <td><div class="small">3 sensors / 4 interfaces</div></td>
                        </tr>
                        <tr>
                            <td><div class="fw-semibold">pve-02</div><div class="small text-muted">Local HTTP endpoint on the node</div></td>
                            <td><select class="form-select form-select-sm"><option>No</option><option selected>Yes</option></select></td>
                            <td><input type="text" class="form-control form-control-sm" value="http://pve-02:9105/host-metrics"></td>
                            <td><input type="text" class="form-control form-control-sm" value="Tctl"></td>
                            <td><input type="text" class="form-control form-control-sm" value="enp3s0"></td>
                            <td><div class="small">2 sensors / 3 interfaces</div></td>
                        </tr>
                        <tr>
                            <td><div class="fw-semibold">pve-03</div><div class="small text-muted">Local HTTP endpoint on the node</div></td>
                            <td><select class="form-select form-select-sm"><option>No</option><option selected>Yes</option></select></td>
                            <td><input type="text" class="form-control form-control-sm" value="http://pve-03:9105/host-metrics"></td>
                            <td><input type="text" class="form-control form-control-sm" value="Package id 0"></td>
                            <td><input type="text" class="form-control form-control-sm" value="vmbr0"></td>
                            <td><div class="small">4 sensors / 5 interfaces</div></td>
                        </tr>
                    </tbody>
                </table>
            </div>
            <div class="alert alert-secondary mt-3 mb-0 d-none">Host metrics are available only for Proxmox.</div>
            <div class="d-flex justify-content-end mt-3"><button class="btn btn-primary" type="button"><i class="bi bi-save me-2"></i>Save Host Metrics</button></div>
        </div>
    </div>
</div>`,
    speedtest: `
<div class="tab-pane fade show active" role="tabpanel">
    <div class="settings-section">
        <h5 class="mb-3"><i class="bi bi-wifi me-2"></i><span>Speedtest</span></h5>
        <p class="text-muted small mb-3">Requires the official Ookla CLI to be available in PATH.</p>
        <div class="row g-3 align-items-end mb-3">
            <div class="col-md-3"><label class="form-label fw-bold">Measurement</label><select class="form-select"><option>Disabled</option><option selected>Enabled</option></select></div>
            <div class="col-md-4"><label class="form-label fw-bold">Measurement Server</label><input type="text" class="form-control" value="48614"><div class="form-text">Numeric Ookla server ID, empty for auto.</div></div>
            <div class="col-md-3"><label class="form-label fw-bold">Runs Per Day</label><input type="number" class="form-control" min="1" max="6" value="4"></div>
            <div class="col-md-2 d-grid"><button type="button" class="btn btn-outline-primary"><i class="bi bi-play-fill me-1"></i>Run Now</button></div>
        </div>
        <div class="small text-muted">CLI status: detected, ready to run.</div>
    </div>
</div>`,
    security: `
<div class="tab-pane fade show active" role="tabpanel">
    <div class="settings-section">
        <h5 class="mb-3"><i class="bi bi-shield-lock me-2"></i><span>Security</span></h5>
        <p class="text-muted small mb-3">You can protect access to settings with a password.</p>
        <div class="row g-3 mb-3">
            <div class="col-md-4">
                <label class="form-label fw-bold">Session TTL (min)</label>
                <select class="form-select"><option>5</option><option>15</option><option selected>30</option><option>60</option><option>120</option></select>
                <div class="form-text">No need to re-enter the password within this period.</div>
            </div>
        </div>
        <div class="row g-3 mb-3">
            <div class="col-md-4"><label class="form-label fw-bold">Current Password</label><input type="password" class="form-control"></div>
            <div class="col-md-4"><label class="form-label fw-bold">New Password</label><input type="password" class="form-control"></div>
            <div class="col-md-4"><label class="form-label fw-bold">Repeat Password</label><input type="password" class="form-control"></div>
        </div>
        <div class="d-flex justify-content-between">
            <button class="btn btn-primary" type="button"><i class="bi bi-shield-lock me-1"></i>Enable / Change Password</button>
            <button class="btn btn-outline-danger" type="button"><i class="bi bi-shield-x me-1"></i>Disable Password</button>
        </div>
    </div>
</div>`,
    import: `
<div class="tab-pane fade show active" role="tabpanel">
    <div class="settings-section">
        <h5 class="mb-3"><i class="bi bi-upload me-2"></i><span>Import / Export</span></h5>
        <div class="mb-4">
            <h6 class="fw-semibold mb-2 text-body">Only Service Monitoring Hosts</h6>
            <p class="text-muted small mb-2">Export or import only service monitoring host configuration.</p>
            <div class="d-flex flex-wrap gap-2">
                <button class="btn btn-outline-secondary btn-sm" type="button"><i class="bi bi-download me-1"></i>Export Hosts</button>
                <button class="btn btn-outline-secondary btn-sm" type="button"><i class="bi bi-upload me-1"></i>Import Hosts</button>
            </div>
        </div>
        <hr>
        <div class="mb-4">
            <h6 class="fw-semibold mb-2 text-body">Only VM / CT</h6>
            <p class="text-muted small mb-2">Export or import only VM / CT monitoring lists and monitor visibility.</p>
            <div class="d-flex flex-wrap gap-2">
                <button class="btn btn-outline-secondary btn-sm" type="button"><i class="bi bi-download me-1"></i>Export VM / CT</button>
                <button class="btn btn-outline-secondary btn-sm" type="button"><i class="bi bi-upload me-1"></i>Import VM / CT</button>
            </div>
        </div>
        <hr>
        <div class="mb-2">
            <h6 class="fw-semibold mb-2 text-body">Full Configuration</h6>
            <p class="text-muted small mb-2">Export or import all settings, connections, and monitor targets.</p>
            <div class="d-flex flex-wrap gap-2">
                <button class="btn btn-outline-danger btn-sm" type="button"><i class="bi bi-download me-1"></i>Export All Settings</button>
                <button class="btn btn-outline-danger btn-sm" type="button"><i class="bi bi-upload me-1"></i>Import All Settings</button>
            </div>
        </div>
    </div>
</div>`,
    debug: `
<div class="tab-pane fade show active" role="tabpanel">
    <div class="settings-section">
        <h5 class="mb-3"><i class="bi bi-bug me-2"></i><span>Debug</span></h5>
        <p class="text-muted small mb-3">Core application and server metrics for diagnostics.</p>
        <div class="row g-3 mb-4">
            <div class="col-md-6">
                <div class="card h-100">
                    <div class="card-header py-2"><span>Server</span></div>
                    <div class="card-body py-3 small">
                        <pre class="mb-0 font-monospace" style="font-size: 0.8rem; white-space: pre-wrap; word-break: break-all;">version: 0.38-alpha
env: production
db: SQLite (data/app.db)
uptime: 12843 sec
cache keys: 34</pre>
                    </div>
                </div>
            </div>
            <div class="col-md-6">
                <div class="card h-100">
                    <div class="card-header py-2"><span>Client</span></div>
                    <div class="card-body py-3 small">
                        <pre class="mb-0 font-monospace" style="font-size: 0.8rem; white-space: pre-wrap; word-break: break-all;">language: en
serverType: proxmox
monitorMode: false
monitorTheme: light
browser: Chrome</pre>
                    </div>
                </div>
            </div>
        </div>
        <div class="d-flex flex-wrap gap-2 align-items-center mb-2">
            <button type="button" class="btn btn-outline-secondary btn-sm"><i class="bi bi-arrow-clockwise me-1"></i>Refresh Metrics</button>
            <button type="button" class="btn btn-outline-secondary btn-sm"><i class="bi bi-lightning me-1"></i>Ping API</button>
            <span class="small text-muted ms-1">Ping: 8 ms</span>
        </div>
        <div class="d-flex flex-wrap gap-2 align-items-center mb-2">
            <button type="button" class="btn btn-outline-warning btn-sm"><i class="bi bi-trash me-1"></i>Clear Cache</button>
            <button type="button" class="btn btn-outline-danger btn-sm"><i class="bi bi-arrow-counterclockwise me-1"></i>Reset All Settings</button>
            <button type="button" class="btn btn-outline-secondary btn-sm"><i class="bi bi-download me-1"></i>Download Report</button>
            <button type="button" class="btn btn-outline-primary btn-sm"><i class="bi bi-arrow-repeat me-1"></i>Reload Application</button>
        </div>
        <div class="form-check mt-2">
            <input class="form-check-input" type="checkbox" id="resetConfirmDemo">
            <label class="form-check-label small text-muted" for="resetConfirmDemo">Confirm to reset all settings</label>
        </div>
    </div>
</div>`,
    about: `
<div class="tab-pane fade show active" role="tabpanel">
    <div class="settings-section">
        <h5 class="mb-3"><i class="bi bi-info-circle me-2"></i><span>About</span></h5>
        <div class="card">
            <div class="card-body">
                <div class="settings-about-markdown small">
                    <h1>HomeLab Monitor</h1>
                    <p><strong>Version:</strong> 0.38-alpha</p>
                    <p>Local web dashboard for monitoring Proxmox, TrueNAS, services, VM / CT, UPS, network devices, speed tests, and additional host metrics.</p>
                    <h2>Highlights</h2>
                    <ul>
                        <li>Proxmox cluster overview</li>
                        <li>Standalone Node.js host metrics agent</li>
                        <li>Monitor mode for dedicated displays</li>
                        <li>Icon customization for services and VM / CT</li>
                    </ul>
                </div>
            </div>
        </div>
    </div>
</div>`
};

const clusterStats = `
            <div class="row g-4 mb-4">
                <div class="col-md-6 col-xl"><div class="stat-card"><div class="stat-value">23:43</div><div class="stat-card-meta">Mar 21</div></div></div>
                <div class="col-md-6 col-xl"><div class="stat-card"><div class="stat-value"><i class="bi bi-cloud-sun me-1"></i>+1°C</div><div class="stat-card-meta">Kansk</div></div></div>
                <div class="col-md-6 col-xl"><div class="stat-card"><div class="stat-value">4</div><div class="stat-label">Total Nodes</div></div></div>
                <div class="col-md-6 col-xl"><div class="stat-card"><div class="stat-value text-success">4</div><div class="stat-label">Online Nodes</div></div></div>
                <div class="col-md-6 col-xl"><div class="stat-card"><div class="stat-value">OK</div><div class="stat-label">Quorum</div></div></div>
            </div>`;

const clusterResources = `
            <div class="row mb-4">
                <div class="col-12">
                    <div class="card">
                        <div class="card-header d-flex align-items-center justify-content-between gap-2">
                            <h5 class="mb-0"><i class="bi bi-pie-chart me-2"></i><span>Cluster Resources</span></h5>
                            <span class="cluster-resources-chart-hint text-muted flex-shrink-0" id="clusterResourcesChartHint" aria-hidden="true"><i class="bi bi-graph-up-arrow fs-5"></i></span>
                        </div>
                        <div class="card-body" id="clusterResourcesCardBody">
                            <div class="row g-2">
                                <div class="col-md-3 col-6">
                                    <div class="text-center p-3">
                                        <h6><i class="bi bi-cpu me-2"></i><span>CPU</span></h6>
                                        <div class="display-6">41%</div>
                                        <small class="text-muted">53 / 128 cores</small>
                                        <div class="progress mt-2" style="height: 10px;"><div class="progress-bar bg-primary" style="width: 41%"></div></div>
                                    </div>
                                </div>
                                <div class="col-md-3 col-6">
                                    <div class="text-center p-3">
                                        <h6><i class="bi bi-memory me-2"></i><span>Memory</span></h6>
                                        <div class="display-6">62%</div>
                                        <small class="text-muted">79 / 128 GB</small>
                                        <div class="progress mt-2" style="height: 10px;"><div class="progress-bar bg-success" style="width: 62%"></div></div>
                                    </div>
                                </div>
                                <div class="col-md-3 col-6">
                                    <div class="text-center p-3">
                                        <h6><i class="bi bi-pc-display me-2"></i><span>VM</span></h6>
                                        <div class="display-6">18</div>
                                        <small class="text-muted d-block">Running: <span class="text-success fw-semibold">16</span></small>
                                        <div class="progress mt-2" style="height: 10px;"><div class="progress-bar bg-success" style="width: 89%"></div></div>
                                    </div>
                                </div>
                                <div class="col-md-3 col-6">
                                    <div class="text-center p-3">
                                        <h6><i class="bi bi-box-seam me-2"></i><span>CT</span></h6>
                                        <div class="display-6">8</div>
                                        <small class="text-muted d-block">Total: <span class="text-success fw-semibold">11</span></small>
                                        <div class="progress mt-2" style="height: 10px;"><div class="progress-bar bg-success" style="width: 73%"></div></div>
                                    </div>
                                </div>
                            </div>
                        </div>
                    </div>
                </div>
            </div>`;

const dashboardTabs = (active, isTrueNAS = false) => `
            <ul class="nav nav-tabs mb-4" role="tablist">
                <li class="nav-item" role="presentation" style="${isTrueNAS ? 'display:none;' : ''}"><button class="nav-link${active === 'nodes' ? ' active' : ''}" type="button">Nodes</button></li>
                <li class="nav-item" role="presentation"><button class="nav-link${active === 'storage' ? ' active' : ''}" type="button"><i class="bi bi-hdd-stack me-1"></i>Storage</button></li>
                <li class="nav-item" role="presentation"><button class="nav-link${active === 'servers' ? ' active' : ''}" type="button"><i class="bi bi-server me-1"></i>Servers</button></li>
                <li class="nav-item" role="presentation" style="${isTrueNAS ? 'display:none;' : ''}"><button class="nav-link${active === 'backups' ? ' active' : ''}" type="button"><i class="bi bi-archive me-1"></i>Backups</button></li>
                <li class="nav-item" role="presentation" style="${isTrueNAS ? 'display:none;' : ''}"><button class="nav-link${active === 'quorum' ? ' active' : ''}" type="button"><i class="bi bi-people me-1"></i>Quorum</button></li>
            </ul>`;

const nodesContent = `
                        <div class="cluster-scroll-row">
                            <div class="cluster-scroll-item">
                                <div class="node-card">
                                    <div class="d-flex justify-content-between align-items-center mb-3">
                                        <h5 class="mb-0 d-inline-flex align-items-center">pve-01</h5>
                                        <span class="badge bg-success">Online</span>
                                    </div>
                                    <div class="row g-2">
                                        <div class="col-6">
                                            <small class="text-muted">CPU</small>
                                            <div class="fw-bold">36%</div>
                                            <div class="progress"><div class="progress-bar bg-primary" style="width: 36%"></div></div>
                                        </div>
                                        <div class="col-6">
                                            <small class="text-muted">RAM</small>
                                            <div class="fw-bold">58%</div>
                                            <div class="progress"><div class="progress-bar bg-success" style="width: 58%"></div></div>
                                        </div>
                                        <div class="col-6 mt-2"><small class="text-muted">Uptime</small><div class="fw-bold">14d 6h</div></div>
                                        <div class="col-6 mt-2"><small class="text-muted">CPU Cores</small><div class="fw-bold">16</div></div>
                                        <div class="col-6 mt-2"><small class="text-muted">CPU temp</small><div class="fw-bold">58°C</div></div>
                                        <div class="col-6 mt-2"><small class="text-muted">Link speed</small><div class="fw-bold">10 Gbps</div><div class="small text-muted">up</div></div>
                                    </div>
                                </div>
                            </div>
                            <div class="cluster-scroll-item">
                                <div class="node-card">
                                    <div class="d-flex justify-content-between align-items-center mb-3">
                                        <h5 class="mb-0 d-inline-flex align-items-center">pve-02<span class="badge bg-warning text-dark ms-2" title="CPU temperature exceeded threshold"><i class="bi bi-exclamation-triangle-fill"></i></span></h5>
                                        <span class="badge bg-success">Online</span>
                                    </div>
                                    <div class="row g-2">
                                        <div class="col-6">
                                            <small class="text-muted">CPU</small>
                                            <div class="fw-bold">49%</div>
                                            <div class="progress"><div class="progress-bar bg-primary" style="width: 49%"></div></div>
                                        </div>
                                        <div class="col-6">
                                            <small class="text-muted">RAM</small>
                                            <div class="fw-bold">53%</div>
                                            <div class="progress"><div class="progress-bar bg-success" style="width: 53%"></div></div>
                                        </div>
                                        <div class="col-6 mt-2"><small class="text-muted">Uptime</small><div class="fw-bold">8d 19h</div></div>
                                        <div class="col-6 mt-2"><small class="text-muted">CPU Cores</small><div class="fw-bold">24</div></div>
                                        <div class="col-6 mt-2"><small class="text-muted">CPU temp</small><div class="fw-bold text-danger">87°C</div></div>
                                        <div class="col-6 mt-2"><small class="text-muted">Link speed</small><div class="fw-bold">2.5 Gbps</div><div class="small text-muted">up</div></div>
                                        <div class="col-12 mt-2"><small class="text-danger fw-semibold"><i class="bi bi-exclamation-triangle-fill me-1"></i>CPU temperature exceeded threshold 85°C</small></div>
                                    </div>
                                </div>
                            </div>
                            <div class="cluster-scroll-item">
                                <div class="node-card">
                                    <div class="d-flex justify-content-between align-items-center mb-3">
                                        <h5 class="mb-0 d-inline-flex align-items-center">pve-03<span class="badge bg-warning text-dark ms-2" title="Link speed below threshold"><i class="bi bi-exclamation-triangle-fill"></i></span></h5>
                                        <span class="badge bg-success">Online</span>
                                    </div>
                                    <div class="row g-2">
                                        <div class="col-6">
                                            <small class="text-muted">CPU</small>
                                            <div class="fw-bold">29%</div>
                                            <div class="progress"><div class="progress-bar bg-primary" style="width: 29%"></div></div>
                                        </div>
                                        <div class="col-6">
                                            <small class="text-muted">RAM</small>
                                            <div class="fw-bold">44%</div>
                                            <div class="progress"><div class="progress-bar bg-success" style="width: 44%"></div></div>
                                        </div>
                                        <div class="col-6 mt-2"><small class="text-muted">Uptime</small><div class="fw-bold">22d 3h</div></div>
                                        <div class="col-6 mt-2"><small class="text-muted">CPU Cores</small><div class="fw-bold">16</div></div>
                                        <div class="col-6 mt-2"><small class="text-muted">CPU temp</small><div class="fw-bold">51°C</div></div>
                                        <div class="col-6 mt-2"><small class="text-muted">Link speed</small><div class="fw-bold text-danger">100 Mbps</div><div class="small text-muted">up</div></div>
                                        <div class="col-12 mt-2"><small class="text-danger fw-semibold"><i class="bi bi-exclamation-triangle-fill me-1"></i>Link speed below threshold 1000 Mbps</small></div>
                                    </div>
                                </div>
                            </div>
                        </div>`;

const storageContent = `
                        <div class="card">
                            <div class="card-body">
                                <div class="row mb-4">
                                    <div class="col-md-3"><div class="stat-card"><div class="stat-value">8</div><div class="stat-label">Datastores</div></div></div>
                                    <div class="col-md-3"><div class="stat-card"><div class="stat-value">72%</div><div class="stat-label">Average Load</div></div></div>
                                    <div class="col-md-3"><div class="stat-card"><div class="stat-value">48 TB</div><div class="stat-label">Total Capacity</div></div></div>
                                    <div class="col-md-3"><div class="stat-card"><div class="stat-value">13 TB</div><div class="stat-label">Free</div></div></div>
                                </div>
                                <div class="table-responsive">
                                    <table class="table table-hover">
                                        <thead><tr><th>Node</th><th>Storage</th><th>Type</th><th>Status</th><th>Used</th><th>Total</th><th>Usage</th><th>Details</th></tr></thead>
                                        <tbody>
                                            <tr><td>pve-01</td><td>local-lvm</td><td>LVM-Thin</td><td><span class="badge text-bg-success">Active</span></td><td>1.2 TB</td><td>2 TB</td><td>60%</td><td>VM disks</td></tr>
                                            <tr><td>pve-03</td><td>backup-store</td><td>Directory</td><td><span class="badge text-bg-success">Active</span></td><td>13.4 TB</td><td>18 TB</td><td>74%</td><td>VZDump backups</td></tr>
                                            <tr><td>pve-02</td><td>ceph-ssd</td><td>RBD</td><td><span class="badge text-bg-success">Active</span></td><td>8.9 TB</td><td>12 TB</td><td>74%</td><td>High-speed pool</td></tr>
                                        </tbody>
                                    </table>
                                </div>
                            </div>
                        </div>`;

const serversContent = `
                        <div class="row">
                            <div class="col-md-6">
                                <div class="card">
                                    <div class="card-header"><h5 class="mb-0"><i class="bi bi-server me-2"></i>TrueNAS CORE</h5></div>
                                    <div class="card-body">
                                        <div class="row g-3">
                                            <div class="col-6"><div class="node-card text-center"><div class="fw-bold fs-4">12%</div><div class="text-muted small">CPU</div></div></div>
                                            <div class="col-6"><div class="node-card text-center"><div class="fw-bold fs-4">41%</div><div class="text-muted small">RAM</div></div></div>
                                            <div class="col-12"><div class="node-card"><div class="fw-semibold mb-1">Version</div><div class="text-muted small">TrueNAS-SCALE-24.04</div></div></div>
                                            <div class="col-12"><div class="node-card"><div class="fw-semibold mb-1">Uptime</div><div class="text-muted small">15 days 04:18</div></div></div>
                                        </div>
                                    </div>
                                </div>
                            </div>
                            <div class="col-md-6">
                                <div class="card">
                                    <div class="card-header"><h5 class="mb-0"><i class="bi bi-hdd-stack me-2"></i>Pools</h5></div>
                                    <div class="card-body">
                                        <div class="node-card mb-3"><div class="d-flex justify-content-between"><strong>tank</strong><span>8.6 / 12 TB</span></div><div class="progress mt-2" style="height: 8px;"><div class="progress-bar bg-primary" style="width: 72%"></div></div></div>
                                        <div class="node-card"><div class="d-flex justify-content-between"><strong>backup</strong><span>13.4 / 18 TB</span></div><div class="progress mt-2" style="height: 8px;"><div class="progress-bar bg-success" style="width: 74%"></div></div></div>
                                    </div>
                                </div>
                            </div>
                        </div>`;

const backupsContent = `
                        <div class="card mb-4">
                            <div class="card-body">
                                <h5 class="card-title mb-3"><i class="bi bi-calendar-check me-2"></i>Existing Jobs</h5>
                                <div class="table-responsive">
                                    <table class="table table-hover">
                                        <thead><tr><th>ID</th><th>Schedule</th><th>State</th><th>Storage</th><th>VM / CT</th><th>Mode</th><th>Next Run</th></tr></thead>
                                        <tbody>
                                            <tr><td>nightly-all</td><td>02:00 daily</td><td><span class="badge text-bg-success">Enabled</span></td><td>backup-store</td><td>All</td><td>Snapshot</td><td>2026-03-22 02:00</td></tr>
                                            <tr><td>weekly-critical</td><td>Sun 04:00</td><td><span class="badge text-bg-success">Enabled</span></td><td>backup-store</td><td>Critical</td><td>Stop</td><td>2026-03-22 04:00</td></tr>
                                        </tbody>
                                    </table>
                                </div>
                            </div>
                        </div>
                        <div class="card">
                            <div class="card-body">
                                <h5 class="card-title mb-3"><i class="bi bi-activity me-2"></i>Execution Status</h5>
                                <p class="text-muted small mb-2">Latest vzdump runs in the cluster.</p>
                                <div class="table-responsive">
                                    <table class="table table-hover">
                                        <thead><tr><th>Start</th><th>End</th><th>Node</th><th>Target</th><th>Status</th><th>Result</th><th>User</th><th>UPID</th></tr></thead>
                                        <tbody>
                                            <tr><td>2026-03-21 02:00</td><td>2026-03-21 02:24</td><td>pve-01</td><td>104</td><td><span class="badge text-bg-success">OK</span></td><td>Backup completed</td><td>root@pam</td><td>UPID:pve-01:0001</td></tr>
                                            <tr><td>2026-03-21 02:24</td><td>2026-03-21 02:46</td><td>pve-02</td><td>136</td><td><span class="badge text-bg-success">OK</span></td><td>Backup completed</td><td>root@pam</td><td>UPID:pve-02:0002</td></tr>
                                        </tbody>
                                    </table>
                                </div>
                            </div>
                        </div>`;

const quorumContent = `
                        <div class="card">
                            <div class="card-body">
                                <div class="row text-center mb-4">
                                    <div class="col-md-4"><h3>3</h3><p class="text-muted">Votes</p></div>
                                    <div class="col-md-4"><h3>3</h3><p class="text-muted">Expected</p></div>
                                    <div class="col-md-4"><h3 class="text-success">2</h3><p class="text-muted">Needed</p></div>
                                </div>
                                <div class="row">
                                    <div class="col-md-3 mb-2"><span class="badge bg-success p-2 w-100">pve-01 (1 vote)</span></div>
                                    <div class="col-md-3 mb-2"><span class="badge bg-success p-2 w-100">pve-02 (1 vote)</span></div>
                                    <div class="col-md-3 mb-2"><span class="badge bg-success p-2 w-100">pve-03 (1 vote)</span></div>
                                </div>
                            </div>
                        </div>`;

const dashboardSection = (active, inner, isTrueNAS = false) => `
        <div id="dashboardSection" style="display: block;">
            <div id="dashboardContent">
                ${clusterStats}
                ${clusterResources}
                ${dashboardTabs(active, isTrueNAS)}
                <div class="tab-content" id="myTabContent">
                    <div class="tab-pane fade show active" role="tabpanel">
                        ${inner}
                    </div>
                </div>
                <div class="text-end mt-4"><small class="text-muted">Last update: 2026-03-21 17:10</small></div>
            </div>
        </div>`;

const serviceCards = `
<div class="row" id="servicesCards">
    <div class="col-md-4 col-lg-3 mb-3">
        <div class="node-card service-card-layout">
            <div class="service-card-layout__icon"><span class="service-icon service-card-icon text-success"><i class="bi bi-shield-check"></i></span></div>
            <div class="service-card-layout__info"><h6 class="mb-1">Vaultwarden</h6><div class="mb-1"><span class="badge bg-secondary me-1">HTTP</span><code class="small">https://vault.example.local/</code></div><div class="small text-muted">Latency: 38 ms</div></div>
            <div class="service-card-layout__status"><span class="badge bg-success">Connected</span></div>
        </div>
    </div>
    <div class="col-md-4 col-lg-3 mb-3">
        <div class="node-card service-card-layout">
            <div class="service-card-layout__icon"><span class="service-icon service-card-icon text-info"><i class="bi bi-globe2"></i></span></div>
            <div class="service-card-layout__info"><h6 class="mb-1">Traefik</h6><div class="mb-1"><span class="badge bg-secondary me-1">TCP</span><code class="small">10.200.0.15:443</code></div><div class="small text-muted">Latency: 12 ms</div></div>
            <div class="service-card-layout__status"><span class="badge bg-success">Connected</span></div>
        </div>
    </div>
    <div class="col-md-4 col-lg-3 mb-3">
        <div class="node-card service-card-layout">
            <div class="service-card-layout__icon"><span class="service-icon service-card-icon text-warning"><i class="bi bi-bar-chart"></i></span></div>
            <div class="service-card-layout__info"><h6 class="mb-1">Grafana</h6><div class="mb-1"><span class="badge bg-secondary me-1">HTTP</span><code class="small">https://grafana.example.local/</code></div><div class="small text-muted">Latency: 26 ms</div></div>
            <div class="service-card-layout__status"><span class="badge bg-danger">Server Error</span></div>
        </div>
    </div>
</div>`;

const vmCards = `
<div class="row" id="vmsMonitorCards">
    <div class="col-md-4 col-lg-3 mb-3">
        <div class="node-card vm-card-layout">
            <div class="vm-card-layout__icon"><span class="vm-icon vm-card-icon text-success"><i class="bi bi-shield-lock"></i></span></div>
            <div class="vm-card-layout__info"><h6 class="mb-1">vaultwarden</h6><div class="mb-1"><span class="badge bg-secondary me-1">CT</span></div><div class="small text-muted">pve-01 / 104</div></div>
            <div class="vm-card-layout__status"><span class="badge bg-success">Running</span></div>
        </div>
    </div>
    <div class="col-md-4 col-lg-3 mb-3">
        <div class="node-card vm-card-layout">
            <div class="vm-card-layout__icon"><span class="vm-icon vm-card-icon text-primary"><i class="bi bi-hdd-network"></i></span></div>
            <div class="vm-card-layout__info"><h6 class="mb-1">proxy-01</h6><div class="mb-1"><span class="badge bg-secondary me-1">VM</span></div><div class="small text-muted">pve-02 / 118</div></div>
            <div class="vm-card-layout__status"><span class="badge bg-success">Running</span></div>
        </div>
    </div>
    <div class="col-md-4 col-lg-3 mb-3">
        <div class="node-card vm-card-layout">
            <div class="vm-card-layout__icon"><span class="vm-icon vm-card-icon text-warning"><i class="bi bi-cpu"></i></span></div>
            <div class="vm-card-layout__info"><h6 class="mb-1">automation</h6><div class="mb-1"><span class="badge bg-secondary me-1">VM</span></div><div class="small text-muted">pve-03 / 121</div></div>
            <div class="vm-card-layout__status"><span class="badge bg-secondary">Stopped</span></div>
        </div>
    </div>
</div>`;

const netdevCards = `
<div class="row row-cols-1 row-cols-sm-2 g-2 small" id="netdevMonitorCards">
    <div class="col-md-6">
        <div class="card h-100">
            <div class="card-header py-2 px-2 d-flex justify-content-between align-items-center">
                <div class="fw-semibold text-truncate pe-2">router-core</div>
                <span class="badge bg-success">OK</span>
            </div>
            <div class="card-body p-2">
                <div class="row g-2">
                    <div class="col-6"><div class="text-center p-2 h-100"><h6 class="mb-1"><i class="bi bi-diagram-3 me-1"></i>WAN RX</h6><div class="fs-5 fw-semibold lh-sm text-break">412</div></div></div>
                    <div class="col-6"><div class="text-center p-2 h-100"><h6 class="mb-1"><i class="bi bi-diagram-3 me-1"></i>WAN TX</h6><div class="fs-5 fw-semibold lh-sm text-break">86</div></div></div>
                    <div class="col-6"><div class="text-center p-2 h-100"><h6 class="mb-1"><i class="bi bi-diagram-3 me-1"></i>Uplink</h6><div class="fs-5 fw-semibold lh-sm text-break"><span class="text-success fw-semibold">Connected</span></div></div></div>
                    <div class="col-6"><div class="text-center p-2 h-100"><h6 class="mb-1"><i class="bi bi-diagram-3 me-1"></i>Temp</h6><div class="fs-5 fw-semibold lh-sm text-break">41 C</div></div></div>
                </div>
            </div>
        </div>
    </div>
    <div class="col-md-6">
        <div class="card h-100">
            <div class="card-header py-2 px-2 d-flex justify-content-between align-items-center">
                <div class="fw-semibold text-truncate pe-2">switch-lab</div>
                <span class="badge bg-success">OK</span>
            </div>
            <div class="card-body p-2">
                <div class="row g-2">
                    <div class="col-6"><div class="text-center p-2 h-100"><h6 class="mb-1"><i class="bi bi-diagram-3 me-1"></i>Ports Up</h6><div class="fs-5 fw-semibold lh-sm text-break">18 / 24</div></div></div>
                    <div class="col-6"><div class="text-center p-2 h-100"><h6 class="mb-1"><i class="bi bi-diagram-3 me-1"></i>Core Link</h6><div class="fs-5 fw-semibold lh-sm text-break">10 Gbps</div></div></div>
                    <div class="col-6"><div class="text-center p-2 h-100"><h6 class="mb-1"><i class="bi bi-diagram-3 me-1"></i>PoE</h6><div class="fs-5 fw-semibold lh-sm text-break">214 W</div></div></div>
                    <div class="col-6"><div class="text-center p-2 h-100"><h6 class="mb-1"><i class="bi bi-diagram-3 me-1"></i>Temp</h6><div class="fs-5 fw-semibold lh-sm text-break">44 C</div></div></div>
                </div>
            </div>
        </div>
    </div>
</div>`;

const upsCards = `
<div class="row g-2 small" id="upsMonitorCards">
    <div class="col-12">
        <div class="node-card ups-node-card ups-node-card--single h-100">
            <div class="d-flex justify-content-between align-items-center mb-3 gap-2">
                <h5 class="mb-0 text-truncate">ups</h5>
                <span class="badge bg-success">Online</span>
            </div>
            <div class="row g-2 hm-cluster-metric-panel">
                <div class="col-6 col-md-3"><div class="text-center p-3 hm-cluster-metric-cell h-100"><h6><i class="bi bi-plug me-2"></i><span>Input V</span></h6><div class="display-6 text-break">226 V</div></div></div>
                <div class="col-6 col-md-3"><div class="text-center p-3 hm-cluster-metric-cell h-100"><h6><i class="bi bi-speedometer2 me-2"></i><span>Load</span></h6><div class="display-6 text-break">33 %</div><div class="progress mt-2 hm-progress hm-progress--cluster"><div class="progress-bar bg-success" style="width: 33%"></div></div></div></div>
                <div class="col-6 col-md-3"><div class="text-center p-3 hm-cluster-metric-cell h-100"><h6><i class="bi bi-battery-half me-2"></i><span>Charge</span></h6><div class="display-6 text-break">100%</div><div class="progress mt-2 hm-progress hm-progress--cluster"><div class="progress-bar bg-success" style="width: 100%"></div></div></div></div>
                <div class="col-6 col-md-3"><div class="text-center p-3 hm-cluster-metric-cell h-100"><h6><i class="bi bi-clock-history me-2"></i><span>Battery runtime</span></h6><div class="display-6 text-break">9m 4s</div></div></div>
            </div>
            <div class="small text-muted mt-2">NUT · 10.200.0.5</div>
        </div>
    </div>
</div>`;

const speedtestMonitorContent = `
    <div class="monitor-screen__meta-grid speedtest-monitor__kpi-grid">
        <div class="monitor-screen__meta-card speedtest-monitor__meta-card"><div class="monitor-screen__meta-label"><i class="bi bi-clock-history me-1"></i><span>Last run</span></div><div class="monitor-screen__meta-value hm-speedtest-last-run text-break">2026-03-21 09:12</div></div>
        <div class="monitor-screen__meta-card speedtest-monitor__meta-card"><div class="monitor-screen__meta-label"><i class="bi bi-arrow-down-circle me-1"></i><span>Download</span></div><div class="speedtest-monitor__speed-row"><div class="monitor-screen__meta-value speedtest-monitor__speed-val text-break mb-0">951 Mbps</div><div class="speedtest-monitor__last-dev"><span class="speedtest-monitor__last-dev-pct text-danger">−4.9%</span><span class="speedtest-monitor__last-dev-plan"> – 1000 Mbps</span></div></div></div>
        <div class="monitor-screen__meta-card speedtest-monitor__meta-card"><div class="monitor-screen__meta-label"><i class="bi bi-cloud-upload me-1"></i><span>Upload</span></div><div class="speedtest-monitor__speed-row"><div class="monitor-screen__meta-value speedtest-monitor__speed-val text-break mb-0">512 Mbps</div><div class="speedtest-monitor__last-dev"><span class="speedtest-monitor__last-dev-pct text-danger">−14.7%</span><span class="speedtest-monitor__last-dev-plan"> – 600 Mbps</span></div></div></div>
        <div class="monitor-screen__meta-card speedtest-monitor__meta-card"><div class="monitor-screen__meta-label"><i class="bi bi-activity me-1"></i><span>Ping</span></div><div class="monitor-screen__meta-value speedtest-monitor__speed-val text-break">4 ms</div></div>
    </div>
    <div class="monitor-screen__meta-label mb-1">Download today (average / min / max)</div>
    <div class="monitor-screen__meta-grid speedtest-monitor__today-grid">
        <div class="monitor-screen__meta-card speedtest-monitor__meta-card"><div class="monitor-screen__meta-label"><i class="bi bi-graph-up-arrow me-1"></i><span>Average (today)</span></div><div class="monitor-screen__meta-value speedtest-monitor__speed-val">940 Mbps</div><div class="progress mt-2 hm-progress hm-progress--cluster"><div class="progress-bar bg-success" style="width: 99%"></div></div></div>
        <div class="monitor-screen__meta-card speedtest-monitor__meta-card"><div class="monitor-screen__meta-label"><i class="bi bi-arrow-down-circle me-1"></i><span>Minimum</span></div><div class="monitor-screen__meta-value speedtest-monitor__speed-val">902 Mbps</div><div class="progress mt-2 hm-progress hm-progress--cluster"><div class="progress-bar bg-success" style="width: 96%"></div></div></div>
        <div class="monitor-screen__meta-card speedtest-monitor__meta-card"><div class="monitor-screen__meta-label"><i class="bi bi-arrow-up-circle me-1"></i><span>Maximum</span></div><div class="monitor-screen__meta-value speedtest-monitor__speed-val">951 Mbps</div><div class="progress mt-2 hm-progress hm-progress--cluster"><div class="progress-bar bg-success" style="width: 100%"></div></div></div>
    </div>
    <div class="monitor-screen__meta-extra small text-muted speedtest-monitor__extra">Frankfurt · Upload avg today: 511 Mbps</div>
    <div class="speedtest-monitor__table-block d-flex flex-column min-h-0 flex-grow-1">
        <div class="monitor-screen__meta-label mb-2 flex-shrink-0">Today's measurements</div>
        <div class="table-responsive speedtest-monitor__table-scroll flex-grow-1 min-h-0">
            <table class="speedtest-monitor__table mb-0" id="speedtestMonitorRunsTable">
                <thead><tr><th>Time</th><th class="text-end">Download</th><th class="text-end">Δ ↓</th><th class="text-end">Upload</th><th class="text-end">Δ ↑</th><th class="text-end">Ping</th><th>Server</th></tr></thead>
                <tbody>
                    <tr class="speedtest-monitor__row"><td class="speedtest-monitor__cell speedtest-monitor__cell--time text-nowrap">2026-03-21 09:12</td><td class="speedtest-monitor__cell speedtest-monitor__cell--num text-end">951 Mbps</td><td class="speedtest-monitor__cell speedtest-monitor__cell--dev text-end text-danger">−4.9%</td><td class="speedtest-monitor__cell speedtest-monitor__cell--num text-end">512 Mbps</td><td class="speedtest-monitor__cell speedtest-monitor__cell--dev text-end text-danger">−14.7%</td><td class="speedtest-monitor__cell speedtest-monitor__cell--num text-end">4 ms</td><td class="speedtest-monitor__cell speedtest-monitor__cell--note">Frankfurt</td></tr>
                    <tr class="speedtest-monitor__row"><td class="speedtest-monitor__cell speedtest-monitor__cell--time text-nowrap">2026-03-21 03:12</td><td class="speedtest-monitor__cell speedtest-monitor__cell--num text-end">920 Mbps</td><td class="speedtest-monitor__cell speedtest-monitor__cell--dev text-end text-danger">−8%</td><td class="speedtest-monitor__cell speedtest-monitor__cell--num text-end">498 Mbps</td><td class="speedtest-monitor__cell speedtest-monitor__cell--dev text-end text-danger">−17%</td><td class="speedtest-monitor__cell speedtest-monitor__cell--num text-end">5.2 ms</td><td class="speedtest-monitor__cell speedtest-monitor__cell--note">Frankfurt</td></tr>
                </tbody>
            </table>
        </div>
    </div>
`;

const speedtestDashboardCard = `
            <div class="card speedtest-monitor__shell">
                <div class="card-header">
                    <h5 class="mb-0"><i class="bi bi-speedometer2 me-2"></i><span>Speedtest</span></h5>
                </div>
                <div class="card-body monitor-screen__panel-body speedtest-monitor__body">
${speedtestMonitorContent}
                </div>
            </div>`;

const speedtestNormalPage = `
        <div id="speedtestMonitorSection" class="mb-4 monitor-screen" style="display: block;">
${speedtestDashboardCard}
        </div>`;

const normalScreenSection = (id, title, icon, body) => `
        <div id="${id}" class="mb-4 monitor-screen" style="display: block;">
            <div class="monitor-screen__layout">
                <div class="monitor-screen__panel">
                    <div class="monitor-view__panel-title monitor-screen__panel-title">
                        <div>
                            <h5 class="mb-0"><i class="bi bi-${icon} me-2"></i><span>${title}</span></h5>
                        </div>
                    </div>
                    <div class="monitor-screen__panel-body">
                        ${body}
                    </div>
                </div>
            </div>
        </div>`;

const monitorToolbar = (title) => `
        <div id="monitorToolbar" class="monitor-toolbar" style="display: flex;">
            <div class="monitor-toolbar-left">
                <select class="form-select form-select-sm monitor-toolbar-select">
                    <option selected>Proxmox</option>
                    <option>TrueNAS</option>
                </select>
            </div>
            <div class="monitor-toolbar-center">
                <span class="monitor-toolbar-title">${title}</span>
                <span class="monitor-toolbar-update text-muted small">Updated 2026-03-21 17:20</span>
                <div class="monitor-toolbar-dots">
                    <button type="button" class="monitor-toolbar-dot is-active" title="Cluster" aria-label="Cluster"></button>
                    <button type="button" class="monitor-toolbar-dot" title="Services" aria-label="Services"></button>
                    <button type="button" class="monitor-toolbar-dot" title="VM / CT" aria-label="VM / CT"></button>
                    <button type="button" class="monitor-toolbar-dot" title="UPS" aria-label="UPS"></button>
                </div>
            </div>
            <div class="monitor-toolbar-theme">
                <div class="monitor-toolbar-nav-group" role="group" aria-label="Screens">
                    <button type="button" class="btn btn-sm monitor-toolbar-nav-btn" title="Prev"><i class="bi bi-chevron-left"></i></button>
                    <button type="button" class="btn btn-sm monitor-toolbar-nav-btn" title="Home"><i class="bi bi-house-door"></i></button>
                    <button type="button" class="btn btn-sm monitor-toolbar-nav-btn" title="Next"><i class="bi bi-chevron-right"></i></button>
                </div>
                <button type="button" class="btn btn-sm monitor-toolbar-theme-btn" title="Refresh"><i class="bi bi-arrow-repeat"></i></button>
                <button type="button" class="btn btn-sm monitor-toolbar-theme-btn active" title="Light theme"><i class="bi bi-sun-fill"></i></button>
                <button type="button" class="btn btn-sm monitor-toolbar-theme-btn" title="Dark theme"><i class="bi bi-moon-stars-fill"></i></button>
            </div>
            <div class="monitor-toolbar-right">
                <button type="button" class="btn btn-sm monitor-toolbar-settings" title="Settings">
                    <i class="bi bi-gear me-1"></i><span>Settings</span>
                </button>
                <a href="./dashboard.html" class="btn btn-sm monitor-toolbar-exit" title="Exit monitor mode">
                    <i class="bi bi-fullscreen-exit me-1"></i><span>Exit</span>
                </a>
            </div>
        </div>`;

const monitorPageContent = {
    cluster: `
        <div id="dashboardSection" style="display: block;">
            <div id="dashboardContent">
                ${clusterStats}
                ${clusterResources}
                ${dashboardTabs('nodes')}
                <div class="tab-content" id="myTabContent">
                    <div class="tab-pane fade show active" id="nodes" role="tabpanel">
                        ${nodesContent}
                    </div>
                </div>
                <div class="text-end mt-4"><small class="text-muted">Last update: 2026-03-21 17:20</small></div>
            </div>
        </div>
        ${monitorToolbar('Cluster')}`,
    services: `
        <div id="servicesMonitorSection" class="mb-4 monitor-screen" style="display: block;">
            <div class="monitor-screen__layout">
                <div class="monitor-screen__panel">
                    <div class="monitor-view__panel-title monitor-screen__panel-title">
                        <div class="d-flex flex-wrap align-items-center justify-content-between gap-2">
                            <div>
                                <h5 class="mb-0"><i class="bi bi-activity me-2"></i><span>Service Monitoring</span></h5>
                                <div class="small opacity-75 mt-1">Services selected in settings. Only visible monitor entries are shown here.</div>
                            </div>
                            <button class="btn btn-sm btn-outline-light monitor-screen__header-action">
                                <i class="bi bi-arrow-repeat me-1"></i><span>Check all</span>
                            </button>
                        </div>
                    </div>
                    <div class="monitor-screen__panel-body">${serviceCards}</div>
                </div>
            </div>
        </div>
        ${monitorToolbar('Services')}`,
    vms: `
        <div id="vmsMonitorSection" class="mb-4 monitor-screen" style="display: block;">
            <div class="monitor-screen__layout">
                <div class="monitor-screen__panel">
                    <div class="monitor-view__panel-title monitor-screen__panel-title">
                        <div>
                            <h5 class="mb-0"><i class="bi bi-hdd-network me-2"></i><span>VM / CT Status</span></h5>
                            <div class="small opacity-75 mt-1">Guests selected in settings for the dedicated VM / CT monitor screen.</div>
                        </div>
                    </div>
                    <div class="monitor-screen__panel-body">${vmCards}</div>
                </div>
            </div>
        </div>
        ${monitorToolbar('VM / CT')}`,
    ups: `
        <div id="upsMonitorSection" class="mb-4 monitor-screen" style="display: block;">
            <div class="monitor-screen__layout">
                <div class="monitor-screen__panel">
                    <div class="monitor-view__panel-title monitor-screen__panel-title d-flex flex-wrap align-items-center justify-content-between gap-2">
                        <h5 class="mb-0"><i class="bi bi-lightning me-2"></i><span>UPS</span></h5>
                        <span class="small opacity-75">2026-03-21 17:20</span>
                    </div>
                    <div class="monitor-screen__panel-body">${upsCards}</div>
                </div>
            </div>
        </div>
        ${monitorToolbar('UPS')}`,
    netdev: `
        <div id="netdevMonitorSection" class="mb-4 monitor-screen" style="display: block;">
            <div class="monitor-screen__layout">
                <div class="monitor-screen__panel">
                    <div class="monitor-view__panel-title monitor-screen__panel-title d-flex flex-wrap align-items-center justify-content-between gap-2">
                        <h5 class="mb-0"><i class="bi bi-diagram-3 me-2"></i><span>Network Devices (SNMP)</span></h5>
                        <span class="small opacity-75">2026-03-21 17:20</span>
                    </div>
                    <div class="monitor-screen__panel-body">${netdevCards}</div>
                </div>
            </div>
        </div>
        ${monitorToolbar('Network Devices')}`,
    speedtest: `
        <div id="speedtestMonitorSection" class="mb-4 monitor-screen" style="display: block;">
${speedtestDashboardCard}
        </div>
        ${monitorToolbar('Speedtest')}`,
    backupRuns: `
        <div id="backupsMonitorSection" class="monitor-backups-screen monitor-screen" style="display: flex;">
            <div class="monitor-screen__layout">
                <div class="monitor-screen__panel monitor-backups-main-card">
                    <div class="monitor-view__panel-title monitor-screen__panel-title d-flex flex-wrap align-items-center gap-2">
                        <h5 class="mb-0 flex-grow-1"><i class="bi bi-cloud-arrow-down me-2"></i><span>Execution Status</span></h5>
                    </div>
                    <div class="monitor-screen__panel-body monitor-backups-body">
                        <div class="monitor-backups-nodes-row flex-grow-1 min-h-0" id="backupsMonitorCardsRow">
                            <div class="monitor-backup-node-col">
                                <div class="card monitor-backup-node-card border h-100">
                                    <div class="card-header d-flex align-items-center gap-2">
                                        <span class="text-truncate min-w-0 flex-grow-1"><i class="bi bi-hdd-network me-1 flex-shrink-0"></i>pve-01</span>
                                        <span class="monitor-backup-count-badge badge bg-secondary text-nowrap"><span class="monitor-backup-count-num">2</span><span class="mx-1">/</span><span>2</span></span>
                                    </div>
                                    <div class="card-body monitor-backup-card-body-table p-0">
                                        <div class="monitor-backup-table-scroll">
                                            <table class="table monitor-backup-node-table mb-0">
                                                <thead><tr><th class="monitor-backup-col-vm">VM / CT</th><th class="monitor-backup-col-time">Time</th><th class="monitor-backup-col-st text-end">Status</th></tr></thead>
                                                <tbody>
                                                    <tr class="monitor-backup-tr monitor-backup-tr--ok"><td class="monitor-backup-col-vm">104</td><td class="monitor-backup-col-time"><span class="monitor-backup-time-start">02:00</span><span class="monitor-backup-time-sep"> → </span><span class="monitor-backup-time-end">02:24</span></td><td class="monitor-backup-col-st"><span class="badge bg-success">OK</span></td></tr>
                                                    <tr class="monitor-backup-tr monitor-backup-tr--run"><td class="monitor-backup-col-vm">118</td><td class="monitor-backup-col-time"><span class="monitor-backup-time-single">02:26</span></td><td class="monitor-backup-col-st"><span class="badge bg-primary">Running</span></td></tr>
                                                </tbody>
                                            </table>
                                        </div>
                                    </div>
                                </div>
                            </div>
                            <div class="monitor-backup-node-col">
                                <div class="card monitor-backup-node-card border h-100">
                                    <div class="card-header d-flex align-items-center gap-2">
                                        <span class="text-truncate min-w-0 flex-grow-1"><i class="bi bi-hdd-network me-1 flex-shrink-0"></i>pve-02</span>
                                        <span class="monitor-backup-count-badge badge bg-secondary text-nowrap"><span class="monitor-backup-count-num">2</span><span class="mx-1">/</span><span>2</span></span>
                                    </div>
                                    <div class="card-body monitor-backup-card-body-table p-0">
                                        <div class="monitor-backup-table-scroll">
                                            <table class="table monitor-backup-node-table mb-0">
                                                <thead><tr><th class="monitor-backup-col-vm">VM / CT</th><th class="monitor-backup-col-time">Time</th><th class="monitor-backup-col-st text-end">Status</th></tr></thead>
                                                <tbody>
                                                    <tr class="monitor-backup-tr monitor-backup-tr--ok"><td class="monitor-backup-col-vm">121</td><td class="monitor-backup-col-time"><span class="monitor-backup-time-start">02:24</span><span class="monitor-backup-time-sep"> → </span><span class="monitor-backup-time-end">02:46</span></td><td class="monitor-backup-col-st"><span class="badge bg-success">OK</span></td></tr>
                                                    <tr class="monitor-backup-tr monitor-backup-tr--warn"><td class="monitor-backup-col-vm">136</td><td class="monitor-backup-col-time"><span class="monitor-backup-time-single">04:00</span></td><td class="monitor-backup-col-st"><span class="badge bg-warning text-dark">Queued</span></td></tr>
                                                </tbody>
                                            </table>
                                        </div>
                                    </div>
                                </div>
                            </div>
                        </div>
                    </div>
                </div>
            </div>
        </div>
        ${monitorToolbar('Backups')}`
};

const buildSettingsPage = (page) => pageShell(`HomeLab Monitor Demo ${page.title}`, settingLayout(page.key, settingsContent[page.key]));

const buildNormalPage = (page) => {
    if (page.key === 'nodes') return pageShell('HomeLab Monitor Demo Nodes', dashboardSection('nodes', nodesContent));
    if (page.key === 'storage') return pageShell('HomeLab Monitor Demo Storage', dashboardSection('storage', storageContent));
    if (page.key === 'servers') return pageShell('HomeLab Monitor Demo Servers', dashboardSection('servers', serversContent, true), { navbar: { serverType: 'TrueNAS', currentServer: 'TrueNAS A' } });
    if (page.key === 'backups') return pageShell('HomeLab Monitor Demo Backups', dashboardSection('backups', backupsContent));
    if (page.key === 'quorum') return pageShell('HomeLab Monitor Demo Quorum', dashboardSection('quorum', quorumContent));
    if (page.key === 'services') return pageShell('HomeLab Monitor Demo Services', normalScreenSection('servicesMonitorSection', 'Service Monitoring', 'activity', serviceCards));
    if (page.key === 'vms') return pageShell('HomeLab Monitor Demo VM CT', normalScreenSection('vmsMonitorSection', 'VM / CT Status', 'hdd-network', vmCards));
    if (page.key === 'netdev') return pageShell('HomeLab Monitor Demo Network Devices', normalScreenSection('netdevMonitorSection', 'Network Devices (SNMP)', 'diagram-3', netdevCards));
    if (page.key === 'speedtest') return pageShell('HomeLab Monitor Demo Speedtest', speedtestNormalPage);
    return '';
};

const buildMonitorPage = (page) => pageShell(`HomeLab Monitor Demo ${page.title}`, monitorPageContent[page.key], { monitor: true });

const buildIndex = () => {
    const settingsLinks = settingsPages.map((p) => `<li class="list-group-item"><a class="text-decoration-none" href="./${p.file}">${p.title}</a></li>`).join('');
    const normalLinks = normalPages.map((p) => `<li class="list-group-item"><a class="text-decoration-none" href="./${p.file}">${p.title}</a></li>`).join('');
    const monitorLinks = monitorPages.map((p) => `<li class="list-group-item"><a class="text-decoration-none" href="./${p.file}">${p.title}</a></li>`).join('');
    return pageShell('HomeLab Monitor Demo', `
        <div class="row g-4 mb-4">
            <div class="col-md-4"><div class="stat-card"><div class="stat-value">${settingsPages.length}</div><div class="stat-label">Settings Screens</div></div></div>
            <div class="col-md-4"><div class="stat-card"><div class="stat-value">${normalPages.length}</div><div class="stat-label">Normal Mode Screens</div></div></div>
            <div class="col-md-4"><div class="stat-card"><div class="stat-value">${monitorPages.length}</div><div class="stat-label">Monitor Mode Screens</div></div></div>
        </div>
        <div class="row g-4">
            <div class="col-lg-4">
                <div class="card"><div class="card-header"><h5 class="mb-0"><i class="bi bi-sliders me-2"></i>Settings</h5></div><div class="card-body"><ul class="list-group list-group-flush">${settingsLinks}</ul></div></div>
            </div>
            <div class="col-lg-4">
                <div class="card"><div class="card-header"><h5 class="mb-0"><i class="bi bi-speedometer2 me-2"></i>Normal Mode</h5></div><div class="card-body"><ul class="list-group list-group-flush">${normalLinks}</ul></div></div>
            </div>
            <div class="col-lg-4">
                <div class="card"><div class="card-header"><h5 class="mb-0"><i class="bi bi-display me-2"></i>Monitor Mode</h5></div><div class="card-body"><ul class="list-group list-group-flush">${monitorLinks}</ul></div></div>
            </div>
        </div>
    `);
};

function writeDemoFile(fileName, html) {
    fs.writeFileSync(path.join(demoDir, fileName), html, 'utf8');
}

function writeDemoCssSnapshot() {
    const sourceCss = fs.readFileSync(publicCssPath, 'utf8');
    fs.writeFileSync(demoCssPath, sourceCss, 'utf8');
}

writeDemoCssSnapshot();
writeDemoFile('index.html', buildIndex());

settingsPages.forEach((page) => writeDemoFile(page.file, buildSettingsPage(page)));
normalPages.forEach((page) => writeDemoFile(page.file, buildNormalPage(page)));
monitorPages.forEach((page) => writeDemoFile(page.file, buildMonitorPage(page)));

writeDemoFile('settings.html', buildSettingsPage(settingsPages[0]));
writeDemoFile('dashboard.html', buildNormalPage(normalPages[0]));
writeDemoFile('monitor.html', buildMonitorPage(monitorPages[0]));

console.log(`Generated ${settingsPages.length + normalPages.length + monitorPages.length + 4} demo pages in ${demoDir}`);
