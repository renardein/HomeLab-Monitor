// Global variables
let apiToken = null;
let autoRefreshInterval = null;
let storageTable = null;
let backupsJobsTable = null;
let backupsExecTable = null;
let currentLanguage = 'ru';
let refreshIntervalMs = 30000; // Default refresh interval
let currentTheme = 'light';
let currentUnits = 'decimal'; // 'decimal' (GB) or 'binary' (GiB)
let monitorMode = false; // Monitor (display) mode flag
/** Тема режима монитора: 'light' | 'dark' (независимо от общей темы) */
let monitorTheme = 'light';
/** Пользовательские CSS-стили для 2 режимов x 2 тем */
let customThemeCss = {
    normal: { light: '', dark: '' },
    monitor: { light: '', dark: '' }
};
let customThemeStyleSettings = null; // plain settings object (generated -> CSS)
const CUSTOM_THEME_STYLE_EL_ID = 'customThemeCssStyle';
const customThemeManager = window.CustomThemeManagerModule.createManager({
    styleElId: CUSTOM_THEME_STYLE_EL_ID,
    getCustomThemeCss: () => customThemeCss,
    setCustomThemeCss: (v) => { customThemeCss = v; },
    getCustomThemeStyleSettings: () => customThemeStyleSettings,
    setCustomThemeStyleSettings: (v) => { customThemeStyleSettings = v; },
    saveSettingsToServer: (payload) => saveSettingsToServer(payload),
    showToast: (msg, type) => showToast(msg, type)
});
/** Разблокированы ли настройки в этой сессии (для защиты паролем) */
let settingsUnlocked = false;
/** Пароль настроек включён (из API) */
let settingsPasswordRequired = false;
/** TTL сессии настроек в минутах (из API, по умолчанию 30) */
let settingsSessionTtlMinutes = 30;
const SETTINGS_UNLOCK_EXPIRY_KEY = 'settings_unlock_expiry';
/** Время последнего успешного обновления данных (для раздела отладки) */
let lastRefreshTime = null;
const THRESHOLD_DEFAULTS = {
    cpuGreen: 70, cpuYellow: 90, cpuRed: 100,
    ramGreen: 70, ramYellow: 90, ramRed: 100
};
let thresholds = { ...THRESHOLD_DEFAULTS };

/**
 * Пороги из API/формы: числа 0–100, зелёный ≤ жёлтый ≤ красный; пара 0/0 считается битой записью → дефолты.
 */
function normalizeThresholds(raw) {
    const d = { ...THRESHOLD_DEFAULTS };
    if (!raw || typeof raw !== 'object') return d;
    const clamp = (v) => {
        const n = parseInt(v, 10);
        if (!Number.isFinite(n)) return null;
        return Math.max(0, Math.min(100, n));
    };
    let cpuG = clamp(raw.cpuGreen) ?? d.cpuGreen;
    let cpuY = clamp(raw.cpuYellow) ?? d.cpuYellow;
    let cpuR = clamp(raw.cpuRed) ?? d.cpuRed;
    let ramG = clamp(raw.ramGreen) ?? d.ramGreen;
    let ramY = clamp(raw.ramYellow) ?? d.ramYellow;
    let ramR = clamp(raw.ramRed) ?? d.ramRed;
    if (cpuG === 0 && cpuY === 0) {
        cpuG = d.cpuGreen;
        cpuY = d.cpuYellow;
        cpuR = d.cpuRed;
    }
    if (ramG === 0 && ramY === 0) {
        ramG = d.ramGreen;
        ramY = d.ramYellow;
        ramR = d.ramRed;
    }
    if (cpuG > cpuY) cpuY = cpuG;
    if (cpuY > cpuR) cpuR = cpuY;
    if (ramG > ramY) ramY = ramG;
    if (ramY > ramR) ramR = ramY;
    return {
        cpuGreen: cpuG, cpuYellow: cpuY, cpuRed: cpuR,
        ramGreen: ramG, ramYellow: ramY, ramRed: ramR
    };
}
let proxmoxServers = ['https://192.168.1.1:8006']; // List of Proxmox servers
let currentServerIndex = 0; // Current server index
let truenasServers = ['https://192.168.1.2']; // List of TrueNAS servers
let currentTrueNASServerIndex = 0;
let connectionIdMap = {}; // key: `${type}|${url}` -> connectionId (no secrets)
let isRefreshing = false;
const htmlCache = {}; // elementId -> last innerHTML string
let monitoredServices = []; // [{ id, name, type: 'tcp'|'udp'|'http', host?, port?, url?, lastStatus, lastLatency }]
let monitorHiddenServiceIds = []; // IDs of services to hide in monitor mode (empty = show all)
let monitorServiceIcons = {}; // service id -> Iconify icon name
let monitorServiceIconColors = {}; // service id -> CSS hex color
let monitoredVmIds = []; // VMids that are in the "monitored" list (shown in settings table)
let monitorHiddenVmIds = []; // Of those, VMids to hide in monitor mode (checkbox unchecked)
let monitorVmIcons = {}; // vmid -> Iconify icon name
let monitorVmIconColors = {}; // vmid -> CSS hex color
let savedViews = []; // [{ id, name, createdAt, payload }]
/** @type {Array<object>} */
let telegramNotificationRules = [];
let telegramBotTokenSet = false;
/** Кэш последнего ответа telegram-fetch-chats: { chats, threadsByChat } */
let telegramChatsCache = { chats: [], threadsByChat: {} };
/** false → показать мастер начальной настройки (первый запуск или сброс) */
let setupCompleted = true;
let setupWizardStep = 1;
let setupWizardServerType = 'proxmox';
let setupWizardListenersBound = false;
let telegramRuleMessageModalBound = false;
let setupWizardFinishMode = 'success';
let clusterDashboardTiles = []; // [{ type: 'service'|'vmct'|'netdev'|'ups'|'speedtest'|'iperf3'|'smart_sensor'|'embed'|'truenas_server'|…, sourceId: 'type:id' }]
let clusterDashboardTilesDirty = false;
let clusterDashboardTilesSettingPresent = false;
let clusterDashboardTilesAutosaveTimer = null;
let savedTileViews = []; // [{ id, name, createdAt, payload }]
/** Текст последней ошибки POST /api/settings (для сообщений пользователю). */
let saveSettingsLastError = '';
const CLUSTER_DASHBOARD_TILE_TYPES = ['service', 'vmct', 'netdev', 'ups', 'ups_metric_chart', 'cluster_metric_chart', 'host_node_metric_chart', 'cluster_node', 'speedtest', 'iperf3', 'truenas_server', 'truenas_pool', 'truenas_disk', 'truenas_service', 'truenas_app', 'smart_sensor', 'smart_sensor_metric_chart', 'embed'];
const CLUSTER_EMBED_HTML_MAX = 100000;
/** Макс. размер загружаемого файла изображения для плитки embed (байты). */
const CLUSTER_EMBED_IMAGE_FILE_MAX_BYTES = 16 * 1024 * 1024;
/** Макс. длина строки data URL (base64 длиннее исходного файла ~4/3). */
const CLUSTER_EMBED_IMAGE_DATA_URL_MAX = Math.ceil(CLUSTER_EMBED_IMAGE_FILE_MAX_BYTES * 4 / 3) + 512;
/** Кэш конфигов для выпадающего списка плиток «датчик» (не только открытый редактор). */
let smartSensorsConfigsForTiles = [];
const MAX_CLUSTER_DASHBOARD_TILES = 20;
/** Сетка экрана Tiles: колонки × строки, клетка 1×1. */
const TILES_MONITOR_GRID_COLS = 12;
const TILES_MONITOR_GRID_ROWS = 8;
/** Во время renderTilesMonitorScreen нижние подписи плиток скрыты, чтобы не съедать высоту сетки. */
let tilesMonitorTileFooterSuppressDepth = 0;
const DEFAULT_DASHBOARD_TIMEZONE = (() => {
    try {
        return Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';
    } catch (_) {
        return 'UTC';
    }
})();
const DASHBOARD_WEATHER_REFRESH_MS = 10 * 60 * 1000;
let dashboardWeatherCity = '';
/** open_meteo | openweathermap | yandex | gismeteo */
let dashboardWeatherProvider = 'open_meteo';
let weatherOpenweathermapApiKeySet = false;
let weatherYandexApiKeySet = false;
let weatherGismeteoApiKeySet = false;

function isPageVisible() {
    try { return !document.hidden; } catch (_) { return true; }
}

function initPwaOfflineLite() {
    if (!('serviceWorker' in navigator)) return;
    window.addEventListener('load', async () => {
        try {
            const reg = await navigator.serviceWorker.register('/sw.js', {
                scope: '/',
                updateViaCache: 'none'
            });
            try { await reg.update(); } catch (_) {}
            let reloadedForSw = false;
            navigator.serviceWorker.addEventListener('controllerchange', () => {
                if (reloadedForSw) return;
                reloadedForSw = true;
                // Ensure latest HTML/JS is applied after SW upgrade.
                window.location.reload();
            });
        } catch (e) {
            console.warn('Service worker registration failed:', e);
        }
    });
    window.addEventListener('online', () => {
        try { showToast('Online mode restored', 'success'); } catch (_) {}
    });
    window.addEventListener('offline', () => {
        try { showToast('Offline-lite mode: using cached data', 'warning'); } catch (_) {}
    });
}
initPwaOfflineLite();

function initMonitorPerformanceGuards() {
    document.addEventListener('visibilitychange', () => {
        if (document.hidden) return;
        // Refresh once after tab becomes visible to avoid stale monitor data.
        if (monitorMode || apiToken || getCurrentConnectionId()) {
            refreshData({ silent: true });
        }
        scheduleHomeLabFontScale();
    });
}
initMonitorPerformanceGuards();
let dashboardTimezone = DEFAULT_DASHBOARD_TIMEZONE;
let dashboardWeatherData = null;
let dashboardWeatherDisplayName = '';
let dashboardWeatherError = '';
let dashboardWeatherLastFetchMs = 0;
let dashboardWeatherFetchPromise = null;
let dashboardClockInterval = null;
/** Показ карточек «время» / «погода» на дашборде в обычном режиме */
let dashboardShowTime = true;
let dashboardShowWeather = true;
/** То же для экрана кластера в режиме монитора */
let monitorShowTime = true;
let monitorShowWeather = true;
/** Блокировать системные gesture-навигации Chrome в monitor mode */
let monitorDisableChromeGestures = true;
/** Компактные графики Tiles: подписи осей по отдельности */
let monitorTilesChartAxisTime = true;
let monitorTilesChartAxisValues = true;
let monitorTilesChartAxisYUnit = true;
let metricsHistoryRetentionHoursCluster = 72;
let metricsHistoryRetentionHoursHost = 72;
let metricsHistoryRetentionHoursUps = 72;
let metricsHistoryRetentionHoursSmart = 72;
let chartWindowClusterMetricMin = 1440;
let chartWindowHostMetricMin = 1440;
let chartWindowUpsMetricMin = 1440;
let chartWindowSmartSensorMetricMin = 1440;
let tilesChartDisplayVariant = 'area';
const appNavigationManager = window.AppNavigationManagerModule.createManager({
    getMonitorMode: () => monitorMode,
    applyMonitorView: (view) => applyMonitorView(view),
    renderMonitorScreenDots: () => renderMonitorScreenDots(),
    hideAllMonitorShellSections: () => hideAllMonitorShellSections(),
    hasAuth: () => !!apiToken,
    refreshData: (options) => refreshData(options),
    getAutoRefreshInterval: () => autoRefreshInterval,
    setAutoRefreshInterval: (v) => { autoRefreshInterval = v; },
    getRefreshIntervalMs: () => refreshIntervalMs,
    updateHomeLabFontScale: () => updateHomeLabFontScale()
});
const dashboardTimeWeatherSettingsManager = window.DashboardTimeWeatherSettingsModule.createManager({
    el,
    t,
    normalizeDashboardWeatherProvider,
    normalizeDashboardWeatherCity,
    normalizeDashboardTimezone,
    isValidDashboardTimezone,
    setValue,
    normalizeMonitorHotkeys,
    saveSettingsToServer,
    startDashboardClockTimer,
    resetDashboardWeatherState,
    applyMonitorChromeGestureGuards,
    refreshDashboardWeather,
    showToast,
    getState: () => ({
        dashboardWeatherCity,
        dashboardTimezone,
        dashboardWeatherProvider,
        dashboardShowTime,
        dashboardShowWeather,
        monitorShowTime,
        monitorShowWeather,
        monitorDisableChromeGestures,
        monitorHotkeys,
        weatherOpenweathermapApiKeySet,
        weatherYandexApiKeySet,
        weatherGismeteoApiKeySet
    }),
    setState: (next) => {
        if (next.dashboardWeatherCity !== undefined) dashboardWeatherCity = next.dashboardWeatherCity;
        if (next.dashboardTimezone !== undefined) dashboardTimezone = next.dashboardTimezone;
        if (next.dashboardWeatherProvider !== undefined) dashboardWeatherProvider = next.dashboardWeatherProvider;
        if (next.dashboardShowTime !== undefined) dashboardShowTime = next.dashboardShowTime;
        if (next.dashboardShowWeather !== undefined) dashboardShowWeather = next.dashboardShowWeather;
        if (next.monitorShowTime !== undefined) monitorShowTime = next.monitorShowTime;
        if (next.monitorShowWeather !== undefined) monitorShowWeather = next.monitorShowWeather;
        if (next.monitorDisableChromeGestures !== undefined) monitorDisableChromeGestures = next.monitorDisableChromeGestures;
        if (next.monitorHotkeys !== undefined) monitorHotkeys = next.monitorHotkeys;
        if (next.weatherOpenweathermapApiKeySet !== undefined) weatherOpenweathermapApiKeySet = next.weatherOpenweathermapApiKeySet;
        if (next.weatherYandexApiKeySet !== undefined) weatherYandexApiKeySet = next.weatherYandexApiKeySet;
        if (next.weatherGismeteoApiKeySet !== undefined) weatherGismeteoApiKeySet = next.weatherGismeteoApiKeySet;
    }
});
const connectionManager = window.ConnectionManagerModule.createManager({
    t,
    showToast,
    showDashboard,
    getApiToken: () => apiToken,
    setApiToken: (v) => { apiToken = v; },
    getConnectionIdForType: (backendType) => getConnectionIdForType(backendType),
    syncProxmoxApiTokenFromParts: () => syncProxmoxApiTokenFromParts(),
    getServerUrlForType: (backendType) => getServerUrlForType(backendType),
    saveConnectionId: (type, url, id) => saveConnectionId(type, url, id),
    setDisplay: (id, value) => setDisplay(id, value)
});

function parseBoolSettingClient(v, defaultVal = true) {
    if (v === undefined || v === null || v === '') return defaultVal;
    if (v === false || v === '0' || v === 0 || v === 'false') return false;
    return true;
}

function isDashboardTimeVisibleForCurrentMode() {
    return monitorMode ? monitorShowTime : dashboardShowTime;
}

function isDashboardWeatherVisibleForCurrentMode() {
    return monitorMode ? monitorShowWeather : dashboardShowWeather;
}

function applyDashboardTimeWeatherVisibility() {
    const timeWrap = el('dashboardTimeCardWrap');
    const weatherWrap = el('dashboardWeatherCardWrap');
    const toolbarUpd = el('monitorToolbarUpdate');
    const showT = isDashboardTimeVisibleForCurrentMode();
    const showW = isDashboardWeatherVisibleForCurrentMode();
    if (timeWrap) timeWrap.style.display = showT ? '' : 'none';
    if (weatherWrap) weatherWrap.style.display = showW ? '' : 'none';
    if (toolbarUpd) toolbarUpd.style.display = monitorMode && !showT ? 'none' : '';
}
const UPDATE_NOTICE_STORAGE_KEY = 'update_notice_seen_version';
let updateCheckPromise = null;
let latestUpdateInfo = null;
let backendRecoveryWatchTimer = null;
let backendWasUnavailable = false;
let backendRecoveryReloadDone = false;
let lastClusterData = null;   // for monitor view (Proxmox)
let lastTrueNASData = null;   // { system, pools } for monitor view (TrueNAS)
let lastHostMetricsData = null; // { configured, items } for Proxmox host metrics
let hostNodeMetricCharts = { temp: null, cpu: null, mem: null };
let clusterAggregateMetricCharts = { cpu: null, mem: null };
let clusterAggregateChartsAutoRefreshTimer = null;
let clusterAggregateChartsAutoRefreshBusy = false;
let upsMetricsChart = null;
let upsMetricsModalAutoRefreshTimer = null;
let upsMetricsModalAutoRefreshBusy = false;
let upsMetricsModalSlot = null;
let upsMetricsModalMetricId = null;
let upsMetricsModalMetricFormat = null;
let hostNodeMetricsModalNodeName = '';
let hostNodeMetricsModalWindowMin = 1440;
let clusterAggregateMetricsModalWindowMin = 1440;
let upsMetricsModalWindowMin = 1440;
let smartSensorsMetricsChart = null;
let smartSensorsMetricsModalAutoRefreshTimer = null;
let smartSensorsMetricsModalAutoRefreshBusy = false;
let smartSensorsMetricsModalSensorId = null;
let smartSensorsMetricsModalFieldKey = null;
let smartSensorsMetricsModalWindowMin = 1440;
const webBleSensorSessions = new Map(); // sensorId -> { device, service, characteristicMap: Map<uuid, BluetoothRemoteGATTCharacteristic> }
let lastTrueNASOverviewData = null;
let hostMetricsSettings = { pollIntervalSec: 10, timeoutMs: 3000, cacheTtlSec: 8, criticalTempC: 85, criticalLinkSpeedMbps: 1000 };
let hostMetricsConfigs = {}; // connectionId -> { nodes: { [node]: { enabled, agentPort, agentPath, cpuTempSensor, linkInterface, ipmiHost, ipmiPort } } }
let hostMetricsDiscoveryItems = [];
let hostMetricsAgentInstallPlanCache = null;
let lastHostMetricsAgentModalNodeName = '';
let activeIconPicker = { kind: null, targetId: null, scope: 'all' };

const ICON_PICKER_ITEMS = [
    { icon: 'simple-icons:ubuntu', label: 'Ubuntu', tags: ['linux', 'os', 'vm'] },
    { icon: 'simple-icons:debian', label: 'Debian', tags: ['linux', 'os', 'vm'] },
    { icon: 'simple-icons:archlinux', label: 'Arch Linux', tags: ['linux', 'os', 'vm'] },
    { icon: 'simple-icons:fedora', label: 'Fedora', tags: ['linux', 'os', 'vm'] },
    { icon: 'simple-icons:alpinelinux', label: 'Alpine Linux', tags: ['linux', 'os', 'vm', 'container'] },
    { icon: 'simple-icons:centos', label: 'CentOS', tags: ['linux', 'os', 'vm'] },
    { icon: 'simple-icons:redhat', label: 'Red Hat', tags: ['linux', 'os', 'vm'] },
    { icon: 'simple-icons:opensuse', label: 'openSUSE', tags: ['linux', 'os', 'vm'] },
    { icon: 'simple-icons:linux', label: 'Linux', tags: ['linux', 'os', 'vm', 'service'] },
    { icon: 'simple-icons:windows', label: 'Windows', tags: ['windows', 'os', 'vm'] },
    { icon: 'simple-icons:apple', label: 'Apple', tags: ['macos', 'os', 'vm'] },
    { icon: 'simple-icons:docker', label: 'Docker', tags: ['container', 'service', 'vm'] },
    { icon: 'simple-icons:kubernetes', label: 'Kubernetes', tags: ['container', 'service'] },
    { icon: 'simple-icons:portainer', label: 'Portainer', tags: ['container', 'service'] },
    { icon: 'simple-icons:proxmox', label: 'Proxmox', tags: ['virtualization', 'vm'] },
    { icon: 'simple-icons:truenas', label: 'TrueNAS', tags: ['storage', 'nas', 'service', 'vm'] },
    { icon: 'simple-icons:openmediavault', label: 'OpenMediaVault', tags: ['storage', 'nas', 'service', 'vm'] },
    { icon: 'simple-icons:nginx', label: 'NGINX', tags: ['web', 'proxy', 'service'] },
    { icon: 'simple-icons:apache', label: 'Apache', tags: ['web', 'service'] },
    { icon: 'simple-icons:traefikproxy', label: 'Traefik', tags: ['proxy', 'service'] },
    { icon: 'simple-icons:caddy', label: 'Caddy', tags: ['proxy', 'service'] },
    { icon: 'simple-icons:cloudflare', label: 'Cloudflare', tags: ['dns', 'proxy', 'service'] },
    { icon: 'simple-icons:wireguard', label: 'WireGuard', tags: ['vpn', 'network', 'service'] },
    { icon: 'simple-icons:openvpn', label: 'OpenVPN', tags: ['vpn', 'network', 'service'] },
    { icon: 'simple-icons:tailscale', label: 'Tailscale', tags: ['vpn', 'network', 'service'] },
    { icon: 'simple-icons:postgresql', label: 'PostgreSQL', tags: ['database', 'service'] },
    { icon: 'simple-icons:mysql', label: 'MySQL', tags: ['database', 'service'] },
    { icon: 'simple-icons:mariadb', label: 'MariaDB', tags: ['database', 'service'] },
    { icon: 'simple-icons:redis', label: 'Redis', tags: ['database', 'cache', 'service'] },
    { icon: 'simple-icons:mongodb', label: 'MongoDB', tags: ['database', 'service'] },
    { icon: 'simple-icons:elasticsearch', label: 'Elasticsearch', tags: ['database', 'service'] },
    { icon: 'simple-icons:influxdb', label: 'InfluxDB', tags: ['database', 'metrics', 'service'] },
    { icon: 'simple-icons:prometheus', label: 'Prometheus', tags: ['metrics', 'service'] },
    { icon: 'simple-icons:grafana', label: 'Grafana', tags: ['metrics', 'service'] },
    { icon: 'simple-icons:loki', label: 'Loki', tags: ['logs', 'service'] },
    { icon: 'simple-icons:clickhouse', label: 'ClickHouse', tags: ['database', 'service'] },
    { icon: 'simple-icons:rabbitmq', label: 'RabbitMQ', tags: ['queue', 'service'] },
    { icon: 'simple-icons:apachekafka', label: 'Kafka', tags: ['queue', 'service'] },
    { icon: 'simple-icons:gitlab', label: 'GitLab', tags: ['git', 'service'] },
    { icon: 'simple-icons:github', label: 'GitHub', tags: ['git', 'service'] },
    { icon: 'simple-icons:gitea', label: 'Gitea', tags: ['git', 'service'] },
    { icon: 'simple-icons:jenkins', label: 'Jenkins', tags: ['ci', 'service'] },
    { icon: 'simple-icons:ansible', label: 'Ansible', tags: ['automation', 'service'] },
    { icon: 'simple-icons:terraform', label: 'Terraform', tags: ['automation', 'service'] },
    { icon: 'simple-icons:node-dot-js', label: 'Node.js', tags: ['runtime', 'service', 'vm'] },
    { icon: 'simple-icons:python', label: 'Python', tags: ['runtime', 'service', 'vm'] },
    { icon: 'simple-icons:java', label: 'Java', tags: ['runtime', 'service', 'vm'] },
    { icon: 'simple-icons:dotnet', label: '.NET', tags: ['runtime', 'service', 'vm'] },
    { icon: 'simple-icons:php', label: 'PHP', tags: ['runtime', 'service', 'vm'] },
    { icon: 'simple-icons:go', label: 'Go', tags: ['runtime', 'service', 'vm'] },
    { icon: 'simple-icons:rust', label: 'Rust', tags: ['runtime', 'service', 'vm'] },
    { icon: 'simple-icons:react', label: 'React', tags: ['frontend', 'service'] },
    { icon: 'simple-icons:vuedotjs', label: 'Vue', tags: ['frontend', 'service'] },
    { icon: 'simple-icons:angular', label: 'Angular', tags: ['frontend', 'service'] },
    { icon: 'simple-icons:nextdotjs', label: 'Next.js', tags: ['frontend', 'service'] },
    { icon: 'simple-icons:homeassistant', label: 'Home Assistant', tags: ['homelab', 'service'] },
    { icon: 'simple-icons:plex', label: 'Plex', tags: ['media', 'service'] },
    { icon: 'simple-icons:jellyfin', label: 'Jellyfin', tags: ['media', 'service'] },
    { icon: 'simple-icons:adguard', label: 'AdGuard', tags: ['dns', 'service'] },
    { icon: 'simple-icons:pihole', label: 'Pi-hole', tags: ['dns', 'service'] },
    { icon: 'simple-icons:vaultwarden', label: 'Vaultwarden', tags: ['security', 'service'] },
    { icon: 'simple-icons:bitwarden', label: 'Bitwarden', tags: ['security', 'service'] },
    { icon: 'simple-icons:paperlessngx', label: 'Paperless-ngx', tags: ['docs', 'service'] },
    { icon: 'simple-icons:immich', label: 'Immich', tags: ['photos', 'service'] },
    { icon: 'mdi:virtual-machine', label: 'Virtual Machine', tags: ['vm', 'virtualization'] },
    { icon: 'mdi:nas', label: 'NAS', tags: ['storage', 'nas', 'vm', 'service'] },
    { icon: 'carbon:container-software', label: 'Container', tags: ['container', 'vm', 'service'] },
    { icon: 'mdi:server-network', label: 'Network Service', tags: ['network', 'service'] },
    { icon: 'mdi:web', label: 'Web Service', tags: ['web', 'service'] },
    { icon: 'mdi:database', label: 'Database', tags: ['database', 'service'] }
];

function el(id) {
    return document.getElementById(id);
}

function setText(id, value) {
    const e = el(id);
    if (e) e.textContent = value;
}

function setHTML(id, value) {
    const e = el(id);
    if (e) e.innerHTML = value;
}

function setHTMLIfChanged(id, value) {
    const v = String(value);
    if (htmlCache[id] === v) return;
    htmlCache[id] = v;
    setHTML(id, v);
}

function setValue(id, value) {
    const e = el(id);
    if (e) e.value = value;
}

function setPlaceholder(id, value) {
    const e = el(id);
    if (e && 'placeholder' in e) e.placeholder = value;
}

function localizeRefreshIntervalSelect() {
    const sel = document.getElementById('refreshIntervalSelect');
    if (!sel) return;
    const map = {
        5000: 'refreshInterval5s',
        10000: 'refreshInterval10s',
        30000: 'refreshInterval30s',
        60000: 'refreshInterval1m'
    };
    for (let i = 0; i < sel.options.length; i++) {
        const o = sel.options[i];
        const k = map[Number(o.value)];
        if (k) o.textContent = t(k);
    }
}

function localizeYesNoSelect(selectId) {
    const sel = document.getElementById(selectId);
    if (!sel || sel.options.length < 2) return;
    sel.options[0].textContent = t('optionNo');
    sel.options[1].textContent = t('optionYes');
}

function localizeServiceTypeSelect() {
    const sel = document.getElementById('settingsServiceTypeSelect');
    if (!sel) return;
    const map = { tcp: 'TCP', udp: 'UDP', http: 'HTTP(S)', snmp: 'SNMP', nut: t('serviceTypeNut') };
    for (let i = 0; i < sel.options.length; i++) {
        const o = sel.options[i];
        if (map[o.value]) o.textContent = map[o.value];
    }
}

function localizeUpsTypeSelect() {
    const sel = document.getElementById('upsTypeSelect');
    if (!sel) return;
    for (let i = 0; i < sel.options.length; i++) {
        const o = sel.options[i];
        if (o.value === 'nut') o.textContent = t('serviceTypeNut');
        if (o.value === 'snmp') o.textContent = 'SNMP';
    }
}

function syncSettingsConnectionStatusText() {
    ['Proxmox', 'TrueNAS'].forEach((suf) => {
        const tel = document.getElementById('connectionStatusText' + suf);
        const badge = document.getElementById('connectionStatusBadge' + suf);
        if (!tel || !badge) return;
        if (badge.classList.contains('bg-success')) {
            tel.textContent = t('connectionStatusConnected');
        } else {
            tel.textContent = t('connectionStatusDisconnected');
        }
    });
}

function escapeHtml(s) {
    if (s == null) return '';
    const t = String(s);
    return t.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function escapeForIframeSrcdocAttr(html) {
    return String(html)
        .replace(/&/g, '&amp;')
        .replace(/"/g, '&quot;');
}

function sanitizeEmbedImageUrl(raw) {
    const s = String(raw || '').trim();
    if (!s) return null;
    if (s.length > CLUSTER_EMBED_IMAGE_DATA_URL_MAX) return null;
    try {
        if (/^https?:\/\//i.test(s)) {
            const u = new URL(s);
            if (u.protocol !== 'http:' && u.protocol !== 'https:') return null;
            return u.href;
        }
        if (/^data:image\/(png|jpeg|jpg|gif|webp);base64,/i.test(s)) {
            return s;
        }
    } catch (_) {}
    return null;
}

function setBackendOfflineBannerVisible(visible) {
    const banner = document.getElementById('backendOfflineBanner');
    if (!banner) return;
    banner.classList.toggle('d-none', !visible);
}

function getSeenUpdateVersion() {
    try {
        return localStorage.getItem(UPDATE_NOTICE_STORAGE_KEY) || '';
    } catch (_) {
        return '';
    }
}

function markUpdateVersionAsSeen(version) {
    try {
        localStorage.setItem(UPDATE_NOTICE_STORAGE_KEY, String(version || ''));
    } catch (_) {}
}

function renderFooterUpdateStatus() {
    const el = document.getElementById('footerUpdateStatus');
    if (el) {
        if (!latestUpdateInfo) {
            el.textContent = t('statusDash') || '—';
        } else if (latestUpdateInfo.error) {
            el.textContent = t('updateStatusCheckFailed') || 'Update check failed';
        } else if (latestUpdateInfo.updateAvailable && latestUpdateInfo.latestVersion) {
            const label = tParams('updateStatusAvailableShort', { latest: latestUpdateInfo.latestVersion });
            const url = latestUpdateInfo.releaseUrl || latestUpdateInfo.repoUrl || '';
            el.innerHTML = url
                ? `<a href="${escapeHtml(url)}" target="_blank" rel="noopener noreferrer">${escapeHtml(label)}</a>`
                : escapeHtml(label);
        } else if (latestUpdateInfo.latestVersion) {
            el.textContent = tParams('updateStatusCurrentShort', { version: latestUpdateInfo.latestVersion });
        } else {
            el.textContent = t('statusDash') || '—';
        }
    }
    renderAppUpdateActionButtons();
}

const UPDATE_APPLY_ERROR_I18N = {
    update_apply_disabled: 'updateApplyErrorDisabled',
    update_apply_not_configured: 'updateApplyErrorNotConfigured',
    update_apply_password_required: 'updateApplyErrorPasswordRequired',
    update_apply_token_required: 'updateApplyErrorTokenRequired',
    update_apply_invalid_token: 'updateApplyErrorInvalidToken',
    update_apply_unauthorized: 'updateApplyErrorUnauthorized',
    update_apply_not_git_repo: 'updateApplyErrorNotGit',
    update_apply_already_up_to_date: 'updateApplyErrorUpToDate',
    update_apply_working_tree_dirty: 'updateApplyErrorDirty',
    update_apply_git_status_failed: 'updateApplyErrorGitStatus',
    update_apply_command_failed: 'updateApplyErrorCommand',
    failed_to_check_updates: 'updateStatusCheckFailed'
};

function translateUpdateApplyError(code, detail) {
    const k = code && UPDATE_APPLY_ERROR_I18N[code];
    let msg = k ? t(k) : (code ? String(code) : t('updateApplyErrorGeneric'));
    if (detail && code === 'update_apply_command_failed') {
        msg += ': ' + detail;
    }
    return msg;
}

function localizeAppUpdateApplyModal() {
    setText('appUpdateApplyModalTitleText', t('updateApplyModalTitle'));
    setText('appUpdateApplyPasswordLabel', t('settingsPasswordCurrentLabel') || t('settingsUnlockPasswordLabel') || 'Password');
    setText('appUpdateApplyTokenLabel', t('updateApplyTokenLabel'));
    setText('appUpdateApplyCancelText', t('updateApplyCancel'));
    setText('appUpdateApplySubmitText', t('updateApplySubmit'));
    const closeBtn = document.getElementById('appUpdateApplyModalCloseBtn');
    if (closeBtn) closeBtn.setAttribute('aria-label', t('ariaClose'));
}

function showAppUpdateApplyModalPromise(meta) {
    return new Promise((resolve) => {
        const modalEl = document.getElementById('appUpdateApplyModal');
        if (!modalEl || typeof bootstrap === 'undefined' || !bootstrap.Modal) {
            resolve(null);
            return;
        }

        const pwdWrap = document.getElementById('appUpdateApplyPasswordWrap');
        const tokWrap = document.getElementById('appUpdateApplyTokenWrap');
        const pwdIn = document.getElementById('appUpdateApplyPassword');
        const tokIn = document.getElementById('appUpdateApplyToken');
        const errEl = document.getElementById('appUpdateApplyError');
        const hint = document.getElementById('appUpdateApplyModalHint');
        const submitBtn = document.getElementById('appUpdateApplySubmitBtn');

        if (pwdIn) pwdIn.value = '';
        if (tokIn) tokIn.value = '';
        if (errEl) {
            errEl.textContent = '';
            errEl.style.display = 'none';
        }

        const hasP = !!meta.hasSettingsPassword;
        const hasT = !!meta.hasApplyToken;
        if (pwdWrap) pwdWrap.style.display = hasP ? '' : 'none';
        if (tokWrap) tokWrap.style.display = hasT ? '' : 'none';
        if (hint) {
            hint.textContent = tParams('updateApplyModalHint', {
                latest: meta.latestVersion || '—',
                current: meta.currentVersion != null ? String(meta.currentVersion) : '—'
            });
        }

        let done = false;
        const finish = (v) => {
            if (done) return;
            done = true;
            resolve(v);
        };

        const modal = bootstrap.Modal.getOrCreateInstance(modalEl);

        const onSubmit = () => {
            const password = hasP && pwdIn ? String(pwdIn.value || '') : '';
            const applyToken = hasT && tokIn ? String(tokIn.value || '') : '';
            if (hasP && hasT && !password && !applyToken) {
                if (errEl) {
                    errEl.textContent = t('updateApplyErrorAuthOneRequired');
                    errEl.style.display = 'block';
                }
                return;
            }
            if (hasP && !hasT && !password) {
                if (errEl) {
                    errEl.textContent = t('updateApplyErrorPasswordRequired');
                    errEl.style.display = 'block';
                }
                return;
            }
            if (!hasP && hasT && !applyToken) {
                if (errEl) {
                    errEl.textContent = t('updateApplyErrorTokenRequired');
                    errEl.style.display = 'block';
                }
                return;
            }
            finish({ password, applyToken });
            modal.hide();
        };

        const onSubmitClick = (ev) => {
            ev.preventDefault();
            onSubmit();
        };

        if (submitBtn) submitBtn.addEventListener('click', onSubmitClick);

        modalEl.addEventListener('hidden.bs.modal', () => {
            if (submitBtn) submitBtn.removeEventListener('click', onSubmitClick);
            finish(null);
        }, { once: true });
        modal.show();
    });
}

function openLatestAppRelease() {
    void runAppUpdateOrOpenRelease();
}

async function runAppUpdateOrOpenRelease() {
    const priorReleaseUrl = latestUpdateInfo && !latestUpdateInfo.error
        ? (latestUpdateInfo.releaseUrl || latestUpdateInfo.repoUrl || '')
        : '';

    try {
        await checkForAppUpdates(true, { refresh: true, silent: true, manual: false });
        const meta = latestUpdateInfo;
        const releaseOpenUrl = meta && !meta.error
            ? (meta.releaseUrl || meta.repoUrl || priorReleaseUrl)
            : priorReleaseUrl;
        if (!meta || meta.error) {
            if (releaseOpenUrl) window.open(releaseOpenUrl, '_blank', 'noopener,noreferrer');
            showToast(t('updateStatusCheckFailed') || 'Update check failed', 'error');
            return;
        }

        if (meta.applyEnabled && meta.canApply && meta.updateAvailable && meta.latestVersion) {
            localizeAppUpdateApplyModal();
            const creds = await showAppUpdateApplyModalPromise(meta);
            if (!creds) return;

            const submitBtn = document.getElementById('appUpdateApplySubmitBtn');
            if (submitBtn) submitBtn.disabled = true;
            try {
                const resp = await fetch('/api/updates/apply', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    credentials: 'same-origin',
                    body: JSON.stringify({
                        password: creds.password || '',
                        applyToken: creds.applyToken || ''
                    })
                });
                const data = await resp.json().catch(() => ({}));
                if (!resp.ok) {
                    showToast(translateUpdateApplyError(data.error, data.detail), 'error');
                    return;
                }
                showToast(t('updateApplySuccess') || 'Updated. Reloading…', 'success');
                setTimeout(() => { window.location.reload(); }, 2500);
            } finally {
                if (submitBtn) submitBtn.disabled = false;
            }
            return;
        }

        if (releaseOpenUrl) window.open(releaseOpenUrl, '_blank', 'noopener,noreferrer');
        if (meta.applyEnabled && !meta.canApply) {
            showToast(t('updateApplyErrorNotConfigured'), 'warning');
        }
    } catch (e) {
        console.warn('runAppUpdateOrOpenRelease', e);
        const u = latestUpdateInfo && !latestUpdateInfo.error
            ? (latestUpdateInfo.releaseUrl || latestUpdateInfo.repoUrl || '')
            : priorReleaseUrl;
        if (u) window.open(u, '_blank', 'noopener,noreferrer');
        showToast(e.message || t('updateApplyErrorGeneric'), 'error');
    }
}

function renderAppUpdateActionButtons() {
    const topBtn = document.getElementById('topbarUpdateAvailableBtn');
    const monBtn = document.getElementById('monitorToolbarUpdateReleaseBtn');
    const url = latestUpdateInfo && !latestUpdateInfo.error
        ? (latestUpdateInfo.releaseUrl || latestUpdateInfo.repoUrl || '')
        : '';
    const show = !!(latestUpdateInfo && !latestUpdateInfo.error && latestUpdateInfo.updateAvailable
        && latestUpdateInfo.latestVersion && url);
    const label = t('updateAvailableButton') || 'Update';
    const title = (latestUpdateInfo && latestUpdateInfo.latestVersion)
        ? tParams('updateAvailableButtonTitle', {
            latest: latestUpdateInfo.latestVersion,
            current: String(latestUpdateInfo.currentVersion || '').trim() || '—'
        })
        : label;

    if (topBtn) {
        if (!show) {
            topBtn.style.display = 'none';
            topBtn.setAttribute('aria-hidden', 'true');
        } else {
            topBtn.style.display = 'inline-flex';
            topBtn.removeAttribute('aria-hidden');
            topBtn.title = title;
            topBtn.setAttribute('aria-label', title);
            const lab = topBtn.querySelector('.js-topbar-update-label');
            if (lab) lab.textContent = label;
        }
    }
    if (monBtn) {
        if (!show) {
            monBtn.style.display = 'none';
            monBtn.setAttribute('aria-hidden', 'true');
        } else {
            monBtn.style.display = 'inline-flex';
            monBtn.removeAttribute('aria-hidden');
            monBtn.title = title;
            monBtn.setAttribute('aria-label', title);
        }
    }
}

function normalizeDashboardWeatherCity(value) {
    return String(value || '').trim();
}

function normalizeDashboardWeatherProvider(value) {
    const s = String(value || '').trim().toLowerCase().replace(/-/g, '_');
    const allowed = ['open_meteo', 'openweathermap', 'yandex', 'gismeteo'];
    return allowed.includes(s) ? s : 'open_meteo';
}

function isValidDashboardTimezone(value) {
    const tz = String(value || '').trim();
    if (!tz) return false;
    try {
        Intl.DateTimeFormat('en-US', { timeZone: tz }).format(new Date());
        return true;
    } catch (_) {
        return false;
    }
}

function normalizeDashboardTimezone(value) {
    const tz = String(value || '').trim();
    if (!tz) return DEFAULT_DASHBOARD_TIMEZONE;
    return isValidDashboardTimezone(tz) ? tz : DEFAULT_DASHBOARD_TIMEZONE;
}

function resetDashboardWeatherState() {
    dashboardWeatherData = null;
    dashboardWeatherDisplayName = '';
    dashboardWeatherError = '';
    dashboardWeatherLastFetchMs = 0;
    dashboardWeatherFetchPromise = null;
}

function getDashboardDateLocale() {
    return currentLanguage === 'ru' ? 'ru-RU' : 'en-US';
}

function getDashboardWeatherIconClass(weatherCode, isDay) {
    const code = Number(weatherCode);
    if (code === 0) return isDay ? 'bi-brightness-high' : 'bi-moon-stars';
    if (code === 1 || code === 2) return isDay ? 'bi-cloud-sun' : 'bi-cloud-moon';
    if (code === 3) return 'bi-cloud';
    if (code === 45 || code === 48) return 'bi-cloud-fog2';
    if ([51, 53, 55, 56, 57, 61, 63, 65, 66, 67, 80, 81, 82].includes(code)) return 'bi-cloud-rain';
    if ([71, 73, 75, 77, 85, 86].includes(code)) return 'bi-cloud-snow';
    if ([95, 96, 99].includes(code)) return 'bi-cloud-lightning-rain';
    return 'bi-cloud';
}

function formatDashboardTemperature(value) {
    const num = Number(value);
    if (!Number.isFinite(num)) return t('notApplicable') || 'N/A';
    const rounded = Math.round(num);
    return `${rounded > 0 ? '+' : ''}${rounded}°C`;
}

function renderDashboardTimeWeatherCard() {
    const timeValueEl = el('dashboardTimeValue');
    const timeMetaEl = el('dashboardTimeMeta');
    const temperatureValueEl = el('dashboardTemperatureValue');
    const temperatureMetaEl = el('dashboardTemperatureMeta');
    if (!timeValueEl || !timeMetaEl || !temperatureValueEl || !temperatureMetaEl) return;

    let timeText = '--:--';
    let dateText = '--';
    try {
        const now = new Date();
        timeText = new Intl.DateTimeFormat(getDashboardDateLocale(), {
            timeZone: dashboardTimezone,
            hour: '2-digit',
            minute: '2-digit',
            hour12: false
        }).format(now);
        dateText = new Intl.DateTimeFormat(getDashboardDateLocale(), {
            timeZone: dashboardTimezone,
            day: '2-digit',
            month: 'short'
        }).format(now);
    } catch (_) {}

    let weatherValue = escapeHtml(t('dashboardWeatherUnavailable') || 'Weather unavailable');
    const metaLine =
        dashboardWeatherDisplayName ||
        (dashboardWeatherCity ? dashboardWeatherCity : '');
    const cityValue = metaLine
        ? escapeHtml(metaLine)
        : escapeHtml(t('dashboardWeatherCityMissing') || 'Set a city in settings');

    if (dashboardWeatherCity) {
        if (dashboardWeatherData && Number.isFinite(Number(dashboardWeatherData.temperature))) {
            const iconClass = getDashboardWeatherIconClass(dashboardWeatherData.weatherCode, dashboardWeatherData.isDay);
            weatherValue = `<i class="bi ${iconClass} me-1"></i>${escapeHtml(formatDashboardTemperature(dashboardWeatherData.temperature))}`;
        } else if (dashboardWeatherFetchPromise) {
            weatherValue = `<i class="bi bi-cloud-download me-1"></i>${escapeHtml(t('loading'))}`;
        } else if (dashboardWeatherError) {
            weatherValue = `<i class="bi bi-cloud-slash me-1"></i>${escapeHtml(t('dashboardWeatherUnavailable') || 'Weather unavailable')}`;
        } else {
            weatherValue = `<i class="bi bi-cloud me-1"></i>${escapeHtml(t('loading'))}`;
        }
    } else {
        weatherValue = `<i class="bi bi-geo-alt me-1"></i>${escapeHtml(t('dashboardWeatherCityMissing') || 'Set a city in settings')}`;
    }

    setText('dashboardTimeValue', timeText);
    setHTMLIfChanged('dashboardTimeMeta', dateText);
    timeMetaEl.style.display = '';

    setHTMLIfChanged('dashboardTemperatureValue', weatherValue);
    setHTMLIfChanged('dashboardTemperatureMeta', cityValue);
    temperatureMetaEl.style.display = '';
    applyDashboardTimeWeatherVisibility();
}

async function refreshDashboardWeather(force = false) {
    const requestedCity = normalizeDashboardWeatherCity(dashboardWeatherCity);
    if (!requestedCity) {
        resetDashboardWeatherState();
        renderDashboardTimeWeatherCard();
        return null;
    }

    if (!force && !isDashboardWeatherVisibleForCurrentMode()) {
        renderDashboardTimeWeatherCard();
        return null;
    }

    const requestedProvider = dashboardWeatherProvider;
    const now = Date.now();
    if (!force && dashboardWeatherFetchPromise) return dashboardWeatherFetchPromise;
    if (!force && dashboardWeatherLastFetchMs && (now - dashboardWeatherLastFetchMs) < DASHBOARD_WEATHER_REFRESH_MS) {
        renderDashboardTimeWeatherCard();
        return dashboardWeatherData;
    }

    dashboardWeatherError = '';
    let requestPromise = null;
    requestPromise = (async () => {
        try {
            const lang = currentLanguage === 'ru' ? 'ru' : 'en';
            const qs = new URLSearchParams({ city: requestedCity, lang });
            const weatherRes = await fetch(`/api/weather/dashboard?${qs.toString()}`);
            const j = await weatherRes.json().catch(() => ({}));
            if (!j || j.success !== true) {
                throw new Error(j?.error || t('dashboardWeatherUnavailable') || 'Weather unavailable');
            }
            if (requestedCity !== dashboardWeatherCity || requestedProvider !== dashboardWeatherProvider) return null;

            dashboardWeatherData = {
                temperature: Number(j.temperature),
                weatherCode: Number(j.weatherCode),
                isDay: !!j.isDay
            };
            dashboardWeatherDisplayName = j.displayName ? String(j.displayName) : '';
            dashboardWeatherError = '';
            dashboardWeatherLastFetchMs = Date.now();
            return dashboardWeatherData;
        } catch (error) {
            if (requestedCity === dashboardWeatherCity && requestedProvider === dashboardWeatherProvider) {
                dashboardWeatherData = null;
                dashboardWeatherDisplayName = '';
                dashboardWeatherError = error?.message || 'Weather unavailable';
                dashboardWeatherLastFetchMs = Date.now();
            }
            console.warn('Failed to load dashboard weather:', error);
            return null;
        } finally {
            if (dashboardWeatherFetchPromise === requestPromise) {
                dashboardWeatherFetchPromise = null;
            }
            renderDashboardTimeWeatherCard();
        }
    })();

    dashboardWeatherFetchPromise = requestPromise;
    renderDashboardTimeWeatherCard();
    return requestPromise;
}

function startDashboardClockTimer() {
    renderDashboardTimeWeatherCard();
    if (dashboardClockInterval) clearInterval(dashboardClockInterval);
    dashboardClockInterval = setInterval(() => {
        renderDashboardTimeWeatherCard();
        if (dashboardWeatherCity && !dashboardWeatherFetchPromise && isDashboardWeatherVisibleForCurrentMode()) {
            const ageMs = Date.now() - dashboardWeatherLastFetchMs;
            if (!dashboardWeatherLastFetchMs || ageMs >= DASHBOARD_WEATHER_REFRESH_MS) {
                refreshDashboardWeather().catch(() => {});
            }
        }
    }, 1000);
}

function onDashboardWeatherProviderChange() {
    dashboardTimeWeatherSettingsManager.applyProviderUI();
}

async function saveDashboardTimeWeatherSettings() {
    await dashboardTimeWeatherSettingsManager.saveSettings();
}

function renderInlineMarkdown(text) {
    const placeholders = [];
    const withPlaceholders = String(text || '').replace(/`([^`]+)`/g, (_, code) => {
        const token = `__MD_CODE_${placeholders.length}__`;
        placeholders.push(`<code>${escapeHtml(code)}</code>`);
        return token;
    });

    let html = escapeHtml(withPlaceholders)
        .replace(/\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)/g, (_m, label, url) => `<a href="${escapeHtml(url)}" target="_blank" rel="noopener noreferrer">${escapeHtml(label)}</a>`)
        .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
        .replace(/__([^_]+)__/g, '<strong>$1</strong>')
        .replace(/(^|[^\w])\*([^*]+)\*(?!\w)/g, '$1<em>$2</em>')
        .replace(/(^|[^\w])_([^_]+)_(?!\w)/g, '$1<em>$2</em>');

    placeholders.forEach((value, idx) => {
        html = html.replace(`__MD_CODE_${idx}__`, value);
    });

    return html;
}

function renderMarkdownToHtml(markdown) {
    const lines = String(markdown || '').replace(/\r\n/g, '\n').split('\n');
    const blocks = [];
    let paragraph = [];
    let listItems = [];
    let listType = null;
    let inCodeBlock = false;
    let codeLines = [];

    const flushParagraph = () => {
        if (!paragraph.length) return;
        const text = paragraph.join(' ').trim();
        if (text) blocks.push(`<p>${renderInlineMarkdown(text)}</p>`);
        paragraph = [];
    };

    const flushList = () => {
        if (!listItems.length || !listType) return;
        blocks.push(`<${listType}>${listItems.map((item) => `<li>${renderInlineMarkdown(item)}</li>`).join('')}</${listType}>`);
        listItems = [];
        listType = null;
    };

    const flushCode = () => {
        if (!inCodeBlock) return;
        blocks.push(`<pre class="mb-3"><code>${escapeHtml(codeLines.join('\n'))}</code></pre>`);
        codeLines = [];
        inCodeBlock = false;
    };

    lines.forEach((line) => {
        if (line.trim().startsWith('```')) {
            flushParagraph();
            flushList();
            if (inCodeBlock) {
                flushCode();
            } else {
                inCodeBlock = true;
                codeLines = [];
            }
            return;
        }

        if (inCodeBlock) {
            codeLines.push(line);
            return;
        }

        const trimmed = line.trim();
        if (!trimmed) {
            flushParagraph();
            flushList();
            return;
        }

        const headingMatch = trimmed.match(/^(#{1,6})\s+(.*)$/);
        if (headingMatch) {
            flushParagraph();
            flushList();
            const level = headingMatch[1].length;
            blocks.push(`<h${level}>${renderInlineMarkdown(headingMatch[2])}</h${level}>`);
            return;
        }

        const unorderedMatch = trimmed.match(/^[-*+]\s+(.*)$/);
        if (unorderedMatch) {
            flushParagraph();
            if (listType && listType !== 'ul') flushList();
            listType = 'ul';
            listItems.push(unorderedMatch[1]);
            return;
        }

        const orderedMatch = trimmed.match(/^\d+\.\s+(.*)$/);
        if (orderedMatch) {
            flushParagraph();
            if (listType && listType !== 'ol') flushList();
            listType = 'ol';
            listItems.push(orderedMatch[1]);
            return;
        }

        if (trimmed === '---') {
            flushParagraph();
            flushList();
            blocks.push('<hr>');
            return;
        }

        flushList();
        paragraph.push(trimmed);
    });

    flushParagraph();
    flushList();
    flushCode();

    return blocks.join('');
}

async function loadAboutContent() {
    const container = document.getElementById('settingsAboutContent');
    if (!container) return;

    container.innerHTML = `<div class="text-muted">${escapeHtml(t('settingsAboutLoading') || 'Loading...')}</div>`;

    try {
        const response = await fetch('/api/about');
        const data = await response.json().catch(() => ({}));
        if (!response.ok) {
            const message = response.status === 404
                ? (t('settingsAboutMissing') || 'about.md not found.')
                : ((data && data.error) ? data.error : (t('errorLoadingData') || 'Failed to load data'));
            container.innerHTML = `<div class="text-muted">${escapeHtml(message)}</div>`;
            return;
        }

        const markdown = typeof data.markdown === 'string' ? data.markdown : '';
        container.innerHTML = renderMarkdownToHtml(markdown);
    } catch (error) {
        container.innerHTML = `<div class="text-danger">${escapeHtml((error && error.message) ? error.message : String(error))}</div>`;
    }
}

function normalizeVmIconName(value) {
    const icon = String(value || '').trim();
    if (!icon) return '';
    return icon.slice(0, 128);
}

function normalizeMonitorVmIconsMap(value) {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
    const out = {};
    for (const [key, raw] of Object.entries(value)) {
        const id = Number(key);
        const icon = normalizeVmIconName(raw);
        if (!Number.isNaN(id) && icon) out[String(id)] = icon;
    }
    return out;
}

function normalizeMonitorServiceIconsMap(value) {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
    const out = {};
    for (const [key, raw] of Object.entries(value)) {
        const id = Number(key);
        const icon = normalizeVmIconName(raw);
        if (!Number.isNaN(id) && icon) out[String(id)] = icon;
    }
    return out;
}

/** Дефолтный акцент для иконок монитора (как значение color input в настройках). */
const DEFAULT_MONITOR_ICON_TINT = '#667eea';

function normalizeHexColor(value) {
    const color = String(value || '').trim();
    if (/^#[0-9a-fA-F]{6}$/.test(color)) return color.toLowerCase();
    if (/^#[0-9a-fA-F]{3}$/.test(color)) {
        const c = color.slice(1).toLowerCase();
        return '#' + c[0] + c[0] + c[1] + c[1] + c[2] + c[2];
    }
    return '';
}

/** Цвет глифа на фоне bgHex: чёрный или белый для читаемости. */
function getContrastForegroundForBg(hexBg) {
    const hex = normalizeHexColor(hexBg) || DEFAULT_MONITOR_ICON_TINT;
    const c = hex.slice(1);
    const r = parseInt(c.slice(0, 2), 16);
    const g = parseInt(c.slice(2, 4), 16);
    const b = parseInt(c.slice(4, 6), 16);
    const luminance = (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255;
    return luminance > 0.55 ? '#000000' : '#ffffff';
}

/** Случайный насыщенный цвет #rrggbb для тинта иконки (HSL → RGB). */
function randomMonitorIconHexColor() {
    const h = Math.random() * 360;
    const s = 0.5 + Math.random() * 0.45;
    const l = 0.4 + Math.random() * 0.22;
    const c = (1 - Math.abs(2 * l - 1)) * s;
    const x = c * (1 - Math.abs(((h / 60) % 2) - 1));
    const m = l - c / 2;
    let r = 0;
    let g = 0;
    let b = 0;
    if (h < 60) {
        r = c; g = x; b = 0;
    } else if (h < 120) {
        r = x; g = c; b = 0;
    } else if (h < 180) {
        r = 0; g = c; b = x;
    } else if (h < 240) {
        r = 0; g = x; b = c;
    } else if (h < 300) {
        r = x; g = 0; b = c;
    } else {
        r = c; g = 0; b = x;
    }
    const R = Math.round((r + m) * 255);
    const G = Math.round((g + m) * 255);
    const B = Math.round((b + m) * 255);
    const hex = (n) => ('0' + n.toString(16)).slice(-2);
    return '#' + hex(R) + hex(G) + hex(B);
}

function applyRandomIconColor(kind, id) {
    const hex = randomMonitorIconHexColor();
    if (kind === 'service') {
        saveServiceIconColorSetting(id, hex);
    } else {
        saveVmIconColorSetting(id, hex);
    }
}

function normalizeMonitorServiceIconColorsMap(value) {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
    const out = {};
    for (const [key, raw] of Object.entries(value)) {
        const id = Number(key);
        const color = normalizeHexColor(raw);
        if (!Number.isNaN(id) && color) out[String(id)] = color;
    }
    return out;
}

function normalizeMonitorVmIconColorsMap(value) {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
    const out = {};
    for (const [key, raw] of Object.entries(value)) {
        const id = Number(key);
        const color = normalizeHexColor(raw);
        if (!Number.isNaN(id) && color) out[String(id)] = color;
    }
    return out;
}

function renderNamedIconHtml(iconName, fallbackClass, baseClass, extraClass = '', color = '') {
    const className = [baseClass, extraClass].filter(Boolean).join(' ');
    const styleAttr = color
        ? ` style="color:${escapeHtml(color)};--iconify-icon-color:${escapeHtml(color)}"`
        : '';
    if (iconName) {
        return `<iconify-icon icon="${escapeHtml(iconName)}" class="${escapeHtml(className)}" aria-hidden="true"${styleAttr}></iconify-icon>`;
    }
    return `<i class="bi ${escapeHtml(fallbackClass)} ${escapeHtml(className)}" aria-hidden="true"${styleAttr}></i>`;
}

function getVmIconName(vm) {
    const id = Number(vm && (vm.vmid != null ? vm.vmid : vm.id));
    if (Number.isNaN(id)) return '';
    return normalizeVmIconName(monitorVmIcons[String(id)] || monitorVmIcons[id] || '');
}

function getVmFallbackIconClass(vm) {
    const type = String(vm && vm.type || 'vm').toLowerCase();
    return type === 'lxc' || type === 'ct' ? 'bi-box-seam' : 'bi-pc-display';
}

function getVmIconColor(vm) {
    const id = Number(vm && (vm.vmid != null ? vm.vmid : vm.id));
    if (Number.isNaN(id)) return '';
    return normalizeHexColor(monitorVmIconColors[String(id)] || monitorVmIconColors[id] || '');
}

/** Сохранённый цвет тинта или дефолт (для отображения и color input). */
function getVmIconTintOrDefault(vm) {
    return getVmIconColor(vm) || DEFAULT_MONITOR_ICON_TINT;
}

function renderVmIconHtml(vm, extraClass = '', colorOverride = null) {
    const iconName = getVmIconName(vm);
    const color = colorOverride != null ? colorOverride : getVmIconTintOrDefault(vm);
    return renderNamedIconHtml(iconName, getVmFallbackIconClass(vm), 'vm-icon', extraClass, color);
}

function getServiceIconName(service) {
    const id = Number(service && service.id);
    if (Number.isNaN(id)) return '';
    return normalizeVmIconName(monitorServiceIcons[String(id)] || monitorServiceIcons[id] || '');
}

function getServiceIconColor(service) {
    const id = Number(service && service.id);
    if (Number.isNaN(id)) return '';
    return normalizeHexColor(monitorServiceIconColors[String(id)] || monitorServiceIconColors[id] || '');
}

function getServiceIconTintOrDefault(service) {
    return getServiceIconColor(service) || DEFAULT_MONITOR_ICON_TINT;
}

function getServiceFallbackIconClass(service) {
    const type = String(service && service.type || 'tcp').toLowerCase();
    if (type === 'http' || type === 'https') return 'bi-globe2';
    if (type === 'udp') return 'bi-broadcast';
    if (type === 'snmp') return 'bi-diagram-3';
    if (type === 'nut') return 'bi-battery-half';
    return 'bi-hdd-network';
}

function renderServiceIconHtml(service, extraClass = '', colorOverride = null) {
    const iconName = getServiceIconName(service);
    const color = colorOverride != null ? colorOverride : getServiceIconTintOrDefault(service);
    return renderNamedIconHtml(iconName, getServiceFallbackIconClass(service), 'service-icon', extraClass, color);
}

function getIconPickerModalInstance() {
    const modalEl = document.getElementById('iconPickerModal');
    if (!modalEl || typeof bootstrap === 'undefined' || !bootstrap.Modal) return null;
    return bootstrap.Modal.getOrCreateInstance(modalEl);
}

function getIconPickerItems() {
    return ICON_PICKER_ITEMS.slice();
}

function renderIconPickerGrid() {
    const grid = document.getElementById('iconPickerGrid');
    const empty = document.getElementById('iconPickerEmpty');
    const searchInput = document.getElementById('iconPickerSearchInput');
    if (!grid || !empty) return;
    const query = String(searchInput && searchInput.value || '').trim().toLowerCase();
    const items = getIconPickerItems().filter((item) => {
        if (!query) return true;
        const haystack = [item.label, item.icon].concat(item.tags || []).join(' ').toLowerCase();
        return haystack.includes(query);
    });
    grid.innerHTML = items.map((item) => `
        <button type="button" class="btn btn-outline-secondary icon-picker-item" onclick="selectIconFromPicker('${escapeHtml(item.icon)}')" title="${escapeHtml(item.label)}">
            <iconify-icon icon="${escapeHtml(item.icon)}" class="icon-picker-item__icon" aria-hidden="true"></iconify-icon>
            <span class="icon-picker-item__label">${escapeHtml(item.label)}</span>
            <code class="icon-picker-item__name">${escapeHtml(item.icon)}</code>
        </button>
    `).join('');
    empty.classList.toggle('d-none', items.length > 0);
}

function openIconPicker(kind, targetId) {
    activeIconPicker = {
        kind: kind === 'service' ? 'service' : 'vm',
        targetId: Number(targetId),
        scope: 'all'
    };
    const title = document.getElementById('iconPickerModalTitle');
    const help = document.getElementById('iconPickerHelpText');
    const search = document.getElementById('iconPickerSearchInput');
    const clearBtn = document.getElementById('iconPickerClearBtn');
    if (title) title.textContent = activeIconPicker.kind === 'service'
        ? (t('serviceIconPickerTitle') || 'Иконка сервиса')
        : (t('vmIconPickerTitle') || 'Иконка VM/CT');
    if (help) help.textContent = t('iconPickerHelp') || 'Выберите иконку из каталога ниже. При необходимости можно потом задать любое имя иконки Iconify.';
    if (search) {
        search.value = '';
        search.placeholder = t('iconPickerSearchPlaceholder') || 'Поиск по названию или icon name';
    }
    if (clearBtn) clearBtn.textContent = t('clear') || 'Сбросить';
    renderIconPickerGrid();
    const modal = getIconPickerModalInstance();
    if (modal) {
        modal.show();
    } else if (typeof showToast === 'function') {
        showToast(t('iconPickerOpenFailed') || 'Could not open the icon picker.', 'error');
    }
}

function selectIconFromPicker(iconName) {
    const normalized = normalizeVmIconName(iconName);
    if (!normalized) return;
    if (activeIconPicker.kind === 'service') {
        saveServiceIconSetting(activeIconPicker.targetId, normalized);
    } else {
        saveVmIconSetting(activeIconPicker.targetId, normalized);
    }
    const modal = getIconPickerModalInstance();
    if (modal) modal.hide();
}

function clearActiveIconPickerSelection() {
    if (activeIconPicker.kind === 'service') {
        saveServiceIconSetting(activeIconPicker.targetId, '');
    } else {
        saveVmIconSetting(activeIconPicker.targetId, '');
    }
    const modal = getIconPickerModalInstance();
    if (modal) modal.hide();
}

function setDisplay(id, display) {
    const e = el(id);
    if (e) e.style.display = display;
}

// Proxmox token parts (backward compatible with old single-field format)
function syncProxmoxApiTokenFromParts() {
    const idEl = document.getElementById('apiTokenId');
    const secretEl = document.getElementById('apiTokenSecret');
    const hiddenEl = document.getElementById('apiToken');
    if (!idEl || !secretEl || !hiddenEl) return;

    const part1 = (idEl.value || '').trim();
    const part2 = (secretEl.value || '').trim();

    let full = '';
    if (part1) {
        // If user pastes full token into part1 field, allow it for compatibility.
        if (!part2 && part1.includes('=')) {
            full = part1;
        } else if (part2) {
            full = part1 + '=' + part2;
        } else {
            full = part1;
        }
    }

    hiddenEl.value = full;
}

function updateHomeLabFontScale() {
    try {
        if (monitorMode && monitorCurrentView !== 'cluster') {
            document.documentElement.style.setProperty('--homelab-font-scale', '1');
            document.documentElement.style.setProperty('--homelab-content-scale', '1');
            return;
        }
        const dashboardSection = document.getElementById('dashboardSection');
        const dashboardContent = document.getElementById('dashboardContent');
        if (!dashboardSection || !dashboardContent || dashboardSection.style.display === 'none') {
            document.documentElement.style.setProperty('--homelab-font-scale', '1');
            document.documentElement.style.setProperty('--homelab-content-scale', '1');
            return;
        }
        document.documentElement.style.setProperty('--homelab-content-scale', '1');
        const contentRect = dashboardContent.getBoundingClientRect();
        const importantBlocks = dashboardContent.querySelectorAll('.stat-card, .card, .cluster-scroll-item, .node-card');
        let measuredBottomPx = 0;
        importantBlocks.forEach((el) => {
            if (!(el instanceof HTMLElement)) return;
            if (el.offsetParent === null) return;
            const r = el.getBoundingClientRect();
            if (r.height <= 0 || r.width <= 0) return;
            measuredBottomPx = Math.max(measuredBottomPx, r.bottom - contentRect.top);
        });
        const available = Math.max(0, dashboardContent.clientHeight || 0);
        const occupied = Math.max(
            0,
            Math.ceil(measuredBottomPx || 0),
            Math.ceil((dashboardContent.scrollHeight || 0) * 0.45)
        );
        if (!available || !occupied) {
            document.documentElement.style.setProperty('--homelab-font-scale', '1');
            document.documentElement.style.setProperty('--homelab-content-scale', '1');
            return;
        }
        const contentScale = Math.max(1, Math.min(1.8, available / occupied));
        const fontScale = Math.max(1, Math.min(1.6, 1 + ((contentScale - 1) * 0.9)));
        document.documentElement.style.setProperty('--homelab-content-scale', contentScale.toFixed(3));
        document.documentElement.style.setProperty('--homelab-font-scale', fontScale.toFixed(3));
    } catch (_) {
        document.documentElement.style.setProperty('--homelab-font-scale', '1');
        document.documentElement.style.setProperty('--homelab-content-scale', '1');
    }
}

let homeLabFontScaleRaf = 0;
let homeLabFontScaleLastRun = 0;
function scheduleHomeLabFontScale() {
    if (homeLabFontScaleRaf) return;
    homeLabFontScaleRaf = requestAnimationFrame(() => {
        homeLabFontScaleRaf = 0;
        const now = Date.now();
        // Avoid repetitive full-dashboard measurements in tight bursts.
        if (now - homeLabFontScaleLastRun < 250) return;
        homeLabFontScaleLastRun = now;
        updateHomeLabFontScale();
    });
}

function isSettingsPasswordEnabled() {
    return !!settingsPasswordRequired;
}

async function saveSettingsToServer(payload) {
    const body = {};
    if (payload.theme !== undefined) body.theme = payload.theme;
    if (payload.refreshInterval !== undefined) body.refreshInterval = payload.refreshInterval;
    if (payload.units !== undefined) body.units = payload.units;
    if (payload.thresholds !== undefined) body.thresholds = payload.thresholds;
    if (payload.monitorTheme !== undefined) body.monitorTheme = payload.monitorTheme;
    if (payload.customThemeCss !== undefined) body.customThemeCss = payload.customThemeCss;
    if (payload.customThemeStyleSettings !== undefined) body.customThemeStyleSettings = payload.customThemeStyleSettings;
    if (payload.monitorMode !== undefined) body.monitorMode = payload.monitorMode;
    if (payload.serverType !== undefined) body.serverType = payload.serverType;
    if (payload.currentServerIndex !== undefined) body.currentServerIndex = payload.currentServerIndex;
    if (payload.currentTrueNASServerIndex !== undefined) body.currentTrueNASServerIndex = payload.currentTrueNASServerIndex;
    if (payload.proxmoxServers !== undefined) body.proxmoxServers = payload.proxmoxServers;
    if (payload.truenasServers !== undefined) body.truenasServers = payload.truenasServers;
    if (payload.connectionIdMap !== undefined) body.connectionIdMap = payload.connectionIdMap;
    if (payload.preferredLanguage !== undefined) body.preferredLanguage = payload.preferredLanguage;
    if (payload.monitorHiddenServiceIds !== undefined) body.monitorHiddenServiceIds = payload.monitorHiddenServiceIds;
    if (payload.monitorServiceIcons !== undefined) body.monitorServiceIcons = payload.monitorServiceIcons;
    if (payload.monitorServiceIconColors !== undefined) body.monitorServiceIconColors = payload.monitorServiceIconColors;
    if (payload.monitorHiddenVmIds !== undefined) body.monitorHiddenVmIds = payload.monitorHiddenVmIds;
    if (payload.monitorVms !== undefined) body.monitorVms = payload.monitorVms;
    if (payload.monitorVmIcons !== undefined) body.monitorVmIcons = payload.monitorVmIcons;
    if (payload.monitorVmIconColors !== undefined) body.monitorVmIconColors = payload.monitorVmIconColors;
    if (payload.monitorScreensOrder !== undefined) body.monitorScreensOrder = payload.monitorScreensOrder;
    if (payload.monitorScreensEnabled !== undefined) body.monitorScreensEnabled = payload.monitorScreensEnabled;
    if (payload.monitorDefaultScreen !== undefined) body.monitorDefaultScreen = payload.monitorDefaultScreen;
    if (payload.savedViews !== undefined) body.savedViews = payload.savedViews;
    if (payload.savedTileViews !== undefined) body.savedTileViews = payload.savedTileViews;
    if (payload.monitorHotkeys !== undefined) body.monitorHotkeys = payload.monitorHotkeys;
    if (payload.clusterDashboardTiles !== undefined) body.clusterDashboardTiles = payload.clusterDashboardTiles;
    if (payload.dashboardWeatherCity !== undefined) body.dashboardWeatherCity = payload.dashboardWeatherCity;
    if (payload.dashboardWeatherProvider !== undefined) body.dashboardWeatherProvider = payload.dashboardWeatherProvider;
    if (payload.dashboardTimezone !== undefined) body.dashboardTimezone = payload.dashboardTimezone;
    if (payload.weatherOpenweathermapApiKey !== undefined) body.weatherOpenweathermapApiKey = payload.weatherOpenweathermapApiKey;
    if (payload.weatherYandexApiKey !== undefined) body.weatherYandexApiKey = payload.weatherYandexApiKey;
    if (payload.weatherGismeteoApiKey !== undefined) body.weatherGismeteoApiKey = payload.weatherGismeteoApiKey;
    if (payload.dashboardShowTime !== undefined) body.dashboardShowTime = !!payload.dashboardShowTime;
    if (payload.dashboardShowWeather !== undefined) body.dashboardShowWeather = !!payload.dashboardShowWeather;
    if (payload.monitorShowTime !== undefined) body.monitorShowTime = !!payload.monitorShowTime;
    if (payload.monitorShowWeather !== undefined) body.monitorShowWeather = !!payload.monitorShowWeather;
    if (payload.monitorDisableChromeGestures !== undefined) body.monitorDisableChromeGestures = !!payload.monitorDisableChromeGestures;
    if (payload.monitorTilesChartAxisTime !== undefined) body.monitorTilesChartAxisTime = !!payload.monitorTilesChartAxisTime;
    if (payload.monitorTilesChartAxisValues !== undefined) body.monitorTilesChartAxisValues = !!payload.monitorTilesChartAxisValues;
    if (payload.monitorTilesChartAxisYUnit !== undefined) body.monitorTilesChartAxisYUnit = !!payload.monitorTilesChartAxisYUnit;
    if (payload.metricsHistoryRetentionHoursCluster !== undefined) body.metricsHistoryRetentionHoursCluster = payload.metricsHistoryRetentionHoursCluster;
    if (payload.metricsHistoryRetentionHoursHost !== undefined) body.metricsHistoryRetentionHoursHost = payload.metricsHistoryRetentionHoursHost;
    if (payload.metricsHistoryRetentionHoursUps !== undefined) body.metricsHistoryRetentionHoursUps = payload.metricsHistoryRetentionHoursUps;
    if (payload.metricsHistoryRetentionHoursSmart !== undefined) body.metricsHistoryRetentionHoursSmart = payload.metricsHistoryRetentionHoursSmart;
    if (payload.chartWindowClusterMetricMin !== undefined) body.chartWindowClusterMetricMin = payload.chartWindowClusterMetricMin;
    if (payload.chartWindowHostMetricMin !== undefined) body.chartWindowHostMetricMin = payload.chartWindowHostMetricMin;
    if (payload.chartWindowUpsMetricMin !== undefined) body.chartWindowUpsMetricMin = payload.chartWindowUpsMetricMin;
    if (payload.chartWindowSmartSensorMetricMin !== undefined) body.chartWindowSmartSensorMetricMin = payload.chartWindowSmartSensorMetricMin;
    if (payload.tilesChartDisplayVariant !== undefined) body.tilesChartDisplayVariant = payload.tilesChartDisplayVariant;
    if (payload.speedtestEnabled !== undefined) body.speedtestEnabled = !!payload.speedtestEnabled;
    if (payload.speedtestServer !== undefined) body.speedtestServer = payload.speedtestServer;
    if (payload.speedtestPerDay !== undefined) body.speedtestPerDay = payload.speedtestPerDay;
    if (payload.speedtestProviderDownloadMbps !== undefined) body.speedtestProviderDownloadMbps = payload.speedtestProviderDownloadMbps;
    if (payload.speedtestProviderUploadMbps !== undefined) body.speedtestProviderUploadMbps = payload.speedtestProviderUploadMbps;
    if (payload.speedtestHttpProxy !== undefined) body.speedtestHttpProxy = payload.speedtestHttpProxy;
    if (payload.speedtestHttpsProxy !== undefined) body.speedtestHttpsProxy = payload.speedtestHttpsProxy;
    if (payload.speedtestNoProxy !== undefined) body.speedtestNoProxy = payload.speedtestNoProxy;
    if (payload.iperf3Enabled !== undefined) body.iperf3Enabled = !!payload.iperf3Enabled;
    if (payload.iperf3Host !== undefined) body.iperf3Host = payload.iperf3Host;
    if (payload.iperf3Port !== undefined) body.iperf3Port = payload.iperf3Port;
    if (payload.iperf3DurationSec !== undefined) body.iperf3DurationSec = payload.iperf3DurationSec;
    if (payload.iperf3Parallel !== undefined) body.iperf3Parallel = payload.iperf3Parallel;
    if (payload.iperf3PerDay !== undefined) body.iperf3PerDay = payload.iperf3PerDay;
    if (payload.iperf3ProviderDownloadMbps !== undefined) body.iperf3ProviderDownloadMbps = payload.iperf3ProviderDownloadMbps;
    if (payload.iperf3ProviderUploadMbps !== undefined) body.iperf3ProviderUploadMbps = payload.iperf3ProviderUploadMbps;
    if (payload.telegramNotifyEnabled !== undefined) body.telegramNotifyEnabled = !!payload.telegramNotifyEnabled;
    if (payload.telegramNotifyIntervalSec !== undefined) body.telegramNotifyIntervalSec = payload.telegramNotifyIntervalSec;
    if (payload.telegramRoutes !== undefined) body.telegramRoutes = payload.telegramRoutes;
    if (payload.telegramNotificationRules !== undefined) body.telegramNotificationRules = payload.telegramNotificationRules;
    if (payload.telegramBotToken !== undefined) body.telegramBotToken = payload.telegramBotToken;
    if (payload.telegramProxyUrl !== undefined) body.telegramProxyUrl = payload.telegramProxyUrl;
    if (payload.telegramClearBotToken === true) body.telegramClearBotToken = true;
    if (payload.setupCompleted !== undefined) body.setupCompleted = !!payload.setupCompleted;
    saveSettingsLastError = '';
    try {
        const res = await fetch('/api/settings', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            credentials: 'same-origin',
            body: JSON.stringify(body)
        });
        const text = await res.text();
        if (!res.ok) {
            let message = `HTTP ${res.status}`;
            try {
                const j = JSON.parse(text);
                if (j && typeof j.error === 'string' && j.error.trim()) message = j.error.trim();
            } catch (_) {
                if (text && text.trim()) message = text.trim().slice(0, 500);
            }
            saveSettingsLastError = message;
            console.error('Failed to save settings:', message);
            return false;
        }
        return true;
    } catch (e) {
        const msg = e instanceof Error && e.message ? e.message : String(e);
        saveSettingsLastError = msg;
        console.error('Failed to save settings:', e);
        return false;
    }
}

// Client-side translations (will be loaded from server)
let translations = {
    ru: {},
    en: {}
};

function ensureTranslationsShape(obj) {
    const base = { ru: {}, en: {} };
    if (!obj || typeof obj !== 'object') return base;
    return {
        ...base,
        ...obj,
        ru: (obj.ru && typeof obj.ru === 'object') ? obj.ru : base.ru,
        en: (obj.en && typeof obj.en === 'object') ? obj.en : base.en
    };
}

// Load translations from server
async function loadTranslations() {
    try {
        const response = await fetch('/api/translations');
        const data = await response.json();
        if (data.translations) {
            translations = ensureTranslationsShape(data.translations);
        } else {
            translations = ensureTranslationsShape(translations);
        }
    } catch (error) {
        console.error('Failed to load translations:', error);
        translations = ensureTranslationsShape(translations);
    }
}

function t(key) {
    const dict = ensureTranslationsShape(translations);
    return dict[currentLanguage]?.[key] ?? dict.ru?.[key] ?? key;
}

function tOr(key, fallback) {
    const v = t(key);
    if (!v || v === key) return fallback;
    return v;
}

/** Подстановка {name} в строку перевода (клиент). */
function tParams(key, vars) {
    let s = t(key);
    if (!vars || typeof vars !== 'object') return s;
    Object.keys(vars).forEach((k) => {
        s = s.split('{' + k + '}').join(String(vars[k]));
    });
    return s;
}

/** Обычный режим: экран Homelab, открытый из меню (совпадает с id экранов монитора). */
let homelabNormalNavView = 'cluster';

function getHomelabViewTitle(viewId, clusterTitleKey) {
    const clusterKey = clusterTitleKey || 'homelabNavDashboard';
    const titles = {
        cluster: t(clusterKey),
        tiles: t('monitorScreenTiles'),
        truenasPools: t('monitorScreenTruenasPools'),
        truenasDisks: t('monitorScreenTruenasDisks'),
        truenasServices: t('monitorScreenTruenasServices'),
        truenasApps: t('monitorScreenTruenasApps'),
        ups: t('monitorScreenUps'),
        netdev: t('monitorScreenNetdev'),
        speedtest: t('monitorScreenSpeedtest'),
        iperf3: t('monitorScreenIperf3'),
        smartSensors: t('monitorScreenSmartSensors'),
        vms: t('monitorScreenVms'),
        services: t('monitorScreenServices'),
        backupRuns: t('monitorScreenBackupRuns'),
        draw: t('monitorScreenDraw')
    };
    return titles[viewId] || t('monitorMode');
}

function updateHomelabMenuChrome() {
    const sectionEl = document.getElementById('serverMenuTitle');

    const cfg = document.getElementById('configSection');
    const settingsOpen = cfg && cfg.style.display === 'block';

    let subsection = '';
    if (settingsOpen) {
        subsection = t('settings');
    } else if (monitorMode) {
        subsection = getHomelabViewTitle(monitorCurrentView);
    } else {
        subsection = getHomelabViewTitle(homelabNormalNavView);
    }

    if (sectionEl) sectionEl.textContent = subsection;

    let activeKey = null;
    if (!settingsOpen) {
        activeKey = monitorMode ? monitorCurrentView : homelabNormalNavView;
    }
    document.querySelectorAll('[data-homelab-view]').forEach((el) => {
        const v = el.getAttribute('data-homelab-view');
        const on = !!activeKey && v === activeKey;
        el.classList.toggle('active', on);
        if (on) el.setAttribute('aria-current', 'true');
        else el.removeAttribute('aria-current');
    });
}

function setHomelabNormalNavView(viewId) {
    homelabNormalNavView = typeof viewId === 'string' && viewId ? viewId : 'cluster';
    updateHomelabMenuChrome();
}

/** Единый HomeLab: переключатель Proxmox/TrueNAS снят. Вызовы из разметки оставлены как no-op. */
function setServerType(_type) {
    syncHomelabChrome();
}

function syncHomelabChrome() {
    updateHomelabMenuChrome();
    const backupsTab = document.getElementById('backups-tab')?.closest('li');
    const quorumTab = document.getElementById('quorum-tab')?.closest('li');
    const myTab = document.getElementById('myTab');
    const tabNodesLabel = document.getElementById('tabNodes');
    const tabStorageLabel = document.getElementById('tabStorage');
    const tabServersLabel = document.getElementById('tabServers');
    if (backupsTab) backupsTab.style.display = '';
    if (quorumTab) quorumTab.style.display = '';
    if (myTab) myTab.style.display = '';
    if (tabNodesLabel) tabNodesLabel.textContent = t('tabNodes');
    if (tabStorageLabel) tabStorageLabel.textContent = t('tabStorage');
    if (tabServersLabel) tabServersLabel.textContent = t('tabServers');

    const monitorSelectWrap = document.getElementById('monitorServerTypeSelectWrap');
    if (monitorSelectWrap) monitorSelectWrap.classList.add('d-none');
    document.querySelectorAll('.server-menu-backend-choice').forEach((el) => el.classList.add('d-none'));

    updateCurrentServerBadge();

    if (monitorMode && monitorCurrentView === 'backupRuns' && !getAuthHeadersForType('proxmox')) {
        applyMonitorView('cluster');
    }
}

function hideAllTrueNASMonitorSections() {
    ['truenasPoolsMonitorSection', 'truenasDisksMonitorSection', 'truenasServicesMonitorSection', 'truenasAppsMonitorSection'].forEach((id) => {
        const el = document.getElementById(id);
        if (el) el.style.display = 'none';
    });
}

/** Все полноэкранные секции монитора (sibling'и #dashboardSection, часто position:fixed). Обязательно скрывать при выходе из monitor mode и при открытии настроек — иначе «накладываются» на дашборд/настройки. */
function hideAllMonitorShellSections() {
    [
        'servicesMonitorSection',
        'vmsMonitorSection',
        'upsMonitorSection',
        'netdevMonitorSection',
        'speedtestMonitorSection',
        'iperf3MonitorSection',
        'smartSensorsMonitorSection',
        'tilesMonitorSection',
        'backupsMonitorSection',
        'drawMonitorSection',
        'monitorView'
    ].forEach((id) => {
        const el = document.getElementById(id);
        if (el) el.style.display = 'none';
    });
    hideAllTrueNASMonitorSections();
}

function openTrueNASCategoryMonitorFromMenu(kind) {
    const viewByKind = {
        pools: 'truenasPools',
        disks: 'truenasDisks',
        services: 'truenasServices',
        apps: 'truenasApps'
    };
    const view = viewByKind[kind];
    if (!view) return;

    // В режиме монитора обязательно синхронизировать monitorCurrentView с экраном — иначе
    // renderTrueNASMonitorScreenTiles() выходит по guard и сетка остаётся пустой.
    if (monitorMode) {
        applyMonitorView(view);
        return;
    }

    setHomelabNormalNavView(view);

    const map = {
        pools: { sectionId: 'truenasPoolsMonitorSection', gridId: 'truenasPoolsMonitorGrid', type: 'truenas_pool' },
        disks: { sectionId: 'truenasDisksMonitorSection', gridId: 'truenasDisksMonitorGrid', type: 'truenas_disk' },
        services: { sectionId: 'truenasServicesMonitorSection', gridId: 'truenasServicesMonitorGrid', type: 'truenas_service' },
        apps: { sectionId: 'truenasAppsMonitorSection', gridId: 'truenasAppsMonitorGrid', type: 'truenas_app' }
    };
    const cfg = map[kind];
    const dashboardSection = document.getElementById('dashboardSection');
    const configSection = document.getElementById('configSection');
    hideAllMonitorShellSections();
    if (dashboardSection) dashboardSection.style.display = 'none';
    if (configSection) configSection.style.display = 'none';

    const target = document.getElementById(cfg.sectionId);
    if (target) {
        target.style.display = 'flex';
        target.style.flexDirection = 'column';
        target.style.minHeight = '0';
    }

    renderTrueNASMonitorScreenTiles(cfg.gridId, cfg.type).catch(() => {});
}

function openServicesMonitorFromMenu() {
    const dashboardSection = document.getElementById('dashboardSection');
    const servicesSection = document.getElementById('servicesMonitorSection');
    const configSection = document.getElementById('configSection');
    hideAllMonitorShellSections();
    if (dashboardSection) dashboardSection.style.display = 'none';
    if (configSection) configSection.style.display = 'none';
    if (servicesSection) servicesSection.style.display = 'block';
    setHomelabNormalNavView('services');
    renderMonitoredServices();
}

function closeServicesMonitor() {
    const dashboardSection = document.getElementById('dashboardSection');
    const servicesSection = document.getElementById('servicesMonitorSection');
    const vmsSection = document.getElementById('vmsMonitorSection');
    const backupsMon = document.getElementById('backupsMonitorSection');
    if (servicesSection) servicesSection.style.display = 'none';
    if (vmsSection) vmsSection.style.display = 'none';
    if (backupsMon) backupsMon.style.display = 'none';
    hideAllTrueNASMonitorSections();
    if (dashboardSection) dashboardSection.style.display = '';
}

function openVmsMonitorFromMenu() {
    const dashboardSection = document.getElementById('dashboardSection');
    const vmsSection = document.getElementById('vmsMonitorSection');
    const configSection = document.getElementById('configSection');
    hideAllMonitorShellSections();
    if (dashboardSection) dashboardSection.style.display = 'none';
    if (configSection) configSection.style.display = 'none';
    if (vmsSection) vmsSection.style.display = 'block';
    setHomelabNormalNavView('vms');
    renderVmsMonitorCards();
}

function closeVmsMonitor() {
    const dashboardSection = document.getElementById('dashboardSection');
    const vmsSection = document.getElementById('vmsMonitorSection');
    const backupsMon = document.getElementById('backupsMonitorSection');
    if (vmsSection) vmsSection.style.display = 'none';
    if (backupsMon) backupsMon.style.display = 'none';
    hideAllTrueNASMonitorSections();
    if (dashboardSection) dashboardSection.style.display = '';
}

function openNetdevMonitorFromMenu() {
    const dashboardSection = document.getElementById('dashboardSection');
    const netdevSection = document.getElementById('netdevMonitorSection');
    const configSection = document.getElementById('configSection');
    hideAllMonitorShellSections();
    if (dashboardSection) dashboardSection.style.display = 'none';
    if (configSection) configSection.style.display = 'none';
    if (netdevSection) netdevSection.style.display = 'block';
    setHomelabNormalNavView('netdev');

    updateNetdevDashboard().catch(() => {});
}

function closeNetdevMonitor() {
    const dashboardSection = document.getElementById('dashboardSection');
    const netdevSection = document.getElementById('netdevMonitorSection');
    const backupsMon = document.getElementById('backupsMonitorSection');
    if (netdevSection) netdevSection.style.display = 'none';
    if (backupsMon) backupsMon.style.display = 'none';
    hideAllTrueNASMonitorSections();
    if (dashboardSection) dashboardSection.style.display = '';
    updateNetdevDashboard().catch(() => {});
}

function openSpeedtestMonitorFromMenu() {
    const dashboardSection = document.getElementById('dashboardSection');
    const speedtestSection = document.getElementById('speedtestMonitorSection');
    const configSection = document.getElementById('configSection');
    hideAllMonitorShellSections();
    if (dashboardSection) dashboardSection.style.display = 'none';
    if (configSection) configSection.style.display = 'none';
    if (speedtestSection) speedtestSection.style.display = 'block';
    setHomelabNormalNavView('speedtest');

    updateSpeedtestDashboard().catch(() => {});
}

function openIperf3MonitorFromMenu() {
    const dashboardSection = document.getElementById('dashboardSection');
    const iperf3Section = document.getElementById('iperf3MonitorSection');
    const configSection = document.getElementById('configSection');
    hideAllMonitorShellSections();
    if (dashboardSection) dashboardSection.style.display = 'none';
    if (configSection) configSection.style.display = 'none';
    if (iperf3Section) iperf3Section.style.display = 'block';
    setHomelabNormalNavView('iperf3');

    updateIperf3Dashboard().catch(() => {});
}

function closeSpeedtestMonitor() {
    const dashboardSection = document.getElementById('dashboardSection');
    const speedtestSection = document.getElementById('speedtestMonitorSection');
    const backupsMon = document.getElementById('backupsMonitorSection');
    if (speedtestSection) speedtestSection.style.display = 'none';
    if (backupsMon) backupsMon.style.display = 'none';
    hideAllTrueNASMonitorSections();
    if (dashboardSection) dashboardSection.style.display = '';
    updateSpeedtestDashboard().catch(() => {});
}

function closeIperf3Monitor() {
    const dashboardSection = document.getElementById('dashboardSection');
    const iperf3Section = document.getElementById('iperf3MonitorSection');
    const backupsMon = document.getElementById('backupsMonitorSection');
    if (iperf3Section) iperf3Section.style.display = 'none';
    if (backupsMon) backupsMon.style.display = 'none';
    hideAllTrueNASMonitorSections();
    if (dashboardSection) dashboardSection.style.display = '';
    updateIperf3Dashboard().catch(() => {});
}

function openUpsMonitorFromMenu() {
    const dashboardSection = document.getElementById('dashboardSection');
    const upsMonSection = document.getElementById('upsMonitorSection');
    const configSection = document.getElementById('configSection');
    hideAllMonitorShellSections();
    if (dashboardSection) dashboardSection.style.display = 'none';
    if (configSection) configSection.style.display = 'none';
    if (upsMonSection) upsMonSection.style.display = 'block';
    setHomelabNormalNavView('ups');

    updateUPSDashboard().catch(() => {});
}

function closeUpsMonitor() {
    const dashboardSection = document.getElementById('dashboardSection');
    const upsMonSection = document.getElementById('upsMonitorSection');
    const backupsMon = document.getElementById('backupsMonitorSection');
    if (upsMonSection) upsMonSection.style.display = 'none';
    if (backupsMon) backupsMon.style.display = 'none';
    hideAllTrueNASMonitorSections();
    if (dashboardSection) dashboardSection.style.display = '';
    updateUPSDashboard().catch(() => {});
}

function openSmartSensorsMonitorFromMenu() {
    const dashboardSection = document.getElementById('dashboardSection');
    const smartSection = document.getElementById('smartSensorsMonitorSection');
    const configSection = document.getElementById('configSection');
    hideAllMonitorShellSections();
    if (dashboardSection) dashboardSection.style.display = 'none';
    if (configSection) configSection.style.display = 'none';
    if (smartSection) smartSection.style.display = 'block';
    setHomelabNormalNavView('smartSensors');

    updateSmartSensorsDashboard().catch(() => {});
}

function closeSmartSensorsMonitor() {
    const dashboardSection = document.getElementById('dashboardSection');
    const smartSection = document.getElementById('smartSensorsMonitorSection');
    const backupsMon = document.getElementById('backupsMonitorSection');
    if (smartSection) smartSection.style.display = 'none';
    if (backupsMon) backupsMon.style.display = 'none';
    hideAllTrueNASMonitorSections();
    if (dashboardSection) dashboardSection.style.display = '';
    updateSmartSensorsDashboard().catch(() => {});
}

// ==================== SMART SENSORS (REST + BLE) ====================

function newSmartSensorId() {
    try {
        if (typeof crypto !== 'undefined' && crypto.randomUUID) return crypto.randomUUID();
    } catch (_) {}
    return 'ss-' + Date.now() + '-' + Math.random().toString(16).slice(2);
}

function smartSensorDefaults(type) {
    if (type === 'ble') {
        return {
            id: newSmartSensorId(),
            type: 'ble',
            name: '',
            enabled: true,
            bleAddress: '',
            bleServiceUuid: '1809',
            bleChannels: [
                { metric: 'temperature', uuid: '2a1c', format: 'int16le', scale: 0.01, offset: 0, label: '' }
            ]
        };
    }
    return {
        id: newSmartSensorId(),
        type: 'rest',
        name: '',
        enabled: true,
        restUrl: '',
        restMethod: 'GET',
        restHeadersJson: '{}',
        restBody: '',
        restFields: [{ label: '', path: '', enabled: true }]
    };
}

const SMART_SENSOR_MAX_REST_FIELDS = 15;

let smartSensorsEditorRows = [];

function syncSmartSensorRowEnabled(i, v) {
    if (smartSensorsEditorRows[i]) smartSensorsEditorRows[i].enabled = !!v;
}

function persistSmartSensorRestFieldsFromDom(sensorIdx) {
    const row = smartSensorsEditorRows[sensorIdx];
    if (!row || row.type !== 'rest') return;
    const fields = [];
    let j = 0;
    for (;;) {
        const labEl = document.getElementById(`ssRf${sensorIdx}_${j}Label`);
        if (!labEl) break;
        const pathEl = document.getElementById(`ssRf${sensorIdx}_${j}Path`);
        const enEl = document.getElementById(`ssRf${sensorIdx}_${j}En`);
        fields.push({
            label: labEl.value.trim(),
            path: pathEl ? pathEl.value.trim() : '',
            enabled: enEl ? !!enEl.checked : true
        });
        j++;
    }
    row.restFields = fields.length ? fields : [{ label: '', path: '', enabled: true }];
}

function addSmartSensorRestField(sensorIdx) {
    persistSmartSensorRestFieldsFromDom(sensorIdx);
    const row = smartSensorsEditorRows[sensorIdx];
    if (!row || row.type !== 'rest') return;
    if (!Array.isArray(row.restFields)) row.restFields = [];
    if (row.restFields.length >= SMART_SENSOR_MAX_REST_FIELDS) {
        showToast(t('smartSensorsRestFieldsMaxToast') || 'Max fields', 'warning');
        return;
    }
    row.restFields.push({ label: '', path: '', enabled: true });
    renderSmartSensorsSettingsEditor();
}

function removeSmartSensorRestField(sensorIdx, fieldIdx) {
    persistSmartSensorRestFieldsFromDom(sensorIdx);
    const row = smartSensorsEditorRows[sensorIdx];
    if (!row || row.type !== 'rest' || !Array.isArray(row.restFields)) return;
    row.restFields.splice(fieldIdx, 1);
    if (!row.restFields.length) row.restFields.push({ label: '', path: '', enabled: true });
    renderSmartSensorsSettingsEditor();
}

function addSmartSensorRow(type) {
    smartSensorsEditorRows.push(smartSensorDefaults(type === 'ble' ? 'ble' : 'rest'));
    renderSmartSensorsSettingsEditor();
}

function removeSmartSensorRow(idx) {
    smartSensorsEditorRows.splice(idx, 1);
    renderSmartSensorsSettingsEditor();
}

function renderSmartSensorsSettingsEditor() {
    const root = document.getElementById('smartSensorsSettingsEditorRoot');
    if (!root) return;
    root.innerHTML = smartSensorsEditorRows.map((row, i) => {
        const en = row.enabled !== false ? 'checked' : '';
        if (row.type === 'ble') {
            let chJson;
            try {
                chJson = JSON.stringify(row.bleChannels || [], null, 2);
            } catch (_) {
                chJson = '[]';
            }
            return `<div class="card border-secondary" data-ss-idx="${i}">
        <div class="card-body p-3">
          <div class="d-flex flex-wrap justify-content-between gap-2 mb-2">
            <span class="badge bg-primary">Bluetooth</span>
            <div class="d-flex align-items-center gap-2">
              <div class="form-check m-0">
                <input class="form-check-input" type="checkbox" id="ssEn${i}" ${en} onchange="syncSmartSensorRowEnabled(${i}, this.checked)">
                <label class="form-check-label" for="ssEn${i}">On</label>
              </div>
              <button type="button" class="btn btn-sm btn-outline-danger" onclick="removeSmartSensorRow(${i})" aria-label="Remove">×</button>
            </div>
          </div>
          <div class="row g-2">
            <div class="col-md-4"><label class="form-label small">Name</label><input class="form-control form-control-sm" id="ssName${i}" value="${escapeHtml(row.name)}"></div>
            <div class="col-md-4"><label class="form-label small">MAC</label><input class="form-control form-control-sm" id="ssBleAddr${i}" value="${escapeHtml(row.bleAddress)}" placeholder="aa:bb:cc:dd:ee:ff"></div>
            <div class="col-md-4"><label class="form-label small">Service UUID</label><input class="form-control form-control-sm" id="ssBleSvc${i}" value="${escapeHtml(row.bleServiceUuid)}"></div>
            <div class="col-12"><label class="form-label small">Channels JSON</label><textarea class="form-control form-control-sm font-monospace" rows="5" id="ssBleCh${i}">${escapeHtml(chJson)}</textarea></div>
          </div>
        </div>
      </div>`;
        }
        const hdr = row.restHeadersJson != null ? String(row.restHeadersJson) : '{}';
        let rf = Array.isArray(row.restFields) && row.restFields.length
            ? row.restFields
            : [{ label: '', path: '', enabled: true }];
        if (rf.length > SMART_SENSOR_MAX_REST_FIELDS) rf = rf.slice(0, SMART_SENSOR_MAX_REST_FIELDS);
        const lblRestFields = t('smartSensorsRestFieldsTitle') || 'JSON fields';
        const lblFieldName = t('smartSensorsFieldName') || 'Name';
        const lblJsonPath = t('smartSensorsFieldJsonPath') || 'JSON path';
        const lblPoll = t('netdevFieldEnabled') || 'Poll';
        const lblRemoveField = t('netdevFieldRemove') || 'Remove';
        const lblAddField = t('smartSensorsAddRestField') || 'Add field';
        const fieldsRows = rf.map((f, j) => {
            const fen = f.enabled !== false ? 'checked' : '';
            return `
            <div class="row g-2 align-items-end mb-2 border-bottom border-secondary-subtle pb-2">
              <div class="col-md-3">
                <label class="form-label small mb-0" for="ssRf${i}_${j}Label">${escapeHtml(lblFieldName)}</label>
                <input type="text" class="form-control form-control-sm" id="ssRf${i}_${j}Label" value="${escapeHtml(f.label)}" placeholder="Temperature">
              </div>
              <div class="col-md-6">
                <label class="form-label small mb-0" for="ssRf${i}_${j}Path">${escapeHtml(lblJsonPath)}</label>
                <input type="text" class="form-control form-control-sm font-monospace" id="ssRf${i}_${j}Path" value="${escapeHtml(f.path)}" placeholder="data.temperature">
              </div>
              <div class="col-md-2">
                <div class="form-check mt-3">
                  <input class="form-check-input" type="checkbox" id="ssRf${i}_${j}En" ${fen}>
                  <label class="form-check-label small" for="ssRf${i}_${j}En">${escapeHtml(lblPoll)}</label>
                </div>
              </div>
              <div class="col-md-1 text-md-end">
                <button type="button" class="btn btn-sm btn-outline-danger" onclick="removeSmartSensorRestField(${i},${j})" title="${escapeHtml(lblRemoveField)}">×</button>
              </div>
            </div>`;
        }).join('');
        return `<div class="card border-secondary" data-ss-idx="${i}">
      <div class="card-body p-3">
        <div class="d-flex flex-wrap justify-content-between gap-2 mb-2">
          <span class="badge bg-info">REST</span>
          <div class="d-flex align-items-center gap-2">
            <div class="form-check m-0">
              <input class="form-check-input" type="checkbox" id="ssEn${i}" ${en} onchange="syncSmartSensorRowEnabled(${i}, this.checked)">
              <label class="form-check-label" for="ssEn${i}">On</label>
            </div>
            <button type="button" class="btn btn-sm btn-outline-danger" onclick="removeSmartSensorRow(${i})" aria-label="Remove">×</button>
          </div>
        </div>
        <div class="row g-2">
          <div class="col-md-4"><label class="form-label small">Name</label><input class="form-control form-control-sm" id="ssName${i}" value="${escapeHtml(row.name)}"></div>
          <div class="col-md-6"><label class="form-label small">URL</label><input class="form-control form-control-sm" id="ssUrl${i}" value="${escapeHtml(row.restUrl)}"></div>
          <div class="col-md-2"><label class="form-label small">Method</label><select class="form-select form-select-sm" id="ssMethod${i}"><option value="GET" ${row.restMethod === 'POST' ? '' : 'selected'}>GET</option><option value="POST" ${row.restMethod === 'POST' ? 'selected' : ''}>POST</option></select></div>
          <div class="col-md-6"><label class="form-label small">Headers JSON</label><input class="form-control form-control-sm font-monospace" id="ssHdr${i}" value="${escapeHtml(hdr)}"></div>
          <div class="col-md-6"><label class="form-label small">Body (POST)</label><input class="form-control form-control-sm" id="ssBody${i}" value="${escapeHtml(row.restBody)}"></div>
          <div class="col-12 mt-2">
            <div class="fw-semibold small mb-2">${escapeHtml(lblRestFields)}</div>
            ${fieldsRows}
            <button type="button" class="btn btn-sm btn-outline-secondary" onclick="addSmartSensorRestField(${i})"><i class="bi bi-plus-lg me-1"></i>${escapeHtml(lblAddField)}</button>
            <span class="text-muted small ms-2">${escapeHtml(t('smartSensorsRestFieldsHint') || '')}</span>
          </div>
        </div>
      </div>
    </div>`;
    }).join('');
}

function collectSmartSensorsFromEditor() {
    const out = [];
    for (let i = 0; i < smartSensorsEditorRows.length; i++) {
        const base = smartSensorsEditorRows[i];
        const enEl = document.getElementById('ssEn' + i);
        const nameEl = document.getElementById('ssName' + i);
        const enabled = enEl ? !!enEl.checked : base.enabled !== false;
        const name = nameEl ? nameEl.value.trim() : '';
        if (base.type === 'ble') {
            const addr = document.getElementById('ssBleAddr' + i)?.value.trim() || '';
            const svc = document.getElementById('ssBleSvc' + i)?.value.trim() || '1809';
            let channels = [];
            try {
                const raw = document.getElementById('ssBleCh' + i)?.value || '[]';
                const p = JSON.parse(raw);
                if (Array.isArray(p)) channels = p;
            } catch (_) {}
            out.push({
                id: base.id,
                type: 'ble',
                name,
                enabled,
                bleAddress: addr,
                bleServiceUuid: svc,
                bleChannels: channels
            });
        } else {
            persistSmartSensorRestFieldsFromDom(i);
            const row = smartSensorsEditorRows[i];
            const rf = Array.isArray(row.restFields) ? row.restFields : [];
            out.push({
                id: base.id,
                type: 'rest',
                name,
                enabled,
                restUrl: document.getElementById('ssUrl' + i)?.value.trim() || '',
                restMethod: document.getElementById('ssMethod' + i)?.value === 'POST' ? 'POST' : 'GET',
                restHeadersJson: document.getElementById('ssHdr' + i)?.value.trim() || '{}',
                restBody: document.getElementById('ssBody' + i)?.value || '',
                restFields: rf.map((f) => ({
                    label: f.label != null ? String(f.label).trim() : '',
                    path: f.path != null ? String(f.path).trim() : '',
                    enabled: f.enabled !== false
                })).filter((f) => f.path)
            });
        }
    }
    return out;
}

async function loadSmartSensorsSettings() {
    try {
        const res = await fetch('/api/smart-sensors/settings');
        const data = await res.json();
        if (!res.ok || !data.success) throw new Error(data.error || 'load failed');
        const list = Array.isArray(data.configs) ? data.configs : [];
        smartSensorsConfigsForTiles = list;
        smartSensorsEditorRows = list.map((c) => {
            if (c.type === 'ble') {
                return {
                    ...c,
                    bleChannels: Array.isArray(c.bleChannels) ? c.bleChannels : []
                };
            }
            const headersJson = c.restHeaders && typeof c.restHeaders === 'object'
                ? JSON.stringify(c.restHeaders)
                : (c.restHeadersJson != null ? String(c.restHeadersJson) : '{}');
            let restFields = Array.isArray(c.restFields) ? c.restFields.map((f) => ({
                label: f && f.label != null ? String(f.label) : '',
                path: f && f.path != null ? String(f.path) : '',
                enabled: f && f.enabled !== false
            })) : [];
            if (!restFields.length) {
                restFields = [{ label: '', path: '', enabled: true }];
            }
            return {
                ...c,
                type: 'rest',
                restHeadersJson: headersJson,
                restMethod: c.restMethod === 'POST' ? 'POST' : 'GET',
                restBody: c.restBody != null ? String(c.restBody) : '',
                restFields
            };
        });
        renderSmartSensorsSettingsEditor();
        const ble = data.ble || {};
        const el = document.getElementById('smartSensorsBleStatusText');
        if (el) {
            el.textContent = ble.available
                ? `${ble.state || '—'} · ${ble.hint || ''}`
                : (ble.reason || 'unavailable');
        }
    } catch (e) {
        console.warn('smart-sensors settings load', e);
    }
}

async function saveSmartSensorsSettings() {
    const configs = collectSmartSensorsFromEditor();
    try {
        const res = await fetch('/api/smart-sensors/settings', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ configs })
        });
        const data = await res.json();
        if (!res.ok || !data.success) throw new Error(data.error || 'save failed');
        showToast(t('toastSmartSensorsSaved'), 'success');
        await loadSmartSensorsConfigsForTiles();
        renderClusterDashboardTilesSettings();
        await refreshMonitorScreensAvailability();
        updateSmartSensorsDashboard().catch(() => {});
        renderTilesMonitorScreen('tilesNormalGrid').catch(() => {});
        if (!monitorMode || monitorCurrentView === 'tiles') {
            renderTilesMonitorScreen().catch(() => {});
        }
        if (monitorMode && monitorCurrentView === 'smartSensors' && smartSensorsMonitorConfigured === false) {
            applyMonitorView('cluster');
        }
    } catch (e) {
        showToast(tParams('toastSmartSensorsSaveError', { msg: e.message || String(e) }), 'error');
    }
}

function formatSmartSensorMetricEntry(entry) {
    if (!entry) return '—';
    if (entry.value != null && Number.isFinite(Number(entry.value))) {
        const n = Number(entry.value);
        const rounded = Math.abs(n) >= 100 ? Math.round(n) : Math.round(n * 10) / 10;
        return String(rounded);
    }
    if (entry.raw != null) {
        const s = String(entry.raw).trim();
        if (s) return s.length > 32 ? s.slice(0, 32) + '…' : s;
    }
    return '—';
}

function isWebBluetoothAvailable() {
    return typeof navigator !== 'undefined' &&
        !!navigator.bluetooth &&
        typeof navigator.bluetooth.requestDevice === 'function';
}

function normalizeBleUuidClient(input) {
    const raw = String(input || '').trim().toLowerCase().replace(/-/g, '');
    if (!raw) return '';
    if (raw.length <= 4) {
        const short = raw.padStart(4, '0');
        return `0000${short}-0000-1000-8000-00805f9b34fb`;
    }
    if (raw.length === 8) return `${raw}-0000-1000-8000-00805f9b34fb`;
    if (raw.length === 32) return `${raw.slice(0, 8)}-${raw.slice(8, 12)}-${raw.slice(12, 16)}-${raw.slice(16, 20)}-${raw.slice(20)}`;
    return String(input || '').trim().toLowerCase();
}

function decodeBleDataViewValue(dataView, format, scale, offset) {
    if (!dataView) return null;
    const fmt = String(format || 'int16le').trim().toLowerCase();
    const mul = Number.isFinite(Number(scale)) ? Number(scale) : 1;
    const add = Number.isFinite(Number(offset)) ? Number(offset) : 0;
    let v = null;
    try {
        if (fmt === 'int16le' && dataView.byteLength >= 2) v = dataView.getInt16(0, true);
        else if (fmt === 'uint16le' && dataView.byteLength >= 2) v = dataView.getUint16(0, true);
        else if (fmt === 'int16be' && dataView.byteLength >= 2) v = dataView.getInt16(0, false);
        else if (fmt === 'uint16be' && dataView.byteLength >= 2) v = dataView.getUint16(0, false);
        else if (fmt === 'int8' && dataView.byteLength >= 1) v = dataView.getInt8(0);
        else if (fmt === 'uint8' && dataView.byteLength >= 1) v = dataView.getUint8(0);
        else if (fmt === 'floatle' && dataView.byteLength >= 4) v = dataView.getFloat32(0, true);
        else if (fmt === 'floatbe' && dataView.byteLength >= 4) v = dataView.getFloat32(0, false);
    } catch (_) {
        v = null;
    }
    return Number.isFinite(v) ? (v * mul + add) : null;
}

function smartSensorConfigById(sensorId) {
    const sid = String(sensorId || '').trim();
    if (!sid) return null;
    const list = Array.isArray(smartSensorsConfigsForTiles) ? smartSensorsConfigsForTiles : [];
    return list.find((cfg) => String(cfg?.id || '').trim() === sid) || null;
}

async function connectWebBleSensorById(sensorId) {
    if (!isWebBluetoothAvailable()) {
        throw new Error(t('smartSensorsWebBluetoothUnsupported') || 'Web Bluetooth is not available in this browser.');
    }
    const cfg = smartSensorConfigById(sensorId);
    if (!cfg || String(cfg.type || '').toLowerCase() !== 'ble') {
        throw new Error(t('smartSensorsNotConfigured') || 'Sensor not found');
    }
    const serviceUuid = normalizeBleUuidClient(cfg.bleServiceUuid || '1809');
    const channels = Array.isArray(cfg.bleChannels) ? cfg.bleChannels : [];
    if (!channels.length) {
        throw new Error(t('smartSensorMetricChartEmpty') || 'No BLE channels configured');
    }
    const optionalServices = [serviceUuid].filter(Boolean);
    const device = await navigator.bluetooth.requestDevice({
        acceptAllDevices: true,
        optionalServices
    });
    if (!device || !device.gatt) throw new Error('BLE device selection failed');
    const server = await device.gatt.connect();
    const service = await server.getPrimaryService(serviceUuid);
    const characteristicMap = new Map();
    for (const ch of channels) {
        const uuid = normalizeBleUuidClient(ch?.uuid);
        if (!uuid) continue;
        if (characteristicMap.has(uuid)) continue;
        try {
            const characteristic = await service.getCharacteristic(uuid);
            if (characteristic) characteristicMap.set(uuid, characteristic);
        } catch (_) {}
    }
    webBleSensorSessions.set(String(cfg.id), { device, service, characteristicMap });
    return true;
}

async function readWebBleSensorValuesById(sensorId) {
    const sid = String(sensorId || '').trim();
    const cfg = smartSensorConfigById(sid);
    if (!cfg || String(cfg.type || '').toLowerCase() !== 'ble') return null;
    const channels = Array.isArray(cfg.bleChannels) ? cfg.bleChannels : [];
    if (!channels.length) return { error: 'no BLE channels configured', values: {} };
    const session = webBleSensorSessions.get(sid);
    if (!session || !session.service) return { error: 'not connected', values: {} };
    if (!session.device?.gatt?.connected) return { error: 'not connected', values: {} };
    const values = {};
    for (const spec of channels) {
        const uuid = normalizeBleUuidClient(spec?.uuid);
        if (!uuid) continue;
        let characteristic = session.characteristicMap.get(uuid) || null;
        if (!characteristic) {
            try {
                characteristic = await session.service.getCharacteristic(uuid);
                if (characteristic) session.characteristicMap.set(uuid, characteristic);
            } catch (_) {
                characteristic = null;
            }
        }
        if (!characteristic) continue;
        try {
            const val = await characteristic.readValue();
            const key = spec && spec.metric === 'custom' ? (spec.label || 'custom') : (spec?.metric || 'value');
            const num = decodeBleDataViewValue(val, spec?.format, spec?.scale, spec?.offset);
            values[String(key)] = {
                raw: Array.from(new Uint8Array(val.buffer)).map((b) => b.toString(16).padStart(2, '0')).join(''),
                value: num
            };
        } catch (_) {}
    }
    return { error: null, values };
}

function buildSmartSensorsCardsHtml(data) {
    const items = Array.isArray(data.items) ? data.items : [];
    if (!items.length) {
        const msg = t('smartSensorsNotConfigured');
        const err = data?.error ? `: ${data.error}` : '';
        return {
            html: `<div class="col-12"><div class="text-muted small">${escapeHtml(msg + err)}</div></div>`,
            rowClass: 'row g-2'
        };
    }
    const html = items.map((it) => {
        const name = it.name || it.id || '—';
        const hasBtConnect = String(it.type || '').toLowerCase() === 'ble' && isWebBluetoothAvailable();
        const btConnectTitle = t('smartSensorsConnectBtTitle') || 'Connect by Bluetooth';
        const errBlock = it.error ? `<div class="text-danger small mt-2">${escapeHtml(it.error)}</div>` : '';
        const vals = it.values && typeof it.values === 'object' ? it.values : {};
        const keys = Object.keys(vals);
        const numericKeys = keys.filter((k) => Number.isFinite(Number(vals?.[k]?.value)));
        const canOpenMetrics = numericKeys.length > 0;
        const openMetricsTitle = t('smartSensorsAllMetricsCardOpenTitle') || 'Show smart sensor metric history';
        const tiles = keys.length
            ? keys.map((k) => buildClusterDashboardMetricCell(k, formatSmartSensorMetricEntry(vals[k]), null, null, 'col-6 col-md-4')).join('')
            : '<div class="col-12"><span class="text-muted small">—</span></div>';
        const typeBadge = escapeHtml(it.type || '');
        return `
            <div class="col-12 col-md-6">
                <div class="node-card ups-node-card h-100">
                    <div class="d-flex justify-content-between align-items-center mb-2 gap-2">
                        <h5 class="mb-0 text-truncate d-inline-flex align-items-center gap-2" title="${escapeHtml(name)}">${escapeHtml(name)}</h5>
                        <div class="d-inline-flex align-items-center gap-2">
                            ${canOpenMetrics ? `
                            <button
                                type="button"
                                class="btn btn-sm btn-outline-primary smart-sensor-metrics-open-trigger"
                                data-smart-sensor-id="${escapeHtml(String(it.id || ''))}"
                                title="${escapeHtml(openMetricsTitle)}"
                                aria-label="${escapeHtml(openMetricsTitle)}">
                                <i class="bi bi-graph-up"></i>
                            </button>` : ''}
                            ${hasBtConnect ? `
                            <button
                                type="button"
                                class="btn btn-sm btn-outline-secondary smart-sensor-bt-connect-trigger"
                                data-smart-sensor-id="${escapeHtml(String(it.id || ''))}"
                                title="${escapeHtml(btConnectTitle)}"
                                aria-label="${escapeHtml(btConnectTitle)}">
                                <i class="bi bi-bluetooth"></i>
                            </button>` : ''}
                            <span class="badge bg-secondary flex-shrink-0">${typeBadge}</span>
                        </div>
                    </div>
                    <div class="row g-2 small">${tiles}</div>
                    ${errBlock}
                </div>
            </div>`;
    }).join('');
    return { html, rowClass: 'row g-2' };
}

async function updateSmartSensorsDashboard() {
    const cardsEl = document.getElementById('smartSensorsMonitorCards');
    const updatedAtEl = document.getElementById('smartSensorsUpdatedAt');
    if (!cardsEl) return;
    cardsEl.innerHTML = '';
    cardsEl.className = 'row g-2';
    if (updatedAtEl) updatedAtEl.textContent = '';
    try {
        const res = await fetch('/api/smart-sensors/current');
        const data = await res.json();
        const items = Array.isArray(data?.items) ? data.items : [];
        // Browser-side BLE fallback (Windows/macOS) when server BLE stack is unavailable.
        for (const item of items) {
            if (!item || String(item.type || '').toLowerCase() !== 'ble') continue;
            const valuesObj = item.values && typeof item.values === 'object' ? item.values : {};
            if (Object.keys(valuesObj).length && !item.error) continue;
            const webBle = await readWebBleSensorValuesById(item.id).catch(() => null);
            if (webBle && webBle.values && Object.keys(webBle.values).length) {
                item.values = webBle.values;
                item.error = null;
                item.type = 'ble(web)';
            }
        }
        smartSensorsMonitorConfigured = !!(data && data.configured && Array.isArray(data.items) && data.items.length > 0);

        if (!data || !data.configured || !Array.isArray(data.items) || data.items.length === 0) {
            const msg = t('smartSensorsNotConfigured');
            const err = data?.error ? `: ${data.error}` : '';
            cardsEl.innerHTML = `<div class="col-12"><div class="text-muted small">${escapeHtml(msg + err)}</div></div>`;
            if (updatedAtEl && data?.updatedAt) updatedAtEl.textContent = new Date(data.updatedAt).toLocaleString();
            return;
        }
        if (updatedAtEl && data.updatedAt) updatedAtEl.textContent = new Date(data.updatedAt).toLocaleString();
        const { html, rowClass } = buildSmartSensorsCardsHtml(data);
        cardsEl.className = rowClass;
        cardsEl.innerHTML = html;
    } catch (e) {
        cardsEl.innerHTML = `<div class="col-12"><div class="text-danger small">${escapeHtml((e && e.message) ? e.message : String(e))}</div></div>`;
    }
}

// Language switch function
function setLanguage(lang) {
    currentLanguage = lang;
    try {
        document.documentElement.lang = lang || 'ru';
    } catch (_) {}

    document.querySelectorAll('.language-switcher').forEach(btn => {
        btn.classList.remove('active');
        if (btn.dataset.lang === lang) {
            btn.classList.add('active');
        }
    });
    
    try {
        localStorage.setItem('preferred_language', lang);
    } catch (_) {}
    updateUILanguage();
    renderFooterUpdateStatus();
    try {
        if (smartSensorsEditorRows.length && document.getElementById('smartSensorsSettingsEditorRoot')) {
            renderSmartSensorsSettingsEditor();
        }
    } catch (_) {}

    // Re-render server list to update translated tooltips and text
    renderServerList();
    
    if (storageTable) {
        storageTable.destroy();
        storageTable = null;
    }
    if (backupsJobsTable) {
        backupsJobsTable.destroy();
        backupsJobsTable = null;
    }
    if (backupsExecTable) {
        backupsExecTable.destroy();
        backupsExecTable = null;
    }
    renderDashboardTimeWeatherCard();
    try {
        if (document.getElementById('telegramRulesTableBody')) renderTelegramRulesTable();
    } catch (_) {}
}

// Render language switcher buttons dynamically
function renderLanguageSwitchers() {
    const container = document.querySelector('.language-switcher-container');
    if (!container) return;
    
    container.innerHTML = '';
    
    availableLanguages.forEach(langCode => {
        const btn = document.createElement('button');
        btn.className = `btn btn-sm language-switcher${currentLanguage === langCode ? ' active' : ''}`;
        btn.dataset.lang = langCode;
        btn.textContent = langCode.toUpperCase();
        btn.onclick = () => {
            setLanguage(langCode);
            saveSettingsToServer({ preferredLanguage: langCode }).catch(() => {});
        };
        container.appendChild(btn);
    });
}

// Update preferred language in app settings (used as default after .env)
async function updatePreferredLanguage() {
    const select = document.getElementById('settingsPreferredLanguageSelect');
    if (!select) return;
    const lang = select.value;
    try {
        await saveSettingsToServer({ preferredLanguage: lang });
        showToast(t('dataUpdated') || 'Настройки сохранены', 'success');
    } catch (e) {
        console.error('Failed to save preferred language', e);
        showToast(t('connectError') + ': ' + e.message, 'error');
    }
}

// Update all UI texts
function updateUILanguage() {
    const elements = {
        pageTitle: 'appName',
        appName: 'appName',
        serverStatusText: 'serverWorking',
        settingsText: 'settings',
        settingsTitle: 'settingsTitle',
        connectTitle: 'connectTitle',
        connectDesc: 'connectDesc',
        serverTypeLabel: 'serverTypeLabel',
        tokenLabel: 'tokenLabel',
        tokenHint: 'tokenHint',
        connectButton: 'connectButton',
        clusterState: 'appName',
        notConnectedText: 'notConnected',
        refreshText: 'refresh',
        loadingText: 'loadingClusterData',
        totalNodesLabel: 'totalNodes',
        onlineNodesLabel: 'nodesOnline',
        quorumLabel: 'quorum',
        clusterResources: 'clusterResources',
        cpuLabel: 'cpu',
        memoryLabel: 'memory',
        tabNodes: 'tabNodes',
        tabStorage: 'tabStorage',
        tabServers: 'tabServers',
        tabBackups: 'tabBackups',
        tabQuorum: 'tabQuorum',
        tabTiles: 'tabTiles',
        displaySettings: 'displaySettings',
        refreshIntervalLabel: 'refreshIntervalLabel',
        themeLabel: 'themeLabel',
        unitsLabel: 'unitsLabel',
        thresholdSettings: 'thresholdSettings',
        cpuGreenLabel: 'cpuGreenLabel',
        cpuYellowLabel: 'cpuYellowLabel',
        cpuRedLabel: 'cpuRedLabel',
        ramGreenLabel: 'ramGreenLabel',
        ramYellowLabel: 'ramYellowLabel',
        ramRedLabel: 'ramRedLabel',
        resetThresholds: 'resetThresholds',
        storageNodeHeader: 'storageNode',
        storageNameHeader: 'storageName',
        storageTypeHeader: 'storageType',
        storageStatusHeader: 'storageStatus',
        storageUsedHeader: 'storageUsed',
        storageTotalHeader: 'storageTotalSize',
        storageUsageHeader: 'storageUsage',
        storageDetailsHeader: 'storageDetails',
        backupIdHeader: 'backupId',
        backupScheduleHeader: 'backupSchedule',
        backupStatusHeader: 'backupStatus',
        backupStorageHeader: 'backupStorage',
        backupVmidHeader: 'backupVmid',
        backupModeHeader: 'backupMode',
        backupLastRunHeader: 'backupLastRun',
        backupResultHeader: 'backupResult',
        backupNextRunHeader: 'backupNextRun',
        backupSectionJobsTitle: 'backupSectionJobsTitle',
        backupSectionExecTitle: 'backupSectionExecTitle',
        backupJobStateHeader: 'backupJobStateHeader',
        backupExecHint: 'backupExecHint',
        backupExecStartHeader: 'backupExecStartHeader',
        backupExecEndHeader: 'backupExecEndHeader',
        backupExecNodeHeader: 'backupExecNodeHeader',
        backupExecTargetHeader: 'backupExecTargetHeader',
        backupExecStatusHeader: 'backupExecStatusHeader',
        backupExecResultHeader: 'backupExecResultHeader',
        backupExecUserHeader: 'backupExecUserHeader',
        backupExecUpidHeader: 'backupExecUpidHeader',
        backupExecShown: 'backupExecShown',
        tabServicesMonitor: 'tabServicesMonitor',
        menuServicesMonitorText: 'tabServicesMonitor',
        servicesMonitorTitle: 'servicesMonitorTitle',
        serviceNameLabel: 'serviceNameLabel',
        serviceTypeLabel: 'serviceTypeLabel',
        serviceHostLabel: 'serviceHostLabel',
        servicePortLabel: 'servicePortLabel',
        serviceUrlLabel: 'serviceUrlLabel',
        addServiceText: 'addServiceText',
        servicesListTitle: 'servicesListTitle',
        pingAllText: 'pingAllText',
        serviceNameHeader: 'serviceNameHeader',
        serviceTypeHeader: 'serviceTypeHeader',
        serviceTargetHeader: 'serviceTargetHeader',
        serviceStatusHeader: 'serviceStatusHeader',
        serviceLatencyHeader: 'serviceLatencyHeader',
        serviceActionsHeader: 'serviceActionsHeader',
        backToDashboardText: 'backToDashboardText',
        logoutText: 'logoutText',
        // New connection settings
        connectionSettings: 'connectionSettings',
        apiTokenLabel: 'apiTokenLabel',
        testConnectionBtn: 'testConnectionBtn',
        connectionStatusConnected: 'connectionStatusConnected',
        connectionStatusDisconnected: 'connectionStatusDisconnected',
        proxmoxServersLabel: 'proxmoxServersLabel',
        proxmoxServersHint: 'proxmoxServersHint',
        addServer: 'addServer',
        truenasConnectTitle: 'truenasConnectTitle',
        truenasConnectDesc: 'truenasConnectDesc',
        truenasKeyLabel: 'truenasKeyLabel',
        truenasKeyHint: 'truenasKeyHint',
        truenasServersLabel: 'truenasServersLabel',
        truenasServersHint: 'truenasServersHint',
        addServerTrueNAS: 'addServer',
        logoutTextTrueNAS: 'logoutText',
        connectButtonTrueNAS: 'connectButton',
        testConnectionBtnTextProxmox: 'testConnectionBtn',
        testConnectionBtnTextTrueNAS: 'testConnectionBtn',
        removeServer: 'removeServer',
        currentServer: 'currentServer',
        monitorModeText: 'monitorMode',
        menuHomelabHomeText: 'menuHomelabLabel',
        menuVmsMonitorText: 'menuVmsMonitorText',
        menuNetdevMonitorText: 'monitorScreenNetdev',
        menuSpeedtestMonitorText: 'monitorScreenSpeedtest',
        menuIperf3MonitorText: 'monitorScreenIperf3',
        menuUpsMonitorText: 'monitorScreenUps',
        menuSmartSensorsMonitorText: 'monitorScreenSmartSensors',
        menuTruenasPoolsMonitorText: 'menuTruenasPoolsMonitor',
        menuTruenasDisksMonitorText: 'menuTruenasDisksMonitor',
        menuTruenasServicesMonitorText: 'menuTruenasServicesMonitor',
        menuTruenasAppsMonitorText: 'menuTruenasAppsMonitor',
        resetBackendProxmoxText: 'settingsResetBackendProxmox',
        resetBackendTrueNASText: 'settingsResetBackendTrueNAS',
        settingsNavUps: 'settingsNavUps',
        settingsNavVms: 'settingsNavVms',
        settingsNavNetdevices: 'settingsNavNetdevices',
        settingsNavHostMetrics: 'settingsNavHostMetrics',
        settingsNavIpmi: 'settingsNavIpmi',
        settingsNavSmartSensors: 'settingsNavSmartSensors',
        settingsNavSpeedtest: 'settingsNavSpeedtest',
        settingsNavIperf3: 'settingsNavIperf3',
        settingsNavTelegramIntegration: 'settingsNavTelegramIntegration',
        settingsSavedViewsTitle: 'settingsSavedViewsTitle',
        settingsSavedViewsHint: 'settingsSavedViewsHint',
        settingsSavedViewSaveBtnText: 'settingsSavedViewSaveBtnText',
        settingsSavedTileViewsTitle: 'settingsSavedTileViewsTitle',
        settingsSavedTileViewsHint: 'settingsSavedTileViewsHint',
        settingsSavedTileViewSaveBtnText: 'settingsSavedTileViewSaveBtnText',
        settingsTelegramTitle: 'settingsTelegramTitle',
        settingsTelegramHint: 'settingsTelegramHint',
        settingsTelegramBotTokenLabel: 'settingsTelegramBotTokenLabel',
        settingsTelegramBotTokenHelp: 'settingsTelegramBotTokenHelp',
        settingsTelegramProxyUrlLabel: 'settingsTelegramProxyUrlLabel',
        settingsTelegramProxyUrlHelp: 'settingsTelegramProxyUrlHelp',
        settingsTelegramNotifyEnabledLabel: 'settingsTelegramNotifyEnabledLabel',
        settingsTelegramIntervalLabel: 'settingsTelegramIntervalLabel',
        settingsTelegramSaveText: 'settingsTelegramSaveText',
        settingsTelegramClearTokenText: 'settingsTelegramClearTokenText',
        settingsTelegramRulesTitle: 'settingsTelegramRulesTitle',
        settingsTelegramAddRuleText: 'settingsTelegramAddRuleText',
        settingsTelegramRulesHint: 'settingsTelegramRulesHint',
        settingsTelegramRuleTypeHeader: 'settingsTelegramRuleTypeHeader',
        settingsTelegramRuleTargetHeader: 'settingsTelegramRuleTargetHeader',
        settingsTelegramRuleExtraHeader: 'settingsTelegramRuleExtraHeader',
        settingsTelegramRuleMessageHeader: 'settingsTelegramRuleMessageHeader',
        settingsTelegramRulesMessageHintShort: 'telegramRulesMessageHintShort',
        settingsTelegramRuleChatHeader: 'settingsTelegramRuleChatHeader',
        settingsTelegramRuleThreadHeader: 'settingsTelegramRuleThreadHeader',
        settingsTelegramFetchChatsText: 'settingsTelegramFetchChats',
        settingsTelegramFetchChatsHelp: 'settingsTelegramFetchChatsHelp',
        settingsTelegramNotifyOpt0: 'settingsTelegramNotifyOptionOff',
        settingsTelegramNotifyOpt1: 'settingsTelegramNotifyOptionOn',
        settingsServiceIconHeader: 'settingsServiceIconHeader',
        settingsVmIconHeader: 'settingsVmIconHeader'
    };
    
    for (const [id, key] of Object.entries(elements)) {
        const el = document.getElementById(id);
        if (el) el.textContent = t(key);
    }
    setText('settingsSavedViewsTitle', tOr('settingsSavedViewsTitle', 'Saved views'));
    setText('settingsSavedViewsHint', tOr('settingsSavedViewsHint', 'Save current monitor layout as preset and apply in one click.'));
    setText('settingsSavedViewSaveBtnText', tOr('settingsSavedViewSaveBtnText', 'Save current'));
    setText('settingsSavedTileViewsTitle', tOr('settingsSavedTileViewsTitle', 'Saved tile views'));
    setText('settingsSavedTileViewsHint', tOr('settingsSavedTileViewsHint', 'Save current tiles layout and chart options as a preset.'));
    setText('settingsSavedTileViewSaveBtnText', tOr('settingsSavedTileViewSaveBtnText', 'Save tiles'));
    localizeTelegramMessageModal();
    
    // Update theme and units button texts
    const themeLight = document.getElementById('themeLight');
    const themeDark = document.getElementById('themeDark');
    const unitsDecimal = document.getElementById('unitsDecimal');
    const unitsBinary = document.getElementById('unitsBinary');
    if (themeLight) themeLight.innerHTML = '<i class="bi bi-sun me-1"></i> ' + t('themeLight');
    if (themeDark) themeDark.innerHTML = '<i class="bi bi-moon me-1"></i> ' + t('themeDark');
    if (unitsDecimal) unitsDecimal.textContent = t('unitsDecimal');
    if (unitsBinary) unitsBinary.textContent = t('unitsBinary');
    const monitorModeBtn = document.getElementById('monitorModeBtn');
    if (monitorModeBtn) monitorModeBtn.title = t('monitorModeTitle');
    const monitorToolbarTitle = document.getElementById('monitorToolbarTitle');
    if (monitorToolbarTitle) monitorToolbarTitle.textContent = t('monitorMode');
    const monitorExitBtnText = document.getElementById('monitorExitBtnText');
    if (monitorExitBtnText) monitorExitBtnText.textContent = t('monitorExitText');
    const monitorExitBtn = document.getElementById('monitorExitBtnFixed');
    if (monitorExitBtn) monitorExitBtn.title = t('monitorExitTitle');
    const monitorSettingsBtnText = document.getElementById('monitorSettingsBtnText');
    if (monitorSettingsBtnText) monitorSettingsBtnText.textContent = t('settings');
    const monitorSettingsBtn = document.getElementById('monitorSettingsBtn');
    if (monitorSettingsBtn) monitorSettingsBtn.title = t('settingsTitle') || t('settings');
    const monitorToolbarHideBtn = document.getElementById('monitorToolbarHideBtn');
    if (monitorToolbarHideBtn) monitorToolbarHideBtn.title = t('monitorToolbarHideTitle');
    const monitorToolbarReveal = document.getElementById('monitorToolbarReveal');
    if (monitorToolbarReveal) monitorToolbarReveal.title = t('monitorToolbarShowTitle');
    const monitorHomeBtn = document.getElementById('monitorHomeBtn');
    if (monitorHomeBtn) {
        const homeTitle = t('monitorToolbarHomeTitle');
        monitorHomeBtn.title = homeTitle;
        monitorHomeBtn.setAttribute('aria-label', homeTitle);
    }
    const monitorRefreshBtn = document.getElementById('monitorRefreshBtn');
    if (monitorRefreshBtn) monitorRefreshBtn.title = t('monitorRefreshTitle');
    const monitorThemeLight = document.getElementById('monitorThemeLight');
    const monitorThemeDark = document.getElementById('monitorThemeDark');
    if (monitorThemeLight) monitorThemeLight.title = t('themeLight');
    if (monitorThemeDark) monitorThemeDark.title = t('themeDark');
    if (monitorMode) {
        setText('monitorTotalNodesLabel', t('totalNodes'));
        setText('monitorOnlineNodesLabel', t('nodesOnline'));
        setText('monitorQuorumLabel', t('quorum'));
        setText('monitorNodesTitle', (!getAuthHeadersForType('proxmox') && getAuthHeadersForType('truenas')) ? t('tabServers') : t('tabNodes'));
        setText('monitorServicesTitle', t('tabServicesMonitor'));
        setText('backupsMonitorTitle', t('backupSectionExecTitle'));
        updateMonitorToolbarTitleForView();
    }
    setText('monitorBlockVmTitle', t('monitorBlockVm'));
    setText('monitorBlockCtTitle', t('monitorBlockCt'));
    setText('monitorVmTotalLbl', t('monitorGuestTotal'));
    setText('monitorVmRunningLbl', t('monitorGuestRunning'));
    setText('monitorCtTotalLbl', t('monitorGuestTotal'));
    setText('monitorCtRunningLbl', t('monitorGuestRunning'));
    setText('dashboardClusterVmTitle', t('monitorBlockVm'));
    setText('dashboardClusterCtTitle', t('monitorBlockCt'));
    setText('dashboardClusterVmTotalLbl', t('monitorGuestTotal'));
    setText('dashboardClusterCtTotalLbl', t('monitorGuestTotal'));
    setText('upsTitle', t('upsTitle') || 'UPS');
    setText('smartSensorsMonitorTitle', t('monitorScreenSmartSensors'));
    setText('smartSensorsSettingsTitle', t('smartSensorsSettingsTitle'));
    setText('smartSensorsSettingsHint', t('smartSensorsSettingsHint'));
    setText('smartSensorsBleStatusLabel', t('smartSensorsBleStatusLabel'));
    setText('smartSensorsAddRestBtn', t('smartSensorsAddRest') || 'REST');
    setText('smartSensorsAddBleBtn', t('smartSensorsAddBle') || 'Bluetooth');
    setText('smartSensorsSaveButtonText', t('smartSensorsSaveButton') || 'Save');
    setText('monitorDrawHint', t('monitorDrawHint') || '');
    setText('monitorDrawColorLabel', t('monitorDrawColorLabel') || 'Color');
    setText('monitorDrawWidthLabel', t('monitorDrawWidthLabel') || 'Brush');
    setText('monitorDrawPenText', t('monitorDrawPen') || 'Pen');
    setText('monitorDrawEraserText', t('monitorDrawEraser') || 'Eraser');
    setText('monitorDrawClearText', t('monitorDrawClear') || 'Clear');
    setText('monitorDrawDisableSwipesLabel', t('monitorDrawDisableSwipes') || '');
    setText('upsLabelInputVoltage', t('upsLabelInputVoltage') || 'Вход U');
    setText('upsLabelOutputVoltage', t('upsLabelOutputVoltage') || 'Выход U');
    setText('upsLabelPower', t('upsLabelPower') || 'Мощность');
    setText('upsLabelLoad', t('upsLabelLoad') || 'Нагрузка');
    setText('upsLabelFrequency', t('upsLabelFrequency') || 'Частота');
    setText('upsLabelCharge', t('upsLabelCharge') || 'Заряд');
    setText('upsLabelRuntime', t('upsLabelRuntime') || 'Время на батарее');
    setText('settingsServicesTitle', t('settingsServicesTitle'));
    setText('settingsServicesHint', t('settingsServicesHint'));
    setText('servicesMonitorHint', t('servicesMonitorHint'));
    setText('pingAllTextMonitor', t('pingAllText') || 'Проверить все');
    setText('settingsServiceNameLabel', t('serviceNameLabel'));
    setText('settingsServiceTypeLabel', t('serviceTypeLabel'));
    setText('settingsServiceHostLabel', t('serviceHostLabel'));
    setText('settingsServicePortLabel', t('servicePortLabel'));
    setText('settingsServiceUrlLabel', t('serviceUrlLabel'));
    setText('settingsServiceNameHeader', t('serviceNameHeader'));
    setText('settingsServiceTypeHeader', t('serviceTypeHeader'));
    setText('settingsServiceTargetHeader', t('serviceTargetHeader'));
    setText('settingsServiceIconHeader', t('settingsServiceIconHeader') || 'Иконка');
    setText('settingsServiceMonitorVisibleHeader', t('settingsServiceShowInMonitor'));
    setText('settingsServiceActionsHeader', t('serviceActionsHeader'));
    setText('settingsVmsTitle', t('settingsVmsTitle') || 'VM/CT для мониторинга');
    setText('settingsVmsHint', t('settingsVmsHint') || 'Введите ID или имя VM/CT и нажмите «Добавить» — гость будет отображаться в режиме монитора. Список загружается с Proxmox по кнопке «Обновить».');
    setText('settingsVmNameLabel', t('settingsVmNameLabel') || 'Имя');
    setText('settingsVmTypeLabel', t('settingsVmTypeLabel') || 'Тип');
    setText('settingsVmIdOrNameLabel', t('settingsVmIdOrNameLabel') || 'ID или имя VM/CT');
    setText('addVmToMonitorBtnText', t('addVmToMonitorBtnText') || 'Добавить');
    setText('loadClusterVmsBtnText', t('loadClusterVmsBtnText') || 'Обновить список VM/CT');
    setText('settingsVmNameHeader', t('settingsVmNameHeader') || 'Имя');
    setText('settingsVmTypeHeader', t('settingsVmTypeHeader') || 'Тип');
    setText('settingsVmNoteHeader', t('settingsVmNoteHeader') || 'Примечание');
    setText('settingsVmStatusHeader', t('settingsVmStatusHeader') || 'Статус');
    setText('settingsVmIconHeader', t('settingsVmIconHeader') || 'Иконка');
    setText('settingsVmShowInMonitorHeader', t('settingsVmShowInMonitor') || 'В режиме монитора');
    setText('settingsVmActionsHeader', t('settingsVmActionsHeader') || 'Действия');
    setText('settingsNavImportExport', t('settingsNavImportExport') || 'Импорт / экспорт');
    setText('settingsImportExportTitle', t('settingsImportExportTitle') || 'Импорт / экспорт');
    setText('settingsServicesOnlyTitle', t('settingsServicesOnlyTitle') || 'Только хосты мониторинга');
    setText('settingsServicesOnlyHint', t('settingsServicesOnlyHint') || 'Экспорт или импорт только списка хостов для мониторинга сервисов.');
    setText('settingsExportServicesBtn', t('settingsExportServicesBtn') || 'Экспорт хостов');
    setText('settingsImportServicesBtn', t('settingsImportServicesBtn') || 'Импорт хостов');
    setText('settingsVmsOnlyTitle', t('settingsVmsOnlyTitle') || 'Только VM/CT');
    setText('settingsVmsOnlyHint', t('settingsVmsOnlyHint') || 'Экспорт или импорт только списков мониторинга VM/CT.');
    setText('settingsExportVmsBtn', t('settingsExportVmsBtn') || 'Экспорт VM/CT');
    setText('settingsImportVmsBtn', t('settingsImportVmsBtn') || 'Импорт VM/CT');
    setText('settingsAllTitle', t('settingsAllTitle') || 'Полная конфигурация');
    setText('settingsAllHint', t('settingsAllHintTokens') || t('settingsAllHint') || '');
    setText('settingsExportAllBtn', t('settingsExportAllBtn') || 'Экспорт всех настроек');
    setText('settingsImportAllBtn', t('settingsImportAllBtn') || 'Импорт всех настроек');
    setText('settingsNavConnection', t('settingsNavConnection'));
        setText('settingsNavCategoryConnection', t('settingsNavCategoryConnection'));
        setText('settingsNavCategoryInterface', t('settingsNavCategoryInterface'));
        setText('settingsNavCategoryMonitoring', t('settingsNavCategoryMonitoring'));
        setText('settingsNavCategoryAlerts', t('settingsNavCategoryAlerts'));
        setText('settingsNavCategorySystem', t('settingsNavCategorySystem'));
        setText('settingsNavDisplay', t('settingsNavDisplay'));
        setText('settingsNavDisplayTimeWeather', t('settingsNavDisplayTimeWeather'));
        setText('settingsNavDisplayMonitorScreens', t('settingsNavDisplayMonitorScreens'));
        setText('settingsNavDisplayClusterTiles', t('settingsNavDisplayClusterTiles'));
        setText('settingsNavStyles', t('settingsNavStyles'));
        setText('settingsStylesTitle', t('settingsStylesTitle') || 'Стили');
        setText('settingsStylesVariantLabel', t('settingsStylesVariantLabel') || 'Вариант для редактирования');
        setText('settingsStylesHint', t('settingsStylesHint') || 'Настройки меняют оверрайды для карточек, заголовков, таблиц и прогресса. Оверрайды применяются только к выбранному варианту.');
        setText('settingsStylesCardBgLabel', t('settingsStylesCardBgLabel') || 'Фон карточек (`.card`)');
        setText('settingsStylesCardTextColorLabel', t('settingsStylesCardTextColorLabel') || 'Цвет текста карточек');
        setText('settingsStylesCardHeaderFromLabel', t('settingsStylesCardHeaderFromLabel') || 'Градиент заголовка (`.card-header`) — старт');
        setText('settingsStylesCardHeaderToLabel', t('settingsStylesCardHeaderToLabel') || 'Градиент заголовка (`.card-header`) — конец');
        setText('settingsStylesCardHeaderTextColorLabel', t('settingsStylesCardHeaderTextColorLabel') || 'Цвет текста заголовка (`.card-header`)');
        setText('settingsStylesStatValueColorLabel', t('settingsStylesStatValueColorLabel') || 'Цвет значений (`.stat-value` / `monitor-view__stat-value`)');
        setText('settingsStylesStatLabelColorLabel', t('settingsStylesStatLabelColorLabel') || 'Цвет подписей (`.stat-label` / `monitor-view__stat-label`)');
        setText('settingsStylesTableHeaderBgLabel', t('settingsStylesTableHeaderBgLabel') || 'Заголовок таблицы (`.table th`) — bg');
        setText('settingsStylesTableHeaderTextColorLabel', t('settingsStylesTableHeaderTextColorLabel') || 'Заголовок таблицы (`.table th`) — text');
        setText('settingsStylesTableCellTextColorLabel', t('settingsStylesTableCellTextColorLabel') || 'Текст таблицы (`.table td`)');
        setText('settingsStylesTableBorderColorLabel', t('settingsStylesTableBorderColorLabel') || 'Цвет границ таблицы');
        setText('settingsStylesTableHoverTdBgLabel', t('settingsStylesTableHoverTdBgLabel') || 'Фон таблицы при hover (`tr:hover td`)');
        setText('settingsStylesProgressBgLabel', t('settingsStylesProgressBgLabel') || 'Фон прогресса (`.progress`)');
        setText('settingsStylesMonitorViewCardBgLabel', t('settingsStylesMonitorViewCardBgLabel') || 'Фон карточек монитора (`.monitor-view__card`)');
        setText('settingsStylesSaveBtnText', t('settingsStylesSaveBtnText') || 'Сохранить');
        setText('settingsStylesResetBtnText', t('settingsStylesResetBtnText') || 'Сбросить вариант');
        setText('settingsStylesExportBtnText', t('settingsStylesExportBtnText') || 'Выгрузить (JSON)');
        setText('settingsStylesImportBtnText', t('settingsStylesImportBtnText') || 'Загрузить (JSON)');
        setText('settingsStylesDisableBtnText', t('settingsStylesDisableBtnText') || 'Отключить кастомные стили');

        // Localize select options for the styles tab.
        const stylesVariantSelect = document.getElementById('customThemeVariantSelect');
        if (stylesVariantSelect) {
            const setOptionText = (value, key) => {
                const opt = stylesVariantSelect.querySelector('option[value="' + value + '"]');
                if (opt) opt.textContent = t(key);
            };
            setOptionText('normalLight', 'settingsStylesVariantNormalLight');
            setOptionText('normalDark', 'settingsStylesVariantNormalDark');
            setOptionText('monitorLight', 'settingsStylesVariantMonitorLight');
            setOptionText('monitorDark', 'settingsStylesVariantMonitorDark');
        }
        setText('settingsMonitorScreensOrderTitle', t('settingsMonitorScreensOrderTitle'));
        setText('settingsMonitorScreensOrderHint', t('settingsMonitorScreensOrderHint'));
        setText('settingsMonitorDefaultScreenLabel', t('settingsMonitorDefaultScreenLabel'));
        setText('settingsMonitorDefaultScreenHint', t('settingsMonitorDefaultScreenHint'));
        renderSettingsMonitorScreensOrderList();
    setText('settingsNavThresholds', t('settingsNavThresholds'));
    setText('settingsNavServices', t('settingsNavServices'));
    setText('settingsNavDebug', t('settingsNavDebug'));
    setText('settingsNavAbout', t('settingsNavAbout') || 'About');
    setText('settingsDebugTitle', t('settingsDebugTitle'));
    setText('settingsDebugHint', t('settingsDebugHint'));
    setText('settingsDebugServerTitle', t('settingsDebugServerTitle'));
    setText('settingsDebugClientTitle', t('settingsDebugClientTitle'));
    setText('settingsDebugRefreshText', t('settingsDebugRefreshText') || 'Refresh metrics');
    setText('settingsDebugPingText', t('settingsDebugPingText') || 'Ping API');
    setText('settingsDebugClearCacheText', t('settingsDebugClearCacheText') || 'Clear cache');
    setText('settingsDebugResetAllText', t('settingsDebugResetAllText') || 'Reset all settings');
    setText('settingsDebugExportText', t('settingsDebugExportText') || 'Download report');
    setText('settingsDebugReloadPageText', t('settingsDebugReloadPageText') || 'Reload page');
    setText('settingsDebugReloadText', t('settingsDebugReloadText') || 'Reload application');
    setText('settingsDebugResetAllConfirmLabel', t('settingsDebugResetAllConfirmLabel') || 'Confirm by checkbox to reset all settings');
    setText('settingsNavSecurity', t('settingsNavSecurity'));
    setText('settingsSecurityTitle', t('settingsSecurityTitle'));
    setText('settingsSecurityHint', t('settingsSecurityHint'));
    setText('settingsAboutTitle', t('settingsAboutTitle') || 'About');
    const footerUpdBtn = document.getElementById('footerCheckUpdatesBtn');
    if (footerUpdBtn) {
        const lbl = t('checkUpdatesButton') || 'Check for updates';
        footerUpdBtn.setAttribute('title', lbl);
        footerUpdBtn.setAttribute('aria-label', lbl);
    }
    localizeAppUpdateApplyModal();
    setText('settingsPasswordCurrentLabel', t('settingsPasswordCurrentLabel'));
    setText('settingsPasswordNewLabel', t('settingsPasswordNewLabel'));
    setText('settingsPasswordRepeatLabel', t('settingsPasswordRepeatLabel'));
    setText('settingsPasswordApplyText', isSettingsPasswordEnabled() ? t('settingsPasswordChange') : t('settingsPasswordEnable'));
    setText('settingsPasswordDisableText', t('settingsPasswordDisable'));
    setText('settingsUnlockModalTitleText', t('enterSettingsPassword'));
    setText('settingsUnlockPasswordLabel', t('settingsUnlockPasswordLabel') || t('settingsPasswordCurrentLabel') || 'Пароль');
    setText('settingsUnlockSubmitText', t('settingsUnlockSubmitText') || 'Войти');
    setText('settingsUnlockCancelText', t('settingsUnlockCancelText') || 'Отмена');
    setText('settingsSessionTtlLabel', t('settingsSessionTtlLabel') || 'Время жизни сессии (мин)');
    setText('settingsSessionTtlHint', t('settingsSessionTtlHint') || 'Повторный ввод пароля не требуется в течение этого времени после входа.');
    setText('settingsLogoutText', t('settingsLogoutText') || 'Выйти из настроек');

    const unlockClose = document.getElementById('settingsUnlockModalCloseBtn');
    if (unlockClose) unlockClose.setAttribute('aria-label', t('ariaClose'));

    setText('apiTokenIdPartHint', t('tokenPartBeforeEquals'));
    setText('apiTokenSecretHint', t('tokenPartSecretHint'));

    setText('upsSettingsCardTitle', t('upsSettingsCardTitle'));
    setText('upsSlotLabel', t('upsSlotLabel'));
    setText('upsEnabledLabel', t('upsEnabledLabel'));
    setText('upsTypeLabel', t('serviceTypeLabel'));
    setText('upsHostLabel', t('serviceHostLabel'));
    setText('upsPortLabel', t('servicePortLabel'));
    setText('upsDisplayDashboardTabLabel', t('upsDisplayNormalModeTab'));
    setText('upsDisplayMonitorTabLabel', t('upsDisplayMonitorModeTab'));
    setText('upsShowOnDashboardLabel', t('upsShowOnDashboardLabel'));
    setText('upsShowOnMonitorClusterLabel', t('upsShowOnMonitorClusterLabel'));
    setText('upsSaveButtonText', t('upsSaveButton'));
    setText('settingsDashboardTimeWeatherTitle', t('settingsDashboardTimeWeatherTitle'));
    setText('settingsDashboardTimeWeatherHint', t('settingsDashboardTimeWeatherHint'));
    setText('settingsDashboardWeatherCityLabel', t('settingsDashboardWeatherCityLabel'));
    setText('settingsDashboardWeatherCityHint', t('settingsDashboardWeatherCityHint'));
    setText('settingsDashboardWeatherProviderLabel', t('settingsDashboardWeatherProviderLabel'));
    setText('settingsDashboardWeatherProviderHint', t('settingsDashboardWeatherProviderHint'));
    setText('settingsWeatherOwmKeyLabel', t('settingsWeatherOwmKeyLabel'));
    setText('settingsWeatherOwmKeyHint', t('settingsWeatherOwmKeyHint'));
    setText('settingsWeatherYandexKeyLabel', t('settingsWeatherYandexKeyLabel'));
    setText('settingsWeatherYandexKeyHint', t('settingsWeatherYandexKeyHint'));
    setText('settingsWeatherGismeteoKeyLabel', t('settingsWeatherGismeteoKeyLabel'));
    setText('settingsWeatherGismeteoKeyHint', t('settingsWeatherGismeteoKeyHint'));
    setText('settingsDashboardTimezoneLabel', t('settingsDashboardTimezoneLabel'));
    setText('settingsDashboardTimezoneHint', t('settingsDashboardTimezoneHint'));
    setText('settingsDashboardTimeWeatherSaveBtnLabel', t('settingsDashboardTimeWeatherSaveBtn'));
    setText('settingsDashboardVisibilityNormalTitle', t('settingsDashboardVisibilityNormalTitle'));
    setText('settingsDashboardVisibilityMonitorTitle', t('settingsDashboardVisibilityMonitorTitle'));
    setText('settingsDashboardShowTimeLabel', t('settingsDashboardShowTimeLabel'));
    setText('settingsDashboardShowWeatherLabel', t('settingsDashboardShowWeatherLabel'));
    setText('settingsMonitorShowTimeLabel', t('settingsMonitorShowTimeLabel'));
    setText('settingsMonitorShowWeatherLabel', t('settingsMonitorShowWeatherLabel'));
    setText('settingsMonitorDisableChromeGesturesLabel', t('settingsMonitorDisableChromeGesturesLabel'));
    setText('monitorHotkeysTitle', t('monitorHotkeysTitle'));
    setText('monitorHotkeysHint', t('monitorHotkeysHint'));
    setText('monitorHotkeysComboLabel', t('monitorHotkeysComboLabel'));
    setText('monitorHotkeysClicksLabel', t('monitorHotkeysClicksLabel'));
    setText('monitorHotkeysActionLabel', t('monitorHotkeysActionLabel'));
    setText('monitorHotkeysEnabledLabel', t('monitorHotkeysEnabledLabel'));
    setPlaceholder('settingsDashboardWeatherCityInput', t('settingsDashboardWeatherCityPlaceholder') || 'Berlin');
    setPlaceholder('settingsDashboardTimezoneInput', t('settingsDashboardTimezonePlaceholder') || 'Europe/Berlin');
    onDashboardWeatherProviderChange();
    renderMonitorHotkeysSettingsUI();
    setText('settingsClusterTilesTitle', t('settingsClusterTilesTitle'));
    setText('settingsClusterTilesHint', t('settingsClusterTilesHint'));
    setText('settingsMonitorTilesChartAxisGroupHint', t('settingsMonitorTilesChartAxisGroupHint'));
    setText('settingsMonitorTilesChartAxisTimeLabel', t('settingsMonitorTilesChartAxisTime'));
    setText('settingsMonitorTilesChartAxisValuesLabel', t('settingsMonitorTilesChartAxisValues'));
    setText('settingsMonitorTilesChartAxisYUnitLabel', t('settingsMonitorTilesChartAxisYUnit'));
    setText('settingsMetricsHistoryRetentionHoursLabel', tOr('settingsMetricsHistoryRetentionHoursLabel', 'History retention'));
    setText('settingsTilesChartDisplayVariantLabel', tOr('settingsTilesChartDisplayVariantLabel', 'Tiles chart style'));
    setText('settingsChartWindowTitle', tOr('settingsChartWindowTitle', 'Chart window by type'));
    setText('settingsChartWindowClusterLabel', tOr('settingsChartWindowClusterLabel', 'Cluster'));
    setText('settingsChartWindowHostLabel', tOr('settingsChartWindowHostLabel', 'Host'));
    setText('settingsChartWindowUpsLabel', tOr('settingsChartWindowUpsLabel', 'UPS'));
    setText('settingsChartWindowSmartSensorLabel', tOr('settingsChartWindowSmartSensorLabel', 'Smart sensor'));
    setText('settingsClusterTilesAddBtnLabel', t('settingsClusterTilesAddBtn'));
    setText('settingsClusterTilesSaveBtnLabel', t('settingsClusterTilesSaveBtn'));
    const upsTypeSel = document.getElementById('upsTypeSelect');
    const upsFieldsTitleEl = document.getElementById('upsFieldsSectionTitle');
    if (upsTypeSel && upsFieldsTitleEl) {
        upsFieldsTitleEl.textContent = upsTypeSel.value === 'snmp'
            ? (t('upsFieldsTitleSnmp') || 'Поля SNMP (OID), до 15')
            : (t('upsFieldsTitleNut') || 'Поля NUT (VAR), до 15');
    }
    setText('upsFieldsHelpText', t('upsFieldsHelpText'));
    setText('upsNutNameLabel', t('upsNutNameLabel'));

    setText('netdevSettingsCardTitle', t('netdevSettingsCardTitle'));
    setText('netdevSlotLabel', t('netdevSlotLabel'));
    setText('netdevEnabledLabel', t('netdevEnabledLabel'));
    setText('netdevHostLabel', t('serviceHostLabel'));
    setText('netdevSnmpPortLabel', t('netdevSnmpPortLabel'));
    setText('netdevCommunityLabel', t('netdevCommunityLabel'));
    setText('netdevDeviceNameLabel', t('netdevDeviceNameLabel'));
    setText('netdevNameOidLabel', t('netdevNameOidLabel'));
    setText('netdevFieldsSectionTitle', t('netdevFieldsSectionTitle'));
    setText('netdevFieldsHelpText', t('netdevFieldsHelpText'));
    setText('netdevDisplayDashboardTabLabel', t('netdevDisplayNormalTab'));
    setText('netdevDisplayMonitorTabLabel', t('netdevDisplayMonitorTab'));
    setText('netdevShowOnDashboardLabel', t('netdevShowOnDashboardLabel'));
    setText('netdevShowOnMonitorLabel', t('netdevShowOnMonitorLabel'));
    setText('netdevSaveButtonText', t('netdevSaveButton'));
    setText('hostMetricsSettingsTitle', t('hostMetricsSettingsTitle'));
    setText('hostMetricsSettingsHint', t('hostMetricsSettingsHint'));
    setText('hostMetricsPollIntervalLabel', t('hostMetricsPollIntervalLabel'));
    setText('hostMetricsPollIntervalHint', t('hostMetricsPollIntervalHint'));
    setText('hostMetricsTimeoutLabel', t('hostMetricsTimeoutLabel'));
    setText('hostMetricsTimeoutHint', t('hostMetricsTimeoutHint'));
    setText('hostMetricsCacheTtlLabel', t('hostMetricsCacheTtlLabel'));
    setText('hostMetricsCacheTtlHint', t('hostMetricsCacheTtlHint'));
    setText('hostMetricsCriticalTempLabel', t('hostMetricsCriticalTempLabel'));
    setText('hostMetricsCriticalTempHint', t('hostMetricsCriticalTempHint'));
    setText('hostMetricsCriticalLinkLabel', t('hostMetricsCriticalLinkLabel'));
    setText('hostMetricsCriticalLinkHint', t('hostMetricsCriticalLinkHint'));
    setText('hostMetricsRefreshDiscoveryText', t('hostMetricsRefreshDiscoveryText'));
    setText('hostMetricsNodeHeader', t('tabNodes') || 'Узел');
    setText('hostMetricsAgentIpHostHeader', t('hostMetricsAgentIpHostHeader'));
    setText('hostMetricsEnabledHeader', t('hostMetricsEnabledHeader'));
    setText('hostMetricsAgentPortHeader', t('hostMetricsAgentPortHeader'));
    setText('hostMetricsAgentEndpointHeader', t('hostMetricsAgentEndpointHeader'));
    setText('hostMetricsCpuSensorHeader', t('hostMetricsCpuSensorHeader'));
    setText('hostMetricsInterfaceHeader', t('hostMetricsInterfaceHeader'));
    setText('hostMetricsIpmiHostHeader', t('hostMetricsIpmiHostHeader'));
    setText('hostMetricsIpmiPortHeader', t('hostMetricsIpmiPortHeader'));
    setText('hostMetricsDiscoveryHeader', t('hostMetricsDiscoveryHeader'));
    setText('hostMetricsSaveButtonText', t('hostMetricsSaveButtonText'));
    setText('ipmiSettingsTitle', t('ipmiSettingsTitle'));
    setText('ipmiSettingsHint', t('ipmiSettingsHint'));
    setText('ipmiNodeHeader', t('ipmiNodeHeader') || t('tabNodes') || 'Node');
    setText('ipmiClusterIpHeader', t('ipmiClusterIpHeader') || t('hostMetricsAgentIpHostHeader'));
    setText('ipmiTargetHeader', t('ipmiTargetHeader'));
    setText('ipmiSaveButtonText', t('ipmiSaveButtonText'));
    setText('hostMetricsInstallHeader', t('hostMetricsInstallHeader'));
    setText('hostMetricsAgentInstallSshHostLabel', t('hostMetricsAgentInstallSshHostLabel'));
    setText('hostMetricsAgentInstallSshPortLabel', t('hostMetricsAgentInstallSshPortLabel'));
    setText('hostMetricsAgentInstallSshUserLabel', t('hostMetricsAgentInstallSshUserLabel'));
    setText('hostMetricsAgentInstallSshPasswordLabel', t('hostMetricsAgentInstallSshPasswordLabel'));
    setText('hostMetricsAgentInstallNextBtnText', t('hostMetricsAgentInstallNextBtn'));
    setText('hostMetricsAgentInstallPlanLabel', t('hostMetricsAgentInstallPlanLabel'));
    setText('hostMetricsAgentInstallBackBtnText', t('hostMetricsAgentInstallBackBtn'));
    setText('hostMetricsAgentInstallResultLabel', t('hostMetricsAgentInstallResultLabel'));
    applyHostMetricsAgentModalMode(lastHostMetricsAgentModalNodeName);

    setText('speedtestSettingsTitle', t('speedtestSettingsTitle'));
    setText('speedtestSettingsHint', t('speedtestSettingsHint'));
    setText('speedtestEnabledLabel', t('speedtestEnabledLabel'));
    setText('speedtestEngineLabel', t('speedtestEngineLabel'));
    setText('speedtestEngineOoklaOption', t('speedtestEngineOoklaOption'));
    setText('speedtestEngineLibrespeedOption', t('speedtestEngineLibrespeedOption'));
    setText('speedtestServerLabel', t('speedtestServerLabel'));
    setText('speedtestServerHint', t('speedtestServerHint'));
    setText('speedtestLibrespeedServerLabel', t('speedtestLibrespeedServerLabel'));
    setText('speedtestLibrespeedServerHint', t('speedtestLibrespeedServerHint'));
    setText('speedtestPerDayLabel', t('speedtestPerDayLabel'));
    setText('speedtestProviderDownloadLabel', t('speedtestProviderDownloadLabel'));
    setText('speedtestProviderUploadLabel', t('speedtestProviderUploadLabel'));
    setText('speedtestProviderHint', t('speedtestProviderHint'));
    setText('speedtestProxySectionTitle', t('speedtestProxySectionTitle'));
    setText('speedtestHttpProxyLabel', t('speedtestHttpProxyLabel'));
    setText('speedtestHttpsProxyLabel', t('speedtestHttpsProxyLabel'));
    setText('speedtestNoProxyLabel', t('speedtestNoProxyLabel'));
    setText('speedtestShowProxySettingsLabel', t('speedtestShowProxySettingsLabel'));
    setText('speedtestProxyHint', t('speedtestProxyHint'));
    setText('speedtestRunNowText', t('speedtestRunNowText'));
    setText('speedtestClearHistoryText', t('speedtestClearHistoryText'));
    setText('speedtestLastRunLabel', t('speedtestLastRunLabel'));
    setText('speedtestAvgLabel', t('speedtestAvgLabel'));
    setText('speedtestMinLabel', t('speedtestMinLabel'));
    setText('speedtestMaxLabel', t('speedtestMaxLabel'));
    setText('speedtestDashboardSectionTitle', t('dashboardSpeedtestTitle'));
    setText('speedtestMonitorLastRunLabel', t('speedtestLastRunLabel'));
    setText('speedtestMonitorLastDownloadLabel', t('speedtestDownloadShort'));
    setText('speedtestMonitorLastUploadLabel', t('speedtestUploadShort'));
    setText('speedtestMonitorLastPingLabel', t('speedtestPingLabel'));
    setText('speedtestMonitorTodayDownloadSectionTitle', t('speedtestTodayDownloadSectionTitle'));
    setText('speedtestMonitorLast24hTitle', t('speedtestRunsTodaySectionTitle'));
    setText('speedtestMonitor24hColTime', t('speedtest24hColTime'));
    setText('speedtestMonitor24hColDownload', t('speedtestDownloadShort'));
    setText('speedtestMonitor24hColUpload', t('speedtestUploadShort'));
    setText('speedtestMonitor24hColPing', t('speedtestPingLabel'));
    setText('speedtestMonitor24hColServer', t('speedtest24hColServer'));
    setText('speedtestMonitor24hColDevDownload', t('speedtest24hColDevDownload'));
    setText('speedtestMonitor24hColDevUpload', t('speedtest24hColDevUpload'));
    setText('speedtestMonitorLast24hEmpty', t('speedtestRunsTodayEmpty'));
    setText('speedtestMonitorAvgLabel', t('speedtestAvgLabel'));
    setText('speedtestMonitorMinLabel', t('speedtestMinLabel'));
    setText('speedtestMonitorMaxLabel', t('speedtestMaxLabel'));

    setText('iperf3SettingsTitle', t('iperf3SettingsTitle'));
    setText('iperf3SettingsHint', t('iperf3SettingsHint'));
    setText('iperf3EnabledLabel', t('iperf3EnabledLabel'));
    setText('iperf3HostLabel', t('iperf3HostLabel'));
    setText('iperf3HostHint', t('iperf3HostHint'));
    setText('iperf3PortLabel', t('iperf3PortLabel'));
    setText('iperf3PortHint', t('iperf3PortHint'));
    setText('iperf3DurationLabel', t('iperf3DurationLabel'));
    setText('iperf3DurationHint', t('iperf3DurationHint'));
    setText('iperf3ParallelLabel', t('iperf3ParallelLabel'));
    setText('iperf3ParallelHint', t('iperf3ParallelHint'));
    setText('iperf3PerDayLabel', t('iperf3PerDayLabel'));
    setText('iperf3ProviderDownloadLabel', t('iperf3ProviderDownloadLabel'));
    setText('iperf3ProviderUploadLabel', t('iperf3ProviderUploadLabel'));
    setText('iperf3ProviderHint', t('iperf3ProviderHint'));
    setText('iperf3RunNowText', t('iperf3RunNowText'));
    setText('iperf3ClearHistoryText', t('iperf3ClearHistoryText'));
    setText('iperf3DashboardSectionTitle', t('dashboardIperf3Title'));
    setText('iperf3MonitorLastRunLabel', t('speedtestLastRunLabel'));
    setText('iperf3MonitorLastDownloadLabel', t('speedtestDownloadShort'));
    setText('iperf3MonitorLastUploadLabel', t('speedtestUploadShort'));
    setText('iperf3MonitorLastPingLabel', t('speedtestPingLabel'));
    setText('iperf3MonitorTodayDownloadSectionTitle', t('speedtestTodayDownloadSectionTitle'));
    setText('iperf3MonitorLast24hTitle', t('speedtestRunsTodaySectionTitle'));
    setText('iperf3Monitor24hColTime', t('speedtest24hColTime'));
    setText('iperf3Monitor24hColDownload', t('speedtestDownloadShort'));
    setText('iperf3Monitor24hColUpload', t('speedtestUploadShort'));
    setText('iperf3Monitor24hColPing', t('speedtestPingLabel'));
    setText('iperf3Monitor24hColServer', t('speedtest24hColServer'));
    setText('iperf3Monitor24hColDevDownload', t('speedtest24hColDevDownload'));
    setText('iperf3Monitor24hColDevUpload', t('speedtest24hColDevUpload'));
    setText('iperf3MonitorLast24hEmpty', t('speedtestRunsTodayEmpty'));
    setText('iperf3MonitorAvgLabel', t('speedtestAvgLabel'));
    setText('iperf3MonitorMinLabel', t('speedtestMinLabel'));
    setText('iperf3MonitorMaxLabel', t('speedtestMaxLabel'));

    setPlaceholder('settingsServiceNameInput', t('settingsServicePlaceholderName'));
    setPlaceholder('settingsServiceHostInput', t('settingsServicePlaceholderHost'));
    setPlaceholder('settingsSavedViewNameInput', tOr('settingsSavedViewNamePlaceholder', 'Night wallboard'));
    setPlaceholder('settingsSavedTileViewNameInput', tOr('settingsSavedTileViewNamePlaceholder', 'Wallboard compact'));
    setPlaceholder('upsHostInput', t('upsHostPlaceholder'));
    setPlaceholder('netdevHostInput', t('netdevHostPlaceholder'));
    setPlaceholder('speedtestServerInput', t('speedtestServerPlaceholder'));
    setPlaceholder('speedtestLibrespeedServerInput', t('speedtestLibrespeedServerPlaceholder'));
    setPlaceholder('iperf3HostInput', t('iperf3HostPlaceholder'));

    [
        'upsSnmpOidChargeInput',
        'upsSnmpOidRuntimeInput',
        'upsSnmpOidInputVoltageInput',
        'upsSnmpOidOutputVoltageInput',
        'upsSnmpOidPowerInput',
        'upsSnmpOidLoadInput',
        'upsSnmpOidFrequencyInput'
    ].forEach((pid) => setPlaceholder(pid, t('placeholderOptional')));

    localizeRefreshIntervalSelect();
    localizeYesNoSelect('upsEnabledSelect');
    localizeYesNoSelect('upsShowOnDashboardSelect');
    localizeYesNoSelect('upsShowOnMonitorSelect');
    localizeYesNoSelect('netdevEnabledSelect');
    localizeYesNoSelect('netdevShowOnDashboardSelect');
    localizeYesNoSelect('netdevShowOnMonitorSelect');
    localizeYesNoSelect('speedtestEnabledSelect');
    localizeYesNoSelect('iperf3EnabledSelect');
    localizeServiceTypeSelect();
    localizeUpsTypeSelect();
    syncSettingsConnectionStatusText();

    try {
        const root = document.getElementById('netdevFieldsEditorsRoot');
        if (root && root.querySelector('.netdev-field-block')) {
            const cur = getNetdevFieldsFromDom();
            if (cur.length) renderNetdevFieldsEditors(cur);
        }
    } catch (_) {}

    updateSpeedtestSettingsEngineUI();
    updateSpeedtestProxySettingsUI(false);
    localizeSetupWizard();
    syncClusterResourcesCardInteractivity();
    updateHomelabMenuChrome();
}

function localizeSetupWizard() {
    setText('setupWizardTitleText', t('setupWizardTitle'));
    setText('setupWizardWelcomeText', t('setupWizardWelcome'));
    setText('setupWizardLangLabel', t('setupWizardLangLabel'));
    setText('setupWizardTypeHint', t('setupWizardTypeHint'));
    setText('setupWizardProxmoxTitle', t('setupWizardProxmoxTitle'));
    setText('setupWizardProxmoxSub', t('setupWizardProxmoxSub'));
    setText('setupWizardTrueNASTitle', t('setupWizardTrueNASTitle'));
    setText('setupWizardTrueNASSub', t('setupWizardTrueNASSub'));
    setText('setupWizardConnHint', t('setupWizardConnHint'));
    setText('setupWizardUrlLabel', t('setupWizardUrlLabel'));
    setText('setupWizardTokenIdLabel', t('setupWizardTokenIdLabel'));
    setText('setupWizardTokenSecretLabel', t('setupWizardTokenSecretLabel'));
    setText('setupWizardTnUrlLabel', t('setupWizardTnUrlLabel'));
    setText('setupWizardTnKeyLabel', t('setupWizardTnKeyLabel'));
    setText('setupWizardBackText', t('setupWizardBack'));
    setText('setupWizardSkipText', t('setupWizardSkip'));
    setText('setupWizardNextText', t('setupWizardNext'));
    setText('setupWizardConnectText', t('connectButton'));
    setText('setupWizardFinishText', t('setupWizardFinish'));
    setText('setupWizardDoneTitle', t('setupWizardDoneTitle'));
    if (setupWizardFinishMode === 'skip') {
        setText('setupWizardDoneText', t('setupWizardDoneSkipped'));
    } else {
        setText('setupWizardDoneText', t('setupWizardDoneConnected'));
    }
    setText('setupWizardImportHint', t('setupWizardImportHint'));
    setText('setupWizardImportBtnText', t('setupWizardImportButton'));
}

function setupWizardFillLangSelect() {
    const sel = document.getElementById('wizardLangSelect');
    if (!sel || !Array.isArray(availableLanguages) || !availableLanguages.length) return;
    sel.innerHTML = availableLanguages.map((code) => `<option value="${escapeHtml(code)}">${escapeHtml(code.toUpperCase())}</option>`).join('');
    try {
        const stored = localStorage.getItem('preferred_language');
        if (stored && availableLanguages.includes(stored)) sel.value = stored;
        else if (currentLanguage && availableLanguages.includes(currentLanguage)) sel.value = currentLanguage;
        else sel.value = availableLanguages[0];
    } catch (_) {
        sel.value = availableLanguages[0];
    }
}

function setupWizardSyncFromWizardToConfig() {
    if (setupWizardServerType === 'proxmox') {
        const url = (document.getElementById('wizardProxmoxUrl') && document.getElementById('wizardProxmoxUrl').value.trim()) || '';
        const idPart = (document.getElementById('wizardApiTokenId') && document.getElementById('wizardApiTokenId').value.trim()) || '';
        const secPart = (document.getElementById('wizardApiTokenSecret') && document.getElementById('wizardApiTokenSecret').value.trim()) || '';
        proxmoxServers = url ? [normalizeUrlClient(url)] : [];
        currentServerIndex = 0;
        const tid = document.getElementById('apiTokenId');
        const ts = document.getElementById('apiTokenSecret');
        if (tid) tid.value = idPart;
        if (ts) ts.value = secPart;
        syncProxmoxApiTokenFromParts();
    } else {
        const url = (document.getElementById('wizardTrueNASUrl') && document.getElementById('wizardTrueNASUrl').value.trim()) || '';
        const key = (document.getElementById('wizardTrueNASKey') && document.getElementById('wizardTrueNASKey').value.trim()) || '';
        truenasServers = url ? [normalizeUrlClient(url)] : [];
        currentTrueNASServerIndex = 0;
        const k = document.getElementById('apiTokenTrueNAS');
        if (k) k.value = key;
    }
    renderServerList();
}

function setupWizardUpdateUI() {
    const step = setupWizardStep;
    const s1 = document.getElementById('setupWizardStep1');
    const s2 = document.getElementById('setupWizardStep2');
    const s3 = document.getElementById('setupWizardStep3');
    const s4 = document.getElementById('setupWizardStep4');
    if (s1) s1.classList.toggle('d-none', step !== 1);
    if (s2) s2.classList.toggle('d-none', step !== 2);
    if (s3) s3.classList.toggle('d-none', step !== 3);
    if (s4) s4.classList.toggle('d-none', step !== 4);
    for (let i = 1; i <= 4; i++) {
        const b = document.getElementById('setupWizardBadge' + i);
        if (b) {
            b.classList.toggle('bg-primary', i === step);
            b.classList.toggle('bg-secondary', i !== step);
        }
    }
    const back = document.getElementById('setupWizardBtnBack');
    const skip = document.getElementById('setupWizardBtnSkip');
    const next = document.getElementById('setupWizardBtnNext');
    const conn = document.getElementById('setupWizardBtnConnect');
    const fin = document.getElementById('setupWizardBtnFinish');
    if (back) back.classList.toggle('d-none', step === 1);
    if (skip) skip.classList.toggle('d-none', step !== 3);
    if (next) next.classList.toggle('d-none', step !== 1);
    if (conn) conn.classList.toggle('d-none', step !== 3);
    if (fin) fin.classList.toggle('d-none', step !== 4);
    if (step === 3) {
        const prox = document.getElementById('setupWizardProxmoxFields');
        const tn = document.getElementById('setupWizardTrueNASFields');
        const isTn = setupWizardServerType === 'truenas';
        if (prox) prox.classList.toggle('d-none', isTn);
        if (tn) tn.classList.toggle('d-none', !isTn);
    }
}

function setupWizardBindOnce() {
    if (setupWizardListenersBound) return;
    setupWizardListenersBound = true;
    const pickPx = document.getElementById('setupWizardPickProxmox');
    const pickTn = document.getElementById('setupWizardPickTrueNAS');
    if (pickPx) pickPx.addEventListener('click', () => {
        setupWizardServerType = 'proxmox';
        setupWizardStep = 3;
        setupWizardUpdateUI();
    });
    if (pickTn) pickTn.addEventListener('click', () => {
        setupWizardServerType = 'truenas';
        setupWizardStep = 3;
        setupWizardUpdateUI();
    });
    const back = document.getElementById('setupWizardBtnBack');
    if (back) back.addEventListener('click', () => {
        if (setupWizardStep === 3) {
            setupWizardStep = 2;
        } else if (setupWizardStep === 2) {
            setupWizardStep = 1;
        }
        setupWizardUpdateUI();
    });
    const next = document.getElementById('setupWizardBtnNext');
    if (next) next.addEventListener('click', async () => {
        if (setupWizardStep !== 1) return;
        const sel = document.getElementById('wizardLangSelect');
        const lang = sel && sel.value ? sel.value : currentLanguage;
        setLanguage(lang);
        await saveSettingsToServer({ preferredLanguage: lang });
        setupWizardStep = 2;
        setupWizardUpdateUI();
    });
    const skip = document.getElementById('setupWizardBtnSkip');
    if (skip) skip.addEventListener('click', () => {
        setupWizardFinishMode = 'skip';
        setupWizardStep = 4;
        localizeSetupWizard();
        setupWizardUpdateUI();
    });
    const connectBtn = document.getElementById('setupWizardBtnConnect');
    if (connectBtn) connectBtn.addEventListener('click', async () => {
        if (setupWizardServerType === 'proxmox') {
            const url = document.getElementById('wizardProxmoxUrl') && document.getElementById('wizardProxmoxUrl').value.trim();
            const idPart = document.getElementById('wizardApiTokenId') && document.getElementById('wizardApiTokenId').value.trim();
            const secPart = document.getElementById('wizardApiTokenSecret') && document.getElementById('wizardApiTokenSecret').value.trim();
            if (!url || !idPart || !secPart) {
                showToast(t('setupWizardFillRequired') || t('tokenRequired'), 'warning');
                return;
            }
        } else {
            const url = document.getElementById('wizardTrueNASUrl') && document.getElementById('wizardTrueNASUrl').value.trim();
            const key = document.getElementById('wizardTrueNASKey') && document.getElementById('wizardTrueNASKey').value.trim();
            if (!url || !key) {
                showToast(t('setupWizardFillRequired') || t('tokenRequired'), 'warning');
                return;
            }
        }
        setupWizardSyncFromWizardToConfig();
        await saveSettingsToServer({
            proxmoxServers,
            truenasServers,
            currentServerIndex,
            currentTrueNASServerIndex
        });
        connectBtn.disabled = true;
        try {
            const ok = await connect({
                skipDashboard: true,
                backendType: setupWizardServerType === 'truenas' ? 'truenas' : 'proxmox'
            });
            if (ok) {
                setupWizardFinishMode = 'success';
                setupWizardStep = 4;
                localizeSetupWizard();
                setupWizardUpdateUI();
            }
        } finally {
            connectBtn.disabled = false;
        }
    });
    const fin = document.getElementById('setupWizardBtnFinish');
    if (fin) fin.addEventListener('click', () => setupWizardFinishFlow());
    const importBtn = document.getElementById('setupWizardImportBtn');
    const importFile = document.getElementById('wizardConfigImportFile');
    if (importBtn && importFile) {
        importBtn.addEventListener('click', () => importFile.click());
        importFile.addEventListener('change', (ev) => setupWizardOnImportConfigFile(ev));
    }
}

async function setupWizardOnImportConfigFile(ev) {
    const file = ev.target.files && ev.target.files[0];
    if (!file) return;
    let parsed;
    try {
        parsed = JSON.parse(await file.text());
    } catch {
        showToast(t('settingsImportError') || 'Неверный файл импорта', 'error');
        ev.target.value = '';
        return;
    }
    const importBtn = document.getElementById('setupWizardImportBtn');
    if (importBtn) importBtn.disabled = true;
    try {
        await importAllConfigFromParsedJson(parsed);
        showToast(t('settingsImportSuccess') || 'Настройки импортированы, данные обновлены', 'success');
        await setupWizardFinishFlow();
    } catch (err) {
        showToast((t('settingsImportError') || t('errorUpdate')) + ': ' + err.message, 'error');
    } finally {
        ev.target.value = '';
        if (importBtn) importBtn.disabled = false;
    }
}

function showInitialSetupWizard() {
    setupWizardStep = 1;
    setupWizardServerType = 'proxmox';
    setupWizardFinishMode = 'success';
    setupWizardFillLangSelect();
    setupWizardBindOnce();
    setupWizardUpdateUI();
    localizeSetupWizard();
    const el = document.getElementById('initialSetupWizardModal');
    if (!el) return;
    const m = bootstrap.Modal.getOrCreateInstance(el, { backdrop: 'static', keyboard: false });
    m.show();
}

async function setupWizardFinishFlow() {
    await saveSettingsToServer({ setupCompleted: true });
    setupCompleted = true;
    const modalEl = document.getElementById('initialSetupWizardModal');
    const inst = modalEl && bootstrap.Modal.getInstance(modalEl);
    if (inst) inst.hide();
    const data = await loadSettings();
    if (data.preferred_language && availableLanguages.includes(data.preferred_language)) {
        setLanguage(data.preferred_language);
    }
    const hasConnIds = connectionIdMap && typeof connectionIdMap === 'object' && Object.keys(connectionIdMap).length > 0;
    if (hasConnIds) {
        try {
            await refreshData();
            startAutoRefresh();
            if (!monitorMode) showDashboard();
        } catch (e) {
            console.warn('Initial refresh after wizard:', e);
            showConfigSectionOnly();
        }
    } else {
        showConfigSectionOnly();
    }
}

// Available languages (will be populated from server)
let availableLanguages = ['ru', 'en'];
let serverDefaultLanguage = null;

// Load available languages from server and initialize
document.addEventListener('DOMContentLoaded', async function() {
    console.log('DOM loaded');
    initMonitorPageZoomGuards();
    initMonitorChromeGestureGuards();

    // Load translations and available languages from server
    await loadTranslations();
    
    // Load available languages from server (+ текущий язык с сервера = .env default)
    try {
        const response = await fetch('/api/languages');
        const data = await response.json();
        if (data.available && data.available.length > 0) {
            availableLanguages = data.available;
            renderLanguageSwitchers();
        }
        if (data.current && typeof data.current === 'string') {
            serverDefaultLanguage = data.current;
        }
    } catch (error) {
        console.error('Failed to load languages:', error);
    }
    
    // Load saved settings from API (servers, thresholds, defaults, etc.)
    const settingsData = await loadSettings();

    // Determine language: .env (.server current) -> app settings -> user choice -> first available
    let storedLang = null;
    try {
        storedLang = localStorage.getItem('preferred_language');
    } catch (_) {}
    const envLang = (serverDefaultLanguage && availableLanguages.includes(serverDefaultLanguage))
        ? serverDefaultLanguage
        : null;
    const settingsLang = (settingsData && settingsData.preferred_language && availableLanguages.includes(settingsData.preferred_language))
        ? settingsData.preferred_language
        : null;
    const userLang = (storedLang && availableLanguages.includes(storedLang))
        ? storedLang
        : null;
    // Язык из настроек (БД) и выбор в UI/localStorage важнее дефолта сервера (.env / i18n.getLanguage),
    // иначе после F5 снова подставлялся только «серверный» язык.
    const chosenLang = settingsLang || userLang || envLang || (availableLanguages[0] || 'ru');
    setLanguage(chosenLang);
    syncHomelabChrome();

    // Proxmox token parts -> keep hidden legacy input in sync
    try {
        const idEl = document.getElementById('apiTokenId');
        const secretEl = document.getElementById('apiTokenSecret');
        if (idEl && secretEl) {
            idEl.addEventListener('input', syncProxmoxApiTokenFromParts);
            secretEl.addEventListener('input', syncProxmoxApiTokenFromParts);
            syncProxmoxApiTokenFromParts();
        }
    } catch (_) {}

    toggleServiceTypeFields();
    renderMonitoredServices();
    renderSettingsMonitoredServices();
    renderSettingsMonitoredVms();
    const vmIdOrNameInput = document.getElementById('settingsVmIdOrNameInput');
    if (vmIdOrNameInput) {
        vmIdOrNameInput.addEventListener('change', addVmToMonitorByIdOrName);
        vmIdOrNameInput.addEventListener('keydown', function(e) { if (e.key === 'Enter') { e.preventDefault(); addVmToMonitorByIdOrName(); } });
    }
    const telegramNav = document.getElementById('settings-nav-telegram');
    if (telegramNav) {
        telegramNav.addEventListener('shown.bs.tab', () => {
            loadSmartSensorsConfigsForTiles().finally(() => renderTelegramRulesTable());
        });
    }
    const hostMetricsNav = document.getElementById('settings-nav-hostmetrics');
    if (hostMetricsNav) {
        hostMetricsNav.addEventListener('shown.bs.tab', () => {
            loadHostMetricsSettings().catch(() => {});
        });
    }
    initHostMetricsAgentInstallModal();
    initHostNodeMetricChartsOnce();
    initClusterAggregateChartsOnce();
    initUpsAllMetricsModalOnce();
    initSmartSensorsAllMetricsModalOnce();
    bindTelegramRuleMessageModalOnce();
    const debugNav = document.getElementById('settings-nav-debug');
    if (debugNav) {
        debugNav.addEventListener('shown.bs.tab', () => refreshDebugMetrics());
    }
    const speedtestNav = document.getElementById('settings-nav-speedtest');
    if (speedtestNav) {
        speedtestNav.addEventListener('shown.bs.tab', () => updateSpeedtestDashboard().catch(() => {}));
    }
    const iperf3Nav = document.getElementById('settings-nav-iperf3');
    if (iperf3Nav) {
        iperf3Nav.addEventListener('shown.bs.tab', () => updateIperf3Dashboard().catch(() => {}));
    }
    const clusterTilesSettingsNav = document.getElementById('settings-nav-display-cluster-tiles');
    if (clusterTilesSettingsNav) {
        clusterTilesSettingsNav.addEventListener('shown.bs.tab', () => {
            renderTilesMonitorScreen('tilesNormalGrid').catch(() => {});
        });
    }
    const homeTabs = document.getElementById('myTab');
    if (homeTabs) {
        homeTabs.addEventListener('shown.bs.tab', (e) => {
            requestAnimationFrame(() => updateHomeLabFontScale());
            if (!monitorMode && e.target && e.target.id) {
                persistDashboardHomeTab(e.target.id);
            }
        });
    }
    window.addEventListener('resize', () => {
        requestAnimationFrame(() => updateHomeLabFontScale());
    });
    const reloadBtn = document.getElementById('settingsDebugReloadBtn');
    if (reloadBtn) {
        reloadBtn.addEventListener('click', function (e) {
            e.preventDefault();
            e.stopPropagation();
            reloadApplication();
            return false;
        });
    }
    const ttlSelect = document.getElementById('settingsSessionTtlSelect');
    if (ttlSelect) {
        ttlSelect.addEventListener('change', async function () {
            const val = parseInt(ttlSelect.value, 10);
            if (!isNaN(val) && val > 0) {
                settingsSessionTtlMinutes = val;
                try {
                    await saveSettingsToServer({ session_ttl_minutes: val });
                    showToast(t('dataUpdated') || 'Настройки сохранены', 'success');
                } catch (e) {
                    showToast((t('connectError') || 'Ошибка') + ': ' + e.message, 'error');
                }
            }
        });
    }

    checkServerStatus();
    startBackendRecoveryWatcher();
    checkForAppUpdates().catch(() => {});
    updateCurrentServerBadge();

    const needsSetupWizard = settingsData && settingsData.setup_completed === false;
    if (needsSetupWizard) {
        showInitialSetupWizard();
    } else {
        // Показать дашборд или настройки: при сохранённом подключении — загрузить данные и показать контент, иначе — форму входа
        const hasConnIds = connectionIdMap && typeof connectionIdMap === 'object' && Object.keys(connectionIdMap).length > 0;
        if (apiToken || hasConnIds) {
            try {
                await refreshData();
                startAutoRefresh();
                if (!monitorMode) showDashboard();
            } catch (e) {
                console.warn('Initial refresh failed:', e);
                showConfigSectionOnly();
            }
        } else {
            showConfigSectionOnly();
        }
    }
});

function showConfigSectionOnly() {
    const configSection = document.getElementById('configSection');
    const dashboardSection = document.getElementById('dashboardSection');
    if (configSection) configSection.style.display = 'block';
    if (dashboardSection) dashboardSection.style.display = 'none';
    hideAllMonitorShellSections();
    updateHomelabMenuChrome();
}

function normalizeUrlClient(u) {
    try {
        const url = new URL(String(u));
        if (!url.protocol.startsWith('http')) return String(u || '').trim();
        return url.toString().replace(/\/+$/, '');
    } catch {
        return String(u || '').trim();
    }
}

function connectionKey(type, url) {
    return `${type}|${normalizeUrlClient(url)}`;
}

/**
 * При смене URL в списке серверов переносим connectionId на новый ключ.
 * Иначе токен остаётся привязанным к старому URL и «пропадает» для новой строки.
 */
function migrateConnectionIdOnUrlChange(type, oldUrl, newUrl) {
    const oldNorm = normalizeUrlClient(oldUrl);
    const newNorm = normalizeUrlClient(newUrl);
    if (!oldNorm || !newNorm || oldNorm === newNorm) return;
    const oldKey = connectionKey(type, oldNorm);
    const newKey = connectionKey(type, newNorm);
    if (oldKey === newKey) return;
    const id = connectionIdMap[oldKey];
    if (id == null || id === '') return;
    if (!connectionIdMap[newKey]) {
        connectionIdMap[newKey] = id;
    }
    delete connectionIdMap[oldKey];
}

function normalizeTelegramRoutes(raw) {
    const o = raw && typeof raw === 'object' ? raw : {};
    return {
        service: typeof o.service === 'object' && o.service ? { ...o.service } : {},
        vm: typeof o.vm === 'object' && o.vm ? { ...o.vm } : {},
        node: typeof o.node === 'object' && o.node ? { ...o.node } : {},
        netdev: typeof o.netdev === 'object' && o.netdev ? { ...o.netdev } : {}
    };
}

function migrateLegacyTelegramRoutesToRulesClient(routes) {
    const out = [];
    let n = 0;
    const id = () => `legacy_${Date.now()}_${++n}`;
    const svc = routes.service || {};
    for (const [sid, r] of Object.entries(svc)) {
        const chatId = String(r && r.chatId || '').trim();
        if (!chatId) continue;
        const serviceId = parseInt(sid, 10);
        if (!Number.isFinite(serviceId)) continue;
        out.push({ id: id(), enabled: true, type: 'service_updown', serviceId, chatId, threadId: String(r.threadId || '').trim() || undefined });
    }
    const vm = routes.vm || {};
    for (const [vid, r] of Object.entries(vm)) {
        const chatId = String(r && r.chatId || '').trim();
        if (!chatId) continue;
        const vmid = parseInt(vid, 10);
        if (!Number.isFinite(vmid)) continue;
        out.push({ id: id(), enabled: true, type: 'vm_state', vmid, chatId, threadId: String(r.threadId || '').trim() || undefined });
    }
    const node = routes.node || {};
    for (const [name, r] of Object.entries(node)) {
        const chatId = String(r && r.chatId || '').trim();
        if (!chatId) continue;
        const nodeName = String(name || '').trim();
        if (!nodeName) continue;
        out.push({ id: id(), enabled: true, type: 'node_online', nodeName, chatId, threadId: String(r.threadId || '').trim() || undefined });
    }
    const nd = routes.netdev || {};
    for (const [slot, r] of Object.entries(nd)) {
        const chatId = String(r && r.chatId || '').trim();
        if (!chatId) continue;
        const netdevSlot = parseInt(slot, 10);
        if (!Number.isFinite(netdevSlot)) continue;
        out.push({ id: id(), enabled: true, type: 'netdev_updown', netdevSlot, chatId, threadId: String(r.threadId || '').trim() || undefined });
    }
    return out;
}

function normalizeTelegramNotificationRules(raw) {
    if (!Array.isArray(raw)) return [];
    return raw
        .filter((x) => x && typeof x === 'object' && x.type)
        .map((r) => {
            const serviceIds = Array.isArray(r.serviceIds)
                ? Array.from(new Set(r.serviceIds.map((x) => Number(x)).filter((n) => Number.isFinite(n))))
                : [];
            const vmids = Array.isArray(r.vmids)
                ? Array.from(new Set(r.vmids.map((x) => Number(x)).filter((n) => Number.isFinite(n))))
                : [];
            const upsSlots = Array.isArray(r.upsSlots)
                ? Array.from(new Set(r.upsSlots.map((x) => Number(x)).filter((n) => Number.isFinite(n))))
                : [];
            const nodeNames = Array.isArray(r.nodeNames)
                ? Array.from(new Set(r.nodeNames.map((x) => String(x || '').trim()).filter(Boolean)))
                : [];
            const diskIds = Array.isArray(r.diskIds)
                ? Array.from(new Set(r.diskIds.map((x) => String(x || '').trim()).filter(Boolean)))
                : [];
            const poolIds = Array.isArray(r.poolIds)
                ? Array.from(new Set(r.poolIds.map((x) => String(x || '').trim()).filter(Boolean)))
                : [];
            const truenasServiceIds = Array.isArray(r.truenasServiceIds)
                ? Array.from(new Set(r.truenasServiceIds.map((x) => String(x || '').trim()).filter(Boolean)))
                : [];
            const smartSensorIds = Array.isArray(r.smartSensorIds)
                ? Array.from(new Set(r.smartSensorIds.map((x) => String(x || '').trim()).filter(Boolean)))
                : [];
            const fallbackServiceId = Number(r.serviceId);
            const fallbackVmid = Number(r.vmid);
            const fallbackUpsSlot = Number(r.upsSlot);
            const fallbackNode = String(r.nodeName || '').trim();
            const fallbackDiskId = String(r.diskId || '').trim();
            const fallbackPoolId = String(r.poolId || '').trim();
            const fallbackTrueNASServiceId = String(r.truenasServiceId || '').trim();
            const fallbackSmartSensorId = String(r.smartSensorId || '').trim();
            const normalizedNodeNames = nodeNames.length ? nodeNames : (fallbackNode ? [fallbackNode] : []);
            const out = {
                ...r,
                id: r.id != null && String(r.id).trim() !== '' ? String(r.id) : newTelegramRuleId()
            };
            if (serviceIds.length || Number.isFinite(fallbackServiceId)) {
                const vals = serviceIds.length ? serviceIds : [fallbackServiceId];
                out.serviceIds = vals;
                out.serviceId = vals[0];
            }
            if (vmids.length || Number.isFinite(fallbackVmid)) {
                const vals = vmids.length ? vmids : [fallbackVmid];
                out.vmids = vals;
                out.vmid = vals[0];
            }
            if (upsSlots.length || Number.isFinite(fallbackUpsSlot)) {
                const vals = upsSlots.length ? upsSlots : [fallbackUpsSlot];
                out.upsSlots = vals;
                out.upsSlot = vals[0];
            }
            if (normalizedNodeNames.length) {
                out.nodeNames = normalizedNodeNames;
                out.nodeName = normalizedNodeNames[0];
            }
            const normalizedDiskIds = diskIds.length ? diskIds : (fallbackDiskId ? [fallbackDiskId] : []);
            if (normalizedDiskIds.length) {
                out.diskIds = normalizedDiskIds;
                out.diskId = normalizedDiskIds[0];
            }
            const normalizedPoolIds = poolIds.length ? poolIds : (fallbackPoolId ? [fallbackPoolId] : []);
            if (normalizedPoolIds.length) {
                out.poolIds = normalizedPoolIds;
                out.poolId = normalizedPoolIds[0];
            }
            const normalizedTrueNASServiceIds = truenasServiceIds.length ? truenasServiceIds : (fallbackTrueNASServiceId ? [fallbackTrueNASServiceId] : []);
            if (normalizedTrueNASServiceIds.length) {
                out.truenasServiceIds = normalizedTrueNASServiceIds;
                out.truenasServiceId = normalizedTrueNASServiceIds[0];
            }
            const normalizedSmartSensorIds = smartSensorIds.length ? smartSensorIds : (fallbackSmartSensorId ? [fallbackSmartSensorId] : []);
            if (normalizedSmartSensorIds.length) {
                out.smartSensorIds = normalizedSmartSensorIds;
                out.smartSensorId = normalizedSmartSensorIds[0];
            }
            return out;
        });
}

function telegramRuleIdEquals(a, b) {
    return String(a) === String(b);
}

function findTelegramRuleById(ruleId) {
    return (telegramNotificationRules || []).find((r) => telegramRuleIdEquals(r.id, ruleId)) || null;
}

function newTelegramRuleId() {
    return `r_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`;
}

function getDefaultTelegramRule() {
    const list = Array.isArray(monitoredServices) ? monitoredServices : [];
    const firstSvc = list[0];
    if (firstSvc && firstSvc.id != null) {
        return { id: newTelegramRuleId(), enabled: true, type: 'service_updown', serviceId: firstSvc.id, chatId: '', threadId: '' };
    }
    return { id: newTelegramRuleId(), enabled: true, type: 'node_online', nodeName: getClusterNodeNamesForTelegramRules()[0] || 'pve', chatId: '', threadId: '' };
}

function getClusterNodeNamesForTelegramRules() {
    const nodes = lastClusterData && Array.isArray(lastClusterData.nodes) ? lastClusterData.nodes : [];
    return nodes.map((n) => n.name || n.node).filter(Boolean);
}

function getRuleNodeNamesClient(rule) {
    const arr = Array.isArray(rule && rule.nodeNames) ? rule.nodeNames : [];
    const out = arr.map((x) => String(x || '').trim()).filter(Boolean);
    if (out.length) return Array.from(new Set(out));
    const one = String(rule && rule.nodeName || '').trim();
    return one ? [one] : [];
}

function getRuleNumberTargetsClient(rule, pluralKey, singleKey) {
    const arr = Array.isArray(rule && rule[pluralKey]) ? rule[pluralKey] : [];
    const nums = arr.map((x) => Number(x)).filter((n) => Number.isFinite(n));
    if (nums.length) return Array.from(new Set(nums));
    const one = Number(rule && rule[singleKey]);
    return Number.isFinite(one) ? [one] : [];
}

function getSmartSensorOptionsForTelegramRules() {
    const list = Array.isArray(smartSensorsConfigsForTiles) ? smartSensorsConfigsForTiles : [];
    return list
        .filter((c) => c && c.id != null && String(c.id).trim() !== '' && c.enabled !== false)
        .map((c) => ({
            id: String(c.id).trim(),
            label: `${c.name || c.id} (${c.type === 'ble' ? 'BLE' : 'REST'})`
        }));
}

/** Фактические ключи `values` для REST, в том же порядке и с суффиксами `_2`, … как в `pollOneRest`. */
function collectRestValueKeysForTelegram(restFields) {
    if (!Array.isArray(restFields)) return [];
    const usedKeys = new Set();
    const out = [];
    for (const f of restFields) {
        if (!f || typeof f !== 'object' || f.enabled === false) continue;
        const p = f.path != null ? String(f.path).trim() : '';
        if (!p) continue;
        let baseKey = f.label != null ? String(f.label).trim() : '';
        if (!baseKey) {
            const parts = p.split('.').filter(Boolean);
            baseKey = (parts.length ? parts[parts.length - 1] : 'value') || 'value';
        }
        baseKey = baseKey.slice(0, 64);
        let outKey = baseKey;
        let n = 2;
        while (usedKeys.has(outKey)) {
            outKey = `${baseKey}_${n++}`;
        }
        usedKeys.add(outKey);
        out.push(outKey);
    }
    return out;
}

function bleChannelValueKeyForTelegram(ch) {
    if (!ch || typeof ch !== 'object') return '';
    const metric = String(ch.metric || '').toLowerCase();
    if (metric === 'custom') {
        const lab = ch.label != null ? String(ch.label).trim() : '';
        return lab || 'custom';
    }
    return metric || '';
}

/** Подсказки для порога: объединение полей выбранных датчиков (или всех включённых, если датчики не выбраны). */
function getConfiguredSmartSensorFieldKeysForRule(rule) {
    const configs = Array.isArray(smartSensorsConfigsForTiles) ? smartSensorsConfigsForTiles : [];
    const selected = (Array.isArray(rule.smartSensorIds) ? rule.smartSensorIds : [rule.smartSensorId])
        .map((x) => String(x || '').trim())
        .filter(Boolean);
    const filterBySelection = selected.length > 0;
    const keys = new Set();
    for (const c of configs) {
        if (!c || c.id == null || c.enabled === false) continue;
        const cid = String(c.id).trim();
        if (filterBySelection && !selected.includes(cid)) continue;
        const typ = String(c.type || 'rest').toLowerCase();
        if (typ === 'ble' && Array.isArray(c.bleChannels)) {
            for (const ch of c.bleChannels) {
                const k = bleChannelValueKeyForTelegram(ch);
                if (k) keys.add(k);
            }
        } else if (Array.isArray(c.restFields)) {
            for (const k of collectRestValueKeysForTelegram(c.restFields)) {
                if (k) keys.add(k);
            }
        }
    }
    return Array.from(keys).sort((a, b) => a.localeCompare(b, undefined, { sensitivity: 'base' }));
}

function telegramSmartSensorDatalistId(ruleId) {
    const raw = String(ruleId || 'x').replace(/[^a-zA-Z0-9_-]/g, '_');
    return `telegramSsFields_${raw}`;
}

function telegramRuleThreadDatalistId(ruleId) {
    const raw = String(ruleId || 'x').replace(/[^a-zA-Z0-9_-]/g, '_');
    return `telegramTgThr_${raw}`;
}

function refillTelegramChatsDatalistFromCache() {
    const dl = document.getElementById('telegramTgChatsDatalist');
    if (!dl) return;
    const chats = Array.isArray(telegramChatsCache.chats) ? telegramChatsCache.chats : [];
    dl.innerHTML = chats
        .map((c) => {
            const id = String(c.id);
            const lab = c.label != null ? String(c.label) : id;
            const disp = `${lab} (${id})`;
            return `<option value="${escapeHtml(id)}">${escapeHtml(disp)}</option>`;
        })
        .join('');
}

function refillTelegramThreadDatalistForRule(ruleId, chatIdRaw) {
    const dlId = telegramRuleThreadDatalistId(ruleId);
    const dl = document.getElementById(dlId);
    if (!dl) return;
    const cid = String(chatIdRaw || '').trim();
    const threadsBy =
        telegramChatsCache.threadsByChat && typeof telegramChatsCache.threadsByChat === 'object'
            ? telegramChatsCache.threadsByChat
            : {};
    const list = cid && threadsBy[cid] ? threadsBy[cid] : [];
    const rule = findTelegramRuleById(ruleId);
    const curThr = rule && rule.threadId != null ? String(rule.threadId).trim() : '';
    const seen = new Set();
    const parts = [];
    for (const t of list) {
        const tid = Number(t.threadId);
        if (!Number.isFinite(tid)) continue;
        const s = String(tid);
        seen.add(s);
        const name = t.name != null ? String(t.name) : `topic ${tid}`;
        parts.push(`<option value="${escapeHtml(s)}">${escapeHtml(`${name} (${tid})`)}</option>`);
    }
    if (curThr && !seen.has(curThr)) {
        parts.push(`<option value="${escapeHtml(curThr)}">${escapeHtml(curThr)}</option>`);
    }
    dl.innerHTML = parts.join('');
}

async function fetchTelegramChatsFromApi() {
    const tokEl = document.getElementById('settingsTelegramBotTokenInput');
    const proxyEl = document.getElementById('settingsTelegramProxyUrlInput');
    const rawTok = tokEl ? String(tokEl.value).trim() : '';
    const proxyUrl = proxyEl ? String(proxyEl.value || '').trim() : '';
    const payload = { telegramProxyUrl: proxyUrl };
    if (rawTok && isTelegramBotTokenFormatClient(rawTok)) payload.telegramBotToken = rawTok;

    const btn = document.getElementById('settingsTelegramFetchChatsBtn');
    if (btn) btn.disabled = true;
    try {
        const res = await fetch('/api/settings/telegram-fetch-chats', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload)
        });
        const data = await res.json().catch(() => ({}));
        if (!res.ok || !data.success) {
            const err = data.description || data.error || res.statusText;
            if (data.error === 'telegram_webhook_or_conflict') {
                showToast(t('settingsTelegramFetchChatsWebhookError') || String(err), 'warning');
            } else if (data.error === 'bot_token_required') {
                showToast(t('telegramTestRuleNeedToken') || err, 'warning');
            } else {
                showToast((t('settingsTelegramFetchChatsError') || 'Error') + ': ' + err, 'error');
            }
            return;
        }
        telegramChatsCache = {
            chats: Array.isArray(data.chats) ? data.chats : [],
            threadsByChat:
                data.threadsByChat && typeof data.threadsByChat === 'object' ? data.threadsByChat : {}
        };
        refillTelegramChatsDatalistFromCache();
        const tblBody = document.getElementById('telegramRulesTableBody');
        if (tblBody) {
            tblBody.querySelectorAll('[data-tr-field="chatId"]').forEach((inp) => {
                const rid = inp.getAttribute('data-rule-id');
                if (rid) refillTelegramThreadDatalistForRule(rid, inp.value);
            });
        }
        const nUpd = data.updatesCount != null ? data.updatesCount : 0;
        const nc = telegramChatsCache.chats.length;
        let msg;
        if (nc) {
            msg = tParams('settingsTelegramFetchChatsOk', { n: String(nc), u: String(nUpd) });
            if (!msg || msg === 'settingsTelegramFetchChatsOk') {
                msg = `Chats: ${nc}, updates: ${nUpd}`;
            }
        } else {
            msg = t('settingsTelegramFetchChatsEmpty') || '';
        }
        showToast(msg || `updates ${nUpd}`, nc ? 'success' : 'info');
    } catch (e) {
        showToast((t('settingsTelegramFetchChatsError') || 'Error') + ': ' + (e.message || String(e)), 'error');
    } finally {
        if (btn) btn.disabled = false;
    }
}

function getUpsRuleTargetOptions(rule) {
    const active = (Array.isArray(upsConfigs) ? upsConfigs : [])
        .map((cfg, idx) => ({ cfg, slot: idx + 1 }))
        .filter(({ cfg }) => cfg && cfg.enabled && String(cfg.host || '').trim() !== '')
        .map(({ cfg, slot }) => ({
            slot,
            label: `UPS ${slot}: ${cfg.name || cfg.host || ('#' + slot)}`
        }));
    if (active.length) return active;
    const selected = getRuleNumberTargetsClient(rule, 'upsSlots', 'upsSlot');
    const fallbackSlot = selected.length ? selected[0] : Number(rule && rule.upsSlot);
    const slots = [1, 2, 3, 4];
    selected.forEach((s) => {
        if (Number.isFinite(s) && !slots.includes(s)) slots.unshift(s);
    });
    if (Number.isFinite(fallbackSlot) && !slots.includes(fallbackSlot)) slots.unshift(fallbackSlot);
    return slots.map((slot) => ({ slot, label: `UPS ${slot}` }));
}

function getTelegramRuleTypeLabel(type) {
    const m = {
        service_updown: 'telegramRuleTypeService',
        vm_state: 'telegramRuleTypeVm',
        node_online: 'telegramRuleTypeNode',
        netdev_updown: 'telegramRuleTypeNetdev',
        host_temp: 'telegramRuleTypeHostTemp',
        host_link_speed: 'telegramRuleTypeHostLink',
        truenas_disk_state: 'telegramRuleTypeTrueNASDisk',
        truenas_pool_usage: 'telegramRuleTypeTrueNASPoolUsage',
        truenas_service_state: 'telegramRuleTypeTrueNASService',
        truenas_pool_state: 'telegramRuleTypeTrueNASPoolState',
        ups_load_high: 'telegramRuleTypeUpsLoad',
        ups_on_battery: 'telegramRuleTypeUpsBattery',
        ups_back_to_mains: 'telegramRuleTypeUpsMains',
        ups_charge_low: 'telegramRuleTypeUpsChargeLow',
        ups_charge_full: 'telegramRuleTypeUpsChargeFull',
        smart_sensor_error: 'telegramRuleTypeSmartSensorError',
        smart_sensor_threshold: 'telegramRuleTypeSmartSensorThreshold'
    };
    return t(m[type] || type);
}

function syncTelegramRuleMessageFromModalIfOpen() {
    const modalEl = document.getElementById('telegramRuleMessageModal');
    if (!modalEl) return;
    const rid = modalEl.dataset.editingRuleId;
    if (!rid) return;
    const ta = document.getElementById('telegramRuleMessageModalTextarea');
    if (!ta) return;
    const rule = findTelegramRuleById(rid);
    if (!rule) return;
    const mt = String(ta.value || '').trim();
    if (mt) rule.messageTemplate = mt;
    else delete rule.messageTemplate;
}

function buildTelegramVarsListHtml(type) {
    const key = 'telegramMessageVars_' + String(type || 'service_updown');
    const raw = t(key);
    if (!raw || raw === key) {
        return `<li class="text-muted small">${escapeHtml(t('telegramVarsFallback') || '—')}</li>`;
    }
    const parts = String(raw).split('|').map((s) => s.trim()).filter(Boolean);
    return parts.map((line) => {
        const m = line.match(/^(\{[^}]+\})\s*[—–\-]\s*(.+)$/);
        if (m) {
            return `<li><code>${escapeHtml(m[1])}</code> <span class="text-muted">${escapeHtml(m[2].trim())}</span></li>`;
        }
        return `<li class="small">${escapeHtml(line)}</li>`;
    }).join('');
}

function localizeTelegramMessageModal() {
    setText('telegramRuleMessageModalTitleText', t('telegramMessageModalTitle'));
    setText('telegramRuleMessageModalEmptyHint', t('telegramMessageModalEmptyHint'));
    setText('telegramRuleMessageModalTextareaLabel', t('telegramMessageModalTextareaLabel'));
    setText('telegramRuleMessageModalVarsTitle', t('telegramMessageModalVarsTitle'));
    setText('telegramRuleMessageModalCancelText', t('telegramMessageModalCancel'));
    setText('telegramRuleMessageModalSaveText', t('telegramMessageModalSave'));
    const ta = document.getElementById('telegramRuleMessageModalTextarea');
    if (ta) ta.placeholder = t('settingsTelegramMessageTemplatePlaceholder') || '';
}

function openTelegramRuleMessageModal(ruleId) {
    syncTelegramRulesFromDom();
    const rule = findTelegramRuleById(ruleId);
    if (!rule) return;
    const modalEl = document.getElementById('telegramRuleMessageModal');
    const ta = document.getElementById('telegramRuleMessageModalTextarea');
    if (!modalEl || !ta) return;
    modalEl.dataset.editingRuleId = String(ruleId);
    ta.value = rule.messageTemplate || '';
    const typeLine = document.getElementById('telegramRuleMessageModalTypeLine');
    if (typeLine) typeLine.textContent = getTelegramRuleTypeLabel(rule.type || 'service_updown');
    const ul = document.getElementById('telegramRuleMessageModalVarsList');
    if (ul) ul.innerHTML = buildTelegramVarsListHtml(String(rule.type || 'service_updown'));
    localizeTelegramMessageModal();
    const m = bootstrap.Modal.getOrCreateInstance(modalEl);
    m.show();
}

function saveTelegramRuleMessageModal() {
    const modalEl = document.getElementById('telegramRuleMessageModal');
    const rid = modalEl && modalEl.dataset.editingRuleId;
    if (!rid) return;
    const ta = document.getElementById('telegramRuleMessageModalTextarea');
    const rule = findTelegramRuleById(rid);
    if (!rule) return;
    const mt = ta ? String(ta.value || '').trim() : '';
    if (mt) rule.messageTemplate = mt;
    else delete rule.messageTemplate;
    const inst = modalEl && bootstrap.Modal.getInstance(modalEl);
    if (inst) inst.hide();
    delete modalEl.dataset.editingRuleId;
    renderTelegramRulesTable();
}

function bindTelegramRuleMessageModalOnce() {
    if (telegramRuleMessageModalBound) return;
    telegramRuleMessageModalBound = true;
    const modalEl = document.getElementById('telegramRuleMessageModal');
    const saveBtn = document.getElementById('telegramRuleMessageModalSaveBtn');
    if (saveBtn) saveBtn.addEventListener('click', () => saveTelegramRuleMessageModal());
    if (modalEl) {
        modalEl.addEventListener('hidden.bs.modal', () => {
            delete modalEl.dataset.editingRuleId;
        });
    }
}

function buildTelegramRuleTargetSelectHtml(rule) {
    const typ = String(rule.type || 'service_updown');
    if (typ === 'service_updown') {
        const list = Array.isArray(monitoredServices) ? monitoredServices : [];
        const selected = new Set(getRuleNumberTargetsClient(rule, 'serviceIds', 'serviceId').map((x) => Number(x)));
        const opts = list.map((s) => {
            const id = s.id != null ? s.id : 0;
            const sel = selected.has(Number(id)) ? ' selected' : '';
            const lab = escapeHtml(s.name || getServiceTargetDisplay(s) || String(id));
            return `<option value="${id}"${sel}>${lab}</option>`;
        }).join('');
        return `<select class="form-select form-select-sm" data-tr-field="targetServices" data-rule-id="${escapeHtml(rule.id)}" multiple size="4">${opts || '<option value="">—</option>'}</select>`;
    }
    if (typ === 'vm_state') {
        const vms = getClusterVms();
        const idList = Array.from(new Set((Array.isArray(monitoredVmIds) ? monitoredVmIds : []).map(Number)))
            .filter((id) => Number.isFinite(id))
            .sort((a, b) => a - b);
        const selected = new Set(getRuleNumberTargetsClient(rule, 'vmids', 'vmid').map((x) => Number(x)));
        const opts = idList.map((id) => {
            const sel = selected.has(id) ? ' selected' : '';
            const vm = vms.find((v) => Number(v.vmid || v.id) === id);
            const lab = vm ? `${escapeHtml(vm.name || '')} [${id}]` : String(id);
            return `<option value="${id}"${sel}>${lab}</option>`;
        }).join('');
        return `<select class="form-select form-select-sm" data-tr-field="targetVmids" data-rule-id="${escapeHtml(rule.id)}" multiple size="4">${opts || '<option value="">—</option>'}</select>`;
    }
    if (typ === 'node_online' || typ === 'host_temp' || typ === 'host_link_speed') {
        const names = getClusterNodeNamesForTelegramRules();
        const selectedNodes = new Set(getRuleNodeNamesClient(rule));
        const fallback = selectedNodes.size ? Array.from(selectedNodes) : ['pve'];
        const uniq = Array.from(new Set((names.length ? names : []).concat(fallback)));
        const opts = uniq.map((name) => {
            const sel = selectedNodes.has(String(name)) ? ' selected' : '';
            return `<option value="${escapeHtml(name)}"${sel}>${escapeHtml(name)}</option>`;
        }).join('');
        return `<select class="form-select form-select-sm" data-tr-field="targetNodes" data-rule-id="${escapeHtml(rule.id)}" multiple size="4">${opts}</select>`;
    }
    if (typ === 'netdev_updown') {
        const opts = Array.from({ length: 10 }, (_, i) => i + 1).map((slot) => {
            const sel = Number(rule.netdevSlot) === slot ? ' selected' : '';
            return `<option value="${slot}"${sel}>${slot}</option>`;
        }).join('');
        return `<select class="form-select form-select-sm" data-tr-field="target" data-rule-id="${escapeHtml(rule.id)}">${opts}</select>`;
    }
    if (typ === 'ups_load_high' || typ === 'ups_on_battery' || typ === 'ups_back_to_mains' || typ === 'ups_charge_low' || typ === 'ups_charge_full') {
        const selected = new Set(getRuleNumberTargetsClient(rule, 'upsSlots', 'upsSlot').map((x) => Number(x)));
        const opts = getUpsRuleTargetOptions(rule).map((it) => {
            const sel = selected.has(Number(it.slot)) ? ' selected' : '';
            return `<option value="${escapeHtml(String(it.slot))}"${sel}>${escapeHtml(it.label)}</option>`;
        }).join('');
        return `<select class="form-select form-select-sm" data-tr-field="targetUpsSlots" data-rule-id="${escapeHtml(rule.id)}" multiple size="4">${opts || '<option value="1">UPS 1</option>'}</select>`;
    }
    if (typ === 'truenas_disk_state') {
        const selected = new Set((Array.isArray(rule.diskIds) ? rule.diskIds : [rule.diskId]).map((x) => String(x || '').trim()).filter(Boolean));
        const disks = Array.isArray(lastTrueNASOverviewData?.disks) ? lastTrueNASOverviewData.disks : [];
        const opts = disks.map((d, i) => {
            const id = String(d?.entityId || d?.id || d?.name || (i + 1));
            const sel = selected.has(id) ? ' selected' : '';
            return `<option value="${escapeHtml(id)}"${sel}>${escapeHtml(d?.name || ('Disk ' + (i + 1)))}</option>`;
        }).join('');
        return `<select class="form-select form-select-sm" data-tr-field="targetTrueNASDisks" data-rule-id="${escapeHtml(rule.id)}" multiple size="4">${opts || '<option value="">—</option>'}</select>`;
    }
    if (typ === 'truenas_service_state') {
        const selected = new Set((Array.isArray(rule.truenasServiceIds) ? rule.truenasServiceIds : [rule.truenasServiceId]).map((x) => String(x || '').trim()).filter(Boolean));
        const services = Array.isArray(lastTrueNASOverviewData?.services) ? lastTrueNASOverviewData.services : [];
        const opts = services.map((s, i) => {
            const id = String(s?.entityId || s?.id || s?.name || (i + 1));
            const sel = selected.has(id) ? ' selected' : '';
            return `<option value="${escapeHtml(id)}"${sel}>${escapeHtml(s?.name || ('Service ' + (i + 1)))}</option>`;
        }).join('');
        return `<select class="form-select form-select-sm" data-tr-field="targetTrueNASServices" data-rule-id="${escapeHtml(rule.id)}" multiple size="4">${opts || '<option value="">—</option>'}</select>`;
    }
    if (typ === 'truenas_pool_state' || typ === 'truenas_pool_usage') {
        const selected = new Set((Array.isArray(rule.poolIds) ? rule.poolIds : [rule.poolId]).map((x) => String(x || '').trim()).filter(Boolean));
        const pools = Array.isArray(lastTrueNASOverviewData?.pools) ? lastTrueNASOverviewData.pools : [];
        const opts = pools.map((p, i) => {
            const id = String(p?.id || p?.name || (i + 1));
            const sel = selected.has(id) ? ' selected' : '';
            return `<option value="${escapeHtml(id)}"${sel}>${escapeHtml(p?.name || ('Pool ' + (i + 1)))}</option>`;
        }).join('');
        return `<select class="form-select form-select-sm" data-tr-field="targetTrueNASPools" data-rule-id="${escapeHtml(rule.id)}" multiple size="4">${opts || '<option value="">—</option>'}</select>`;
    }
    if (typ === 'smart_sensor_error' || typ === 'smart_sensor_threshold') {
        const selected = new Set((Array.isArray(rule.smartSensorIds) ? rule.smartSensorIds : [rule.smartSensorId]).map((x) => String(x || '').trim()).filter(Boolean));
        const optsList = getSmartSensorOptionsForTelegramRules();
        const opts = optsList.map((it) => {
            const sel = selected.has(it.id) ? ' selected' : '';
            return `<option value="${escapeHtml(it.id)}"${sel}>${escapeHtml(it.label)}</option>`;
        }).join('');
        const emptyHint = t('telegramRuleSmartSensorListEmpty') || 'Настройте датчики в разделе умного дома';
        return `<select class="form-select form-select-sm" data-tr-field="targetSmartSensors" data-rule-id="${escapeHtml(rule.id)}" multiple size="4">${opts || `<option value="" disabled>${escapeHtml(emptyHint)}</option>`}</select>`;
    }
    return '—';
}

function telegramSmartSensorCompareLabel(op) {
    const key = {
        gt: 'telegramSmartSensorOpGt',
        gte: 'telegramSmartSensorOpGte',
        lt: 'telegramSmartSensorOpLt',
        lte: 'telegramSmartSensorOpLte'
    }[String(op)] || 'telegramSmartSensorOpGte';
    const s = t(key);
    return s && s !== key ? s : String(op);
}

function buildTelegramRuleExtraHtml(rule) {
    const typ = String(rule.type || '');
    if (typ === 'host_temp') {
        const v = rule.tempThresholdC != null && rule.tempThresholdC !== '' ? String(rule.tempThresholdC) : '85';
        return `<input type="number" class="form-control form-control-sm" min="0" max="120" step="1" value="${escapeHtml(v)}" data-tr-field="extraTemp" data-rule-id="${escapeHtml(rule.id)}" title="${escapeHtml(t('telegramRuleTempHint') || '°C')}">`;
    }
    if (typ === 'ups_load_high') {
        const v = rule.loadThresholdPct != null && rule.loadThresholdPct !== '' ? String(rule.loadThresholdPct) : '80';
        return `<input type="number" class="form-control form-control-sm" min="0" max="100" step="1" value="${escapeHtml(v)}" data-tr-field="extraUpsLoad" data-rule-id="${escapeHtml(rule.id)}" title="${escapeHtml(t('telegramRuleUpsLoadHint') || '%')}">`;
    }
    if (typ === 'ups_charge_low') {
        const v = rule.chargeThresholdPct != null && rule.chargeThresholdPct !== '' ? String(rule.chargeThresholdPct) : '20';
        return `<input type="number" class="form-control form-control-sm" min="0" max="100" step="1" value="${escapeHtml(v)}" data-tr-field="extraUpsChargeLow" data-rule-id="${escapeHtml(rule.id)}" title="${escapeHtml(t('telegramRuleUpsChargeLowHint') || '%')}">`;
    }
    if (typ === 'truenas_pool_usage') {
        const v = rule.poolUsageThresholdPct != null && rule.poolUsageThresholdPct !== '' ? String(rule.poolUsageThresholdPct) : '85';
        return `<input type="number" class="form-control form-control-sm" min="0" max="100" step="1" value="${escapeHtml(v)}" data-tr-field="extraTrueNASPoolUsage" data-rule-id="${escapeHtml(rule.id)}" title="${escapeHtml(t('telegramRuleTrueNASPoolUsageHint') || '%')}">`;
    }
    if (typ === 'smart_sensor_threshold') {
        const fk = rule.smartSensorFieldKey != null ? String(rule.smartSensorFieldKey) : 'temperature';
        const thr = rule.smartSensorThreshold != null && rule.smartSensorThreshold !== '' ? String(rule.smartSensorThreshold) : '30';
        const op = String(rule.smartSensorCompare || 'gte');
        const opOpts = ['gt', 'gte', 'lt', 'lte'].map((o) => {
            const sel = op === o ? ' selected' : '';
            return `<option value="${o}"${sel}>${escapeHtml(telegramSmartSensorCompareLabel(o))}</option>`;
        }).join('');
        const fieldKeys = getConfiguredSmartSensorFieldKeysForRule(rule);
        const fkTrim = String(fk || '').trim();
        const dlKeys = [...fieldKeys];
        if (fkTrim && !dlKeys.includes(fkTrim)) dlKeys.push(fkTrim);
        dlKeys.sort((a, b) => a.localeCompare(b, undefined, { sensitivity: 'base' }));
        const dlId = telegramSmartSensorDatalistId(rule.id);
        const dlOpts = dlKeys.map((k) => `<option value="${escapeHtml(k)}"></option>`).join('');
        const ph = t('telegramRuleSmartSensorFieldPickOrType') || t('telegramRuleSmartSensorFieldPlaceholder') || '';
        return `
            <div class="d-flex flex-column gap-1">
                <datalist id="${escapeHtml(dlId)}">${dlOpts}</datalist>
                <input type="text" class="form-control form-control-sm font-monospace" list="${escapeHtml(dlId)}" value="${escapeHtml(fk)}" data-tr-field="extraSmartSensorField" data-rule-id="${escapeHtml(rule.id)}" placeholder="${escapeHtml(ph)}" title="${escapeHtml(t('telegramRuleSmartSensorFieldHint') || '')}" autocomplete="off">
                <select class="form-select form-select-sm" data-tr-field="extraSmartSensorCompare" data-rule-id="${escapeHtml(rule.id)}">${opOpts}</select>
                <input type="number" class="form-control form-control-sm" step="any" value="${escapeHtml(thr)}" data-tr-field="extraSmartSensorThr" data-rule-id="${escapeHtml(rule.id)}" title="${escapeHtml(t('telegramRuleSmartSensorThrHint') || 'Порог')}">
            </div>`;
    }
    return `<span class="text-muted small">—</span>`;
}

function renderTelegramRulesTable() {
    syncTelegramRuleMessageFromModalIfOpen();
    const body = document.getElementById('telegramRulesTableBody');
    if (!body) return;
    const rules = Array.isArray(telegramNotificationRules) ? telegramNotificationRules : [];
    if (!rules.length) {
        body.innerHTML = `<tr><td colspan="8" class="text-muted small">${escapeHtml(t('telegramRulesEmpty') || 'Нет правил — добавьте или сохраните настройки после миграции со старого формата.')}</td></tr>`;
        return;
    }
    body.innerHTML = rules.map((rule) => {
        const typeOpts = ['service_updown', 'vm_state', 'node_online', 'netdev_updown', 'host_temp', 'host_link_speed', 'truenas_disk_state', 'truenas_pool_usage', 'truenas_service_state', 'truenas_pool_state', 'ups_load_high', 'ups_on_battery', 'ups_back_to_mains', 'ups_charge_low', 'ups_charge_full', 'smart_sensor_error', 'smart_sensor_threshold'].map((tp) => {
            const sel = String(rule.type) === tp ? ' selected' : '';
            return `<option value="${tp}"${sel}>${escapeHtml(getTelegramRuleTypeLabel(tp))}</option>`;
        }).join('');
        const hasTpl = !!(rule.messageTemplate && String(rule.messageTemplate).trim());
        const statusText = hasTpl ? (t('telegramMessageTemplateStatusCustom') || 'Custom') : (t('telegramMessageTemplateStatusDefault') || 'Default');
        return `
            <tr data-rule-row="${escapeHtml(rule.id)}">
                <td class="text-center align-middle">
                    <input type="checkbox" class="form-check-input" data-tr-field="enabled" data-rule-id="${escapeHtml(rule.id)}" ${rule.enabled !== false ? 'checked' : ''}>
                </td>
                <td>
                    <select class="form-select form-select-sm" data-tr-field="type" data-rule-id="${escapeHtml(rule.id)}">${typeOpts}</select>
                </td>
                <td class="telegram-rule-target">${buildTelegramRuleTargetSelectHtml(rule)}</td>
                <td class="telegram-rule-extra">${buildTelegramRuleExtraHtml(rule)}</td>
                <td class="align-top">
                    <button type="button" class="btn btn-sm btn-outline-secondary" data-tr-edit-msg="${escapeHtml(rule.id)}">
                        <i class="bi bi-pencil-square me-1"></i>${escapeHtml(t('telegramRuleEditMessage') || 'Edit')}
                    </button>
                    <div class="text-muted small mt-1">${escapeHtml(statusText)}</div>
                </td>
                <td><input type="text" class="form-control form-control-sm" list="telegramTgChatsDatalist" data-tr-field="chatId" data-rule-id="${escapeHtml(rule.id)}" value="${escapeHtml(rule.chatId || '')}" placeholder="${escapeHtml(t('settingsTelegramChatIdPlaceholder') || 'chat_id')}" autocomplete="off"></td>
                <td><datalist id="${escapeHtml(telegramRuleThreadDatalistId(rule.id))}"></datalist><input type="text" class="form-control form-control-sm" list="${escapeHtml(telegramRuleThreadDatalistId(rule.id))}" data-tr-field="threadId" data-rule-id="${escapeHtml(rule.id)}" value="${escapeHtml(rule.threadId || '')}" placeholder="${escapeHtml(t('settingsTelegramThreadPlaceholder') || 'thread')}" autocomplete="off" title="${escapeHtml(t('settingsTelegramThreadDatalistHint') || '')}"></td>
                <td class="text-nowrap">
                    <button type="button" class="btn btn-sm btn-outline-secondary me-1" data-tr-test="${escapeHtml(rule.id)}" title="${escapeHtml(t('telegramTestRuleButton') || 'Test')}"><i class="bi bi-send"></i></button>
                    <button type="button" class="btn btn-sm btn-outline-danger" data-tr-remove="${escapeHtml(rule.id)}" title="${escapeHtml(t('remove') || 'Удалить')}"><i class="bi bi-trash"></i></button>
                </td>
            </tr>`;
    }).join('');

    body.querySelectorAll('[data-tr-field]').forEach((el) => {
        const field = el.getAttribute('data-tr-field');
        if (field === 'type') el.addEventListener('change', onTelegramRuleTypeChange);
        else {
            el.addEventListener('change', onTelegramRuleFieldChange);
            el.addEventListener('input', onTelegramRuleFieldChange);
        }
    });
    body.querySelectorAll('[data-tr-edit-msg]').forEach((btn) => {
        btn.addEventListener('click', () => openTelegramRuleMessageModal(btn.getAttribute('data-tr-edit-msg')));
    });
    body.querySelectorAll('[data-tr-remove]').forEach((btn) => {
        btn.addEventListener('click', () => removeTelegramNotificationRule(btn.getAttribute('data-tr-remove')));
    });
    body.querySelectorAll('[data-tr-test]').forEach((btn) => {
        btn.addEventListener('click', () => testTelegramNotificationRule(btn.getAttribute('data-tr-test')));
    });
    refillTelegramChatsDatalistFromCache();
    body.querySelectorAll('[data-tr-field="chatId"]').forEach((inp) => {
        const rid = inp.getAttribute('data-rule-id');
        if (rid) refillTelegramThreadDatalistForRule(rid, inp.value);
    });
}

function telegramTestRuleApiErrorMessage(errText) {
    const s = String(errText || '').toLowerCase();
    if (s.includes('chat_id')) return t('telegramTestRuleNeedChat');
    if (s.includes('bot_token')) return t('telegramTestRuleNeedToken');
    return String(errText || 'error');
}

/** Совпадает с серверной проверкой — только реальный токен бота, не маска из поля. */
function isTelegramBotTokenFormatClient(s) {
    return /^[0-9]{5,}:[A-Za-z0-9_-]{25,}$/.test(String(s || '').trim());
}

async function testTelegramNotificationRule(ruleId) {
    syncTelegramRuleMessageFromModalIfOpen();
    syncTelegramRulesFromDom();
    const rule = findTelegramRuleById(ruleId);
    if (!rule) return;
    if (!String(rule.chatId || '').trim()) {
        showToast(t('telegramTestRuleNeedChat') || 'Укажите chat_id', 'warning');
        return;
    }
    const tokEl = document.getElementById('settingsTelegramBotTokenInput');
    const rawTok = tokEl ? String(tokEl.value).trim() : '';
    const hasNewToken = rawTok && isTelegramBotTokenFormatClient(rawTok);
    if (!hasNewToken && !telegramBotTokenSet) {
        showToast(t('telegramTestRuleNeedToken') || 'Нужен токен бота', 'warning');
        return;
    }
    const payload = { rule: { ...rule } };
    if (hasNewToken) payload.telegramBotToken = rawTok;
    const proxyEl = document.getElementById('settingsTelegramProxyUrlInput');
    if (proxyEl && String(proxyEl.value || '').trim()) payload.telegramProxyUrl = String(proxyEl.value).trim();
    try {
        const res = await fetch('/api/settings/telegram-test-rule', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload)
        });
        const data = await res.json().catch(() => ({}));
        if (!res.ok || !data.success) {
            const errRaw = data.error || res.statusText || 'error';
            throw new Error(telegramTestRuleApiErrorMessage(errRaw));
        }
        showToast(t('telegramTestRuleSuccess') || 'Отправлено', 'success');
    } catch (e) {
        showToast((t('telegramTestRuleError') || 'Ошибка') + ': ' + (e.message || String(e)), 'error');
    }
}

function onTelegramRuleTypeChange(ev) {
    const el = ev && ev.target;
    const rid = el && el.getAttribute('data-rule-id');
    if (!rid) return;
    syncTelegramRuleMessageFromModalIfOpen();
    const modalEl = document.getElementById('telegramRuleMessageModal');
    if (modalEl && telegramRuleIdEquals(modalEl.dataset.editingRuleId, rid)) {
        const inst = bootstrap.Modal.getInstance(modalEl);
        if (inst) inst.hide();
        delete modalEl.dataset.editingRuleId;
    }
    const rule = findTelegramRuleById(rid);
    if (!rule) return;
    rule.type = String(el.value || 'service_updown');
    delete rule.serviceId;
    delete rule.serviceIds;
    delete rule.vmid;
    delete rule.vmids;
    delete rule.nodeName;
    delete rule.nodeNames;
    delete rule.netdevSlot;
    delete rule.tempThresholdC;
    delete rule.diskId;
    delete rule.diskIds;
    delete rule.poolId;
    delete rule.poolIds;
    delete rule.poolUsageThresholdPct;
    delete rule.truenasServiceId;
    delete rule.truenasServiceIds;
    delete rule.upsSlot;
    delete rule.upsSlots;
    delete rule.loadThresholdPct;
    delete rule.chargeThresholdPct;
    delete rule.smartSensorId;
    delete rule.smartSensorIds;
    delete rule.smartSensorFieldKey;
    delete rule.smartSensorCompare;
    delete rule.smartSensorThreshold;
    const nn = getClusterNodeNamesForTelegramRules()[0] || 'pve';
    if (rule.type === 'service_updown') {
        const list = Array.isArray(monitoredServices) ? monitoredServices : [];
        const sid = list[0] && list[0].id != null ? Number(list[0].id) : 0;
        rule.serviceId = sid;
        rule.serviceIds = [sid];
    } else if (rule.type === 'vm_state') {
        const id0 = Array.isArray(monitoredVmIds) && monitoredVmIds[0] != null ? Number(monitoredVmIds[0]) : 0;
        const vmid = Number.isFinite(id0) ? id0 : 0;
        rule.vmid = vmid;
        rule.vmids = [vmid];
    } else if (rule.type === 'netdev_updown') rule.netdevSlot = 1;
    else if (rule.type === 'node_online') {
        rule.nodeName = nn;
        rule.nodeNames = [nn];
    } else if (rule.type === 'host_temp') {
        rule.nodeName = nn;
        rule.nodeNames = [nn];
        rule.tempThresholdC = 85;
    } else if (rule.type === 'host_link_speed') {
        rule.nodeName = nn;
        rule.nodeNames = [nn];
    } else if (rule.type === 'truenas_disk_state') {
        const d = Array.isArray(lastTrueNASOverviewData?.disks) ? lastTrueNASOverviewData.disks[0] : null;
        const id = String(d?.entityId || d?.id || d?.name || 'disk');
        rule.diskId = id;
        rule.diskIds = [id];
    } else if (rule.type === 'truenas_pool_state') {
        const p = Array.isArray(lastTrueNASOverviewData?.pools) ? lastTrueNASOverviewData.pools[0] : null;
        const id = String(p?.id || p?.name || 'pool');
        rule.poolId = id;
        rule.poolIds = [id];
    } else if (rule.type === 'truenas_pool_usage') {
        const p = Array.isArray(lastTrueNASOverviewData?.pools) ? lastTrueNASOverviewData.pools[0] : null;
        const id = String(p?.id || p?.name || 'pool');
        rule.poolId = id;
        rule.poolIds = [id];
        rule.poolUsageThresholdPct = 85;
    } else if (rule.type === 'truenas_service_state') {
        const s = Array.isArray(lastTrueNASOverviewData?.services) ? lastTrueNASOverviewData.services[0] : null;
        const id = String(s?.entityId || s?.id || s?.name || 'service');
        rule.truenasServiceId = id;
        rule.truenasServiceIds = [id];
    } else if (rule.type === 'ups_load_high') {
        rule.upsSlot = 1;
        rule.upsSlots = [1];
        rule.loadThresholdPct = 80;
    } else if (rule.type === 'ups_on_battery' || rule.type === 'ups_back_to_mains' || rule.type === 'ups_charge_full') {
        rule.upsSlot = 1;
        rule.upsSlots = [1];
    } else if (rule.type === 'ups_charge_low') {
        rule.upsSlot = 1;
        rule.upsSlots = [1];
        rule.chargeThresholdPct = 20;
    } else if (rule.type === 'smart_sensor_error' || rule.type === 'smart_sensor_threshold') {
        const opts = getSmartSensorOptionsForTelegramRules();
        const first = opts[0];
        const sid = first ? first.id : 'sensor';
        rule.smartSensorId = sid;
        rule.smartSensorIds = [sid];
        if (rule.type === 'smart_sensor_threshold') {
            rule.smartSensorFieldKey = 'temperature';
            rule.smartSensorCompare = 'gte';
            rule.smartSensorThreshold = 30;
        }
    }
    renderTelegramRulesTable();
}

function onTelegramRuleFieldChange(ev) {
    syncTelegramRulesFromDom();
    const el = ev && ev.target;
    const field = el && el.getAttribute('data-tr-field');
    if (field === 'targetSmartSensors') {
        const rid = el.getAttribute('data-rule-id');
        const rule = rid && findTelegramRuleById(rid);
        if (rule && rule.type === 'smart_sensor_threshold') {
            renderTelegramRulesTable();
        }
    }
    if (field === 'chatId') {
        const rid = el.getAttribute('data-rule-id');
        if (rid) refillTelegramThreadDatalistForRule(rid, el.value);
    }
}

function syncTelegramRulesFromDom() {
    syncTelegramRuleMessageFromModalIfOpen();
    const body = document.getElementById('telegramRulesTableBody');
    if (!body) return;
    const map = new Map((telegramNotificationRules || []).map((r) => [String(r.id), { ...r }]));
    body.querySelectorAll('tr[data-rule-row]').forEach((tr) => {
        const rid = tr.getAttribute('data-rule-row');
        const rule = map.get(rid) || { id: rid };
        const en = tr.querySelector('[data-tr-field="enabled"]');
        if (en) rule.enabled = !!en.checked;
        const typEl = tr.querySelector('[data-tr-field="type"]');
        if (typEl) rule.type = String(typEl.value || 'service_updown');
        const chatEl = tr.querySelector('[data-tr-field="chatId"]');
        if (chatEl) rule.chatId = String(chatEl.value || '').trim();
        const thEl = tr.querySelector('[data-tr-field="threadId"]');
        if (thEl) {
            const t0 = String(thEl.value || '').trim();
            rule.threadId = t0 || undefined;
        }
        const tgt = tr.querySelector('[data-tr-field="target"]');
        if (tgt) {
            const typ = String(rule.type);
            const v = String(tgt.value || '').trim();
            delete rule.serviceId;
            delete rule.serviceIds;
            delete rule.vmid;
            delete rule.vmids;
            delete rule.nodeName;
            delete rule.nodeNames;
            delete rule.netdevSlot;
            delete rule.tempThresholdC;
            delete rule.diskId;
            delete rule.diskIds;
            delete rule.poolId;
            delete rule.poolIds;
            delete rule.poolUsageThresholdPct;
            delete rule.truenasServiceId;
            delete rule.truenasServiceIds;
            delete rule.upsSlot;
            delete rule.upsSlots;
            delete rule.loadThresholdPct;
            delete rule.chargeThresholdPct;
            delete rule.smartSensorId;
            delete rule.smartSensorIds;
            delete rule.smartSensorFieldKey;
            delete rule.smartSensorCompare;
            delete rule.smartSensorThreshold;
            if (typ === 'service_updown') rule.serviceId = parseInt(v, 10);
            else if (typ === 'vm_state') rule.vmid = parseInt(v, 10);
            else if (typ === 'node_online' || typ === 'host_temp' || typ === 'host_link_speed') {
                rule.nodeName = v;
                rule.nodeNames = [v];
            }
            else if (typ === 'netdev_updown') rule.netdevSlot = parseInt(v, 10);
            else if (typ === 'ups_load_high' || typ === 'ups_on_battery' || typ === 'ups_back_to_mains' || typ === 'ups_charge_low' || typ === 'ups_charge_full') rule.upsSlot = parseInt(v, 10);
        }
        const tgtServices = tr.querySelector('[data-tr-field="targetServices"]');
        if (tgtServices && String(rule.type) === 'service_updown') {
            const vals = Array.from(tgtServices.selectedOptions || [])
                .map((o) => parseInt(String(o.value || '').trim(), 10))
                .filter((n) => Number.isFinite(n));
            const uniq = Array.from(new Set(vals));
            if (uniq.length) {
                rule.serviceIds = uniq;
                rule.serviceId = uniq[0];
            }
        }
        const tgtVmids = tr.querySelector('[data-tr-field="targetVmids"]');
        if (tgtVmids && String(rule.type) === 'vm_state') {
            const vals = Array.from(tgtVmids.selectedOptions || [])
                .map((o) => parseInt(String(o.value || '').trim(), 10))
                .filter((n) => Number.isFinite(n));
            const uniq = Array.from(new Set(vals));
            if (uniq.length) {
                rule.vmids = uniq;
                rule.vmid = uniq[0];
            }
        }
        const tgtNodes = tr.querySelector('[data-tr-field="targetNodes"]');
        if (tgtNodes) {
            const typ = String(rule.type);
            if (typ === 'node_online' || typ === 'host_temp' || typ === 'host_link_speed') {
                const vals = Array.from(tgtNodes.selectedOptions || [])
                    .map((o) => String(o.value || '').trim())
                    .filter(Boolean);
                const uniq = Array.from(new Set(vals));
                if (uniq.length) {
                    rule.nodeNames = uniq;
                    rule.nodeName = uniq[0];
                }
            }
        }
        const tgtUps = tr.querySelector('[data-tr-field="targetUpsSlots"]');
        if (tgtUps && (String(rule.type) === 'ups_load_high' || String(rule.type) === 'ups_on_battery' || String(rule.type) === 'ups_back_to_mains' || String(rule.type) === 'ups_charge_low' || String(rule.type) === 'ups_charge_full')) {
            const vals = Array.from(tgtUps.selectedOptions || [])
                .map((o) => parseInt(String(o.value || '').trim(), 10))
                .filter((n) => Number.isFinite(n));
            const uniq = Array.from(new Set(vals));
            if (uniq.length) {
                rule.upsSlots = uniq;
                rule.upsSlot = uniq[0];
            }
        }
        const tgtTnDisks = tr.querySelector('[data-tr-field="targetTrueNASDisks"]');
        if (tgtTnDisks && String(rule.type) === 'truenas_disk_state') {
            const vals = Array.from(tgtTnDisks.selectedOptions || []).map((o) => String(o.value || '').trim()).filter(Boolean);
            const uniq = Array.from(new Set(vals));
            if (uniq.length) {
                rule.diskIds = uniq;
                rule.diskId = uniq[0];
            }
        }
        const tgtTnPools = tr.querySelector('[data-tr-field="targetTrueNASPools"]');
        if (tgtTnPools && (String(rule.type) === 'truenas_pool_state' || String(rule.type) === 'truenas_pool_usage')) {
            const vals = Array.from(tgtTnPools.selectedOptions || []).map((o) => String(o.value || '').trim()).filter(Boolean);
            const uniq = Array.from(new Set(vals));
            if (uniq.length) {
                rule.poolIds = uniq;
                rule.poolId = uniq[0];
            }
        }
        const tgtTnServices = tr.querySelector('[data-tr-field="targetTrueNASServices"]');
        if (tgtTnServices && String(rule.type) === 'truenas_service_state') {
            const vals = Array.from(tgtTnServices.selectedOptions || []).map((o) => String(o.value || '').trim()).filter(Boolean);
            const uniq = Array.from(new Set(vals));
            if (uniq.length) {
                rule.truenasServiceIds = uniq;
                rule.truenasServiceId = uniq[0];
            }
        }
        const tgtSmart = tr.querySelector('[data-tr-field="targetSmartSensors"]');
        if (tgtSmart && (String(rule.type) === 'smart_sensor_error' || String(rule.type) === 'smart_sensor_threshold')) {
            const vals = Array.from(tgtSmart.selectedOptions || []).map((o) => String(o.value || '').trim()).filter(Boolean);
            const uniq = Array.from(new Set(vals));
            if (uniq.length) {
                rule.smartSensorIds = uniq;
                rule.smartSensorId = uniq[0];
            }
        }
        const ex = tr.querySelector('[data-tr-field="extraTemp"]');
        if (ex && String(rule.type) === 'host_temp') {
            const n = parseFloat(ex.value);
            rule.tempThresholdC = Number.isFinite(n) ? n : 85;
        }
        const exUpsLoad = tr.querySelector('[data-tr-field="extraUpsLoad"]');
        if (exUpsLoad && String(rule.type) === 'ups_load_high') {
            const n = parseFloat(exUpsLoad.value);
            rule.loadThresholdPct = Number.isFinite(n) ? n : 80;
        }
        const exUpsChargeLow = tr.querySelector('[data-tr-field="extraUpsChargeLow"]');
        if (exUpsChargeLow && String(rule.type) === 'ups_charge_low') {
            const n = parseFloat(exUpsChargeLow.value);
            rule.chargeThresholdPct = Number.isFinite(n) ? n : 20;
        }
        const exTnPoolUsage = tr.querySelector('[data-tr-field="extraTrueNASPoolUsage"]');
        if (exTnPoolUsage && String(rule.type) === 'truenas_pool_usage') {
            const n = parseFloat(exTnPoolUsage.value);
            rule.poolUsageThresholdPct = Number.isFinite(n) ? n : 85;
        }
        const exSsField = tr.querySelector('[data-tr-field="extraSmartSensorField"]');
        if (exSsField && String(rule.type) === 'smart_sensor_threshold') {
            const fk = String(exSsField.value || '').trim();
            rule.smartSensorFieldKey = fk || 'temperature';
        }
        const exSsCmp = tr.querySelector('[data-tr-field="extraSmartSensorCompare"]');
        if (exSsCmp && String(rule.type) === 'smart_sensor_threshold') {
            const c = String(exSsCmp.value || 'gte').toLowerCase();
            rule.smartSensorCompare = ['gt', 'gte', 'lt', 'lte'].includes(c) ? c : 'gte';
        }
        const exSsThr = tr.querySelector('[data-tr-field="extraSmartSensorThr"]');
        if (exSsThr && String(rule.type) === 'smart_sensor_threshold') {
            const n = parseFloat(exSsThr.value);
            rule.smartSensorThreshold = Number.isFinite(n) ? n : 0;
        }
        map.set(rid, rule);
    });
    telegramNotificationRules = Array.from(map.values());
}

function addTelegramNotificationRule() {
    syncTelegramRulesFromDom();
    telegramNotificationRules = [...(telegramNotificationRules || []), getDefaultTelegramRule()];
    renderTelegramRulesTable();
}

function removeTelegramNotificationRule(ruleId) {
    syncTelegramRulesFromDom();
    const modalEl = document.getElementById('telegramRuleMessageModal');
    if (modalEl && telegramRuleIdEquals(modalEl.dataset.editingRuleId, ruleId)) {
        const inst = bootstrap.Modal.getInstance(modalEl);
        if (inst) inst.hide();
        delete modalEl.dataset.editingRuleId;
    }
    telegramNotificationRules = (telegramNotificationRules || []).filter((r) => !telegramRuleIdEquals(r.id, ruleId));
    renderTelegramRulesTable();
}

async function saveTelegramSettings() {
    syncTelegramRulesFromDom();
    const en = document.getElementById('settingsTelegramNotifyEnabled');
    const intervalEl = document.getElementById('settingsTelegramIntervalSec');
    const tokEl = document.getElementById('settingsTelegramBotTokenInput');
    const proxyEl = document.getElementById('settingsTelegramProxyUrlInput');
    const enabled = en && String(en.value) === '1';
    let interval = intervalEl ? parseInt(intervalEl.value, 10) : 60;
    if (!Number.isFinite(interval) || interval < 15) interval = 15;
    if (interval > 3600) interval = 3600;
    const payload = {
        telegramNotifyEnabled: enabled,
        telegramNotifyIntervalSec: interval,
        telegramNotificationRules: [...telegramNotificationRules],
        telegramProxyUrl: proxyEl ? String(proxyEl.value || '').trim() : ''
    };
    const rawTok = tokEl ? String(tokEl.value).trim() : '';
    if (rawTok && isTelegramBotTokenFormatClient(rawTok)) {
        payload.telegramBotToken = rawTok;
    }
    await saveSettingsToServer(payload);
    if (tokEl && payload.telegramBotToken) tokEl.value = '';
    showToast(t('dataUpdated') || 'Сохранено', 'success');
}

async function clearTelegramBotToken() {
    if (!confirm(t('settingsTelegramClearTokenConfirm') || 'Удалить токен бота?')) return;
    await saveSettingsToServer({ telegramClearBotToken: true });
    telegramBotTokenSet = false;
    showToast(t('dataUpdated') || 'Готово', 'success');
}

function getConnectionIdForType(type) {
    const backendType = type === 'truenas' ? 'truenas' : 'proxmox';
    const servers = backendType === 'truenas' ? truenasServers : proxmoxServers;
    const idx = backendType === 'truenas' ? currentTrueNASServerIndex : currentServerIndex;
    const activeUrl = Array.isArray(servers) && servers.length ? String(servers[idx] || servers[0] || '') : '';
    const direct = activeUrl ? (connectionIdMap[connectionKey(backendType, activeUrl)] || null) : null;
    if (direct) return direct;

    // Fallback to any saved connection for this backend type.
    if (backendType === 'proxmox') {
        for (const u of proxmoxServers) {
            const id = connectionIdMap[connectionKey('proxmox', u)];
            if (id) return id;
        }
    } else {
        for (const u of truenasServers) {
            const id = connectionIdMap[connectionKey('truenas', u)];
            if (id) return id;
        }
    }
    return null;
}

function getCurrentConnectionId() {
    return getConnectionIdForType('proxmox');
}

function getServerUrlForType(type) {
    const backendType = type === 'truenas' ? 'truenas' : 'proxmox';
    const servers = backendType === 'truenas' ? truenasServers : proxmoxServers;
    const idx = backendType === 'truenas' ? currentTrueNASServerIndex : currentServerIndex;
    return Array.isArray(servers) && servers.length ? String(servers[idx] || servers[0] || '') : '';
}

function getAuthHeadersForType(type) {
    const backendType = type === 'truenas' ? 'truenas' : 'proxmox';
    const connId = getConnectionIdForType(backendType);
    const serverUrl = getServerUrlForType(backendType);
    if (!serverUrl) return null;
    if (connId) {
        return { 'X-Connection-Id': connId, 'X-Server-Url': serverUrl };
    }
    if (!apiToken) return null;
    return {
        'Authorization': apiToken,
        'X-Server-Url': serverUrl
    };
}

function getCurrentProxmoxHeaders() {
    return getAuthHeadersForType('proxmox');
}

function getCurrentTrueNASHeaders() {
    return getAuthHeadersForType('truenas');
}

function getAuthHeadersForCurrentServerType() {
    return getCurrentProxmoxHeaders() || getCurrentTrueNASHeaders();
}

function saveConnectionId(type, url, id) {
    const normalizedUrl = normalizeUrlClient(url);
    const newKey = connectionKey(type, normalizedUrl);

    // Обновляем списки серверов, чтобы URL в настройках совпадал с тем, что в DB
    if (type === 'proxmox') {
        const servers = proxmoxServers;
        const idx = currentServerIndex;
        if (servers && typeof idx === 'number' && servers[idx]) {
            const previousUrl = servers[idx];
            const oldKey = connectionKey(type, previousUrl);
            if (oldKey !== newKey) delete connectionIdMap[oldKey];
            connectionIdMap[newKey] = id;
            servers[idx] = normalizedUrl;
            proxmoxServers = [...servers];
            saveSettingsToServer({ proxmoxServers: [...proxmoxServers], connectionIdMap: { ...connectionIdMap } });
            return;
        }
    } else if (type === 'truenas') {
        const servers = truenasServers;
        const idx = currentTrueNASServerIndex;
        if (servers && typeof idx === 'number' && servers[idx]) {
            const previousUrl = servers[idx];
            const oldKey = connectionKey(type, previousUrl);
            if (oldKey !== newKey) delete connectionIdMap[oldKey];
            connectionIdMap[newKey] = id;
            servers[idx] = normalizedUrl;
            truenasServers = [...servers];
            saveSettingsToServer({ truenasServers: [...truenasServers], connectionIdMap: { ...connectionIdMap } });
            return;
        }
    }

    connectionIdMap[newKey] = id;
    saveSettingsToServer({ connectionIdMap: { ...connectionIdMap } });
}

// (Запоминание токенов через cookies больше не используется; все секреты хранятся в DB через /api/connections/upsert)

async function logoutBackend(backendType) {
    const type = backendType === 'truenas' ? 'truenas' : 'proxmox';
    try {
        const url = getServerUrlForType(type);
        delete connectionIdMap[connectionKey(type, url)];
        saveSettingsToServer({ connectionIdMap: { ...connectionIdMap } });
        showToast(t('logoutSuccess'), 'success');
        apiToken = null;
        const tokenInputId = type === 'truenas' ? 'apiTokenTrueNAS' : 'apiToken';
        const logoutContainerId = type === 'truenas' ? 'logoutContainerTrueNAS' : 'logoutContainerProxmox';
        setValue(tokenInputId, '');
        if (type === 'proxmox') {
            const idEl = document.getElementById('apiTokenId');
            const secretEl = document.getElementById('apiTokenSecret');
            if (idEl) setValue('apiTokenId', '');
            if (secretEl) setValue('apiTokenSecret', '');
            if (idEl || secretEl) syncProxmoxApiTokenFromParts();
        }
        setDisplay(logoutContainerId, 'none');
        updateConnectionStatus(false, type);
        showConfig();
    } catch (error) {
        showToast(tParams('toastLogoutError', { msg: error.message }), 'error');
    }
}

function logoutAs(type) {
    logoutBackend(type === 'truenas' ? 'truenas' : 'proxmox');
}

// Check server status
async function checkServerStatus() {
    try {
        const response = await fetch('/api/status');
        const data = await response.json();
        setBackendOfflineBannerVisible(false);
        setHTML('serverStatus', '<i class="bi bi-check-circle"></i><span id="serverStatusText">' + t('serverWorking') + '</span>');
        const ss = document.getElementById('serverStatus');
        if (ss) {
            ss.classList.remove('app-topbar-pill--error');
            ss.classList.add('app-topbar-pill--ok');
        }
        const verEl = document.getElementById('footerVersion');
        if (verEl && data.version) verEl.textContent = 'v' + data.version;
    } catch (error) {
        setBackendOfflineBannerVisible(true);
        setHTML('serverStatus', '<i class="bi bi-exclamation-circle"></i><span id="serverStatusText">' + t('serverError') + '</span>');
        const ss = document.getElementById('serverStatus');
        if (ss) {
            ss.classList.remove('app-topbar-pill--ok');
            ss.classList.add('app-topbar-pill--error');
        }
    }
}

async function checkForAppUpdates(force = false, options = {}) {
    const manual = !!options.manual;
    const refresh = !!options.refresh;
    const silent = !!options.silent;
    if (!force && updateCheckPromise) return updateCheckPromise;

    updateCheckPromise = (async () => {
        try {
            const url = refresh ? '/api/updates?refresh=1' : '/api/updates';
            const response = await fetch(url);
            const data = await response.json();
            latestUpdateInfo = data || null;
            renderFooterUpdateStatus();

            if (manual && !silent) {
                if (!response.ok || (data && data.error)) {
                    const errMsg = (data && data.error) ? String(data.error) : (t('updateStatusCheckFailed') || 'Update check failed');
                    showToast(escapeHtml(errMsg), 'error');
                    return data;
                }
                if (data.updateAvailable && data.latestVersion) {
                    const message = `${escapeHtml(tParams('updateAvailableToast', {
                        latest: data.latestVersion,
                        current: data.currentVersion || 'unknown'
                    }))} <a href="${escapeHtml(data.releaseUrl || data.repoUrl || '#')}" target="_blank" rel="noopener noreferrer">${escapeHtml(t('updateAvailableOpenRelease'))}</a>`;
                    showToast(message, 'warning');
                } else {
                    const v = data.currentVersion != null ? String(data.currentVersion) : '—';
                    showToast(tParams('checkUpdatesUpToDate', { current: v }), 'success');
                }
                return data;
            }

            if (!response.ok || !data || !data.updateAvailable || !data.latestVersion) return data;

            if (getSeenUpdateVersion() === data.latestVersion) return data;

            if (!silent) {
                const message = `${escapeHtml(tParams('updateAvailableToast', {
                    latest: data.latestVersion,
                    current: data.currentVersion || 'unknown'
                }))} <a href="${escapeHtml(data.releaseUrl || data.repoUrl || '#')}" target="_blank" rel="noopener noreferrer">${escapeHtml(t('updateAvailableOpenRelease'))}</a>`;

                showToast(message, 'warning');
                markUpdateVersionAsSeen(data.latestVersion);
            }
            return data;
        } catch (error) {
            latestUpdateInfo = {
                error: error && error.message ? error.message : String(error)
            };
            renderFooterUpdateStatus();
            if (manual && !silent) {
                showToast(t('updateStatusCheckFailed') || 'Update check failed', 'error');
            }
            console.warn('Update check failed:', error);
            throw error;
        } finally {
            updateCheckPromise = null;
        }
    })();

    return updateCheckPromise;
}

async function manualCheckForAppUpdates() {
    const btn = document.getElementById('footerCheckUpdatesBtn');
    if (btn) btn.disabled = true;
    try {
        await checkForAppUpdates(true, { manual: true, refresh: true });
    } catch (_) {
        /* toasts handled in checkForAppUpdates */
    } finally {
        if (btn) btn.disabled = false;
    }
}

// Show notification
function showToast(message, type = 'info') {
    const toastContainer = document.getElementById('toastContainer');
    const toastId = 'toast-' + Date.now();
    
    const colors = {
        success: '#28a745',
        error: '#dc3545',
        warning: '#ffc107',
        info: '#17a2b8'
    };
    
    const icons = {
        success: 'bi-check-circle-fill',
        error: 'bi-exclamation-circle-fill',
        warning: 'bi-exclamation-triangle-fill',
        info: 'bi-info-circle-fill'
    };
    
    const typeNames = {
        success: t('toastSuccess'),
        error: t('toastError'),
        warning: t('toastWarning'),
        info: t('toastInfo')
    };
    
    const toast = document.createElement('div');
    toast.className = 'toast show align-items-center border-0';
    toast.id = toastId;
    toast.style.borderLeft = '4px solid ' + (colors[type] || colors.info);
    toast.innerHTML = `
        <div class="d-flex">
            <div class="toast-body">
                <i class="bi ${icons[type]} me-2"></i>
                <strong>${typeNames[type]}:</strong> ${message}
            </div>
            <button type="button" class="btn-close me-2 m-auto" onclick="this.closest('.toast').remove()"></button>
        </div>
    `;
    
    toastContainer.appendChild(toast);
    
    setTimeout(() => {
        const toast = document.getElementById(toastId);
        if (toast) toast.remove();
    }, 5000);
}

/** Текущий resolve для модала разблокировки (один активный вызов). */
let _settingsUnlockResolve = null;
/** Флаг: обработчики модала разблокировки уже привязаны. */
let _settingsUnlockModalBound = false;

function _settingsUnlockModalFinish(ok) {
    if (_settingsUnlockResolve) {
        _settingsUnlockResolve(ok);
        _settingsUnlockResolve = null;
    }
    const modalEl = document.getElementById('settingsUnlockModal');
    if (modalEl && typeof bootstrap !== 'undefined' && bootstrap.Modal) {
        const inst = bootstrap.Modal.getInstance(modalEl);
        if (inst) inst.hide();
    }
}

function _settingsUnlockModalSubmit() {
    const inputEl = document.getElementById('settingsUnlockPassword');
    const errorEl = document.getElementById('settingsUnlockError');
    if (!inputEl) return;
    const password = inputEl.value.trim();
    if (!password) {
        if (errorEl) {
            errorEl.textContent = t('enterSettingsPassword') || 'Введите пароль';
            errorEl.style.display = 'block';
        }
        inputEl.classList.add('is-invalid');
        return;
    }
    if (errorEl) {
        errorEl.textContent = '';
        errorEl.style.display = 'none';
    }
    inputEl.classList.remove('is-invalid');
    fetch('/api/settings/unlock', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ password: password })
    })
        .then(function (r) { return r.json(); })
        .then(function (data) {
if (data.success) {
                    settingsUnlocked = true;
                    persistSettingsSession();
                    showToast(t('settingsPasswordUnlocked') || 'Настройки разблокированы', 'success');
                    inputEl.value = '';
                    _settingsUnlockModalFinish(true);
                } else {
                if (errorEl) {
                    errorEl.textContent = data.error || t('settingsPasswordIncorrect') || 'Неверный пароль';
                    errorEl.style.display = 'block';
                }
                inputEl.classList.add('is-invalid');
            }
        })
        .catch(function (e) {
            if (errorEl) {
                errorEl.textContent = e.message || t('settingsPasswordIncorrect') || 'Неверный пароль';
                errorEl.style.display = 'block';
            }
            inputEl.classList.add('is-invalid');
        });
}

function _settingsUnlockModalCancel() {
    const inputEl = document.getElementById('settingsUnlockPassword');
    const errorEl = document.getElementById('settingsUnlockError');
    if (inputEl) inputEl.value = '';
    if (errorEl) {
        errorEl.textContent = '';
        errorEl.style.display = 'none';
    }
    if (inputEl) inputEl.classList.remove('is-invalid');
    _settingsUnlockModalFinish(false);
}

/** Показать HTML-модал ввода пароля для доступа к настройкам. Возвращает Promise<boolean>: true при успешной разблокировке, false при отмене. */
function showSettingsUnlockModal() {
    const modalEl = document.getElementById('settingsUnlockModal');
    const inputEl = document.getElementById('settingsUnlockPassword');
    const errorEl = document.getElementById('settingsUnlockError');
    if (!modalEl || !inputEl) return Promise.resolve(false);
    const promise = new Promise(function (resolve) {
        _settingsUnlockResolve = resolve;
    });
    if (!_settingsUnlockModalBound) {
        _settingsUnlockModalBound = true;
        modalEl.addEventListener('hidden.bs.modal', function () {
            if (_settingsUnlockResolve) {
                _settingsUnlockResolve(false);
                _settingsUnlockResolve = null;
            }
        });
        var submitBtn = document.getElementById('settingsUnlockSubmitBtn');
        var cancelBtn = document.getElementById('settingsUnlockCancelBtn');
        var closeBtn = document.getElementById('settingsUnlockModalCloseBtn');
        if (submitBtn) submitBtn.addEventListener('click', _settingsUnlockModalSubmit);
        if (cancelBtn) cancelBtn.addEventListener('click', _settingsUnlockModalCancel);
        if (closeBtn) closeBtn.addEventListener('click', _settingsUnlockModalCancel);
        inputEl.addEventListener('keydown', function (e) {
            if (e.key === 'Enter') {
                e.preventDefault();
                _settingsUnlockModalSubmit();
            }
        });
    }
    inputEl.value = '';
    if (errorEl) {
        errorEl.textContent = '';
        errorEl.style.display = 'none';
    }
    inputEl.classList.remove('is-invalid');
    if (typeof bootstrap !== 'undefined' && bootstrap.Modal) {
        var inst = bootstrap.Modal.getOrCreateInstance(modalEl);
        inst.show();
        setTimeout(function () { inputEl.focus(); }, 300);
    }
    return promise;
}

function persistSettingsSession() {
    try {
        sessionStorage.setItem(SETTINGS_UNLOCK_EXPIRY_KEY, String(Date.now() + settingsSessionTtlMinutes * 60 * 1000));
    } catch (_) {}
}

function clearSettingsSession() {
    try {
        sessionStorage.removeItem(SETTINGS_UNLOCK_EXPIRY_KEY);
    } catch (_) {}
    settingsUnlocked = false;
}

async function ensureSettingsUnlocked() {
    if (!isSettingsPasswordEnabled()) return true;
    if (settingsUnlocked) return true;
    return await showSettingsUnlockModal();
}

// Загрузка данных для таблиц настроек (сервисы + VM/CT)
async function loadSettingsPanelData() {
    delete htmlCache['settingsServicesBody'];
    delete htmlCache['settingsVmsBody'];
    delete htmlCache['settingsAboutContent'];
    try {
        const servRes = await fetch('/api/settings/services');
        if (servRes.ok) {
            const servData = await servRes.json();
            monitoredServices = Array.isArray(servData.services) ? servData.services : [];
        }
    } catch (e) {
        console.error('Failed to load services for settings:', e);
    }
    if (getAuthHeadersForType('proxmox')) {
        await loadClusterVmsForSettings({ silent: true });
        if (monitoredVmIds.length === 0 && getClusterVms().length > 0) {
            monitoredVmIds = getClusterVms().map(v => v.vmid).filter(id => !monitorHiddenVmIds.includes(Number(id)));
            saveSettingsToServer({ monitorVms: monitoredVmIds });
        }
    } else {
        renderSettingsMonitoredVms();
    }
    renderSettingsMonitoredServices();
    renderTelegramRulesTable();
    await loadUpsSettings();
    await ensureUpsDisplaySlotsLoaded();
    await loadNetdevSettings();
    await ensureNetdevDisplaySlotsLoaded();
    await loadHostMetricsSettings();
    await loadAboutContent();
    await loadSmartSensorsConfigsForTiles();
    renderClusterDashboardTilesSettings();
    renderServerList();
}

async function loadSmartSensorsConfigsForTiles() {
    try {
        const res = await fetch('/api/smart-sensors/settings');
        const data = await res.json();
        smartSensorsConfigsForTiles = (res.ok && data.success && Array.isArray(data.configs)) ? data.configs : [];
    } catch (_) {
        smartSensorsConfigsForTiles = [];
    }
}

function tilesSizeToGridWH(size) {
    const s = String(size || '1x1').trim();
    if (s === '4x1') return { w: 4, h: 1 };
    if (s === '3x1') return { w: 3, h: 1 };
    if (s === '2x1') return { w: 2, h: 1 };
    if (s === '2x2') return { w: 2, h: 2 };
    if (s === '3x2') return { w: 3, h: 2 };
    return { w: 1, h: 1 };
}

function tilesGridWHToSize(w, h) {
    const W = Number.isFinite(Number(w)) ? parseInt(w, 10) : 1;
    const H = Number.isFinite(Number(h)) ? parseInt(h, 10) : 1;
    if (W === 4 && H === 1) return '4x1';
    if (W === 3 && H === 1) return '3x1';
    if (W === 2 && H === 1) return '2x1';
    if (W === 3 && H === 2) return '3x2';
    if (W === 2 && H === 2) return '2x2';
    if (W === 1 && H === 1) return '1x1';
    return null;
}

function normalizeClusterDashboardTile(raw) {
    const tile = raw && typeof raw === 'object' ? raw : {};
    const type = String(tile.type || '').trim().toLowerCase();
    if (!CLUSTER_DASHBOARD_TILE_TYPES.includes(type)) return null;

    if (type === 'embed') {
        const hasExplicitCluster = Object.prototype.hasOwnProperty.call(tile, 'showOnCluster');
        const hasExplicitTiles = Object.prototype.hasOwnProperty.call(tile, 'showOnTiles');
        const isLegacyTile = !hasExplicitCluster && !hasExplicitTiles;
        let tilesSize = ['1x1', '2x1', '3x1', '4x1', '2x2', '3x2'].includes(String(tile.tilesSize || '').trim())
            ? String(tile.tilesSize).trim()
            : '1x1';
        const fromSize = tilesSizeToGridWH(tilesSize);
        let tilesGridW = parseInt(tile.tilesGridW, 10);
        let tilesGridH = parseInt(tile.tilesGridH, 10);
        if (!Number.isFinite(tilesGridW) || tilesGridW < 1) tilesGridW = fromSize.w;
        if (!Number.isFinite(tilesGridH) || tilesGridH < 1) tilesGridH = fromSize.h;
        tilesGridW = Math.min(Math.max(1, tilesGridW), TILES_MONITOR_GRID_COLS);
        tilesGridH = Math.min(Math.max(1, tilesGridH), TILES_MONITOR_GRID_ROWS);
        const derived = tilesGridWHToSize(tilesGridW, tilesGridH);
        if (derived) tilesSize = derived;
        let tilesGridCol = parseInt(tile.tilesGridCol, 10);
        let tilesGridRow = parseInt(tile.tilesGridRow, 10);
        if (!Number.isFinite(tilesGridCol) || tilesGridCol < 0) tilesGridCol = 0;
        if (!Number.isFinite(tilesGridRow) || tilesGridRow < 0) tilesGridRow = 0;
        if (tilesGridCol > TILES_MONITOR_GRID_COLS) tilesGridCol = 0;
        if (tilesGridRow > TILES_MONITOR_GRID_ROWS) tilesGridRow = 0;
        const kind = String(tile.embedKind || '').trim().toLowerCase() === 'image' ? 'image' : 'html';
        let payload = String(tile.embedPayload != null ? tile.embedPayload : '').trim();
        if (kind === 'image') {
            if (!payload) {
                payload = '';
            } else {
                const url = sanitizeEmbedImageUrl(payload);
                if (url) {
                    payload = url;
                } else if (payload.length > CLUSTER_EMBED_IMAGE_DATA_URL_MAX) {
                    return null;
                }
                // else keep raw value so the tile stays editable while the URL is invalid
            }
        } else {
            if (payload.length > CLUSTER_EMBED_HTML_MAX) payload = payload.slice(0, CLUSTER_EMBED_HTML_MAX);
        }
        return {
            type,
            sourceId: 'embed:custom',
            embedKind: kind,
            embedPayload: payload,
            showOnCluster: true,
            showOnTiles: tile.showOnTiles === true || isLegacyTile,
            tilesSize,
            tilesGridW,
            tilesGridH,
            tilesGridCol,
            tilesGridRow,
            chartWindowMin: null,
            chartDisplayVariant: null
        };
    }

    let sourceId = String(tile.sourceId || '').trim();
    if (type === 'speedtest') sourceId = 'speedtest:default';
    if (type === 'iperf3') sourceId = 'iperf3:default';
    if (type === 'ups') {
        const m = /^ups:(\d+)$/.exec(sourceId);
        if (!m) return null;
        const slot = parseInt(m[1], 10);
        if (!Number.isFinite(slot) || slot < 1 || slot > 4) return null;
        sourceId = `ups:${slot}`;
    }
    if (type === 'cluster_metric_chart') {
        const m = /^cluster_metric_chart:(cpu|mem)$/.exec(sourceId);
        if (!m) return null;
        sourceId = `cluster_metric_chart:${m[1]}`;
    }
    if (type === 'host_node_metric_chart') {
        const m = /^host_node_metric_chart:([^:]+):(temp|cpu|mem)$/.exec(sourceId);
        if (!m) return null;
        const node = String(m[1] || '').trim();
        if (!node) return null;
        sourceId = `host_node_metric_chart:${node}:${m[2]}`;
    }
    if (type === 'cluster_node') {
        const prefix = 'cluster_node:';
        if (!sourceId.startsWith(prefix)) return null;
        const node = String(sourceId.slice(prefix.length)).trim();
        if (!node) return null;
        sourceId = `${prefix}${node}`;
    }
    if (type === 'smart_sensor') {
        if (!sourceId.startsWith('smart_sensor:')) return null;
        const idPart = sourceId.slice('smart_sensor:'.length).trim();
        if (!idPart) return null;
        sourceId = `smart_sensor:${idPart}`;
    }
    if (type === 'smart_sensor_metric_chart') {
        const prefix = 'smart_sensor_metric_chart:';
        if (!sourceId.startsWith(prefix)) return null;
        const rest = sourceId.slice(prefix.length);
        const idx = rest.indexOf(':');
        if (idx < 0) return null;
        const sensorId = rest.slice(0, idx).trim();
        let fk = rest.slice(idx + 1);
        try {
            fk = decodeURIComponent(fk);
        } catch {
            return null;
        }
        fk = String(fk).trim();
        if (!sensorId || !fk) return null;
        sourceId = `smart_sensor_metric_chart:${sensorId}:${encodeURIComponent(fk)}`;
    }
    if (!sourceId) return null;
    const hasExplicitCluster = Object.prototype.hasOwnProperty.call(tile, 'showOnCluster');
    const hasExplicitTiles = Object.prototype.hasOwnProperty.call(tile, 'showOnTiles');
    const isLegacyTile = !hasExplicitCluster && !hasExplicitTiles;
    let tilesSize = ['1x1', '2x1', '3x1', '4x1', '2x2', '3x2'].includes(String(tile.tilesSize || '').trim())
        ? String(tile.tilesSize).trim()
        : '1x1';
    const fromSize = tilesSizeToGridWH(tilesSize);
    let tilesGridW = parseInt(tile.tilesGridW, 10);
    let tilesGridH = parseInt(tile.tilesGridH, 10);
    if (!Number.isFinite(tilesGridW) || tilesGridW < 1) tilesGridW = fromSize.w;
    if (!Number.isFinite(tilesGridH) || tilesGridH < 1) tilesGridH = fromSize.h;
    tilesGridW = Math.min(Math.max(1, tilesGridW), TILES_MONITOR_GRID_COLS);
    tilesGridH = Math.min(Math.max(1, tilesGridH), TILES_MONITOR_GRID_ROWS);
    const derived = tilesGridWHToSize(tilesGridW, tilesGridH);
    if (derived) tilesSize = derived;

    let tilesGridCol = parseInt(tile.tilesGridCol, 10);
    let tilesGridRow = parseInt(tile.tilesGridRow, 10);
    if (!Number.isFinite(tilesGridCol) || tilesGridCol < 0) tilesGridCol = 0;
    if (!Number.isFinite(tilesGridRow) || tilesGridRow < 0) tilesGridRow = 0;
    if (tilesGridCol > TILES_MONITOR_GRID_COLS) tilesGridCol = 0;
    if (tilesGridRow > TILES_MONITOR_GRID_ROWS) tilesGridRow = 0;

    const chartWindowMin = isMetricChartTileType(type)
        ? normalizeChartWindowMinutes(tile.chartWindowMin, 1440)
        : null;
    const chartDisplayVariant = isMetricChartTileType(type)
        ? normalizeTileChartVariant(tile.chartDisplayVariant, 'area')
        : null;

    return {
        type,
        sourceId,
        // Legacy visibility flag; Homelab dashboard no longer exposes this toggle — always on for compatibility.
        showOnCluster: true,
        // Backward compatibility: old tiles (without flags) appear on Tiles screen too.
        showOnTiles: tile.showOnTiles === true || isLegacyTile,
        tilesSize,
        tilesGridW,
        tilesGridH,
        tilesGridCol,
        tilesGridRow,
        chartWindowMin,
        chartDisplayVariant
    };
}

/**
 * Расстановка плиток на сетке: явные col/row (1-based, 0 = авто) или поиск первого свободного места.
 */
function computeTilesMonitorPlacements(tiles) {
    const COLS = TILES_MONITOR_GRID_COLS;
    const ROWS = TILES_MONITOR_GRID_ROWS;
    const occupied = Array.from({ length: ROWS }, () => Array(COLS).fill(false));

    function canPlace(r0, c0, w, h) {
        if (c0 + w > COLS || r0 + h > ROWS) return false;
        for (let rr = r0; rr < r0 + h; rr++) {
            for (let cc = c0; cc < c0 + w; cc++) {
                if (occupied[rr][cc]) return false;
            }
        }
        return true;
    }

    function occupy(r0, c0, w, h) {
        for (let rr = r0; rr < r0 + h; rr++) {
            for (let cc = c0; cc < c0 + w; cc++) {
                occupied[rr][cc] = true;
            }
        }
    }

    return tiles.map((tile) => {
        const w = tile.tilesGridW || 1;
        const h = tile.tilesGridH || 1;
        const wantCol = tile.tilesGridCol | 0;
        const wantRow = tile.tilesGridRow | 0;

        if (wantCol > 0 && wantRow > 0) {
            const c0 = wantCol - 1;
            const r0 = wantRow - 1;
            if (canPlace(r0, c0, w, h)) {
                occupy(r0, c0, w, h);
                return { tile, gridCol: wantCol, gridRow: wantRow };
            }
        }

        for (let r0 = 0; r0 < ROWS; r0++) {
            for (let c0 = 0; c0 < COLS; c0++) {
                if (canPlace(r0, c0, w, h)) {
                    occupy(r0, c0, w, h);
                    return { tile, gridCol: c0 + 1, gridRow: r0 + 1 };
                }
            }
        }
        return { tile, gridCol: 1, gridRow: 1 };
    });
}

let tilesEditorSelectedIndex = -1;
let tilesEditorPointerState = null;

function getTilesEditorWorkingSet() {
    const normalized = normalizeClusterDashboardTiles(clusterDashboardTiles);
    let selected = normalized.map((tile, index) => ({ ...tile, __idx: index })).filter((tile) => tile.showOnTiles === true);
    if (!selected.length) {
        selected = normalized.map((tile, index) => ({ ...tile, __idx: index })).filter((tile) => tile.showOnCluster !== false);
    }
    return selected;
}

function getTilesEditorResolvedPlacement(tileIndex) {
    const set = getTilesEditorWorkingSet();
    const placements = computeTilesMonitorPlacements(set);
    return placements.find((p) => p.tile && p.tile.__idx === tileIndex) || null;
}

function renderTilesVisualEditor() {
    const host = document.getElementById('settingsClusterTilesVisualEditor');
    if (!host) return;
    const set = getTilesEditorWorkingSet();
    if (!set.length) {
        host.innerHTML = `<div class="text-muted small">${escapeHtml(t('settingsClusterTilesEmpty') || 'No tiles configured yet.')}</div>`;
        return;
    }
    const placements = computeTilesMonitorPlacements(set);
    const html = placements.map(({ tile, gridCol, gridRow }) => {
        const idx = tile.__idx;
        const title = getClusterDashboardTileTypeLabel(tile.type);
        const src = getClusterDashboardTileSourceSummary(tile);
        const w = Math.max(1, Math.min(TILES_MONITOR_GRID_COLS, tile.tilesGridW || 1));
        const h = Math.max(1, Math.min(TILES_MONITOR_GRID_ROWS, tile.tilesGridH || 1));
        const selectedCls = idx === tilesEditorSelectedIndex ? ' is-selected' : '';
        return `
            <button type="button"
                class="tiles-layout-editor__item${selectedCls}"
                data-tile-index="${idx}"
                style="grid-column:${gridCol} / span ${w}; grid-row:${gridRow} / span ${h};"
                onpointerdown="onTilesEditorItemPointerDown(${idx}, event)">
                <span class="tiles-layout-editor__item-title">${escapeHtml(title)}</span>
                <span class="tiles-layout-editor__item-src">${escapeHtml(src)}</span>
                <span class="tiles-layout-editor__resize" onpointerdown="onTilesEditorResizePointerDown(${idx}, event)"></span>
            </button>
        `;
    }).join('');
    host.innerHTML = `
        <div class="tiles-layout-editor__hint small text-muted mb-2">${escapeHtml(t('settingsClusterTileTilesGridAutoHint') || 'Use 0 for automatic placement.')}</div>
        <div class="tiles-layout-editor__grid" id="tilesLayoutEditorGrid"
            style="--tiles-grid-cols:${TILES_MONITOR_GRID_COLS}; --tiles-grid-rows:${TILES_MONITOR_GRID_ROWS};">
            ${html}
        </div>
    `;
}

const TILES_EDITOR_DRAG_THRESHOLD_PX = 7;

function beginTilesEditorPointer(tileIndex, event, mode) {
    if (!event) return;
    event.preventDefault();
    event.stopPropagation();
    const item = document.querySelector(`.tiles-layout-editor__item[data-tile-index="${tileIndex}"]`);
    const grid = document.getElementById('tilesLayoutEditorGrid');
    const placement = getTilesEditorResolvedPlacement(tileIndex);
    if (!(item instanceof HTMLElement) || !(grid instanceof HTMLElement) || !placement) return;
    const rect = grid.getBoundingClientRect();
    const cellW = rect.width / TILES_MONITOR_GRID_COLS;
    const cellH = rect.height / TILES_MONITOR_GRID_ROWS;
    if (!cellW || !cellH) return;
    const w = Math.max(1, Math.min(TILES_MONITOR_GRID_COLS, placement.tile.tilesGridW || 1));
    const h = Math.max(1, Math.min(TILES_MONITOR_GRID_ROWS, placement.tile.tilesGridH || 1));
    const pointerCol = Math.floor((event.clientX - rect.left) / cellW) + 1;
    const pointerRow = Math.floor((event.clientY - rect.top) / cellH) + 1;
    tilesEditorPointerState = {
        mode,
        tileIndex,
        pointerId: event.pointerId,
        startCol: placement.gridCol,
        startRow: placement.gridRow,
        startW: w,
        startH: h,
        offsetCol: Math.max(0, Math.min(w - 1, pointerCol - placement.gridCol)),
        offsetRow: Math.max(0, Math.min(h - 1, pointerRow - placement.gridRow)),
        rect,
        cellW,
        cellH
    };
    try { item.setPointerCapture(event.pointerId); } catch (_) {}
}

function onTilesEditorItemPointerDown(tileIndex, event) {
    if (event.target && (event.target).closest && (event.target).closest('.tiles-layout-editor__resize')) return;
    if (!event) return;
    event.preventDefault();
    const grid = document.getElementById('tilesLayoutEditorGrid');
    const placement = getTilesEditorResolvedPlacement(tileIndex);
    if (!(grid instanceof HTMLElement) || !placement) return;
    const rect = grid.getBoundingClientRect();
    const cellW = rect.width / TILES_MONITOR_GRID_COLS;
    const cellH = rect.height / TILES_MONITOR_GRID_ROWS;
    if (!cellW || !cellH) return;
    tilesEditorPointerState = {
        mode: 'pending',
        tileIndex,
        pointerId: event.pointerId,
        startX: event.clientX,
        startY: event.clientY,
        rect,
        cellW,
        cellH,
        placement
    };
}

function onTilesEditorResizePointerDown(tileIndex, event) {
    if (!event) return;
    event.preventDefault();
    event.stopPropagation();
    beginTilesEditorPointer(tileIndex, event, 'resize');
}

function promotePendingTilesEditorToMoveDrag(event) {
    const s = tilesEditorPointerState;
    if (!s || s.mode !== 'pending' || !s.placement) return;
    const tileIndex = s.tileIndex;
    const item = document.querySelector(`.tiles-layout-editor__item[data-tile-index="${tileIndex}"]`);
    const placement = s.placement;
    if (!(item instanceof HTMLElement)) return;
    const w = Math.max(1, Math.min(TILES_MONITOR_GRID_COLS, placement.tile.tilesGridW || 1));
    const h = Math.max(1, Math.min(TILES_MONITOR_GRID_ROWS, placement.tile.tilesGridH || 1));
    const pointerCol = Math.floor((event.clientX - s.rect.left) / s.cellW) + 1;
    const pointerRow = Math.floor((event.clientY - s.rect.top) / s.cellH) + 1;
    tilesEditorPointerState = {
        mode: 'move',
        tileIndex,
        pointerId: s.pointerId,
        startCol: placement.gridCol,
        startRow: placement.gridRow,
        startW: w,
        startH: h,
        offsetCol: Math.max(0, Math.min(w - 1, pointerCol - placement.gridCol)),
        offsetRow: Math.max(0, Math.min(h - 1, pointerRow - placement.gridRow)),
        rect: s.rect,
        cellW: s.cellW,
        cellH: s.cellH
    };
    try { item.setPointerCapture(event.pointerId); } catch (_) {}
}

function handleTilesEditorPointerMove(event) {
    const s = tilesEditorPointerState;
    if (!s || event.pointerId !== s.pointerId) return;
    if (s.mode === 'pending') {
        const dist = Math.hypot(event.clientX - s.startX, event.clientY - s.startY);
        if (dist > TILES_EDITOR_DRAG_THRESHOLD_PX) promotePendingTilesEditorToMoveDrag(event);
        return;
    }
    const item = document.querySelector(`.tiles-layout-editor__item[data-tile-index="${s.tileIndex}"]`);
    if (!(item instanceof HTMLElement)) return;
    const rawCol = Math.floor((event.clientX - s.rect.left) / s.cellW) + 1;
    const rawRow = Math.floor((event.clientY - s.rect.top) / s.cellH) + 1;
    if (s.mode === 'resize') {
        const maxW = TILES_MONITOR_GRID_COLS - s.startCol + 1;
        const maxH = TILES_MONITOR_GRID_ROWS - s.startRow + 1;
        const nextW = Math.max(1, Math.min(maxW, rawCol - s.startCol + 1));
        const nextH = Math.max(1, Math.min(maxH, rawRow - s.startRow + 1));
        item.style.gridColumn = `${s.startCol} / span ${nextW}`;
        item.style.gridRow = `${s.startRow} / span ${nextH}`;
    } else {
        const nextCol = Math.max(1, Math.min(TILES_MONITOR_GRID_COLS - s.startW + 1, rawCol - s.offsetCol));
        const nextRow = Math.max(1, Math.min(TILES_MONITOR_GRID_ROWS - s.startH + 1, rawRow - s.offsetRow));
        item.style.gridColumn = `${nextCol} / span ${s.startW}`;
        item.style.gridRow = `${nextRow} / span ${s.startH}`;
    }
}

function handleTilesEditorPointerUp(event) {
    const s = tilesEditorPointerState;
    if (!s || event.pointerId !== s.pointerId) return;
    if (s.mode === 'pending') {
        tilesEditorSelectedIndex = s.tileIndex;
        tilesEditorPointerState = null;
        renderClusterDashboardTilesSettings();
        return;
    }
    const item = document.querySelector(`.tiles-layout-editor__item[data-tile-index="${s.tileIndex}"]`);
    if (!(item instanceof HTMLElement)) {
        tilesEditorPointerState = null;
        return;
    }
    const colMatch = /(\d+)\s*\/\s*span\s*(\d+)/.exec(item.style.gridColumn || '');
    const rowMatch = /(\d+)\s*\/\s*span\s*(\d+)/.exec(item.style.gridRow || '');
    const nextCol = colMatch ? parseInt(colMatch[1], 10) : s.startCol;
    const nextW = colMatch ? parseInt(colMatch[2], 10) : s.startW;
    const nextRow = rowMatch ? parseInt(rowMatch[1], 10) : s.startRow;
    const nextH = rowMatch ? parseInt(rowMatch[2], 10) : s.startH;
    if (s.mode === 'resize') {
        updateClusterDashboardTileFlags(s.tileIndex, { tilesGridW: nextW, tilesGridH: nextH, tilesGridCol: nextCol, tilesGridRow: nextRow });
    } else if (s.mode === 'move') {
        updateClusterDashboardTileFlags(s.tileIndex, { tilesGridCol: nextCol, tilesGridRow: nextRow });
    }
    tilesEditorPointerState = null;
}

window.addEventListener('pointermove', handleTilesEditorPointerMove);
window.addEventListener('pointerup', handleTilesEditorPointerUp);
window.addEventListener('pointercancel', handleTilesEditorPointerUp);

function normalizeClusterDashboardTiles(raw) {
    if (!Array.isArray(raw)) return [];
    return raw
        .map(normalizeClusterDashboardTile)
        .filter(Boolean)
        .slice(0, MAX_CLUSTER_DASHBOARD_TILES);
}

function getClusterDashboardTileTypeLabel(type) {
    if (type === 'service') return t('settingsClusterTileTypeService');
    if (type === 'vmct') return t('settingsClusterTileTypeVmct');
    if (type === 'netdev') return t('settingsClusterTileTypeNetdev');
    if (type === 'ups') return t('settingsClusterTileTypeUps');
    if (type === 'ups_metric_chart') return t('settingsClusterTileTypeUpsMetricChart') || 'UPS graph';
    if (type === 'cluster_metric_chart') return t('settingsClusterTileTypeClusterMetricChart') || 'Cluster graph';
    if (type === 'host_node_metric_chart') return t('settingsClusterTileTypeHostNodeMetricChart') || 'Node graph';
    if (type === 'cluster_node') return t('settingsClusterTileTypeClusterNode') || 'Cluster node';
    if (type === 'speedtest') return t('settingsClusterTileTypeSpeedtest');
    if (type === 'iperf3') return t('settingsClusterTileTypeIperf3');
    if (type === 'smart_sensor') return t('settingsClusterTileTypeSmartSensor');
    if (type === 'smart_sensor_metric_chart') return t('settingsClusterTileTypeSmartSensorMetricChart') || 'Smart home graph';
    if (type === 'embed') return t('settingsClusterTileTypeEmbed');
    if (type === 'truenas_server') return 'TrueNAS Server';
    if (type === 'truenas_pool') return 'TrueNAS Pool';
    if (type === 'truenas_disk') return 'TrueNAS Disk';
    if (type === 'truenas_service') return 'TrueNAS Service';
    if (type === 'truenas_app') return 'TrueNAS App';
    return type || '—';
}

function getClusterDashboardTileSourceSummary(tile) {
    if (!tile || tile.type !== 'embed') {
        return String(tile && tile.sourceId ? tile.sourceId : '').replace(/^.+:/, '') || '—';
    }
    return tile.embedKind === 'image'
        ? (t('settingsClusterTileEmbedKindImageShort') || 'IMG')
        : (t('settingsClusterTileEmbedKindHtmlShort') || 'HTML');
}

function getAvailableClusterDashboardTileTypes() {
    // HomeLab mode may still use TrueNAS tiles as data sources.
    return CLUSTER_DASHBOARD_TILE_TYPES;
}

function getClusterDashboardTileSourceOptions(type) {
    if (type === 'ups') {
        return (Array.isArray(upsConfigs) ? upsConfigs : [])
            .map((cfg, idx) => ({ cfg, slot: idx + 1 }))
            .filter(({ cfg }) => cfg && cfg.enabled && String(cfg.host || '').trim() !== '')
            .map(({ cfg, slot }) => ({
                value: `ups:${slot}`,
                label: `UPS ${slot}: ${cfg.name || cfg.host || ('#' + slot)}`
            }));
    }

    // UPS metric chart tiles (history graphs) select numeric metric fields.
    if (type === 'ups_metric_chart') {
        const numericFormats = new Set(['percent', 'number', 'voltage', 'watt', 'frequency', 'time']);
        return (Array.isArray(upsConfigs) ? upsConfigs : [])
            .map((cfg, idx) => ({ cfg, slot: idx + 1 }))
            .filter(({ cfg }) => cfg && cfg.enabled && String(cfg.host || '').trim() !== '' && Array.isArray(cfg.fields))
            .flatMap(({ cfg, slot }) => {
                return (cfg.fields || [])
                    .filter((f) => f && f.enabled !== false && String(f.id || '').trim() !== '' && numericFormats.has(String(f.format || '').trim()))
                    .map((f) => {
                        const metricId = String(f.id).trim();
                        const metricLabel = (f.label != null && String(f.label).trim() !== '') ? String(f.label).trim() : metricId;
                        return {
                            value: `ups_metric_chart:${slot}:${metricId}`,
                            label: `UPS ${slot}: ${metricLabel}`
                        };
                    });
            });
    }

    if (type === 'cluster_metric_chart') {
        const cpuLabel = t('clusterAggregateCpuChartTitle') || 'Cluster CPU';
        const memLabel = t('clusterAggregateMemChartTitle') || 'Cluster RAM';
        return [
            { value: 'cluster_metric_chart:cpu', label: cpuLabel },
            { value: 'cluster_metric_chart:mem', label: memLabel }
        ];
    }

    if (type === 'host_node_metric_chart') {
        const nodes = getClusterNodeNamesForTelegramRules();
        const uniqueNodes = Array.from(new Set((Array.isArray(nodes) ? nodes : []).map((n) => String(n || '').trim()).filter(Boolean)));
        const metricDefs = [
            { id: 'temp', label: t('hostMetricsCpuTempLabel') || 'CPU temp' },
            { id: 'cpu', label: t('nodeCpu') || 'CPU' },
            { id: 'mem', label: t('nodeRam') || 'RAM' }
        ];
        const list = uniqueNodes.length ? uniqueNodes : ['pve'];
        return list.flatMap((node) => {
            return metricDefs.map((m) => ({
                value: `host_node_metric_chart:${node}:${m.id}`,
                label: `${node}: ${m.label}`
            }));
        });
    }

    if (type === 'cluster_node') {
        const raw = lastClusterData && Array.isArray(lastClusterData.nodes)
            ? lastClusterData.nodes.map((n) => String(n.name || '').trim()).filter(Boolean)
            : [];
        const list = raw.length ? raw : (getClusterNodeNamesForTelegramRules().length ? getClusterNodeNamesForTelegramRules() : ['pve']);
        const unique = Array.from(new Set(list.map((n) => String(n || '').trim()).filter(Boolean)));
        return unique.map((node) => ({
            value: `cluster_node:${node}`,
            label: node
        }));
    }

    if (type === 'netdev') {
        return (Array.isArray(netdevConfigs) ? netdevConfigs : [])
            .map((cfg, idx) => ({ cfg, slot: idx + 1 }))
            .filter(({ cfg }) => cfg && cfg.enabled && String(cfg.host || '').trim() !== '')
            .map(({ cfg, slot }) => ({
                value: `netdev:${slot}`,
                label: `SNMP ${slot}: ${cfg.name || cfg.host || ('#' + slot)}`
            }));
    }

    if (type === 'service') {
        const out = [];
        if (getAuthHeadersForType('proxmox')) {
            out.push(...(Array.isArray(monitoredServices) ? monitoredServices : []).map((svc) => ({
                value: `service:${svc.id}`,
                label: `${svc.name || getServiceTargetDisplay(svc)}`
            })));
        }
        if (getAuthHeadersForType('truenas')) {
            out.push(...(Array.isArray(lastTrueNASOverviewData?.services) ? lastTrueNASOverviewData.services : []).map((svc, idx) => {
                const sid = String(svc?.entityId || svc?.id || svc?.name || (idx + 1));
                return {
                    value: `service:${sid}`,
                    label: `[TrueNAS] ${svc?.name || ('Service ' + (idx + 1))}`
                };
            }));
        }
        return out;
    }

    if (type === 'vmct') {
        const out = [];
        if (getAuthHeadersForType('proxmox')) {
            const clusterVms = getClusterVms();
            if (clusterVms.length) {
                out.push(...clusterVms.map((vm) => {
                    const id = Number(vm.vmid != null ? vm.vmid : vm.id);
                    const node = vm.node ? ` (${vm.node})` : '';
                    return {
                        value: `vmct:${id}`,
                        label: `${vm.name || ('VM/CT ' + id)} [${id}]${node}`
                    };
                }));
            } else {
                out.push(...monitoredVmIds.map((id) => ({
                    value: `vmct:${id}`,
                    label: `VM/CT ${id}`
                })));
            }
        }
        if (getAuthHeadersForType('truenas')) {
            out.push(...(Array.isArray(lastTrueNASOverviewData?.apps) ? lastTrueNASOverviewData.apps : []).map((app, idx) => {
                const aid = String(app?.entityId || app?.id || app?.name || (idx + 1));
                return {
                    value: `vmct:${aid}`,
                    label: `[TrueNAS] ${app?.name || ('App ' + (idx + 1))}`
                };
            }));
        }
        return out;
    }

    if (type === 'speedtest') {
        return [{
            value: 'speedtest:default',
            label: t('dashboardSpeedtestTitle') || 'Speedtest'
        }];
    }

    if (type === 'iperf3') {
        return [{
            value: 'iperf3:default',
            label: t('dashboardIperf3Title') || 'iperf3'
        }];
    }

    if (type === 'smart_sensor') {
        const list = Array.isArray(smartSensorsConfigsForTiles) ? smartSensorsConfigsForTiles : [];
        return list
            .filter((c) => c && c.id != null && String(c.id).trim() !== '' && c.enabled !== false)
            .map((c) => {
                const id = String(c.id).trim();
                const kind = c.type === 'ble' ? 'BLE' : 'REST';
                return {
                    value: `smart_sensor:${id}`,
                    label: `${c.name || id} (${kind})`
                };
            });
    }

    if (type === 'smart_sensor_metric_chart') {
        const list = Array.isArray(smartSensorsConfigsForTiles) ? smartSensorsConfigsForTiles : [];
        const out = [];
        for (const c of list) {
            if (!c || c.enabled === false) continue;
            const sid = String(c.id || '').trim();
            if (!sid) continue;
            const keys = computeSmartSensorFieldKeysForConfig(c);
            for (const { fieldKey, label } of keys) {
                out.push({
                    value: `smart_sensor_metric_chart:${sid}:${encodeURIComponent(fieldKey)}`,
                    label: `${c.name || sid}: ${label}`
                });
            }
        }
        return out;
    }

    if (type === 'truenas_pool') {
        return (Array.isArray(lastTrueNASOverviewData?.pools) ? lastTrueNASOverviewData.pools : []).map((pool, idx) => {
            const pid = String(pool?.id || pool?.name || (idx + 1));
            return {
                value: `truenas_pool:${pid}`,
                label: `${pool?.name || ('Pool ' + (idx + 1))}`
            };
        });
    }

    if (type === 'truenas_disk') {
        return (Array.isArray(lastTrueNASOverviewData?.disks) ? lastTrueNASOverviewData.disks : []).map((disk, idx) => {
            const did = String(disk?.entityId || disk?.id || disk?.name || (idx + 1));
            return {
                value: `truenas_disk:${did}`,
                label: `${disk?.name || ('Disk ' + (idx + 1))}`
            };
        });
    }

    if (type === 'truenas_service') {
        return (Array.isArray(lastTrueNASOverviewData?.services) ? lastTrueNASOverviewData.services : []).map((svc, idx) => {
            const sid = String(svc?.entityId || svc?.id || svc?.name || (idx + 1));
            return {
                value: `truenas_service:${sid}`,
                label: `${svc?.name || ('Service ' + (idx + 1))}`
            };
        });
    }

    if (type === 'truenas_server') return [{ value: 'truenas_server:current', label: 'Current TrueNAS server' }];

    if (type === 'embed') {
        return [{
            value: 'embed:custom',
            label: t('settingsClusterTileEmbedSourceLabel') || 'Custom embed'
        }];
    }

    if (type === 'truenas_app') {
        return (Array.isArray(lastTrueNASOverviewData?.apps) ? lastTrueNASOverviewData.apps : []).map((app, idx) => {
            const aid = String(app?.entityId || app?.id || app?.name || (idx + 1));
            return {
                value: `truenas_app:${aid}`,
                label: `${app?.name || ('App ' + (idx + 1))}`
            };
        });
    }

    return [];
}

function clusterDashboardTileTypeUsesSplitSource(type) {
    return type === 'host_node_metric_chart' || type === 'ups_metric_chart' || type === 'smart_sensor_metric_chart';
}

function parseClusterDashboardCompositeSource(type, sourceId) {
    const s = String(sourceId || '').trim();
    if (type === 'host_node_metric_chart') {
        const m = /^host_node_metric_chart:([^:]+):(temp|cpu|mem)$/.exec(s);
        return m ? { device: m[1], metric: m[2] } : { device: '', metric: '' };
    }
    if (type === 'ups_metric_chart') {
        const m = /^ups_metric_chart:(\d+):(.+)$/.exec(s);
        return m ? { device: m[1], metric: m[2] } : { device: '', metric: '' };
    }
    if (type === 'smart_sensor_metric_chart') {
        const prefix = 'smart_sensor_metric_chart:';
        if (!s.startsWith(prefix)) return { device: '', metric: '' };
        const rest = s.slice(prefix.length);
        const idx = rest.indexOf(':');
        if (idx < 0) return { device: '', metric: '' };
        const sensorId = rest.slice(0, idx).trim();
        const enc = rest.slice(idx + 1);
        return { device: sensorId, metric: enc };
    }
    return { device: '', metric: '' };
}

function buildClusterDashboardCompositeSourceId(type, device, metric) {
    const d = String(device || '').trim();
    const met = String(metric || '').trim();
    if (type === 'host_node_metric_chart') {
        if (!d || !/^(temp|cpu|mem)$/.test(met)) return '';
        return `host_node_metric_chart:${d}:${met}`;
    }
    if (type === 'ups_metric_chart') {
        if (!/^\d+$/.test(d) || !met) return '';
        return `ups_metric_chart:${d}:${met}`;
    }
    if (type === 'smart_sensor_metric_chart') {
        if (!d || !met) return '';
        return `smart_sensor_metric_chart:${d}:${met}`;
    }
    return '';
}

function getClusterDashboardTileSplitDevices(type) {
    if (type === 'host_node_metric_chart') {
        const nodes = getClusterNodeNamesForTelegramRules();
        const uniqueNodes = Array.from(new Set((Array.isArray(nodes) ? nodes : []).map((n) => String(n || '').trim()).filter(Boolean)));
        const list = uniqueNodes.length ? uniqueNodes : ['pve'];
        return list.map((node) => ({ value: node, label: node }));
    }
    if (type === 'ups_metric_chart') {
        const numericFormats = new Set(['percent', 'number', 'voltage', 'watt', 'frequency', 'time']);
        return (Array.isArray(upsConfigs) ? upsConfigs : [])
            .map((cfg, idx) => ({ cfg, slot: idx + 1 }))
            .filter(({ cfg }) => cfg && cfg.enabled && String(cfg.host || '').trim() !== '' && Array.isArray(cfg.fields))
            .filter(({ cfg }) => (cfg.fields || []).some(
                (f) => f && f.enabled !== false && String(f.id || '').trim() !== '' && numericFormats.has(String(f.format || '').trim())
            ))
            .map(({ cfg, slot }) => ({
                value: String(slot),
                label: `UPS ${slot}: ${cfg.name || cfg.host || ('#' + slot)}`
            }));
    }
    if (type === 'smart_sensor_metric_chart') {
        const list = Array.isArray(smartSensorsConfigsForTiles) ? smartSensorsConfigsForTiles : [];
        const out = [];
        for (const c of list) {
            if (!c || c.enabled === false) continue;
            const sid = String(c.id || '').trim();
            if (!sid) continue;
            if (!computeSmartSensorFieldKeysForConfig(c).length) continue;
            const kind = c.type === 'ble' ? 'BLE' : 'REST';
            out.push({ value: sid, label: `${c.name || sid} (${kind})` });
        }
        return out;
    }
    return [];
}

function getClusterDashboardTileSplitMetrics(type, deviceValue) {
    const dev = String(deviceValue || '').trim();
    if (type === 'host_node_metric_chart') {
        return [
            { value: 'temp', label: t('hostMetricsCpuTempLabel') || 'CPU temp' },
            { value: 'cpu', label: t('nodeCpu') || 'CPU' },
            { value: 'mem', label: t('nodeRam') || 'RAM' }
        ];
    }
    if (type === 'ups_metric_chart') {
        if (!dev || !/^\d+$/.test(dev)) return [];
        const slot = parseInt(dev, 10);
        const cfg = Array.isArray(upsConfigs) ? upsConfigs[slot - 1] : null;
        if (!cfg || !Array.isArray(cfg.fields)) return [];
        const numericFormats = new Set(['percent', 'number', 'voltage', 'watt', 'frequency', 'time']);
        return (cfg.fields || [])
            .filter((f) => f && f.enabled !== false && String(f.id || '').trim() !== '' && numericFormats.has(String(f.format || '').trim()))
            .map((f) => {
                const metricId = String(f.id).trim();
                const metricLabel = (f.label != null && String(f.label).trim() !== '') ? String(f.label).trim() : metricId;
                return { value: metricId, label: metricLabel };
            });
    }
    if (type === 'smart_sensor_metric_chart') {
        if (!dev) return [];
        const list = Array.isArray(smartSensorsConfigsForTiles) ? smartSensorsConfigsForTiles : [];
        const c = list.find((x) => x && String(x.id || '').trim() === dev);
        if (!c) return [];
        const keys = computeSmartSensorFieldKeysForConfig(c);
        return keys.map(({ fieldKey, label }) => ({
            value: encodeURIComponent(fieldKey),
            label
        }));
    }
    return [];
}

function updateClusterDashboardTileSplitDevice(index, deviceValue) {
    if (!clusterDashboardTiles[index]) return;
    const tile = clusterDashboardTiles[index];
    const type = tile.type;
    if (!clusterDashboardTileTypeUsesSplitSource(type)) return;
    const dev = String(deviceValue || '').trim();
    const metrics = getClusterDashboardTileSplitMetrics(type, dev);
    const parsed = parseClusterDashboardCompositeSource(type, tile.sourceId);
    let metric = parsed.metric;
    if (!metrics.some((m) => m.value === metric)) {
        metric = metrics.length ? metrics[0].value : '';
    }
    const sourceId = buildClusterDashboardCompositeSourceId(type, dev, metric);
    if (sourceId) updateClusterDashboardTileSource(index, sourceId);
}

function updateClusterDashboardTileSplitMetric(index, metricValue) {
    if (!clusterDashboardTiles[index]) return;
    const tile = clusterDashboardTiles[index];
    const type = tile.type;
    if (!clusterDashboardTileTypeUsesSplitSource(type)) return;
    const parsed = parseClusterDashboardCompositeSource(type, tile.sourceId);
    const devices = getClusterDashboardTileSplitDevices(type);
    let dev = String(parsed.device || '').trim();
    if (!dev || !devices.some((d) => d.value === dev)) {
        dev = devices.length ? devices[0].value : '';
    }
    const met = String(metricValue || '').trim();
    const sourceId = buildClusterDashboardCompositeSourceId(type, dev, met);
    if (sourceId) updateClusterDashboardTileSource(index, sourceId);
}

function markClusterDashboardTilesDirty(nextDirty) {
    clusterDashboardTilesDirty = !!nextDirty;
    const saveBtn = document.getElementById('settingsClusterTilesSaveBtn');
    if (saveBtn) saveBtn.disabled = !clusterDashboardTilesDirty;
}

function scheduleClusterDashboardTilesAutosave() {
    if (clusterDashboardTilesAutosaveTimer) {
        clearTimeout(clusterDashboardTilesAutosaveTimer);
        clusterDashboardTilesAutosaveTimer = null;
    }
    clusterDashboardTilesAutosaveTimer = setTimeout(async () => {
        clusterDashboardTilesAutosaveTimer = null;
        if (!clusterDashboardTilesDirty) return;
        const snapshot = normalizeClusterDashboardTiles(clusterDashboardTiles);
        const ok = await saveSettingsToServer({ clusterDashboardTiles: snapshot });
        if (!ok) {
            showToast((t('settingsClusterTilesSaveError') || 'Could not save tiles: {msg}').replace('{msg}', saveSettingsLastError || '—'), 'error');
            markClusterDashboardTilesDirty(true);
            return;
        }
        clusterDashboardTiles = snapshot;
        clusterDashboardTilesSettingPresent = true;
        markClusterDashboardTilesDirty(false);
        renderSavedTileViewsSettingsList();
    }, 800);
}

function clampTilesEditorSelectedIndex() {
    if (!Array.isArray(clusterDashboardTiles)) clusterDashboardTiles = [];
    if (!clusterDashboardTiles.length) {
        tilesEditorSelectedIndex = -1;
        return;
    }
    if (tilesEditorSelectedIndex < 0 || tilesEditorSelectedIndex >= clusterDashboardTiles.length) {
        tilesEditorSelectedIndex = -1;
    }
}

function buildClusterDashboardTilesSelectorHtml() {
    const selectHint = t('settingsClusterTilesSelectHint');
    if (!Array.isArray(clusterDashboardTiles) || !clusterDashboardTiles.length) {
        return `<div class="text-muted small py-2">${escapeHtml(selectHint)}</div>`;
    }
    return `
        <div class="cluster-tiles-selector">
            ${clusterDashboardTiles.map((tile, index) => {
                const nt = normalizeClusterDashboardTiles([tile])[0] || tile;
                const isSelected = index === tilesEditorSelectedIndex;
                const typeText = getClusterDashboardTileTypeLabel(nt.type);
                const srcText = getClusterDashboardTileSourceSummary(nt);
                return `
                    <button type="button"
                        class="cluster-tiles-selector__item${isSelected ? ' is-selected' : ''}"
                        onclick="selectClusterDashboardTile(${index})">
                        <span class="cluster-tiles-selector__title">${escapeHtml(typeText)}</span>
                        <span class="cluster-tiles-selector__src">${escapeHtml(srcText)}</span>
                    </button>
                `;
            }).join('')}
        </div>
    `;
}

function buildClusterDashboardTileDetailHtml(index) {
    const typeLabel = t('settingsClusterTileTypeLabel');
    const sourceLabel = t('settingsClusterTileSourceLabel');
    const missingSourceText = t('settingsClusterTileSourceMissing');
    const noSourcesText = t('settingsClusterTileNoSources');
    const removeTitle = t('settingsClusterTileRemoveTitle');
    const moveUpTitle = t('settingsClusterTileMoveUpTitle');
    const moveDownTitle = t('settingsClusterTileMoveDownTitle');
    const gridColLabel = t('settingsClusterTileTilesGridColLabel');
    const gridRowLabel = t('settingsClusterTileTilesGridRowLabel');
    const gridWLabel = t('settingsClusterTileTilesGridWLabel');
    const gridHLabel = t('settingsClusterTileTilesGridHLabel');
    const gridAutoHint = t('settingsClusterTileTilesGridAutoHint');
    const gridPresetLabel = t('settingsClusterTileTilesGridPresetLabel');
    const showTilesLabel = t('settingsClusterTileShowOnTilesLabel');
    const tileChartWindowLabel = tOr('settingsTileChartWindowLabel', 'Display period');
    const tileChartStyleLabel = tOr('settingsTilesChartDisplayVariantLabel', 'Chart style');

    const tile = clusterDashboardTiles[index];
    if (!tile) return '';
    const nt = normalizeClusterDashboardTiles([tile])[0] || tile;
    const availableTypes = getAvailableClusterDashboardTileTypes();
    const typeOptions = availableTypes.map((type) => `
        <option value="${escapeHtml(type)}" ${nt.type === type ? 'selected' : ''}>${escapeHtml(getClusterDashboardTileTypeLabel(type))}</option>
    `).join('');

    let sourceFieldsHtml = '';
    if (clusterDashboardTileTypeUsesSplitSource(nt.type)) {
        const deviceLabel = t('settingsClusterTileDeviceLabel') || 'Device';
        const metricLabel = t('settingsClusterTileMetricLabel') || 'Metric';
        const splitDevices = getClusterDashboardTileSplitDevices(nt.type);
        const parsed = parseClusterDashboardCompositeSource(nt.type, nt.sourceId);
        let deviceOpts = splitDevices;
        let selectedDevice = String(parsed.device || '').trim();
        if (selectedDevice && !splitDevices.some((d) => d.value === selectedDevice)) {
            deviceOpts = [{ value: selectedDevice, label: `${missingSourceText}: ${selectedDevice}` }].concat(splitDevices);
        }
        if (!selectedDevice && splitDevices.length) {
            selectedDevice = splitDevices[0].value;
        }
        const splitMetrics = getClusterDashboardTileSplitMetrics(nt.type, selectedDevice);
        let metricOpts = splitMetrics;
        let selectedMetric = parsed.metric;
        if (selectedMetric && !splitMetrics.some((m) => m.value === selectedMetric)) {
            metricOpts = [{ value: selectedMetric, label: `${missingSourceText}: ${selectedMetric}` }].concat(splitMetrics);
        }
        if (!selectedMetric && splitMetrics.length) {
            selectedMetric = splitMetrics[0].value;
        }
        const deviceOptionsHtml = deviceOpts.length
            ? deviceOpts.map((opt) => `
            <option value="${escapeHtml(opt.value)}" ${selectedDevice === opt.value ? 'selected' : ''}>${escapeHtml(opt.label)}</option>
        `).join('')
            : `<option value="">${escapeHtml(noSourcesText)}</option>`;
        const metricOptionsHtml = metricOpts.length
            ? metricOpts.map((opt) => `
            <option value="${escapeHtml(opt.value)}" ${selectedMetric === opt.value ? 'selected' : ''}>${escapeHtml(opt.label)}</option>
        `).join('')
            : `<option value="">${escapeHtml(noSourcesText)}</option>`;
        sourceFieldsHtml = `
                <div class="col-12">
                    <label class="form-label fw-bold small mb-1">${escapeHtml(deviceLabel)}</label>
                    <select class="form-select form-select-sm" onchange="updateClusterDashboardTileSplitDevice(${index}, this.value)"
                        ${deviceOpts.length ? '' : 'disabled'}>
                        ${deviceOptionsHtml}
                    </select>
                </div>
                <div class="col-12">
                    <label class="form-label fw-bold small mb-1">${escapeHtml(metricLabel)}</label>
                    <select class="form-select form-select-sm" onchange="updateClusterDashboardTileSplitMetric(${index}, this.value)"
                        ${metricOpts.length ? '' : 'disabled'}>
                        ${metricOptionsHtml}
                    </select>
                </div>
        `;
    } else {
        let sourceOptions = getClusterDashboardTileSourceOptions(nt.type);
        if (nt.sourceId && !sourceOptions.some((opt) => opt.value === nt.sourceId)) {
            sourceOptions = [{
                value: nt.sourceId,
                label: `${missingSourceText}: ${nt.sourceId}`
            }].concat(sourceOptions);
        }

        const sourceOptionsHtml = sourceOptions.length
            ? sourceOptions.map((opt) => `
            <option value="${escapeHtml(opt.value)}" ${nt.sourceId === opt.value ? 'selected' : ''}>${escapeHtml(opt.label)}</option>
        `).join('')
            : `<option value="">${escapeHtml(noSourcesText)}</option>`;
        sourceFieldsHtml = `
                <div class="col-12">
                    <label class="form-label fw-bold small mb-1">${escapeHtml(sourceLabel)}</label>
                    <select class="form-select form-select-sm" onchange="updateClusterDashboardTileSource(${index}, this.value)">
                        ${sourceOptionsHtml}
                    </select>
                </div>
        `;
    }

    const gCol = nt.tilesGridCol | 0;
    const gRow = nt.tilesGridRow | 0;
    const gW = nt.tilesGridW || 1;
    const gH = nt.tilesGridH || 1;
    const len = clusterDashboardTiles.length;

    let embedFieldsHtml = '';
    if (nt.type === 'embed') {
        const embedKindUi = String(tile.embedKind || nt.embedKind || 'html').toLowerCase() === 'image' ? 'image' : 'html';
        const embedPayloadStr = tile.embedPayload != null ? String(tile.embedPayload) : (nt.embedPayload != null ? String(nt.embedPayload) : '');
        const imageLongData = embedKindUi === 'image' && embedPayloadStr.length > 4000 && /^data:image\//i.test(embedPayloadStr);
        const imageUrlInputValue = embedKindUi === 'image' && !imageLongData ? embedPayloadStr : '';
        const modeLabel = t('settingsClusterTileEmbedModeLabel') || 'Content';
        const htmlLabel = t('settingsClusterTileEmbedHtmlLabel') || 'HTML';
        const imageUrlLabel = t('settingsClusterTileEmbedImageUrlLabel') || 'Image URL';
        const imageFileLabel = t('settingsClusterTileEmbedImageFileLabel') || 'Upload image';
        const fileHint = t('settingsClusterTileEmbedFileHint') || 'PNG, JPEG, GIF, WebP. Files up to 16 MB; stored as a data URL in settings.';
        const dataUrlStored = t('settingsClusterTileEmbedDataUrlStored') || 'Embedded image saved; paste a URL or choose a file to replace.';
        embedFieldsHtml = `
                <div class="col-12">
                    <label class="form-label fw-bold small mb-1">${escapeHtml(modeLabel)}</label>
                    <div class="d-flex flex-wrap gap-3 mb-2">
                        <div class="form-check mb-0">
                            <input class="form-check-input" type="radio" name="embedKind${index}" id="embedKindHtml${index}" ${embedKindUi === 'html' ? 'checked' : ''} onchange="updateClusterDashboardTileEmbedKind(${index}, 'html')">
                            <label class="form-check-label small" for="embedKindHtml${index}">${escapeHtml(t('settingsClusterTileEmbedKindHtml') || 'HTML')}</label>
                        </div>
                        <div class="form-check mb-0">
                            <input class="form-check-input" type="radio" name="embedKind${index}" id="embedKindImg${index}" ${embedKindUi === 'image' ? 'checked' : ''} onchange="updateClusterDashboardTileEmbedKind(${index}, 'image')">
                            <label class="form-check-label small" for="embedKindImg${index}">${escapeHtml(t('settingsClusterTileEmbedKindImage') || 'Image')}</label>
                        </div>
                    </div>
                    <div class="tiles-embed-settings-html${embedKindUi === 'html' ? '' : ' d-none'}">
                        <label class="form-label small mb-1" for="embedHtmlTa${index}">${escapeHtml(htmlLabel)}</label>
                        <textarea id="embedHtmlTa${index}" class="form-control form-control-sm font-monospace" rows="8" spellcheck="false"
                            onchange="updateClusterDashboardTileFlags(${index}, { embedKind: 'html', embedPayload: this.value })">${escapeHtml(embedKindUi === 'html' ? embedPayloadStr : '')}</textarea>
                    </div>
                    <div class="tiles-embed-settings-image${embedKindUi === 'image' ? '' : ' d-none'}">
                        <label class="form-label small mb-1" for="embedImgUrl${index}">${escapeHtml(imageUrlLabel)}</label>
                        <input id="embedImgUrl${index}" type="url" class="form-control form-control-sm mb-2" placeholder="https://…"
                            value="${escapeHtml(imageUrlInputValue)}"
                            onchange="updateClusterDashboardTileFlags(${index}, { embedKind: 'image', embedPayload: this.value })">
                        ${imageLongData ? `<div class="form-text small mb-2">${escapeHtml(dataUrlStored)}</div>` : ''}
                        <label class="form-label small mb-1">${escapeHtml(imageFileLabel)}</label>
                        <input type="file" class="form-control form-control-sm" accept="image/png,image/jpeg,image/gif,image/webp,image/*"
                            onchange="onClusterEmbedTileImageFile(${index}, this)">
                        <div class="form-text small">${escapeHtml(fileHint)}</div>
                    </div>
                </div>
        `;
    }

    const metricTileExtraSettingsHtml = isMetricChartTileType(nt.type)
        ? `
                <div class="col-12 mt-2">
                    <label class="form-label fw-bold small mb-1">${escapeHtml(tileChartWindowLabel)}</label>
                    <select class="form-select form-select-sm"
                        onchange="updateClusterDashboardTileFlags(${index}, { chartWindowMin: parseInt(this.value, 10) || 1440 })">
                        <option value="1440" ${Number(nt.chartWindowMin) === 1440 ? 'selected' : ''}>24h</option>
                        <option value="720" ${Number(nt.chartWindowMin) === 720 ? 'selected' : ''}>12h</option>
                        <option value="360" ${Number(nt.chartWindowMin) === 360 ? 'selected' : ''}>6h</option>
                        <option value="60" ${Number(nt.chartWindowMin) === 60 ? 'selected' : ''}>1h</option>
                        <option value="30" ${Number(nt.chartWindowMin) === 30 ? 'selected' : ''}>30m</option>
                    </select>
                </div>
                <div class="col-12">
                    <label class="form-label fw-bold small mb-1">${escapeHtml(tileChartStyleLabel)}</label>
                    <select class="form-select form-select-sm"
                        onchange="updateClusterDashboardTileFlags(${index}, { chartDisplayVariant: this.value })">
                        <option value="area" ${String(nt.chartDisplayVariant || 'area') === 'area' ? 'selected' : ''}>Area</option>
                        <option value="line" ${String(nt.chartDisplayVariant || 'area') === 'line' ? 'selected' : ''}>Line</option>
                        <option value="minimal" ${String(nt.chartDisplayVariant || 'area') === 'minimal' ? 'selected' : ''}>Minimal</option>
                    </select>
                </div>
        `
        : '';

    return `
        <div class="border rounded p-3 cluster-tiles-detail-panel cluster-tiles-detail-panel--side">
            <div class="row g-2 align-items-end">
                <div class="col-12">
                    <label class="form-label fw-bold small mb-1">${escapeHtml(typeLabel)}</label>
                    <select class="form-select form-select-sm" onchange="updateClusterDashboardTileType(${index}, this.value)">
                        ${typeOptions}
                    </select>
                </div>
                ${sourceFieldsHtml}
                ${embedFieldsHtml}
                ${metricTileExtraSettingsHtml}
                <div class="col-12">
                    <div class="d-flex gap-2 justify-content-end flex-wrap">
                        <button type="button" class="btn btn-outline-secondary btn-sm" onclick="moveClusterDashboardTile(${index}, -1)" title="${escapeHtml(moveUpTitle)}" ${index === 0 ? 'disabled' : ''}>
                            <i class="bi bi-arrow-up"></i>
                        </button>
                        <button type="button" class="btn btn-outline-secondary btn-sm" onclick="moveClusterDashboardTile(${index}, 1)" title="${escapeHtml(moveDownTitle)}" ${index === len - 1 ? 'disabled' : ''}>
                            <i class="bi bi-arrow-down"></i>
                        </button>
                        <button type="button" class="btn btn-outline-danger btn-sm" onclick="removeClusterDashboardTile(${index})" title="${escapeHtml(removeTitle)}">
                            <i class="bi bi-trash"></i>
                        </button>
                    </div>
                </div>
                <div class="col-12 mt-2">
                    <div class="form-check mb-0">
                        <input class="form-check-input" type="checkbox" id="tileShowTiles${index}" ${nt.showOnTiles ? 'checked' : ''} onchange="updateClusterDashboardTileFlags(${index}, { showOnTiles: this.checked })">
                        <label class="form-check-label small" for="tileShowTiles${index}">${escapeHtml(showTilesLabel)}</label>
                    </div>
                </div>
                <div class="col-12 mt-2">
                    <div class="small text-muted mb-2">${escapeHtml(gridPresetLabel)}</div>
                    <div class="d-flex flex-wrap gap-2 mb-3">
                        <button type="button" class="btn btn-sm btn-outline-secondary" onclick="updateClusterDashboardTileFlags(${index}, { tilesSize: '1x1' })">1×1</button>
                        <button type="button" class="btn btn-sm btn-outline-secondary" onclick="updateClusterDashboardTileFlags(${index}, { tilesSize: '2x1' })">2×1</button>
                        <button type="button" class="btn btn-sm btn-outline-secondary" onclick="updateClusterDashboardTileFlags(${index}, { tilesSize: '3x1' })">3×1</button>
                        <button type="button" class="btn btn-sm btn-outline-secondary" onclick="updateClusterDashboardTileFlags(${index}, { tilesSize: '4x1' })">4×1</button>
                        <button type="button" class="btn btn-sm btn-outline-secondary" onclick="updateClusterDashboardTileFlags(${index}, { tilesSize: '2x2' })">2×2</button>
                        <button type="button" class="btn btn-sm btn-outline-secondary" onclick="updateClusterDashboardTileFlags(${index}, { tilesSize: '3x2' })">3×2</button>
                    </div>
                    <div class="row g-2 align-items-end">
                        <div class="col-6 col-md-3">
                            <label class="form-label small mb-0">${escapeHtml(gridWLabel)}</label>
                            <input type="number" class="form-control form-control-sm" min="1" max="${TILES_MONITOR_GRID_COLS}" value="${gW}"
                                onchange="updateClusterDashboardTileFlags(${index}, { tilesGridW: parseInt(this.value, 10) })">
                        </div>
                        <div class="col-6 col-md-3">
                            <label class="form-label small mb-0">${escapeHtml(gridHLabel)}</label>
                            <input type="number" class="form-control form-control-sm" min="1" max="${TILES_MONITOR_GRID_ROWS}" value="${gH}"
                                onchange="updateClusterDashboardTileFlags(${index}, { tilesGridH: parseInt(this.value, 10) })">
                        </div>
                        <div class="col-6 col-md-3">
                            <label class="form-label small mb-0">${escapeHtml(gridColLabel)}</label>
                            <input type="number" class="form-control form-control-sm" min="0" max="${TILES_MONITOR_GRID_COLS}" value="${gCol}"
                                onchange="updateClusterDashboardTileFlags(${index}, { tilesGridCol: parseInt(this.value, 10) || 0 })">
                        </div>
                        <div class="col-6 col-md-3">
                            <label class="form-label small mb-0">${escapeHtml(gridRowLabel)}</label>
                            <input type="number" class="form-control form-control-sm" min="0" max="${TILES_MONITOR_GRID_ROWS}" value="${gRow}"
                                onchange="updateClusterDashboardTileFlags(${index}, { tilesGridRow: parseInt(this.value, 10) || 0 })">
                        </div>
                    </div>
                    <div class="form-text small mt-1">${escapeHtml(gridAutoHint)}</div>
                </div>
            </div>
        </div>
    `;
}

function renderClusterDashboardTilesSettings() {
    const listEl = document.getElementById('settingsClusterTilesList');
    if (!listEl) return;

    const emptyText = t('settingsClusterTilesEmpty');
    const clickHint = t('settingsClusterTilesClickHint');
    const selectHint = t('settingsClusterTilesSelectHint');

    if (!Array.isArray(clusterDashboardTiles)) clusterDashboardTiles = [];

    clampTilesEditorSelectedIndex();

    if (!clusterDashboardTiles.length) {
        listEl.innerHTML = `<div class="text-muted small">${escapeHtml(emptyText)}</div>`;
    } else {
        const selectorHtml = buildClusterDashboardTilesSelectorHtml();
        const detailHtml = tilesEditorSelectedIndex >= 0
            ? buildClusterDashboardTileDetailHtml(tilesEditorSelectedIndex)
            : `<div class="text-muted small p-3">${escapeHtml(selectHint)}</div>`;

        listEl.innerHTML = `
            <div class="tiles-layout-editor tiles-layout-editor--split">
                <div class="tiles-layout-editor__sidebar">
                    ${selectorHtml}
                </div>
                <div class="tiles-layout-editor__main">
                    <div class="small text-muted mb-2 tiles-layout-editor__hint-bar">${escapeHtml(clickHint)}</div>
                    <div class="tiles-layout-editor__workspace">
                        <div class="tiles-layout-editor__grid-column">
                            <div id="settingsClusterTilesVisualEditor"></div>
                        </div>
                        <aside class="tiles-layout-editor__form-column" id="settingsClusterTilesDetailPanel">${detailHtml}</aside>
                    </div>
                </div>
            </div>
        `;
    }

    renderTilesVisualEditor();

    const addBtn = document.getElementById('settingsClusterTilesAddBtn');
    if (addBtn) addBtn.disabled = clusterDashboardTiles.length >= MAX_CLUSTER_DASHBOARD_TILES;
    markClusterDashboardTilesDirty(clusterDashboardTilesDirty);
    renderSavedTileViewsSettingsList();
}

function addClusterDashboardTile() {
    if (clusterDashboardTiles.length >= MAX_CLUSTER_DASHBOARD_TILES) return;
    const availableTypes = getAvailableClusterDashboardTileTypes();
    let selectedType = availableTypes[0];
    for (const type of availableTypes) {
        if (getClusterDashboardTileSourceOptions(type).length > 0) {
            selectedType = type;
            break;
        }
    }
    const firstSource = getClusterDashboardTileSourceOptions(selectedType)[0];
    const fallbackSourceByType = {
        speedtest: 'speedtest:default',
        iperf3: 'iperf3:default',
        ups: 'ups:1',
        ups_metric_chart: 'ups_metric_chart:1:charge',
        cluster_metric_chart: 'cluster_metric_chart:cpu',
        host_node_metric_chart: 'host_node_metric_chart:pve:cpu',
        cluster_node: 'cluster_node:pve',
        netdev: 'netdev:1',
        service: 'service:default',
        vmct: 'vmct:default',
        truenas_server: 'truenas_server:current',
        truenas_pool: 'truenas_pool:default',
        truenas_disk: 'truenas_disk:default',
        truenas_service: 'truenas_service:default',
        truenas_app: 'truenas_app:default',
        smart_sensor: 'smart_sensor:__missing__',
        smart_sensor_metric_chart: 'smart_sensor_metric_chart:__missing__:value',
        embed: 'embed:custom'
    };
    const newTile = {
        type: selectedType,
        sourceId: firstSource ? firstSource.value : (fallbackSourceByType[selectedType] || `${selectedType}:default`),
        showOnTiles: false,
        tilesSize: '1x1',
        tilesGridW: 1,
        tilesGridH: 1,
        tilesGridCol: 0,
        tilesGridRow: 0
    };
    if (selectedType === 'embed') {
        newTile.sourceId = 'embed:custom';
        newTile.embedKind = 'html';
        newTile.embedPayload = '';
    }
    clusterDashboardTiles = clusterDashboardTiles.concat([newTile]).slice(0, MAX_CLUSTER_DASHBOARD_TILES);
    tilesEditorSelectedIndex = clusterDashboardTiles.length - 1;
    markClusterDashboardTilesDirty(true);
    renderClusterDashboardTilesSettings();
}

function selectClusterDashboardTile(index) {
    if (!Array.isArray(clusterDashboardTiles)) return;
    if (index < 0 || index >= clusterDashboardTiles.length) return;
    tilesEditorSelectedIndex = index;
    renderClusterDashboardTilesSettings();
}

function updateClusterDashboardTileType(index, nextType) {
    const type = String(nextType || '').trim().toLowerCase();
    if (!getAvailableClusterDashboardTileTypes().includes(type) || !clusterDashboardTiles[index]) return;
    const firstSource = getClusterDashboardTileSourceOptions(type)[0];
    const current = clusterDashboardTiles[index];
    const fallbackSourceByType = {
        speedtest: 'speedtest:default',
        iperf3: 'iperf3:default',
        ups: 'ups:1',
        ups_metric_chart: 'ups_metric_chart:1:charge',
        cluster_metric_chart: 'cluster_metric_chart:cpu',
        host_node_metric_chart: 'host_node_metric_chart:pve:cpu',
        cluster_node: 'cluster_node:pve',
        netdev: 'netdev:1',
        service: 'service:default',
        vmct: 'vmct:default',
        truenas_server: 'truenas_server:current',
        truenas_pool: 'truenas_pool:default',
        truenas_disk: 'truenas_disk:default',
        truenas_service: 'truenas_service:default',
        truenas_app: 'truenas_app:default',
        smart_sensor: 'smart_sensor:__missing__',
        smart_sensor_metric_chart: 'smart_sensor_metric_chart:__missing__:value',
        embed: 'embed:custom'
    };
    let nextTile = {
        ...current,
        type,
        sourceId: firstSource ? firstSource.value : (fallbackSourceByType[type] || `${type}:default`)
    };
    if (type === 'embed') {
        nextTile.sourceId = 'embed:custom';
        nextTile.embedKind = current.type === 'embed' ? (current.embedKind === 'image' ? 'image' : 'html') : 'html';
        nextTile.embedPayload = current.type === 'embed' && current.embedPayload != null
            ? String(current.embedPayload)
            : '';
    }
    const merged = normalizeClusterDashboardTiles([nextTile])[0];
    if (merged) clusterDashboardTiles[index] = merged;
    clusterDashboardTiles = normalizeClusterDashboardTiles(clusterDashboardTiles);
    markClusterDashboardTilesDirty(true);
    scheduleClusterDashboardTilesAutosave();
    renderClusterDashboardTilesSettings();
}

function updateClusterDashboardTileSource(index, sourceId) {
    if (!clusterDashboardTiles[index]) return;
    clusterDashboardTiles[index] = {
        ...clusterDashboardTiles[index],
        sourceId: String(sourceId || '').trim()
    };
    clusterDashboardTiles = normalizeClusterDashboardTiles(clusterDashboardTiles);
    markClusterDashboardTilesDirty(true);
    scheduleClusterDashboardTilesAutosave();
    renderClusterDashboardTilesSettings();
}

function updateClusterDashboardTileEmbedKind(index, kind) {
    if (!clusterDashboardTiles[index]) return;
    const cur = clusterDashboardTiles[index];
    const k = kind === 'image' ? 'image' : 'html';
    let payload = cur.embedPayload != null ? String(cur.embedPayload) : '';
    if (k === 'image') {
        const url = sanitizeEmbedImageUrl(payload);
        payload = url || '';
    } else if (cur.embedKind === 'image') {
        payload = '';
    }
    updateClusterDashboardTileFlags(index, { embedKind: k, embedPayload: payload });
}

function onClusterEmbedTileImageFile(index, inputEl) {
    const file = inputEl && inputEl.files && inputEl.files[0];
    if (!inputEl || !file) return;
    if (!file.type || !file.type.startsWith('image/')) {
        showToast(t('settingsClusterTileEmbedFileNotImage') || 'Please choose an image file', 'error');
        inputEl.value = '';
        return;
    }
    if (file.size > CLUSTER_EMBED_IMAGE_FILE_MAX_BYTES) {
        showToast(t('settingsClusterTileEmbedFileTooLarge') || 'Image is too large (max 16 MB)', 'error');
        inputEl.value = '';
        return;
    }
    const reader = new FileReader();
    reader.onload = () => {
        const dataUrl = String(reader.result || '');
        if (dataUrl.length > CLUSTER_EMBED_IMAGE_DATA_URL_MAX) {
            showToast(t('settingsClusterTileEmbedFileTooLarge') || 'Image is too large (max 16 MB)', 'error');
            return;
        }
        if (!sanitizeEmbedImageUrl(dataUrl)) {
            showToast(t('settingsClusterTileEmbedInvalid') || 'Invalid image', 'error');
            return;
        }
        updateClusterDashboardTileFlags(index, { embedKind: 'image', embedPayload: dataUrl });
    };
    reader.onerror = () => {
        showToast(t('settingsClusterTileEmbedFileReadError') || 'Could not read file', 'error');
    };
    reader.readAsDataURL(file);
    inputEl.value = '';
}

function updateClusterDashboardTileFlags(index, patch) {
    if (!clusterDashboardTiles[index]) return;
    const next = { ...clusterDashboardTiles[index], ...(patch || {}) };
    if (!['1x1', '2x1', '3x1', '4x1', '2x2', '3x2'].includes(String(next.tilesSize || ''))) next.tilesSize = '1x1';
    if (patch && Object.prototype.hasOwnProperty.call(patch, 'tilesSize') && patch.tilesSize != null) {
        const wh = tilesSizeToGridWH(patch.tilesSize);
        next.tilesGridW = wh.w;
        next.tilesGridH = wh.h;
    }
    if (Object.prototype.hasOwnProperty.call(next, 'tilesGridW')) {
        let w = parseInt(next.tilesGridW, 10);
        if (!Number.isFinite(w) || w < 1) w = 1;
        next.tilesGridW = Math.min(TILES_MONITOR_GRID_COLS, w);
    }
    if (Object.prototype.hasOwnProperty.call(next, 'tilesGridH')) {
        let h = parseInt(next.tilesGridH, 10);
        if (!Number.isFinite(h) || h < 1) h = 1;
        next.tilesGridH = Math.min(TILES_MONITOR_GRID_ROWS, h);
    }
    if (Object.prototype.hasOwnProperty.call(next, 'tilesGridCol')) {
        let c = parseInt(next.tilesGridCol, 10);
        if (!Number.isFinite(c) || c < 0) c = 0;
        next.tilesGridCol = Math.min(TILES_MONITOR_GRID_COLS, c);
    }
    if (Object.prototype.hasOwnProperty.call(next, 'tilesGridRow')) {
        let r = parseInt(next.tilesGridRow, 10);
        if (!Number.isFinite(r) || r < 0) r = 0;
        next.tilesGridRow = Math.min(TILES_MONITOR_GRID_ROWS, r);
    }
    if (Object.prototype.hasOwnProperty.call(next, 'chartWindowMin')) {
        next.chartWindowMin = isMetricChartTileType(next.type)
            ? normalizeChartWindowMinutes(next.chartWindowMin, 1440)
            : null;
    }
    if (Object.prototype.hasOwnProperty.call(next, 'chartDisplayVariant')) {
        next.chartDisplayVariant = isMetricChartTileType(next.type)
            ? normalizeTileChartVariant(next.chartDisplayVariant, 'area')
            : null;
    }
    clusterDashboardTiles[index] = next;
    clusterDashboardTiles = normalizeClusterDashboardTiles(clusterDashboardTiles);
    markClusterDashboardTilesDirty(true);
    scheduleClusterDashboardTilesAutosave();
    renderClusterDashboardTilesSettings();
}

function moveClusterDashboardTile(index, delta) {
    const nextIndex = index + delta;
    if (index < 0 || index >= clusterDashboardTiles.length || nextIndex < 0 || nextIndex >= clusterDashboardTiles.length) return;
    const next = clusterDashboardTiles.slice();
    const tmp = next[index];
    next[index] = next[nextIndex];
    next[nextIndex] = tmp;
    clusterDashboardTiles = next;
    if (tilesEditorSelectedIndex === index) tilesEditorSelectedIndex = nextIndex;
    else if (tilesEditorSelectedIndex === nextIndex) tilesEditorSelectedIndex = index;
    markClusterDashboardTilesDirty(true);
    scheduleClusterDashboardTilesAutosave();
    renderClusterDashboardTilesSettings();
}

function removeClusterDashboardTile(index) {
    clusterDashboardTiles = clusterDashboardTiles.filter((_, idx) => idx !== index);
    if (tilesEditorSelectedIndex === index) tilesEditorSelectedIndex = -1;
    else if (tilesEditorSelectedIndex > index) tilesEditorSelectedIndex--;
    markClusterDashboardTilesDirty(true);
    scheduleClusterDashboardTilesAutosave();
    renderClusterDashboardTilesSettings();
}

async function onMonitorTilesChartAxisOptionsChange() {
    const prevTime = monitorTilesChartAxisTime;
    const prevValues = monitorTilesChartAxisValues;
    const prevYUnit = monitorTilesChartAxisYUnit;
    const tEl = document.getElementById('settingsMonitorTilesChartAxisTimeCheckbox');
    const vEl = document.getElementById('settingsMonitorTilesChartAxisValuesCheckbox');
    const uEl = document.getElementById('settingsMonitorTilesChartAxisYUnitCheckbox');
    monitorTilesChartAxisTime = !!(tEl && tEl.checked);
    monitorTilesChartAxisValues = !!(vEl && vEl.checked);
    monitorTilesChartAxisYUnit = !!(uEl && uEl.checked);
    const ok = await saveSettingsToServer({
        monitorTilesChartAxisTime,
        monitorTilesChartAxisValues,
        monitorTilesChartAxisYUnit
    });
    if (!ok) {
        showToast((t('errorUpdate') || 'Update failed') + (saveSettingsLastError ? ': ' + saveSettingsLastError : ''), 'error');
        monitorTilesChartAxisTime = prevTime;
        monitorTilesChartAxisValues = prevValues;
        monitorTilesChartAxisYUnit = prevYUnit;
        if (tEl) tEl.checked = prevTime;
        if (vEl) vEl.checked = prevValues;
        if (uEl) uEl.checked = prevYUnit;
        return;
    }
    renderTilesMonitorScreen('tilesNormalGrid').catch(() => {});
    if (!monitorMode || monitorCurrentView === 'tiles') {
        renderTilesMonitorScreen().catch(() => {});
    }
}

async function onGlobalMetricsRetentionSettingsChange() {
    const prev = {
        cluster: metricsHistoryRetentionHoursCluster,
        host: metricsHistoryRetentionHoursHost,
        ups: metricsHistoryRetentionHoursUps,
        smart: metricsHistoryRetentionHoursSmart
    };
    const elCluster = document.getElementById('settingsRetentionClusterSelect');
    const elHost = document.getElementById('settingsRetentionHostSelect');
    const elUps = document.getElementById('settingsRetentionUpsSelect');
    const elSmart = document.getElementById('settingsRetentionSmartSelect');
    metricsHistoryRetentionHoursCluster = Math.max(24, Math.min(24 * 30, parseInt(elCluster?.value, 10) || prev.cluster));
    metricsHistoryRetentionHoursHost = Math.max(24, Math.min(24 * 30, parseInt(elHost?.value, 10) || prev.host));
    metricsHistoryRetentionHoursUps = Math.max(24, Math.min(24 * 30, parseInt(elUps?.value, 10) || prev.ups));
    metricsHistoryRetentionHoursSmart = Math.max(24, Math.min(24 * 30, parseInt(elSmart?.value, 10) || prev.smart));
    const ok = await saveSettingsToServer({
        metricsHistoryRetentionHoursCluster,
        metricsHistoryRetentionHoursHost,
        metricsHistoryRetentionHoursUps,
        metricsHistoryRetentionHoursSmart
    });
    if (!ok) {
        metricsHistoryRetentionHoursCluster = prev.cluster;
        metricsHistoryRetentionHoursHost = prev.host;
        metricsHistoryRetentionHoursUps = prev.ups;
        metricsHistoryRetentionHoursSmart = prev.smart;
        if (elCluster) elCluster.value = String(prev.cluster);
        if (elHost) elHost.value = String(prev.host);
        if (elUps) elUps.value = String(prev.ups);
        if (elSmart) elSmart.value = String(prev.smart);
        showToast((t('errorUpdate') || 'Update failed') + (saveSettingsLastError ? ': ' + saveSettingsLastError : ''), 'error');
    }
}

async function onMetricsChartSettingsChange() {
    const prev = {
        chartWindowClusterMetricMin,
        chartWindowHostMetricMin,
        chartWindowUpsMetricMin,
        chartWindowSmartSensorMetricMin,
        tilesChartDisplayVariant
    };
    const clEl = document.getElementById('settingsChartWindowClusterMetricSelect');
    const hoEl = document.getElementById('settingsChartWindowHostMetricSelect');
    const upEl = document.getElementById('settingsChartWindowUpsMetricSelect');
    const ssEl = document.getElementById('settingsChartWindowSmartSensorMetricSelect');
    const tvEl = document.getElementById('settingsTilesChartDisplayVariantSelect');
    chartWindowClusterMetricMin = normalizeChartWindowMinutes(clEl?.value, 1440);
    chartWindowHostMetricMin = normalizeChartWindowMinutes(hoEl?.value, 1440);
    chartWindowUpsMetricMin = normalizeChartWindowMinutes(upEl?.value, 1440);
    chartWindowSmartSensorMetricMin = normalizeChartWindowMinutes(ssEl?.value, 1440);
    tilesChartDisplayVariant = ['area', 'line', 'minimal'].includes(String(tvEl?.value || '').toLowerCase())
        ? String(tvEl.value).toLowerCase()
        : 'area';
    const ok = await saveSettingsToServer({
        chartWindowClusterMetricMin,
        chartWindowHostMetricMin,
        chartWindowUpsMetricMin,
        chartWindowSmartSensorMetricMin,
        tilesChartDisplayVariant
    });
    if (!ok) {
        chartWindowClusterMetricMin = prev.chartWindowClusterMetricMin;
        chartWindowHostMetricMin = prev.chartWindowHostMetricMin;
        chartWindowUpsMetricMin = prev.chartWindowUpsMetricMin;
        chartWindowSmartSensorMetricMin = prev.chartWindowSmartSensorMetricMin;
        tilesChartDisplayVariant = prev.tilesChartDisplayVariant;
        if (clEl) clEl.value = String(chartWindowClusterMetricMin);
        if (hoEl) hoEl.value = String(chartWindowHostMetricMin);
        if (upEl) upEl.value = String(chartWindowUpsMetricMin);
        if (ssEl) ssEl.value = String(chartWindowSmartSensorMetricMin);
        if (tvEl) tvEl.value = tilesChartDisplayVariant;
        showToast((t('errorUpdate') || 'Update failed') + (saveSettingsLastError ? ': ' + saveSettingsLastError : ''), 'error');
        return;
    }
    renderTilesMonitorScreen('tilesNormalGrid').catch(() => {});
    if (!monitorMode || monitorCurrentView === 'tiles') {
        renderTilesMonitorScreen().catch(() => {});
    }
}

async function saveClusterDashboardTilesSettings() {
    if (clusterDashboardTilesAutosaveTimer) {
        clearTimeout(clusterDashboardTilesAutosaveTimer);
        clusterDashboardTilesAutosaveTimer = null;
    }
    clusterDashboardTiles = normalizeClusterDashboardTiles(clusterDashboardTiles);
    const ok = await saveSettingsToServer({ clusterDashboardTiles });
    if (!ok) {
        const detail = saveSettingsLastError || '—';
        const msg = (t('settingsClusterTilesSaveError') || 'Could not save tiles: {msg}').replace('{msg}', detail);
        showToast(msg, 'error');
        markClusterDashboardTilesDirty(true);
        return;
    }
    await loadSettings();
    clusterDashboardTilesSettingPresent = true;
    markClusterDashboardTilesDirty(false);
    renderClusterDashboardTilesSettings();
    await renderClusterDashboardTiles();
    renderTilesMonitorScreen('tilesNormalGrid').catch(() => {});
    if (!monitorMode || monitorCurrentView === 'tiles') {
        renderTilesMonitorScreen().catch(() => {});
    }
    showToast(t('settingsClusterTilesSaved') || t('dataUpdated'), 'success');
}

// ==================== UPS MONITORING (NUT/SNMP) ====================

const UPS_MAX_FIELDS = 15;
const UPS_SEMANTIC_KEYS = ['status', 'charge', 'runtime', 'inputVoltage', 'outputVoltage', 'power', 'load', 'frequency'];

function upsSemanticOptionLabel(key) {
    const map = {
        status: t('upsSemanticStatus') || 'Статус',
        charge: t('upsLabelCharge') || 'Заряд',
        runtime: t('upsLabelRuntime') || 'Время на батарее',
        inputVoltage: t('upsLabelInputVoltage') || 'Вход U',
        outputVoltage: t('upsLabelOutputVoltage') || 'Выход U',
        power: t('upsLabelPower') || 'Мощность',
        load: t('upsLabelLoad') || 'Нагрузка',
        frequency: t('upsLabelFrequency') || 'Частота'
    };
    return map[key] || key;
}

function createEmptyUpsField() {
    return {
        id: 'field_x',
        label: '',
        path: '',
        format: 'text',
        enabled: true,
        statusUpValues: [],
        statusDownValues: []
    };
}

function upsDefaultFieldsFromLegacyFlat(cfg) {
    const type = cfg.type || 'nut';
    if (type === 'snmp') {
        const s = normalizeSnmpDefaultsForUps(cfg);
        return [
            { id: 'status', label: upsSemanticOptionLabel('status'), path: s.snmpOidStatus || '', format: 'status', enabled: true, statusUpValues: [], statusDownValues: [] },
            { id: 'charge', label: upsSemanticOptionLabel('charge'), path: s.snmpOidCharge || '', format: 'percent', enabled: true, statusUpValues: [], statusDownValues: [] },
            { id: 'runtime', label: upsSemanticOptionLabel('runtime'), path: s.snmpOidRuntime || '', format: 'time', enabled: true, statusUpValues: [], statusDownValues: [] },
            { id: 'inputVoltage', label: upsSemanticOptionLabel('inputVoltage'), path: s.snmpOidInputVoltage || '', format: 'voltage', enabled: true, statusUpValues: [], statusDownValues: [] },
            { id: 'outputVoltage', label: upsSemanticOptionLabel('outputVoltage'), path: s.snmpOidOutputVoltage || '', format: 'voltage', enabled: true, statusUpValues: [], statusDownValues: [] },
            { id: 'power', label: upsSemanticOptionLabel('power'), path: s.snmpOidPower || '', format: 'watt', enabled: true, statusUpValues: [], statusDownValues: [] },
            { id: 'load', label: upsSemanticOptionLabel('load'), path: s.snmpOidLoad || '', format: 'percent', enabled: true, statusUpValues: [], statusDownValues: [] },
            { id: 'frequency', label: upsSemanticOptionLabel('frequency'), path: s.snmpOidFrequency || '', format: 'frequency', enabled: true, statusUpValues: [], statusDownValues: [] }
        ];
    }
    const n = normalizeNutDefaultsForUps(cfg);
    return [
        { id: 'status', label: upsSemanticOptionLabel('status'), path: n.nutVarStatus || 'ups.status', format: 'nut_status', enabled: true, statusUpValues: [], statusDownValues: [] },
        { id: 'charge', label: upsSemanticOptionLabel('charge'), path: n.nutVarCharge || 'battery.charge', format: 'percent', enabled: true, statusUpValues: [], statusDownValues: [] },
        { id: 'runtime', label: upsSemanticOptionLabel('runtime'), path: n.nutVarRuntime || 'battery.runtime', format: 'time', enabled: true, statusUpValues: [], statusDownValues: [] },
        { id: 'inputVoltage', label: upsSemanticOptionLabel('inputVoltage'), path: n.nutVarInputVoltage || 'input.voltage', format: 'voltage', enabled: true, statusUpValues: [], statusDownValues: [] },
        { id: 'outputVoltage', label: upsSemanticOptionLabel('outputVoltage'), path: n.nutVarOutputVoltage || 'output.voltage', format: 'voltage', enabled: true, statusUpValues: [], statusDownValues: [] },
        { id: 'power', label: upsSemanticOptionLabel('power'), path: n.nutVarPower || 'ups.realpower', format: 'watt', enabled: true, statusUpValues: [], statusDownValues: [] },
        { id: 'load', label: upsSemanticOptionLabel('load'), path: n.nutVarLoad || 'ups.load', format: 'percent', enabled: true, statusUpValues: [], statusDownValues: [] },
        { id: 'frequency', label: upsSemanticOptionLabel('frequency'), path: n.nutVarFrequency || 'input.frequency', format: 'frequency', enabled: true, statusUpValues: [], statusDownValues: [] }
    ];
}

function normalizeNutDefaultsForUps(cfg) {
    const c = cfg && typeof cfg === 'object' ? cfg : {};
    return {
        nutVarStatus: c.nutVarStatus || 'ups.status',
        nutVarCharge: c.nutVarCharge || 'battery.charge',
        nutVarRuntime: c.nutVarRuntime || 'battery.runtime',
        nutVarInputVoltage: c.nutVarInputVoltage || 'input.voltage',
        nutVarOutputVoltage: c.nutVarOutputVoltage || 'output.voltage',
        nutVarPower: c.nutVarPower || 'ups.realpower',
        nutVarLoad: c.nutVarLoad || 'ups.load',
        nutVarFrequency: c.nutVarFrequency || 'input.frequency'
    };
}

function normalizeSnmpDefaultsForUps(cfg) {
    const c = cfg && typeof cfg === 'object' ? cfg : {};
    return {
        snmpOidStatus: c.snmpOidStatus || '',
        snmpOidCharge: c.snmpOidCharge || '',
        snmpOidRuntime: c.snmpOidRuntime || '',
        snmpOidInputVoltage: c.snmpOidInputVoltage || '',
        snmpOidOutputVoltage: c.snmpOidOutputVoltage || '',
        snmpOidPower: c.snmpOidPower || '',
        snmpOidLoad: c.snmpOidLoad || '',
        snmpOidFrequency: c.snmpOidFrequency || ''
    };
}

function normalizeUpsFieldRowFromApi(f, idx, upsType) {
    const x = f && typeof f === 'object' ? f : {};
    const semSet = new Set(UPS_SEMANTIC_KEYS);
    const id = String(x.id || '');
    const semantic = semSet.has(id) ? id : 'custom';

    let fmt = String(x.format || 'text').trim().toLowerCase();
    if (fmt === 'bool') fmt = 'boot';
    const allowedNut = new Set(['text', 'number', 'percent', 'voltage', 'watt', 'frequency', 'time', 'nut_status', 'boot', 'status']);
    const allowedSnmp = new Set(['text', 'number', 'percent', 'voltage', 'watt', 'frequency', 'time', 'boot', 'status']);
    const allowed = upsType === 'nut' ? allowedNut : allowedSnmp;
    if (!allowed.has(fmt)) fmt = 'text';
    if (upsType === 'snmp' && fmt === 'nut_status') fmt = 'status';

    let label = x.label != null ? String(x.label).trim() : '';
    if (semantic !== 'custom') {
        label = '';
    }

    return {
        semantic,
        label,
        path: String(x.path != null ? x.path : x.oid || ''),
        format: fmt,
        enabled: x.enabled !== false && x.poll !== false,
        statusUpValues: Array.isArray(x.statusUpValues) ? x.statusUpValues : [],
        statusDownValues: Array.isArray(x.statusDownValues) ? x.statusDownValues : []
    };
}

function parseUpsFieldStatusListInput(str) {
    return String(str || '')
        .split(/[,;|]/)
        .map((s) => s.trim().toLowerCase())
        .filter(Boolean);
}

function updateUpsFieldStatusMapRowVisibility(fieldIndex) {
    const row = document.getElementById('upsFieldStatusMapRow' + fieldIndex);
    const sel = document.getElementById('upsFieldFormat' + fieldIndex + 'Select');
    const hint = document.getElementById('upsFieldStatusMapHint' + fieldIndex);
    if (!row || !sel) return;
    const show = sel.value === 'status' || sel.value === 'boot';
    row.classList.toggle('d-none', !show);
    if (hint && show) {
        if (sel.value === 'boot') {
            hint.textContent =
                t('netdevStatusMapHintBoot') ||
                'Опционально: перечислите значения для подключён/отключён; если пусто — правила 0/1, true/false, up/down и др.';
        } else {
            hint.textContent =
                t('netdevStatusMapHintStatus') ||
                'Укажите списки значений; только они определяют подключён/отключён (без авто-правил).';
        }
    }
}

function refreshAllUpsStatusMapRows() {
    const root = document.getElementById('upsFieldsEditorsRoot');
    if (!root) return;
    root.querySelectorAll('.ups-field-block[data-ups-row]').forEach((block) => {
        const idx = parseInt(block.getAttribute('data-ups-row'), 10);
        if (Number.isFinite(idx)) updateUpsFieldStatusMapRowVisibility(idx);
    });
}

function initUpsFieldFormatUi() {
    const wrap = document.getElementById('upsFieldsInputsWrap');
    if (!wrap || wrap.dataset.upsFormatUi === '1') return;
    wrap.dataset.upsFormatUi = '1';
    wrap.addEventListener('change', (ev) => {
        const el = ev.target;
        if (!el || !el.id) return;
        const m = el.id.match(/^upsFieldFormat(\d+)Select$/);
        if (m) updateUpsFieldStatusMapRowVisibility(parseInt(m[1], 10));
    });
}

function initUpsFieldSemanticUi() {
    const wrap = document.getElementById('upsFieldsInputsWrap');
    if (!wrap || wrap.dataset.upsSemanticUi === '1') return;
    wrap.dataset.upsSemanticUi = '1';
    wrap.addEventListener('change', (ev) => {
        const el = ev.target;
        if (!el || !el.id) return;
        if (!/^upsFieldSemantic\d+Select$/.test(el.id)) return;
        const type = String(document.getElementById('upsTypeSelect')?.value || 'nut').toLowerCase();
        const cur = getUpsFieldsFromDom();
        renderUpsFieldsEditors(cur, type);
    });
}

function renderUpsFieldsEditors(fields, upsType) {
    const root = document.getElementById('upsFieldsEditorsRoot');
    const hint = document.getElementById('upsFieldsCountHint');
    const addBtn = document.getElementById('upsAddFieldBtn');
    if (!root) return;

    const type = upsType === 'snmp' ? 'snmp' : 'nut';
    const list = (Array.isArray(fields) ? fields : []).map((f, i) => normalizeUpsFieldRowFromApi(f, i, type));

    const lblUp = t('netdevStatusConnected') || 'Подключён';
    const lblDown = t('netdevStatusDisconnected') || 'Отключён';
    const lblEnabled = t('netdevFieldEnabled') || 'Опрашивать';
    const lblRemove = t('netdevFieldRemove') || 'Удалить';
    const lblField = t('netdevFieldNumber') || 'Поле';
    const lblSemantic = t('upsFieldSemanticLabel') || 'Назначение';
    const lblCaption = t('upsFieldCaptionLabel') || 'Подпись на дашборде';
    const lblCustom = t('upsSemanticCustom') || 'Другое';
    const emptyHint = t('upsFieldsEmptyHint') || 'Нет полей. Добавьте строку кнопкой ниже.';
    const pathLbl = type === 'nut' ? (t('upsFieldPathVar') || 'Имя VAR') : (t('upsFieldPathOid') || 'OID');
    const fmtLbl = t('netdevFormatLabel') || 'Формат';
    const commaHint = t('commaSeparatedValues') || 'через запятую';
    const phEx = t('netdevFieldPlaceholderExample') || 'Например';

    const fmtOpt = (val, label, sel) => `<option value="${val}"${sel}>${escapeHtml(label)}</option>`;

    let html = '';
    if (list.length === 0) {
        html += `<div class="text-muted small py-2 mb-2 border rounded px-3 bg-light">${escapeHtml(emptyHint)}</div>`;
    }

    list.forEach((f, i) => {
        const mutedRow = f.enabled ? '' : ' opacity-50';
        const upStr = Array.isArray(f.statusUpValues) ? f.statusUpValues.join(', ') : '';
        const downStr = Array.isArray(f.statusDownValues) ? f.statusDownValues.join(', ') : '';

        let semanticOpts = '';
        for (const k of UPS_SEMANTIC_KEYS) {
            const sel = f.semantic === k ? ' selected' : '';
            semanticOpts += `<option value="${k}"${sel}>${escapeHtml(upsSemanticOptionLabel(k))}</option>`;
        }
        semanticOpts += `<option value="custom"${f.semantic === 'custom' ? ' selected' : ''}>${escapeHtml(lblCustom)}</option>`;

        const fmtText = t('netdevFmtText') || 'Текст';
        const fmtNum = t('upsFmtNumber') || 'Число';
        const fmtPct = t('upsFmtPercent') || 'Процент';
        const fmtV = t('upsFmtVoltage') || 'Напряжение (В)';
        const fmtW = t('upsFmtWatt') || 'Мощность (Вт)';
        const fmtHz = t('upsFmtFrequency') || 'Частота (Гц)';
        const fmtTime = t('netdevFmtTime') || 'Время (сек)';
        const fmtNut = t('upsFmtNutStatus') || 'NUT статус (OL/OB)';
        const fmtBoot = t('netdevFmtBoot') || 'Статус (bool)';
        const fmtStatus = t('netdevFmtStatus') || 'Статус (вручную)';

        let formatHtml = '';
        formatHtml += fmtOpt('text', fmtText, f.format === 'text' ? ' selected' : '');
        formatHtml += fmtOpt('number', fmtNum, f.format === 'number' ? ' selected' : '');
        formatHtml += fmtOpt('percent', fmtPct, f.format === 'percent' ? ' selected' : '');
        formatHtml += fmtOpt('voltage', fmtV, f.format === 'voltage' ? ' selected' : '');
        formatHtml += fmtOpt('watt', fmtW, f.format === 'watt' ? ' selected' : '');
        formatHtml += fmtOpt('frequency', fmtHz, f.format === 'frequency' ? ' selected' : '');
        formatHtml += fmtOpt('time', fmtTime, f.format === 'time' ? ' selected' : '');
        if (type === 'nut') {
            formatHtml += fmtOpt('nut_status', fmtNut, f.format === 'nut_status' ? ' selected' : '');
        }
        formatHtml += fmtOpt('boot', fmtBoot, f.format === 'boot' ? ' selected' : '');
        formatHtml += fmtOpt('status', fmtStatus, f.format === 'status' ? ' selected' : '');

        const showCaption = f.semantic === 'custom';
        const captionCol = showCaption
            ? `<div class="col-lg-2 col-md-4">
                        <label class="form-label fw-bold" for="upsFieldLabel${i}Input">${escapeHtml(lblCaption)}</label>
                        <input type="text" class="form-control" id="upsFieldLabel${i}Input" placeholder="${escapeHtml(phEx)}" value="${escapeHtml(f.label)}">
                    </div>`
            : '';
        const pathColClass = showCaption ? 'col-lg-4 col-md-6' : 'col-lg-6 col-md-8';
        const fmtColClass = showCaption ? 'col-lg-4 col-md-12' : 'col-lg-4 col-md-12';

        html += `
            <div class="ups-field-block border-bottom pb-3 mb-3${mutedRow}" data-ups-row="${i}">
                <div class="row g-2 align-items-center mb-2 flex-wrap">
                    <div class="col">
                        <span class="fw-semibold">${escapeHtml(lblField)} ${i + 1}</span>
                    </div>
                    <div class="col-auto">
                        <div class="form-check form-switch m-0">
                            <input class="form-check-input" type="checkbox" role="switch" id="upsFieldEnabled${i}Checkbox" ${f.enabled ? 'checked' : ''}>
                            <label class="form-check-label small" for="upsFieldEnabled${i}Checkbox">${escapeHtml(lblEnabled)}</label>
                        </div>
                    </div>
                    <div class="col-auto">
                        <button type="button" class="btn btn-sm btn-outline-danger" data-ups-remove-row="${i}">${escapeHtml(lblRemove)}</button>
                    </div>
                </div>
                <div class="row g-3 align-items-end">
                    <div class="col-lg-2 col-md-4">
                        <label class="form-label fw-bold small" for="upsFieldSemantic${i}Select">${escapeHtml(lblSemantic)}</label>
                        <select class="form-select form-select-sm" id="upsFieldSemantic${i}Select">${semanticOpts}</select>
                    </div>
                    ${captionCol}
                    <div class="${pathColClass}">
                        <label class="form-label fw-bold" for="upsFieldPath${i}Input">${escapeHtml(pathLbl)}</label>
                        <input type="text" class="form-control" id="upsFieldPath${i}Input" placeholder="${type === 'nut' ? 'ups.status' : '1.3.6...'}" value="${escapeHtml(f.path)}">
                    </div>
                    <div class="${fmtColClass}">
                        <label class="form-label fw-bold" for="upsFieldFormat${i}Select">${escapeHtml(fmtLbl)}</label>
                        <select class="form-select" id="upsFieldFormat${i}Select">${formatHtml}</select>
                    </div>
                </div>
                <div class="row g-2 mt-1 d-none" id="upsFieldStatusMapRow${i}">
                    <div class="col-12 small text-muted mb-0" id="upsFieldStatusMapHint${i}"></div>
                    <div class="col-md-6">
                        <label class="form-label small mb-1" for="upsFieldStatusUp${i}Input">«${escapeHtml(lblUp)}» ${escapeHtml(commaHint)}</label>
                        <input type="text" class="form-control form-control-sm" id="upsFieldStatusUp${i}Input" placeholder="1, up, true" value="${escapeHtml(upStr)}">
                    </div>
                    <div class="col-md-6">
                        <label class="form-label small mb-1" for="upsFieldStatusDown${i}Input">«${escapeHtml(lblDown)}» ${escapeHtml(commaHint)}</label>
                        <input type="text" class="form-control form-control-sm" id="upsFieldStatusDown${i}Input" placeholder="0, 2, down" value="${escapeHtml(downStr)}">
                    </div>
                </div>
            </div>`;
    });

    root.innerHTML = html;

    root.querySelectorAll('.ups-field-block').forEach((block) => {
        const ix = parseInt(block.getAttribute('data-ups-row'), 10);
        const en = document.getElementById('upsFieldEnabled' + ix + 'Checkbox');
        if (en) {
            en.addEventListener('change', () => {
                block.classList.toggle('opacity-50', !en.checked);
            });
        }
    });

    if (hint) hint.textContent = `${list.length} / ${UPS_MAX_FIELDS}`;
    if (addBtn) addBtn.disabled = list.length >= UPS_MAX_FIELDS;
    refreshAllUpsStatusMapRows();
}

function getUpsFieldsFromDom() {
    const root = document.getElementById('upsFieldsEditorsRoot');
    if (!root) return [];
    const blocks = root.querySelectorAll('.ups-field-block[data-ups-row]');
    const out = [];
    blocks.forEach((block) => {
        const i = parseInt(block.getAttribute('data-ups-row'), 10);
        if (!Number.isFinite(i)) return;
        const semEl = document.getElementById('upsFieldSemantic' + i + 'Select');
        const labelEl = document.getElementById('upsFieldLabel' + i + 'Input');
        const pathEl = document.getElementById('upsFieldPath' + i + 'Input');
        const formatEl = document.getElementById('upsFieldFormat' + i + 'Select');
        const upIn = document.getElementById('upsFieldStatusUp' + i + 'Input');
        const downIn = document.getElementById('upsFieldStatusDown' + i + 'Input');
        const enEl = document.getElementById('upsFieldEnabled' + i + 'Checkbox');
        const sem = semEl ? String(semEl.value || 'custom') : 'custom';
        const id = sem !== 'custom' ? sem : `field_${i}`;
        let fmt = formatEl ? String(formatEl.value || 'text').trim().toLowerCase() : 'text';
        if (fmt === 'bool') fmt = 'boot';
        let label = '';
        if (sem === 'custom') {
            label = labelEl ? labelEl.value.trim() : '';
        } else {
            label = upsSemanticOptionLabel(sem);
        }
        out.push({
            id,
            label,
            path: pathEl ? pathEl.value.trim() : '',
            format: fmt,
            enabled: enEl ? !!enEl.checked : true,
            statusUpValues: parseUpsFieldStatusListInput(upIn ? upIn.value : ''),
            statusDownValues: parseUpsFieldStatusListInput(downIn ? downIn.value : '')
        });
    });
    return out;
}

function upsAddFieldRow() {
    ensureUpsFieldsInfrastructure();
    const type = String(document.getElementById('upsTypeSelect')?.value || 'nut').toLowerCase();
    const cur = getUpsFieldsFromDom();
    if (cur.length >= UPS_MAX_FIELDS) {
        showToast(t('upsFieldsMaxToast') || `Не больше ${UPS_MAX_FIELDS} полей`, 'warning');
        return;
    }
    cur.push(createEmptyUpsField());
    renderUpsFieldsEditors(cur, type);
}

function upsRemoveFieldRow(rowIdx) {
    ensureUpsFieldsInfrastructure();
    const type = String(document.getElementById('upsTypeSelect')?.value || 'nut').toLowerCase();
    const cur = getUpsFieldsFromDom();
    if (rowIdx < 0 || rowIdx >= cur.length) return;
    cur.splice(rowIdx, 1);
    renderUpsFieldsEditors(cur, type);
}

function ensureUpsFieldsInfrastructure() {
    const wrap = document.getElementById('upsFieldsInputsWrap');
    if (!wrap) return;
    const INFRA_VER = '1';
    if (wrap.dataset.upsInfraVer !== INFRA_VER) {
        wrap.dataset.upsInfraVer = INFRA_VER;
        const addLbl = t('netdevFieldAdd') || 'Добавить поле';
        wrap.innerHTML = `
            <div id="upsFieldsEditorsRoot"></div>
            <div class="mt-2 d-flex flex-wrap align-items-center gap-2">
                <button type="button" class="btn btn-outline-primary btn-sm" id="upsAddFieldBtn">${escapeHtml(addLbl)}</button>
                <span class="small text-muted" id="upsFieldsCountHint"></span>
            </div>`;
        const addBtn = document.getElementById('upsAddFieldBtn');
        if (addBtn) addBtn.addEventListener('click', () => upsAddFieldRow());
        wrap.addEventListener('click', (e) => {
            const rm = e.target.closest('[data-ups-remove-row]');
            if (!rm) return;
            e.preventDefault();
            const idx = parseInt(rm.getAttribute('data-ups-remove-row'), 10);
            if (Number.isFinite(idx)) upsRemoveFieldRow(idx);
        });
    }
    initUpsFieldFormatUi();
    initUpsFieldSemanticUi();
}

function toggleUpsFields() {
    const enabledSelect = document.getElementById('upsEnabledSelect');
    const typeSelect = document.getElementById('upsTypeSelect');
    const nutFieldsWrap = document.getElementById('upsNutFields');
    const snmpFieldsWrap = document.getElementById('upsSnmpFields');
    const editorSection = document.getElementById('upsFieldsEditorSection');
    const titleEl = document.getElementById('upsFieldsSectionTitle');
    if (!enabledSelect || !typeSelect || !nutFieldsWrap || !snmpFieldsWrap) return;

    const enabled = String(enabledSelect.value || '0') === '1';
    const type = String(typeSelect.value || 'nut').toLowerCase();
    nutFieldsWrap.classList.toggle('d-none', !enabled || type !== 'nut');
    snmpFieldsWrap.classList.toggle('d-none', !enabled || type !== 'snmp');
    if (editorSection) editorSection.classList.toggle('d-none', !enabled);
    if (titleEl) {
        titleEl.textContent = type === 'nut'
            ? (t('upsFieldsTitleNut') || 'Поля NUT (VAR), до 15')
            : (t('upsFieldsTitleSnmp') || 'Поля SNMP (OID), до 15');
    }

    if (enabled && Array.isArray(upsConfigs) && document.getElementById('upsFieldsEditorsRoot')) {
        const slotIdx = getUpsSlotIndex();
        const cfg = upsConfigs[slotIdx];
        if (cfg) {
            cfg.fields = getUpsFieldsFromDom();
            cfg.type = type;
            cfg.fields = (cfg.fields || []).map((row) => {
                const next = { ...row };
                if (type === 'snmp' && next.format === 'nut_status') next.format = 'status';
                if (type === 'nut' && next.id === 'status' && next.format === 'status') next.format = 'nut_status';
                return next;
            });
            ensureUpsFieldsInfrastructure();
            renderUpsFieldsEditors(cfg.fields, type);
            refreshAllUpsStatusMapRows();
        }
    }
}

function getUpsSlotIndex() {
    const tabsEl = document.getElementById('upsSlotTabs');
    if (tabsEl) {
        const activeBtn = tabsEl.querySelector('button.nav-link.active[data-ups-slot-idx]');
        const idx = activeBtn ? parseInt(activeBtn.dataset.upsSlotIdx, 10) : NaN;
        if (Number.isFinite(idx)) return idx;
    }

    // Fallback: старый селект (на случай если где-то ещё остался)
    const slotSelect = document.getElementById('upsSlotSelect');
    if (!slotSelect) return 0;
    const n = parseInt(slotSelect.value, 10);
    return Number.isFinite(n) ? n : 0;
}

function createDefaultUpsConfig() {
    return {
        enabled: false,
        type: 'nut',
        host: '',
        port: null,
        name: '',
        fields: [],
        nutVarStatus: 'ups.status',
        nutVarCharge: 'battery.charge',
        nutVarRuntime: 'battery.runtime',
        nutVarInputVoltage: 'input.voltage',
        nutVarOutputVoltage: 'output.voltage',
        nutVarPower: 'ups.realpower',
        nutVarLoad: 'ups.load',
        nutVarFrequency: 'input.frequency',
        snmpCommunity: '',
        snmpOidStatus: '',
        snmpOidCharge: '',
        snmpOidRuntime: '',
        snmpOidInputVoltage: '',
        snmpOidOutputVoltage: '',
        snmpOidPower: '',
        snmpOidLoad: '',
        snmpOidFrequency: ''
    };
}

let upsConfigs = null;
let upsSlotListenerAttached = false;
let upsDisplaySlotsMonitor = [1, 2, 3, 4];
let upsDisplaySlotsDashboard = [1, 2, 3, 4];
let upsDisplaySlotsLoadedPromise = null;
let upsDisplaySlotsLoadedOnce = false;

function getAllUpsDisplaySlots() {
    return [1, 2, 3, 4];
}

function setUpsDisplayToggles(dashboardSlots, monitorSlots) {
    const dashSelect = document.getElementById('upsShowOnDashboardSelect');
    const monSelect = document.getElementById('upsShowOnMonitorSelect');
    if (dashSelect) dashSelect.value = Array.isArray(dashboardSlots) && dashboardSlots.length ? '1' : '0';
    if (monSelect) monSelect.value = Array.isArray(monitorSlots) && monitorSlots.length ? '1' : '0';
}

async function ensureUpsDisplaySlotsLoaded() {
    if (upsDisplaySlotsLoadedPromise) return upsDisplaySlotsLoadedPromise;

    upsDisplaySlotsLoadedPromise = (async () => {
        try {
            const resp = await fetch('/api/ups/display');
            const data = await resp.json();
            if (data && data.success) {
                if (Array.isArray(data.dashboardSlots)) upsDisplaySlotsDashboard = data.dashboardSlots;
                if (Array.isArray(data.monitorSlots)) upsDisplaySlotsMonitor = data.monitorSlots;
            }
        } catch (e) {
            // Используем дефолтные [1..4]
        }

        // Обновим переключатели в панели настроек (если она есть на странице)
        try {
            setUpsDisplayToggles(upsDisplaySlotsDashboard, upsDisplaySlotsMonitor);
        } catch (_) {}

        upsDisplaySlotsLoadedOnce = true;
    })();

    return upsDisplaySlotsLoadedPromise;
}

async function loadUpsSettings() {
    const enabledSelect = document.getElementById('upsEnabledSelect');
    const typeSelect = document.getElementById('upsTypeSelect');
    if (!enabledSelect || !typeSelect) return;

    ensureUpsFieldsInfrastructure();

    const hostInput = document.getElementById('upsHostInput');
    const portInput = document.getElementById('upsPortInput');
    const nutNameInput = document.getElementById('upsNutNameInput');
    const snmpCommunityInput = document.getElementById('upsSnmpCommunityInput');

    const applySlotToForm = (slotIdx) => {
        const cfg = (Array.isArray(upsConfigs) && upsConfigs[slotIdx]) ? upsConfigs[slotIdx] : createDefaultUpsConfig();
        enabledSelect.value = cfg.enabled ? '1' : '0';
        typeSelect.value = cfg.type || 'nut';

        if (hostInput) hostInput.value = cfg.host || '';
        if (portInput) portInput.value = cfg.port != null ? String(cfg.port) : '';

        if (nutNameInput) nutNameInput.value = cfg.name || '';
        if (snmpCommunityInput) snmpCommunityInput.value = cfg.snmpCommunity || '';

        const upsType = cfg.type || 'nut';
        const fields = Array.isArray(cfg.fields) && cfg.fields.length > 0
            ? cfg.fields
            : upsDefaultFieldsFromLegacyFlat(cfg);
        renderUpsFieldsEditors(fields, upsType);

        toggleUpsFields();
    };

    try {
        const res = await fetch('/api/ups/settings');
        if (!res.ok) {
            const maybe = await res.json().catch(() => ({}));
            throw new Error(maybe.error || maybe.message || `HTTP ${res.status}`);
        }
        const data = await res.json();
        upsConfigs = Array.isArray(data?.configs) ? data.configs : [];
        while (upsConfigs.length < 4) upsConfigs.push(createDefaultUpsConfig());

        const slotIdx = getUpsSlotIndex();
        applySlotToForm(slotIdx);
    } catch (e) {
        console.error('Failed to load UPS settings:', e);
        // UX: если не смогли загрузить с сервера, не “прячем” поля в пустоту.
        try {
            const slotIdx = getUpsSlotIndex();
            if (!upsConfigs) upsConfigs = new Array(4).fill(0).map(createDefaultUpsConfig);
            // Покажем поля формы, чтобы пользователь мог настроить вручную даже при проблемах с API.
            upsConfigs[slotIdx] = {
                ...createDefaultUpsConfig(),
                enabled: true,
                type: 'nut'
            };
            applySlotToForm(slotIdx);
        } catch (_) {}
        showToast((t('connectError') || 'Ошибка загрузки') + ': ' + ((e && e.message) ? e.message : String(e)), 'error');
    } finally {
        if (!upsConfigs) upsConfigs = new Array(4).fill(0).map(createDefaultUpsConfig);
    }

    if (!upsSlotListenerAttached) {
        const tabsEl = document.getElementById('upsSlotTabs');
        if (tabsEl) {
            const btns = tabsEl.querySelectorAll('button[data-ups-slot-idx]');
            btns.forEach((btn) => {
                btn.addEventListener('click', () => {
                    const idx = parseInt(btn.dataset.upsSlotIdx, 10);
                    if (!Number.isFinite(idx)) return;

                    // Переключаем active-класс, чтобы getUpsSlotIndex() работал
                    btns.forEach(b => {
                        b.classList.toggle('active', b === btn);
                        b.setAttribute('aria-selected', String(b === btn));
                    });
                    applySlotToForm(idx);
                });
            });
            upsSlotListenerAttached = true;
        }
    }
}

async function saveUpsSettings() {
    const enabledSelect = document.getElementById('upsEnabledSelect');
    const typeSelect = document.getElementById('upsTypeSelect');
    if (!enabledSelect || !typeSelect) return;

    const enabled = String(enabledSelect.value || '0') === '1';
    const type = String(typeSelect.value || 'nut').toLowerCase();

    const host = (document.getElementById('upsHostInput')?.value || '').trim();
    const port = (document.getElementById('upsPortInput')?.value || '').trim();

    const slotIdx = getUpsSlotIndex();
    const cfg = (Array.isArray(upsConfigs) && upsConfigs[slotIdx]) ? upsConfigs[slotIdx] : createDefaultUpsConfig();
    cfg.enabled = enabled;
    cfg.type = type;
    cfg.host = host;
    cfg.port = port !== '' ? parseInt(port, 10) : null;

    ensureUpsFieldsInfrastructure();
    cfg.fields = getUpsFieldsFromDom();

    if (type === 'nut') {
        cfg.name = (document.getElementById('upsNutNameInput')?.value || '').trim();
    } else if (type === 'snmp') {
        cfg.snmpCommunity = (document.getElementById('upsSnmpCommunityInput')?.value || '').trim();
    }

    try {
        const res = await fetch('/api/ups/settings', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ configs: (Array.isArray(upsConfigs) ? upsConfigs : []) })
        });
        const data = await res.json();
        if (!res.ok || !data?.success) throw new Error(data?.error || 'failed to save');

        showToast(t('toastUpsSaved'), 'success');

        // Сохраним также, какие слоты UPS показывать на дашборде и в режиме монитора (Cluster)
        try {
            const dashboardSlots = document.getElementById('upsShowOnDashboardSelect')?.value === '0'
                ? []
                : getAllUpsDisplaySlots();
            const monitorSlots = document.getElementById('upsShowOnMonitorSelect')?.value === '0'
                ? []
                : getAllUpsDisplaySlots();
            const displayResp = await fetch('/api/ups/display', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ dashboardSlots, monitorSlots })
            });
            const displayData = await displayResp.json().catch(() => ({}));
            if (!displayResp.ok || !displayData?.success) {
                throw new Error(displayData?.error || 'failed to save UPS display settings');
            }

            // Синхронизируем локальный кеш сразу, чтобы дашборд и monitor-mode
            // обновлялись без перезагрузки страницы.
            upsDisplaySlotsDashboard = dashboardSlots;
            upsDisplaySlotsMonitor = monitorSlots;
            setUpsDisplayToggles(upsDisplaySlotsDashboard, upsDisplaySlotsMonitor);
        } catch (e) {
            showToast(t('toastUpsDisplaySaveError'), 'error');
        }

        updateUPSDashboard().catch(() => {});
        renderClusterDashboardTilesSettings();
        renderClusterDashboardTiles().catch(() => {});
        toggleUpsFields();
    } catch (e) {
        showToast(tParams('toastUpsSaveError', { msg: e.message || String(e) }), 'error');
    }

    // После изменения UPS обновим доступность экрана в monitor-mode.
    await refreshMonitorScreensAvailability();
    if (monitorMode && monitorCurrentView === 'ups' && upsMonitorConfigured === false) {
        applyMonitorView('cluster');
    }
}

// ==================== SNMP NETWORK DEVICES (UPS-like UI) ====================

const NETDEV_MAX_CONFIGS = 10;
const NETDEV_MAX_FIELDS = 15;
const NETDEV_FIELD_FORMAT_ALLOWED = ['text', 'time', 'mb', 'gb', 'boot', 'bool', 'status'];

let netdevConfigs = null;
let netdevSlotListenerAttached = false;
let netdevDisplaySlotsMonitor = Array.from({ length: NETDEV_MAX_CONFIGS }, (_, i) => i + 1);
let netdevDisplaySlotsDashboard = Array.from({ length: NETDEV_MAX_CONFIGS }, (_, i) => i + 1);
let netdevDisplaySlotsLoadedPromise = null;
let netdevDisplaySlotsLoadedOnce = false;

function createDefaultNetdevConfig() {
    return {
        enabled: false,
        host: '',
        port: null,
        community: '',
        name: '',
        nameOid: '',
        fields: []
    };
}

function createEmptyNetdevField() {
    return {
        label: '',
        oid: '',
        format: 'text',
        enabled: true,
        statusUpValues: [],
        statusDownValues: []
    };
}

function normalizeFieldForEditor(f) {
    const x = f && typeof f === 'object' ? f : {};
    let fmtRaw = String(x.format || 'text').trim().toLowerCase();
    let format = NETDEV_FIELD_FORMAT_ALLOWED.includes(fmtRaw) ? fmtRaw : 'text';
    if (format === 'bool') format = 'boot';
    return {
        label: x.label != null ? String(x.label) : '',
        oid: x.oid != null ? String(x.oid) : '',
        format,
        enabled: x.enabled !== false,
        statusUpValues: Array.isArray(x.statusUpValues) ? x.statusUpValues : [],
        statusDownValues: Array.isArray(x.statusDownValues) ? x.statusDownValues : []
    };
}

function getNetdevFieldsFromDom() {
    const root = document.getElementById('netdevFieldsEditorsRoot');
    if (!root) return [];
    const blocks = root.querySelectorAll('.netdev-field-block[data-netdev-row]');
    const out = [];
    blocks.forEach((block) => {
        const i = parseInt(block.getAttribute('data-netdev-row'), 10);
        if (!Number.isFinite(i)) return;
        const labelEl = document.getElementById('netdevFieldLabel' + i + 'Input');
        const oidEl = document.getElementById('netdevFieldOid' + i + 'Input');
        const formatEl = document.getElementById('netdevFieldFormat' + i + 'Select');
        const upIn = document.getElementById('netdevFieldStatusUp' + i + 'Input');
        const downIn = document.getElementById('netdevFieldStatusDown' + i + 'Input');
        const enEl = document.getElementById('netdevFieldEnabled' + i + 'Checkbox');
        const fmtRaw = formatEl ? String(formatEl.value || 'text').trim().toLowerCase() : 'text';
        let formatVal = NETDEV_FIELD_FORMAT_ALLOWED.includes(fmtRaw) ? fmtRaw : 'text';
        if (formatVal === 'bool') formatVal = 'boot';
        out.push({
            label: labelEl ? labelEl.value.trim() : '',
            oid: oidEl ? oidEl.value.trim() : '',
            format: formatVal,
            enabled: enEl ? !!enEl.checked : true,
            statusUpValues: parseNetdevStatusListInput(upIn ? upIn.value : ''),
            statusDownValues: parseNetdevStatusListInput(downIn ? downIn.value : '')
        });
    });
    return out;
}

function ensureNetdevSlotTabsRendered() {
    const tabsEl = document.getElementById('netdevSlotTabs');
    if (!tabsEl) return;
    if (tabsEl.dataset.rendered === '1') return;

    tabsEl.innerHTML = '';
    tabsEl.dataset.rendered = '1';

    for (let idx = 0; idx < NETDEV_MAX_CONFIGS; idx++) {
        const slotNum = idx + 1;
        const btn = document.createElement('button');
        btn.type = 'button';
        btn.className = 'nav-link py-1' + (idx === 0 ? ' active' : '');
        btn.setAttribute('role', 'tab');
        btn.dataset.netdevSlotIdx = String(idx);
        btn.setAttribute('aria-selected', idx === 0 ? 'true' : 'false');
        btn.textContent = String(slotNum);
        tabsEl.appendChild(btn);
    }
}

function getNetdevSlotIndex() {
    const tabsEl = document.getElementById('netdevSlotTabs');
    if (tabsEl) {
        const activeBtn = tabsEl.querySelector('button.nav-link.active[data-netdev-slot-idx]');
        const idx = activeBtn ? parseInt(activeBtn.dataset.netdevSlotIdx, 10) : NaN;
        if (Number.isFinite(idx)) return idx;
    }
    return 0;
}

function parseNetdevStatusListInput(str) {
    return String(str || '')
        .split(/[,;|]/)
        .map((s) => s.trim().toLowerCase())
        .filter(Boolean);
}

function updateNetdevStatusMapRowVisibility(fieldIndex) {
    const row = document.getElementById('netdevFieldStatusMapRow' + fieldIndex);
    const sel = document.getElementById('netdevFieldFormat' + fieldIndex + 'Select');
    const hint = document.getElementById('netdevFieldStatusMapHint' + fieldIndex);
    if (!row || !sel) return;
    const show = sel.value === 'status' || sel.value === 'boot';
    row.classList.toggle('d-none', !show);
    if (hint && show) {
        if (sel.value === 'boot') {
            hint.textContent =
                t('netdevStatusMapHintBoot') ||
                'Опционально: перечислите значения SNMP для подключён/отключён; если пусто — правила 0/1, true/false, up/down и др.';
        } else {
            hint.textContent =
                t('netdevStatusMapHintStatus') ||
                'Укажите списки значений SNMP; только они определяют подключён/отключён (без авто-правил).';
        }
    }
}

function refreshAllNetdevStatusMapRows() {
    const root = document.getElementById('netdevFieldsEditorsRoot');
    if (!root) return;
    root.querySelectorAll('.netdev-field-block[data-netdev-row]').forEach((block) => {
        const idx = parseInt(block.getAttribute('data-netdev-row'), 10);
        if (Number.isFinite(idx)) updateNetdevStatusMapRowVisibility(idx);
    });
}

function initNetdevFieldFormatUi() {
    const wrap = document.getElementById('netdevFieldsInputsWrap');
    if (!wrap || wrap.dataset.netdevFormatUi === '1') return;
    wrap.dataset.netdevFormatUi = '1';
    wrap.addEventListener('change', (ev) => {
        const el = ev.target;
        if (!el || !el.id) return;
        const m = el.id.match(/^netdevFieldFormat(\d+)Select$/);
        if (m) updateNetdevStatusMapRowVisibility(parseInt(m[1], 10));
    });
}

function renderNetdevFieldsEditors(fields) {
    const root = document.getElementById('netdevFieldsEditorsRoot');
    const hint = document.getElementById('netdevFieldsCountHint');
    const addBtn = document.getElementById('netdevAddFieldBtn');
    if (!root) return;

    const list = Array.isArray(fields) ? fields.map(normalizeFieldForEditor) : [];
    const lblUp = t('netdevStatusConnected') || 'Подключён';
    const lblDown = t('netdevStatusDisconnected') || 'Отключён';
    const lblEnabled = t('netdevFieldEnabled') || 'Опрашивать';
    const lblRemove = t('netdevFieldRemove') || 'Удалить';
    const lblField = t('netdevFieldNumber') || 'Поле';
    const emptyHint = t('netdevFieldsEmptyHint') || 'Нет полей OID. Добавьте поле кнопкой ниже (до 15).';
    const oidLbl = t('netdevOidLabel');
    const fmtLbl = t('netdevFormatLabel');
    const phEx = t('netdevFieldPlaceholderExample');
    const lblNameSuffix = t('netdevFieldNameSuffix');
    const commaHint = t('commaSeparatedValues');
    const fmtOptText = t('netdevFmtText');
    const fmtOptTime = t('netdevFmtTime');
    const fmtOptMb = t('netdevFmtMb');
    const fmtOptGb = t('netdevFmtGb');
    const fmtOptBoot = t('netdevFmtBoot');
    const fmtOptStatus = t('netdevFmtStatus');

    let html = '';
    if (list.length === 0) {
        html += `<div class="text-muted small py-2 mb-2 border rounded px-3 bg-light">${escapeHtml(emptyHint)}</div>`;
    }

    list.forEach((f, i) => {
        const mutedRow = f.enabled ? '' : ' opacity-50';
        const fmtBootSel = f.format === 'boot' ? ' selected' : '';
        const fmtStatusSel = f.format === 'status' ? ' selected' : '';
        const fmtTextSel = f.format === 'text' ? ' selected' : '';
        const fmtTimeSel = f.format === 'time' ? ' selected' : '';
        const fmtMbSel = f.format === 'mb' ? ' selected' : '';
        const fmtGbSel = f.format === 'gb' ? ' selected' : '';
        const upStr = Array.isArray(f.statusUpValues) ? f.statusUpValues.join(', ') : '';
        const downStr = Array.isArray(f.statusDownValues) ? f.statusDownValues.join(', ') : '';
        html += `
            <div class="netdev-field-block border-bottom pb-3 mb-3${mutedRow}" data-netdev-row="${i}">
                <div class="row g-2 align-items-center mb-2 flex-wrap">
                    <div class="col">
                        <span class="fw-semibold">${escapeHtml(lblField)} ${i + 1}</span>
                    </div>
                    <div class="col-auto">
                        <div class="form-check form-switch m-0">
                            <input class="form-check-input" type="checkbox" role="switch" id="netdevFieldEnabled${i}Checkbox" ${f.enabled ? 'checked' : ''}>
                            <label class="form-check-label small" for="netdevFieldEnabled${i}Checkbox">${escapeHtml(lblEnabled)}</label>
                        </div>
                    </div>
                    <div class="col-auto">
                        <button type="button" class="btn btn-sm btn-outline-danger" data-netdev-remove-row="${i}">${escapeHtml(lblRemove)}</button>
                    </div>
                </div>
                <div class="row g-3 align-items-end">
                    <div class="col-lg-3 col-md-4">
                        <label class="form-label fw-bold" for="netdevFieldLabel${i}Input">${escapeHtml(lblField)} ${i + 1} ${escapeHtml(lblNameSuffix)}</label>
                        <input type="text" class="form-control" id="netdevFieldLabel${i}Input" placeholder="${escapeHtml(phEx)}" value="${escapeHtml(f.label)}">
                    </div>
                    <div class="col-lg-5 col-md-5">
                        <label class="form-label fw-bold" for="netdevFieldOid${i}Input">${escapeHtml(oidLbl)}</label>
                        <input type="text" class="form-control" id="netdevFieldOid${i}Input" placeholder="1.3.6...." value="${escapeHtml(f.oid)}">
                    </div>
                    <div class="col-lg-4 col-md-3">
                        <label class="form-label fw-bold" for="netdevFieldFormat${i}Select">${escapeHtml(fmtLbl)}</label>
                        <select class="form-select" id="netdevFieldFormat${i}Select">
                            <option value="text"${fmtTextSel}>${escapeHtml(fmtOptText)}</option>
                            <option value="time"${fmtTimeSel}>${escapeHtml(fmtOptTime)}</option>
                            <option value="mb"${fmtMbSel}>${escapeHtml(fmtOptMb)}</option>
                            <option value="gb"${fmtGbSel}>${escapeHtml(fmtOptGb)}</option>
                            <option value="boot"${fmtBootSel}>${escapeHtml(fmtOptBoot)}</option>
                            <option value="status"${fmtStatusSel}>${escapeHtml(fmtOptStatus)}</option>
                        </select>
                    </div>
                </div>
                <div class="row g-2 mt-1 d-none" id="netdevFieldStatusMapRow${i}">
                    <div class="col-12 small text-muted mb-0" id="netdevFieldStatusMapHint${i}"></div>
                    <div class="col-md-6">
                        <label class="form-label small mb-1" for="netdevFieldStatusUp${i}Input">«${escapeHtml(lblUp)}» ${escapeHtml(commaHint)}</label>
                        <input type="text" class="form-control form-control-sm" id="netdevFieldStatusUp${i}Input" placeholder="1, up, true" value="${escapeHtml(upStr)}">
                    </div>
                    <div class="col-md-6">
                        <label class="form-label small mb-1" for="netdevFieldStatusDown${i}Input">«${escapeHtml(lblDown)}» ${escapeHtml(commaHint)}</label>
                        <input type="text" class="form-control form-control-sm" id="netdevFieldStatusDown${i}Input" placeholder="0, 2, down" value="${escapeHtml(downStr)}">
                    </div>
                </div>
            </div>`;
    });

    root.innerHTML = html;

    root.querySelectorAll('.netdev-field-block').forEach((block) => {
        const i = parseInt(block.getAttribute('data-netdev-row'), 10);
        const en = document.getElementById('netdevFieldEnabled' + i + 'Checkbox');
        if (en) {
            en.addEventListener('change', () => {
                block.classList.toggle('opacity-50', !en.checked);
            });
        }
    });

    if (hint) {
        hint.textContent = `${list.length} / ${NETDEV_MAX_FIELDS}`;
    }
    if (addBtn) {
        addBtn.disabled = list.length >= NETDEV_MAX_FIELDS;
    }
    refreshAllNetdevStatusMapRows();
}

function netdevAddFieldRow() {
    const cur = getNetdevFieldsFromDom();
    if (cur.length >= NETDEV_MAX_FIELDS) {
        showToast(t('netdevFieldsMaxToast') || `Не больше ${NETDEV_MAX_FIELDS} полей`, 'warning');
        return;
    }
    cur.push(createEmptyNetdevField());
    renderNetdevFieldsEditors(cur);
}

function netdevRemoveFieldRow(rowIdx) {
    const cur = getNetdevFieldsFromDom();
    if (rowIdx < 0 || rowIdx >= cur.length) return;
    cur.splice(rowIdx, 1);
    renderNetdevFieldsEditors(cur);
}

function ensureNetdevFieldsInfrastructure() {
    const wrap = document.getElementById('netdevFieldsInputsWrap');
    if (!wrap) return;
    const INFRA_VER = '6';
    if (wrap.dataset.netdevInfraVer !== INFRA_VER) {
        wrap.dataset.netdevInfraVer = INFRA_VER;
        const addLbl = t('netdevFieldAdd') || 'Добавить поле';
        wrap.innerHTML = `
            <div id="netdevFieldsEditorsRoot"></div>
            <div class="mt-2 d-flex flex-wrap align-items-center gap-2">
                <button type="button" class="btn btn-outline-primary btn-sm" id="netdevAddFieldBtn">${escapeHtml(addLbl)}</button>
                <span class="small text-muted" id="netdevFieldsCountHint"></span>
            </div>`;
        const addBtn = document.getElementById('netdevAddFieldBtn');
        if (addBtn) addBtn.addEventListener('click', () => netdevAddFieldRow());
        wrap.addEventListener('click', (e) => {
            const rm = e.target.closest('[data-netdev-remove-row]');
            if (!rm) return;
            e.preventDefault();
            const idx = parseInt(rm.getAttribute('data-netdev-remove-row'), 10);
            if (Number.isFinite(idx)) netdevRemoveFieldRow(idx);
        });
    }
    initNetdevFieldFormatUi();
}

function getAllNetdevDisplaySlots() {
    return Array.from({ length: NETDEV_MAX_CONFIGS }, (_, i) => i + 1);
}

function setNetdevDisplayToggles(dashboardSlots, monitorSlots) {
    const dashSelect = document.getElementById('netdevShowOnDashboardSelect');
    const monSelect = document.getElementById('netdevShowOnMonitorSelect');
    if (dashSelect) dashSelect.value = Array.isArray(dashboardSlots) && dashboardSlots.length ? '1' : '0';
    if (monSelect) monSelect.value = Array.isArray(monitorSlots) && monitorSlots.length ? '1' : '0';
}

async function ensureNetdevDisplaySlotsLoaded() {
    if (netdevDisplaySlotsLoadedPromise) return netdevDisplaySlotsLoadedPromise;

    netdevDisplaySlotsLoadedPromise = (async () => {
        try {
            const resp = await fetch('/api/netdevices/display');
            const data = await resp.json();
            if (data && data.success) {
                if (Array.isArray(data.dashboardSlots)) netdevDisplaySlotsDashboard = data.dashboardSlots;
                if (Array.isArray(data.monitorSlots)) netdevDisplaySlotsMonitor = data.monitorSlots;
            }
        } catch (e) {
            // Defaults are already set
        }

        // Update toggles
        try {
            setNetdevDisplayToggles(netdevDisplaySlotsDashboard, netdevDisplaySlotsMonitor);
        } catch (_) {}

        netdevDisplaySlotsLoadedOnce = true;
    })();

    return netdevDisplaySlotsLoadedPromise;
}

async function loadNetdevSettings() {
    // Render dynamic parts once
    ensureNetdevSlotTabsRendered();
    ensureNetdevFieldsInfrastructure();

    const enabledSelect = document.getElementById('netdevEnabledSelect');
    const hostInput = document.getElementById('netdevHostInput');
    const portInput = document.getElementById('netdevPortInput');
    const communityInput = document.getElementById('netdevCommunityInput');
    const nameInput = document.getElementById('netdevNameInput');
        const nameOidInput = document.getElementById('netdevNameOidInput');
        if (!enabledSelect || !hostInput || !portInput || !communityInput || !nameInput || !nameOidInput) return;

        const applySlotToForm = (slotIdx) => {
            const cfg = (Array.isArray(netdevConfigs) && netdevConfigs[slotIdx]) ? netdevConfigs[slotIdx] : createDefaultNetdevConfig();

            enabledSelect.value = cfg.enabled ? '1' : '0';
            if (hostInput) hostInput.value = cfg.host || '';
            if (portInput) portInput.value = cfg.port != null ? String(cfg.port) : '';
            if (communityInput) communityInput.value = cfg.community || '';
            if (nameInput) nameInput.value = cfg.name || '';
            if (nameOidInput) nameOidInput.value = cfg.nameOid || '';

            const fields = Array.isArray(cfg.fields) ? cfg.fields : [];
            renderNetdevFieldsEditors(fields);
        };

    try {
        const res = await fetch('/api/netdevices/settings');
        const data = await res.json();
        if (Array.isArray(data?.configs)) {
            netdevConfigs = data.configs;
        } else {
            netdevConfigs = [];
        }
        while (netdevConfigs.length < NETDEV_MAX_CONFIGS) netdevConfigs.push(createDefaultNetdevConfig());

        const slotIdx = getNetdevSlotIndex();
        applySlotToForm(slotIdx);
    } catch (e) {
        console.error('Failed to load Netdev settings:', e);
        netdevConfigs = Array.from({ length: NETDEV_MAX_CONFIGS }, () => createDefaultNetdevConfig());
        applySlotToForm(0);
    }
    renderClusterDashboardTilesSettings();

    if (!netdevSlotListenerAttached) {
        const tabsEl = document.getElementById('netdevSlotTabs');
        if (tabsEl) {
            const btns = tabsEl.querySelectorAll('button.nav-link[data-netdev-slot-idx]');
            btns.forEach((btn) => {
                btn.addEventListener('click', () => {
                    const idx = parseInt(btn.dataset.netdevSlotIdx, 10);
                    if (!Number.isFinite(idx)) return;

                    btns.forEach(b => {
                        b.classList.toggle('active', b === btn);
                        b.setAttribute('aria-selected', String(b === btn));
                    });
                    applySlotToForm(idx);
                });
            });
            netdevSlotListenerAttached = true;
        }
    }
}

async function saveNetdevSettings() {
    const enabledSelect = document.getElementById('netdevEnabledSelect');
    const hostInput = document.getElementById('netdevHostInput');
    const portInput = document.getElementById('netdevPortInput');
    const communityInput = document.getElementById('netdevCommunityInput');
    const nameInput = document.getElementById('netdevNameInput');
    const nameOidInput = document.getElementById('netdevNameOidInput');
    if (!enabledSelect || !hostInput || !portInput || !communityInput || !nameInput || !nameOidInput) return;

    const enabled = String(enabledSelect.value || '0') === '1';
    const host = hostInput.value.trim();
    const port = portInput.value.trim() !== '' ? parseInt(portInput.value.trim(), 10) : null;
    const community = communityInput.value.trim();
    const name = nameInput.value.trim();
    const nameOid = nameOidInput.value.trim();

    const slotIdx = getNetdevSlotIndex();
    const cfg = (Array.isArray(netdevConfigs) && netdevConfigs[slotIdx]) ? netdevConfigs[slotIdx] : createDefaultNetdevConfig();

    cfg.enabled = enabled;
    cfg.host = host;
    cfg.port = port != null && Number.isFinite(port) ? port : null;
    cfg.community = community;
    cfg.name = name;
    cfg.nameOid = nameOid;

    cfg.fields = getNetdevFieldsFromDom();

    if (!Array.isArray(netdevConfigs)) netdevConfigs = [];
    while (netdevConfigs.length < NETDEV_MAX_CONFIGS) netdevConfigs.push(createDefaultNetdevConfig());
    netdevConfigs[slotIdx] = cfg;

    try {
        const res = await fetch('/api/netdevices/settings', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ configs: Array.isArray(netdevConfigs) ? netdevConfigs : [] })
        });
        const data = await res.json();
        if (!res.ok || !data?.success) throw new Error(data?.error || 'failed to save');

        // Save display slots
        try {
            const dashboardSlots = document.getElementById('netdevShowOnDashboardSelect')?.value === '0'
                ? []
                : getAllNetdevDisplaySlots();
            const monitorSlots = document.getElementById('netdevShowOnMonitorSelect')?.value === '0'
                ? []
                : getAllNetdevDisplaySlots();

            await fetch('/api/netdevices/display', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ dashboardSlots, monitorSlots })
            });
            netdevDisplaySlotsDashboard = dashboardSlots;
            netdevDisplaySlotsMonitor = monitorSlots;
            setNetdevDisplayToggles(netdevDisplaySlotsDashboard, netdevDisplaySlotsMonitor);
        } catch (e) {
            showToast(t('toastNetdevDisplaySaveError'), 'error');
        }

        showToast(t('toastNetdevSaved'), 'success');
        await updateNetdevDashboard();
        renderClusterDashboardTilesSettings();
        renderClusterDashboardTiles().catch(() => {});
    } catch (e) {
        showToast(tParams('toastNetdevSaveError', { msg: e.message || String(e) }), 'error');
    }

    // После изменения SNMP обновим доступность экрана в monitor-mode.
    await refreshMonitorScreensAvailability();
    if (monitorMode && monitorCurrentView === 'netdev' && netdevMonitorConfigured === false) {
        applyMonitorView('cluster');
    }
}

// ==================== PROXMOX HOST METRICS ====================

function createDefaultHostMetricsSettings() {
    return {
        pollIntervalSec: 10,
        timeoutMs: 3000,
        cacheTtlSec: 8,
        criticalTempC: 85,
        criticalLinkSpeedMbps: 1000
    };
}

function createDefaultHostMetricsNodeConfig() {
    return {
        enabled: false,
        agentPort: 9105,
        agentPath: '/host-metrics',
        cpuTempSensor: '',
        linkInterface: ''
    };
}

function normalizeHostMetricsSettingsClient(raw) {
    const src = raw && typeof raw === 'object' ? raw : {};
    const base = createDefaultHostMetricsSettings();
    const poll = parseInt(src.pollIntervalSec, 10);
    const timeout = parseInt(src.timeoutMs, 10);
    const ttl = parseInt(src.cacheTtlSec, 10);
    const critical = parseInt(src.criticalTempC, 10);
    const criticalLink = parseInt(src.criticalLinkSpeedMbps, 10);
    return {
        pollIntervalSec: Number.isFinite(poll) ? Math.min(300, Math.max(5, poll)) : base.pollIntervalSec,
        timeoutMs: Number.isFinite(timeout) ? Math.min(30000, Math.max(500, timeout)) : base.timeoutMs,
        cacheTtlSec: Number.isFinite(ttl) ? Math.min(300, Math.max(1, ttl)) : base.cacheTtlSec,
        criticalTempC: Number.isFinite(critical) ? Math.min(120, Math.max(0, critical)) : base.criticalTempC,
        criticalLinkSpeedMbps: Number.isFinite(criticalLink) ? Math.min(400000, Math.max(0, criticalLink)) : base.criticalLinkSpeedMbps
    };
}

function normalizeHostMetricsNodeConfigClient(raw, nodeName = '') {
    const src = raw && typeof raw === 'object' ? raw : {};
    const base = createDefaultHostMetricsNodeConfig();
    let agentPort = parseInt(src.agentPort, 10);
    if (!Number.isFinite(agentPort)) agentPort = base.agentPort;
    agentPort = Math.min(65535, Math.max(1, agentPort));
    let agentPath = String(src.agentPath != null ? src.agentPath : src.agentEndpoint != null ? src.agentEndpoint : base.agentPath).trim();
    if (!agentPath) agentPath = base.agentPath;
    if (agentPath[0] !== '/') agentPath = `/${agentPath}`;
    const legacyUrl = String(src.agentUrl || '').trim();
    if (legacyUrl && /^https?:\/\//i.test(legacyUrl)) {
        try {
            const u = new URL(legacyUrl);
            if (u.port) agentPort = Math.min(65535, Math.max(1, parseInt(u.port, 10) || agentPort));
            if (u.pathname && u.pathname !== '/') agentPath = u.pathname;
        } catch {
            /* ignore */
        }
    }
    return {
        enabled: src.enabled === true || src.enabled === '1' || src.enabled === 1 || src.enabled === 'true',
        agentPort,
        agentPath,
        cpuTempSensor: String(src.cpuTempSensor || '').trim(),
        linkInterface: String(src.linkInterface || '').trim(),
        ipmiHost: String(src.ipmiHost || '').trim(),
        ipmiPort: (() => {
            const n = parseInt(src.ipmiPort, 10);
            if (!Number.isFinite(n)) return 623;
            return Math.min(65535, Math.max(1, n));
        })()
    };
}

function hostMetricsPreviewAgentUrl(nodeName, cfg, item) {
    const host = (item && item.nodeIp ? String(item.nodeIp).trim() : '') || String(nodeName || '').trim() || '—';
    const port = Number.isFinite(Number(cfg.agentPort)) ? Number(cfg.agentPort) : 9105;
    let path = String(cfg.agentPath || '/host-metrics').trim() || '/host-metrics';
    if (path[0] !== '/') path = `/${path}`;
    return `http://${host}:${port}${path}`;
}

function getHostMetricsSshHostForNode(nodeName) {
    const item = hostMetricsDiscoveryItems.find((i) => i.node === nodeName);
    const nip = item && item.nodeIp ? String(item.nodeIp).trim() : '';
    if (nip) return nip;
    return String(nodeName || '').trim() || '';
}

function hostMetricsDomIdPart(s) {
    return encodeURIComponent(String(s || '')).replace(/%/g, '_');
}

function getCurrentHostMetricsConnectionConfig() {
    const connId = getCurrentConnectionId();
    const cfg = connId && hostMetricsConfigs && hostMetricsConfigs[connId] && hostMetricsConfigs[connId].nodes
        ? hostMetricsConfigs[connId].nodes
        : {};
    return { connectionId: connId, nodes: cfg || {} };
}

function getHostMetricsNodeConfigForRow(nodeName, item) {
    const { nodes } = getCurrentHostMetricsConnectionConfig();
    return normalizeHostMetricsNodeConfigClient(nodes && nodes[nodeName], nodeName || item?.node || '');
}

function getHostMetricsAgentModalMode() {
    const el = document.getElementById('hostMetricsAgentInstallModal');
    if (el && el.getAttribute('data-agent-mode') === 'uninstall') return 'uninstall';
    return 'install';
}

function setHostMetricsAgentModalMode(mode) {
    const el = document.getElementById('hostMetricsAgentInstallModal');
    if (el) el.setAttribute('data-agent-mode', mode === 'uninstall' ? 'uninstall' : 'install');
}

function applyHostMetricsAgentModalMode(nodeName) {
    const isUn = getHostMetricsAgentModalMode() === 'uninstall';
    const titleEl = document.getElementById('hostMetricsAgentInstallTitleText');
    if (titleEl) titleEl.textContent = t(isUn ? 'hostMetricsAgentUninstallTitle' : 'hostMetricsAgentInstallTitle');
    const intro = document.getElementById('hostMetricsAgentInstallIntro');
    if (intro) {
        intro.textContent = tParams(
            isUn ? 'hostMetricsAgentUninstallModalIntro' : 'hostMetricsAgentInstallModalIntro',
            { node: nodeName || '—' }
        );
    }
    const confirmLbl = document.getElementById('hostMetricsAgentInstallConfirmLabel');
    if (confirmLbl) {
        confirmLbl.textContent = t(isUn ? 'hostMetricsAgentUninstallConfirmLabel' : 'hostMetricsAgentInstallConfirmLabel');
    }
    const runTxt = document.getElementById('hostMetricsAgentInstallRunBtnText');
    if (runTxt) runTxt.textContent = t(isUn ? 'hostMetricsAgentUninstallRunBtn' : 'hostMetricsAgentInstallRunBtn');
    const iconEl = document.getElementById('hostMetricsAgentInstallModalTitleIcon');
    if (iconEl) {
        iconEl.className = 'bi me-2 ' + (isUn ? 'bi-trash' : 'bi-cloud-download');
    }
}

function buildHostMetricsAgentPlanText(plan, mode) {
    if (!plan) return '';
    const isUn = mode === 'uninstall';
    const lines = [];
    lines.push(t(isUn ? 'hostMetricsAgentUninstallPlanIntro' : 'hostMetricsAgentInstallPlanIntro'));
    lines.push('');
    (plan.steps || []).forEach((s, i) => {
        lines.push(`${i + 1}. ${s}`);
    });
    lines.push('');
    lines.push(t(isUn ? 'hostMetricsAgentUninstallPlanFooter' : 'hostMetricsAgentInstallPlanFooter'));
    if (plan.prerequisites) {
        lines.push('');
        lines.push(plan.prerequisites);
    }
    return lines.join('\n');
}

function resetHostMetricsAgentInstallModal() {
    hostMetricsAgentInstallPlanCache = null;
    const s1 = document.getElementById('hostMetricsAgentInstallStep1');
    const s2 = document.getElementById('hostMetricsAgentInstallStep2');
    if (s1) s1.classList.remove('d-none');
    if (s2) s2.classList.add('d-none');
    const pw = document.getElementById('hostMetricsAgentSshPassword');
    if (pw) pw.value = '';
    const chk = document.getElementById('hostMetricsAgentInstallConfirm');
    if (chk) chk.checked = false;
    const rw = document.getElementById('hostMetricsAgentInstallResultWrap');
    if (rw) rw.classList.add('d-none');
    const runBtn = document.getElementById('hostMetricsAgentInstallRunBtn');
    if (runBtn) runBtn.disabled = true;
    const nextBtn = document.getElementById('hostMetricsAgentInstallNextBtn');
    if (nextBtn) nextBtn.disabled = false;
}

function openHostMetricsAgentInstallModal(nodeName) {
    setHostMetricsAgentModalMode('install');
    resetHostMetricsAgentInstallModal();
    lastHostMetricsAgentModalNodeName = nodeName || '';
    const hostEl = document.getElementById('hostMetricsAgentSshHost');
    if (hostEl) hostEl.value = getHostMetricsSshHostForNode(nodeName) || nodeName || '';
    applyHostMetricsAgentModalMode(nodeName);
    const modalEl = document.getElementById('hostMetricsAgentInstallModal');
    if (modalEl && typeof bootstrap !== 'undefined') {
        bootstrap.Modal.getOrCreateInstance(modalEl).show();
    }
}

function openHostMetricsAgentUninstallModal(nodeName) {
    setHostMetricsAgentModalMode('uninstall');
    resetHostMetricsAgentInstallModal();
    lastHostMetricsAgentModalNodeName = nodeName || '';
    const hostEl = document.getElementById('hostMetricsAgentSshHost');
    if (hostEl) hostEl.value = getHostMetricsSshHostForNode(nodeName) || nodeName || '';
    applyHostMetricsAgentModalMode(nodeName);
    const modalEl = document.getElementById('hostMetricsAgentInstallModal');
    if (modalEl && typeof bootstrap !== 'undefined') {
        bootstrap.Modal.getOrCreateInstance(modalEl).show();
    }
}

async function hostMetricsAgentInstallGoNext() {
    const base = getCurrentProxmoxHeaders();
    if (!base) {
        showToast(t('hostMetricsNeedConnection') || 'Подключитесь к Proxmox', 'warning');
        return;
    }
    const host = document.getElementById('hostMetricsAgentSshHost') && document.getElementById('hostMetricsAgentSshHost').value
        ? String(document.getElementById('hostMetricsAgentSshHost').value).trim()
        : '';
    if (!host) {
        showToast(t('hostMetricsAgentInstallNeedHost') || 'Укажите SSH host', 'warning');
        return;
    }
    const btn = document.getElementById('hostMetricsAgentInstallNextBtn');
    if (btn) btn.disabled = true;
    const mode = getHostMetricsAgentModalMode();
    try {
        const previewPath =
            mode === 'uninstall'
                ? '/api/host-metrics/agent-uninstall/preview'
                : '/api/host-metrics/agent-install/preview';
        const res = await fetch(previewPath, {
            method: 'POST',
            headers: { ...base, 'Content-Type': 'application/json' },
            body: '{}',
            credentials: 'same-origin'
        });
        const data = await res.json().catch(() => ({}));
        if (!res.ok || !data.success) throw new Error(data.error || res.statusText);
        hostMetricsAgentInstallPlanCache = data.plan;
        const ta = document.getElementById('hostMetricsAgentInstallPlanText');
        if (ta) ta.value = buildHostMetricsAgentPlanText(data.plan, mode);
        document.getElementById('hostMetricsAgentInstallStep1').classList.add('d-none');
        document.getElementById('hostMetricsAgentInstallStep2').classList.remove('d-none');
    } catch (e) {
        const previewErrKey =
            mode === 'uninstall'
                ? 'hostMetricsAgentUninstallPreviewError'
                : 'hostMetricsAgentInstallPreviewError';
        showToast((t(previewErrKey) || 'Ошибка') + ': ' + (e.message || e), 'error');
    } finally {
        if (btn) btn.disabled = false;
    }
}

function hostMetricsAgentInstallGoBack() {
    document.getElementById('hostMetricsAgentInstallStep1').classList.remove('d-none');
    document.getElementById('hostMetricsAgentInstallStep2').classList.add('d-none');
    const rw = document.getElementById('hostMetricsAgentInstallResultWrap');
    if (rw) rw.classList.add('d-none');
}

async function hostMetricsAgentInstallRun() {
    const mode = getHostMetricsAgentModalMode();
    const base = getCurrentProxmoxHeaders();
    if (!base) {
        showToast(t('hostMetricsNeedConnection') || 'Подключитесь к Proxmox', 'warning');
        return;
    }
    const sshHost = document.getElementById('hostMetricsAgentSshHost') && document.getElementById('hostMetricsAgentSshHost').value
        ? String(document.getElementById('hostMetricsAgentSshHost').value).trim()
        : '';
    const sshPortRaw = document.getElementById('hostMetricsAgentSshPort') && document.getElementById('hostMetricsAgentSshPort').value;
    const sshPort = parseInt(sshPortRaw != null ? sshPortRaw : '22', 10);
    const sshUser = document.getElementById('hostMetricsAgentSshUser') && document.getElementById('hostMetricsAgentSshUser').value
        ? String(document.getElementById('hostMetricsAgentSshUser').value).trim() || 'root'
        : 'root';
    const sshPassword = document.getElementById('hostMetricsAgentSshPassword') ? document.getElementById('hostMetricsAgentSshPassword').value : '';
    if (!sshHost) {
        showToast(t('hostMetricsAgentInstallNeedHost') || 'Укажите host', 'warning');
        return;
    }
    if (!sshPassword) {
        showToast(t('hostMetricsAgentInstallNeedPassword') || 'Укажите пароль SSH', 'warning');
        return;
    }
    const confirmEl = document.getElementById('hostMetricsAgentInstallConfirm');
    if (!confirmEl || !confirmEl.checked) {
        showToast(t('hostMetricsAgentInstallNeedConfirm') || 'Подтвердите выполнение команд', 'warning');
        return;
    }
    const runBtn = document.getElementById('hostMetricsAgentInstallRunBtn');
    if (runBtn) runBtn.disabled = true;
    try {
        const runPath =
            mode === 'uninstall'
                ? '/api/host-metrics/agent-uninstall/run'
                : '/api/host-metrics/agent-install/run';
        const res = await fetch(runPath, {
            method: 'POST',
            headers: { ...base, 'Content-Type': 'application/json' },
            body: JSON.stringify({
                confirm: true,
                sshHost,
                sshPort: Number.isFinite(sshPort) ? sshPort : 22,
                sshUser,
                sshPassword
            }),
            credentials: 'same-origin'
        });
        const data = await res.json().catch(() => ({}));
        if (!res.ok || !data.success) throw new Error(data.error || res.statusText);
        const pre = document.getElementById('hostMetricsAgentInstallResult');
        const wrap = document.getElementById('hostMetricsAgentInstallResultWrap');
        if (pre) pre.textContent = data.log || '';
        if (wrap) wrap.classList.remove('d-none');
        const okKey =
            mode === 'uninstall'
                ? 'hostMetricsAgentUninstallSuccess'
                : 'hostMetricsAgentInstallSuccess';
        showToast(t(okKey) || 'Готово', 'success');
        if (confirmEl) confirmEl.checked = false;
        if (runBtn) runBtn.disabled = true;
        await refreshHostMetricsDiscovery({ silent: true });
    } catch (e) {
        const errKey =
            mode === 'uninstall'
                ? 'hostMetricsAgentUninstallError'
                : 'hostMetricsAgentInstallError';
        showToast((t(errKey) || 'Ошибка') + ': ' + (e.message || e), 'error');
    } finally {
        if (runBtn) {
            const c = document.getElementById('hostMetricsAgentInstallConfirm');
            runBtn.disabled = !(c && c.checked);
        }
    }
}

function initHostMetricsAgentInstallModal() {
    const nextBtn = document.getElementById('hostMetricsAgentInstallNextBtn');
    if (nextBtn) nextBtn.addEventListener('click', () => hostMetricsAgentInstallGoNext());
    const backBtn = document.getElementById('hostMetricsAgentInstallBackBtn');
    if (backBtn) backBtn.addEventListener('click', () => hostMetricsAgentInstallGoBack());
    const runBtn = document.getElementById('hostMetricsAgentInstallRunBtn');
    if (runBtn) runBtn.addEventListener('click', () => hostMetricsAgentInstallRun());
    const chk = document.getElementById('hostMetricsAgentInstallConfirm');
    if (chk) {
        chk.addEventListener('change', () => {
            const b = document.getElementById('hostMetricsAgentInstallRunBtn');
            if (b) b.disabled = !chk.checked;
        });
    }
    const modalEl = document.getElementById('hostMetricsAgentInstallModal');
    if (modalEl) {
        modalEl.addEventListener('hidden.bs.modal', () => {
            resetHostMetricsAgentInstallModal();
            setHostMetricsAgentModalMode('install');
            lastHostMetricsAgentModalNodeName = '';
            applyHostMetricsAgentModalMode('');
        });
    }
}

function hostMetricsDiscoveryStatusHtml(item) {
    if (!item) return `<span class="badge bg-secondary">${escapeHtml(t('statusDash') || '—')}</span>`;
    if (item.error) {
        return `
            <span class="badge bg-danger-subtle text-danger-emphasis border">${escapeHtml(t('hostMetricsDiscoveryError') || 'Ошибка')}</span>
            <div class="small text-muted mt-1">${escapeHtml(item.error)}</div>
        `;
    }
    const sensorsCount = Array.isArray(item.cpuSensors) ? item.cpuSensors.length : 0;
    const ifaceCount = Array.isArray(item.interfaces) ? item.interfaces.length : 0;
    return `
        <span class="badge bg-success-subtle text-success-emphasis border">${escapeHtml(t('statusOkShort') || 'OK')}</span>
        <div class="small text-muted mt-1">${escapeHtml((t('hostMetricsDiscoveryFound') || '{sensors} sensors, {ifaces} interfaces')
            .replace('{sensors}', String(sensorsCount))
            .replace('{ifaces}', String(ifaceCount)))}</div>
    `;
}

function renderHostMetricsRows(items, state = null) {
    const tbody = document.getElementById('hostMetricsSettingsBody');
    const empty = document.getElementById('hostMetricsSettingsEmpty');
    if (!tbody || !empty) return;

    if (!getAuthHeadersForType('proxmox')) {
        tbody.innerHTML = '';
        empty.classList.remove('d-none');
        empty.textContent = t('hostMetricsProxmoxOnly') || 'Метрики хостов доступны только для Proxmox.';
        return;
    }

    if (state === 'no-connection') {
        tbody.innerHTML = '';
        empty.classList.remove('d-none');
        empty.textContent = t('hostMetricsNeedConnection') || 'Сначала подключитесь к Proxmox.';
        return;
    }

    if (!Array.isArray(items) || !items.length) {
        tbody.innerHTML = '';
        empty.classList.remove('d-none');
        empty.textContent = state === 'error'
            ? (t('hostMetricsDiscoveryErrorHint') || 'Не удалось получить список узлов/датчиков.')
            : (t('hostMetricsNoNodes') || 'Нет доступных узлов для настройки.');
        return;
    }

    empty.classList.add('d-none');
    tbody.innerHTML = items.map((item) => {
        const nodeName = item.node || '';
        const cfg = getHostMetricsNodeConfigForRow(nodeName, item);
        const cpuListId = 'hostMetricsCpuSensors_' + hostMetricsDomIdPart(nodeName);
        const ifaceListId = 'hostMetricsInterfaces_' + hostMetricsDomIdPart(nodeName);
        const cpuSensors = Array.isArray(item.cpuSensors) ? item.cpuSensors : [];
        const interfaces = Array.isArray(item.interfaces) ? item.interfaces : [];
        const clusterIp = item.nodeIp ? String(item.nodeIp).trim() : '';
        const previewUrl = hostMetricsPreviewAgentUrl(nodeName, cfg, item);
        return `
            <tr data-host-metrics-node="${escapeHtml(nodeName)}">
                <td>
                    <div class="fw-semibold">${escapeHtml(nodeName)}</div>
                    <div class="small text-muted">${escapeHtml(t('hostMetricsAgentHintShort') || 'Локальный HTTP endpoint на узле')}</div>
                </td>
                <td>
                    <div class="small text-muted" title="${escapeHtml(t('hostMetricsAgentIpClusterHint') || '')}">${clusterIp
            ? `${escapeHtml(t('hostMetricsAgentIpClusterLabel') || 'IP')} ${escapeHtml(clusterIp)}`
            : escapeHtml(t('hostMetricsAgentIpClusterDash') || '—')}</div>
                </td>
                <td>
                    <select class="form-select form-select-sm host-metrics-enabled">
                        <option value="0"${cfg.enabled ? '' : ' selected'}>${escapeHtml(t('optionNo') || 'Нет')}</option>
                        <option value="1"${cfg.enabled ? ' selected' : ''}>${escapeHtml(t('optionYes') || 'Да')}</option>
                    </select>
                </td>
                <td>
                    <input type="number" class="form-control form-control-sm host-metrics-agent-port" min="1" max="65535"
                        value="${escapeHtml(String(cfg.agentPort != null ? cfg.agentPort : 9105))}" placeholder="9105">
                </td>
                <td>
                    <input type="text" class="form-control form-control-sm host-metrics-agent-path"
                        value="${escapeHtml(cfg.agentPath || '/host-metrics')}" placeholder="/host-metrics">
                    <div class="small text-muted text-truncate mt-1" title="${escapeHtml(previewUrl)}">${escapeHtml(t('hostMetricsAgentUrlPreviewLabel') || '')} ${escapeHtml(previewUrl)}</div>
                </td>
                <td>
                    <input type="text" class="form-control form-control-sm host-metrics-sensor" list="${cpuListId}"
                        value="${escapeHtml(cfg.cpuTempSensor || '')}" placeholder="${escapeHtml(t('hostMetricsCpuSensorPlaceholder') || 'Package id 0')}">
                    <datalist id="${cpuListId}">
                        ${cpuSensors.map((sensor) => `<option value="${escapeHtml(sensor)}"></option>`).join('')}
                    </datalist>
                </td>
                <td>
                    <input type="text" class="form-control form-control-sm host-metrics-interface" list="${ifaceListId}"
                        value="${escapeHtml(cfg.linkInterface || '')}" placeholder="${escapeHtml(t('hostMetricsInterfacePlaceholder') || 'enp3s0')}">
                    <datalist id="${ifaceListId}">
                        ${interfaces.map((iface) => `<option value="${escapeHtml(iface)}"></option>`).join('')}
                    </datalist>
                </td>
                <td>${hostMetricsDiscoveryStatusHtml(item)}</td>
                <td class="text-end">
                    <div class="d-inline-flex gap-1 flex-wrap justify-content-end">
                        <button type="button" class="btn btn-sm btn-outline-primary" title="${escapeHtml(t('hostMetricsAgentInstallButtonTitle') || '')}" onclick='openHostMetricsAgentInstallModal(${JSON.stringify(nodeName)})'>
                            <i class="bi bi-cloud-download"></i>
                        </button>
                        <button type="button" class="btn btn-sm btn-outline-danger" title="${escapeHtml(t('hostMetricsAgentUninstallButtonTitle') || '')}" onclick='openHostMetricsAgentUninstallModal(${JSON.stringify(nodeName)})'>
                            <i class="bi bi-trash"></i>
                        </button>
                    </div>
                </td>
            </tr>
        `;
    }).join('');
}

function renderIpmiSettingsRows(items, state = null) {
    const tbody = document.getElementById('ipmiSettingsBody');
    const empty = document.getElementById('ipmiSettingsEmpty');
    if (!tbody || !empty) return;

    if (!getAuthHeadersForType('proxmox')) {
        tbody.innerHTML = '';
        empty.classList.remove('d-none');
        empty.textContent = t('hostMetricsProxmoxOnly') || 'Метрики хостов доступны только для Proxmox.';
        return;
    }
    if (state === 'no-connection') {
        tbody.innerHTML = '';
        empty.classList.remove('d-none');
        empty.textContent = t('hostMetricsNeedConnection') || 'Сначала подключитесь к Proxmox.';
        return;
    }
    if (!Array.isArray(items) || !items.length) {
        tbody.innerHTML = '';
        empty.classList.remove('d-none');
        empty.textContent = state === 'error'
            ? (t('hostMetricsDiscoveryErrorHint') || 'Не удалось получить список узлов/датчиков.')
            : (t('hostMetricsNoNodes') || 'Нет доступных узлов для настройки.');
        return;
    }

    empty.classList.add('d-none');
    tbody.innerHTML = items.map((item) => {
        const nodeName = item.node || '';
        const cfg = getHostMetricsNodeConfigForRow(nodeName, item);
        const clusterIp = item.nodeIp ? String(item.nodeIp).trim() : '';
        const ipmiHost = String(cfg.ipmiHost || '').trim();
        const ipmiPort = Number.isFinite(Number(cfg.ipmiPort)) ? Number(cfg.ipmiPort) : 623;
        const target = `${ipmiHost || clusterIp || nodeName || '—'}:${ipmiPort}`;
        return `
            <tr data-host-metrics-node="${escapeHtml(nodeName)}">
                <td><div class="fw-semibold">${escapeHtml(nodeName)}</div></td>
                <td>
                    <div class="small text-muted">${clusterIp
            ? `${escapeHtml(t('hostMetricsAgentIpClusterLabel') || 'IP')} ${escapeHtml(clusterIp)}`
            : escapeHtml(t('hostMetricsAgentIpClusterDash') || '—')}</div>
                </td>
                <td>
                    <input type="text" class="form-control form-control-sm host-metrics-ipmi-host"
                        value="${escapeHtml(ipmiHost)}" placeholder="${escapeHtml(clusterIp || nodeName)}">
                </td>
                <td>
                    <input type="number" class="form-control form-control-sm host-metrics-ipmi-port" min="1" max="65535"
                        value="${escapeHtml(String(ipmiPort))}" placeholder="623">
                </td>
                <td><span class="small text-muted">${escapeHtml(target)}</span></td>
            </tr>
        `;
    }).join('');
}

async function loadHostMetricsSettings() {
    const pollInput = document.getElementById('hostMetricsPollIntervalInput');
    const timeoutInput = document.getElementById('hostMetricsTimeoutInput');
    const ttlInput = document.getElementById('hostMetricsCacheTtlInput');
    const criticalInput = document.getElementById('hostMetricsCriticalTempInput');
    const criticalLinkInput = document.getElementById('hostMetricsCriticalLinkInput');
    try {
        const res = await fetch('/api/host-metrics/settings');
        const data = await res.json().catch(() => ({}));
        if (res.ok && data && data.success) {
            hostMetricsSettings = normalizeHostMetricsSettingsClient(data.settings);
            hostMetricsConfigs = data.configs && typeof data.configs === 'object' ? data.configs : {};
        } else {
            hostMetricsSettings = createDefaultHostMetricsSettings();
            hostMetricsConfigs = {};
        }
    } catch (e) {
        console.error('Failed to load host metrics settings:', e);
        hostMetricsSettings = createDefaultHostMetricsSettings();
        hostMetricsConfigs = {};
    }

    if (pollInput) pollInput.value = String(hostMetricsSettings.pollIntervalSec);
    if (timeoutInput) timeoutInput.value = String(hostMetricsSettings.timeoutMs);
    if (ttlInput) ttlInput.value = String(hostMetricsSettings.cacheTtlSec);
    if (criticalInput) criticalInput.value = String(hostMetricsSettings.criticalTempC);
    if (criticalLinkInput) criticalLinkInput.value = String(hostMetricsSettings.criticalLinkSpeedMbps);

    await refreshHostMetricsDiscovery({ silent: true });
}

async function refreshHostMetricsDiscovery(options = {}) {
    const headers = getCurrentProxmoxHeaders();
    if (!headers) {
        hostMetricsDiscoveryItems = [];
        renderHostMetricsRows([], 'no-connection');
        renderIpmiSettingsRows([], 'no-connection');
        return;
    }

    try {
        const res = await fetch('/api/host-metrics/discovery', { headers });
        const data = await res.json().catch(() => ({}));
        if (!res.ok || !data?.success) throw new Error(data?.error || `HTTP ${res.status}`);
        hostMetricsDiscoveryItems = Array.isArray(data.items) ? data.items : [];
        renderHostMetricsRows(hostMetricsDiscoveryItems);
        renderIpmiSettingsRows(hostMetricsDiscoveryItems);
        if (!options.silent) {
            showToast(t('hostMetricsDiscoveryUpdated') || 'Список датчиков обновлён', 'success');
        }
    } catch (e) {
        console.error('Host metrics discovery failed:', e);
        hostMetricsDiscoveryItems = [];
        renderHostMetricsRows([], 'error');
        renderIpmiSettingsRows([], 'error');
        if (!options.silent) {
            showToast((t('hostMetricsDiscoveryErrorToast') || 'Ошибка получения датчиков') + ': ' + (e.message || String(e)), 'error');
        }
    }
}

async function saveHostMetricsSettings() {
    const connId = getCurrentConnectionId();
    if (!connId) {
        showToast(t('hostMetricsNeedConnection') || 'Сначала подключитесь к Proxmox.', 'warning');
        return;
    }

    const pollInput = document.getElementById('hostMetricsPollIntervalInput');
    const timeoutInput = document.getElementById('hostMetricsTimeoutInput');
    const ttlInput = document.getElementById('hostMetricsCacheTtlInput');
    const criticalInput = document.getElementById('hostMetricsCriticalTempInput');
    const criticalLinkInput = document.getElementById('hostMetricsCriticalLinkInput');
    const rows = document.querySelectorAll('#hostMetricsSettingsBody tr[data-host-metrics-node]');
    const ipmiRows = document.querySelectorAll('#ipmiSettingsBody tr[data-host-metrics-node]');
    const nodes = {};

    rows.forEach((row) => {
        const nodeName = row.getAttribute('data-host-metrics-node') || '';
        const enabled = row.querySelector('.host-metrics-enabled')?.value === '1';
        const portRaw = row.querySelector('.host-metrics-agent-port')?.value;
        let agentPort = parseInt(portRaw, 10);
        if (!Number.isFinite(agentPort)) agentPort = 9105;
        agentPort = Math.min(65535, Math.max(1, agentPort));
        let agentPath = (row.querySelector('.host-metrics-agent-path')?.value || '').trim() || '/host-metrics';
        if (agentPath[0] !== '/') agentPath = `/${agentPath}`;
        const cpuTempSensor = (row.querySelector('.host-metrics-sensor')?.value || '').trim();
        const linkInterface = (row.querySelector('.host-metrics-interface')?.value || '').trim();
        nodes[nodeName] = {
            enabled,
            agentPort,
            agentPath,
            cpuTempSensor,
            linkInterface
        };
    });
    ipmiRows.forEach((row) => {
        const nodeName = row.getAttribute('data-host-metrics-node') || '';
        if (!nodeName) return;
        if (!nodes[nodeName]) nodes[nodeName] = normalizeHostMetricsNodeConfigClient({}, nodeName);
        const ipmiHost = (row.querySelector('.host-metrics-ipmi-host')?.value || '').trim();
        const ipmiPortRaw = row.querySelector('.host-metrics-ipmi-port')?.value;
        let ipmiPort = parseInt(ipmiPortRaw, 10);
        if (!Number.isFinite(ipmiPort)) ipmiPort = 623;
        ipmiPort = Math.min(65535, Math.max(1, ipmiPort));
        nodes[nodeName].ipmiHost = ipmiHost;
        nodes[nodeName].ipmiPort = ipmiPort;
    });

    const nextSettings = normalizeHostMetricsSettingsClient({
        pollIntervalSec: pollInput ? pollInput.value : hostMetricsSettings.pollIntervalSec,
        timeoutMs: timeoutInput ? timeoutInput.value : hostMetricsSettings.timeoutMs,
        cacheTtlSec: ttlInput ? ttlInput.value : hostMetricsSettings.cacheTtlSec,
        criticalTempC: criticalInput ? criticalInput.value : hostMetricsSettings.criticalTempC,
        criticalLinkSpeedMbps: criticalLinkInput ? criticalLinkInput.value : hostMetricsSettings.criticalLinkSpeedMbps
    });

    try {
        const res = await fetch('/api/host-metrics/settings', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                settings: nextSettings,
                connectionId: connId,
                nodes
            })
        });
        const data = await res.json().catch(() => ({}));
        if (!res.ok || !data?.success) throw new Error(data?.error || 'failed to save');

        hostMetricsSettings = normalizeHostMetricsSettingsClient(data.settings);
        hostMetricsConfigs = data.configs && typeof data.configs === 'object' ? data.configs : {};

        if (pollInput) pollInput.value = String(hostMetricsSettings.pollIntervalSec);
        if (timeoutInput) timeoutInput.value = String(hostMetricsSettings.timeoutMs);
        if (ttlInput) ttlInput.value = String(hostMetricsSettings.cacheTtlSec);
        if (criticalInput) criticalInput.value = String(hostMetricsSettings.criticalTempC);
        if (criticalLinkInput) criticalLinkInput.value = String(hostMetricsSettings.criticalLinkSpeedMbps);

        showToast(t('toastHostMetricsSaved') || 'Настройки метрик хостов сохранены', 'success');
        await refreshHostMetricsDiscovery({ silent: true });
        if (getAuthHeadersForType('proxmox')) {
            refreshData({ silent: true });
        }
    } catch (e) {
        showToast((t('toastHostMetricsSaveError') || 'Не удалось сохранить метрики хостов: {msg}')
            .replace('{msg}', e.message || String(e)), 'error');
    }
}

function formatHostMetricsTemp(tempC) {
    const n = Number(tempC);
    if (!Number.isFinite(n)) return '—';
    const rounded = Math.round(n * 10) / 10;
    return `${rounded}°C`;
}

function formatHostMetricsSpeed(link) {
    const speed = Number(link && link.speedMbps);
    if (Number.isFinite(speed) && speed > 0) {
        if (speed >= 1000 && speed % 1000 === 0) return `${speed / 1000} Gbps`;
        return `${speed} Mbps`;
    }
    const state = String(link && link.state || '').toLowerCase();
    if (state === 'down') return t('hostMetricsLinkDown') || 'down';
    if (state === 'up') return t('hostMetricsLinkUnknown') || 'unknown';
    return '—';
}

function getHostMetricsAlerts(metric, settings = null) {
    const cfg = normalizeHostMetricsSettingsClient(settings || hostMetricsSettings);
    const alerts = [];
    const tempThreshold = Number(cfg.criticalTempC);
    const temp = Number(metric && metric.cpu && metric.cpu.tempC);
    if (Number.isFinite(tempThreshold) && tempThreshold > 0 && Number.isFinite(temp) && temp >= tempThreshold) {
        alerts.push({
            kind: 'cpu',
            message: (t('hostMetricsCriticalWarning') || 'Температура CPU превысила порог {temp}°C').replace('{temp}', String(cfg.criticalTempC))
        });
    }

    const linkThreshold = Number(cfg.criticalLinkSpeedMbps);
    const linkSpeed = Number(metric && metric.link && metric.link.speedMbps);
    const linkState = String(metric && metric.link && metric.link.state || '').toLowerCase();
    if (Number.isFinite(linkThreshold) && linkThreshold > 0) {
        if (linkState === 'down') {
            alerts.push({
                kind: 'link',
                message: (t('hostMetricsCriticalLinkDown') || 'Линк down при минимальном пороге {speed} Mbps').replace('{speed}', String(cfg.criticalLinkSpeedMbps))
            });
        } else if (Number.isFinite(linkSpeed) && linkSpeed > 0 && linkSpeed < linkThreshold) {
            alerts.push({
                kind: 'link',
                message: (t('hostMetricsCriticalLinkWarning') || 'Скорость линка ниже порога {speed} Mbps').replace('{speed}', String(cfg.criticalLinkSpeedMbps))
            });
        }
    }
    return alerts;
}

function getHostMetricProblemMessages(metric, settings = null) {
    if (!metric) return [];
    const alerts = getHostMetricsAlerts(metric, settings);
    if (alerts.length) return alerts.map((item) => String(item.message || '').trim()).filter(Boolean);
    if (metric.stale) return [t('hostMetricsStale') || 'Stale data'];
    if (metric.error) return [String(metric.error)];
    return [];
}

function destroyHostNodeMetricCharts() {
    ['temp', 'cpu', 'mem'].forEach((k) => {
        const ch = hostNodeMetricCharts[k];
        if (ch) {
            try { ch.destroy(); } catch (_) {}
            hostNodeMetricCharts[k] = null;
        }
    });
}

function destroyClusterAggregateMetricCharts() {
    ['cpu', 'mem'].forEach((k) => {
        const ch = clusterAggregateMetricCharts[k];
        if (ch) {
            try { ch.destroy(); } catch (_) {}
            clusterAggregateMetricCharts[k] = null;
        }
    });
}

function syncClusterResourcesCardInteractivity() {
    const clusterBody = el('clusterResourcesCardBody');
    const clusterHint = el('clusterResourcesChartHint');
    if (!clusterBody) return;
    const isProxmox = !!getAuthHeadersForType('proxmox');
    clusterBody.classList.toggle('cursor-pointer', isProxmox);
    clusterBody.classList.toggle('cluster-resources-chart-trigger', isProxmox);
    clusterBody.setAttribute('role', isProxmox ? 'button' : 'region');
    clusterBody.setAttribute('tabindex', isProxmox ? '0' : '-1');
    const tip = t('clusterAggregateChartsOpenTitle');
    clusterBody.title = isProxmox ? (tip || '') : '';
    if (clusterHint) {
        clusterHint.classList.toggle('d-none', !isProxmox);
        clusterHint.title = isProxmox ? (tip || '') : '';
    }
}

function parseMetricHistoryPoints(rawPoints) {
    const out = [];
    const pts = Array.isArray(rawPoints) ? rawPoints : [];
    for (const p of pts) {
        const tv = Number(p.v);
        const iso = p.t != null ? String(p.t) : '';
        if (!iso || !Number.isFinite(tv)) continue;
        const ms = new Date(iso).getTime();
        if (!Number.isFinite(ms)) continue;
        out.push({ t: ms, v: tv });
    }
    return out;
}

function normalizeChartWindowMinutes(v, fallback = 1440) {
    const allowed = [30, 60, 360, 720, 1440];
    const n = parseInt(v, 10);
    return allowed.includes(n) ? n : fallback;
}

function normalizeTileChartVariant(v, fallback = 'area') {
    const s = String(v || '').trim().toLowerCase();
    if (s === 'line' || s === 'minimal' || s === 'area') return s;
    return fallback;
}

function isMetricChartTileType(type) {
    const t = String(type || '').trim().toLowerCase();
    return t === 'ups_metric_chart' || t === 'cluster_metric_chart' || t === 'host_node_metric_chart' || t === 'smart_sensor_metric_chart';
}

function filterSeriesByWindowMinutes(points, windowMin) {
    const src = Array.isArray(points) ? points : [];
    const minutes = normalizeChartWindowMinutes(windowMin, 1440);
    if (!src.length) return [];
    const thresholdMs = Date.now() - minutes * 60 * 1000;
    const filtered = src.filter((p) => Number.isFinite(p?.t) && p.t >= thresholdMs);
    return filtered.length ? filtered : src;
}

/** Только маркеры линии на плитках (подписи осей — размер по умолчанию Chart.js). */
function getTilesChartPointStyleForSeries(canvas, seriesLength) {
    if (!canvas || canvas.dataset?.tileCompact !== '1') return null;
    const cell = canvas.closest('.tiles-monitor-cell');
    let r = cell ? cell.getBoundingClientRect() : null;
    if (!r || r.width < 12 || r.height < 12) {
        r = canvas.getBoundingClientRect();
    }
    const w = Math.max(1, r.width || 160);
    const h = Math.max(1, r.height || 120);
    const cq = Math.min(w, h);
    const n = Number(seriesLength) || 0;
    const pr = n === 1 ? Math.min(4, Math.max(2, Math.round(cq * 0.014))) : 0;
    const pointHover = Math.round(Math.max(6, Math.min(10, cq * 0.034)));
    return { pointRadius: pr, pointHover };
}

/** После resize — обновить только точки линии (оси не трогаем). */
function applyTilesChartPointStyleToChart(chart, canvas) {
    if (!chart || !canvas) return;
    const sizes = getTilesChartPointStyleForSeries(canvas, chart.data?.datasets?.[0]?.data?.length ?? 0);
    if (!sizes) return;
    try {
        const ds0 = chart.data?.datasets?.[0];
        if (ds0) {
            ds0.pointRadius = sizes.pointRadius;
            ds0.pointHoverRadius = sizes.pointHover;
        }
        chart.update('none');
    } catch (_) {}
}

function renderHostNodeMetricLineChart(canvas, series, dsLabel, lineRgb, yUnit) {
    const isTileMetricChart = canvas?.dataset?.tileCompact === '1';
    const tileVariant = isTileMetricChart ? String(canvas?.dataset?.tileVariant || 'area').toLowerCase() : 'area';
    const seriesForChart =
        !isTileMetricChart && Array.isArray(series) && series.length > 1200
            ? downsampleMetricSeriesEvenly(series, 1200)
            : series;
    const locale = currentLanguage === 'ru' ? 'ru-RU' : 'en-US';
    const labels = seriesForChart.map((p) => new Date(p.t).toLocaleTimeString(locale, { hour: '2-digit', minute: '2-digit', second: '2-digit' }));
    const dataVals = seriesForChart.map((p) => p.v);
    const showAxisTime = canvas?.dataset?.tileAxisTime !== '0';
    const showAxisValues = canvas?.dataset?.tileAxisValues !== '0';
    const showAxisYUnit = canvas?.dataset?.tileAxisYUnit !== '0';
    const yTitleText = (yUnit && String(yUnit).trim()) ? String(yUnit).trim() : '';
    const hideLegend = isTileMetricChart || canvas?.dataset?.upsMetricTile === '1';
    const tilePoints = isTileMetricChart ? getTilesChartPointStyleForSeries(canvas, dataVals.length) : null;
    const dark = typeof document !== 'undefined' && document.body && (
        document.body.classList.contains('dark-mode') ||
        document.body.classList.contains('monitor-theme-dark')
    );
    const tickColor = dark ? '#c8c8c8' : '#495057';
    const gridColor = dark ? 'rgba(255, 255, 255, 0.1)' : 'rgba(0, 0, 0, 0.08)';
    const xTicks = { color: tickColor, display: showAxisTime };
    const yTicks = { color: tickColor, display: showAxisValues };
    const yTitle = {
        display: !!(showAxisYUnit && yTitleText),
        text: yTitleText || yUnit,
        color: tickColor
    };
    const pr = tileVariant === 'minimal'
        ? 0
        : (tilePoints ? tilePoints.pointRadius : (seriesForChart.length === 1 ? 6 : 2));
    const ph = tileVariant === 'minimal' ? 2 : (tilePoints ? tilePoints.pointHover : 4);
    const fillMode = !isTileMetricChart ? true : tileVariant === 'area';
    const lineTension = tileVariant === 'line' || tileVariant === 'minimal' ? 0.12 : 0.2;
    return new Chart(canvas.getContext('2d'), {
        type: 'line',
        data: {
            labels,
            datasets: [{
                label: dsLabel,
                data: dataVals,
                borderColor: `rgb(${lineRgb})`,
                backgroundColor: `rgba(${lineRgb}, 0.12)`,
                fill: fillMode,
                tension: lineTension,
                pointRadius: pr,
                pointHoverRadius: ph
            }]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            resizeDelay: isTileMetricChart ? 120 : 0,
            animation: isTileMetricChart ? false : undefined,
            interaction: { mode: 'index', intersect: false },
            scales: {
                x: {
                    ticks: xTicks,
                    grid: { color: gridColor }
                },
                y: {
                    ticks: yTicks,
                    grid: { color: gridColor },
                    title: yTitle
                }
            },
            plugins: {
                legend: {
                    display: !hideLegend,
                    labels: { color: tickColor }
                }
            }
        }
    });
}

function applyHostNodeMetricSection(suffix, metricKey, series, emptyTextKey, dsLabel, lineRgb, yUnit) {
    const emptyEl = document.getElementById(`hostNodeChart${suffix}Empty`);
    const wrapEl = document.getElementById(`hostNodeChart${suffix}Wrap`);
    const canvas = document.getElementById(`hostNodeChartCanvas${suffix}`);
    if (!canvas) return;
    if (hostNodeMetricCharts[metricKey]) {
        try { hostNodeMetricCharts[metricKey].destroy(); } catch (_) {}
        hostNodeMetricCharts[metricKey] = null;
    }
    if (!series.length) {
        if (emptyEl) {
            emptyEl.textContent = t(emptyTextKey) || '';
            emptyEl.classList.remove('d-none');
        }
        if (wrapEl) wrapEl.classList.add('d-none');
        return;
    }
    if (emptyEl) emptyEl.classList.add('d-none');
    if (wrapEl) wrapEl.classList.remove('d-none');
    hostNodeMetricCharts[metricKey] = renderHostNodeMetricLineChart(canvas, series, dsLabel, lineRgb, yUnit);
}

function setHostNodeMetricSectionsLoading() {
    ['Temp', 'Cpu', 'Mem'].forEach((suffix) => {
        const emptyEl = document.getElementById(`hostNodeChart${suffix}Empty`);
        const wrapEl = document.getElementById(`hostNodeChart${suffix}Wrap`);
        if (emptyEl) {
            emptyEl.textContent = t('hostNodeCpuTempChartLoading') || 'Loading…';
            emptyEl.classList.remove('d-none');
        }
        if (wrapEl) wrapEl.classList.add('d-none');
    });
}

async function openHostNodeAllMetricsModal(nodeName) {
    if (typeof Chart === 'undefined') {
        showToast(t('hostNodeCpuTempChartNoLib') || 'Chart library failed to load', 'warning');
        return;
    }
    if (typeof bootstrap === 'undefined' || !bootstrap.Modal) return;
    const modalEl = document.getElementById('hostNodeAllMetricsModal');
    if (!modalEl) return;

    hostNodeMetricsModalNodeName = String(nodeName || '').trim();
    destroyHostNodeMetricCharts();

    const titleEl = document.getElementById('hostNodeAllMetricsModalTitleText');
    const subEl = document.getElementById('hostNodeAllMetricsModalSubtitle');
    const periodEl = document.getElementById('hostNodeMetricsPeriodSelect');
    const globalErr = document.getElementById('hostNodeAllMetricsGlobalError');
    if (titleEl) titleEl.textContent = t('hostNodeAllMetricsModalTitle') || 'Node metrics';
    if (globalErr) {
        globalErr.textContent = '';
        globalErr.classList.add('d-none');
    }

    const lt = document.getElementById('hostNodeChartSectionLabelTemp');
    if (lt) lt.textContent = t('hostMetricsCpuTempLabel') || 'CPU temp';
    const lc = document.getElementById('hostNodeChartSectionLabelCpu');
    if (lc) lc.textContent = t('hostNodeLoadChartTitle') || 'CPU';
    const lm = document.getElementById('hostNodeChartSectionLabelMem');
    if (lm) lm.textContent = t('hostNodeMemChartTitle') || 'RAM';

    const line1 = tParams('hostNodeCpuTempChartSubtitle', { node: nodeName });
    const hint = t('hostNodeAllMetricsModalHint') || '';
    if (subEl) {
        subEl.innerHTML = `${escapeHtml(line1)}${hint ? `<br><span class="text-muted">${escapeHtml(hint)}</span>` : ''}`;
    }
    if (periodEl) {
        periodEl.value = String(normalizeChartWindowMinutes(hostNodeMetricsModalWindowMin, 1440));
        periodEl.onchange = () => {
            hostNodeMetricsModalWindowMin = normalizeChartWindowMinutes(periodEl.value, 1440);
            if (hostNodeMetricsModalNodeName) void openHostNodeAllMetricsModal(hostNodeMetricsModalNodeName);
        };
    }

    setHostNodeMetricSectionsLoading();

    const modal = bootstrap.Modal.getOrCreateInstance(modalEl);
    modal.show();

    const headers = getCurrentProxmoxHeaders();
    if (!headers) {
        if (globalErr) {
            globalErr.textContent = t('hostMetricsNeedConnection') || 'Connect to Proxmox first.';
            globalErr.classList.remove('d-none');
        }
        ['Temp', 'Cpu', 'Mem'].forEach((suffix) => {
            const emptyEl = document.getElementById(`hostNodeChart${suffix}Empty`);
            if (emptyEl) emptyEl.classList.add('d-none');
        });
        return;
    }

    let tempPts = [];
    let cpuPts = [];
    let memPts = [];
    try {
        const base = `/api/host-metrics/node-metric-history?node=${encodeURIComponent(nodeName)}&metric=`;
        const [rt, rc, rm] = await Promise.all([
            fetch(base + 'temp', { headers }),
            fetch(base + 'cpu', { headers }),
            fetch(base + 'mem', { headers })
        ]);
        const [dt, dc, dm] = await Promise.all([
            rt.json().catch(() => ({})),
            rc.json().catch(() => ({})),
            rm.json().catch(() => ({}))
        ]);
        if (!rt.ok) throw new Error(dt.error || `temp: HTTP ${rt.status}`);
        if (!rc.ok) throw new Error(dc.error || `cpu: HTTP ${rc.status}`);
        if (!rm.ok) throw new Error(dm.error || `mem: HTTP ${rm.status}`);
        tempPts = filterSeriesByWindowMinutes(parseMetricHistoryPoints(dt.points), hostNodeMetricsModalWindowMin);
        cpuPts = filterSeriesByWindowMinutes(parseMetricHistoryPoints(dc.points), hostNodeMetricsModalWindowMin);
        memPts = filterSeriesByWindowMinutes(parseMetricHistoryPoints(dm.points), hostNodeMetricsModalWindowMin);
    } catch (e) {
        const msg = (e && e.message) ? e.message : String(e);
        if (globalErr) {
            globalErr.textContent = (t('hostNodeCpuTempChartLoadError') || '{msg}').replace('{msg}', msg);
            globalErr.classList.remove('d-none');
        }
        ['Temp', 'Cpu', 'Mem'].forEach((suffix) => {
            const emptyEl = document.getElementById(`hostNodeChart${suffix}Empty`);
            if (emptyEl) emptyEl.classList.add('d-none');
            const wrapEl = document.getElementById(`hostNodeChart${suffix}Wrap`);
            if (wrapEl) wrapEl.classList.add('d-none');
        });
        return;
    }

    applyHostNodeMetricSection(
        'Temp',
        'temp',
        tempPts,
        'hostNodeCpuTempChartEmpty',
        t('hostMetricsCpuTempLabel') || 'CPU temp',
        '13, 110, 253',
        '°C'
    );
    applyHostNodeMetricSection(
        'Cpu',
        'cpu',
        cpuPts,
        'hostNodeMetricChartEmptyLoadMem',
        t('nodeCpu') || 'CPU',
        '220, 53, 69',
        '%'
    );
    applyHostNodeMetricSection(
        'Mem',
        'mem',
        memPts,
        'hostNodeMetricChartEmptyLoadMem',
        t('nodeRam') || 'RAM',
        '102, 16, 242',
        '%'
    );

    requestAnimationFrame(() => {
        ['temp', 'cpu', 'mem'].forEach((k) => {
            const ch = hostNodeMetricCharts[k];
            if (ch) {
                try { ch.resize(); } catch (_) {}
            }
        });
    });
}

function initHostNodeMetricChartsOnce() {
    if (initHostNodeMetricChartsOnce._done) return;
    initHostNodeMetricChartsOnce._done = true;
    const openFromEvent = (e) => {
        if (e.target.closest && e.target.closest('.host-problem-trigger')) return null;
        const card = e.target.closest('.host-node-card-chart-trigger');
        if (!card) return null;
        return card.getAttribute('data-node');
    };
    document.addEventListener('click', (e) => {
        const node = openFromEvent(e);
        if (node) void openHostNodeAllMetricsModal(node);
    });
    document.addEventListener('keydown', (e) => {
        if (e.key !== 'Enter' && e.key !== ' ') return;
        const node = openFromEvent(e);
        if (!node) return;
        e.preventDefault();
        void openHostNodeAllMetricsModal(node);
    });
    const modalEl = document.getElementById('hostNodeAllMetricsModal');
    if (modalEl) {
        modalEl.addEventListener('hidden.bs.modal', () => destroyHostNodeMetricCharts());
    }
}

function applyClusterAggregateMetricSection(suffix, metricKey, series, emptyTextKey, dsLabel, lineRgb, yUnit) {
    const emptyEl = document.getElementById(`clusterAggChart${suffix}Empty`);
    const wrapEl = document.getElementById(`clusterAggChart${suffix}Wrap`);
    const canvas = document.getElementById(`clusterAggChartCanvas${suffix}`);
    if (!canvas) return;
    if (clusterAggregateMetricCharts[metricKey]) {
        try { clusterAggregateMetricCharts[metricKey].destroy(); } catch (_) {}
        clusterAggregateMetricCharts[metricKey] = null;
    }
    if (!series.length) {
        if (emptyEl) {
            emptyEl.textContent = t(emptyTextKey) || '';
            emptyEl.classList.remove('d-none');
        }
        if (wrapEl) wrapEl.classList.add('d-none');
        return;
    }
    if (emptyEl) emptyEl.classList.add('d-none');
    if (wrapEl) wrapEl.classList.remove('d-none');
    clusterAggregateMetricCharts[metricKey] = renderHostNodeMetricLineChart(canvas, series, dsLabel, lineRgb, yUnit);
}

function setClusterAggregateSectionsLoading() {
    ['Cpu', 'Mem'].forEach((suffix) => {
        const emptyEl = document.getElementById(`clusterAggChart${suffix}Empty`);
        const wrapEl = document.getElementById(`clusterAggChart${suffix}Wrap`);
        if (emptyEl) {
            emptyEl.textContent = t('hostNodeCpuTempChartLoading') || 'Loading…';
            emptyEl.classList.remove('d-none');
        }
        if (wrapEl) wrapEl.classList.add('d-none');
    });
}

function stopClusterAggregateChartsAutoRefresh() {
    if (clusterAggregateChartsAutoRefreshTimer) {
        clearInterval(clusterAggregateChartsAutoRefreshTimer);
        clusterAggregateChartsAutoRefreshTimer = null;
    }
}

function startClusterAggregateChartsAutoRefresh(modalEl) {
    stopClusterAggregateChartsAutoRefresh();
    if (!modalEl) return;
    const intervalMs = Math.max(5000, refreshIntervalMs || 30000);
    clusterAggregateChartsAutoRefreshTimer = setInterval(() => {
        // Bootstrap adds `show` while modal is visible.
        if (!modalEl.classList.contains('show')) {
            stopClusterAggregateChartsAutoRefresh();
            return;
        }
        void refreshClusterAggregateChartsData({ showLoading: false });
    }, intervalMs);
}

async function refreshClusterAggregateChartsData({ showLoading } = { showLoading: false }) {
    if (clusterAggregateChartsAutoRefreshBusy) return false;
    clusterAggregateChartsAutoRefreshBusy = true;

    const globalErr = document.getElementById('clusterAggregateMetricsGlobalError');
    try {
        const headers = getCurrentProxmoxHeaders();
        if (!headers) {
            if (globalErr) {
                globalErr.textContent = t('hostMetricsNeedConnection') || 'Connect to Proxmox first.';
                globalErr.classList.remove('d-none');
            }
            return false;
        }

        if (globalErr) {
            globalErr.textContent = '';
            globalErr.classList.add('d-none');
        }
        if (showLoading) setClusterAggregateSectionsLoading();

        const base = `/api/cluster/metric-history?metric=`;
        const [rc, rm] = await Promise.all([
            fetch(base + 'cpu', { headers }),
            fetch(base + 'mem', { headers })
        ]);
        const [dc, dm] = await Promise.all([
            rc.json().catch(() => ({})),
            rm.json().catch(() => ({}))
        ]);
        if (!rc.ok) throw new Error(dc.error || `cpu: HTTP ${rc.status}`);
        if (!rm.ok) throw new Error(dm.error || `mem: HTTP ${rm.status}`);

        const cpuPts = filterSeriesByWindowMinutes(parseMetricHistoryPoints(dc.points), clusterAggregateMetricsModalWindowMin);
        const memPts = filterSeriesByWindowMinutes(parseMetricHistoryPoints(dm.points), clusterAggregateMetricsModalWindowMin);

        applyClusterAggregateMetricSection(
            'Cpu',
            'cpu',
            cpuPts,
            'clusterAggregateMetricChartEmpty',
            t('clusterAggregateCpuChartTitle') || 'Cluster CPU',
            '220, 53, 69',
            '%'
        );
        applyClusterAggregateMetricSection(
            'Mem',
            'mem',
            memPts,
            'clusterAggregateMetricChartEmpty',
            t('clusterAggregateMemChartTitle') || 'Cluster RAM',
            '102, 16, 242',
            '%'
        );

        requestAnimationFrame(() => {
            ['cpu', 'mem'].forEach((k) => {
                const ch = clusterAggregateMetricCharts[k];
                if (ch) {
                    try { ch.resize(); } catch (_) {}
                }
            });
        });
        return true;
    } catch (e) {
        const msg = (e && e.message) ? e.message : String(e);
        if (globalErr) {
            globalErr.textContent = (t('hostNodeCpuTempChartLoadError') || '{msg}').replace('{msg}', msg);
            globalErr.classList.remove('d-none');
        }
        ['Cpu', 'Mem'].forEach((suffix) => {
            const emptyEl = document.getElementById(`clusterAggChart${suffix}Empty`);
            if (emptyEl) emptyEl.classList.add('d-none');
            const wrapEl = document.getElementById(`clusterAggChart${suffix}Wrap`);
            if (wrapEl) wrapEl.classList.add('d-none');
        });
        return false;
    } finally {
        clusterAggregateChartsAutoRefreshBusy = false;
    }
}

async function openClusterAggregateMetricsModal() {
    if (!getAuthHeadersForType('proxmox')) return;
    if (typeof Chart === 'undefined') {
        showToast(t('hostNodeCpuTempChartNoLib') || 'Chart library failed to load', 'warning');
        return;
    }
    if (typeof bootstrap === 'undefined' || !bootstrap.Modal) return;
    const modalEl = document.getElementById('clusterAggregateMetricsModal');
    if (!modalEl) return;

    destroyClusterAggregateMetricCharts();

    const titleEl = document.getElementById('clusterAggregateMetricsModalTitleText');
    const subEl = document.getElementById('clusterAggregateMetricsModalSubtitle');
    const periodEl = document.getElementById('clusterAggregateMetricsPeriodSelect');
    const globalErr = document.getElementById('clusterAggregateMetricsGlobalError');
    if (titleEl) titleEl.textContent = t('clusterAggregateMetricsModalTitle') || 'Cluster metrics';
    if (globalErr) {
        globalErr.textContent = '';
        globalErr.classList.add('d-none');
    }

    const lc = document.getElementById('clusterAggChartSectionLabelCpu');
    if (lc) lc.textContent = t('clusterAggregateCpuChartTitle') || 'Cluster CPU';
    const lm = document.getElementById('clusterAggChartSectionLabelMem');
    if (lm) lm.textContent = t('clusterAggregateMemChartTitle') || 'Cluster RAM';

    const hint = t('clusterAggregateMetricsModalHint') || '';
    if (subEl) {
        subEl.innerHTML = hint ? `<span class="text-muted">${escapeHtml(hint)}</span>` : '';
    }
    if (periodEl) {
        periodEl.value = String(normalizeChartWindowMinutes(clusterAggregateMetricsModalWindowMin, 1440));
        periodEl.onchange = () => {
            clusterAggregateMetricsModalWindowMin = normalizeChartWindowMinutes(periodEl.value, 1440);
            void refreshClusterAggregateChartsData({ showLoading: true });
        };
    }

    setClusterAggregateSectionsLoading();

    const modal = bootstrap.Modal.getOrCreateInstance(modalEl);
    modal.show();

    stopClusterAggregateChartsAutoRefresh();
    const ok = await refreshClusterAggregateChartsData({ showLoading: true });
    if (ok) startClusterAggregateChartsAutoRefresh(modalEl);
}

function initClusterAggregateChartsOnce() {
    if (initClusterAggregateChartsOnce._done) return;
    initClusterAggregateChartsOnce._done = true;
    const clusterBody = document.getElementById('clusterResourcesCardBody');
    if (clusterBody) {
        clusterBody.addEventListener('click', () => {
            if (!getAuthHeadersForType('proxmox')) return;
            void openClusterAggregateMetricsModal();
        });
        clusterBody.addEventListener('keydown', (e) => {
            if (e.key !== 'Enter' && e.key !== ' ') return;
            if (!getAuthHeadersForType('proxmox')) return;
            e.preventDefault();
            void openClusterAggregateMetricsModal();
        });
    }
    const modalEl = document.getElementById('clusterAggregateMetricsModal');
    if (modalEl) {
        modalEl.addEventListener('hidden.bs.modal', () => {
            stopClusterAggregateChartsAutoRefresh();
            destroyClusterAggregateMetricCharts();
        });
    }
    syncClusterResourcesCardInteractivity();
}

function destroyUpsMetricsModalChart() {
    if (upsMetricsChart) {
        try { upsMetricsChart.destroy(); } catch (_) {}
        upsMetricsChart = null;
    }
}

function stopUpsMetricsModalAutoRefresh() {
    if (upsMetricsModalAutoRefreshTimer) {
        clearInterval(upsMetricsModalAutoRefreshTimer);
        upsMetricsModalAutoRefreshTimer = null;
    }
}

function upsMetricYUnitFromFormat(metricFormat) {
    const mf = String(metricFormat || '').trim().toLowerCase();
    if (mf === 'percent') return '%';
    if (mf === 'voltage') return 'V';
    if (mf === 'watt') return 'W';
    if (mf === 'frequency') return 'Hz';
    if (mf === 'time') return 'h';
    return '';
}

function upsMetricColorFromFormat(metricFormat) {
    const mf = String(metricFormat || '').trim().toLowerCase();
    if (mf === 'percent') return '13, 110, 253';
    if (mf === 'voltage') return '0, 123, 255';
    if (mf === 'watt') return '255, 193, 7';
    if (mf === 'frequency') return '108, 117, 125';
    if (mf === 'time') return '126, 87, 194';
    return '13, 110, 253';
}

function setUpsMetricsChartLoading() {
    const emptyEl = document.getElementById('upsMetricsChartEmpty');
    const wrapEl = document.getElementById('upsMetricsChartWrap');
    if (emptyEl) {
        emptyEl.textContent = t('hostNodeCpuTempChartLoading') || 'Loading…';
        emptyEl.classList.remove('d-none');
    }
    if (wrapEl) wrapEl.classList.add('d-none');
    const globalErr = document.getElementById('upsAllMetricsGlobalError');
    if (globalErr) globalErr.classList.add('d-none');
}

async function refreshUpsMetricsModalChart({ showLoading = false } = {}) {
    if (upsMetricsModalAutoRefreshBusy) return false;
    if (!upsMetricsModalSlot || !upsMetricsModalMetricId) return false;

    const emptyEl = document.getElementById('upsMetricsChartEmpty');
    const wrapEl = document.getElementById('upsMetricsChartWrap');
    const canvas = document.getElementById('upsMetricsChartCanvas');
    const globalErr = document.getElementById('upsAllMetricsGlobalError');

    if (!canvas) return false;

    if (showLoading) setUpsMetricsChartLoading();

    upsMetricsModalAutoRefreshBusy = true;
    try {
        const headers = {}; // UPS endpoints don't require auth middleware
        const url = `/api/ups/metric-history?slot=${encodeURIComponent(upsMetricsModalSlot)}&metric=${encodeURIComponent(upsMetricsModalMetricId)}`;
        const r = await fetch(url, { headers });
        const data = await r.json().catch(() => ({}));
        if (!r.ok) throw new Error(data?.error || `HTTP ${r.status}`);

        const points = filterSeriesByWindowMinutes(parseMetricHistoryPoints(data.points), upsMetricsModalWindowMin);
        upsMetricsModalMetricFormat = data.metricFormat || upsMetricsModalMetricFormat || null;

        if (!Array.isArray(points) || !points.length) {
            if (globalErr) globalErr.classList.add('d-none');
            if (emptyEl) {
                emptyEl.textContent = t('upsAllMetricsChartEmpty') || 'No samples in the last 24 hours yet.';
                emptyEl.classList.remove('d-none');
            }
            if (wrapEl) wrapEl.classList.add('d-none');
            destroyUpsMetricsModalChart();
            return true;
        }

        if (emptyEl) emptyEl.classList.add('d-none');
        if (wrapEl) wrapEl.classList.remove('d-none');

        // Convert chart value for runtime:
        const metricFormat = upsMetricsModalMetricFormat;
        const conv = metricFormat === 'time';
        const yUnit = upsMetricYUnitFromFormat(metricFormat);
        const lineRgb = upsMetricColorFromFormat(metricFormat);
        const series = conv
            ? points.map((p) => ({ t: p.t, v: p.v / 3600 })) // seconds -> hours
            : points;

        const selectEl = document.getElementById('upsMetricsMetricSelect');
        const dsLabel =
            selectEl && selectEl.selectedIndex >= 0 && selectEl.options[selectEl.selectedIndex]
                ? selectEl.options[selectEl.selectedIndex].textContent
                : upsMetricsModalMetricId;

        destroyUpsMetricsModalChart();
        upsMetricsChart = renderHostNodeMetricLineChart(canvas, series, dsLabel, lineRgb, yUnit);
        requestAnimationFrame(() => {
            try { upsMetricsChart?.resize(); } catch (_) {}
        });
        return true;
    } catch (e) {
        const msg = (e && e.message) ? e.message : String(e);
        if (globalErr) {
            globalErr.textContent = (t('hostNodeCpuTempChartLoadError') || '{msg}').replace('{msg}', msg);
            globalErr.classList.remove('d-none');
        }
        if (emptyEl) emptyEl.classList.add('d-none');
        if (wrapEl) wrapEl.classList.add('d-none');
        destroyUpsMetricsModalChart();
        return false;
    } finally {
        upsMetricsModalAutoRefreshBusy = false;
    }
}

function startUpsMetricsModalAutoRefresh(modalEl) {
    stopUpsMetricsModalAutoRefresh();
    if (!modalEl) return;
    const intervalMs = Math.max(5000, refreshIntervalMs || 30000);
    upsMetricsModalAutoRefreshTimer = setInterval(() => {
        if (!modalEl.classList.contains('show')) {
            stopUpsMetricsModalAutoRefresh();
            return;
        }
        void refreshUpsMetricsModalChart({ showLoading: false });
    }, intervalMs);
}

async function openUpsAllMetricsModal(upsSlot) {
    if (typeof Chart === 'undefined') {
        showToast(t('hostNodeCpuTempChartNoLib') || 'Chart library failed to load', 'warning');
        return;
    }
    if (typeof bootstrap === 'undefined' || !bootstrap.Modal) return;
    const modalEl = document.getElementById('upsAllMetricsModal');
    if (!modalEl) return;

    const slot = Number.parseInt(String(upsSlot), 10);
    if (!Number.isFinite(slot) || slot < 1 || slot > 4) return;

    upsMetricsModalSlot = slot;
    upsMetricsModalMetricId = null;
    upsMetricsModalMetricFormat = null;

    destroyUpsMetricsModalChart();
    stopUpsMetricsModalAutoRefresh();

    const titleEl = document.getElementById('upsAllMetricsModalTitleText');
    const subtitleEl = document.getElementById('upsAllMetricsModalSubtitle');
    const periodEl = document.getElementById('upsMetricsPeriodSelect');
    const metricLabelEl = document.getElementById('upsMetricsMetricSelectLabel');
    const globalErr = document.getElementById('upsAllMetricsGlobalError');
    if (titleEl) titleEl.textContent = t('upsAllMetricsModalTitle') || 'UPS metrics';
    if (subtitleEl) {
        subtitleEl.textContent = t('upsAllMetricsModalHint') || 'History stored up to 24 hours.';
    }
    if (metricLabelEl) {
        metricLabelEl.textContent = t('upsAllMetricsMetricSelectLabel') || 'Metric';
    }
    if (globalErr) {
        globalErr.textContent = '';
        globalErr.classList.add('d-none');
    }
    if (periodEl) {
        periodEl.value = String(normalizeChartWindowMinutes(upsMetricsModalWindowMin, 1440));
        periodEl.onchange = () => {
            upsMetricsModalWindowMin = normalizeChartWindowMinutes(periodEl.value, 1440);
            void refreshUpsMetricsModalChart({ showLoading: true });
        };
    }

    const selectEl = document.getElementById('upsMetricsMetricSelect');
    if (!selectEl) return;
    selectEl.innerHTML = '';

    setUpsMetricsChartLoading();

    // Load available numeric fields for this UPS slot.
    let currentData = null;
    try {
        const r = await fetch('/api/ups/current');
        currentData = await r.json();
        if (!r.ok) throw new Error(currentData?.error || `HTTP ${r.status}`);
    } catch (e) {
        const msg = (e && e.message) ? e.message : String(e);
        if (globalErr) {
            globalErr.textContent = (t('hostNodeCpuTempChartLoadError') || '{msg}').replace('{msg}', msg);
            globalErr.classList.remove('d-none');
        }
        return;
    }

    const item = Array.isArray(currentData?.items)
        ? currentData.items.find((x) => Number.parseInt(String(x.slot), 10) === slot) || null
        : null;
    const fields = Array.isArray(item?.fields) ? item.fields : [];
    const numericFormats = new Set(['percent', 'number', 'voltage', 'watt', 'frequency', 'time']);
    const numericFields = fields.filter((f) => f && numericFormats.has(String(f.format || '').toLowerCase()) && String(f.id || '').trim());

    if (!numericFields.length) {
        if (globalErr) {
            globalErr.textContent = t('upsAllMetricsChartEmpty') || 'No numeric fields configured for this UPS.';
            globalErr.classList.remove('d-none');
        }
        return;
    }

    // Build metric select
    for (const f of numericFields) {
        const metricId = String(f.id || '').trim();
        const label = String(f.label || '').trim() || upsSemanticOptionLabel(metricId);
        const opt = document.createElement('option');
        opt.value = metricId;
        opt.textContent = label;
        selectEl.appendChild(opt);
    }

    const defaultMetric = numericFields.find((f) => String(f.id) === 'charge')
        || numericFields[0];
    upsMetricsModalMetricId = String(defaultMetric?.id || '').trim();
    selectEl.value = upsMetricsModalMetricId;

    selectEl.onchange = () => {
        upsMetricsModalMetricId = selectEl.value;
        void refreshUpsMetricsModalChart({ showLoading: true });
    };

    // Initial chart load, then start auto refresh.
    const ok = await refreshUpsMetricsModalChart({ showLoading: true });
    if (!ok) {
        // still open modal, user will see error/empty
    }

    const modal = bootstrap.Modal.getOrCreateInstance(modalEl);
    modal.show();
    startUpsMetricsModalAutoRefresh(modalEl);
}

function initUpsAllMetricsModalOnce() {
    if (initUpsAllMetricsModalOnce._done) return;
    initUpsAllMetricsModalOnce._done = true;

    const cardsEl = document.getElementById('upsMonitorCards');
    if (cardsEl) {
        cardsEl.addEventListener('click', (e) => {
            const card = e.target.closest('.ups-metrics-open-trigger');
            if (!card) return;
            const slot = card.getAttribute('data-ups-slot');
            if (slot) void openUpsAllMetricsModal(slot);
        });
        cardsEl.addEventListener('keydown', (e) => {
            if (e.key !== 'Enter' && e.key !== ' ') return;
            const card = e.target.closest('.ups-metrics-open-trigger');
            if (!card || !cardsEl.contains(card)) return;
            e.preventDefault();
            const slot = card.getAttribute('data-ups-slot');
            if (slot) void openUpsAllMetricsModal(slot);
        });
    }

    const modalEl = document.getElementById('upsAllMetricsModal');
    if (modalEl) {
        modalEl.addEventListener('hidden.bs.modal', () => {
            stopUpsMetricsModalAutoRefresh();
            destroyUpsMetricsModalChart();
        });
    }
}

function destroySmartSensorsMetricsModalChart() {
    if (smartSensorsMetricsChart) {
        try { smartSensorsMetricsChart.destroy(); } catch (_) {}
        smartSensorsMetricsChart = null;
    }
}

function stopSmartSensorsMetricsModalAutoRefresh() {
    if (smartSensorsMetricsModalAutoRefreshTimer) {
        clearInterval(smartSensorsMetricsModalAutoRefreshTimer);
        smartSensorsMetricsModalAutoRefreshTimer = null;
    }
}

function smartSensorMetricMetaFromFieldKey(fieldKey) {
    const fk = String(fieldKey || '').trim().toLowerCase();
    if (fk.includes('temp')) return { unit: '°C', color: '220, 53, 69' };
    if (fk.includes('hum')) return { unit: '%', color: '13, 110, 253' };
    if (fk.includes('press')) return { unit: 'hPa', color: '108, 117, 125' };
    if (fk.includes('batt')) return { unit: '%', color: '25, 135, 84' };
    return { unit: '', color: '13, 110, 253' };
}

function setSmartSensorsMetricsChartLoading() {
    const emptyEl = document.getElementById('smartSensorsMetricsChartEmpty');
    const wrapEl = document.getElementById('smartSensorsMetricsChartWrap');
    if (emptyEl) {
        emptyEl.textContent = t('hostNodeCpuTempChartLoading') || 'Loading…';
        emptyEl.classList.remove('d-none');
    }
    if (wrapEl) wrapEl.classList.add('d-none');
    const globalErr = document.getElementById('smartSensorsAllMetricsGlobalError');
    if (globalErr) globalErr.classList.add('d-none');
}

async function refreshSmartSensorsMetricsModalChart({ showLoading = false } = {}) {
    if (smartSensorsMetricsModalAutoRefreshBusy) return false;
    if (!smartSensorsMetricsModalSensorId || !smartSensorsMetricsModalFieldKey) return false;

    const emptyEl = document.getElementById('smartSensorsMetricsChartEmpty');
    const wrapEl = document.getElementById('smartSensorsMetricsChartWrap');
    const canvas = document.getElementById('smartSensorsMetricsChartCanvas');
    const globalErr = document.getElementById('smartSensorsAllMetricsGlobalError');

    if (!canvas) return false;
    if (showLoading) setSmartSensorsMetricsChartLoading();

    smartSensorsMetricsModalAutoRefreshBusy = true;
    try {
        const url = `/api/smart-sensors/metric-history?sensorId=${encodeURIComponent(smartSensorsMetricsModalSensorId)}&field=${encodeURIComponent(smartSensorsMetricsModalFieldKey)}`;
        const r = await fetch(url);
        const data = await r.json().catch(() => ({}));
        if (!r.ok) throw new Error(data?.error || `HTTP ${r.status}`);

        const points = filterSeriesByWindowMinutes(parseMetricHistoryPoints(data.points), smartSensorsMetricsModalWindowMin);
        if (!Array.isArray(points) || !points.length) {
            if (globalErr) globalErr.classList.add('d-none');
            if (emptyEl) {
                emptyEl.textContent = t('smartSensorMetricChartEmpty') || (t('upsAllMetricsChartEmpty') || 'No samples in the last 24 hours yet.');
                emptyEl.classList.remove('d-none');
            }
            if (wrapEl) wrapEl.classList.add('d-none');
            destroySmartSensorsMetricsModalChart();
            return true;
        }

        if (emptyEl) emptyEl.classList.add('d-none');
        if (wrapEl) wrapEl.classList.remove('d-none');

        const meta = smartSensorMetricMetaFromFieldKey(smartSensorsMetricsModalFieldKey);
        const selectEl = document.getElementById('smartSensorsMetricsMetricSelect');
        const dsLabel = (selectEl && selectEl.selectedIndex >= 0 && selectEl.options[selectEl.selectedIndex])
            ? selectEl.options[selectEl.selectedIndex].textContent
            : smartSensorsMetricsModalFieldKey;

        destroySmartSensorsMetricsModalChart();
        smartSensorsMetricsChart = renderHostNodeMetricLineChart(canvas, points, dsLabel, meta.color, meta.unit);
        requestAnimationFrame(() => {
            try { smartSensorsMetricsChart?.resize(); } catch (_) {}
        });
        return true;
    } catch (e) {
        const msg = (e && e.message) ? e.message : String(e);
        if (globalErr) {
            globalErr.textContent = (t('hostNodeCpuTempChartLoadError') || '{msg}').replace('{msg}', msg);
            globalErr.classList.remove('d-none');
        }
        if (emptyEl) emptyEl.classList.add('d-none');
        if (wrapEl) wrapEl.classList.add('d-none');
        destroySmartSensorsMetricsModalChart();
        return false;
    } finally {
        smartSensorsMetricsModalAutoRefreshBusy = false;
    }
}

function startSmartSensorsMetricsModalAutoRefresh(modalEl) {
    stopSmartSensorsMetricsModalAutoRefresh();
    if (!modalEl) return;
    const intervalMs = Math.max(5000, refreshIntervalMs || 30000);
    smartSensorsMetricsModalAutoRefreshTimer = setInterval(() => {
        if (!modalEl.classList.contains('show')) {
            stopSmartSensorsMetricsModalAutoRefresh();
            return;
        }
        void refreshSmartSensorsMetricsModalChart({ showLoading: false });
    }, intervalMs);
}

async function openSmartSensorsAllMetricsModal(sensorId) {
    if (typeof Chart === 'undefined') {
        showToast(t('hostNodeCpuTempChartNoLib') || 'Chart library failed to load', 'warning');
        return;
    }
    if (typeof bootstrap === 'undefined' || !bootstrap.Modal) return;
    const modalEl = document.getElementById('smartSensorsAllMetricsModal');
    if (!modalEl) return;
    const sensorIdNorm = String(sensorId || '').trim();
    if (!sensorIdNorm) return;

    smartSensorsMetricsModalSensorId = sensorIdNorm;
    smartSensorsMetricsModalFieldKey = null;
    destroySmartSensorsMetricsModalChart();
    stopSmartSensorsMetricsModalAutoRefresh();

    const titleEl = document.getElementById('smartSensorsAllMetricsModalTitleText');
    const subtitleEl = document.getElementById('smartSensorsAllMetricsModalSubtitle');
    const periodEl = document.getElementById('smartSensorsMetricsPeriodSelect');
    const metricLabelEl = document.getElementById('smartSensorsMetricsMetricSelectLabel');
    const globalErr = document.getElementById('smartSensorsAllMetricsGlobalError');
    if (titleEl) titleEl.textContent = t('smartSensorsAllMetricsModalTitle') || 'Smart sensor metrics';
    if (subtitleEl) subtitleEl.textContent = t('smartSensorsAllMetricsModalHint') || (t('smartSensorMetricChartFooter') || 'History stored up to 24 hours.');
    if (metricLabelEl) metricLabelEl.textContent = t('smartSensorsAllMetricsMetricSelectLabel') || (t('upsAllMetricsMetricSelectLabel') || 'Metric');
    if (globalErr) {
        globalErr.textContent = '';
        globalErr.classList.add('d-none');
    }
    if (periodEl) {
        periodEl.value = String(normalizeChartWindowMinutes(smartSensorsMetricsModalWindowMin, 1440));
        periodEl.onchange = () => {
            smartSensorsMetricsModalWindowMin = normalizeChartWindowMinutes(periodEl.value, 1440);
            void refreshSmartSensorsMetricsModalChart({ showLoading: true });
        };
    }

    const selectEl = document.getElementById('smartSensorsMetricsMetricSelect');
    if (!selectEl) return;
    selectEl.innerHTML = '';
    setSmartSensorsMetricsChartLoading();

    let currentData = null;
    try {
        const r = await fetch('/api/smart-sensors/current');
        currentData = await r.json();
        if (!r.ok) throw new Error(currentData?.error || `HTTP ${r.status}`);
    } catch (e) {
        const msg = (e && e.message) ? e.message : String(e);
        if (globalErr) {
            globalErr.textContent = (t('hostNodeCpuTempChartLoadError') || '{msg}').replace('{msg}', msg);
            globalErr.classList.remove('d-none');
        }
        return;
    }

    const item = Array.isArray(currentData?.items)
        ? currentData.items.find((x) => String(x?.id || '').trim() === sensorIdNorm) || null
        : null;
    if (!item) {
        if (globalErr) {
            globalErr.textContent = t('smartSensorsNotConfigured') || 'Sensor not found';
            globalErr.classList.remove('d-none');
        }
        return;
    }
    const vals = item.values && typeof item.values === 'object' ? item.values : {};
    const numericFields = Object.keys(vals)
        .map((k) => ({ key: String(k), v: Number(vals?.[k]?.value) }))
        .filter((x) => Number.isFinite(x.v));

    if (!numericFields.length) {
        if (globalErr) {
            globalErr.textContent = t('smartSensorMetricChartEmpty') || (t('upsAllMetricsChartEmpty') || 'No samples in the last 24 hours yet.');
            globalErr.classList.remove('d-none');
        }
        return;
    }

    for (const f of numericFields) {
        const opt = document.createElement('option');
        opt.value = f.key;
        opt.textContent = f.key;
        selectEl.appendChild(opt);
    }
    const preferred = numericFields.find((f) => String(f.key).toLowerCase().includes('temp')) || numericFields[0];
    smartSensorsMetricsModalFieldKey = preferred.key;
    selectEl.value = smartSensorsMetricsModalFieldKey;
    selectEl.onchange = () => {
        smartSensorsMetricsModalFieldKey = selectEl.value;
        void refreshSmartSensorsMetricsModalChart({ showLoading: true });
    };

    await refreshSmartSensorsMetricsModalChart({ showLoading: true });
    const modal = bootstrap.Modal.getOrCreateInstance(modalEl);
    modal.show();
    startSmartSensorsMetricsModalAutoRefresh(modalEl);
}

function initSmartSensorsAllMetricsModalOnce() {
    if (initSmartSensorsAllMetricsModalOnce._done) return;
    initSmartSensorsAllMetricsModalOnce._done = true;
    const cardsEl = document.getElementById('smartSensorsMonitorCards');
    if (cardsEl) {
        cardsEl.addEventListener('click', (e) => {
            const btBtn = e.target.closest('.smart-sensor-bt-connect-trigger');
            if (btBtn) {
                const btSensorId = btBtn.getAttribute('data-smart-sensor-id');
                if (!btSensorId) return;
                connectWebBleSensorById(btSensorId)
                    .then(() => {
                        showToast(t('smartSensorsBtConnected') || 'Bluetooth sensor connected', 'success');
                        return updateSmartSensorsDashboard();
                    })
                    .catch((err) => {
                        showToast((t('smartSensorsBtConnectError') || 'Bluetooth connection error') + ': ' + (err?.message || String(err)), 'error');
                    });
                return;
            }
            const btn = e.target.closest('.smart-sensor-metrics-open-trigger');
            if (!btn) return;
            const sensorId = btn.getAttribute('data-smart-sensor-id');
            if (sensorId) void openSmartSensorsAllMetricsModal(sensorId);
        });
        cardsEl.addEventListener('keydown', (e) => {
            if (e.key !== 'Enter' && e.key !== ' ') return;
            const btBtn = e.target.closest('.smart-sensor-bt-connect-trigger');
            if (btBtn && cardsEl.contains(btBtn)) {
                e.preventDefault();
                const btSensorId = btBtn.getAttribute('data-smart-sensor-id');
                if (!btSensorId) return;
                connectWebBleSensorById(btSensorId)
                    .then(() => {
                        showToast(t('smartSensorsBtConnected') || 'Bluetooth sensor connected', 'success');
                        return updateSmartSensorsDashboard();
                    })
                    .catch((err) => {
                        showToast((t('smartSensorsBtConnectError') || 'Bluetooth connection error') + ': ' + (err?.message || String(err)), 'error');
                    });
                return;
            }
            const btn = e.target.closest('.smart-sensor-metrics-open-trigger');
            if (!btn || !cardsEl.contains(btn)) return;
            e.preventDefault();
            const sensorId = btn.getAttribute('data-smart-sensor-id');
            if (sensorId) void openSmartSensorsAllMetricsModal(sensorId);
        });
    }
    const modalEl = document.getElementById('smartSensorsAllMetricsModal');
    if (modalEl) {
        modalEl.addEventListener('hidden.bs.modal', () => {
            stopSmartSensorsMetricsModalAutoRefresh();
            destroySmartSensorsMetricsModalChart();
        });
    }
}

function initHostMetricProblemPopovers() {
    if (typeof bootstrap === 'undefined' || !bootstrap || !bootstrap.Popover) return;
    document.querySelectorAll('.host-problem-trigger').forEach((el) => {
        const existing = bootstrap.Popover.getInstance(el);
        if (existing) existing.dispose();
        if (el._hostProblemPopoverOnShown) {
            el.removeEventListener('shown.bs.popover', el._hostProblemPopoverOnShown);
            el.removeEventListener('hide.bs.popover', el._hostProblemPopoverOnHide);
            el._hostProblemPopoverOnShown = null;
            el._hostProblemPopoverOnHide = null;
        }
        if (el._hostProblemPopoverTimer) {
            clearTimeout(el._hostProblemPopoverTimer);
            el._hostProblemPopoverTimer = null;
        }
        const raw = String(el.getAttribute('data-problem-lines') || '').trim();
        if (!raw) return;
        const lines = raw.split('\n').map((x) => x.trim()).filter(Boolean);
        if (!lines.length) return;
        const content = `<ul class="mb-0 ps-3">${lines.map((line) => `<li>${escapeHtml(line)}</li>`).join('')}</ul>`;
        const popover = bootstrap.Popover.getOrCreateInstance(el, {
            trigger: 'click focus',
            placement: 'bottom',
            html: true,
            sanitize: true,
            content
        });
        const onShown = () => {
            if (el._hostProblemPopoverTimer) {
                clearTimeout(el._hostProblemPopoverTimer);
            }
            el._hostProblemPopoverTimer = setTimeout(() => {
                try { popover.hide(); } catch (_) {}
                el._hostProblemPopoverTimer = null;
            }, 3000);
        };
        const onHide = () => {
            if (el._hostProblemPopoverTimer) {
                clearTimeout(el._hostProblemPopoverTimer);
                el._hostProblemPopoverTimer = null;
            }
        };
        el.addEventListener('shown.bs.popover', onShown);
        el.addEventListener('hide.bs.popover', onHide);
        el._hostProblemPopoverOnShown = onShown;
        el._hostProblemPopoverOnHide = onHide;
    });
}

function formatHostMetricsNodeExtras(metric, nodeName) {
    if (!metric) return '';
    const settings = normalizeHostMetricsSettingsClient((lastHostMetricsData && lastHostMetricsData.settings) || hostMetricsSettings);
    const cpuText = formatHostMetricsTemp(metric.cpu && metric.cpu.tempC);
    const linkText = formatHostMetricsSpeed(metric.link);
    const stateText = metric.link && metric.link.state && metric.link.state !== 'unknown'
        ? `<div class="small text-muted">${escapeHtml(metric.link.state)}</div>`
        : '';
    const alerts = getHostMetricsAlerts(metric, settings);
    const hasCpuCritical = alerts.some((item) => item.kind === 'cpu');
    const hasLinkCritical = alerts.some((item) => item.kind === 'link');
    const cpuBlock = `<span class="fw-bold${hasCpuCritical ? ' text-danger' : ''}">${escapeHtml(cpuText)}</span>`;
    return `
        <div class="col-6 mt-2">
            <small class="text-muted">${escapeHtml(t('hostMetricsCpuTempLabel') || 'CPU temp')}</small>
            <div>${cpuBlock}</div>
        </div>
        <div class="col-6 mt-2">
            <small class="text-muted">${escapeHtml(t('hostMetricsLinkSpeedLabel') || 'Link speed')}</small>
            <div class="fw-bold${hasLinkCritical ? ' text-danger' : ''}">${escapeHtml(linkText)}</div>
            ${stateText}
        </div>
    `;
}

function formatNodeIpmiStatusBadge(node) {
    const ipmi = node && node.ipmi && typeof node.ipmi === 'object' ? node.ipmi : null;
    const checked = !!(ipmi && ipmi.checked);
    const up = checked ? ipmi.up === true : false;
    const statusLabel = checked
        ? (up ? (t('ipmiStatusUp') || 'Available') : (t('ipmiStatusDown') || 'Unavailable'))
        : (t('ipmiStatusUnknown') || 'Not checked');
    const badgeClass = checked
        ? (up ? 'bg-success-subtle text-success-emphasis' : 'bg-danger-subtle text-danger-emphasis')
        : 'bg-secondary-subtle text-secondary-emphasis';
    return `<span class="badge ${badgeClass}" title="${escapeHtml(t('nodeIpmiAvailability') || 'IPMI')}">${escapeHtml(`IPMI: ${statusLabel}`)}</span>`;
}

function formatNetdevMetricValue(v) {
    if (v == null || (typeof v === 'string' && v.trim() === '')) return '—';
    const s = String(v).trim();
    const n = Number(s);
    if (Number.isFinite(n)) {
        const rounded = Math.abs(n) >= 100 ? Math.round(n) : Math.round(n * 10) / 10;
        return `${rounded}`;
    }
    return s;
}

function netdevMetricTile(label, valueStr) {
    return `
        <div class="col-6 col-md-4 col-xl-3">
            <div class="text-center p-3">
                <h6 class="mb-1"><i class="bi bi-diagram-3 me-1"></i>${escapeHtml(label)}</h6>
                <div class="fs-3 fw-semibold lh-sm text-break">${escapeHtml(valueStr)}</div>
            </div>
        </div>`;
}

function netdevMetricCompactTile(label, valueStr, colClass) {
    return `
        <div class="${colClass || 'col-6'}">
            <div class="text-center p-2 h-100">
                <h6 class="mb-1"><i class="bi bi-diagram-3 me-1"></i>${escapeHtml(label)}</h6>
                <div class="fs-5 fw-semibold lh-sm text-break">${escapeHtml(valueStr)}</div>
            </div>
        </div>`;
}

/** innerHtml уже безопасен (escapeHtml внутри) */
function netdevMetricTileHtml(label, innerHtml) {
    return `
        <div class="col-6 col-md-4 col-xl-3">
            <div class="text-center p-3">
                <h6 class="mb-1"><i class="bi bi-diagram-3 me-1"></i>${escapeHtml(label)}</h6>
                <div class="fs-3 fw-semibold lh-sm text-break">${innerHtml}</div>
            </div>
        </div>`;
}

function netdevMetricCompactTileHtml(label, innerHtml, colClass) {
    return `
        <div class="${colClass || 'col-6'}">
            <div class="text-center p-2 h-100">
                <h6 class="mb-1"><i class="bi bi-diagram-3 me-1"></i>${escapeHtml(label)}</h6>
                <div class="fs-5 fw-semibold lh-sm text-break">${innerHtml}</div>
            </div>
        </div>`;
}

function netdevStatusDisplayInnerHtml(statusKey, displayText, rawVal) {
    const esc = escapeHtml(displayText);
    if (statusKey === 'connected') return `<span class="text-success fw-semibold">${esc}</span>`;
    if (statusKey === 'disconnected') return `<span class="text-danger fw-semibold">${esc}</span>`;
    if (statusKey === 'unknown') {
        const rawTrim = rawVal != null ? String(rawVal).trim() : '';
        const raw =
            rawTrim !== ''
                ? ` <span class="text-muted small fw-normal">(${escapeHtml(rawTrim)})</span>`
                : '';
        return `<span class="text-muted fw-semibold">${esc}</span>${raw}`;
    }
    return esc;
}

function buildNetdevCardsHtml(data) {
    const items = Array.isArray(data?.items) ? data.items : [];
    const netdevColClass = items.length === 1 ? 'col-12' : 'col-md-6';
    const rowClass = items.length === 1 ? 'row g-2' : 'row row-cols-1 row-cols-sm-2 g-2 small';

    const buildFieldsTiles = (fields, opts) => {
        const useCompact = !!opts?.compact;
        const tiles = [];
        for (const f of Array.isArray(fields) ? fields : []) {
            if (f && f.enabled === false) continue;
            const oid = f?.oid ? String(f.oid).trim() : '';
            if (!oid) continue; // Skip unconfigured fields
            const label = f?.label ? String(f.label).trim() : lastFallbackLabel(oid);
            const rawVal = f?.value != null ? String(f.value) : null;
            const disp = f?.displayValue != null && String(f.displayValue).trim() !== ''
                ? String(f.displayValue).trim()
                : null;
            const st = f?.statusDisplay;
            let innerHtml;
            if (st === 'connected' || st === 'disconnected' || st === 'unknown') {
                let valueStr;
                if (st === 'connected') {
                    valueStr = t('netdevStatusConnected') || 'Подключён';
                } else if (st === 'disconnected') {
                    valueStr = t('netdevStatusDisconnected') || 'Отключён';
                } else {
                    valueStr = t('netdevStatusUnknown') || 'Неизвестно';
                }
                innerHtml = netdevStatusDisplayInnerHtml(st, valueStr, rawVal);
            } else {
                let valueStr;
                if (disp != null) {
                    valueStr = disp;
                } else {
                    valueStr =
                        rawVal != null && rawVal.trim() !== '' ? formatNetdevMetricValue(rawVal) : '—';
                }
                innerHtml = escapeHtml(valueStr);
            }
            if (useCompact) tiles.push(netdevMetricCompactTileHtml(label, innerHtml));
            else tiles.push(netdevMetricTileHtml(label, innerHtml));
        }
        return tiles.join('');
    };

    const lastFallbackLabel = (oid) => {
        const s = String(oid || '').trim();
        const parts = s.split('.').filter(Boolean);
        return parts.length ? parts[parts.length - 1] : t('netdevFieldFallbackLabel');
    };

    if (items.length === 1) {
        const item = items[0] || {};
        const name = item.name || tParams('netdevDeviceFallback', { n: String(item.slot || 1) });
        if (item.error) {
            const html = `
                <div class="col-12">
                    <div class="alert alert-warning mb-0 py-2 d-flex flex-wrap justify-content-between align-items-center gap-2">
                        <span class="fw-semibold text-truncate" title="${escapeHtml(name)}">${escapeHtml(name)}</span>
                        <span class="small">${escapeHtml(t('netdevSnmpPrefix'))}: ${escapeHtml(item.error)}</span>
                    </div>
                </div>`;
            return { html, rowClass: 'row g-2' };
        }

        const badgeClass = item.up ? 'bg-success' : 'bg-secondary';
        const statusLabel = item.up ? t('statusOkShort') : t('statusDash');

        const fieldsHtml = buildFieldsTiles(item.fields, {});
        const hostLine = item.host ? tParams('netdevSnmpWithHost', { host: item.host }) : t('netdevSnmpPrefix');

        const html = `
            <div class="col-12">
                <div class="d-flex flex-wrap justify-content-between align-items-center gap-2 mb-3 pb-3 border-bottom">
                    <div class="fw-semibold fs-5 text-truncate" title="${escapeHtml(name)}">${escapeHtml(name)}</div>
                    <span class="badge ${badgeClass}">${escapeHtml(statusLabel)}</span>
                </div>
                <div class="row g-2">
                    ${fieldsHtml}
                </div>
                <p class="small text-muted text-center mb-0 mt-3">${escapeHtml(hostLine)}</p>
            </div>`;

        return { html, rowClass };
    }

    const html = items.map((item) => {
        const slotStr = String(item.slot || '').trim();
        const name = item.name || tParams('netdevDeviceFallback', { n: slotStr || '?' });
        const badgeClass = item.up ? 'bg-success' : 'bg-secondary';
        const statusLabel = item.up ? t('statusOkShort') : t('statusDash');
        const fieldsHtml = buildFieldsTiles(item.fields, { compact: true });

        if (item.error) {
            return `
                <div class="${netdevColClass}">
                    <div class="card h-100">
                        <div class="card-header py-2 px-2 d-flex justify-content-between align-items-center">
                            <div class="fw-semibold text-truncate pe-2" title="${escapeHtml(name)}">${escapeHtml(name)}</div>
                            <span class="badge bg-secondary">${escapeHtml(t('netdevSnmpPrefix'))}</span>
                        </div>
                        <div class="card-body p-2">
                            <div class="small text-muted">${escapeHtml(tParams('netdevErrorWithMessage', { msg: item.error }))}</div>
                        </div>
                    </div>
                </div>
            `;
        }

        return `
            <div class="${netdevColClass}">
                <div class="card h-100">
                    <div class="card-header py-2 px-2 d-flex justify-content-between align-items-center">
                        <div class="fw-semibold text-truncate pe-2" title="${escapeHtml(name)}">${escapeHtml(name)}</div>
                        <span class="badge ${badgeClass}">${escapeHtml(statusLabel)}</span>
                    </div>
                    <div class="card-body p-2">
                        <div class="row g-2">
                            ${fieldsHtml}
                        </div>
                    </div>
                </div>
            </div>
        `;
    }).join('');

    return { html, rowClass };
}

async function updateNetdevDashboard() {
    const dashboardCards = document.getElementById('dashboardNetdevCards');
    const dashSection = document.getElementById('dashboardNetdevSection');
    const updatedAtEl = document.getElementById('dashboardNetdevUpdatedAt');

    const netdevMonitorCards = document.getElementById('netdevMonitorCards');
    const netdevMonSection = document.getElementById('netdevMonitorSection');
    const netdevUpdatedAtEl = document.getElementById('netdevUpdatedAt');

    // В режиме монитора это определяется monitorCurrentView.
    // В обычном UX (открыто из меню) — по видимости блока.
    const isNetdevMonitorScreen = (monitorMode && monitorCurrentView === 'netdev')
        || (!!netdevMonSection && netdevMonSection.style.display !== 'none');
    const cardsEl = isNetdevMonitorScreen ? netdevMonitorCards : dashboardCards;
    const sectionEl = isNetdevMonitorScreen ? netdevMonSection : dashSection;
    const updatedAtTargetEl = isNetdevMonitorScreen ? netdevUpdatedAtEl : updatedAtEl;

    if (!isNetdevMonitorScreen) {
        if (dashSection) dashSection.style.display = 'none';
        return;
    }

    if (!cardsEl || !sectionEl) return;

    cardsEl.innerHTML = '';
    cardsEl.className = 'row g-2 small';
    if (updatedAtTargetEl) updatedAtTargetEl.textContent = '';

    try {
        const res = await fetch('/api/netdevices/current');
        const data = await res.json();

        let items = Array.isArray(data?.items) ? data.items : [];

        // Обновляем кеш доступности экрана для корректного свайп-порядка.
        // Используем “вычисленную” доступность, т.е. configured + есть хотя бы 1 доступный слот.
        netdevMonitorConfigured = !!(data && data.configured && Array.isArray(data.items) && data.items.length > 0);

        if (!isNetdevMonitorScreen) {
            // В monitor-mode на экране Cluster сетка берёт слоты “монитора”, а в обычном режиме — слоты “дашборда”
            const isMonitorCluster = monitorMode && monitorCurrentView === 'cluster';
            const slotsForDashboard = isMonitorCluster ? netdevDisplaySlotsMonitor : netdevDisplaySlotsDashboard;
            const safeSlotsForDashboard = (Array.isArray(slotsForDashboard) && slotsForDashboard.length > 0)
                ? slotsForDashboard
                : (netdevDisplaySlotsLoadedOnce ? [] : Array.from({ length: NETDEV_MAX_CONFIGS }, (_, i) => i + 1));

            items = (Array.isArray(safeSlotsForDashboard) && safeSlotsForDashboard.length > 0)
                ? items.filter((it) => safeSlotsForDashboard.includes(it.slot))
                : items;
        } else {
            // На экране netdev используем слот(ы) “монитора”, чтобы чекбоксы из настроек работали и тут.
            const slotsForMonitor = netdevDisplaySlotsMonitor;
            const safeSlotsForMonitor = (Array.isArray(slotsForMonitor) && slotsForMonitor.length > 0)
                ? slotsForMonitor
                : (netdevDisplaySlotsLoadedOnce ? [] : Array.from({ length: NETDEV_MAX_CONFIGS }, (_, i) => i + 1));

            items = (Array.isArray(safeSlotsForMonitor) && safeSlotsForMonitor.length > 0)
                ? items.filter((it) => safeSlotsForMonitor.includes(it.slot))
                : items;
        }

        const showSection = !!(data && data.configured && Array.isArray(items) && items.length > 0);
        if (isNetdevMonitorScreen) {
            // UX: в monitor-mode не прячем экран целиком — иначе получится пустая зона.
            sectionEl.style.display = '';
        } else {
            sectionEl.style.display = showSection ? '' : 'none';
        }

        if (!showSection) {
            cardsEl.innerHTML = `
                <div class="col-12">
                    <div class="text-muted small">Сетевые устройства не настроены</div>
                </div>`;
            if (updatedAtTargetEl && data?.updatedAt) updatedAtTargetEl.textContent = new Date(data.updatedAt).toLocaleString();
            return;
        }

        if (updatedAtTargetEl && data?.updatedAt) updatedAtTargetEl.textContent = new Date(data.updatedAt).toLocaleString();

        const payload = { ...data, items };
        const { html, rowClass } = buildNetdevCardsHtml(payload);
        cardsEl.className = rowClass || 'row g-2 small';
        cardsEl.innerHTML = html;
    } catch (e) {
        cardsEl.innerHTML = `<div class="col-12"><div class="text-danger small">${escapeHtml((e && e.message) ? e.message : String(e))}</div></div>`;
        sectionEl.style.display = '';
    }
}

async function parseHttpJsonResponse(res) {
    const text = await res.text();
    let data = null;
    let parseFailed = false;
    if (text) {
        try {
            data = JSON.parse(text);
        } catch {
            parseFailed = true;
        }
    } else {
        data = {};
    }
    return { data, parseFailed, text };
}

function speedtestNetworkErrorMessage(err) {
    const name = err && err.name;
    const msg = (err && err.message) ? String(err.message) : String(err || '');
    const low = msg.toLowerCase();
    if (name === 'AbortError') {
        return t('speedtestErrorAborted') || 'Cancelled';
    }
    if (
        msg === 'Failed to fetch'
        || low.includes('networkerror')
        || low.includes('load failed')
        || low.includes('network request failed')
    ) {
        return t('speedtestErrorNetwork') || 'Could not reach the server';
    }
    return msg.trim() || (t('speedtestErrorUnknown') || 'Unknown error');
}

function speedtestDescribeRunFailure(data) {
    if (!data || data.ok !== false) return '';
    const code = data.error;
    if (code === 'cli_missing') {
        return t('speedtestCliMissing') || 'CLI: not found';
    }
    if (typeof code === 'string' && code.trim()) {
        return code.trim();
    }
    return t('speedtestRunFailedGeneric') || 'Measurement failed';
}

function iperf3DescribeRunFailure(data) {
    if (!data || data.ok !== false) return '';
    const code = data.error;
    if (code === 'cli_missing') {
        return t('iperf3CliMissing') || 'CLI: not found';
    }
    if (code === 'no_host') {
        return t('iperf3ErrorNoHost') || 'iperf3 server host is not configured';
    }
    if (typeof code === 'string' && code.trim()) {
        return code.trim();
    }
    return t('speedtestRunFailedGeneric') || 'Measurement failed';
}

function formatSpeedtestMbps(v) {
    if (v == null || !Number.isFinite(Number(v))) return '—';
    const n = Math.round(Number(v) * 10) / 10;
    return `${n} Mbps`;
}

function formatSpeedtestPing(ms) {
    if (ms == null || !Number.isFinite(Number(ms))) return '—';
    return `${Math.round(Number(ms) * 10) / 10} ms`;
}

/** Отклонение от эталона (тарифа): +% быстрее плана, −% медленнее. null — эталон для оси не задан. */
function formatSpeedtestDeviationPct(measuredMbps, planMbps) {
    if (!Number.isFinite(Number(planMbps)) || Number(planMbps) <= 0) return null;
    if (!Number.isFinite(Number(measuredMbps))) return '—';
    const pct = ((Number(measuredMbps) / Number(planMbps)) - 1) * 100;
    const r = Math.round(pct * 10) / 10;
    const sign = r > 0 ? '+' : '';
    return `${sign}${r}%`;
}

function speedtestDeviationTextClass(measuredMbps, planMbps, pctStr) {
    if (pctStr === '—' || pctStr == null) return 'text-muted';
    if (!Number.isFinite(Number(measuredMbps)) || !Number.isFinite(Number(planMbps)) || Number(planMbps) <= 0) {
        return '';
    }
    return Number(measuredMbps) >= Number(planMbps) ? 'text-success' : 'text-danger';
}

function setSpeedtestLastRunDeviationRow(wrapId, pctId, planId, measuredMbps, planMbps, lastOk) {
    const wrap = document.getElementById(wrapId);
    const pctEl = document.getElementById(pctId);
    const planEl = document.getElementById(planId);
    if (!wrap || !pctEl || !planEl) return;
    const hasPlan = Number.isFinite(Number(planMbps)) && Number(planMbps) > 0;
    if (!lastOk || !hasPlan) {
        wrap.classList.add('d-none');
        wrap.setAttribute('aria-hidden', 'true');
        pctEl.textContent = '';
        planEl.textContent = '';
        pctEl.className = 'speedtest-monitor__last-dev-pct';
        return;
    }
    const pct = formatSpeedtestDeviationPct(measuredMbps, planMbps);
    if (pct == null || pct === '—') {
        wrap.classList.add('d-none');
        wrap.setAttribute('aria-hidden', 'true');
        pctEl.textContent = '';
        planEl.textContent = '';
        pctEl.className = 'speedtest-monitor__last-dev-pct';
        return;
    }
    pctEl.textContent = pct;
    pctEl.className = `speedtest-monitor__last-dev-pct ${speedtestDeviationTextClass(measuredMbps, planMbps, pct)}`;
    planEl.textContent = ` \u2013 ${formatSpeedtestMbps(planMbps)}`;
    wrap.classList.remove('d-none');
    wrap.setAttribute('aria-hidden', 'false');
}

function clearSpeedtestLastRunDeviationRows() {
    setSpeedtestLastRunDeviationRow(
        'speedtestMonitorLastDownloadDevWrap',
        'speedtestMonitorLastDownloadDevPct',
        'speedtestMonitorLastDownloadDevPlan',
        null,
        NaN,
        false
    );
    setSpeedtestLastRunDeviationRow(
        'speedtestMonitorLastUploadDevWrap',
        'speedtestMonitorLastUploadDevPct',
        'speedtestMonitorLastUploadDevPlan',
        null,
        NaN,
        false
    );
}

function renderSpeedtestRunsTodayTable(runs, options = {}) {
    const tbody = document.getElementById('speedtestMonitorLast24hBody');
    const tableWrap = document.getElementById('speedtestMonitorLast24hTableWrap');
    const emptyEl = document.getElementById('speedtestMonitorLast24hEmpty');
    if (!tbody || !tableWrap || !emptyEl) return;
    tbody.replaceChildren();
    const hidePlanCols = () => {
        const thDevDl = document.getElementById('speedtestMonitor24hColDevDownload');
        const thDevUl = document.getElementById('speedtestMonitor24hColDevUpload');
        if (thDevDl) thDevDl.classList.add('d-none');
        if (thDevUl) thDevUl.classList.add('d-none');
    };
    if (options.loadFailed) {
        hidePlanCols();
        tableWrap.classList.add('d-none');
        emptyEl.classList.remove('d-none');
        emptyEl.textContent = t('speedtestSummaryLoadError') || 'Could not load speedtest data';
        return;
    }
    const list = Array.isArray(runs) ? runs : [];
    if (!list.length) {
        hidePlanCols();
        tableWrap.classList.add('d-none');
        emptyEl.classList.remove('d-none');
        emptyEl.textContent = t('speedtestRunsTodayEmpty') || 'No measurements today yet.';
        return;
    }
    tableWrap.classList.remove('d-none');
    emptyEl.classList.add('d-none');
    const planDl = Number(options.planDl);
    const planUl = Number(options.planUl);
    const showDevDl = Number.isFinite(planDl) && planDl > 0;
    const showDevUl = Number.isFinite(planUl) && planUl > 0;
    const thDevDl = document.getElementById('speedtestMonitor24hColDevDownload');
    const thDevUl = document.getElementById('speedtestMonitor24hColDevUpload');
    if (thDevDl) thDevDl.classList.toggle('d-none', !showDevDl);
    if (thDevUl) thDevUl.classList.toggle('d-none', !showDevUl);
    const frag = document.createDocumentFragment();
    for (const r of list) {
        const tr = document.createElement('tr');
        tr.className = 'speedtest-monitor__row';
        const tdTime = document.createElement('td');
        const tdDl = document.createElement('td');
        const tdUl = document.createElement('td');
        const tdPing = document.createElement('td');
        const tdSrv = document.createElement('td');
        tdTime.className = 'speedtest-monitor__cell speedtest-monitor__cell--time text-nowrap';
        tdDl.className = 'speedtest-monitor__cell speedtest-monitor__cell--num text-end';
        tdUl.className = 'speedtest-monitor__cell speedtest-monitor__cell--num text-end';
        tdPing.className = 'speedtest-monitor__cell speedtest-monitor__cell--num text-end';
        tdSrv.className = 'speedtest-monitor__cell speedtest-monitor__cell--note text-break';
        const runAt = r && r.runAt;
        tdTime.textContent = runAt ? new Date(runAt).toLocaleString() : '—';
        const err = r && r.error;
        if (err) {
            tdDl.textContent = '—';
            tdUl.textContent = '—';
            tdPing.textContent = '—';
            tdSrv.textContent = String(err).slice(0, 200);
            tdSrv.classList.add('text-danger');
        } else {
            tdDl.textContent = formatSpeedtestMbps(r.downloadMbps);
            tdUl.textContent = formatSpeedtestMbps(r.uploadMbps);
            tdPing.textContent = formatSpeedtestPing(r.pingMs);
            const sn = r.serverName;
            tdSrv.textContent = sn ? String(sn) : '—';
        }
        tr.appendChild(tdTime);
        tr.appendChild(tdDl);
        if (showDevDl) {
            const td = document.createElement('td');
            const pct = err ? '—' : formatSpeedtestDeviationPct(r.downloadMbps, planDl);
            td.className = `speedtest-monitor__cell speedtest-monitor__cell--dev text-end ${speedtestDeviationTextClass(r && r.downloadMbps, planDl, pct)}`;
            td.textContent = pct == null ? '—' : pct;
            tr.appendChild(td);
        }
        tr.appendChild(tdUl);
        if (showDevUl) {
            const td = document.createElement('td');
            const pct = err ? '—' : formatSpeedtestDeviationPct(r.uploadMbps, planUl);
            td.className = `speedtest-monitor__cell speedtest-monitor__cell--dev text-end ${speedtestDeviationTextClass(r && r.uploadMbps, planUl, pct)}`;
            td.textContent = pct == null ? '—' : pct;
            tr.appendChild(td);
        }
        tr.appendChild(tdPing);
        tr.appendChild(tdSrv);
        frag.appendChild(tr);
    }
    tbody.appendChild(frag);
}

function setSpeedtestDownloadBarPercent(barId, mbpsValue, scaleMax) {
    const bar = document.getElementById(barId);
    if (!bar) return;
    const v = Number(mbpsValue);
    if (!Number.isFinite(v) || v < 0) {
        bar.style.width = '0%';
        return;
    }
    const cap = Math.max(Number(scaleMax) || 0, 1e-6);
    bar.style.width = `${Math.min(100, (v / cap) * 100)}%`;
}

function isSpeedtestSettingsTabActive() {
    const pane = document.getElementById('settings-tab-speedtest');
    return !!(pane && pane.classList.contains('show'));
}

function updateSpeedtestSettingsEngineUI() {
    const engSel = document.getElementById('speedtestEngineSelect');
    const serverLabel = document.getElementById('speedtestServerLabel');
    const serverHint = document.getElementById('speedtestServerHint');
    const serverInput = document.getElementById('speedtestServerInput');
    const libreWrapInput = document.getElementById('speedtestLibrespeedServerInput');
    const libreLabel = document.getElementById('speedtestLibrespeedServerLabel');
    const libreHint = document.getElementById('speedtestLibrespeedServerHint');
    const proxyTitle = document.getElementById('speedtestProxySectionTitle');
    const useEngine = (engSel && String(engSel.value).trim().toLowerCase() === 'librespeed')
        ? 'librespeed'
        : 'ookla';
    speedtestEngine = useEngine;
    if (serverLabel) {
        serverLabel.textContent = useEngine === 'librespeed'
            ? (t('speedtestServerLabelLibrespeed') || (t('speedtestServerLabel') || 'Measurement server'))
            : (t('speedtestServerLabel') || 'Measurement server');
    }
    if (serverHint) {
        serverHint.textContent = useEngine === 'librespeed'
            ? (t('speedtestServerHintLibrespeed') || 'Optional: LibreSpeed server ID (if your CLI supports it). Leave empty for auto.')
            : (t('speedtestServerHint') || 'Ookla server ID (number). Leave empty for automatic server selection.');
    }
    if (serverInput) {
        serverInput.placeholder = useEngine === 'librespeed'
            ? (t('speedtestServerPlaceholderLibrespeed') || 'Server ID (optional)')
            : (t('speedtestServerPlaceholder') || 'Server ID (optional)');
    }
    const showLibreInput = useEngine === 'librespeed';
    for (const el of [libreWrapInput, libreLabel, libreHint]) {
        if (!el) continue;
        const row = el.closest('.row');
        if (row && row.querySelector('#speedtestLibrespeedServerInput')) {
            row.classList.toggle('d-none', !showLibreInput);
            break;
        }
    }
    if (proxyTitle) {
        proxyTitle.textContent = useEngine === 'librespeed'
            ? (t('speedtestProxySectionTitleLibrespeed') || (t('speedtestProxySectionTitle') || 'Proxy for Speedtest CLI'))
            : (t('speedtestProxySectionTitle') || 'Proxy for Speedtest CLI');
    }
}

function updateSpeedtestProxySettingsUI(autoShowIfConfigured = false) {
    const chk = document.getElementById('speedtestShowProxySettingsChk');
    const wrap = document.getElementById('speedtestProxySettingsWrap');
    if (!chk || !wrap) return;
    const httpPx = (document.getElementById('speedtestHttpProxyInput')?.value || '').trim();
    const httpsPx = (document.getElementById('speedtestHttpsProxyInput')?.value || '').trim();
    const noPx = (document.getElementById('speedtestNoProxyInput')?.value || '').trim();
    const hasConfiguredProxy = !!(httpPx || httpsPx || noPx);
    if (autoShowIfConfigured && hasConfiguredProxy && !chk.checked) {
        chk.checked = true;
    }
    wrap.classList.toggle('d-none', !chk.checked);
}

async function updateSpeedtestDashboard() {
    const speedtestMonSection = document.getElementById('speedtestMonitorSection');
    /** Полноэкранный Speedtest в мониторе (или открыт из меню). */
    const onDedicatedSpeedtestMonitor = (monitorMode && monitorCurrentView === 'speedtest')
        || (!!speedtestMonSection && speedtestMonSection.style.display !== 'none');
    const shouldFetchSpeedtest = onDedicatedSpeedtestMonitor || isSpeedtestSettingsTabActive();
    const setEl = (id, text) => {
        const el = document.getElementById(id);
        if (el) el.textContent = text;
    };
    if (!shouldFetchSpeedtest) {
        return;
    }
    try {
        const res = await fetch('/api/speedtest/summary');
        const { data: summary, parseFailed } = await parseHttpJsonResponse(res);
        if (parseFailed) {
            throw new Error(t('speedtestErrorBadResponse') || 'Invalid server response');
        }
        if (!res.ok) {
            throw new Error((summary && summary.error) || `HTTP ${res.status}`);
        }

        const enabled = !!(summary.enabled === true || summary.enabled === '1' || summary.enabled === 1);

        const last = summary.last;
        const hasHistory = !!(last && last.runAt);

        // Экран Speedtest в мониторе доступен при включённых замерах или при наличии истории в БД.
        speedtestMonitorConfigured = enabled || hasHistory;

        // Выключенный «Замер» не должен стирать уже сохранённые в БД результаты.
        if (!enabled && !hasHistory) {
            setEl('speedtestMonitorLastRun', '—');
            setEl('speedtestMonitorLastDownload', '—');
            setEl('speedtestMonitorLastUpload', '—');
            setEl('speedtestMonitorLastPing', '—');
            setEl('speedtestMonitorAvg', '—');
            setEl('speedtestMonitorMin', '—');
            setEl('speedtestMonitorMax', '—');
            setEl('speedtestMonitorExtra', t('backupNoData') || 'Нет данных');
            setSpeedtestDownloadBarPercent('speedtestMonitorAvgBar', null, 1);
            setSpeedtestDownloadBarPercent('speedtestMonitorMinBar', null, 1);
            setSpeedtestDownloadBarPercent('speedtestMonitorMaxBar', null, 1);
            clearSpeedtestLastRunDeviationRows();
            renderSpeedtestRunsTodayTable([]);
            return;
        }

        const lastTime = last && last.runAt ? new Date(last.runAt).toLocaleString() : '—';
        const lastOk = !!(last && !last.error);
        let lastRunDisplay = lastTime;
        if (last && last.error) {
            lastRunDisplay = lastTime !== '—' ? `${lastTime} · ${last.error}` : String(last.error);
        }

        const td = summary.today || {};
        const dl = td.download || {};
        const ul = td.upload || {};
        const pDl = summary.providerDownloadMbps != null ? Number(summary.providerDownloadMbps) : NaN;
        const pUl = summary.providerUploadMbps != null ? Number(summary.providerUploadMbps) : NaN;

        let extra = '';
        if (last && last.serverName) {
            extra = String(last.serverName);
        }
        if (ul.avg != null) {
            extra += (extra ? ' · ' : '') + `${t('speedtestUploadAvgToday')}: ${formatSpeedtestMbps(ul.avg)}`;
        }

        setSpeedtestLastRunDeviationRow(
            'speedtestMonitorLastDownloadDevWrap',
            'speedtestMonitorLastDownloadDevPct',
            'speedtestMonitorLastDownloadDevPlan',
            lastOk && last ? last.downloadMbps : null,
            pDl,
            lastOk
        );
        setSpeedtestLastRunDeviationRow(
            'speedtestMonitorLastUploadDevWrap',
            'speedtestMonitorLastUploadDevPct',
            'speedtestMonitorLastUploadDevPlan',
            lastOk && last ? last.uploadMbps : null,
            pUl,
            lastOk
        );

        setEl('speedtestMonitorLastRun', lastRunDisplay);
        setEl(
            'speedtestMonitorLastDownload',
            lastOk && last.downloadMbps != null ? formatSpeedtestMbps(last.downloadMbps) : '—'
        );
        setEl(
            'speedtestMonitorLastUpload',
            lastOk && last.uploadMbps != null ? formatSpeedtestMbps(last.uploadMbps) : '—'
        );
        setEl(
            'speedtestMonitorLastPing',
            lastOk && last.pingMs != null ? formatSpeedtestPing(last.pingMs) : '—'
        );
        setEl('speedtestMonitorAvg', dl.avg != null ? formatSpeedtestMbps(dl.avg) : '—');
        setEl('speedtestMonitorMin', dl.min != null ? formatSpeedtestMbps(dl.min) : '—');
        setEl('speedtestMonitorMax', dl.max != null ? formatSpeedtestMbps(dl.max) : '—');
        setEl('speedtestMonitorExtra', extra);

        const dlAvg = dl.avg != null ? Number(dl.avg) : NaN;
        const dlMin = dl.min != null ? Number(dl.min) : NaN;
        const dlMax = dl.max != null ? Number(dl.max) : NaN;
        const scaleMax = Math.max(
            Number.isFinite(dlAvg) ? dlAvg : 0,
            Number.isFinite(dlMin) ? dlMin : 0,
            Number.isFinite(dlMax) ? dlMax : 0,
            Number.isFinite(pDl) && pDl > 0 ? pDl : 0,
            1
        );
        setSpeedtestDownloadBarPercent('speedtestMonitorAvgBar', dl.avg, scaleMax);
        setSpeedtestDownloadBarPercent('speedtestMonitorMinBar', dl.min, scaleMax);
        setSpeedtestDownloadBarPercent('speedtestMonitorMaxBar', dl.max, scaleMax);

        renderSpeedtestRunsTodayTable(summary.runsToday, { planDl: pDl, planUl: pUl });

        const cliEl = document.getElementById('speedtestCliStatus');
        if (cliEl) {
            const engine = summary && summary.cliEngine === 'librespeed' ? 'librespeed' : 'ookla';
            const engineName = engine === 'librespeed'
                ? (t('speedtestEngineLibrespeedOption') || 'LibreSpeed CLI')
                : (t('speedtestEngineOoklaOption') || 'Ookla CLI');
            let cliText = summary.cliAvailable
                ? (t('speedtestCliOk') || 'CLI: OK')
                : (t('speedtestCliMissing') || 'CLI: not found');
            cliText = `${engineName} · ${cliText}`;
            const px = summary.proxy;
            if (px && (px.http || px.https)) {
                const bits = [];
                if (px.http) bits.push('HTTP');
                if (px.https) bits.push('HTTPS');
                cliText += ` · ${t('speedtestProxyActiveShort') || 'Proxy'}: ${bits.join('/')}`;
            } else if (px && px.noProxy) {
                cliText += ` · ${t('speedtestNoProxyActiveShort') || 'NO_PROXY set'}`;
            }
            cliEl.textContent = cliText;
            cliEl.className = 'small ' + (summary.cliAvailable ? 'text-success' : 'text-warning');
        }
    } catch (e) {
        setEl('speedtestMonitorLastRun', '—');
        setEl('speedtestMonitorLastDownload', '—');
        setEl('speedtestMonitorLastUpload', '—');
        setEl('speedtestMonitorLastPing', '—');
        setEl('speedtestMonitorAvg', '—');
        setEl('speedtestMonitorMin', '—');
        setEl('speedtestMonitorMax', '—');
        const prefix = t('speedtestSummaryLoadError') || 'Could not load speedtest data';
        const detail = e instanceof Error && e.message ? e.message : speedtestNetworkErrorMessage(e);
        const msg = detail ? `${prefix}: ${detail}` : prefix;
        setEl('speedtestMonitorExtra', msg);
        setSpeedtestDownloadBarPercent('speedtestMonitorAvgBar', null, 1);
        setSpeedtestDownloadBarPercent('speedtestMonitorMinBar', null, 1);
        setSpeedtestDownloadBarPercent('speedtestMonitorMaxBar', null, 1);
        clearSpeedtestLastRunDeviationRows();
        renderSpeedtestRunsTodayTable(null, { loadFailed: true });
        const cliEl = document.getElementById('speedtestCliStatus');
        if (cliEl) {
            cliEl.textContent = msg;
            cliEl.className = 'small text-danger';
        }
    }
}

function clearIperf3LastRunDeviationRows() {
    setSpeedtestLastRunDeviationRow(
        'iperf3MonitorLastDownloadDevWrap',
        'iperf3MonitorLastDownloadDevPct',
        'iperf3MonitorLastDownloadDevPlan',
        null,
        NaN,
        false
    );
    setSpeedtestLastRunDeviationRow(
        'iperf3MonitorLastUploadDevWrap',
        'iperf3MonitorLastUploadDevPct',
        'iperf3MonitorLastUploadDevPlan',
        null,
        NaN,
        false
    );
}

function renderIperf3RunsTodayTable(runs, options = {}) {
    const tbody = document.getElementById('iperf3MonitorLast24hBody');
    const tableWrap = document.getElementById('iperf3MonitorLast24hTableWrap');
    const emptyEl = document.getElementById('iperf3MonitorLast24hEmpty');
    if (!tbody || !tableWrap || !emptyEl) return;
    tbody.replaceChildren();
    const hidePlanCols = () => {
        const thDevDl = document.getElementById('iperf3Monitor24hColDevDownload');
        const thDevUl = document.getElementById('iperf3Monitor24hColDevUpload');
        if (thDevDl) thDevDl.classList.add('d-none');
        if (thDevUl) thDevUl.classList.add('d-none');
    };
    if (options.loadFailed) {
        hidePlanCols();
        tableWrap.classList.add('d-none');
        emptyEl.classList.remove('d-none');
        emptyEl.textContent = t('iperf3SummaryLoadError') || 'Could not load iperf3 data';
        return;
    }
    const list = Array.isArray(runs) ? runs : [];
    if (!list.length) {
        hidePlanCols();
        tableWrap.classList.add('d-none');
        emptyEl.classList.remove('d-none');
        emptyEl.textContent = t('speedtestRunsTodayEmpty') || 'No measurements today yet.';
        return;
    }
    tableWrap.classList.remove('d-none');
    emptyEl.classList.add('d-none');
    const planDl = Number(options.planDl);
    const planUl = Number(options.planUl);
    const showDevDl = Number.isFinite(planDl) && planDl > 0;
    const showDevUl = Number.isFinite(planUl) && planUl > 0;
    const thDevDl = document.getElementById('iperf3Monitor24hColDevDownload');
    const thDevUl = document.getElementById('iperf3Monitor24hColDevUpload');
    if (thDevDl) thDevDl.classList.toggle('d-none', !showDevDl);
    if (thDevUl) thDevUl.classList.toggle('d-none', !showDevUl);
    const frag = document.createDocumentFragment();
    for (const r of list) {
        const tr = document.createElement('tr');
        tr.className = 'speedtest-monitor__row';
        const tdTime = document.createElement('td');
        const tdDl = document.createElement('td');
        const tdUl = document.createElement('td');
        const tdPing = document.createElement('td');
        const tdSrv = document.createElement('td');
        tdTime.className = 'speedtest-monitor__cell speedtest-monitor__cell--time text-nowrap';
        tdDl.className = 'speedtest-monitor__cell speedtest-monitor__cell--num text-end';
        tdUl.className = 'speedtest-monitor__cell speedtest-monitor__cell--num text-end';
        tdPing.className = 'speedtest-monitor__cell speedtest-monitor__cell--num text-end';
        tdSrv.className = 'speedtest-monitor__cell speedtest-monitor__cell--note text-break';
        const runAt = r && r.runAt;
        tdTime.textContent = runAt ? new Date(runAt).toLocaleString() : '—';
        const err = r && r.error;
        if (err) {
            tdDl.textContent = '—';
            tdUl.textContent = '—';
            tdPing.textContent = '—';
            tdSrv.textContent = String(err).slice(0, 200);
            tdSrv.classList.add('text-danger');
        } else {
            tdDl.textContent = formatSpeedtestMbps(r.downloadMbps);
            tdUl.textContent = formatSpeedtestMbps(r.uploadMbps);
            tdPing.textContent = formatSpeedtestPing(r.pingMs);
            const sn = r.serverName;
            tdSrv.textContent = sn ? String(sn) : '—';
        }
        tr.appendChild(tdTime);
        tr.appendChild(tdDl);
        if (showDevDl) {
            const td = document.createElement('td');
            const pct = err ? '—' : formatSpeedtestDeviationPct(r.downloadMbps, planDl);
            td.className = `speedtest-monitor__cell speedtest-monitor__cell--dev text-end ${speedtestDeviationTextClass(r && r.downloadMbps, planDl, pct)}`;
            td.textContent = pct == null ? '—' : pct;
            tr.appendChild(td);
        }
        tr.appendChild(tdUl);
        if (showDevUl) {
            const td = document.createElement('td');
            const pct = err ? '—' : formatSpeedtestDeviationPct(r.uploadMbps, planUl);
            td.className = `speedtest-monitor__cell speedtest-monitor__cell--dev text-end ${speedtestDeviationTextClass(r && r.uploadMbps, planUl, pct)}`;
            td.textContent = pct == null ? '—' : pct;
            tr.appendChild(td);
        }
        tr.appendChild(tdPing);
        tr.appendChild(tdSrv);
        frag.appendChild(tr);
    }
    tbody.appendChild(frag);
}

function isIperf3SettingsTabActive() {
    const pane = document.getElementById('settings-tab-iperf3');
    return !!(pane && pane.classList.contains('show'));
}

async function updateIperf3Dashboard() {
    const iperf3MonSection = document.getElementById('iperf3MonitorSection');
    const onDedicatedIperf3Monitor = (monitorMode && monitorCurrentView === 'iperf3')
        || (!!iperf3MonSection && iperf3MonSection.style.display !== 'none');
    const shouldFetchIperf3 = onDedicatedIperf3Monitor || isIperf3SettingsTabActive();
    const setEl = (id, text) => {
        const el = document.getElementById(id);
        if (el) el.textContent = text;
    };
    if (!shouldFetchIperf3) {
        return;
    }
    try {
        const res = await fetch('/api/iperf3/summary');
        const { data: summary, parseFailed } = await parseHttpJsonResponse(res);
        if (parseFailed) {
            throw new Error(t('iperf3ErrorBadResponse') || 'Invalid server response');
        }
        if (!res.ok) {
            throw new Error((summary && summary.error) || `HTTP ${res.status}`);
        }

        const enabled = !!(summary.enabled === true || summary.enabled === '1' || summary.enabled === 1);

        const last = summary.last;
        const hasHistory = !!(last && last.runAt);

        iperf3MonitorConfigured = enabled || hasHistory;

        if (!enabled && !hasHistory) {
            setEl('iperf3MonitorLastRun', '—');
            setEl('iperf3MonitorLastDownload', '—');
            setEl('iperf3MonitorLastUpload', '—');
            setEl('iperf3MonitorLastPing', '—');
            setEl('iperf3MonitorAvg', '—');
            setEl('iperf3MonitorMin', '—');
            setEl('iperf3MonitorMax', '—');
            setEl('iperf3MonitorExtra', t('backupNoData') || 'Нет данных');
            setSpeedtestDownloadBarPercent('iperf3MonitorAvgBar', null, 1);
            setSpeedtestDownloadBarPercent('iperf3MonitorMinBar', null, 1);
            setSpeedtestDownloadBarPercent('iperf3MonitorMaxBar', null, 1);
            clearIperf3LastRunDeviationRows();
            renderIperf3RunsTodayTable([]);
            return;
        }

        const lastTime = last && last.runAt ? new Date(last.runAt).toLocaleString() : '—';
        const lastOk = !!(last && !last.error);
        let lastRunDisplay = lastTime;
        if (last && last.error) {
            lastRunDisplay = lastTime !== '—' ? `${lastTime} · ${last.error}` : String(last.error);
        }

        const td = summary.today || {};
        const dl = td.download || {};
        const ul = td.upload || {};
        const pDl = summary.providerDownloadMbps != null ? Number(summary.providerDownloadMbps) : NaN;
        const pUl = summary.providerUploadMbps != null ? Number(summary.providerUploadMbps) : NaN;

        let extra = '';
        if (last && last.serverName) {
            extra = String(last.serverName);
        }
        if (ul.avg != null) {
            extra += (extra ? ' · ' : '') + `${t('iperf3UploadAvgToday')}: ${formatSpeedtestMbps(ul.avg)}`;
        }

        setSpeedtestLastRunDeviationRow(
            'iperf3MonitorLastDownloadDevWrap',
            'iperf3MonitorLastDownloadDevPct',
            'iperf3MonitorLastDownloadDevPlan',
            lastOk && last ? last.downloadMbps : null,
            pDl,
            lastOk
        );
        setSpeedtestLastRunDeviationRow(
            'iperf3MonitorLastUploadDevWrap',
            'iperf3MonitorLastUploadDevPct',
            'iperf3MonitorLastUploadDevPlan',
            lastOk && last ? last.uploadMbps : null,
            pUl,
            lastOk
        );

        setEl('iperf3MonitorLastRun', lastRunDisplay);
        setEl(
            'iperf3MonitorLastDownload',
            lastOk && last.downloadMbps != null ? formatSpeedtestMbps(last.downloadMbps) : '—'
        );
        setEl(
            'iperf3MonitorLastUpload',
            lastOk && last.uploadMbps != null ? formatSpeedtestMbps(last.uploadMbps) : '—'
        );
        setEl(
            'iperf3MonitorLastPing',
            lastOk && last.pingMs != null ? formatSpeedtestPing(last.pingMs) : '—'
        );
        setEl('iperf3MonitorAvg', dl.avg != null ? formatSpeedtestMbps(dl.avg) : '—');
        setEl('iperf3MonitorMin', dl.min != null ? formatSpeedtestMbps(dl.min) : '—');
        setEl('iperf3MonitorMax', dl.max != null ? formatSpeedtestMbps(dl.max) : '—');
        setEl('iperf3MonitorExtra', extra);

        const dlAvg = dl.avg != null ? Number(dl.avg) : NaN;
        const dlMin = dl.min != null ? Number(dl.min) : NaN;
        const dlMax = dl.max != null ? Number(dl.max) : NaN;
        const scaleMax = Math.max(
            Number.isFinite(dlAvg) ? dlAvg : 0,
            Number.isFinite(dlMin) ? dlMin : 0,
            Number.isFinite(dlMax) ? dlMax : 0,
            Number.isFinite(pDl) && pDl > 0 ? pDl : 0,
            1
        );
        setSpeedtestDownloadBarPercent('iperf3MonitorAvgBar', dl.avg, scaleMax);
        setSpeedtestDownloadBarPercent('iperf3MonitorMinBar', dl.min, scaleMax);
        setSpeedtestDownloadBarPercent('iperf3MonitorMaxBar', dl.max, scaleMax);

        renderIperf3RunsTodayTable(summary.runsToday, { planDl: pDl, planUl: pUl });

        const cliEl = document.getElementById('iperf3CliStatus');
        if (cliEl) {
            const cliText = summary.cliAvailable
                ? (t('iperf3CliOk') || 'CLI: OK')
                : (t('iperf3CliMissing') || 'CLI: not found');
            cliEl.textContent = cliText;
            cliEl.className = 'small ' + (summary.cliAvailable ? 'text-success' : 'text-warning');
        }
    } catch (e) {
        setEl('iperf3MonitorLastRun', '—');
        setEl('iperf3MonitorLastDownload', '—');
        setEl('iperf3MonitorLastUpload', '—');
        setEl('iperf3MonitorLastPing', '—');
        setEl('iperf3MonitorAvg', '—');
        setEl('iperf3MonitorMin', '—');
        setEl('iperf3MonitorMax', '—');
        const prefix = t('iperf3SummaryLoadError') || 'Could not load iperf3 data';
        const detail = e instanceof Error && e.message ? e.message : speedtestNetworkErrorMessage(e);
        const msg = detail ? `${prefix}: ${detail}` : prefix;
        setEl('iperf3MonitorExtra', msg);
        setSpeedtestDownloadBarPercent('iperf3MonitorAvgBar', null, 1);
        setSpeedtestDownloadBarPercent('iperf3MonitorMinBar', null, 1);
        setSpeedtestDownloadBarPercent('iperf3MonitorMaxBar', null, 1);
        clearIperf3LastRunDeviationRows();
        renderIperf3RunsTodayTable(null, { loadFailed: true });
        const cliEl = document.getElementById('iperf3CliStatus');
        if (cliEl) {
            cliEl.textContent = msg;
            cliEl.className = 'small text-danger';
        }
    }
}

function clusterTileSourceNumericId(tile, prefix) {
    const src = String(tile && tile.sourceId || '').trim();
    if (!src.startsWith(prefix + ':')) return NaN;
    const n = parseInt(src.slice(prefix.length + 1), 10);
    return Number.isFinite(n) ? n : NaN;
}

function clusterTileSourceValue(tile, prefix) {
    const src = String(tile && tile.sourceId || '').trim();
    if (!src.startsWith(prefix + ':')) return '';
    return src.slice(prefix.length + 1).trim();
}

function buildClusterDashboardMetricCell(label, value, progressPct, barClass, colClass = 'col-6', titleHint = '') {
    const bar = typeof progressPct === 'number' && Number.isFinite(progressPct)
        ? `<div class="progress mt-2 hm-progress"><div class="progress-bar ${barClass || 'bg-primary'}" style="width: ${Math.min(100, Math.max(0, progressPct))}%"></div></div>`
        : '';
    const labelTrim = label == null ? '' : String(label).trim();
    const labelHtml = labelTrim
        ? `<small class="text-muted ups-node-card__metric-label">${escapeHtml(labelTrim)}</small>`
        : '';
    const titleAttr = titleHint ? ` title="${escapeHtml(titleHint)}"` : '';
    return `
        <div class="${colClass}">
            <div class="p-2 h-100"${titleAttr}>
                ${labelHtml}
                <div class="fw-bold ups-node-card__metric-value text-break">${escapeHtml(value == null || value === '' ? '—' : String(value))}</div>
                ${bar}
            </div>
        </div>
    `;
}

/** Header status: pill on Homelab scroll; colored dot on Tiles (tooltip / aria-label = text). */
function clusterTileHeaderStatusHtml(badgeClass, labelText) {
    const raw = labelText == null ? '' : String(labelText);
    const esc = escapeHtml(raw);
    if (!tilesMonitorTileFooterSuppressDepth) {
        return `<span class="badge ${badgeClass}">${esc}</span>`;
    }
    const bc = String(badgeClass || '');
    let tier = 'secondary';
    if (/\bbg-success\b/.test(bc)) tier = 'success';
    else if (/\bbg-danger\b/.test(bc)) tier = 'danger';
    else if (/\bbg-warning\b/.test(bc)) tier = 'warning';
    else if (/\bbg-info\b/.test(bc)) tier = 'info';
    else if (/\bbg-primary\b/.test(bc)) tier = 'primary';
    return `<span class="tiles-header-status-dot tiles-header-status-dot--${tier}" title="${esc}" aria-label="${esc}" role="img"></span>`;
}

function buildClusterDashboardTileShell(titleHtml, badgeHtml, bodyHtml, footerHtml, nodeCardExtraClass = '') {
    const cardExtra = nodeCardExtraClass ? ` ${nodeCardExtraClass}` : '';
    return `
        <div class="cluster-scroll-item">
            <div class="node-card ups-node-card h-100${cardExtra}">
                <div class="d-flex justify-content-between align-items-center mb-2 gap-2">
                    <h5 class="mb-0 text-truncate d-inline-flex align-items-center gap-2">${titleHtml}</h5>
                    ${badgeHtml}
                </div>
                <div class="row g-2">
                    ${bodyHtml}
                </div>
                ${(!tilesMonitorTileFooterSuppressDepth && footerHtml) ? `<div class="small text-muted mt-2">${footerHtml}</div>` : ''}
            </div>
        </div>
    `;
}

function buildClusterDashboardUnavailableTile(title, message) {
    return buildClusterDashboardTileShell(
        escapeHtml(title),
        clusterTileHeaderStatusHtml('bg-secondary', t('statusDash') || '—'),
        `<div class="col-12"><small class="text-muted">${escapeHtml(message || (t('backupNoData') || 'Нет данных'))}</small></div>`,
        ''
    );
}

function buildClusterEmbedTileHtml(tile) {
    const kind = tile.embedKind === 'image' ? 'image' : 'html';
    const payload = String(tile.embedPayload || '');
    if (!payload) {
        return buildClusterDashboardUnavailableTile(
            t('settingsClusterTileTypeEmbed') || 'Embed',
            t('settingsClusterTileEmbedInvalid') || 'Configure content in tile settings'
        );
    }
    if (kind === 'image') {
        const url = sanitizeEmbedImageUrl(payload);
        if (!url) {
            return buildClusterDashboardUnavailableTile(
                t('settingsClusterTileTypeEmbed') || 'Embed',
                t('settingsClusterTileEmbedInvalid') || 'Invalid image URL'
            );
        }
        return `
            <div class="cluster-scroll-item tiles-embed-tile tiles-embed-tile--image">
                <div class="node-card tiles-embed-card h-100">
                    <div class="tiles-embed-image-wrap">
                        <img class="tiles-embed-img" src="${escapeHtml(url)}" alt="" loading="lazy" decoding="async" referrerpolicy="no-referrer" />
                    </div>
                </div>
            </div>
        `;
    }
    const srcdoc = escapeForIframeSrcdocAttr(payload);
    return `
        <div class="cluster-scroll-item tiles-embed-tile tiles-embed-tile--html">
            <div class="node-card tiles-embed-card tiles-embed-card--html h-100">
                <iframe class="tiles-embed-iframe" title="embed" sandbox="" referrerpolicy="no-referrer" srcdoc="${srcdoc}"></iframe>
            </div>
        </div>
    `;
}

function getClusterNetdevFieldValue(field) {
    const statusDisplay = field && field.statusDisplay;
    if (statusDisplay === 'connected') return t('netdevStatusConnected') || 'Подключён';
    if (statusDisplay === 'disconnected') return t('netdevStatusDisconnected') || 'Отключён';
    if (statusDisplay === 'unknown') return t('netdevStatusUnknown') || 'Неизвестно';
    const disp = field && field.displayValue != null ? String(field.displayValue).trim() : '';
    if (disp) return disp;
    const raw = field && field.value != null ? String(field.value).trim() : '';
    return raw ? formatNetdevMetricValue(raw) : '—';
}

function buildClusterServiceTileHtml(tile) {
    const id = clusterTileSourceNumericId(tile, 'service');
    if (getAuthHeadersForType('proxmox') && Number.isFinite(id)) {
        const service = (Array.isArray(monitoredServices) ? monitoredServices : []).find((svc) => Number(svc.id) === id);
        if (service) {
            const statusBadge = service.lastStatus === 'up'
                ? clusterTileHeaderStatusHtml('bg-success', t('connected'))
                : (service.lastStatus === 'down'
                    ? clusterTileHeaderStatusHtml('bg-danger', t('serverError'))
                    : clusterTileHeaderStatusHtml('bg-secondary', t('notConnected')));
            const target = getServiceTargetDisplay(service);
            const latency = typeof service.lastLatency === 'number' ? `${service.lastLatency} ms` : '—';
            const iconHtml = renderServiceIconHtml(service, 'service-monitor-icon');
            const bodyHtml = [
                `<div class="col-12"><div class="small text-muted mb-1"><span class="badge bg-secondary me-1">${escapeHtml((service.type || 'tcp').toUpperCase())}</span><code>${escapeHtml(target)}</code></div></div>`,
                buildClusterDashboardMetricCell(t('serviceLatencyHeader') || 'Latency', latency, null, null, 'col-6'),
                buildClusterDashboardMetricCell(t('serviceTypeLabel') || 'Type', (service.type || 'tcp').toUpperCase(), null, null, 'col-6')
            ].join('');
            return buildClusterDashboardTileShell(
                `${iconHtml}<span class="text-truncate">${escapeHtml(service.name || target)}</span>`,
                statusBadge,
                bodyHtml,
                ''
            );
        }
    }
    if (getAuthHeadersForType('truenas') && Array.isArray(lastTrueNASOverviewData?.services)) {
        const source = clusterTileSourceValue(tile, 'service');
        const numeric = parseInt(source, 10);
        const tnSvc = lastTrueNASOverviewData.services.find((svc, idx) =>
            String(svc?.entityId || svc?.id || svc?.name || '') === source
            || (Number.isFinite(numeric) && (Number(svc?.id) === numeric || (idx + 1) === numeric))
        );
        if (tnSvc) {
            const statusBadge = clusterTileHeaderStatusHtml(
                tnSvc.running ? 'bg-success' : 'bg-warning text-dark',
                tnSvc.running ? t('connected') : (t('serverError') || 'Error')
            );
            const bodyHtml = [
                buildClusterDashboardMetricCell(t('serviceTypeLabel') || 'Type', 'TrueNAS', null, null, 'col-6'),
                buildClusterDashboardMetricCell(t('monVmStatusCol') || 'Status', tnSvc.statusLabel || 'unknown', null, null, 'col-6')
            ].join('');
            return buildClusterDashboardTileShell(
                `<i class="bi bi-hdd-network me-2 text-info"></i><span class="text-truncate">${escapeHtml(tnSvc.name || 'Service')}</span>`,
                statusBadge,
                bodyHtml,
                ''
            );
        }
    }
    return buildClusterDashboardUnavailableTile(t('menuServicesMonitorText') || 'Service', t('servicesNotConfigured') || 'Сервис не найден');
}

function buildClusterVmTileHtml(tile) {
    const id = clusterTileSourceNumericId(tile, 'vmct');
    if (getAuthHeadersForType('proxmox') && Number.isFinite(id)) {
        const vm = getClusterVms().find((entry) => Number(entry.vmid != null ? entry.vmid : entry.id) === id);
        if (vm) {
            const status = vm.status || 'unknown';
            const statusClass = getVmStatusBadgeClass(status);
            const statusLabel = getVmStatusLabel(status);
            const typeLabel = (vm.type || 'vm').toUpperCase();
            const note = vm.node ? `${vm.node}${vm.vmid != null ? ` / ${vm.vmid}` : ''}` : (vm.note || '');
            const iconHtml = renderVmIconHtml(vm, 'vm-monitor-icon');
            const bodyHtml = [
                buildClusterDashboardMetricCell(t('monVmTypeCol') || 'Type', typeLabel, null, null, 'col-6'),
                buildClusterDashboardMetricCell(t('monVmNodeCol') || 'Node', vm.node || '—', null, null, 'col-6'),
                buildClusterDashboardMetricCell('ID', vm.vmid != null ? String(vm.vmid) : String(vm.id || '—'), null, null, 'col-6 mt-2'),
                buildClusterDashboardMetricCell(t('monVmStatusCol') || 'Status', statusLabel, null, null, 'col-6 mt-2')
            ].join('');
            return buildClusterDashboardTileShell(
                `${iconHtml}<span class="text-truncate">${escapeHtml(vm.name || `VM/CT ${id}`)}</span>`,
                clusterTileHeaderStatusHtml(statusClass, statusLabel),
                bodyHtml,
                escapeHtml(note)
            );
        }
    }
    if (getAuthHeadersForType('truenas') && Array.isArray(lastTrueNASOverviewData?.apps)) {
        const source = clusterTileSourceValue(tile, 'vmct');
        const numeric = parseInt(source, 10);
        const app = lastTrueNASOverviewData.apps.find((entry, idx) =>
            String(entry?.entityId || entry?.id || entry?.name || '') === source
            || (Number.isFinite(numeric) && (Number(entry?.id) === numeric || (idx + 1) === numeric))
        );
        if (app) {
            const statusClass = app.running ? 'bg-success' : 'bg-warning text-dark';
            const statusLabel = app.statusLabel || (app.running ? 'running' : 'stopped');
            const bodyHtml = [
                buildClusterDashboardMetricCell(t('monVmTypeCol') || 'Type', 'APP', null, null, 'col-6'),
                buildClusterDashboardMetricCell(t('monVmStatusCol') || 'Status', statusLabel, null, null, 'col-6')
            ].join('');
            return buildClusterDashboardTileShell(
                `<i class="bi bi-boxes me-2 text-primary"></i><span class="text-truncate">${escapeHtml(app.name || 'App')}</span>`,
                clusterTileHeaderStatusHtml(statusClass, statusLabel),
                bodyHtml,
                'TrueNAS Apps'
            );
        }
    }
    return buildClusterDashboardUnavailableTile(`VM/CT ${Number.isFinite(id) ? id : ''}`.trim(), t('vmListEmpty') || 'VM/CT не найден');
}

function buildClusterNetdevTileHtml(tile, payload) {
    const slot = clusterTileSourceNumericId(tile, 'netdev');
    const item = Array.isArray(payload?.items) ? payload.items.find((entry) => Number(entry.slot) === slot) : null;
    if (!item) {
        return buildClusterDashboardUnavailableTile(`SNMP ${Number.isFinite(slot) ? slot : ''}`.trim(), t('netdevNotConfigured') || 'Сетевое устройство не найдено');
    }
    const badgeClass = item.up ? 'bg-success' : 'bg-secondary';
    const statusLabel = item.up ? (t('statusOkShort') || 'OK') : (t('statusDash') || '—');
    const fields = (Array.isArray(item.fields) ? item.fields : [])
        .filter((field) => field && field.enabled !== false && String(field.oid || '').trim() !== '')
        .slice(0, 4);
    const bodyHtml = (fields.length ? fields : [{ label: t('backupNoData') || 'Нет данных', value: '—' }]).map((field, index) => {
        const label = field.label ? String(field.label).trim() : (String(field.oid || '').split('.').filter(Boolean).pop() || '—');
        const value = getClusterNetdevFieldValue(field);
        const cls = index >= 2 ? 'col-6 mt-2' : 'col-6';
        return buildClusterDashboardMetricCell(label, value, null, null, cls);
    }).join('');
    return buildClusterDashboardTileShell(
        escapeHtml(item.name || `SNMP ${slot}`),
        clusterTileHeaderStatusHtml(badgeClass, statusLabel),
        bodyHtml,
        escapeHtml(item.host ? `${t('netdevSnmpPrefix') || 'SNMP'} · ${item.host}` : (t('netdevSnmpPrefix') || 'SNMP'))
    );
}

function buildClusterSmartSensorMetricChartTileHtml(tile, payload, tileIndex, targetGridId) {
    const gid = tilesMonitorGridDomIdSuffix(targetGridId);
    const parsed = parseSmartSensorMetricChartSourceId(tile?.sourceId);
    if (!parsed) {
        return buildClusterDashboardUnavailableTile(
            t('settingsClusterTileTypeSmartSensorMetricChart') || 'Smart home graph',
            t('backupNoData') || 'Нет данных'
        );
    }
    const items = Array.isArray(payload?.items) ? payload.items : [];
    const item = items.find((it) => String(it?.id || '') === parsed.sensorId);
    if (!item) {
        return buildClusterDashboardUnavailableTile(
            t('settingsClusterTileTypeSmartSensor') || 'Sensor',
            t('smartSensorsNotConfigured') || 'Sensor not found'
        );
    }
    if (item.error) {
        return buildClusterDashboardUnavailableTile(item.name || parsed.sensorId, String(item.error));
    }
    const titleText = item.name || parsed.sensorId;
    const metricTitle = parsed.fieldKey;
    const emptyText = t('smartSensorMetricChartEmpty') || (t('upsAllMetricsChartEmpty') || 'No samples in the last 24 hours yet.');
    const footerHint = t('smartSensorMetricChartFooter') || (t('upsAllMetricsModalHint') || 'Last 24h');
    const footerText = `${titleText} · ${footerHint}`;
    const typeLabel = (item.type || '').toLowerCase() === 'ble' ? 'BLE' : 'REST';
    return buildTilesChartTileShell({
        titleText: metricTitle,
        badgeHtml: clusterTileHeaderStatusHtml('bg-info text-dark', typeLabel),
        footerText,
        emptyId: `smartSensorMetricTileEmpty_${gid}_${tileIndex}`,
        canvasId: `smartSensorMetricTileCanvas_${gid}_${tileIndex}`,
        emptyText,
        canvasAttrs: {
            ...tilesChartAxisOptionsDatasetAttr(),
            'data-tile-variant': normalizeTileChartVariant(tile?.chartDisplayVariant, 'area'),
            'data-chart-window-min': String(normalizeChartWindowMinutes(tile?.chartWindowMin, 1440)),
            'data-smart-sensor-metric-tile': '1',
            'data-tile-compact': '1',
            'data-sensor-id': parsed.sensorId,
            'data-field-key': parsed.fieldKey,
            'data-metric-title': metricTitle
        }
    });
}

function buildClusterSmartSensorTileHtml(tile, payload) {
    const sensorId = clusterTileSourceValue(tile, 'smart_sensor');
    const items = Array.isArray(payload?.items) ? payload.items : [];
    const item = items.find((it) => String(it?.id || '') === sensorId);
    if (!item) {
        return buildClusterDashboardUnavailableTile(
            t('settingsClusterTileTypeSmartSensor') || 'Sensor',
            t('smartSensorsNotConfigured') || 'Sensor not found'
        );
    }
    if (item.error) {
        return buildClusterDashboardUnavailableTile(item.name || sensorId, String(item.error));
    }
    const vals = item.values && typeof item.values === 'object' ? item.values : {};
    const keys = Object.keys(vals).slice(0, 4);
    const bodyHtml = (keys.length
        ? keys.map((k, index) => {
            const cls = index >= 2 ? 'col-6 mt-2' : 'col-6';
            return buildClusterDashboardMetricCell(k, formatSmartSensorMetricEntry(vals[k]), null, null, cls);
        })
        : [buildClusterDashboardMetricCell(t('backupNoData') || '—', '—', null, null, 'col-6')]
    ).join('');
    const typeLabel = (item.type || '').toLowerCase() === 'ble' ? 'BLE' : 'REST';
    return buildClusterDashboardTileShell(
        `<i class="bi bi-broadcast-pin me-2 text-info"></i><span class="text-truncate">${escapeHtml(item.name || sensorId)}</span>`,
        clusterTileHeaderStatusHtml('bg-info text-dark', typeLabel),
        bodyHtml,
        escapeHtml(t('monitorScreenSmartSensors') || '')
    );
}

function buildClusterUpsTileHtml(tile, payload) {
    const slot = clusterTileSourceNumericId(tile, 'ups');
    const item = Array.isArray(payload?.items) ? payload.items.find((entry) => Number(entry.slot) === slot) : null;
    if (!item) {
        return buildClusterDashboardUnavailableTile(`UPS ${Number.isFinite(slot) ? slot : ''}`.trim(), t('upsNotConfigured') || 'UPS не настроен');
    }
    if (item.error) {
        return buildClusterDashboardUnavailableTile(item.name || `UPS ${slot}`, String(item.error));
    }
    const statusLabel = item.status?.label ?? (item.status?.raw != null ? String(item.status.raw) : '—');
    const up = item.status?.up;
    let badgeClass = 'bg-secondary';
    const lowStr = String(statusLabel).toLowerCase();
    if (lowStr.includes('low')) badgeClass = 'bg-danger';
    else if (up === true) badgeClass = 'bg-success';
    else if (up === false) badgeClass = 'bg-warning text-dark';

    const electrical = item.electrical || {};
    const inVText = formatUpsMetric(electrical.inputVoltage, ' V');
    const loadText = formatUpsMetric(electrical.loadPercent, ' %');
    const chargePct = item.battery?.chargePct;
    const chargeText = (chargePct != null && Number.isFinite(Number(chargePct)))
        ? `${chargePct}%`
        : (item.battery?.chargeRaw != null ? String(item.battery.chargeRaw) : '—');
    const runtimeText = item.battery?.runtimeFormatted != null
        ? item.battery.runtimeFormatted
        : (item.battery?.runtimeRaw != null ? String(item.battery.runtimeRaw) : '—');

    const ul = {
        inV: t('upsLabelInputVoltage') || 'Вход U',
        load: t('upsLabelLoad') || 'Нагрузка',
        charge: t('upsLabelCharge') || 'Заряд',
        runtime: t('upsLabelRuntime') || 'Время на батарее'
    };
    const loadPctNum = electrical.loadPercent && typeof electrical.loadPercent.value === 'number'
        ? electrical.loadPercent.value
        : null;
    const chargeBarNum = (chargePct != null && Number.isFinite(Number(chargePct))) ? Number(chargePct) : null;

    let bodyHtml;
    if (Array.isArray(item.fields) && item.fields.length > 0) {
        bodyHtml = item.fields
            .map((f, idx) => {
                if (!f || f.ok === false) return null;
                const disp = f.display != null ? String(f.display) : '';
                if (disp === '' || disp === '—') return null;
                const lbl = (f.label && String(f.label).trim()) || f.id || '—';
                const bar =
                    (f.id === 'load' || f.id === 'charge' || f.format === 'percent') &&
                    typeof f.value === 'number' &&
                    Number.isFinite(f.value)
                        ? f.value
                        : null;
                const colClass = 'col-6' + (idx >= 2 ? ' mt-2' : '');
                return buildClusterDashboardMetricCell(lbl, disp, bar, bar != null ? 'bg-success' : null, colClass);
            })
            .filter(Boolean)
            .join('');
        if (!bodyHtml) {
            bodyHtml = buildClusterDashboardMetricCell(t('backupNoData') || '—', '—', null, null, 'col-6');
        }
    } else {
        bodyHtml = [
            buildClusterDashboardMetricCell(ul.inV, inVText, null, null, 'col-6'),
            buildClusterDashboardMetricCell(ul.load, loadText, loadPctNum, 'bg-warning', 'col-6'),
            buildClusterDashboardMetricCell(ul.charge, chargeText, chargeBarNum, 'bg-success', 'col-6 mt-2'),
            buildClusterDashboardMetricCell(ul.runtime, runtimeText, null, null, 'col-6 mt-2')
        ].join('');
    }
    const name = item.name || `UPS ${item.slot}`;
    const backend = item.type ? String(item.type).toUpperCase() : 'UPS';
    const footer = item.host ? `${backend} · ${item.host}` : backend;
    return buildClusterDashboardTileShell(
        `<i class="bi bi-lightning-charge me-2 text-warning"></i><span class="text-truncate">${escapeHtml(name)}</span>`,
        clusterTileHeaderStatusHtml(badgeClass, statusLabel),
        bodyHtml,
        escapeHtml(footer)
    );
}

/** Превью в настройках (#tilesNormalGrid) и экран монитора (#tilesMonitorGrid) оба в DOM — id canvas должны различаться, иначе Chart.js и chartMap цепляются к первому элементу. */
function tilesMonitorGridDomIdSuffix(targetGridId) {
    const s = String(targetGridId || 'grid').replace(/[^a-zA-Z0-9_-]/g, '_');
    return s || 'grid';
}

/** Живой грид плиток монитора: не рисуем/не обновляем Chart после await, если пользователь уже ушёл с экрана — иначе 0×0 и «пустые» графики. */
function isTilesMonitorLiveContextOk(targetGridId) {
    if (targetGridId !== 'tilesMonitorGrid') return true;
    if (!monitorMode || monitorCurrentView !== 'tiles') return false;
    const sec = document.getElementById('tilesMonitorSection');
    if (!sec) return false;
    const cs = window.getComputedStyle(sec);
    return cs.display !== 'none' && cs.visibility !== 'hidden';
}

function tilesChartAxisOptionsDatasetAttr() {
    return {
        'data-tile-axis-time': monitorTilesChartAxisTime ? '1' : '0',
        'data-tile-axis-values': monitorTilesChartAxisValues ? '1' : '0',
        'data-tile-axis-y-unit': monitorTilesChartAxisYUnit ? '1' : '0',
        'data-tile-variant': tilesChartDisplayVariant
    };
}

let upsMetricTileCharts = {}; // key: canvas.id
let clusterMetricTileCharts = {}; // key: canvas.id
let hostNodeMetricTileCharts = {}; // key: canvas.id
let smartSensorMetricTileCharts = {}; // key: canvas.id

function resizeTilesCharts() {
    const sets = [upsMetricTileCharts, clusterMetricTileCharts, hostNodeMetricTileCharts, smartSensorMetricTileCharts];
    for (const map of sets) {
        for (const key of Object.keys(map || {})) {
            const ch = map[key];
            if (!ch) continue;
            try { ch.resize(); } catch (_) {}
            try { ch.update('none'); } catch (_) {}
            const cv = ch.canvas;
            if (cv instanceof HTMLCanvasElement) applyTilesChartPointStyleToChart(ch, cv);
        }
    }
}

function pruneChartMap(chartMap, canvases) {
    const alive = new Set((Array.isArray(canvases) ? canvases : []).filter((c) => c instanceof HTMLCanvasElement));
    for (const key of Object.keys(chartMap || {})) {
        const chart = chartMap[key];
        const chartCanvas = chart && chart.canvas;
        const keep =
            chartCanvas instanceof HTMLCanvasElement &&
            alive.has(chartCanvas) &&
            chartCanvas.isConnected;
        if (!keep) {
            try { chart?.destroy?.(); } catch (_) {}
            delete chartMap[key];
        }
    }
}

function lineChartLabelsFromSeries(series) {
    const locale = currentLanguage === 'ru' ? 'ru-RU' : 'en-US';
    return (Array.isArray(series) ? series : []).map((p) => new Date(p.t).toLocaleTimeString(locale, { hour: '2-digit', minute: '2-digit', second: '2-digit' }));
}

/** Сжатие ряда для компактных графиков на Tiles: тысячи точек → тяжёлый Chart.js и main thread. */
const TILES_METRIC_CHART_MAX_POINTS = 240;

function downsampleMetricSeriesEvenly(series, maxPoints) {
    const arr = Array.isArray(series) ? series : [];
    const cap = Math.max(8, Math.min(2000, Number(maxPoints) || TILES_METRIC_CHART_MAX_POINTS));
    if (arr.length <= cap) return arr;
    const step = (arr.length - 1) / (cap - 1);
    const out = [];
    for (let i = 0; i < cap; i++) {
        const idx = i === cap - 1 ? arr.length - 1 : Math.round(i * step);
        out.push(arr[idx]);
    }
    return out;
}

function showTileEmptyIfNoChart({ canvas, emptyEl, chartMap, message }) {
    if (!canvas || !emptyEl) return;
    const mapped = chartMap && chartMap[canvas.id];
    if (mapped && mapped.canvas === canvas) return; // не мигать при временной ошибке, если график уже на этом canvas
    emptyEl.textContent = String(message || '');
    canvas.classList.add('d-none');
    emptyEl.classList.remove('d-none');
}

function showTileChart({ canvas, emptyEl }) {
    if (emptyEl) emptyEl.classList.add('d-none');
    if (canvas) canvas.classList.remove('d-none');
}

function updateOrCreateLineChart({ canvas, chartMap, series, dsLabel, lineRgb, yUnit }) {
    const isTileMetric = canvas?.dataset?.tileCompact === '1';
    const seriesForChart = isTileMetric && Array.isArray(series) && series.length > TILES_METRIC_CHART_MAX_POINTS
        ? downsampleMetricSeriesEvenly(series, TILES_METRIC_CHART_MAX_POINTS)
        : series;
    let existing = chartMap ? chartMap[canvas.id] : null;
    if (existing && existing.canvas !== canvas) {
        try { existing.destroy(); } catch (_) {}
        delete chartMap[canvas.id];
        existing = null;
    }
    if (existing) {
        existing.data.labels = lineChartLabelsFromSeries(seriesForChart);
        if (existing.data?.datasets?.[0]) {
            existing.data.datasets[0].data = seriesForChart.map((p) => p.v);
            existing.data.datasets[0].label = dsLabel;
            const tileVariant = String(canvas?.dataset?.tileVariant || 'area').toLowerCase();
            existing.data.datasets[0].fill = tileVariant === 'area';
            existing.data.datasets[0].tension = (tileVariant === 'line' || tileVariant === 'minimal') ? 0.12 : 0.2;
        }
        const showAxisTime = canvas?.dataset?.tileAxisTime !== '0';
        const showAxisValues = canvas?.dataset?.tileAxisValues !== '0';
        const showAxisYUnit = canvas?.dataset?.tileAxisYUnit !== '0';
        const yTitleText = (yUnit && String(yUnit).trim()) ? String(yUnit).trim() : '';
        const sx = existing.options?.scales?.x;
        const sy = existing.options?.scales?.y;
        if (sx?.ticks) sx.ticks.display = showAxisTime;
        if (sy?.ticks) sy.ticks.display = showAxisValues;
        if (sy?.title) {
            sy.title.display = !!(showAxisYUnit && yTitleText);
            sy.title.text = yUnit;
        }
        try { existing.update('none'); } catch (_) {}
        applyTilesChartPointStyleToChart(existing, canvas);
        return existing;
    }
    const chart = renderHostNodeMetricLineChart(canvas, seriesForChart, dsLabel, lineRgb, yUnit);
    if (chartMap) chartMap[canvas.id] = chart;
    return chart;
}

function destroyUpsMetricTileCharts() {
    for (const chartKey of Object.keys(upsMetricTileCharts)) {
        const chart = upsMetricTileCharts[chartKey];
        try {
            if (chart && typeof chart.destroy === 'function') chart.destroy();
        } catch (_) {}
    }
    upsMetricTileCharts = {};
}

function destroyClusterMetricTileCharts() {
    for (const chartKey of Object.keys(clusterMetricTileCharts)) {
        const chart = clusterMetricTileCharts[chartKey];
        try {
            if (chart && typeof chart.destroy === 'function') chart.destroy();
        } catch (_) {}
    }
    clusterMetricTileCharts = {};
}

function destroyHostNodeMetricTileCharts() {
    for (const chartKey of Object.keys(hostNodeMetricTileCharts)) {
        const chart = hostNodeMetricTileCharts[chartKey];
        try {
            if (chart && typeof chart.destroy === 'function') chart.destroy();
        } catch (_) {}
    }
    hostNodeMetricTileCharts = {};
}

function destroySmartSensorMetricTileCharts() {
    for (const chartKey of Object.keys(smartSensorMetricTileCharts)) {
        const chart = smartSensorMetricTileCharts[chartKey];
        try {
            if (chart && typeof chart.destroy === 'function') chart.destroy();
        } catch (_) {}
    }
    smartSensorMetricTileCharts = {};
}

function parseUpsMetricTileSourceId(sourceId) {
    const s = String(sourceId || '').trim();
    const m = /^ups_metric_chart:(\d+):(.+)$/.exec(s);
    if (!m) return null;
    return {
        slot: parseInt(m[1], 10),
        metricId: String(m[2] || '').trim()
    };
}

function parseClusterMetricTileSourceId(sourceId) {
    const s = String(sourceId || '').trim();
    const m = /^cluster_metric_chart:(cpu|mem)$/.exec(s);
    if (!m) return null;
    return { metric: m[1] };
}

function parseHostNodeMetricTileSourceId(sourceId) {
    const s = String(sourceId || '').trim();
    const m = /^host_node_metric_chart:([^:]+):(temp|cpu|mem)$/.exec(s);
    if (!m) return null;
    return { node: String(m[1] || '').trim(), metric: String(m[2] || '').trim().toLowerCase() };
}

function parseSmartSensorMetricChartSourceId(sourceId) {
    const p = 'smart_sensor_metric_chart:';
    const s = String(sourceId || '').trim();
    if (!s.startsWith(p)) return null;
    const rest = s.slice(p.length);
    const idx = rest.indexOf(':');
    if (idx < 0) return null;
    const sensorId = rest.slice(0, idx);
    let fieldKey = rest.slice(idx + 1);
    try {
        fieldKey = decodeURIComponent(fieldKey);
    } catch {
        return null;
    }
    if (!String(sensorId).trim() || !String(fieldKey).trim()) return null;
    return { sensorId: String(sensorId).trim(), fieldKey: String(fieldKey).trim() };
}

/** Ключи полей values, как на сервере в pollOneRest / BLE (для выбора графика в плитке). */
function computeSmartSensorFieldKeysForConfig(cfg) {
    if (!cfg || cfg.enabled === false) return [];
    const type = String(cfg.type || 'rest').toLowerCase() === 'ble' ? 'ble' : 'rest';
    if (type === 'rest') {
        const usedKeys = new Set();
        const out = [];
        const fields = Array.isArray(cfg.restFields) ? cfg.restFields : [];
        for (const f of fields) {
            if (!f || f.enabled === false) continue;
            const path = f.path != null ? String(f.path).trim() : '';
            if (!path) continue;
            let baseKey = f.label != null ? String(f.label).trim() : '';
            if (!baseKey) {
                const parts = path.split('.').filter(Boolean);
                baseKey = (parts.length ? parts[parts.length - 1] : 'value') || 'value';
            }
            baseKey = baseKey.slice(0, 64);
            let outKey = baseKey;
            let n = 2;
            while (usedKeys.has(outKey)) {
                outKey = `${baseKey}_${n++}`;
            }
            usedKeys.add(outKey);
            out.push({ fieldKey: outKey, label: baseKey });
        }
        return out;
    }
    const chans = Array.isArray(cfg.bleChannels) ? cfg.bleChannels : [];
    return chans.map((spec) => {
        const key = spec && spec.metric === 'custom' ? (spec.label || 'custom') : (spec && spec.metric) || 'value';
        const fk = String(key || 'value').trim();
        return { fieldKey: fk, label: fk };
    });
}

function buildTilesChartCanvasAttrs(attrs) {
    const obj = attrs && typeof attrs === 'object' ? attrs : {};
    return Object.keys(obj)
        .filter((k) => obj[k] != null && String(obj[k]).trim() !== '')
        .map((k) => `${escapeHtml(k)}="${escapeHtml(String(obj[k]))}"`)
        .join(' ');
}

function buildTilesChartTileBodyHtml({ emptyId, canvasId, emptyText, canvasAttrs }) {
    const emptyTextEsc = escapeHtml(emptyText || '');
    const canvasAttrsStr = buildTilesChartCanvasAttrs(canvasAttrs);
    return `
        <div class="col-12 tiles-ups-metric-chart-host d-flex flex-column p-0">
            <div class="tiles-ups-metric-chart-wrap position-relative d-flex flex-column flex-grow-1 min-height-0" style="overflow: hidden;">
                <div id="${escapeHtml(emptyId)}" class="tiles-ups-metric-chart-empty bg-opacity-10 border-0 text-muted small d-flex align-items-center justify-content-center flex-grow-1" style="min-height: 0; padding: 0.25rem;">
                    ${emptyTextEsc}
                </div>
                <canvas id="${escapeHtml(canvasId)}"
                    class="w-100 flex-grow-1 d-none"
                    style="height: 100%; min-height: 0; width: 100%;"
                    ${canvasAttrsStr}>
                </canvas>
            </div>
        </div>
    `;
}

function buildTilesChartTileShell({ titleText, badgeHtml, footerText, emptyId, canvasId, emptyText, canvasAttrs }) {
    return buildClusterDashboardTileShell(
        `<i class="bi bi-graph-up-arrow me-2 text-primary"></i><span class="text-truncate">${escapeHtml(titleText || '')}</span>`,
        badgeHtml || '',
        buildTilesChartTileBodyHtml({ emptyId, canvasId, emptyText, canvasAttrs }),
        escapeHtml(footerText || '')
    );
}

function buildClusterUpsMetricChartTileHtml(tile, payload, tileIndex, targetGridId) {
    const gid = tilesMonitorGridDomIdSuffix(targetGridId);
    const parsed = parseUpsMetricTileSourceId(tile?.sourceId);
    if (!parsed || !Number.isFinite(parsed.slot) || !parsed.metricId) {
        return buildClusterDashboardUnavailableTile(t('settingsClusterTileTypeUpsMetricChart') || 'UPS graph', t('backupNoData') || 'Нет данных');
    }

    const slot = parsed.slot;
    const metricId = parsed.metricId;
    const item = Array.isArray(payload?.items) ? payload.items.find((entry) => Number(entry.slot) === slot) : null;

    if (!item) {
        return buildClusterDashboardUnavailableTile(`UPS ${slot}`, t('upsNotConfigured') || 'UPS не настроен');
    }

    if (item.error) {
        return buildClusterDashboardUnavailableTile(item.name || `UPS ${slot}`, String(item.error));
    }

    const statusLabel = item.status?.label ?? (item.status?.raw != null ? String(item.status.raw) : '—');
    const up = item.status?.up;
    let badgeClass = 'bg-secondary';
    const lowStr = String(statusLabel).toLowerCase();
    if (lowStr.includes('low')) badgeClass = 'bg-danger';
    else if (up === true) badgeClass = 'bg-success';
    else if (up === false) badgeClass = 'bg-warning text-dark';

    const fields = Array.isArray(item.fields) ? item.fields : [];
    const metricField = fields.find((f) => String(f?.id || '').trim() === metricId) || null;
    const metricLabel = metricField?.label != null && String(metricField.label).trim() !== '' ? String(metricField.label).trim() : metricId;
    const metricFormatHint = metricField?.format != null ? String(metricField.format).trim() : '';

    const emptyText = t('upsAllMetricsChartEmpty') || 'No samples in the last 24 hours yet.';
    const footer = t('upsAllMetricsModalHint') || 'Last 24h';

    return buildTilesChartTileShell({
        titleText: metricLabel,
        badgeHtml: clusterTileHeaderStatusHtml(badgeClass, statusLabel),
        footerText: footer,
        emptyId: `upsMetricTileEmpty_${gid}_${tileIndex}`,
        canvasId: `upsMetricTileCanvas_${gid}_${tileIndex}`,
        emptyText,
        canvasAttrs: {
            ...tilesChartAxisOptionsDatasetAttr(),
            'data-tile-variant': normalizeTileChartVariant(tile?.chartDisplayVariant, 'area'),
            'data-chart-window-min': String(normalizeChartWindowMinutes(tile?.chartWindowMin, 1440)),
            'data-ups-metric-tile': '1',
            'data-tile-compact': '1',
            'data-ups-slot': String(slot),
            'data-ups-metric-id': metricId,
            'data-ups-metric-label': metricLabel,
            'data-ups-metric-format': metricFormatHint
        }
    });
}

async function initUpsMetricChartTiles(targetGridId) {
    const gridEl = document.getElementById(targetGridId);
    if (!gridEl) return;
    if (typeof Chart === 'undefined') return;
    const gid = tilesMonitorGridDomIdSuffix(targetGridId);
    const canvasIdPrefix = `upsMetricTileCanvas_${gid}_`;
    const emptyText = t('upsAllMetricsChartEmpty') || 'No samples in the last 24 hours yet.';
    const canvases = Array.from(gridEl.querySelectorAll('canvas[data-ups-metric-tile="1"]'));
    pruneChartMap(upsMetricTileCharts, canvases);

    await Promise.all(canvases.map(async (canvas) => {
        const idStr = String(canvas?.id || '');
        const tileIndexNum = idStr.startsWith(canvasIdPrefix)
            ? parseInt(idStr.slice(canvasIdPrefix.length), 10)
            : NaN;
        const emptyEl = document.getElementById(`upsMetricTileEmpty_${gid}_${tileIndexNum}`);

        const slot = parseInt(canvas.dataset.upsSlot, 10);
        const metricId = String(canvas.dataset.upsMetricId || '').trim();
        const metricLabel = String(canvas.dataset.upsMetricLabel || '').trim() || metricId;
        const metricFormatHint = String(canvas.dataset.upsMetricFormat || '').trim();

        if (!Number.isFinite(slot) || !metricId || !emptyEl) return;

        try {
            const url = `/api/ups/metric-history?slot=${encodeURIComponent(slot)}&metric=${encodeURIComponent(metricId)}`;
            const res = await fetch(url);
            const data = await res.json().catch(() => ({}));
            if (!isTilesMonitorLiveContextOk(targetGridId)) return;

            if (!res.ok || data?.error) {
                showTileEmptyIfNoChart({ canvas, emptyEl, chartMap: upsMetricTileCharts, message: String(data?.error || `HTTP ${res.status}` || emptyText) });
                return;
            }

            const tileWindowMin = normalizeChartWindowMinutes(canvas.dataset.chartWindowMin, chartWindowUpsMetricMin);
            const points = filterSeriesByWindowMinutes(parseMetricHistoryPoints(data?.points), tileWindowMin);
            const metricFormat = data?.metricFormat != null ? String(data.metricFormat).trim() : metricFormatHint;

            if (!points.length) {
                showTileEmptyIfNoChart({ canvas, emptyEl, chartMap: upsMetricTileCharts, message: emptyText });
                return;
            }
            showTileChart({ canvas, emptyEl });

            const series = points.map((p) => ({
                t: p.t,
                v: (String(metricFormat || '').trim().toLowerCase() === 'time') ? (p.v / 3600) : p.v
            }));

            const yUnit = upsMetricYUnitFromFormat(metricFormat);
            const lineRgb = upsMetricColorFromFormat(metricFormat);
            updateOrCreateLineChart({
                canvas,
                chartMap: upsMetricTileCharts,
                series,
                dsLabel: metricLabel,
                lineRgb,
                yUnit
            });
        } catch (e) {
            showTileEmptyIfNoChart({ canvas, emptyEl, chartMap: upsMetricTileCharts, message: String(e?.message || e || emptyText) });
        }
    }));
}

function buildClusterClusterMetricChartTileHtml(tile, tileIndex, targetGridId) {
    const gid = tilesMonitorGridDomIdSuffix(targetGridId);
    const parsed = parseClusterMetricTileSourceId(tile?.sourceId);
    const metric = parsed?.metric;
    const title =
        metric === 'mem'
            ? (t('clusterAggregateMemChartTitle') || 'Cluster RAM')
            : (t('clusterAggregateCpuChartTitle') || 'Cluster CPU');
    const emptyText = t('clusterAggregateMetricChartEmpty') || (t('upsAllMetricsChartEmpty') || 'No samples in the last 24 hours yet.');
    const footer = t('clusterAggregateMetricsModalHint') || 'Last 24h';

    return buildTilesChartTileShell({
        titleText: title,
        badgeHtml: clusterTileHeaderStatusHtml('bg-primary', 'PVE'),
        footerText: footer,
        emptyId: `clusterMetricTileEmpty_${gid}_${tileIndex}`,
        canvasId: `clusterMetricTileCanvas_${gid}_${tileIndex}`,
        emptyText,
        canvasAttrs: {
            ...tilesChartAxisOptionsDatasetAttr(),
            'data-tile-variant': normalizeTileChartVariant(tile?.chartDisplayVariant, 'area'),
            'data-chart-window-min': String(normalizeChartWindowMinutes(tile?.chartWindowMin, 1440)),
            'data-cluster-metric-tile': '1',
            'data-tile-compact': '1',
            'data-cluster-metric': metric || 'cpu'
        }
    });
}

async function initClusterMetricChartTiles(targetGridId) {
    const gridEl = document.getElementById(targetGridId);
    if (!gridEl) return;
    if (typeof Chart === 'undefined') return;
    const gid = tilesMonitorGridDomIdSuffix(targetGridId);
    const canvasIdPrefix = `clusterMetricTileCanvas_${gid}_`;
    const canvases = Array.from(gridEl.querySelectorAll('canvas[data-cluster-metric-tile="1"]'));
    pruneChartMap(clusterMetricTileCharts, canvases);
    if (!canvases.length) return;

    const headers = getCurrentProxmoxHeaders();
    const emptyText = t('clusterAggregateMetricChartEmpty') || 'No samples in the last 24 hours yet.';
    const needConnText = t('hostMetricsNeedConnection') || 'Connect to Proxmox first.';

    await Promise.all(canvases.map(async (canvas) => {
        const idStr = String(canvas?.id || '');
        const tileIndexNum = idStr.startsWith(canvasIdPrefix)
            ? parseInt(idStr.slice(canvasIdPrefix.length), 10)
            : NaN;
        const emptyEl = document.getElementById(`clusterMetricTileEmpty_${gid}_${tileIndexNum}`);
        const metric = String(canvas.dataset.clusterMetric || '').trim().toLowerCase() === 'mem' ? 'mem' : 'cpu';
        if (!emptyEl) return;

        if (!headers) {
            showTileEmptyIfNoChart({ canvas, emptyEl, chartMap: clusterMetricTileCharts, message: needConnText });
            return;
        }

        try {
            const url = `/api/cluster/metric-history?metric=${encodeURIComponent(metric)}`;
            const res = await fetch(url, { headers });
            const data = await res.json().catch(() => ({}));
            if (!isTilesMonitorLiveContextOk(targetGridId)) return;

            if (!res.ok || data?.error) {
                showTileEmptyIfNoChart({ canvas, emptyEl, chartMap: clusterMetricTileCharts, message: String(data?.error || `HTTP ${res.status}` || emptyText) });
                return;
            }

            const tileWindowMin = normalizeChartWindowMinutes(canvas.dataset.chartWindowMin, chartWindowClusterMetricMin);
            const points = filterSeriesByWindowMinutes(parseMetricHistoryPoints(data?.points), tileWindowMin);
            if (!points.length) {
                showTileEmptyIfNoChart({ canvas, emptyEl, chartMap: clusterMetricTileCharts, message: emptyText });
                return;
            }

            showTileChart({ canvas, emptyEl });

            const title =
                metric === 'mem'
                    ? (t('clusterAggregateMemChartTitle') || 'Cluster RAM')
                    : (t('clusterAggregateCpuChartTitle') || 'Cluster CPU');
            const lineRgb = metric === 'mem' ? '102, 16, 242' : '220, 53, 69';
            updateOrCreateLineChart({
                canvas,
                chartMap: clusterMetricTileCharts,
                series: points,
                dsLabel: title,
                lineRgb,
                yUnit: '%'
            });
        } catch (e) {
            showTileEmptyIfNoChart({ canvas, emptyEl, chartMap: clusterMetricTileCharts, message: String(e?.message || e || emptyText) });
        }
    }));
}

function hostNodeMetricTileMeta(metric) {
    const m = String(metric || '').toLowerCase();
    if (m === 'temp') return { label: t('hostMetricsCpuTempLabel') || 'CPU temp', lineRgb: '13, 110, 253', yUnit: '°C' };
    if (m === 'mem') return { label: t('nodeRam') || 'RAM', lineRgb: '102, 16, 242', yUnit: '%' };
    return { label: t('nodeCpu') || 'CPU', lineRgb: '220, 53, 69', yUnit: '%' };
}

function buildClusterHostNodeMetricChartTileHtml(tile, tileIndex, targetGridId) {
    const gid = tilesMonitorGridDomIdSuffix(targetGridId);
    const parsed = parseHostNodeMetricTileSourceId(tile?.sourceId);
    const node = parsed?.node || 'pve';
    const metric = parsed?.metric || 'cpu';
    const meta = hostNodeMetricTileMeta(metric);
    const title = `${node}: ${meta.label}`;
    const emptyText = t('hostNodeMetricChartEmptyLoadMem') || t('hostNodeCpuTempChartEmpty') || (t('upsAllMetricsChartEmpty') || 'No samples in the last 24 hours yet.');
    const footer = t('hostNodeAllMetricsModalHint') || (t('clusterAggregateMetricsModalHint') || 'Last 24h');

    return buildTilesChartTileShell({
        titleText: title,
        badgeHtml: clusterTileHeaderStatusHtml('bg-primary', 'PVE'),
        footerText: footer,
        emptyId: `hostNodeMetricTileEmpty_${gid}_${tileIndex}`,
        canvasId: `hostNodeMetricTileCanvas_${gid}_${tileIndex}`,
        emptyText,
        canvasAttrs: {
            ...tilesChartAxisOptionsDatasetAttr(),
            'data-tile-variant': normalizeTileChartVariant(tile?.chartDisplayVariant, 'area'),
            'data-chart-window-min': String(normalizeChartWindowMinutes(tile?.chartWindowMin, 1440)),
            'data-host-node-metric-tile': '1',
            'data-tile-compact': '1',
            'data-host-node': node,
            'data-host-metric': metric
        }
    });
}

/** KPI-карточка узла кластера (ЦПУ, ОЗУ, аптайм, ядра, temp/link с агента) — как на вкладке «Узлы». */
function buildClusterNodeKpiTileHtml(tile) {
    const nodeName = clusterTileSourceValue(tile, 'cluster_node');
    const typeLabel = t('settingsClusterTileTypeClusterNode') || 'Cluster node';
    if (!nodeName) {
        return buildClusterDashboardUnavailableTile(typeLabel, t('backupNoData') || '—');
    }
    if (!lastClusterData || !Array.isArray(lastClusterData.nodes)) {
        return buildClusterDashboardUnavailableTile(nodeName, t('backupNoData') || 'Нет данных');
    }
    const node = lastClusterData.nodes.find((n) => String(n.name || '') === nodeName);
    if (!node) {
        return buildClusterDashboardUnavailableTile(nodeName, t('storageNotFound') || 'Узел не найден');
    }
    const hostMetric = (lastHostMetricsData && Array.isArray(lastHostMetricsData.items))
        ? lastHostMetricsData.items.find((item) => String(item.node || '') === nodeName)
        : null;
    const hostMetricsRenderSettings = normalizeHostMetricsSettingsClient((lastHostMetricsData && lastHostMetricsData.settings) || hostMetricsSettings);
    const nodeOnline = String(node.status || '').toLowerCase() === 'online';
    const hostMetricProblems = getHostMetricProblemMessages(hostMetric, hostMetricsRenderSettings);
    const hostMetricWarning = nodeOnline && hostMetricProblems.length
        ? `<span class="badge bg-warning text-dark ms-2 host-problem-trigger" role="button" tabindex="0" data-problem-lines="${escapeHtml(hostMetricProblems.join('\n'))}" title="${escapeHtml(t('toastWarning') || 'Warning')}"><i class="bi bi-exclamation-triangle-fill"></i></span>`
        : '';
    const nodeIpDisplay = node.ip || (hostMetric && hostMetric.nodeIp) || '';
    const nodeIpLine = nodeIpDisplay
        ? `<div class="small text-muted mt-1"><i class="bi bi-hdd-network me-1"></i>${escapeHtml(String(nodeIpDisplay))}</div>`
        : '';
    const cardClass = nodeOnline
        ? 'node-card ups-node-card h-100 host-node-card-chart-trigger cursor-pointer'
        : 'node-card ups-node-card h-100';
    const cardAttrs = nodeOnline
        ? ` data-node="${escapeHtml(node.name)}" role="button" tabindex="0" title="${escapeHtml(t('hostNodeAllMetricsCardOpenTitle') || '')}"`
        : '';
    const cpuPct = Number(node.cpu);
    const memPct = Number(node.memory);
    const cpuW = Number.isFinite(cpuPct) ? Math.min(100, Math.max(0, cpuPct)) : 0;
    const memW = Number.isFinite(memPct) ? Math.min(100, Math.max(0, memPct)) : 0;
    const metricsBlock = nodeOnline
        ? `
                    <div class="row g-2">
                        <div class="col-6">
                            <small class="text-muted">${escapeHtml(t('nodeCpu'))}</small>
                            <div class="fw-bold">${escapeHtml(String(node.cpu))}%</div>
                            <div class="progress"><div class="progress-bar ${getColorClass(node.cpu, 'cpu')}" style="width: ${cpuW}%"></div></div>
                        </div>
                        <div class="col-6">
                            <small class="text-muted">${escapeHtml(t('nodeRam'))}</small>
                            <div class="fw-bold">${escapeHtml(String(node.memory))}%</div>
                            <div class="progress"><div class="progress-bar ${getColorClass(node.memory, 'ram')}" style="width: ${memW}%"></div></div>
                        </div>
                        <div class="col-6 mt-2">
                            <small class="text-muted">${escapeHtml(t('nodeUptime'))}</small>
                            <div class="fw-bold">${escapeHtml(formatUptime(node.uptime))}</div>
                        </div>
                        <div class="col-6 mt-2">
                            <small class="text-muted">${escapeHtml(t('nodeCpuCores'))}</small>
                            <div class="fw-bold">${escapeHtml(String(node.cpuCount != null ? node.cpuCount : '—'))}</div>
                        </div>
                        ${formatHostMetricsNodeExtras(hostMetric, node.name)}
                    </div>`
        : '';
    return `
            <div class="cluster-scroll-item">
                <div class="${cardClass}"${cardAttrs}>
                    <div class="d-flex justify-content-between align-items-start mb-2 gap-2">
                        <div class="min-w-0" style="min-width:0">
                            <h5 class="mb-0 text-truncate d-inline-flex align-items-center">${escapeHtml(node.name)}${hostMetricWarning}</h5>
                            ${nodeIpLine}
                            ${formatNodeOfflineSinceLine(node)}
                        </div>
                        <div class="d-flex align-items-center gap-2 flex-shrink-0">
                            ${nodeOnline ? `<span class="text-muted host-node-chart-hint" aria-hidden="true" title="${escapeHtml(t('hostNodeAllMetricsCardOpenTitle') || '')}"><i class="bi bi-graph-up-arrow"></i></span>` : ''}
                            ${clusterTileHeaderStatusHtml(nodeOnline ? 'bg-success' : 'bg-danger', nodeOnline ? t('nodeOnline') : t('nodeOffline'))}
                            ${formatNodeIpmiStatusBadge(node)}
                        </div>
                    </div>
                    ${metricsBlock}
                </div>
            </div>`;
}

async function initHostNodeMetricChartTiles(targetGridId) {
    const gridEl = document.getElementById(targetGridId);
    if (!gridEl) return;
    if (typeof Chart === 'undefined') return;
    const gid = tilesMonitorGridDomIdSuffix(targetGridId);
    const canvasIdPrefix = `hostNodeMetricTileCanvas_${gid}_`;
    const canvases = Array.from(gridEl.querySelectorAll('canvas[data-host-node-metric-tile="1"]'));
    pruneChartMap(hostNodeMetricTileCharts, canvases);
    if (!canvases.length) return;

    const headers = getCurrentProxmoxHeaders();
    const needConnText = t('hostMetricsNeedConnection') || 'Connect to Proxmox first.';
    const emptyTextDefault = t('hostNodeMetricChartEmptyLoadMem') || t('hostNodeCpuTempChartEmpty') || 'No samples in the last 24 hours yet.';

    await Promise.all(canvases.map(async (canvas) => {
        const idStr = String(canvas?.id || '');
        const tileIndexNum = idStr.startsWith(canvasIdPrefix)
            ? parseInt(idStr.slice(canvasIdPrefix.length), 10)
            : NaN;
        const emptyEl = document.getElementById(`hostNodeMetricTileEmpty_${gid}_${tileIndexNum}`);
        const node = String(canvas.dataset.hostNode || '').trim();
        const metric = String(canvas.dataset.hostMetric || '').trim().toLowerCase();
        if (!emptyEl || !node) return;

        if (!headers) {
            showTileEmptyIfNoChart({ canvas, emptyEl, chartMap: hostNodeMetricTileCharts, message: needConnText });
            return;
        }

        try {
            const url = `/api/host-metrics/node-metric-history?node=${encodeURIComponent(node)}&metric=${encodeURIComponent(metric || 'cpu')}`;
            const res = await fetch(url, { headers });
            const data = await res.json().catch(() => ({}));
            if (!isTilesMonitorLiveContextOk(targetGridId)) return;

            if (!res.ok || data?.error) {
                showTileEmptyIfNoChart({ canvas, emptyEl, chartMap: hostNodeMetricTileCharts, message: String(data?.error || `HTTP ${res.status}` || emptyTextDefault) });
                return;
            }

            const tileWindowMin = normalizeChartWindowMinutes(canvas.dataset.chartWindowMin, chartWindowHostMetricMin);
            const points = filterSeriesByWindowMinutes(parseMetricHistoryPoints(data?.points), tileWindowMin);
            if (!points.length) {
                showTileEmptyIfNoChart({ canvas, emptyEl, chartMap: hostNodeMetricTileCharts, message: emptyTextDefault });
                return;
            }

            showTileChart({ canvas, emptyEl });

            const meta = hostNodeMetricTileMeta(metric);
            const dsLabel = `${node}: ${meta.label}`;
            updateOrCreateLineChart({
                canvas,
                chartMap: hostNodeMetricTileCharts,
                series: points,
                dsLabel,
                lineRgb: meta.lineRgb,
                yUnit: meta.yUnit
            });
        } catch (e) {
            showTileEmptyIfNoChart({ canvas, emptyEl, chartMap: hostNodeMetricTileCharts, message: String(e?.message || e || emptyTextDefault) });
        }
    }));
}

async function initSmartSensorMetricChartTiles(targetGridId) {
    const gridEl = document.getElementById(targetGridId);
    if (!gridEl) return;
    if (typeof Chart === 'undefined') return;
    const gid = tilesMonitorGridDomIdSuffix(targetGridId);
    const canvasIdPrefix = `smartSensorMetricTileCanvas_${gid}_`;
    const canvases = Array.from(gridEl.querySelectorAll('canvas[data-smart-sensor-metric-tile="1"]'));
    pruneChartMap(smartSensorMetricTileCharts, canvases);
    if (!canvases.length) return;

    const emptyText = t('smartSensorMetricChartEmpty') || (t('upsAllMetricsChartEmpty') || 'No samples in the last 24 hours yet.');

    await Promise.all(canvases.map(async (canvas) => {
        const idStr = String(canvas?.id || '');
        const tileIndexNum = idStr.startsWith(canvasIdPrefix)
            ? parseInt(idStr.slice(canvasIdPrefix.length), 10)
            : NaN;
        const emptyEl = document.getElementById(`smartSensorMetricTileEmpty_${gid}_${tileIndexNum}`);
        const sensorId = String(canvas.dataset.sensorId || '').trim();
        const fieldKey = String(canvas.dataset.fieldKey || '').trim();
        if (!emptyEl || !sensorId || !fieldKey) return;

        try {
            const url = `/api/smart-sensors/metric-history?sensorId=${encodeURIComponent(sensorId)}&field=${encodeURIComponent(fieldKey)}`;
            const res = await fetch(url);
            const data = await res.json().catch(() => ({}));
            if (!isTilesMonitorLiveContextOk(targetGridId)) return;

            if (!res.ok || data?.error) {
                showTileEmptyIfNoChart({ canvas, emptyEl, chartMap: smartSensorMetricTileCharts, message: String(data?.error || `HTTP ${res.status}` || emptyText) });
                return;
            }

            const tileWindowMin = normalizeChartWindowMinutes(canvas.dataset.chartWindowMin, chartWindowSmartSensorMetricMin);
            const points = filterSeriesByWindowMinutes(parseMetricHistoryPoints(data?.points), tileWindowMin);
            if (!points.length) {
                showTileEmptyIfNoChart({ canvas, emptyEl, chartMap: smartSensorMetricTileCharts, message: emptyText });
                return;
            }

            showTileChart({ canvas, emptyEl });

            const dsLabel = String(canvas.dataset.metricTitle || fieldKey || '').trim() || fieldKey;
            updateOrCreateLineChart({
                canvas,
                chartMap: smartSensorMetricTileCharts,
                series: points,
                dsLabel,
                lineRgb: '23, 162, 184',
                yUnit: ''
            });
        } catch (e) {
            showTileEmptyIfNoChart({ canvas, emptyEl, chartMap: smartSensorMetricTileCharts, message: String(e?.message || e || emptyText) });
        }
    }));
}

function buildClusterSpeedtestTileHtml(summary) {
    if (!summary) {
        return buildClusterDashboardUnavailableTile(
            t('dashboardSpeedtestTitle') || 'Speedtest',
            t('speedtestErrorNetwork') || t('backupNoData') || 'Нет данных'
        );
    }
    if (summary.error) {
        const hint = t('speedtestSummaryLoadError') || 'Could not load speedtest data';
        return buildClusterDashboardUnavailableTile(
            t('dashboardSpeedtestTitle') || 'Speedtest',
            `${hint}: ${String(summary.error)}`
        );
    }
    if (!summary.enabled) {
        return buildClusterDashboardUnavailableTile(t('dashboardSpeedtestTitle') || 'Speedtest', t('backupNoData') || 'Нет данных');
    }
    const last = summary.last || {};
    const today = summary.today || {};
    const download = today.download || {};
    const upload = today.upload || {};
    const badgeClass = last.error ? 'bg-warning text-dark' : 'bg-success';
    const badgeText = last.error ? (t('serverError') || 'Ошибка') : (t('statusOkShort') || 'OK');
    const lastRun = last.runAt ? new Date(last.runAt).toLocaleString() : '—';
    const lastOk = !last.error;
    const lastDl = lastOk ? formatSpeedtestMbps(last.downloadMbps) : '—';
    const lastUl = lastOk ? formatSpeedtestMbps(last.uploadMbps) : '—';
    const pingText = lastOk ? formatSpeedtestPing(last.pingMs) : '—';
    const bodyHtml = [
        buildClusterDashboardMetricCell(t('speedtestLastRunLabel') || 'Last run', lastRun, null, null, 'col-6'),
        buildClusterDashboardMetricCell(t('speedtestDownloadShort') || 'Download', lastDl, null, null, 'col-6'),
        buildClusterDashboardMetricCell(t('speedtestUploadShort') || 'Upload', lastUl, null, null, 'col-6 mt-2'),
        buildClusterDashboardMetricCell(t('speedtestPingLabel') || 'Ping', pingText, null, null, 'col-6 mt-2'),
        buildClusterDashboardMetricCell(t('speedtestAvgLabel') || 'Average', formatSpeedtestMbps(download.avg), null, null, 'col-6 mt-2'),
        buildClusterDashboardMetricCell(t('speedtestUploadAvgToday') || 'Upload avg', formatSpeedtestMbps(upload.avg), null, null, 'col-6 mt-2')
    ].join('');
    const planBits = [];
    if (summary.providerDownloadMbps != null) {
        const v = Number(summary.providerDownloadMbps);
        if (Number.isFinite(v) && v > 0) {
            planBits.push(`${t('speedtestPlanDownloadShort')}: ${formatSpeedtestMbps(v)}`);
        }
    }
    if (summary.providerUploadMbps != null) {
        const v = Number(summary.providerUploadMbps);
        if (Number.isFinite(v) && v > 0) {
            planBits.push(`${t('speedtestPlanUploadShort')}: ${formatSpeedtestMbps(v)}`);
        }
    }
    const planLine = planBits.join(' · ');
    const devLastBits = [];
    if (lastOk) {
        const pDlv = summary.providerDownloadMbps != null ? Number(summary.providerDownloadMbps) : NaN;
        const pUlv = summary.providerUploadMbps != null ? Number(summary.providerUploadMbps) : NaN;
        const dd = formatSpeedtestDeviationPct(last.downloadMbps, pDlv);
        if (dd != null) devLastBits.push(`${t('speedtestPlanDownloadShort')} ${dd}`);
        const du = formatSpeedtestDeviationPct(last.uploadMbps, pUlv);
        if (du != null) devLastBits.push(`${t('speedtestPlanUploadShort')} ${du}`);
    }
    const devLastLine = devLastBits.length
        ? `${t('speedtestDeviationLastRunShort')}: ${devLastBits.join(' · ')}`
        : '';
    const footer = [planLine, devLastLine, last.serverName ? escapeHtml(String(last.serverName)) : '']
        .filter(Boolean)
        .join(' · ');
    return buildClusterDashboardTileShell(
        `<i class="bi bi-speedometer2 text-primary me-2 flex-shrink-0" aria-hidden="true"></i><span class="text-truncate">${escapeHtml(t('dashboardSpeedtestTitle') || 'Speedtest')}</span>`,
        clusterTileHeaderStatusHtml(badgeClass, badgeText),
        bodyHtml,
        footer
    );
}

function buildClusterIperf3TileHtml(summary) {
    const title = t('dashboardIperf3Title') || 'iperf3';
    if (!summary) {
        return buildClusterDashboardUnavailableTile(
            title,
            t('speedtestErrorNetwork') || t('backupNoData') || 'Нет данных'
        );
    }
    if (summary.error) {
        const hint = t('iperf3SummaryLoadError') || 'Could not load iperf3 data';
        return buildClusterDashboardUnavailableTile(
            title,
            `${hint}: ${String(summary.error)}`
        );
    }
    if (!summary.enabled) {
        return buildClusterDashboardUnavailableTile(title, t('backupNoData') || 'Нет данных');
    }
    const last = summary.last || {};
    const today = summary.today || {};
    const download = today.download || {};
    const upload = today.upload || {};
    const badgeClass = last.error ? 'bg-warning text-dark' : 'bg-success';
    const badgeText = last.error ? (t('serverError') || 'Ошибка') : (t('statusOkShort') || 'OK');
    const lastRun = last.runAt ? new Date(last.runAt).toLocaleString() : '—';
    const lastOk = !last.error;
    const lastDl = lastOk ? formatSpeedtestMbps(last.downloadMbps) : '—';
    const lastUl = lastOk ? formatSpeedtestMbps(last.uploadMbps) : '—';
    const pingText = lastOk ? formatSpeedtestPing(last.pingMs) : '—';
    const bodyHtml = [
        buildClusterDashboardMetricCell(t('speedtestLastRunLabel') || 'Last run', lastRun, null, null, 'col-6'),
        buildClusterDashboardMetricCell(t('speedtestDownloadShort') || 'Download', lastDl, null, null, 'col-6'),
        buildClusterDashboardMetricCell(t('speedtestUploadShort') || 'Upload', lastUl, null, null, 'col-6 mt-2'),
        buildClusterDashboardMetricCell(t('speedtestPingLabel') || 'Ping', pingText, null, null, 'col-6 mt-2'),
        buildClusterDashboardMetricCell(t('speedtestAvgLabel') || 'Average', formatSpeedtestMbps(download.avg), null, null, 'col-6 mt-2'),
        buildClusterDashboardMetricCell(t('iperf3UploadAvgToday') || 'Upload avg', formatSpeedtestMbps(upload.avg), null, null, 'col-6 mt-2')
    ].join('');
    const planBits = [];
    if (summary.providerDownloadMbps != null) {
        const v = Number(summary.providerDownloadMbps);
        if (Number.isFinite(v) && v > 0) {
            planBits.push(`${t('speedtestPlanDownloadShort')}: ${formatSpeedtestMbps(v)}`);
        }
    }
    if (summary.providerUploadMbps != null) {
        const v = Number(summary.providerUploadMbps);
        if (Number.isFinite(v) && v > 0) {
            planBits.push(`${t('speedtestPlanUploadShort')}: ${formatSpeedtestMbps(v)}`);
        }
    }
    const planLine = planBits.join(' · ');
    const devLastBits = [];
    if (lastOk) {
        const pDlv = summary.providerDownloadMbps != null ? Number(summary.providerDownloadMbps) : NaN;
        const pUlv = summary.providerUploadMbps != null ? Number(summary.providerUploadMbps) : NaN;
        const dd = formatSpeedtestDeviationPct(last.downloadMbps, pDlv);
        if (dd != null) devLastBits.push(`${t('speedtestPlanDownloadShort')} ${dd}`);
        const du = formatSpeedtestDeviationPct(last.uploadMbps, pUlv);
        if (du != null) devLastBits.push(`${t('speedtestPlanUploadShort')} ${du}`);
    }
    const devLastLine = devLastBits.length
        ? `${t('speedtestDeviationLastRunShort')}: ${devLastBits.join(' · ')}`
        : '';
    const footer = [planLine, devLastLine, last.serverName ? escapeHtml(String(last.serverName)) : '']
        .filter(Boolean)
        .join(' · ');
    return buildClusterDashboardTileShell(
        `<i class="bi bi-arrow-left-right text-primary me-2 flex-shrink-0" aria-hidden="true"></i><span class="text-truncate">${escapeHtml(title)}</span>`,
        clusterTileHeaderStatusHtml(badgeClass, badgeText),
        bodyHtml,
        footer
    );
}

function buildClusterTrueNASPoolTileHtml(tile) {
    if (!Array.isArray(lastTrueNASOverviewData?.pools)) {
        return buildClusterDashboardUnavailableTile('TrueNAS Pool', t('backupNoData') || 'Нет данных');
    }
    const source = clusterTileSourceValue(tile, 'truenas_pool');
    const numeric = parseInt(source, 10);
    const pool = lastTrueNASOverviewData.pools.find((entry, idx) =>
        String(entry?.id || entry?.name || '') === source
        || (Number.isFinite(numeric) && ((idx + 1) === numeric))
    );
    if (!pool) return buildClusterDashboardUnavailableTile('TrueNAS Pool', t('storageNotFound') || 'Пул не найден');
    const total = Number(pool.total || 0);
    const used = Number(pool.used || 0);
    const usagePercent = total > 0 ? Math.round((used / total) * 100) : 0;
    const statusLabel = pool.status || (pool.healthy === false ? 'degraded' : 'online');
    const badgeClass = pool.healthy === false ? 'bg-danger' : 'bg-success';
    const gw = Math.max(1, Math.min(TILES_MONITOR_GRID_COLS, Number(tile?.tilesGridW) || 1));
    const gh = Math.max(1, Math.min(TILES_MONITOR_GRID_ROWS, Number(tile?.tilesGridH) || 1));
    const stackVertical = gw === 1 && gh >= 2;
    const usedCol = stackVertical ? 'col-12' : 'col-6';
    const totalCol = stackVertical ? 'col-12' : 'col-6';
    const barClass = usagePercent >= 85 ? 'bg-danger' : (usagePercent >= 65 ? 'bg-warning' : 'bg-success');
    const bodyHtml = [
        buildClusterDashboardMetricCell(t('storageUsedSpace') || 'Used', formatSize(used), usagePercent, barClass, usedCol),
        buildClusterDashboardMetricCell(t('storageTotalSpace') || 'Total', formatSize(total), null, null, totalCol)
    ].join('');
    const sizeClasses = [
        'truenas-pool-tile',
        gh === 1 ? 'truenas-pool-tile--row1' : '',
        stackVertical ? 'truenas-pool-tile--stack' : ''
    ].filter(Boolean).join(' ');
    return buildClusterDashboardTileShell(
        `<i class="bi bi-database me-2 text-primary"></i><span class="text-truncate">${escapeHtml(pool.name || 'Pool')}</span>`,
        clusterTileHeaderStatusHtml(badgeClass, statusLabel),
        bodyHtml,
        'TrueNAS Storage',
        sizeClasses
    );
}

function buildClusterTrueNASDiskTileHtml(tile) {
    if (!Array.isArray(lastTrueNASOverviewData?.disks)) {
        return buildClusterDashboardUnavailableTile('TrueNAS Disk', t('backupNoData') || 'Нет данных');
    }
    const source = clusterTileSourceValue(tile, 'truenas_disk');
    const numeric = parseInt(source, 10);
    const disk = lastTrueNASOverviewData.disks.find((entry, idx) =>
        String(entry?.entityId || entry?.id || entry?.name || '') === source
        || (Number.isFinite(numeric) && ((idx + 1) === numeric || Number(entry?.id) === numeric))
    );
    if (!disk) return buildClusterDashboardUnavailableTile('TrueNAS Disk', 'Диск не найден');
    const healthy = disk.healthy !== false;
    const statusLabel = disk.statusLabel || (healthy ? 'healthy' : 'degraded');
    const diskLabel = String(disk.name || '').trim();
    const diskTitle = String(disk.model || disk.name || 'Disk').trim();
    const badgeClass = healthy ? 'bg-success' : 'bg-warning text-dark';
    const bodyHtml = [
        buildClusterDashboardMetricCell('SN', disk.serial || '—', null, null, 'col-6'),
        buildClusterDashboardMetricCell('Size', Number.isFinite(Number(disk.sizeBytes)) ? formatSize(Number(disk.sizeBytes)) : '—', null, null, 'col-6 mt-2'),
        buildClusterDashboardMetricCell('Temp', disk.temperatureC == null ? '—' : `${disk.temperatureC} C`, null, null, 'col-6 mt-2')
    ].join('');
    const diskHeaderStatus = diskLabel ? `${statusLabel} · ${diskLabel}` : statusLabel;
    return buildClusterDashboardTileShell(
        `<i class="bi bi-device-hdd me-2 text-primary"></i><span class="text-truncate">${escapeHtml(diskTitle || 'Disk')}</span>`,
        clusterTileHeaderStatusHtml(badgeClass, diskHeaderStatus),
        bodyHtml,
        escapeHtml(disk.pool || '')
    );
}

function buildClusterTrueNASServiceTileHtml(tile) {
    if (!Array.isArray(lastTrueNASOverviewData?.services)) {
        return buildClusterDashboardUnavailableTile('TrueNAS Service', t('backupNoData') || 'Нет данных');
    }
    const source = clusterTileSourceValue(tile, 'truenas_service');
    const numeric = parseInt(source, 10);
    const service = lastTrueNASOverviewData.services.find((entry, idx) =>
        String(entry?.entityId || entry?.id || entry?.name || '') === source
        || (Number.isFinite(numeric) && ((idx + 1) === numeric || Number(entry?.id) === numeric))
    );
    if (!service) return buildClusterDashboardUnavailableTile('TrueNAS Service', 'Сервис не найден');
    const running = !!service.running;
    const statusLabel = service.statusLabel || (running ? 'running' : 'stopped');
    const badgeClass = running ? 'bg-success' : 'bg-warning text-dark';
    const bodyHtml = [
        buildClusterDashboardMetricCell('Enabled', service.enabled ? 'yes' : 'no', null, null, 'col-12')
    ].join('');
    return buildClusterDashboardTileShell(
        `<i class="bi bi-gear-wide-connected me-2 text-primary"></i><span class="text-truncate">${escapeHtml(service.name || 'Service')}</span>`,
        clusterTileHeaderStatusHtml(badgeClass, statusLabel),
        bodyHtml,
        ''
    );
}

function buildClusterTrueNASServerTileHtml(tile) {
    if (!lastTrueNASOverviewData?.system && !Array.isArray(lastTrueNASOverviewData?.pools) && !Array.isArray(lastTrueNASOverviewData?.apps)) {
        return buildClusterDashboardUnavailableTile('TrueNAS Server', t('backupNoData') || 'Нет данных');
    }
    const sys = lastTrueNASOverviewData?.system || {};
    const pools = Array.isArray(lastTrueNASOverviewData?.pools) ? lastTrueNASOverviewData.pools : [];
    const apps = Array.isArray(lastTrueNASOverviewData?.apps) ? lastTrueNASOverviewData.apps : [];
    const hostname = sys.hostname || sys.system_hostname || sys.host || 'TrueNAS';
    const version = sys.version || sys.product_version || sys.release || '—';
    const appsRunning = apps.filter((a) => a?.running).length;
    const total = pools.reduce((s, p) => s + Number(p?.total || 0), 0);
    const used = pools.reduce((s, p) => s + Number(p?.used || 0), 0);
    const usage = total > 0 ? Math.round((used / total) * 100) : 0;
    const bodyHtml = [
        buildClusterDashboardMetricCell('Version', version, null, null, 'col-12'),
        buildClusterDashboardMetricCell('Apps', `${appsRunning}/${apps.length}`, null, null, 'col-6 mt-2'),
        buildClusterDashboardMetricCell('Storage', `${formatSize(used)} / ${formatSize(total)}`, usage, usage > 85 ? 'bg-danger' : (usage > 65 ? 'bg-warning' : 'bg-success'), 'col-6 mt-2')
    ].join('');
    return buildClusterDashboardTileShell(
        `<i class="bi bi-hdd-stack me-2 text-primary"></i><span class="text-truncate">${escapeHtml(hostname)}</span>`,
        clusterTileHeaderStatusHtml('bg-success', t('connected')),
        bodyHtml,
        'TrueNAS'
    );
}

function hasClientTrueNASOverviewData() {
    const d = lastTrueNASOverviewData;
    if (!d || typeof d !== 'object' || d.error) return false;
    if (d.system && typeof d.system === 'object' && Object.keys(d.system).length) return true;
    if (Array.isArray(d.pools) && d.pools.length) return true;
    if (Array.isArray(d.apps) && d.apps.length) return true;
    if (Array.isArray(d.disks) && d.disks.length) return true;
    return false;
}

/** Плитка по умолчанию, если в настройках нет ни одной плитки кластера, но TrueNAS уже отдал overview. */
function syntheticTrueNASServerTileForDisplay({ forTilesScreen }) {
    const normalized = normalizeClusterDashboardTile({
        type: 'truenas_server',
        sourceId: 'truenas_server:current',
        showOnCluster: true,
        showOnTiles: !!forTilesScreen
    });
    return normalized || null;
}

function buildClusterTrueNASAppTileHtml(tile) {
    if (!Array.isArray(lastTrueNASOverviewData?.apps)) {
        return buildClusterDashboardUnavailableTile('TrueNAS App', t('backupNoData') || 'Нет данных');
    }
    const source = clusterTileSourceValue(tile, 'truenas_app');
    const numeric = parseInt(source, 10);
    const app = lastTrueNASOverviewData.apps.find((entry, idx) =>
        String(entry?.entityId || entry?.id || entry?.name || '') === source
        || (Number.isFinite(numeric) && ((idx + 1) === numeric))
    );
    if (!app) return buildClusterDashboardUnavailableTile('TrueNAS App', t('vmListEmpty') || 'App не найден');
    const statusLabel = app.statusLabel || (app.running ? 'running' : 'stopped');
    const badgeClass = app.running ? 'bg-success' : (app.severity === 'critical' ? 'bg-danger' : 'bg-warning text-dark');
    const bodyHtml = [
        buildClusterDashboardMetricCell(t('monVmTypeCol') || 'Type', 'APP', null, null, 'col-6'),
        buildClusterDashboardMetricCell(t('monVmStatusCol') || 'Status', statusLabel, null, null, 'col-6')
    ].join('');
    return buildClusterDashboardTileShell(
        `<i class="bi bi-boxes me-2 text-primary"></i><span class="text-truncate">${escapeHtml(app.name || 'App')}</span>`,
        clusterTileHeaderStatusHtml(badgeClass, statusLabel),
        bodyHtml,
        'TrueNAS Apps'
    );
}

async function renderClusterDashboardTiles() {
    const sectionEl = document.getElementById('dashboardClusterTilesSection');
    const containerEl = document.getElementById('dashboardClusterTiles');
    if (!sectionEl || !containerEl) return;

    let tiles = normalizeClusterDashboardTiles(clusterDashboardTiles).filter((tile) => tile.showOnCluster !== false);
    const tnAuth = getAuthHeadersForType('truenas');
    if (!tiles.length && tnAuth && hasClientTrueNASOverviewData()) {
        const syn = syntheticTrueNASServerTileForDisplay({ forTilesScreen: false });
        if (syn) tiles = [syn];
    }
    if (!tiles.length) {
        sectionEl.style.display = 'none';
        setHTMLIfChanged('dashboardClusterTiles', '');
        return;
    }

    const needNetdev = tiles.some((tile) => tile.type === 'netdev');
    const needUps = tiles.some((tile) => tile.type === 'ups' || tile.type === 'ups_metric_chart');
    const needSpeedtest = tiles.some((tile) => tile.type === 'speedtest');
    const needIperf3 = tiles.some((tile) => tile.type === 'iperf3');

    const fetchJson = async (url, headers) => {
        try {
            const init = headers && typeof headers === 'object' ? { headers } : {};
            const res = await fetch(url, init);
            const data = await res.json().catch(() => ({}));
            return res.ok ? data : { error: data?.error || `HTTP ${res.status}` };
        } catch (e) {
            return { error: e.message || String(e) };
        }
    };

    const needTrueNASOverview = tiles.some((tile) => ['truenas_server', 'truenas_pool', 'truenas_disk', 'truenas_service', 'truenas_app'].includes(tile.type));
    const truenasOverviewPromise = (async () => {
        if (!needTrueNASOverview) return null;
        const h = getAuthHeadersForType('truenas');
        if (h) {
            const data = await fetchJson('/api/truenas/overview', h);
            if (data && !data.error) return data;
        }
        const cached = lastTrueNASOverviewData;
        return cached && typeof cached === 'object' && !cached.error ? cached : null;
    })();
    const [netdevPayload, upsPayload, speedtestSummary, iperf3Summary, truenasOverview] = await Promise.all([
        needNetdev ? fetchJson('/api/netdevices/current') : Promise.resolve(null),
        needUps ? fetchJson('/api/ups/current') : Promise.resolve(null),
        needSpeedtest ? fetchJson('/api/speedtest/summary') : Promise.resolve(null),
        needIperf3 ? fetchJson('/api/iperf3/summary') : Promise.resolve(null),
        truenasOverviewPromise
    ]);
    if (truenasOverview && !truenasOverview.error) lastTrueNASOverviewData = truenasOverview;

    const html = tiles.map((tile, tileIndex) => {
        if (tile.type === 'service') return buildClusterServiceTileHtml(tile);
        if (tile.type === 'vmct') return buildClusterVmTileHtml(tile);
        if (tile.type === 'netdev') return buildClusterNetdevTileHtml(tile, netdevPayload);
        if (tile.type === 'ups') return buildClusterUpsTileHtml(tile, upsPayload);
        if (tile.type === 'ups_metric_chart') return buildClusterUpsMetricChartTileHtml(tile, upsPayload, tileIndex, 'dashboardClusterTiles');
        if (tile.type === 'cluster_metric_chart') return buildClusterClusterMetricChartTileHtml(tile, tileIndex, 'dashboardClusterTiles');
        if (tile.type === 'host_node_metric_chart') return buildClusterHostNodeMetricChartTileHtml(tile, tileIndex, 'dashboardClusterTiles');
        if (tile.type === 'cluster_node') return buildClusterNodeKpiTileHtml(tile);
        if (tile.type === 'speedtest') return buildClusterSpeedtestTileHtml(speedtestSummary);
        if (tile.type === 'iperf3') return buildClusterIperf3TileHtml(iperf3Summary);
        if (tile.type === 'truenas_server') return buildClusterTrueNASServerTileHtml(tile);
        if (tile.type === 'truenas_pool') return buildClusterTrueNASPoolTileHtml(tile);
        if (tile.type === 'truenas_disk') return buildClusterTrueNASDiskTileHtml(tile);
        if (tile.type === 'truenas_service') return buildClusterTrueNASServiceTileHtml(tile);
        if (tile.type === 'truenas_app') return buildClusterTrueNASAppTileHtml(tile);
        return '';
    }).join('');

    sectionEl.style.display = html ? '' : 'none';
    setHTMLIfChanged('dashboardClusterTiles', html || '');
}

function getTilesMonitorCellClass(size) {
    if (size === '4x1') return 'col-12';
    if (size === '3x1') return 'col-12 col-xl-9';
    if (size === '2x1') return 'col-12 col-md-6';
    return 'col-12 col-md-6 col-xl-3';
}

function isTilesChartTileType(type) {
    return type === 'ups_metric_chart' ||
        type === 'cluster_metric_chart' ||
        type === 'host_node_metric_chart' ||
        type === 'smart_sensor_metric_chart';
}

function patchTilesMonitorGridInPlace(gridEl, renderedItems) {
    if (!gridEl || !Array.isArray(renderedItems) || !renderedItems.length) return false;
    const cells = Array.from(gridEl.querySelectorAll(':scope > .tiles-monitor-cell'));
    if (cells.length !== renderedItems.length) return false;
    for (let i = 0; i < renderedItems.length; i++) {
        const cell = cells[i];
        const item = renderedItems[i];
        const key = String(cell.dataset.tileKey || '');
        const style = String(cell.dataset.gridStyle || '');
        if (key !== item.tileKey || style !== item.gridStyle) return false;
    }
    for (let i = 0; i < renderedItems.length; i++) {
        const cell = cells[i];
        const item = renderedItems[i];
        if (item.isChart) continue;
        const prev = String(cell.dataset.tileHtml || '');
        if (prev !== item.tileHtml) {
            cell.innerHTML = item.tileHtml;
            cell.dataset.tileHtml = item.tileHtml;
        }
    }
    return true;
}

async function renderTilesMonitorScreen(targetGridId = 'tilesMonitorGrid') {
    tilesMonitorTileFooterSuppressDepth++;
    try {
    const gridEl = document.getElementById(targetGridId);
    if (!gridEl) return;
    const onLiveTilesScreen = monitorMode && monitorCurrentView === 'tiles';
    const isLiveGrid = targetGridId === 'tilesMonitorGrid';
    const isSettingsPreviewGrid = targetGridId === 'tilesNormalGrid';
    if (isLiveGrid && !onLiveTilesScreen) return;
    if (isSettingsPreviewGrid && onLiveTilesScreen) return;

    gridEl.classList.add('tiles-monitor-grid');
    gridEl.style.setProperty('--tiles-grid-cols', String(TILES_MONITOR_GRID_COLS));
    gridEl.style.setProperty('--tiles-grid-rows', String(TILES_MONITOR_GRID_ROWS));
    const normalizedTiles = normalizeClusterDashboardTiles(clusterDashboardTiles);
    let tiles = normalizedTiles.filter((tile) => tile.showOnTiles === true);
    // Fallback: if no tiles explicitly selected for Tiles screen,
    // show Cluster set to avoid an empty monitor screen.
    if (!tiles.length) {
        tiles = normalizedTiles.filter((tile) => tile.showOnCluster !== false);
    }
    if (!tiles.length) {
        const tnAuth = getAuthHeadersForType('truenas');
        if (tnAuth && hasClientTrueNASOverviewData()) {
            const syn = syntheticTrueNASServerTileForDisplay({ forTilesScreen: true });
            if (syn) tiles = [syn];
        }
    }
    if (!tiles.length) {
        setHTMLIfChanged(targetGridId, `<div class="tiles-monitor-cell tiles-monitor-cell--empty" style="grid-column: 1 / -1; grid-row: 1 / -1;"><div class="monitor-view__empty">${escapeHtml(t('backupNoData') || 'Нет данных')}</div></div>`);
        return;
    }

    const needNetdev = tiles.some((tile) => tile.type === 'netdev');
    const needUps = tiles.some((tile) => tile.type === 'ups' || tile.type === 'ups_metric_chart');
    const needSpeedtest = tiles.some((tile) => tile.type === 'speedtest');
    const needIperf3 = tiles.some((tile) => tile.type === 'iperf3');
    const needSmartSensors = tiles.some((tile) => tile.type === 'smart_sensor' || tile.type === 'smart_sensor_metric_chart');
    const needTrueNASOverview = tiles.some((tile) => ['truenas_server', 'truenas_pool', 'truenas_disk', 'truenas_service', 'truenas_app'].includes(tile.type));

    const fetchJson = async (url, headers) => {
        try {
            const init = headers && typeof headers === 'object' ? { headers } : {};
            const res = await fetch(url, init);
            const data = await res.json().catch(() => ({}));
            return res.ok ? data : { error: data?.error || `HTTP ${res.status}` };
        } catch (e) {
            return { error: e.message || String(e) };
        }
    };

    const truenasOverviewPromise = (async () => {
        if (!needTrueNASOverview) return null;
        const h = getAuthHeadersForType('truenas');
        if (h) {
            const data = await fetchJson('/api/truenas/overview', h);
            if (data && !data.error) return data;
        }
        const cached = lastTrueNASOverviewData;
        return cached && typeof cached === 'object' && !cached.error ? cached : null;
    })();
    const [netdevPayload, upsPayload, speedtestSummary, iperf3Summary, smartSensorsPayload, truenasOverview] = await Promise.all([
        needNetdev ? fetchJson('/api/netdevices/current') : Promise.resolve(null),
        needUps ? fetchJson('/api/ups/current') : Promise.resolve(null),
        needSpeedtest ? fetchJson('/api/speedtest/summary') : Promise.resolve(null),
        needIperf3 ? fetchJson('/api/iperf3/summary') : Promise.resolve(null),
        needSmartSensors ? fetchJson('/api/smart-sensors/current') : Promise.resolve(null),
        truenasOverviewPromise
    ]);
    if (truenasOverview && !truenasOverview.error) lastTrueNASOverviewData = truenasOverview;

    if (isLiveGrid && !(monitorMode && monitorCurrentView === 'tiles')) return;
    if (isSettingsPreviewGrid && monitorMode && monitorCurrentView === 'tiles') return;

    const placements = computeTilesMonitorPlacements(tiles);
    const renderedItems = placements.map(({ tile, gridCol, gridRow }, placementsIndex) => {
        let tileHtml = '';
        if (tile.type === 'service') tileHtml = buildClusterServiceTileHtml(tile);
        else if (tile.type === 'vmct') tileHtml = buildClusterVmTileHtml(tile);
        else if (tile.type === 'netdev') tileHtml = buildClusterNetdevTileHtml(tile, netdevPayload);
        else if (tile.type === 'ups') tileHtml = buildClusterUpsTileHtml(tile, upsPayload);
        else if (tile.type === 'ups_metric_chart') tileHtml = buildClusterUpsMetricChartTileHtml(tile, upsPayload, placementsIndex, targetGridId);
        else if (tile.type === 'cluster_metric_chart') tileHtml = buildClusterClusterMetricChartTileHtml(tile, placementsIndex, targetGridId);
        else if (tile.type === 'host_node_metric_chart') tileHtml = buildClusterHostNodeMetricChartTileHtml(tile, placementsIndex, targetGridId);
        else if (tile.type === 'cluster_node') tileHtml = buildClusterNodeKpiTileHtml(tile);
        else if (tile.type === 'speedtest') tileHtml = buildClusterSpeedtestTileHtml(speedtestSummary);
        else if (tile.type === 'iperf3') tileHtml = buildClusterIperf3TileHtml(iperf3Summary);
        else if (tile.type === 'smart_sensor') tileHtml = buildClusterSmartSensorTileHtml(tile, smartSensorsPayload);
        else if (tile.type === 'smart_sensor_metric_chart') tileHtml = buildClusterSmartSensorMetricChartTileHtml(tile, smartSensorsPayload, placementsIndex, targetGridId);
        else if (tile.type === 'truenas_server') tileHtml = buildClusterTrueNASServerTileHtml(tile);
        else if (tile.type === 'truenas_pool') tileHtml = buildClusterTrueNASPoolTileHtml(tile);
        else if (tile.type === 'truenas_disk') tileHtml = buildClusterTrueNASDiskTileHtml(tile);
        else if (tile.type === 'truenas_service') tileHtml = buildClusterTrueNASServiceTileHtml(tile);
        else if (tile.type === 'truenas_app') tileHtml = buildClusterTrueNASAppTileHtml(tile);
        else if (tile.type === 'embed') tileHtml = buildClusterEmbedTileHtml(tile);
        const w = Math.max(1, Math.min(TILES_MONITOR_GRID_COLS, tile.tilesGridW || 1));
        const h = Math.max(1, Math.min(TILES_MONITOR_GRID_ROWS, tile.tilesGridH || 1));
        const gc = Math.max(1, Math.min(TILES_MONITOR_GRID_COLS, gridCol));
        const gr = Math.max(1, Math.min(TILES_MONITOR_GRID_ROWS, gridRow));
        const gridStyle = `grid-column: ${gc} / span ${w}; grid-row: ${gr} / span ${h};`;
        const tileKey = `${String(tile.type || '')}:${String(tile.sourceId || '')}:${gc}:${gr}:${w}:${h}`;
        return {
            tileHtml,
            gridStyle,
            tileKey,
            isChart: isTilesChartTileType(tile.type)
        };
    });
    const patchedInPlace = patchTilesMonitorGridInPlace(gridEl, renderedItems);
    if (!patchedInPlace) {
        const html = renderedItems.map((item) => `<div class="tiles-monitor-cell" style="${item.gridStyle}" data-grid-style="${escapeHtml(item.gridStyle)}" data-tile-key="${escapeHtml(item.tileKey)}" data-tile-chart="${item.isChart ? '1' : '0'}" data-tile-html="${escapeHtml(item.tileHtml)}">${item.tileHtml}</div>`).join('');
        setHTMLIfChanged(targetGridId, html);
    }
    if (isLiveGrid && !(monitorMode && monitorCurrentView === 'tiles')) return;
    if (isSettingsPreviewGrid && monitorMode && monitorCurrentView === 'tiles') return;
    // Important: wait for chart tiles initialization so callers (view switch)
    // can reliably resize after charts exist (prevents "blank" charts after navigation).
    await Promise.all([
        initUpsMetricChartTiles(targetGridId).catch(() => {}),
        initClusterMetricChartTiles(targetGridId).catch(() => {}),
        initHostNodeMetricChartTiles(targetGridId).catch(() => {}),
        initSmartSensorMetricChartTiles(targetGridId).catch(() => {})
    ]);
    if (isLiveGrid && !(monitorMode && monitorCurrentView === 'tiles')) return;
    if (isSettingsPreviewGrid && monitorMode && monitorCurrentView === 'tiles') return;
    initHostMetricProblemPopovers();
    } finally {
        tilesMonitorTileFooterSuppressDepth--;
    }
}

function truenasMonitorSectionIdForGrid(targetGridId) {
    const map = {
        truenasPoolsMonitorGrid: 'truenasPoolsMonitorSection',
        truenasDisksMonitorGrid: 'truenasDisksMonitorSection',
        truenasServicesMonitorGrid: 'truenasServicesMonitorSection',
        truenasAppsMonitorGrid: 'truenasAppsMonitorSection'
    };
    return map[targetGridId] || null;
}

/** Секция TrueNAS на экране реально показана (не полагаемся на monitorCurrentView после await — гонка со свайпом). */
function isTruenasMonitorGridSectionVisible(targetGridId) {
    const sid = truenasMonitorSectionIdForGrid(targetGridId);
    if (!sid) return true;
    const el = document.getElementById(sid);
    if (!el) return false;
    if (el.style.display === 'none') return false;
    const cs = window.getComputedStyle(el);
    return cs.display !== 'none' && cs.visibility !== 'hidden' && Number(cs.opacity || '1') !== 0;
}

async function renderTrueNASMonitorScreenTiles(targetGridId, type) {
    const gridEl = document.getElementById(targetGridId);
    if (!gridEl) return;
    tilesMonitorTileFooterSuppressDepth++;
    try {
    const auth = getAuthHeadersForType('truenas');
    if (!auth) {
        delete htmlCache[targetGridId];
        const msg = t('errorNoToken') || t('tokenRequired') || 'Нет авторизации TrueNAS';
        setHTML(targetGridId, `<div class="col-12"><div class="alert alert-warning mb-0 monitor-view__empty">${escapeHtml(msg)}</div></div>`);
        return;
    }

    let fetchErr = null;
    try {
        const res = await fetch('/api/truenas/overview', { headers: auth });
        const data = await res.json().catch(() => ({}));
        if (res.ok && data && typeof data === 'object') {
            lastTrueNASOverviewData = data;
        } else {
            fetchErr = (data && data.error) ? String(data.error) : `HTTP ${res.status}`;
        }
    } catch (e) {
        fetchErr = e && e.message ? e.message : String(e);
    }

    // В обычном режиме не отбрасываем ответ (меню TrueNAS): проверка видимости нужна только в monitor-mode
    // после await, чтобы не рисовать в скрытую секцию при быстром свайпе.
    if (monitorMode && !isTruenasMonitorGridSectionVisible(targetGridId)) {
        return;
    }

    if (fetchErr) {
        delete htmlCache[targetGridId];
        const msg = (t('connectError') || 'Ошибка') + ': ' + fetchErr;
        setHTML(targetGridId, `<div class="col-12"><div class="alert alert-danger mb-0 monitor-view__empty">${escapeHtml(msg)}</div></div>`);
        return;
    }

    let tiles = [];
    if (type === 'truenas_pool') {
        const pools = Array.isArray(lastTrueNASOverviewData?.pools) ? lastTrueNASOverviewData.pools : [];
        tiles = pools.map((p, i) => ({ type, sourceId: `truenas_pool:${String(p?.id || p?.name || (i + 1))}`, tilesSize: '1x1' }));
    } else if (type === 'truenas_disk') {
        const disks = Array.isArray(lastTrueNASOverviewData?.disks) ? lastTrueNASOverviewData.disks : [];
        tiles = disks.map((d, i) => ({ type, sourceId: `truenas_disk:${String(d?.entityId || d?.id || d?.name || (i + 1))}`, tilesSize: '1x1' }));
    } else if (type === 'truenas_service') {
        const services = Array.isArray(lastTrueNASOverviewData?.services) ? lastTrueNASOverviewData.services : [];
        tiles = services.map((s, i) => ({ type, sourceId: `truenas_service:${String(s?.entityId || s?.id || s?.name || (i + 1))}`, tilesSize: '1x1' }));
    } else if (type === 'truenas_app') {
        const apps = Array.isArray(lastTrueNASOverviewData?.apps) ? lastTrueNASOverviewData.apps : [];
        tiles = apps.map((a, i) => ({ type, sourceId: `truenas_app:${String(a?.entityId || a?.id || a?.name || (i + 1))}`, tilesSize: '1x1' }));
    }

    delete htmlCache[targetGridId];
    if (!tiles.length) {
        setHTMLIfChanged(targetGridId, `<div class="col-12"><div class="monitor-view__empty">${escapeHtml(t('backupNoData') || 'Нет данных')}</div></div>`);
        return;
    }

    const html = tiles.map((tile) => {
        let tileHtml = '';
        if (tile.type === 'truenas_pool') tileHtml = buildClusterTrueNASPoolTileHtml(tile);
        else if (tile.type === 'truenas_disk') tileHtml = buildClusterTrueNASDiskTileHtml(tile);
        else if (tile.type === 'truenas_service') tileHtml = buildClusterTrueNASServiceTileHtml(tile);
        else if (tile.type === 'truenas_app') tileHtml = buildClusterTrueNASAppTileHtml(tile);
        const cellClass = getTilesMonitorCellClass(tile.tilesSize || '1x1');
        return `<div class="${cellClass} tiles-monitor-cell truenas-monitor-tile-cell">${tileHtml}</div>`;
    }).join('');
    setHTMLIfChanged(targetGridId, html);
    } finally {
        tilesMonitorTileFooterSuppressDepth--;
    }
}

async function saveSpeedtestSettings() {
    const en = document.getElementById('speedtestEnabledSelect') && document.getElementById('speedtestEnabledSelect').value === '1';
    speedtestClientEnabled = en;
    const engineRaw = (document.getElementById('speedtestEngineSelect')?.value || '').trim().toLowerCase();
    speedtestEngine = engineRaw === 'librespeed' ? 'librespeed' : 'ookla';
    const server = (document.getElementById('speedtestServerInput')?.value || '').trim();
    const librespeedServer = (document.getElementById('speedtestLibrespeedServerInput')?.value || '').trim();
    let perDay = parseInt(document.getElementById('speedtestPerDayInput')?.value, 10);
    if (!Number.isFinite(perDay) || perDay < 1) perDay = 4;
    if (perDay > 6) perDay = 6;
    const dayInput = document.getElementById('speedtestPerDayInput');
    if (dayInput) dayInput.value = String(perDay);
    const provDlRaw = (document.getElementById('speedtestProviderDownloadMbpsInput')?.value || '').trim().replace(',', '.');
    const provUlRaw = (document.getElementById('speedtestProviderUploadMbpsInput')?.value || '').trim().replace(',', '.');
    const httpPx = (document.getElementById('speedtestHttpProxyInput')?.value || '').trim();
    const httpsPx = (document.getElementById('speedtestHttpsProxyInput')?.value || '').trim();
    const noPx = (document.getElementById('speedtestNoProxyInput')?.value || '').trim();
    updateSpeedtestSettingsEngineUI();
    updateSpeedtestProxySettingsUI(false);
    await saveSettingsToServer({
        speedtestEnabled: en,
        speedtestEngine: speedtestEngine,
        speedtestServer: server,
        speedtestLibrespeedServer: librespeedServer,
        speedtestPerDay: perDay,
        speedtestProviderDownloadMbps: provDlRaw === '' ? '' : provDlRaw,
        speedtestProviderUploadMbps: provUlRaw === '' ? '' : provUlRaw,
        speedtestHttpProxy: httpPx,
        speedtestHttpsProxy: httpsPx,
        speedtestNoProxy: noPx
    });
    renderSettingsMonitorScreensOrderList();
    showToast(t('speedtestSaved') || t('dataUpdated'), 'success');
    updateSpeedtestDashboard().catch(() => {});
    renderClusterDashboardTiles().catch(() => {});

    // После изменения включения refresh'им доступность экрана в monitor-mode.
    await refreshMonitorScreensAvailability();
    if (monitorMode && monitorCurrentView === 'speedtest' && speedtestMonitorConfigured === false) {
        applyMonitorView('cluster');
    }
}

async function runSpeedtestNow() {
    const btn = document.getElementById('speedtestRunNowBtn');
    if (btn) btn.disabled = true;
    try {
        const res = await fetch('/api/speedtest/run', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' });
        const { data, parseFailed } = await parseHttpJsonResponse(res);
        if (parseFailed) {
            showToast(t('speedtestErrorBadResponse') || 'Invalid server response', 'error');
            return;
        }
        if (!res.ok) {
            const msg = res.status === 409
                ? (t('speedtestErrorBusy') || 'Another speedtest is running')
                : (data && (data.error || data.message)) || `HTTP ${res.status}`;
            showToast((t('speedtestRunError') || 'Speedtest: {msg}').replace('{msg}', String(msg)), 'error');
            return;
        }
        if (data.ok === false) {
            const detail = speedtestDescribeRunFailure(data);
            showToast((t('speedtestRunError') || 'Speedtest: {msg}').replace('{msg}', detail), 'error');
            updateSpeedtestDashboard().catch(() => {});
            return;
        }
        showToast(t('speedtestRunDone') || t('dataUpdated'), 'success');
        updateSpeedtestDashboard().catch(() => {});
    } catch (e) {
        const msg = speedtestNetworkErrorMessage(e);
        showToast((t('speedtestRunError') || 'Speedtest: {msg}').replace('{msg}', msg), 'error');
    } finally {
        if (btn) btn.disabled = false;
    }
}

async function clearSpeedtestHistory() {
    if (!confirm(t('speedtestClearConfirm') || 'Delete all speedtest records?')) return;
    const btn = document.getElementById('speedtestClearHistoryBtn');
    if (btn) btn.disabled = true;
    try {
        const res = await fetch('/api/speedtest/results', { method: 'DELETE' });
        const { data, parseFailed } = await parseHttpJsonResponse(res);
        if (parseFailed) {
            throw new Error(t('speedtestErrorBadResponse') || 'Invalid server response');
        }
        if (!res.ok) {
            throw new Error((data && (data.error || data.message)) || `HTTP ${res.status}`);
        }
        showToast(t('speedtestClearDone') || t('dataUpdated'), 'success');
        updateSpeedtestDashboard().catch(() => {});
        renderClusterDashboardTiles().catch(() => {});
        await refreshMonitorScreensAvailability();
        if (monitorMode && monitorCurrentView === 'speedtest' && speedtestMonitorConfigured === false) {
            applyMonitorView('cluster');
        }
    } catch (e) {
        const msg = e instanceof Error && e.message ? e.message : speedtestNetworkErrorMessage(e);
        showToast((t('speedtestClearError') || '{msg}').replace('{msg}', msg), 'error');
    } finally {
        if (btn) btn.disabled = false;
    }
}

async function saveIperf3Settings() {
    const en = document.getElementById('iperf3EnabledSelect') && document.getElementById('iperf3EnabledSelect').value === '1';
    iperf3ClientEnabled = en;
    const host = (document.getElementById('iperf3HostInput')?.value || '').trim();
    let port = parseInt(document.getElementById('iperf3PortInput')?.value, 10);
    if (!Number.isFinite(port) || port < 1 || port > 65535) port = 5201;
    const portInput = document.getElementById('iperf3PortInput');
    if (portInput) portInput.value = String(port);
    let duration = parseInt(document.getElementById('iperf3DurationInput')?.value, 10);
    if (!Number.isFinite(duration) || duration < 1) duration = 8;
    if (duration > 120) duration = 120;
    const durInput = document.getElementById('iperf3DurationInput');
    if (durInput) durInput.value = String(duration);
    let parallel = parseInt(document.getElementById('iperf3ParallelInput')?.value, 10);
    if (!Number.isFinite(parallel) || parallel < 1) parallel = 1;
    if (parallel > 32) parallel = 32;
    const parInput = document.getElementById('iperf3ParallelInput');
    if (parInput) parInput.value = String(parallel);
    let perDay = parseInt(document.getElementById('iperf3PerDayInput')?.value, 10);
    if (!Number.isFinite(perDay) || perDay < 1) perDay = 4;
    if (perDay > 6) perDay = 6;
    const dayInput = document.getElementById('iperf3PerDayInput');
    if (dayInput) dayInput.value = String(perDay);
    const provDlRaw = (document.getElementById('iperf3ProviderDownloadMbpsInput')?.value || '').trim().replace(',', '.');
    const provUlRaw = (document.getElementById('iperf3ProviderUploadMbpsInput')?.value || '').trim().replace(',', '.');
    await saveSettingsToServer({
        iperf3Enabled: en,
        iperf3Host: host,
        iperf3Port: port,
        iperf3DurationSec: duration,
        iperf3Parallel: parallel,
        iperf3PerDay: perDay,
        iperf3ProviderDownloadMbps: provDlRaw === '' ? '' : provDlRaw,
        iperf3ProviderUploadMbps: provUlRaw === '' ? '' : provUlRaw
    });
    renderSettingsMonitorScreensOrderList();
    showToast(t('iperf3Saved') || t('dataUpdated'), 'success');
    updateIperf3Dashboard().catch(() => {});
    renderClusterDashboardTiles().catch(() => {});

    await refreshMonitorScreensAvailability();
    if (monitorMode && monitorCurrentView === 'iperf3' && iperf3MonitorConfigured === false) {
        applyMonitorView('cluster');
    }
}

async function runIperf3Now() {
    const btn = document.getElementById('iperf3RunNowBtn');
    if (btn) btn.disabled = true;
    try {
        const res = await fetch('/api/iperf3/run', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' });
        const { data, parseFailed } = await parseHttpJsonResponse(res);
        if (parseFailed) {
            showToast(t('iperf3ErrorBadResponse') || 'Invalid server response', 'error');
            return;
        }
        if (!res.ok) {
            const msg = res.status === 409
                ? (t('iperf3ErrorBusy') || 'Another iperf3 run is in progress')
                : (data && (data.error || data.message)) || `HTTP ${res.status}`;
            showToast((t('iperf3RunError') || 'iperf3: {msg}').replace('{msg}', String(msg)), 'error');
            return;
        }
        if (data.ok === false) {
            const detail = iperf3DescribeRunFailure(data);
            showToast((t('iperf3RunError') || 'iperf3: {msg}').replace('{msg}', detail), 'error');
            updateIperf3Dashboard().catch(() => {});
            return;
        }
        showToast(t('iperf3RunDone') || t('dataUpdated'), 'success');
        updateIperf3Dashboard().catch(() => {});
    } catch (e) {
        const msg = speedtestNetworkErrorMessage(e);
        showToast((t('iperf3RunError') || 'iperf3: {msg}').replace('{msg}', msg), 'error');
    } finally {
        if (btn) btn.disabled = false;
    }
}

async function clearIperf3History() {
    if (!confirm(t('iperf3ClearConfirm') || 'Delete all iperf3 records?')) return;
    const btn = document.getElementById('iperf3ClearHistoryBtn');
    if (btn) btn.disabled = true;
    try {
        const res = await fetch('/api/iperf3/results', { method: 'DELETE' });
        const { data, parseFailed } = await parseHttpJsonResponse(res);
        if (parseFailed) {
            throw new Error(t('iperf3ErrorBadResponse') || 'Invalid server response');
        }
        if (!res.ok) {
            throw new Error((data && (data.error || data.message)) || `HTTP ${res.status}`);
        }
        showToast(t('iperf3ClearDone') || t('dataUpdated'), 'success');
        updateIperf3Dashboard().catch(() => {});
        renderClusterDashboardTiles().catch(() => {});
        await refreshMonitorScreensAvailability();
        if (monitorMode && monitorCurrentView === 'iperf3' && iperf3MonitorConfigured === false) {
            applyMonitorView('cluster');
        }
    } catch (e) {
        const msg = e instanceof Error && e.message ? e.message : speedtestNetworkErrorMessage(e);
        showToast((t('iperf3ClearError') || '{msg}').replace('{msg}', msg), 'error');
    } finally {
        if (btn) btn.disabled = false;
    }
}

/** Последний ответ /api/debug для экспорта отчёта */
let lastDebugServerData = null;

function getBrowserAndDisplayInfo() {
    const nav = typeof navigator !== 'undefined' ? navigator : {};
    const win = typeof window !== 'undefined' ? window : null;
    const scr = typeof screen !== 'undefined' ? screen : {};
    return {
        userAgent: nav.userAgent || '—',
        language: nav.language || '—',
        languages: (nav.languages && nav.languages.length) ? nav.languages.join(', ') : '—',
        platform: nav.platform || '—',
        hardwareConcurrency: nav.hardwareConcurrency != null ? nav.hardwareConcurrency : '—',
        deviceMemory: nav.deviceMemory != null ? nav.deviceMemory + ' GB' : '—',
        cookieEnabled: !!nav.cookieEnabled,
        screenWidth: scr.width != null ? scr.width : '—',
        screenHeight: scr.height != null ? scr.height : '—',
        availWidth: scr.availWidth != null ? scr.availWidth : '—',
        availHeight: scr.availHeight != null ? scr.availHeight : '—',
        colorDepth: scr.colorDepth != null ? scr.colorDepth + ' bit' : '—',
        pixelRatio: win && win.devicePixelRatio != null ? win.devicePixelRatio : '—',
        innerWidth: win && win.innerWidth != null ? win.innerWidth : '—',
        innerHeight: win && win.innerHeight != null ? win.innerHeight : '—'
    };
}

async function refreshDebugMetrics() {
    const serverEl = document.getElementById('settingsDebugServerMetrics');
    const clientEl = document.getElementById('settingsDebugClientMetrics');
    if (!serverEl || !clientEl) return;
    serverEl.textContent = '…';
    clientEl.textContent = '…';
    let serverText = '—';
    try {
        const [res, updatesData] = await Promise.all([
            fetch('/api/debug'),
            checkForAppUpdates().catch((error) => ({
                error: error && error.message ? error.message : String(error)
            }))
        ]);
        const data = await res.json();
        lastDebugServerData = data;
        const mem = data.memory || {};
        const fmt = (n) => (n != null && typeof n === 'number') ? (n / 1024 / 1024).toFixed(2) + ' MB' : '—';
        const cache = data.cache || {};
        const updateStatus = updatesData && updatesData.error
            ? (t('updateStatusCheckFailed') || 'Update check failed')
            : (updatesData && updatesData.updateAvailable && updatesData.latestVersion)
                ? tParams('updateStatusAvailableShort', { latest: updatesData.latestVersion })
                : (updatesData && updatesData.latestVersion)
                    ? tParams('updateStatusCurrentShort', { version: updatesData.latestVersion })
                    : (t('statusDash') || '—');
        serverText = [
            `version: ${data.version ?? '—'}`,
            `update.status: ${updateStatus}`,
            `update.currentVersion: ${updatesData?.currentVersion ?? data.version ?? '—'}`,
            `update.latestVersion: ${updatesData?.latestVersion ?? '—'}`,
            `update.available: ${updatesData?.updateAvailable != null ? updatesData.updateAvailable : '—'}`,
            `update.checkedAt: ${updatesData?.checkedAt ?? '—'}`,
            `update.releaseUrl: ${updatesData?.releaseUrl ?? updatesData?.repoUrl ?? '—'}`,
            `env: ${data.env ?? '—'}`,
            `node: ${data.nodeVersion ?? '—'}`,
            `platform: ${data.platform ?? '—'} ${data.arch ?? ''}`,
            `uptime: ${data.uptimeSeconds != null ? data.uptimeSeconds + ' s' : '—'}`,
            `startTime: ${data.startTime ?? '—'}`,
            `dbPath: ${data.dbPath ?? '—'}`,
            `memory.rss: ${fmt(mem.rss)}`,
            `memory.heapUsed: ${fmt(mem.heapUsed)}`,
            `memory.heapTotal: ${fmt(mem.heapTotal)}`,
            `cache.keys: ${cache.keys ?? '—'}`,
            `cache.hits: ${cache.hits ?? '—'}`,
            `cache.misses: ${cache.misses ?? '—'}`,
            `connectionsCount: ${data.connectionsCount ?? '—'}`,
            `settingsPasswordSet: ${!!data.settingsPasswordSet}`
        ].join('\n');
    } catch (e) {
        serverText = 'Ошибка: ' + (e.message || String(e));
        lastDebugServerData = null;
    }
    serverEl.textContent = serverText;
    const connId = getCurrentConnectionId();
    const lastRefreshStr = lastRefreshTime != null ? new Date(lastRefreshTime).toLocaleString() : '—';
    const browserDisplay = getBrowserAndDisplayInfo();
    const clientText = [
        '--- App ---',
        `language: ${currentLanguage ?? '—'}`,
        `backends: proxmox=${!!getAuthHeadersForType('proxmox')} truenas=${!!getAuthHeadersForType('truenas')}`,
        `connectionId: ${connId ?? '—'}`,
        `refreshIntervalMs: ${refreshIntervalMs ?? '—'}`,
        `lastRefreshTime: ${lastRefreshStr}`,
        `monitorMode: ${!!monitorMode}`,
        `monitorTheme: ${monitorTheme ?? '—'}`,
        `settingsPasswordRequired: ${!!settingsPasswordRequired}`,
        '',
        '--- Browser ---',
        `userAgent: ${browserDisplay.userAgent}`,
        `language: ${browserDisplay.language}`,
        `languages: ${browserDisplay.languages}`,
        `platform: ${browserDisplay.platform}`,
        `hardwareConcurrency: ${browserDisplay.hardwareConcurrency}`,
        `deviceMemory: ${browserDisplay.deviceMemory}`,
        `cookieEnabled: ${browserDisplay.cookieEnabled}`,
        '',
        '--- Display ---',
        `screen: ${browserDisplay.screenWidth} × ${browserDisplay.screenHeight}`,
        `avail: ${browserDisplay.availWidth} × ${browserDisplay.availHeight}`,
        `colorDepth: ${browserDisplay.colorDepth}`,
        `devicePixelRatio: ${browserDisplay.pixelRatio}`,
        `inner (viewport): ${browserDisplay.innerWidth} × ${browserDisplay.innerHeight}`
    ].join('\n');
    clientEl.textContent = clientText;
}

async function pingDebugApi() {
    const el = document.getElementById('settingsDebugPingResult');
    if (!el) return;
    el.textContent = '…';
    const t0 = performance.now();
    try {
        await fetch('/api/debug');
        const ms = Math.round(performance.now() - t0);
        el.textContent = (t('settingsDebugPingResult') || 'Пинг: %d ms').replace('%d', String(ms));
    } catch (e) {
        el.textContent = (t('errorUpdate') || 'Ошибка') + ': ' + (e.message || String(e));
    }
}

async function clearDebugCache() {
    try {
        const res = await fetch('/api/cache/clear', { method: 'POST' });
        const data = await res.json();
        if (data.success) {
            showToast(t('settingsDebugCacheCleared') || 'Кэш очищен', 'success');
            refreshDebugMetrics();
        } else {
            showToast((data.error || 'Error') + '', 'error');
        }
    } catch (e) {
        showToast((e.message || String(e)) + '', 'error');
    }
}

async function resetAllSettings() {
    const btn = document.getElementById('settingsDebugResetAllBtn');
    const cb = document.getElementById('settingsDebugResetAllConfirmCheckbox');
    if (btn) btn.disabled = true;

    if (cb && !cb.checked) {
        showToast(t('settingsDebugResetAllNeedCheckboxText') || 'Please confirm by checkbox', 'error');
        if (btn) btn.disabled = false;
        return;
    }

    try {
        const res = await fetch('/api/settings/reset', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' });
        const data = await res.json().catch(() => ({}));
        if (res.ok && data.success !== false) {
            showToast(t('settingsDebugResetAllDone') || 'All settings reset', 'success');
            window.location.reload();
        } else {
            const msg = data.error || t('settingsDebugResetAllError') || 'Reset failed';
            showToast(String(msg), 'error');
        }
    } catch (e) {
        showToast((t('settingsDebugResetAllError') || 'Reset failed') + ': ' + (e.message || String(e)), 'error');
    } finally {
        if (btn) btn.disabled = false;
    }
}

function exportDebugReport() {
    const client = {
        language: currentLanguage,
        backends: { proxmox: !!getAuthHeadersForType('proxmox'), truenas: !!getAuthHeadersForType('truenas') },
        connectionId: getCurrentConnectionId(),
        refreshIntervalMs,
        lastRefreshTime: lastRefreshTime != null ? new Date(lastRefreshTime).toISOString() : null,
        monitorMode: !!monitorMode,
        monitorTheme,
        settingsPasswordRequired: !!settingsPasswordRequired,
        browser: getBrowserAndDisplayInfo()
    };
    const report = {
        exportedAt: new Date().toISOString(),
        server: lastDebugServerData,
        client
    };
    const blob = new Blob([JSON.stringify(report, null, 2)], { type: 'application/json' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = 'debug-report-' + new Date().toISOString().slice(0, 19).replace(/:/g, '-') + '.json';
    a.click();
    URL.revokeObjectURL(a.href);
}

function reloadPage() {
    window.location.reload();
}

async function backendRecoveryWatchTick() {
    if (backendRecoveryReloadDone) return;
    try {
        const res = await fetch('/api/status', { cache: 'no-store' });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        setBackendOfflineBannerVisible(false);
        if (backendWasUnavailable) {
            backendRecoveryReloadDone = true;
            window.location.reload();
            return;
        }
        backendWasUnavailable = false;
        if (backendRecoveryWatchTimer) {
            clearInterval(backendRecoveryWatchTimer);
            backendRecoveryWatchTimer = null;
        }
    } catch (_) {
        setBackendOfflineBannerVisible(true);
        backendWasUnavailable = true;
    }
}

function startBackendRecoveryWatcher() {
    if (backendRecoveryWatchTimer) return;
    backendRecoveryWatchTick().catch(() => {});
    backendRecoveryWatchTimer = setInterval(() => {
        backendRecoveryWatchTick().catch(() => {});
    }, 3000);
}

function reloadApplication() {
    // Перезапуск Node.js-сервера через API; авто-watcher перезагрузит страницу после восстановления /api/status.
    fetch('/api/restart', { method: 'POST' })
        .then(function () {
            showToast(t('settingsDebugRestarting') || 'Перезапуск сервера…', 'info');
            backendWasUnavailable = true;
            backendRecoveryReloadDone = false;
            startBackendRecoveryWatcher();
        })
        .catch(function (err) {
            showToast((t('settingsDebugRestartError') || 'Ошибка перезапуска') + ': ' + (err.message || err), 'error');
        });
}

// Show settings section
async function showConfig() {
    if (!(await ensureSettingsUnlocked())) return;
    document.getElementById('configSection').style.display = 'block';
    document.getElementById('dashboardSection').style.display = 'none';
    hideAllMonitorShellSections();
    await loadSettingsPanelData();
    if (autoRefreshInterval) {
        clearInterval(autoRefreshInterval);
        autoRefreshInterval = null;
    }
    updateHomelabMenuChrome();
}

async function openSettingsFromMonitor() {
    if (monitorMode) {
        await toggleMonitorMode();
    }
    await showConfig();
}

// Toggle settings visibility
async function toggleSettings() {
    const configSection = document.getElementById('configSection');
    const dashboardSection = document.getElementById('dashboardSection');
    if (configSection.style.display === 'none' || configSection.style.display === '') {
        if (!(await ensureSettingsUnlocked())) return;
        configSection.style.display = 'block';
        dashboardSection.style.display = 'none';
        hideAllMonitorShellSections();
        await loadSettingsPanelData();
        if (autoRefreshInterval) {
            clearInterval(autoRefreshInterval);
            autoRefreshInterval = null;
        }
        updateHomelabMenuChrome();
    } else {
        configSection.style.display = 'none';
        dashboardSection.style.display = 'block';
        hideAllMonitorShellSections();
        homelabNormalNavView = 'cluster';
        if (apiToken) {
            refreshData();
            startAutoRefresh();
        }
        updateHomelabMenuChrome();
    }
}

function onSettingsNavSectionChange(section) {
    // Мы держим все настройки UPS/Netdev внутри settings-tab-services по разметке,
    // но по клику слева показываем "только нужный блок", чтобы экраны не выглядели одинаково.
    // section: 'services' | 'vms' | 'ups' | 'netdev' | 'hostMetrics' | 'ipmi' | 'smartSensors'
    const servicesHosts = document.getElementById('servicesHostsSettingsWrap');
    const upsWrap = document.getElementById('upsSettingsCardWrap');
    const netdevWrap = document.getElementById('netdevSettingsCardWrap');
    const hostMetricsWrap = document.getElementById('hostMetricsSettingsWrap');
    const ipmiWrap = document.getElementById('ipmiSettingsWrap');
    const vmsWrap = document.getElementById('vmsForMonitoringSettingsWrap');
    const smartWrap = document.getElementById('smartSensorsSettingsCardWrap');

    if (!servicesHosts || !upsWrap || !netdevWrap || !vmsWrap) return;

    const hide = (el) => {
        if (el) el.style.display = 'none';
    };
    const show = (el) => {
        if (el) el.style.display = '';
    };

    hide(servicesHosts);
    hide(upsWrap);
    hide(netdevWrap);
    hide(vmsWrap);
    if (hostMetricsWrap) hide(hostMetricsWrap);
    if (ipmiWrap) hide(ipmiWrap);
    if (smartWrap) hide(smartWrap);

    if (section === 'ups') {
        show(upsWrap);
    } else if (section === 'netdev') {
        show(netdevWrap);
    } else if (section === 'hostMetrics') {
        show(hostMetricsWrap);
    } else if (section === 'ipmi') {
        if (ipmiWrap) show(ipmiWrap);
    } else if (section === 'smartSensors') {
        if (smartWrap) show(smartWrap);
        loadSmartSensorsSettings();
    } else if (section === 'vms') {
        show(vmsWrap);
    } else {
        // Мониторинг сервисов: только таблица хостов (без VM/CT, UPS, SNMP, метрик).
        show(servicesHosts);
    }
}

function moveUpsSettingsCardToSeparateTab() {
    const wrap = document.getElementById('upsSettingsCardWrap');
    const container = document.getElementById('upsSettingsContainer');
    if (!wrap || !container) return;
    if (container.contains(wrap)) return;

    try {
        container.innerHTML = '';
        container.appendChild(wrap);
    } catch (e) {
        console.warn('Failed to move UPS settings block:', e);
    }
}

function moveNetdevSettingsCardToSeparateTab() {
    const wrap = document.getElementById('netdevSettingsCardWrap');
    const container = document.getElementById('netdevSettingsContainer');
    if (!wrap || !container) return;
    if (container.contains(wrap)) return;

    try {
        container.innerHTML = '';
        container.appendChild(wrap);
    } catch (e) {
        console.warn('Failed to move Netdev settings block:', e);
    }
}

// Toggle monitor mode — переключаем полноэкранные экраны
async function toggleMonitorMode() {
    monitorMode = !monitorMode;
    saveSettingsToServer({ monitorMode });

    const dashboardSection = document.getElementById('dashboardSection');
    const dashboardContent = document.getElementById('dashboardContent');

    document.body.classList.toggle('monitor-mode', monitorMode);
    applyMonitorRootLayoutClass(monitorMode);
    applyMonitorViewportPageZoomLock(monitorMode);
    applyMonitorChromeGestureGuards();

    const btn = document.getElementById('monitorModeBtn');
    if (monitorMode) {
        // Входим в режим монитора: fullscreen, крупные блоки, свайпы, текущий экран — кластер
        if (btn) {
            btn.classList.add('active');
            btn.classList.remove('btn-outline-secondary');
            btn.classList.add('btn-primary');
            btn.innerHTML = '<i class="bi bi-check-lg"></i><span id="monitorModeText">' + t('monitorModeOn') + '</span>';
        }
        applyMonitorTheme();
        initMonitorSwipes();
        initMonitorKeyboardNavigation();

        // Определяем доступность ups/netdev/speedtest, чтобы свайп-циклы не включали “пустые/не настроенные” экраны.
        await refreshMonitorScreensAvailability();

        monitorCurrentView = resolveMonitorStartupView();
        applyMonitorView(monitorCurrentView);
        applyMonitorToolbarHiddenState();
    } else {
        // Выходим из режима монитора: возвращаем обычный дашборд
        if (btn) {
            btn.classList.remove('active', 'btn-primary');
            btn.classList.add('btn-outline-secondary', 'app-topbar-btn');
            btn.innerHTML = '<i class="bi bi-display"></i><span id="monitorModeText">' + t('monitorMode') + '</span>';
        }
        document.body.classList.remove('monitor-theme-dark');
        destroyMonitorSwipes();

        if (dashboardSection) dashboardSection.style.display = 'block';
        if (dashboardContent) dashboardContent.style.display = 'block';
        hideAllMonitorShellSections();
        document.body.classList.remove('monitor-toolbar-hidden', 'monitor-dots-hidden');
        syncMonitorToolbarRevealButton();
        renderMonitorScreenDots();
        applyStoredDashboardHomeTab();
        homelabNormalNavView = 'cluster';
    }

    try {
        if (monitorMode) {
            if (!document.fullscreenElement && document.documentElement.requestFullscreen) {
                await document.documentElement.requestFullscreen();
            }
        } else {
            if (document.fullscreenElement && document.exitFullscreen) {
                await document.exitFullscreen();
            }
        }
    } catch (e) {
        console.warn('Fullscreen toggle failed:', e);
    }

    if (apiToken || getCurrentConnectionId()) refreshData();
    renderDashboardTimeWeatherCard();
    updateHomelabMenuChrome();
}

/** Текущий экран режима монитора */
let monitorCurrentView = 'cluster';
/** Последние данные бэкапов для экрана монитора */
let lastBackupsDataForMonitor = null;

/** Полный порядок экранов монитора (в БД). */
const MONITOR_SCREEN_IDS_ALL = ['cluster', 'tiles', 'truenasPools', 'truenasDisks', 'truenasServices', 'truenasApps', 'ups', 'netdev', 'speedtest', 'iperf3', 'smartSensors', 'vms', 'services', 'backupRuns', 'draw'];
const MONITOR_VIEW_SESSION_KEY = 'hm_monitor_current_view';

function readStoredMonitorCurrentView() {
    try {
        const v = sessionStorage.getItem(MONITOR_VIEW_SESSION_KEY);
        if (v && MONITOR_SCREEN_IDS_ALL.includes(v)) return v;
    } catch (_) {}
    return null;
}

function persistMonitorCurrentView(view) {
    try {
        if (view && MONITOR_SCREEN_IDS_ALL.includes(view)) {
            sessionStorage.setItem(MONITOR_VIEW_SESSION_KEY, view);
        }
    } catch (_) {}
}

/** Вкладки главного дашборда (Bootstrap #myTab) — запоминаем в обычном режиме между F5 и loadSettings */
const DASHBOARD_HOME_TAB_IDS = ['nodes-tab', 'storage-tab', 'servers-tab', 'backups-tab', 'quorum-tab'];
const DASHBOARD_HOME_TAB_SESSION_KEY = 'hm_dashboard_home_tab';

function readStoredDashboardHomeTab() {
    try {
        const v = sessionStorage.getItem(DASHBOARD_HOME_TAB_SESSION_KEY);
        if (v && DASHBOARD_HOME_TAB_IDS.includes(v)) return v;
    } catch (_) {}
    return null;
}

function persistDashboardHomeTab(tabButtonId) {
    try {
        if (tabButtonId && DASHBOARD_HOME_TAB_IDS.includes(tabButtonId)) {
            sessionStorage.setItem(DASHBOARD_HOME_TAB_SESSION_KEY, tabButtonId);
        }
    } catch (_) {}
}

function applyStoredDashboardHomeTab() {
    if (monitorMode) return;
    const myTabNav = document.getElementById('myTab');
    if (!myTabNav || myTabNav.style.display === 'none') return;
    const id = readStoredDashboardHomeTab();
    if (!id) return;
    const btn = document.getElementById(id);
    if (!btn) return;
    const li = btn.closest('li');
    if (li && li.style.display === 'none') return;
    if (btn.classList.contains('active')) return;
    btn.click();
}

let monitorScreensOrder = MONITOR_SCREEN_IDS_ALL.slice();
let monitorScreensEnabled = {};
/** Стартовый экран монитора (если нет сохранённого в sessionStorage для этой вкладки). */
let monitorDefaultScreen = 'cluster';
const monitorScreensManager = window.MonitorScreensModule.createManager({
    screenIds: MONITOR_SCREEN_IDS_ALL,
    t,
    escapeHtml
});
const monitorViewRouterManager = window.MonitorViewRouterModule.createManager({
    renderMonitoredServices: () => renderMonitoredServices(),
    renderVmsMonitorCards: () => renderVmsMonitorCards(),
    updateUPSDashboard: () => updateUPSDashboard(),
    updateNetdevDashboard: () => updateNetdevDashboard(),
    updateSpeedtestDashboard: () => updateSpeedtestDashboard(),
    updateIperf3Dashboard: () => updateIperf3Dashboard(),
    updateSmartSensorsDashboard: () => updateSmartSensorsDashboard(),
    renderTilesMonitorScreen: () => renderTilesMonitorScreen(),
    resizeTilesCharts: () => resizeTilesCharts(),
    refreshData: (opts) => refreshData(opts),
    renderTrueNASMonitorScreenTiles: (gridId, type) => renderTrueNASMonitorScreenTiles(gridId, type),
    renderMonitorBackupRuns: (data) => renderMonitorBackupRuns(data),
    initMonitorDrawScreen: () => initMonitorDrawScreen(),
    resizeMonitorDrawCanvas: () => resizeMonitorDrawCanvas()
});
const monitorInteractionsManager = window.MonitorInteractionsModule.createManager({
    getMonitorMode: () => monitorMode,
    getMonitorDisableChromeGestures: () => monitorDisableChromeGestures,
    isDrawSwipesBlocked: () => monitorDrawSwipesBlocked(),
    onPrev: () => goMonitorView('prev'),
    onNext: () => goMonitorView('next'),
    onHome: () => applyMonitorView('cluster'),
    captureHotkeyCombo: (e) => {
        const key = String(e.key || '').trim();
        const parts = [];
        if (e.metaKey) parts.push('Meta');
        if (e.ctrlKey) parts.push('Ctrl');
        if (e.altKey) parts.push('Alt');
        if (e.shiftKey) parts.push('Shift');
        if (key && !['Control', 'Shift', 'Alt', 'Meta'].includes(key)) parts.push(key.length === 1 ? key.toUpperCase() : key);
        else if (!parts.length && key) {
            if (key === 'Meta') parts.push('Meta');
            else if (key === 'Control') parts.push('Ctrl');
            else if (key === 'Alt') parts.push('Alt');
            else if (key === 'Shift') parts.push('Shift');
        }
        return normalizeMonitorHotkeyCombo(parts.join('+'));
    },
    onHotkeyCombo: (combo) => queueMonitorHotkeyCombo(combo)
});
const monitorHotkeysManager = window.MonitorHotkeysModule.createManager({
    t,
    escapeHtml,
    api: {
        refreshData: () => refreshData(),
        reloadPage: () => window.location.reload(),
        goHome: () => applyMonitorView('cluster'),
        closeBrowser: () => {
            try { window.close(); } catch (_) {}
            setTimeout(() => {
                if (!document.hidden) window.location.href = 'about:blank';
            }, 150);
        }
    }
});
const MONITOR_HOTKEY_ACTIONS = monitorHotkeysManager.actions;
const DEFAULT_MONITOR_HOTKEYS = monitorHotkeysManager.defaultHotkeys;
let monitorHotkeys = DEFAULT_MONITOR_HOTKEYS.map((x) => ({ ...x }));
/** Speedtest включён в настройках (для скрытия экрана в режиме монитора) */
let speedtestClientEnabled = false;
/** Активный движок Speedtest: ookla | librespeed */
let speedtestEngine = 'ookla';
/** iperf3 включён в настройках */
let iperf3ClientEnabled = false;

// Доступность экранов зависит от реальной конфигурации (а не только от порядка в настройках).
// Значение: null = неизвестно (не грузили/ошибка), true/false = известная доступность.
let upsMonitorConfigured = null;
let netdevMonitorConfigured = null;
let speedtestMonitorConfigured = null;
let iperf3MonitorConfigured = null;
let smartSensorsMonitorConfigured = null;

function resetMonitorChromeGestureState() {
    // delegated to monitorInteractionsManager state
}

/** Слушатели вешаются один раз; флаги monitorMode + monitorDisableChromeGestures включают блокировку. */
function initMonitorChromeGestureGuards() {
    monitorInteractionsManager.initChromeGestureGuards();
}

function applyMonitorChromeGestureGuards() {
    monitorInteractionsManager.applyChromeGestureGuards();
}

/** Класс на <html>: overscroll / жесты браузера завязаны на корень документа */
function applyMonitorRootLayoutClass(enabled) {
    monitorInteractionsManager.applyRootLayoutClass(enabled);
}

/** Запрет масштабирования страницы в режиме монитора (pinch / Ctrl+колесо / Safari gesture). */
function applyMonitorViewportPageZoomLock(enabled) {
    monitorInteractionsManager.applyViewportPageZoomLock(enabled);
}

function initMonitorPageZoomGuards() {
    monitorInteractionsManager.initPageZoomGuards();
}

async function refreshMonitorScreensAvailability() {
    const safeSet = (key, val) => {
        if (val === true || val === false) {
            if (key === 'ups') upsMonitorConfigured = val;
            if (key === 'netdev') netdevMonitorConfigured = val;
            if (key === 'speedtest') speedtestMonitorConfigured = val;
            if (key === 'iperf3') iperf3MonitorConfigured = val;
            if (key === 'smartSensors') smartSensorsMonitorConfigured = val;
        }
    };

    try {
        try {
            const sensRes = await fetch('/api/smart-sensors/current');
            if (sensRes.ok) {
                const sData = await sensRes.json();
                safeSet('smartSensors', !!(sData && sData.configured && Array.isArray(sData.items) && sData.items.length > 0));
            }
        } catch (_) {}

        // Если пользователь ещё не подключился к серверу/кластеру — не пытаемся определять доступность
        // UPS/Netdev/Speedtest, чтобы не “обнулить” экраны из-за ошибок авторизации.
        if (!apiToken && !getCurrentConnectionId()) return;

        const [upsRes, netdevRes, speedRes, iperfRes] = await Promise.allSettled([
            fetch('/api/ups/current'),
            fetch('/api/netdevices/current'),
            fetch('/api/speedtest/summary'),
            fetch('/api/iperf3/summary')
        ]);

        if (upsRes.status === 'fulfilled' && upsRes.value?.ok) {
            const data = await upsRes.value.json();
            safeSet('ups', !!(data && data.configured && Array.isArray(data.items) && data.items.length > 0));
        }
        if (netdevRes.status === 'fulfilled' && netdevRes.value?.ok) {
            const data = await netdevRes.value.json();
            safeSet('netdev', !!(data && data.configured && Array.isArray(data.items) && data.items.length > 0));
        }
        if (speedRes.status === 'fulfilled' && speedRes.value?.ok) {
            const data = await speedRes.value.json();
            const enabled = !!(data?.enabled === true || data?.enabled === '1' || data?.enabled === 1);
            const hasHistory = !!(data?.last && data.last.runAt);
            safeSet('speedtest', enabled || hasHistory);
        }
        if (iperfRes.status === 'fulfilled' && iperfRes.value?.ok) {
            const data = await iperfRes.value.json();
            const enabled = !!(data?.enabled === true || data?.enabled === '1' || data?.enabled === 1);
            const hasHistory = !!(data?.last && data.last.runAt);
            safeSet('iperf3', enabled || hasHistory);
        }
    } catch (e) {
        // Оставляем значения как есть (null/предыдущие), чтобы не скрыть экраны “по ошибке сети”.
        console.warn('Failed to detect monitor screens availability:', e);
    }
}

function normalizeMonitorScreensOrder(arr) {
    return monitorScreensManager.normalizeOrder(arr);
}

function normalizeMonitorScreensEnabled(raw) {
    return monitorScreensManager.normalizeEnabled(raw);
}

function normalizeSavedViews(raw) {
    if (!Array.isArray(raw)) return [];
    const out = [];
    for (const entry of raw) {
        if (!entry || typeof entry !== 'object') continue;
        const name = String(entry.name || '').trim();
        if (!name) continue;
        const payload = entry.payload && typeof entry.payload === 'object' ? entry.payload : {};
        out.push({
            id: String(entry.id || `sv_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`),
            name: name.slice(0, 80),
            createdAt: entry.createdAt ? String(entry.createdAt) : new Date().toISOString(),
            payload: {
                monitorScreensOrder: normalizeMonitorScreensOrder(payload.monitorScreensOrder),
                monitorScreensEnabled: normalizeMonitorScreensEnabled(payload.monitorScreensEnabled),
                monitorDefaultScreen: normalizeMonitorDefaultScreenFromServer(payload.monitorDefaultScreen),
                clusterDashboardTiles: normalizeClusterDashboardTiles(payload.clusterDashboardTiles),
                monitorHiddenServiceIds: Array.isArray(payload.monitorHiddenServiceIds) ? payload.monitorHiddenServiceIds.map((x) => Number(x)).filter(Number.isFinite) : [],
                monitorVms: Array.isArray(payload.monitorVms) ? payload.monitorVms.map((x) => Number(x)).filter(Number.isFinite) : [],
                monitorHiddenVmIds: Array.isArray(payload.monitorHiddenVmIds) ? payload.monitorHiddenVmIds.map((x) => Number(x)).filter(Number.isFinite) : []
            }
        });
    }
    return out.slice(0, 20);
}

function normalizeSavedTileViews(raw) {
    if (!Array.isArray(raw)) return [];
    const out = [];
    for (const entry of raw) {
        if (!entry || typeof entry !== 'object') continue;
        const name = String(entry.name || '').trim();
        if (!name) continue;
        const payload = entry.payload && typeof entry.payload === 'object' ? entry.payload : {};
        out.push({
            id: String(entry.id || `stv_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`),
            name: name.slice(0, 80),
            createdAt: entry.createdAt ? String(entry.createdAt) : new Date().toISOString(),
            payload: {
                clusterDashboardTiles: normalizeClusterDashboardTiles(payload.clusterDashboardTiles),
                monitorTilesChartAxisTime: parseBoolSettingClient(payload.monitorTilesChartAxisTime, true),
                monitorTilesChartAxisValues: parseBoolSettingClient(payload.monitorTilesChartAxisValues, true),
                monitorTilesChartAxisYUnit: parseBoolSettingClient(payload.monitorTilesChartAxisYUnit, true),
                tilesChartDisplayVariant: ['area', 'line', 'minimal'].includes(String(payload.tilesChartDisplayVariant || '').toLowerCase())
                    ? String(payload.tilesChartDisplayVariant).toLowerCase()
                    : 'area',
                chartWindowClusterMetricMin: normalizeChartWindowMinutes(payload.chartWindowClusterMetricMin, 1440),
                chartWindowHostMetricMin: normalizeChartWindowMinutes(payload.chartWindowHostMetricMin, 1440),
                chartWindowUpsMetricMin: normalizeChartWindowMinutes(payload.chartWindowUpsMetricMin, 1440),
                chartWindowSmartSensorMetricMin: normalizeChartWindowMinutes(payload.chartWindowSmartSensorMetricMin, 1440)
            }
        });
    }
    return out.slice(0, 20);
}

function normalizeMonitorHotkeyCombo(raw) {
    return monitorHotkeysManager.normalizeCombo(raw);
}

function normalizeMonitorHotkeys(raw) {
    return monitorHotkeysManager.normalizeHotkeys(raw);
}

function monitorHotkeyActionLabel(action) {
    return monitorHotkeysManager.actionLabel(action);
}

function executeMonitorHotkeyAction(action) {
    return monitorHotkeysManager.executeAction(action);
}

function queueMonitorHotkeyCombo(combo) {
    monitorHotkeys = normalizeMonitorHotkeys(monitorHotkeys);
    return monitorHotkeysManager.queueCombo(combo, monitorHotkeys);
}

function renderMonitorHotkeysSettingsUI() {
    const wrap = el('monitorHotkeysList');
    if (!wrap) return;
    monitorHotkeys = normalizeMonitorHotkeys(monitorHotkeys);
    monitorHotkeysManager.renderSettingsUI(wrap, monitorHotkeys, (next) => {
        monitorHotkeys = normalizeMonitorHotkeys(next);
    });
}

function getMonitorViewsOrder() {
    return monitorScreensManager.getViewsOrder({
        order: monitorScreensOrder,
        enabled: monitorScreensEnabled,
        hasProxmoxBackendAuth: !!getAuthHeadersForType('proxmox'),
        speedtestClientEnabled,
        iperf3ClientEnabled,
        availability: {
            ups: upsMonitorConfigured,
            netdev: netdevMonitorConfigured,
            speedtest: speedtestMonitorConfigured,
            iperf3: iperf3MonitorConfigured,
            smartSensors: smartSensorsMonitorConfigured
        }
    });
}

function normalizeMonitorDefaultScreenFromServer(raw) {
    const s = raw != null ? String(raw).trim() : '';
    if (!s || s === 'cluster') return 'cluster';
    return MONITOR_SCREEN_IDS_ALL.includes(s) ? s : 'cluster';
}

/** Стартовый экран: сначала sessionStorage, иначе настройка по умолчанию, иначе первый из доступного цикла. */
function resolveMonitorStartupView() {
    const views = getMonitorViewsOrder();
    const fromSession = readStoredMonitorCurrentView();
    if (fromSession && views.includes(fromSession)) return fromSession;
    const def = normalizeMonitorDefaultScreenFromServer(monitorDefaultScreen);
    if (views.includes(def)) return def;
    return views[0] || 'cluster';
}

function monitorScreenSettingsLabel(id) {
    return monitorScreensManager.label(id);
}

function fillSettingsMonitorDefaultScreenSelect() {
    const sel = document.getElementById('settingsMonitorDefaultScreenSelect');
    if (!sel) return;
    const cur = normalizeMonitorDefaultScreenFromServer(monitorDefaultScreen);
    sel.innerHTML = MONITOR_SCREEN_IDS_ALL.map((id) =>
        `<option value="${escapeHtml(id)}">${escapeHtml(monitorScreenSettingsLabel(id))}</option>`
    ).join('');
    sel.value = MONITOR_SCREEN_IDS_ALL.includes(cur) ? cur : 'cluster';
}

function onSettingsMonitorDefaultScreenChange() {
    const sel = document.getElementById('settingsMonitorDefaultScreenSelect');
    if (!sel) return;
    monitorDefaultScreen = normalizeMonitorDefaultScreenFromServer(sel.value);
    saveSettingsToServer({ monitorDefaultScreen });
}

function renderSettingsMonitorScreensOrderList() {
    const ul = document.getElementById('settingsMonitorScreensOrderList');
    if (!ul) return;
    monitorScreensOrder = monitorScreensManager.renderSettingsOrderList(ul, {
        order: monitorScreensOrder,
        enabled: monitorScreensEnabled
    });
    ul.querySelectorAll('.monitor-screen-enable-input').forEach((node) => {
        node.addEventListener('change', () => {
            const id = String(node.dataset.id || '');
            toggleMonitorScreenEnabled(id, !!node.checked);
        });
    });
    ul.querySelectorAll('.monitor-screen-up-btn').forEach((btn) => {
        btn.addEventListener('click', () => moveMonitorScreenOrder(parseInt(btn.dataset.index, 10), -1));
    });
    ul.querySelectorAll('.monitor-screen-down-btn').forEach((btn) => {
        btn.addEventListener('click', () => moveMonitorScreenOrder(parseInt(btn.dataset.index, 10), 1));
    });
    fillSettingsMonitorDefaultScreenSelect();
    renderSavedViewsSettingsList();
}

function toggleMonitorScreenEnabled(id, enabled) {
    if (!MONITOR_SCREEN_IDS_ALL.includes(id)) return;
    monitorScreensEnabled = monitorScreensManager.toggleEnabled(monitorScreensEnabled, id, enabled);
    saveSettingsToServer({ monitorScreensEnabled });
    renderSettingsMonitorScreensOrderList();
    renderMonitorScreenDots();
}

function moveMonitorScreenOrder(index, delta) {
    monitorScreensOrder = monitorScreensManager.moveOrder(monitorScreensOrder, index, delta);
    saveSettingsToServer({ monitorScreensOrder: monitorScreensOrder });
    renderSettingsMonitorScreensOrderList();
    renderMonitorScreenDots();
}

function captureCurrentSavedViewPayload() {
    return {
        monitorScreensOrder: normalizeMonitorScreensOrder(monitorScreensOrder),
        monitorScreensEnabled: normalizeMonitorScreensEnabled(monitorScreensEnabled),
        monitorDefaultScreen: normalizeMonitorDefaultScreenFromServer(monitorDefaultScreen),
        clusterDashboardTiles: normalizeClusterDashboardTiles(clusterDashboardTiles),
        monitorHiddenServiceIds: Array.isArray(monitorHiddenServiceIds) ? monitorHiddenServiceIds.slice() : [],
        monitorVms: Array.isArray(monitoredVmIds) ? monitoredVmIds.slice() : [],
        monitorHiddenVmIds: Array.isArray(monitorHiddenVmIds) ? monitorHiddenVmIds.slice() : []
    };
}

async function persistSavedViews() {
    savedViews = normalizeSavedViews(savedViews);
    await saveSettingsToServer({ savedViews });
}

async function saveCurrentAsSavedView() {
    const input = el('settingsSavedViewNameInput');
    if (!input) return;
    const name = String(input.value || '').trim();
    if (!name) {
        showToast(tOr('settingsSavedViewsNameRequired', 'Enter view name'), 'warning');
        input.focus();
        return;
    }
    savedViews = [{
        id: `sv_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
        name: name.slice(0, 80),
        createdAt: new Date().toISOString(),
        payload: captureCurrentSavedViewPayload()
    }, ...savedViews].slice(0, 20);
    await persistSavedViews();
    input.value = '';
    renderSavedViewsSettingsList();
    showToast(tOr('settingsSavedViewsSaved', 'Saved'), 'success');
}

async function applySavedView(id) {
    const item = savedViews.find((v) => String(v.id) === String(id));
    if (!item || !item.payload) return;
    const p = item.payload;
    monitorScreensOrder = normalizeMonitorScreensOrder(p.monitorScreensOrder);
    monitorScreensEnabled = normalizeMonitorScreensEnabled(p.monitorScreensEnabled);
    monitorDefaultScreen = normalizeMonitorDefaultScreenFromServer(p.monitorDefaultScreen);
    clusterDashboardTiles = normalizeClusterDashboardTiles(p.clusterDashboardTiles);
    clusterDashboardTilesDirty = false;
    monitorHiddenServiceIds = Array.isArray(p.monitorHiddenServiceIds) ? p.monitorHiddenServiceIds.slice() : [];
    monitoredVmIds = Array.isArray(p.monitorVms) ? p.monitorVms.slice() : [];
    monitorHiddenVmIds = Array.isArray(p.monitorHiddenVmIds) ? p.monitorHiddenVmIds.slice() : [];
    fillSettingsMonitorDefaultScreenSelect();
    renderSettingsMonitorScreensOrderList();
    renderClusterDashboardTilesSettings();
    renderSettingsMonitoredServices();
    renderSettingsMonitoredVms();
    renderMonitorServicesList();
    renderMonitorVmsList();
    renderMonitorScreenDots();
    await saveSettingsToServer({
        monitorScreensOrder,
        monitorScreensEnabled,
        monitorDefaultScreen,
        clusterDashboardTiles,
        monitorHiddenServiceIds,
        monitorVms: monitoredVmIds,
        monitorHiddenVmIds
    });
    renderClusterDashboardTiles().catch(() => {});
    showToast(tOr('settingsSavedViewsApplied', 'Applied') + `: ${item.name}`, 'success');
}

async function overwriteSavedView(id) {
    const idx = savedViews.findIndex((v) => String(v.id) === String(id));
    if (idx < 0) return;
    savedViews[idx] = {
        ...savedViews[idx],
        createdAt: new Date().toISOString(),
        payload: captureCurrentSavedViewPayload()
    };
    await persistSavedViews();
    renderSavedViewsSettingsList();
    showToast(tOr('settingsSavedViewsOverwritten', 'Overwritten'), 'success');
}

async function deleteSavedView(id) {
    savedViews = savedViews.filter((v) => String(v.id) !== String(id));
    await persistSavedViews();
    renderSavedViewsSettingsList();
}

function renderSavedViewsSettingsList() {
    const list = el('settingsSavedViewsList');
    if (!list) return;
    if (!Array.isArray(savedViews) || !savedViews.length) {
        setHTMLIfChanged('settingsSavedViewsList', `<div class="text-muted small">${escapeHtml(t('backupNoData') || 'No data')}</div>`);
        return;
    }
    const html = savedViews.map((v) => `
        <div class="list-group-item d-flex align-items-center justify-content-between gap-2">
            <div class="text-truncate">
                <div class="fw-semibold text-truncate">${escapeHtml(v.name)}</div>
                <div class="small text-muted">${escapeHtml(new Date(v.createdAt || Date.now()).toLocaleString(currentLanguage === 'ru' ? 'ru-RU' : 'en-US'))}</div>
            </div>
            <div class="btn-group btn-group-sm">
                <button type="button" class="btn btn-outline-primary" onclick="applySavedView('${escapeHtml(v.id)}')">${escapeHtml(tOr('apply', 'Apply'))}</button>
                <button type="button" class="btn btn-outline-secondary" onclick="overwriteSavedView('${escapeHtml(v.id)}')">${escapeHtml(tOr('settingsSavedViewsOverwrite', 'Overwrite'))}</button>
                <button type="button" class="btn btn-outline-danger" onclick="deleteSavedView('${escapeHtml(v.id)}')">${escapeHtml(t('remove') || 'Remove')}</button>
            </div>
        </div>
    `).join('');
    setHTMLIfChanged('settingsSavedViewsList', html);
}

function captureCurrentSavedTileViewPayload() {
    return {
        clusterDashboardTiles: normalizeClusterDashboardTiles(clusterDashboardTiles),
        monitorTilesChartAxisTime: !!monitorTilesChartAxisTime,
        monitorTilesChartAxisValues: !!monitorTilesChartAxisValues,
        monitorTilesChartAxisYUnit: !!monitorTilesChartAxisYUnit,
        tilesChartDisplayVariant,
        chartWindowClusterMetricMin,
        chartWindowHostMetricMin,
        chartWindowUpsMetricMin,
        chartWindowSmartSensorMetricMin
    };
}

async function persistSavedTileViews() {
    savedTileViews = normalizeSavedTileViews(savedTileViews);
    await saveSettingsToServer({ savedTileViews });
}

async function saveCurrentAsSavedTileView() {
    const input = el('settingsSavedTileViewNameInput');
    if (!input) return;
    const name = String(input.value || '').trim();
    if (!name) {
        showToast(tOr('settingsSavedTileViewsNameRequired', 'Enter view name'), 'warning');
        input.focus();
        return;
    }
    savedTileViews = [{
        id: `stv_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
        name: name.slice(0, 80),
        createdAt: new Date().toISOString(),
        payload: captureCurrentSavedTileViewPayload()
    }, ...savedTileViews].slice(0, 20);
    await persistSavedTileViews();
    input.value = '';
    renderSavedTileViewsSettingsList();
    showToast(tOr('settingsSavedTileViewsSaved', 'Tiles view saved'), 'success');
}

async function applySavedTileView(id) {
    const item = savedTileViews.find((v) => String(v.id) === String(id));
    if (!item || !item.payload) return;
    const p = item.payload;
    clusterDashboardTiles = normalizeClusterDashboardTiles(p.clusterDashboardTiles);
    clusterDashboardTilesDirty = false;
    monitorTilesChartAxisTime = parseBoolSettingClient(p.monitorTilesChartAxisTime, true);
    monitorTilesChartAxisValues = parseBoolSettingClient(p.monitorTilesChartAxisValues, true);
    monitorTilesChartAxisYUnit = parseBoolSettingClient(p.monitorTilesChartAxisYUnit, true);
    tilesChartDisplayVariant = ['area', 'line', 'minimal'].includes(String(p.tilesChartDisplayVariant || '').toLowerCase())
        ? String(p.tilesChartDisplayVariant).toLowerCase()
        : 'area';
    chartWindowClusterMetricMin = normalizeChartWindowMinutes(p.chartWindowClusterMetricMin, chartWindowClusterMetricMin);
    chartWindowHostMetricMin = normalizeChartWindowMinutes(p.chartWindowHostMetricMin, chartWindowHostMetricMin);
    chartWindowUpsMetricMin = normalizeChartWindowMinutes(p.chartWindowUpsMetricMin, chartWindowUpsMetricMin);
    chartWindowSmartSensorMetricMin = normalizeChartWindowMinutes(p.chartWindowSmartSensorMetricMin, chartWindowSmartSensorMetricMin);
    const cTilesAxisT = el('settingsMonitorTilesChartAxisTimeCheckbox');
    const cTilesAxisV = el('settingsMonitorTilesChartAxisValuesCheckbox');
    const cTilesAxisU = el('settingsMonitorTilesChartAxisYUnitCheckbox');
    const cwClusterEl = el('settingsChartWindowClusterMetricSelect');
    const cwHostEl = el('settingsChartWindowHostMetricSelect');
    const cwUpsEl = el('settingsChartWindowUpsMetricSelect');
    const cwSmartEl = el('settingsChartWindowSmartSensorMetricSelect');
    const tilesVariantEl = el('settingsTilesChartDisplayVariantSelect');
    if (cTilesAxisT) cTilesAxisT.checked = monitorTilesChartAxisTime;
    if (cTilesAxisV) cTilesAxisV.checked = monitorTilesChartAxisValues;
    if (cTilesAxisU) cTilesAxisU.checked = monitorTilesChartAxisYUnit;
    if (cwClusterEl) cwClusterEl.value = String(chartWindowClusterMetricMin);
    if (cwHostEl) cwHostEl.value = String(chartWindowHostMetricMin);
    if (cwUpsEl) cwUpsEl.value = String(chartWindowUpsMetricMin);
    if (cwSmartEl) cwSmartEl.value = String(chartWindowSmartSensorMetricMin);
    if (tilesVariantEl) tilesVariantEl.value = tilesChartDisplayVariant;
    renderClusterDashboardTilesSettings();
    await saveSettingsToServer({
        clusterDashboardTiles,
        monitorTilesChartAxisTime,
        monitorTilesChartAxisValues,
        monitorTilesChartAxisYUnit,
        tilesChartDisplayVariant,
        chartWindowClusterMetricMin,
        chartWindowHostMetricMin,
        chartWindowUpsMetricMin,
        chartWindowSmartSensorMetricMin
    });
    renderClusterDashboardTiles().catch(() => {});
    renderTilesMonitorScreen('tilesNormalGrid').catch(() => {});
    if (!monitorMode || monitorCurrentView === 'tiles') {
        renderTilesMonitorScreen().catch(() => {});
    }
    showToast(tOr('settingsSavedTileViewsApplied', 'Tiles view applied') + `: ${item.name}`, 'success');
}

async function overwriteSavedTileView(id) {
    const idx = savedTileViews.findIndex((v) => String(v.id) === String(id));
    if (idx < 0) return;
    savedTileViews[idx] = {
        ...savedTileViews[idx],
        createdAt: new Date().toISOString(),
        payload: captureCurrentSavedTileViewPayload()
    };
    await persistSavedTileViews();
    renderSavedTileViewsSettingsList();
    showToast(tOr('settingsSavedTileViewsOverwritten', 'Tiles view overwritten'), 'success');
}

async function deleteSavedTileView(id) {
    savedTileViews = savedTileViews.filter((v) => String(v.id) !== String(id));
    await persistSavedTileViews();
    renderSavedTileViewsSettingsList();
}

function renderSavedTileViewsSettingsList() {
    const list = el('settingsSavedTileViewsList');
    if (!list) return;
    if (!Array.isArray(savedTileViews) || !savedTileViews.length) {
        setHTMLIfChanged('settingsSavedTileViewsList', `<div class="text-muted small">${escapeHtml(t('backupNoData') || 'No data')}</div>`);
        return;
    }
    const html = savedTileViews.map((v) => `
        <div class="list-group-item d-flex align-items-center justify-content-between gap-2">
            <div class="text-truncate">
                <div class="fw-semibold text-truncate">${escapeHtml(v.name)}</div>
                <div class="small text-muted">${escapeHtml(new Date(v.createdAt || Date.now()).toLocaleString(currentLanguage === 'ru' ? 'ru-RU' : 'en-US'))}</div>
            </div>
            <div class="btn-group btn-group-sm">
                <button type="button" class="btn btn-outline-primary" onclick="applySavedTileView('${escapeHtml(v.id)}')">${escapeHtml(tOr('apply', 'Apply'))}</button>
                <button type="button" class="btn btn-outline-secondary" onclick="overwriteSavedTileView('${escapeHtml(v.id)}')">${escapeHtml(tOr('settingsSavedTileViewsOverwrite', 'Overwrite'))}</button>
                <button type="button" class="btn btn-outline-danger" onclick="deleteSavedTileView('${escapeHtml(v.id)}')">${escapeHtml(t('remove') || 'Remove')}</button>
            </div>
        </div>
    `).join('');
    setHTMLIfChanged('settingsSavedTileViewsList', html);
}

function updateMonitorToolbarTitleForView() {
    const el = document.getElementById('monitorToolbarTitle');
    if (!el || !monitorMode) return;
    el.textContent = getHomelabViewTitle(monitorCurrentView, 'monitorScreenCluster');
    renderMonitorScreenDots();
}

function syncMonitorDotsDock() {
    const dotsEl = document.getElementById('monitorScreenDots');
    const dock = document.getElementById('monitorDotsDock');
    if (!dock) return;
    const hideDock = !monitorMode || !dotsEl || dotsEl.style.display === 'none';
    dock.style.display = hideDock ? 'none' : 'flex';
    document.body.classList.toggle('monitor-dots-hidden', hideDock);
}

function syncMonitorToolbarRevealButton() {
    const reveal = document.getElementById('monitorToolbarReveal');
    if (!reveal) return;
    const show = monitorMode && document.body.classList.contains('monitor-toolbar-hidden');
    reveal.style.display = show ? 'inline-flex' : 'none';
    reveal.setAttribute('aria-hidden', show ? 'false' : 'true');
}

function toggleMonitorToolbarHidden() {
    if (!monitorMode) return;
    document.body.classList.toggle('monitor-toolbar-hidden');
    try {
        localStorage.setItem('monitorToolbarHidden', document.body.classList.contains('monitor-toolbar-hidden') ? '1' : '0');
    } catch (_) {}
    syncMonitorToolbarRevealButton();
}

function applyMonitorToolbarHiddenState() {
    if (!monitorMode) return;
    let hidden = false;
    try {
        hidden = localStorage.getItem('monitorToolbarHidden') === '1';
    } catch (_) {}
    document.body.classList.toggle('monitor-toolbar-hidden', hidden);
    syncMonitorToolbarRevealButton();
}

function renderMonitorScreenDots() {
    const dotsEl = document.getElementById('monitorScreenDots');
    if (!dotsEl) return;
    monitorScreensManager.renderDots(dotsEl, {
        monitorMode,
        currentView: monitorCurrentView,
        views: getMonitorViewsOrder()
    });
    syncMonitorDotsDock();
}

// Переключение экранов в режиме монитора:
// cluster/services/vms -> компактный #monitorView (без скролла/пустых зон)
// ups/netdev/speedtest/smartSensors/backupRuns -> полноэкранные секции
// Ранее второй аргумент задавал направление для View Transitions API; отключено — снимок root и
// экраны с position:fixed давали наложение «старого» и «нового» контента при смене экрана.
function applyMonitorView(view) {
    monitorCurrentView = view;
    const result = monitorViewRouterManager.applyView(view, {
        monitorMode,
        hasProxmoxBackendAuth: !!getAuthHeadersForType('proxmox'),
        lastBackupsDataForMonitor
    });
    if (result && result.redirectedTo) {
        applyMonitorView(result.redirectedTo);
        return;
    }

    if (monitorMode) persistMonitorCurrentView(monitorCurrentView);
    updateMonitorToolbarTitleForView();
    updateHomelabMenuChrome();
    requestAnimationFrame(() => updateHomeLabFontScale());
}

let monitorDrawIsEraser = false;
const monitorDrawManager = window.MonitorDrawManagerModule.createManager({
    getMonitorMode: () => monitorMode,
    getMonitorCurrentView: () => monitorCurrentView,
    getMonitorDrawIsEraser: () => monitorDrawIsEraser,
    setMonitorDrawIsEraser: (v) => { monitorDrawIsEraser = !!v; }
});

function getMonitorDrawCanvasBg() {
    return monitorDrawManager.getCanvasBg();
}

function fillMonitorDrawCanvasBackground(ctx, w, h) {
    monitorDrawManager.fillCanvasBackground(ctx, w, h);
}

function resizeMonitorDrawCanvas() {
    monitorDrawManager.resizeCanvas();
}

function clearMonitorDrawCanvas() {
    monitorDrawManager.clearCanvas();
}

function setMonitorDrawEraser(on) {
    monitorDrawManager.setEraser(on);
}

function initMonitorDrawScreen() {
    monitorDrawManager.initScreen();
}

function setMonitorTheme(theme) {
    monitorTheme = theme === 'dark' ? 'dark' : 'light';
    saveSettingsToServer({ monitorTheme });
    if (monitorMode) applyMonitorTheme();
}

function applyMonitorTheme() {
    document.body.classList.toggle('monitor-theme-dark', monitorTheme === 'dark');
    const lightBtn = document.getElementById('monitorThemeLight');
    const darkBtn = document.getElementById('monitorThemeDark');
    if (lightBtn) lightBtn.classList.toggle('active', monitorTheme === 'light');
    if (darkBtn) darkBtn.classList.toggle('active', monitorTheme === 'dark');
}

// ==================== CUSTOM THEME CSS (normal/monitor x light/dark) ====================
function ensureCustomThemeStyleEl() {
    return customThemeManager.ensureStyleEl();
}

function normalizeCustomThemeCssInput(input) {
    return customThemeManager.normalizeCssInput(input);
}

function applyCustomThemeCss() {
    customThemeManager.applyCss();
}

function normalizeCustomThemeStyleSettingsInput(input) {
    return customThemeManager.normalizeStyleSettingsInput(input);
}

function applyCustomThemeStyleSettings() {
    customThemeManager.applyStyleSettings();
}

function getCustomThemeStyleVariantFromSelect() {
    return customThemeManager.getStyleVariantFromSelect();
}

function syncCustomThemeStyleSettingsUI() {
    customThemeManager.syncStyleSettingsUI();
}

function onCustomThemeStyleVariantChange() {
    customThemeManager.onStyleVariantChange();
}

async function saveCustomThemeStyleSettingsVariant() {
    await customThemeManager.saveStyleSettingsVariant();
}

async function resetCustomThemeStyleSettingsVariant() {
    await customThemeManager.resetStyleSettingsVariant();
}

async function unloadCustomThemeStyleSettingsAll() {
    await customThemeManager.unloadStyleSettingsAll();
}

function exportCustomThemeStyleSettings() {
    customThemeManager.exportStyleSettings();
}

function triggerCustomThemeStyleImportFilePicker() {
    const inp = document.getElementById('customThemeStyleImportFile');
    if (!inp) return;
    inp.value = '';
    inp.click();
}

async function importCustomThemeStyleSettingsFromFile(file) {
    await customThemeManager.importStyleSettingsFromFile(file);
}

function getCustomThemeVariantFromSelect() {
    const sel = document.getElementById('customThemeVariantSelect');
    if (!sel) return 'normalLight';
    const v = String(sel.value || 'normalLight');
    return v;
}

function syncCustomThemeCssEditorUI() {
    customThemeManager.syncCssEditorUI();
}

function onCustomThemeVariantChange() {
    customThemeManager.onCssVariantChange();
}

async function saveCustomThemeCssVariant() {
    await customThemeManager.saveCssVariant();
}

async function clearCustomThemeCssVariant() {
    await customThemeManager.clearCssVariant();
}

async function unloadCustomThemeCssAll() {
    await customThemeManager.unloadCssAll();
}

function exportCustomThemeCss() {
    customThemeManager.exportCss();
}

function triggerCustomThemeImportFilePicker() {
    const inp = document.getElementById('customThemeImportFile');
    if (!inp) return;
    inp.value = '';
    inp.click();
}

async function importCustomThemeCssFromFile(file) {
    await customThemeManager.importCssFromFile(file);
}

function goMonitorView(direction) {
    const views = getMonitorViewsOrder();
    let i = views.indexOf(monitorCurrentView);
    if (i < 0) i = 0;
    const delta = direction === 'next' ? 1 : -1;
    const nextIndex = (i + delta + views.length) % views.length;
    applyMonitorView(views[nextIndex], { transition: direction === 'next' ? 'next' : 'prev' });
}

/** На экране рисования: при включённой галочке не обрабатывать свайпы смены экрана (touch / мышь по body). */
function monitorDrawSwipesBlocked() {
    if (!monitorMode || monitorCurrentView !== 'draw') return false;
    const chk = document.getElementById('monitorDrawDisableSwipesChk');
    return !!(chk && chk.checked);
}

function destroyMonitorSwipes() {
    monitorInteractionsManager.destroySwipes();
}

let monitorKeyboardNavAttached = false;

function initMonitorKeyboardNavigation() {
    monitorInteractionsManager.initKeyboardNavigation();
    monitorKeyboardNavAttached = true;
}

function initMonitorSwipes() {
    monitorInteractionsManager.initSwipes();
}

/** Главная: закрыть настройки; в режиме монитора — экран кластера без выхода из fullscreen; иначе обычный дашборд. */
function goToAppHome() {
    appNavigationManager.goToAppHome();
}

// Show dashboard
function showDashboard() {
    appNavigationManager.showDashboard();
    homelabNormalNavView = 'cluster';
    updateHomelabMenuChrome();
}

// Start auto refresh
function startAutoRefresh() {
    appNavigationManager.startAutoRefresh();
}

/** @param {{ skipDashboard?: boolean, backendType?: 'proxmox'|'truenas' }} [options] — для мастера: не переключать экран до завершения шагов */
async function connect(options) {
    return connectionManager.connect(options && typeof options === 'object' ? options : {});
}

function connectAs(type) {
    const backendType = type === 'truenas' ? 'truenas' : 'proxmox';
    connect({ backendType });
}

// Test connection
async function testConnection(options) {
    return connectionManager.testConnection(options && typeof options === 'object' ? options : {});
}

function testConnectionAs(type) {
    const backendType = type === 'truenas' ? 'truenas' : 'proxmox';
    testConnection({ backendType });
}

// Update connection status for a given type (proxmox | truenas)
function updateConnectionStatus(connected, type) {
    connectionManager.updateConnectionStatus(connected, type);
}

// Refresh data
/** Форматирование значения UPS из API { raw, value } */
function formatUpsMetric(m, unitSuffix) {
    if (!m || (m.raw == null && m.value == null)) return '—';
    const v = m.value;
    if (v != null && Number.isFinite(Number(v))) {
        const n = Number(v);
        const rounded = Math.abs(n) >= 100 ? Math.round(n) : Math.round(n * 10) / 10;
        return `${rounded}${unitSuffix || ''}`;
    }
    return m.raw != null && String(m.raw).trim() !== '' ? String(m.raw) : '—';
}

const refreshDataManager = window.RefreshDataModule.createManager({
    getIsRefreshing: () => isRefreshing,
    setIsRefreshing: (v) => { isRefreshing = v; },
    getAuthHeadersForType,
    showToast,
    t,
    showLoading,
    getLastHostMetricsData: () => lastHostMetricsData,
    setLastHostMetricsData: (v) => { lastHostMetricsData = v; },
    updateDashboard,
    setLastTrueNASOverviewData: (v) => { lastTrueNASOverviewData = v; },
    updateTrueNASDashboard,
    renderClusterDashboardTiles,
    renderTilesMonitorScreen,
    renderTrueNASMonitorScreenTiles,
    getMonitorMode: () => monitorMode,
    getMonitorCurrentView: () => monitorCurrentView,
    updateUPSDashboard,
    updateNetdevDashboard,
    updateSpeedtestDashboard,
    updateIperf3Dashboard,
    updateSmartSensorsDashboard,
    setLastRefreshTime: (ms) => { lastRefreshTime = ms; },
    checkAllServices,
    renderMonitorServicesList,
    updateHomeLabFontScale: () => scheduleHomeLabFontScale(),
    getIsPageVisible: () => isPageVisible()
});
async function refreshData(options = {}) {
    return refreshDataManager.refreshData(options);
}

function upsMetricCompactTile(iconBi, label, valueStr, progressPct, barClass, colClass) {
    const bar =
        typeof progressPct === 'number' && Number.isFinite(progressPct)
            ? `<div class="progress mt-2 hm-progress hm-progress--cluster">
                    <div class="progress-bar ${barClass || 'bg-success'}" style="width: ${Math.min(100, Math.max(0, progressPct))}%"></div>
               </div>`
            : '';

    return `
        <div class="${colClass || 'col-md-3 col-6'}">
            <div class="text-center p-3 hm-cluster-metric-cell h-100">
                <h6><i class="bi ${iconBi} me-2"></i><span>${escapeHtml(label)}</span></h6>
                <div class="display-6 text-break">${escapeHtml(valueStr)}</div>
                ${bar}
            </div>
        </div>`;
}

function upsDashboardFieldIcon(f) {
    if (!f) return 'bi-dot';
    const id = f.id;
    const fmt = f.format;
    if (id === 'charge' || fmt === 'percent') return 'bi-battery-half';
    if (id === 'load') return 'bi-speedometer2';
    if (id === 'runtime' || fmt === 'time') return 'bi-clock-history';
    if (id === 'inputVoltage' || id === 'outputVoltage' || fmt === 'voltage') return 'bi-plug';
    if (id === 'power' || fmt === 'watt') return 'bi-lightning-charge';
    if (id === 'frequency' || fmt === 'frequency') return 'bi-activity';
    if (id === 'status' || fmt === 'nut_status' || fmt === 'status' || fmt === 'boot') return 'bi-info-circle';
    return 'bi-dot';
}

function buildUpsMetricTilesHtml(item, labels) {
    const hasVal = (v) => v != null && String(v).trim() !== '' && String(v) !== '—';
    if (Array.isArray(item.fields) && item.fields.length > 0) {
        return item.fields
            .map((f) => {
                if (!f || f.ok === false) return null;
                const disp = f.display != null ? String(f.display) : '';
                if (!hasVal(disp)) return null;
                const bar =
                    (f.id === 'load' || f.id === 'charge' || f.format === 'percent') &&
                    typeof f.value === 'number' &&
                    Number.isFinite(f.value)
                        ? f.value
                        : null;
                const lbl = (f.label && String(f.label).trim()) || f.id || '—';
                return upsMetricCompactTile(
                    upsDashboardFieldIcon(f),
                    lbl,
                    disp,
                    bar,
                    'bg-success',
                    'col-6 col-md-3'
                );
            })
            .filter(Boolean)
            .join('');
    }
    const electrical = item.electrical || {};
    const inVText = formatUpsMetric(electrical.inputVoltage, ' V');
    const loadText = formatUpsMetric(electrical.loadPercent, ' %');
    const chargePct = item.battery?.chargePct;
    const chargeRaw = item.battery?.chargeRaw;
    const chargeText =
        chargePct != null && Number.isFinite(Number(chargePct))
            ? `${chargePct}%`
            : chargeRaw != null
              ? String(chargeRaw)
              : '—';
    const runtimeText =
        item.battery?.runtimeFormatted != null
            ? item.battery.runtimeFormatted
            : item.battery?.runtimeRaw != null
              ? String(item.battery.runtimeRaw)
              : '—';
    const loadPctNum =
        electrical.loadPercent && typeof electrical.loadPercent.value === 'number'
            ? electrical.loadPercent.value
            : null;
    const chargeBarNum =
        chargePct != null && Number.isFinite(Number(chargePct)) ? Number(chargePct) : null;
    return [
        hasVal(inVText) ? upsMetricCompactTile('bi-plug', labels.inV, inVText, null, null, 'col-6 col-md-3') : null,
        hasVal(loadText)
            ? upsMetricCompactTile('bi-speedometer2', labels.load, loadText, loadPctNum, 'bg-success', 'col-6 col-md-3')
            : null,
        hasVal(chargeText)
            ? upsMetricCompactTile('bi-battery-half', labels.charge, chargeText, chargeBarNum, 'bg-success', 'col-6 col-md-3')
            : null,
        hasVal(runtimeText)
            ? upsMetricCompactTile('bi-clock-history', labels.runtime, runtimeText, null, null, 'col-6 col-md-3')
            : null
    ]
        .filter(Boolean)
        .join('');
}

function buildUpsCardsHtml(data, options = {}) {
    const singleUpsColClass = options.singleUpsColClass || 'col-12';
    const multiUpsColClass = options.multiUpsColClass || 'col-md-6';
    const singleRowClass = options.singleRowClass || 'row g-2';
    const multiRowClass = options.multiRowClass || 'row row-cols-1 row-cols-sm-2 g-2';
    const singleUpsVariant = options.singleUpsVariant || 'panel';

    const upsColClass = data.items.length === 1 ? singleUpsColClass : multiUpsColClass;
    const rowClass = data.items.length === 1 ? singleRowClass : multiRowClass;

    const labels = {
        inV: t('upsLabelInputVoltage') || 'Вход U',
        outV: t('upsLabelOutputVoltage') || 'Выход U',
        power: t('upsLabelPower') || 'Мощность',
        load: t('upsLabelLoad') || 'Нагрузка',
        freq: t('upsLabelFrequency') || 'Частота',
        charge: t('upsLabelCharge') || 'Заряд',
        runtime: t('upsLabelRuntime') || 'Время на батарее'
    };
    const staleLabel = t('hostMetricsStale') || 'Stale data';
    const upsOpenTitle = t('upsAllMetricsCardOpenTitle') || 'Show UPS metric history';
    const isStale = (iso) => {
        if (!iso) return false;
        const ts = Date.parse(iso);
        if (!Number.isFinite(ts)) return false;
        return (Date.now() - ts) > (10 * 60 * 1000);
    };

    if (data.items.length === 1) {
        const item = data.items[0];
        const name = item.name || `UPS ${item.slot}`;
        const backend = item.type ? String(item.type).toUpperCase() : 'UPS';
        const hostLine = item.host ? `${backend} · ${item.host}` : backend;

        if (item.error) {
            const html = `
                <div class="${upsColClass}">
                    <div class="alert alert-warning mb-0 py-2 d-flex flex-wrap justify-content-between align-items-center gap-2">
                        <span class="fw-semibold text-truncate" title="${escapeHtml(name)}">${escapeHtml(name)}</span>
                        <span class="small">${escapeHtml(backend)}: ${escapeHtml(item.error)}</span>
                    </div>
                </div>`;
            return { html, rowClass };
        }

        const statusRaw = item.status?.raw ?? null;
        const statusLabel = item.status?.label ?? (statusRaw != null ? String(statusRaw) : 'unknown');
        const up = item.status?.up;
        let badgeClass = 'bg-secondary';
        const lowStr = String(statusLabel).toLowerCase();
        if (lowStr.includes('low')) badgeClass = 'bg-danger';
        else if (up === true) badgeClass = 'bg-success';
        else if (up === false) badgeClass = 'bg-warning text-dark';

        const tilesHtml = buildUpsMetricTilesHtml(item, labels);
        const staleHtml = isStale(item.updatedAt || data.updatedAt)
            ? `<div class="col-12 mt-2"><small class="text-warning">${escapeHtml(staleLabel)}</small></div>`
            : '';

        const html = singleUpsVariant === 'card'
            ? `
                <div class="${upsColClass}">
                    <div class="node-card ups-node-card h-100 ups-metrics-open-trigger cursor-pointer"
                        role="button" tabindex="0" data-ups-slot="${escapeHtml(item.slot)}"
                        title="${escapeHtml(t('upsAllMetricsCardOpenTitle') || 'Show UPS metric history')}">
                        <div class="d-flex justify-content-between align-items-center mb-2 gap-2">
                            <h5 class="mb-0 text-truncate" title="${escapeHtml(name)}">${escapeHtml(name)}</h5>
                            <div class="d-flex align-items-center gap-2 flex-shrink-0">
                                <i class="bi bi-graph-up-arrow ups-metrics-open-hint" aria-hidden="true" title="${escapeHtml(upsOpenTitle)}"></i>
                                <span class="badge ${badgeClass}">${escapeHtml(statusLabel)}</span>
                            </div>
                        </div>
                        <div class="row g-2 hm-cluster-metric-panel">
                            ${tilesHtml}
                            ${staleHtml}
                        </div>
                        <div class="small text-muted mt-2">${escapeHtml(hostLine)}</div>
                    </div>
                </div>`
            : `
                <div class="${upsColClass}">
                    <div class="node-card ups-node-card ups-node-card--single h-100 ups-metrics-open-trigger cursor-pointer"
                        role="button" tabindex="0" data-ups-slot="${escapeHtml(item.slot)}"
                        title="${escapeHtml(t('upsAllMetricsCardOpenTitle') || 'Show UPS metric history')}">
                        <div class="d-flex justify-content-between align-items-center mb-2 gap-2">
                            <h5 class="mb-0 text-truncate" title="${escapeHtml(name)}">${escapeHtml(name)}</h5>
                            <div class="d-flex align-items-center gap-2 flex-shrink-0">
                                <i class="bi bi-graph-up-arrow ups-metrics-open-hint" aria-hidden="true" title="${escapeHtml(upsOpenTitle)}"></i>
                                <span class="badge ${badgeClass}">${escapeHtml(statusLabel)}</span>
                            </div>
                        </div>
                        <div class="row g-2 hm-cluster-metric-panel">
                            ${tilesHtml}
                            ${staleHtml}
                        </div>
                        <div class="small text-muted mt-2">${escapeHtml(hostLine)}</div>
                    </div>
                </div>`;
        return { html, rowClass };
    }

    const html = data.items.map((item) => {
        const statusRaw = item.status?.raw ?? null;
        const statusLabel = item.status?.label ?? (statusRaw != null ? String(statusRaw) : 'unknown');
        const up = item.status?.up;

        let badgeClass = 'bg-secondary';
        const lowStr = String(statusLabel).toLowerCase();
        if (lowStr.includes('low')) badgeClass = 'bg-danger';
        else if (up === true) badgeClass = 'bg-success';
        else if (up === false) badgeClass = 'bg-warning text-dark';

        const name = item.name || `UPS ${item.slot}`;
        const backend = item.type ? String(item.type).toUpperCase() : 'UPS';

        const tilesHtml = buildUpsMetricTilesHtml(item, labels);
        const staleHtml = isStale(item.updatedAt || data.updatedAt)
            ? `<div class="col-12 mt-2"><small class="text-warning">${escapeHtml(staleLabel)}</small></div>`
            : '';

        if (item.error) {
            return `
                    <div class="${upsColClass}">
                        <div class="node-card ups-node-card h-100 ups-metrics-open-trigger cursor-pointer"
                            role="button" tabindex="0" data-ups-slot="${escapeHtml(item.slot)}"
                            title="${escapeHtml(t('upsAllMetricsCardOpenTitle') || 'Show UPS metric history')}">
                            <div class="d-flex justify-content-between align-items-center mb-2 gap-2">
                                <h5 class="mb-0 text-truncate" title="${escapeHtml(name)}">${escapeHtml(name)}</h5>
                            <div class="d-flex align-items-center gap-2 flex-shrink-0">
                                <i class="bi bi-graph-up-arrow ups-metrics-open-hint" aria-hidden="true" title="${escapeHtml(upsOpenTitle)}"></i>
                                <span class="badge bg-secondary">${escapeHtml(t('upsError') || 'Ошибка UPS')}</span>
                            </div>
                            </div>
                            <div class="small text-muted">${escapeHtml(backend)}: ${escapeHtml(item.error)}</div>
                        </div>
                    </div>
                `;
        }

        return `
                <div class="${upsColClass}">
                    <div class="node-card ups-node-card h-100 ups-metrics-open-trigger cursor-pointer"
                        role="button" tabindex="0" data-ups-slot="${escapeHtml(item.slot)}"
                        title="${escapeHtml(t('upsAllMetricsCardOpenTitle') || 'Show UPS metric history')}">
                        <div class="d-flex justify-content-between align-items-center mb-2 gap-2">
                            <h5 class="mb-0 text-truncate" title="${escapeHtml(name)}">${escapeHtml(name)}</h5>
                            <div class="d-flex align-items-center gap-2 flex-shrink-0">
                                <i class="bi bi-graph-up-arrow ups-metrics-open-hint" aria-hidden="true" title="${escapeHtml(upsOpenTitle)}"></i>
                                <span class="badge ${badgeClass}">${escapeHtml(statusLabel)}</span>
                            </div>
                        </div>
                        <div class="row g-2 hm-cluster-metric-panel">
                            ${tilesHtml}
                            ${staleHtml}
                        </div>
                        <div class="small text-muted mt-2">${escapeHtml(backend)}</div>
                    </div>
                </div>
            `;
    }).join('');

    return { html, rowClass };
}

function paintUpsMount(cardsEl, updatedAtEl, data, options) {
    const emptyMsg = options && options.emptyMsg;
    if (!cardsEl) return;

    cardsEl.innerHTML = '';
    cardsEl.className = 'row g-2';
    if (updatedAtEl) updatedAtEl.textContent = '';

    if (!data || !data.configured || !Array.isArray(data.items) || data.items.length === 0) {
        const msg = emptyMsg || (t('upsNotConfigured') || 'UPS не настроен');
        const err = data?.error ? `: ${data.error}` : '';
        cardsEl.innerHTML = `<div class="col-12"><div class="text-muted small">${escapeHtml(msg + err)}</div></div>`;
        if (updatedAtEl && data?.updatedAt) updatedAtEl.textContent = new Date(data.updatedAt).toLocaleString();
        return;
    }

    if (updatedAtEl && data?.updatedAt) {
        updatedAtEl.textContent = new Date(data.updatedAt).toLocaleString();
    }

    const { html, rowClass } = buildUpsCardsHtml(data, options || {});
    cardsEl.className = rowClass;
    cardsEl.innerHTML = html;
}

async function updateUPSDashboard() {
    const monitorCards = document.getElementById('upsMonitorCards');
    if (!monitorCards) return;

    const resetRow = (el) => {
        if (!el) return;
        el.innerHTML = '';
        el.className = 'row g-2';
    };
    resetRow(monitorCards);
    const upsUpdatedAt = document.getElementById('upsUpdatedAt');
    if (upsUpdatedAt) upsUpdatedAt.textContent = '';

    try {
        const res = await fetch('/api/ups/current');
        const data = await res.json();

        // Обновляем кеш доступности экрана для корректного свайп-порядка.
        upsMonitorConfigured = !!(data && data.configured && Array.isArray(data.items) && data.items.length > 0);

        paintUpsMount(monitorCards, upsUpdatedAt, data, {});
    } catch (e) {
        const errHtml = `<div class="col-12"><div class="text-danger small">${escapeHtml((e && e.message) ? e.message : String(e))}</div></div>`;
        if (monitorCards) monitorCards.innerHTML = errHtml;
    }
}

function updateTrueNASDashboard(systemData, poolsData, overviewData = null) {
    const hasPve = !!getAuthHeadersForType('proxmox');
    lastTrueNASData = { system: systemData, pools: poolsData };
    if (hasPve) {
        if (monitorMode) {
            updateMonitorViewTrueNAS(systemData, poolsData);
            renderMonitorServicesList();
            renderMonitorVmsList();
        }
        syncClusterResourcesCardInteractivity();
        return;
    }

    const sys = systemData && typeof systemData === 'object' ? systemData : {};
    const hostname = sys.hostname || sys.system_hostname || sys.host || 'TrueNAS';
    const version = sys.version || sys.product_version || sys.release || '';
    const uptimeRaw = sys.uptime;
    const uptimeStr = (typeof uptimeRaw === 'number' && uptimeRaw >= 0)
        ? formatUptime(uptimeRaw)
        : (uptimeRaw && String(uptimeRaw).trim() ? String(uptimeRaw) : '');

    // Попробуем вытащить CPU usage
    let cpuPercent = null;
    if (typeof sys.cpu_usage === 'number') {
        cpuPercent = Math.max(0, Math.min(100, Math.round(sys.cpu_usage)));
    } else if (Array.isArray(sys.loadavg) && typeof sys.loadavg[0] === 'number' && typeof sys.cores === 'number' && sys.cores > 0) {
        cpuPercent = Math.max(0, Math.min(100, Math.round((sys.loadavg[0] / sys.cores) * 100)));
    }

    // И память
    let memTotal = null;
    let memUsed = null;
    if (sys.memory && typeof sys.memory === 'object') {
        const m = sys.memory;
        // TrueNAS часто возвращает байты
        if (typeof m.total === 'number' && typeof m.free === 'number') {
            memTotal = m.total;
            memUsed = m.total - m.free;
        } else if (typeof m.total === 'number' && typeof m.used === 'number') {
            memTotal = m.total;
            memUsed = m.used;
        }
    }

    setText('totalNodes', '1');
    setText('onlineNodes', '1');
    setHTML('quorumStatus', t('notApplicable'));
    const quorumEl = document.getElementById('quorumStatus');
    if (quorumEl) quorumEl.className = 'stat-value text-muted';
    setHTML('connectionStatus', '<i class="bi bi-check-circle-fill text-success"></i> ' + t('connected'));

    // CPU card
    if (cpuPercent !== null) {
        setText('clusterCpu', cpuPercent + '%');
        setText('clusterCpuDetail', t('truenasSystem'));
        const cpuBar = document.getElementById('clusterCpuBar');
        if (cpuBar) {
            cpuBar.style.width = cpuPercent + '%';
            setProgressBarThresholdClass(cpuBar, cpuPercent, 'cpu');
        }
    } else {
        setText('clusterCpu', '—');
        setText('clusterCpuDetail', t('truenasSystem'));
        const cpuBar = document.getElementById('clusterCpuBar');
        if (cpuBar) {
            cpuBar.style.width = '0%';
            setProgressBarThresholdClass(cpuBar, 0, 'cpu');
        }
    }

    // Memory card
    if (memTotal && memUsed !== null) {
        const memPercent = memTotal > 0 ? Math.round((memUsed / memTotal) * 100) : 0;
        setText('clusterMemory', memPercent + '%');
        setText('clusterMemoryDetail', `${formatSize(memUsed)} / ${formatSize(memTotal)}`);
        const memBar = document.getElementById('clusterMemoryBar');
        if (memBar) {
            memBar.style.width = memPercent + '%';
            setProgressBarThresholdClass(memBar, memPercent, 'ram');
        }
    } else {
        setText('clusterMemory', '—');
        setText('clusterMemoryDetail', version ? `${hostname} • ${version}` : hostname);
        const memBar = document.getElementById('clusterMemoryBar');
        if (memBar) {
            memBar.style.width = '0%';
            setProgressBarThresholdClass(memBar, 0, 'ram');
        }
    }

    const summary = (poolsData && poolsData.summary) ? poolsData.summary : { total: 0, active: 0, total_space: 0, used_space: 0 };
    const apps = Array.isArray(overviewData?.apps) ? overviewData.apps : [];
    const disks = Array.isArray(overviewData?.disks) ? overviewData.disks : [];
    const appsRunning = apps.filter((a) => a && a.running).length;
    const degradedDisks = disks.filter((d) => d && !d.healthy).length;
    const totalStorage = Number(summary.total_space || 0);
    const usedStorage = Number(summary.used_space || 0);
    const storagePercent = totalStorage > 0 ? Math.round((usedStorage / totalStorage) * 100) : 0;
    setText('dashboardClusterVmTotalLbl', t('monitorGuestTotal') || 'Total');
    setText('clusterVmTotal', String(apps.length));
    setText('clusterVmRunning', String(appsRunning));
    setText('dashboardClusterCtTotalLbl', t('storageTotalSpace') || 'Total');
    setText('clusterCtTotal', formatSize(totalStorage));
    setText('clusterCtRunning', formatSize(usedStorage));
    const vmBar = document.getElementById('clusterVmRunningBar');
    if (vmBar) vmBar.style.width = apps.length > 0 ? `${Math.round((appsRunning / apps.length) * 100)}%` : '0%';
    const ctBar = document.getElementById('clusterCtRunningBar');
    if (ctBar) {
        ctBar.style.width = `${storagePercent}%`;
        setProgressBarThresholdClass(ctBar, storagePercent, 'ram');
    }

    // TrueNAS is rendered via tiles only; hide dedicated tab content.
    const nodesContainer = document.getElementById('nodesContainer');
    const servicesContainer = document.getElementById('serversContainer');
    const storageStatsEl = document.getElementById('storageStats');
    const storageTypesEl = document.getElementById('storageTypes');
    const storageBodyEl = document.getElementById('storageBody');
    const storageTableEl = document.getElementById('storageTable');
    if (nodesContainer) {
        nodesContainer.className = 'cluster-scroll-row';
        setHTMLIfChanged('nodesContainer', '');
    }
    if (servicesContainer) setHTMLIfChanged('serversContainer', '');
    if (storageStatsEl) setHTMLIfChanged('storageStats', '');
    if (storageTypesEl) setHTMLIfChanged('storageTypes', '');
    if (storageBodyEl) setHTMLIfChanged('storageBody', '');
    if (storageTableEl) {
        const wrap = storageTableEl.closest('.table-responsive');
        if (wrap) wrap.style.display = '';
    }
    if (storageTable) {
        storageTable.destroy();
        storageTable = null;
    }


    // Clear backups table if present
    if (backupsJobsTable) {
        backupsJobsTable.destroy();
        backupsJobsTable = null;
    }
    if (backupsExecTable) {
        backupsExecTable.destroy();
        backupsExecTable = null;
    }

    setHTMLIfChanged('lastUpdate', '<i class="bi bi-clock"></i> ' + t('lastUpdate') + ': ' + new Date().toLocaleString(currentLanguage === 'ru' ? 'ru-RU' : 'en-US'));

    if (monitorMode) {
        updateMonitorViewTrueNAS(systemData, poolsData);
        renderMonitorServicesList();
        renderMonitorVmsList();
    }
    syncClusterResourcesCardInteractivity();
}

// Компактный вид режима монитора (Proxmox)
function updateMonitorView(clusterData) {
    if (!clusterData) return;
    const nodes = Array.isArray(clusterData.nodes) ? clusterData.nodes : [];
    const total = nodes.length;
    const online = nodes.filter(n => n.status === 'online').length;
    const quorumOk = clusterData.quorum && online >= (clusterData.quorum.quorum || 0);
    setText('monitorTotalNodes', String(total));
    setText('monitorOnlineNodes', String(online));
    setText('monitorQuorum', quorumOk ? t('quorumEnough') : t('quorumNotEnough'));
    setText('monitorTotalNodesLabel', t('totalNodes'));
    setText('monitorOnlineNodesLabel', t('nodesOnline'));
    setText('monitorQuorumLabel', t('quorum'));
    const summary = clusterData.cluster && clusterData.cluster.summary ? clusterData.cluster.summary : {};
    const cpuPct = summary.cpuUsagePercent != null ? summary.cpuUsagePercent : 0;
    const memPct = summary.memoryUsagePercent != null ? summary.memoryUsagePercent : 0;
    setText('monitorCpu', cpuPct + '%');
    setText('monitorMemory', memPct + '%');
    setText('monitorVmTotal', String(summary.totalVMs || 0));
    setText('monitorVmRunning', String(summary.runningVMs != null ? summary.runningVMs : 0));
    setText('monitorCtTotal', String(summary.totalContainers || 0));
    setText('monitorCtRunning', String(summary.runningContainers != null ? summary.runningContainers : 0));
    const cpuBar = el('monitorCpuBar');
    if (cpuBar) {
        cpuBar.style.width = Math.min(100, cpuPct) + '%';
        setMonitorResFillThresholdClass(cpuBar, cpuPct, 'cpu');
    }
    const memBar = el('monitorMemoryBar');
    if (memBar) {
        memBar.style.width = Math.min(100, memPct) + '%';
        setMonitorResFillThresholdClass(memBar, memPct, 'ram');
    }
    setText('monitorNodesTitle', t('tabNodes'));
    const listEl = el('monitorNodesList');
    if (listEl) {
        if (!nodes.length) {
            listEl.innerHTML = '<div class="monitor-view__empty">' + escapeHtml(t('backupNoData') || 'Нет данных') + '</div>';
        } else {
            listEl.innerHTML = nodes.map(node => {
                const statusClass = node.status === 'online' ? 'online' : 'offline';
                const nip = node.ip ? String(node.ip).trim() : '';
                const ipHtml = nip ? `<span class="monitor-view__node-ip text-muted">${escapeHtml(nip)}</span>` : '';
                const offlineLine = formatNodeOfflineSinceLine(node);
                return `<div class="monitor-view__node-row"><div class="d-flex align-items-center flex-wrap gap-1"><span class="monitor-view__node-name">${escapeHtml(node.name)}</span>${ipHtml ? ' ' + ipHtml : ''}<span class="monitor-view__node-status ${statusClass}" title="${node.status === 'online' ? escapeHtml(t('nodeOnline')) : escapeHtml(t('nodeOffline'))}"></span></div>${offlineLine || ''}</div>`;
            }).join('');
        }
    }
}

// Компактный вид режима монитора (TrueNAS)
function updateMonitorViewTrueNAS(systemData, poolsData) {
    const sys = systemData && typeof systemData === 'object' ? systemData : {};
    setText('monitorTotalNodes', '1');
    setText('monitorOnlineNodes', '1');
    setText('monitorQuorum', t('notApplicable'));
    setText('monitorTotalNodesLabel', t('totalNodes'));
    setText('monitorOnlineNodesLabel', t('nodesOnline'));
    setText('monitorQuorumLabel', t('quorum'));
    let cpuPct = 0, memPct = 0;
    if (typeof sys.cpu_usage === 'number') cpuPct = Math.round(sys.cpu_usage);
    else if (Array.isArray(sys.loadavg) && sys.cores) cpuPct = Math.min(100, Math.round((sys.loadavg[0] / sys.cores) * 100));
    if (sys.memory && typeof sys.memory.total === 'number' && typeof sys.memory.used === 'number') {
        memPct = sys.memory.total > 0 ? Math.round((sys.memory.used / sys.memory.total) * 100) : 0;
    } else if (sys.memory && sys.memory.total && sys.memory.free != null) {
        memPct = sys.memory.total > 0 ? Math.round(((sys.memory.total - sys.memory.free) / sys.memory.total) * 100) : 0;
    }
    setText('monitorCpu', cpuPct + '%');
    setText('monitorMemory', memPct + '%');
    const apps = Array.isArray(lastTrueNASOverviewData?.apps) ? lastTrueNASOverviewData.apps : [];
    const appsRunning = apps.filter((a) => a && a.running).length;
    const pools = (poolsData && Array.isArray(poolsData.all)) ? poolsData.all : [];
    const totalStorage = pools.reduce((sum, p) => sum + Number(p?.total || 0), 0);
    const usedStorage = pools.reduce((sum, p) => sum + Number(p?.used || 0), 0);
    setText('monitorVmTotal', String(apps.length));
    setText('monitorVmRunning', String(appsRunning));
    setText('monitorCtTotal', formatSize(totalStorage));
    setText('monitorCtRunning', formatSize(usedStorage));
    const cpuBar = el('monitorCpuBar');
    if (cpuBar) {
        cpuBar.style.width = cpuPct + '%';
        setMonitorResFillThresholdClass(cpuBar, cpuPct, 'cpu');
    }
    const memBar = el('monitorMemoryBar');
    if (memBar) {
        memBar.style.width = memPct + '%';
        setMonitorResFillThresholdClass(memBar, memPct, 'ram');
    }
    const hostname = sys.hostname || sys.system_hostname || sys.host || 'TrueNAS';
    setText('monitorNodesTitle', t('tabServers'));
    const listEl = el('monitorNodesList');
    if (listEl) {
        listEl.innerHTML = `<div class="monitor-view__node-row"><span class="monitor-view__node-name">${escapeHtml(hostname)}</span><span class="monitor-view__node-status online" title="${t('connected')}"></span></div>`;
    }
}

// Список сервисов в компактном виде монитора (только те, что не скрыты в настройках)
function renderMonitorServicesList() {
    const listEl = document.getElementById('monitorServicesList');
    if (!listEl) return;
    const list = Array.isArray(monitoredServices) ? monitoredServices : [];
    const visibleList = list.filter(s => !monitorHiddenServiceIds.includes(Number(s.id)));
    setText('monitorServicesTitle', t('tabServicesMonitor'));
    if (!visibleList.length) {
        listEl.innerHTML = '<div class="monitor-view__empty">' + escapeHtml(t('backupNoData') || 'Нет данных') + '</div>';
        return;
    }
    listEl.innerHTML = visibleList.map(s => {
        const name = s.name || getServiceTargetDisplay(s);
        const statusKey = s.lastStatus === 'up' ? 'connected' : (s.lastStatus === 'down' ? 'serverError' : 'notConnected');
        const statusLabel = t(statusKey);
        const statusClass = s.lastStatus === 'up' ? 'bg-success' : (s.lastStatus === 'down' ? 'bg-danger' : 'bg-secondary');
        const typeLabel = (s.type || 'tcp').toUpperCase();
        const target = getServiceTargetDisplay(s);
        const latency = typeof s.lastLatency === 'number' ? `${s.lastLatency} ms` : '—';
        const iconHtml = renderServiceIconHtml(s, 'service-monitor-icon');
        return `
            <div class="monitor-view__card">
                <div class="d-flex justify-content-between align-items-center mb-1">
                    <span class="fw-semibold text-truncate d-inline-flex align-items-center gap-2" title="${escapeHtml(name)}">${iconHtml}<span class="text-truncate">${escapeHtml(name)}</span></span>
                    <span class="badge ${statusClass}" title="${escapeHtml(statusLabel)}">${escapeHtml(statusLabel)}</span>
                </div>
                <div class="small mb-1">
                    <span class="badge bg-secondary me-1">${escapeHtml(typeLabel)}</span>
                    <code class="text-truncate d-inline-block" style="max-width: 180px;" title="${escapeHtml(target)}">${escapeHtml(target)}</code>
                </div>
                <div class="small text-muted">${t('serviceLatencyHeader') || 'Задержка'}: ${latency}</div>
            </div>
        `;
    }).join('');
}

function renderMonitorVmsList() {
    const listEl = document.getElementById('monitorVmsList');
    if (!listEl) return;
    if (!getAuthHeadersForType('proxmox') && getAuthHeadersForType('truenas')) {
        setText('monitorVmsPanelTitle', 'Apps');
        const apps = Array.isArray(lastTrueNASOverviewData?.apps) ? lastTrueNASOverviewData.apps : [];
        if (!apps.length) {
            listEl.innerHTML = '<div class="monitor-view__empty">' + escapeHtml(t('backupNoData') || 'Нет данных') + '</div>';
            return;
        }
        listEl.innerHTML = apps.map((app) => {
            const statusLabel = app?.statusLabel || (app?.running ? 'running' : 'stopped');
            const statusClass = app?.running ? 'bg-success' : (app?.severity === 'critical' ? 'bg-danger' : 'bg-warning text-dark');
            return `
                <div class="monitor-view__card">
                    <div class="d-flex justify-content-between align-items-center mb-1">
                        <span class="fw-semibold text-truncate d-inline-flex align-items-center gap-2" title="${escapeHtml(app?.name || '')}">
                            <i class="bi bi-boxes text-primary"></i><span class="text-truncate">${escapeHtml(app?.name || 'App')}</span>
                        </span>
                        <span class="badge ${statusClass}" title="${escapeHtml(statusLabel)}">${escapeHtml(statusLabel)}</span>
                    </div>
                    <div class="small text-muted">${escapeHtml(app?.id != null ? String(app.id) : '—')}</div>
                </div>
            `;
        }).join('');
        return;
    }
    setText('monitorVmsPanelTitle', t('monitoredVmsDashboardTitle'));
    const cluster = lastClusterData;
    const list = cluster && Array.isArray(cluster.vms) ? cluster.vms : [];
    const visible = list.filter(vm => monitoredVmIds.includes(Number(vm.vmid != null ? vm.vmid : vm.id)) && !monitorHiddenVmIds.includes(Number(vm.vmid != null ? vm.vmid : vm.id)));
    const emptyText = t('vmListEmpty');
    if (!visible.length) {
        listEl.innerHTML = '<div class="monitor-view__empty">' + escapeHtml(emptyText) + '</div>';
        return;
    }
    listEl.innerHTML = visible.map(vm => {
        const typeLabel = (vm.type || 'vm').toUpperCase();
        const status = vm.status || 'unknown';
        const statusClass = getVmStatusBadgeClass(status);
        const statusLabel = getVmStatusLabel(status);
        const note = vm.node ? (vm.node + (vm.vmid != null ? ` / ${vm.vmid}` : '')) : (vm.note || '');
        const iconHtml = renderVmIconHtml(vm, 'vm-monitor-icon');
        return `
            <div class="monitor-view__card">
                <div class="d-flex justify-content-between align-items-center mb-1">
                    <span class="fw-semibold text-truncate d-inline-flex align-items-center gap-2" title="${escapeHtml(vm.name || '')}">${iconHtml}<span class="text-truncate">${escapeHtml(vm.name || '')}</span></span>
                    <span class="badge ${statusClass}" title="${escapeHtml(statusLabel)}">${escapeHtml(statusLabel)}</span>
                </div>
                <div class="small mb-1">
                    <span class="badge bg-secondary me-1">${escapeHtml(typeLabel)}</span>
                    <span class="text-muted" title="${escapeHtml(note || '')}">${escapeHtml(note || '')}</span>
                </div>
            </div>
        `;
    }).join('');
}

function renderVmsMonitorCards() {
    const container = document.getElementById('vmsMonitorCards');
    if (!container) return;
    const cluster = lastClusterData;
    const list = cluster && Array.isArray(cluster.vms) ? cluster.vms : [];
    const visible = list.filter(vm => monitoredVmIds.includes(Number(vm.vmid != null ? vm.vmid : vm.id)));
    if (!visible.length) {
        container.innerHTML = '<div class="col-12 text-muted small">' + (t('vmListEmpty') || 'VM/CT не выбраны') + '</div>';
        return;
    }
    const cards = visible.map(vm => {
        const typeLabel = (vm.type || 'vm').toUpperCase();
        const status = vm.status || 'unknown';
        const statusClass = getVmStatusBadgeClass(status);
        const statusLabel = getVmStatusLabel(status);
        const note = vm.node ? (vm.node + (vm.vmid != null ? ` / ${vm.vmid}` : '')) : (vm.note || '');
        const iconHtml = renderVmIconHtml(vm, 'vm-card-icon');
        return `
            <div class="col-md-4 col-lg-3 mb-3">
                <div class="node-card vm-card-layout">
                    <div class="vm-card-layout__icon">
                        ${iconHtml}
                    </div>
                    <div class="vm-card-layout__info">
                        <h6 class="mb-1 text-truncate" title="${escapeHtml(vm.name || '')}">${escapeHtml(vm.name || '')}</h6>
                        <div class="mb-1">
                            <span class="badge bg-secondary me-1">${escapeHtml(typeLabel)}</span>
                        </div>
                        <div class="small text-muted text-truncate" title="${escapeHtml(note || '')}">${escapeHtml(note || '')}</div>
                    </div>
                    <div class="vm-card-layout__status">
                        <span class="badge ${statusClass}" title="${escapeHtml(statusLabel)}">${escapeHtml(statusLabel)}</span>
                    </div>
                </div>
            </div>
        `;
    }).join('');
    setHTMLIfChanged('vmsMonitorCards', cards || '');
}

// Show/hide loading
function showLoading(show) {
    const ind = document.getElementById('loadingIndicator');
    if (ind) ind.classList.toggle('is-visible', !!show);
    const refreshBtn = el('refreshBtn');
    if (refreshBtn) refreshBtn.disabled = show;
}

// Format time
function formatUptime(seconds) {
    if (!seconds || seconds === 0) return 'N/A';
    const days = Math.floor(seconds / 86400);
    const hours = Math.floor((seconds % 86400) / 3600);
    const minutes = Math.floor((seconds % 3600) / 60);
    
    if (days > 0) return `${days}${t('days')} ${hours}${t('hours')}`;
    if (hours > 0) return `${hours}${t('hours')} ${minutes}${t('minutes')}`;
    return `${minutes}${t('minutes')}`;
}

/** Строка «не в сети с …» для карточки узла (ISO с сервера). */
function formatNodeOfflineSinceLine(node) {
    if (!node || String(node.status || '').toLowerCase() === 'online' || !node.offlineSince) return '';
    const d = new Date(node.offlineSince);
    if (Number.isNaN(d.getTime())) return '';
    const when = d.toLocaleString(currentLanguage === 'ru' ? 'ru-RU' : 'en-US');
    return `<div class="small text-danger mt-1">${escapeHtml(t('nodeOfflineSince'))}: ${escapeHtml(when)}</div>`;
}

// Format bytes
function formatBytes(bytes) {
    if (!bytes || bytes === 0) return '0 B';
    const units = ['B', 'KB', 'MB', 'GB', 'TB'];
    let value = bytes;
    let unitIndex = 0;
    while (value >= 1024 && unitIndex < units.length - 1) {
        value /= 1024;
        unitIndex++;
    }
    return `${value.toFixed(1)} ${units[unitIndex]}`;
}

// Update dashboard
function updateDashboard(clusterData, storageData, backupsData, hostMetricsData = null) {
    if (!clusterData || !Array.isArray(clusterData.nodes) || !clusterData.cluster?.summary || !clusterData.quorum) {
        throw new Error(clusterData?.error || 'Некорректный ответ кластера');
    }
    const hostMetricsMap = new Map(
        Array.isArray(hostMetricsData?.items)
            ? hostMetricsData.items.map((item) => [item.node, item])
            : []
    );
    const hostMetricsRenderSettings = normalizeHostMetricsSettingsClient(hostMetricsData && hostMetricsData.settings);
    const totalNodes = clusterData.nodes.length;
    const onlineNodes = clusterData.nodes.filter(n => n.status === 'online').length;
    
    setText('totalNodes', String(totalNodes));
    setText('onlineNodes', String(onlineNodes));
    
    const quorumOk = onlineNodes >= clusterData.quorum.quorum;
    setHTML('quorumStatus', quorumOk ? t('quorumEnough') : t('quorumNotEnough'));
    const quorumEl = el('quorumStatus');
    if (quorumEl) quorumEl.className = 'stat-value ' + (quorumOk ? 'text-success' : 'text-warning');

    setHTML('connectionStatus', '<i class="bi bi-check-circle-fill text-success"></i> ' + t('connected'));

    const summary = clusterData.cluster.summary;
    setText('clusterCpu', summary.cpuUsagePercent + '%');
    setText('clusterCpuDetail', `${Math.round(summary.usedCPU)}/${summary.totalCPU} ${t('cores')}`);
    const cpuBar = el('clusterCpuBar');
    if (cpuBar) {
        cpuBar.style.width = summary.cpuUsagePercent + '%';
        setProgressBarThresholdClass(cpuBar, summary.cpuUsagePercent, 'cpu');
    }

    setText('clusterMemory', summary.memoryUsagePercent + '%');
    setText('clusterMemoryDetail', `${summary.usedMemory}/${summary.totalMemory}`);
    const memBar = el('clusterMemoryBar');
    if (memBar) {
        memBar.style.width = summary.memoryUsagePercent + '%';
        setProgressBarThresholdClass(memBar, summary.memoryUsagePercent, 'ram');
    }

    const vmT = summary.totalVMs || 0;
    const vmR = summary.runningVMs != null ? summary.runningVMs : 0;
    const ctT = summary.totalContainers || 0;
    const ctR = summary.runningContainers != null ? summary.runningContainers : 0;
    setText('clusterVmTotal', String(vmT));
    setText('clusterVmRunning', String(vmR));
    setText('clusterCtTotal', String(ctT));
    setText('clusterCtRunning', String(ctR));
    const vmPct = vmT > 0 ? Math.min(100, Math.round((vmR / vmT) * 100)) : 0;
    const ctPct = ctT > 0 ? Math.min(100, Math.round((ctR / ctT) * 100)) : 0;
    const vmBar = el('clusterVmRunningBar');
    if (vmBar) {
        vmBar.style.width = vmPct + '%';
        vmBar.className = 'progress-bar bg-success';
    }
    const ctBar = el('clusterCtRunningBar');
    if (ctBar) {
        ctBar.style.width = ctPct + '%';
        ctBar.className = 'progress-bar bg-success';
    }

    const nodesContainer = el('nodesContainer');
    if (nodesContainer) {
        nodesContainer.className = 'cluster-scroll-row';
        const nodesHtml = clusterData.nodes.map(node => {
        const nodeOnline = String(node.status || '').toLowerCase() === 'online';
        const hostMetric = hostMetricsMap.get(node.name) || null;
        const hostMetricProblems = getHostMetricProblemMessages(hostMetric, hostMetricsRenderSettings);
        const hostMetricWarning = nodeOnline && hostMetricProblems.length
            ? `<span class="badge bg-warning text-dark ms-2 host-problem-trigger" role="button" tabindex="0" data-problem-lines="${escapeHtml(hostMetricProblems.join('\n'))}" title="${escapeHtml(t('toastWarning') || 'Warning')}"><i class="bi bi-exclamation-triangle-fill"></i></span>`
            : '';
        const nodeIpDisplay = node.ip || (hostMetric && hostMetric.nodeIp) || '';
        const nodeIpLine = nodeIpDisplay
            ? `<div class="small text-muted mt-1"><i class="bi bi-hdd-network me-1"></i>${escapeHtml(String(nodeIpDisplay))}</div>`
            : '';
        const cardClass = nodeOnline
            ? 'node-card host-node-card-chart-trigger cursor-pointer'
            : 'node-card';
        const cardAttrs = nodeOnline
            ? ` data-node="${escapeHtml(node.name)}" role="button" tabindex="0" title="${escapeHtml(t('hostNodeAllMetricsCardOpenTitle') || '')}"`
            : '';
        return `
            <div class="cluster-scroll-item">
                <div class="${cardClass}"${cardAttrs}>
                    <div class="d-flex justify-content-between align-items-start mb-2">
                        <div>
                        <h5 class="mb-0 d-inline-flex align-items-center">${node.name}${hostMetricWarning}</h5>
                        ${nodeIpLine}
                        ${formatNodeOfflineSinceLine(node)}
                        </div>
                        <div class="d-flex align-items-center gap-2 flex-shrink-0">
                            ${nodeOnline ? `<span class="text-muted host-node-chart-hint" aria-hidden="true" title="${escapeHtml(t('hostNodeAllMetricsCardOpenTitle') || '')}"><i class="bi bi-graph-up-arrow"></i></span>` : ''}
                            <span class="badge ${nodeOnline ? 'bg-success' : 'bg-danger'}">
                            ${nodeOnline ? t('nodeOnline') : t('nodeOffline')}
                        </span>
                            ${formatNodeIpmiStatusBadge(node)}
                        </div>
                    </div>
                    ${nodeOnline ? `
                    <div class="row g-2">
                        <div class="col-6">
                            <small class="text-muted">${t('nodeCpu')}</small>
                            <div class="fw-bold">${node.cpu}%</div>
                            <div class="progress"><div class="progress-bar ${getColorClass(node.cpu, 'cpu')}" style="width: ${node.cpu}%"></div></div>
                        </div>
                        <div class="col-6">
                            <small class="text-muted">${t('nodeRam')}</small>
                            <div class="fw-bold">${node.memory}%</div>
                            <div class="progress"><div class="progress-bar ${getColorClass(node.memory, 'ram')}" style="width: ${node.memory}%"></div></div>
                        </div>
                        <div class="col-6 mt-2">
                            <small class="text-muted">${t('nodeUptime')}</small>
                            <div class="fw-bold">${formatUptime(node.uptime)}</div>
                        </div>
                        <div class="col-6 mt-2">
                            <small class="text-muted">${t('nodeCpuCores')}</small>
                            <div class="fw-bold">${node.cpuCount}</div>
                        </div>
                        ${formatHostMetricsNodeExtras(hostMetric, node.name)}
                    </div>` : ''}
                </div>
            </div>
        `;
        }).join('');
        setHTMLIfChanged('nodesContainer', nodesHtml);
        initHostMetricProblemPopovers();
    }

    if (monitorMode) {
        updateMonitorView(clusterData);
        renderMonitorServicesList();
        renderMonitorVmsList();
    }

    updateStorageUI(storageData);
    updateBackupsUI(backupsData);
    lastBackupsDataForMonitor = backupsData;
    if (monitorMode && monitorCurrentView === 'backupRuns') {
        renderMonitorBackupRuns(backupsData);
    }

    setHTMLIfChanged('quorumStats', `
        <div class="col-md-4"><h3>${clusterData.quorum.votes}</h3><p class="text-muted">${t('quorumVotes')}</p></div>
        <div class="col-md-4"><h3>${clusterData.quorum.expected}</h3><p class="text-muted">${t('quorumExpected')}</p></div>
        <div class="col-md-4"><h3 class="${quorumOk ? 'text-success' : 'text-warning'}">${clusterData.quorum.quorum}</h3><p class="text-muted">${t('quorumNeeded')}</p></div>
    `);

    const quorumList = el('quorumNodesList');
    if (quorumList) {
        const quorumHtml = clusterData.quorum.nodes.map(node => `
        <div class="col-md-3 mb-2">
            <span class="badge ${node.online ? 'bg-success' : 'bg-secondary'} p-2 w-100">
                ${node.name} (${node.votes} ${node.votes === 1 ? t('quorumVote') : t('quorumVotes_plural')})
            </span>
        </div>
    `).join('');
        setHTMLIfChanged('quorumNodesList', quorumHtml);
    }

    setHTMLIfChanged('lastUpdate', '<i class="bi bi-clock"></i> ' + t('lastUpdate') + ': ' + new Date().toLocaleString(currentLanguage === 'ru' ? 'ru-RU' : 'en-US'));

    lastClusterData = clusterData;
    syncClusterResourcesCardInteractivity();
}

// Update storage UI
function updateStorageUI(data) {
    if (!data || !data.all) return;
    const storageTableEl = document.getElementById('storageTable');
    if (storageTableEl) {
        const wrap = storageTableEl.closest('.table-responsive');
        if (wrap) wrap.style.display = '';
    }
    
    setHTMLIfChanged('storageStats', `
        <div class="col-md-3"><div class="stat-card"><div class="stat-value">${data.summary.total}</div><div class="stat-label">${t('storageTotal')}</div></div></div>
        <div class="col-md-3"><div class="stat-card"><div class="stat-value text-success">${data.summary.active}</div><div class="stat-label">${t('storageActive')}</div></div></div>
        <div class="col-md-3"><div class="stat-card"><div class="stat-value">${data.summary.total_space_fmt}</div><div class="stat-label">${t('storageTotalSpace')}</div></div></div>
        <div class="col-md-3"><div class="stat-card"><div class="stat-value">${data.summary.used_space_fmt}</div><div class="stat-label">${t('storageUsedSpace')}</div></div></div>
    `);
    
    setHTMLIfChanged('storageTypes', Object.keys(data.byType).map(type => {
        const tData = data.byType[type];
        const usage = tData.total > 0 ? Math.round((tData.used / tData.total) * 100) : 0;
        return `
            <div class="col-md-3 mb-2">
                <div class="card"><div class="card-body p-2">
                    <h6 class="mb-1">${type.toUpperCase()}</h6>
                    <small>${tData.count} ${t('storageTotal')}</small>
                    <div class="progress mt-1" style="height:5px">
                        <div class="progress-bar ${usage > 80 ? 'bg-danger' : (usage > 60 ? 'bg-warning' : 'bg-success')}" style="width:${usage}%"></div>
                    </div>
                    <small class="text-muted">${formatBytes(tData.used)} / ${formatBytes(tData.total)}</small>
                </div></div>
            </div>
        `;
    }).join(''));
    
    setHTMLIfChanged('storageBody', data.all.map(s => `
        <tr>
            <td>${s.node}</td>
            <td><strong>${s.name}</strong></td>
            <td><span class="badge bg-info">${s.type}</span></td>
            <td><span class="badge ${s.active ? 'bg-success' : 'bg-danger'}">${s.active ? t('storageActive_yes') : t('storageActive_no')}</span></td>
            <td>${s.used_fmt}</td>
            <td>${s.total_fmt}</td>
            <td>
                <div class="d-flex align-items-center">
                    <div class="progress flex-grow-1 me-2" style="height:8px">
                        <div class="progress-bar ${s.usage_percent > 80 ? 'bg-danger' : (s.usage_percent > 60 ? 'bg-warning' : 'bg-success')}" 
                             style="width:${s.usage_percent}%"></div>
                    </div>
                    <span>${s.usage_percent}%</span>
                </div>
            </td>
            <td><small>${s.type === 'nfs' && s.server ? `${s.server}:${s.export || ''}` : s.node}</small></td>
        </tr>
    `).join(''));
    
    if (!storageTable) {
        storageTable = $('#storageTable').DataTable({ 
            pageLength: 10, 
            order: [[0,'asc']],
            language: {
                url: currentLanguage === 'ru' 
                    ? 'https://cdn.datatables.net/plug-ins/1.13.6/i18n/ru.json'
                    : 'https://cdn.datatables.net/plug-ins/1.13.6/i18n/en-GB.json'
            }
        });
    } else {
        storageTable.clear().rows.add($('#storageBody').find('tr')).draw();
    }
}

// Update backups UI: задания (конфиг) и выполнения (vzdump)
function updateBackupsUI(data) {
    if (!data) return;
    const jobs = Array.isArray(data.jobs) ? data.jobs : [];
    const execs = Array.isArray(data.executions) ? data.executions : [];
    const stats = data.stats || { total: 0, enabled: 0, disabled: 0 };
    const exs = data.execution_stats || { shown: 0, success: 0, error: 0, running: 0 };
    const dtLangUrl = currentLanguage === 'ru'
        ? 'https://cdn.datatables.net/plug-ins/1.13.6/i18n/ru.json'
        : 'https://cdn.datatables.net/plug-ins/1.13.6/i18n/en-GB.json';

    setHTMLIfChanged('backupJobsStats', `
        <div class="col-6 col-md-4 col-lg-2"><div class="stat-card"><div class="stat-value">${stats.total}</div><div class="stat-label">${t('backupTotal')}</div></div></div>
        <div class="col-6 col-md-4 col-lg-2"><div class="stat-card"><div class="stat-value text-success">${stats.enabled}</div><div class="stat-label">${t('backupEnabled')}</div></div></div>
        <div class="col-6 col-md-4 col-lg-2"><div class="stat-card"><div class="stat-value text-secondary">${stats.disabled}</div><div class="stat-label">${t('backupDisabled')}</div></div></div>
    `);

    setHTMLIfChanged('backupExecStats', `
        <div class="col-6 col-md-4 col-lg-2"><div class="stat-card"><div class="stat-value">${exs.shown}</div><div class="stat-label">${t('backupExecShown')}</div></div></div>
        <div class="col-6 col-md-4 col-lg-2"><div class="stat-card"><div class="stat-value text-success">${exs.success}</div><div class="stat-label">${t('backupSuccess')}</div></div></div>
        <div class="col-6 col-md-4 col-lg-2"><div class="stat-card"><div class="stat-value text-danger">${exs.error}</div><div class="stat-label">${t('backupError')}</div></div></div>
        <div class="col-6 col-md-4 col-lg-2"><div class="stat-card"><div class="stat-value text-primary">${exs.running}</div><div class="stat-label">${t('backupRunning')}</div></div></div>
    `);

    const noJobsRow = `<tr><td colspan="7" class="text-center text-muted py-4">${escapeHtml(t('backupNoData'))}</td></tr>`;
    if (jobs.length === 0) {
        if (backupsJobsTable) {
            backupsJobsTable.destroy();
            backupsJobsTable = null;
        }
        setHTMLIfChanged('backupJobsBody', noJobsRow);
    } else {
        const jobsHtml = jobs.map(job => {
            const stateBadge = job.enabled
                ? `<span class="badge bg-success">${escapeHtml(t('backupEnabled'))}</span>`
                : `<span class="badge bg-secondary">${escapeHtml(t('backupDisabled_yes'))}</span>`;
            return `<tr>
                <td><strong>${escapeHtml(String(job.id))}</strong></td>
                <td><code>${escapeHtml(job.schedule || '—')}</code></td>
                <td>${stateBadge}</td>
                <td>${escapeHtml(job.storage || '—')}</td>
                <td>${job.vmid != null && job.vmid !== '' ? escapeHtml(String(job.vmid)) : escapeHtml(t('backupAll'))}</td>
                <td><span class="badge bg-info">${escapeHtml(job.mode || 'snapshot')}</span></td>
                <td><small>${escapeHtml(job.next_run || '—')}</small></td>
            </tr>`;
        }).join('');
        setHTMLIfChanged('backupJobsBody', jobsHtml);
        if (!backupsJobsTable) {
            backupsJobsTable = $('#backupJobsTable').DataTable({
                pageLength: 10,
                order: [[0, 'asc']],
                language: { url: dtLangUrl }
            });
        } else {
            backupsJobsTable.clear().rows.add($('#backupJobsBody').find('tr')).draw();
        }
    }

    const noExecRow = `<tr><td colspan="8" class="text-center text-muted py-4">${escapeHtml(t('backupNoExecData'))}</td></tr>`;
    if (execs.length === 0) {
        if (backupsExecTable) {
            backupsExecTable.destroy();
            backupsExecTable = null;
        }
        setHTMLIfChanged('backupExecutionsBody', noExecRow);
    } else {
        const execHtml = execs.map(tk => {
            const st = tk.status || '';
            const ex = tk.exitstatus || '';
            let badge = `<span class="badge bg-secondary">${escapeHtml(t('backupStatusUnknown'))}</span>`;
            if (st === 'OK' || String(ex).toLowerCase() === 'ok') {
                badge = `<span class="badge bg-success">${escapeHtml(t('backupStatusSuccess'))}</span>`;
            } else if (st === 'error' || String(ex).toLowerCase() === 'error') {
                badge = `<span class="badge bg-danger">${escapeHtml(t('backupStatusError'))}</span>`;
            } else if (st === 'running') {
                badge = `<span class="badge bg-primary">${escapeHtml(t('backupStatusRunning'))}</span>`;
            } else if (st) {
                badge = `<span class="badge bg-warning">${escapeHtml(st)}</span>`;
            }
            const upid = tk.upid || '';
            const upidShort = upid.length > 32 ? '…' + upid.slice(-30) : upid;
            const stOrder = Number(tk.starttime) || 0;
            const enOrder = Number(tk.endtime) || 0;
            const resCls = (String(ex).toLowerCase() === 'ok' || st === 'OK') ? 'text-success' : (st === 'error' ? 'text-danger' : '');
            return `<tr>
                <td data-order="${stOrder}"><small>${escapeHtml(tk.starttime_fmt || '—')}</small></td>
                <td data-order="${enOrder}"><small>${escapeHtml(tk.endtime_fmt || '—')}</small></td>
                <td>${escapeHtml(tk.node || '—')}</td>
                <td>${tk.id != null && tk.id !== '' ? escapeHtml(String(tk.id)) : '—'}</td>
                <td>${badge}</td>
                <td class="${resCls}"><small>${escapeHtml(ex || st || '—')}</small></td>
                <td><small>${escapeHtml(tk.user || '—')}</small></td>
                <td><code class="small text-break" style="max-width:12rem" title="${escapeHtml(upid)}">${escapeHtml(upidShort || '—')}</code></td>
            </tr>`;
        }).join('');
        setHTMLIfChanged('backupExecutionsBody', execHtml);
        if (!backupsExecTable) {
            backupsExecTable = $('#backupExecutionsTable').DataTable({
                pageLength: 15,
                order: [[0, 'desc']],
                language: { url: dtLangUrl }
            });
        } else {
            backupsExecTable.clear().rows.add($('#backupExecutionsBody').find('tr')).draw();
        }
    }
}

function monitorBackupStripClass(tk) {
    const st = tk.status || '';
    const ex = String(tk.exitstatus || '').toLowerCase();
    if (st === 'OK' || ex === 'ok') return 'monitor-backup-run-strip--ok';
    if (st === 'error' || ex === 'error') return 'monitor-backup-run-strip--err';
    if (st === 'running') return 'monitor-backup-run-strip--run';
    return 'monitor-backup-run-strip--warn';
}

function monitorBackupBadge(tk) {
    const st = tk.status || '';
    const ex = tk.exitstatus || '';
    if (st === 'OK' || String(ex).toLowerCase() === 'ok') {
        return `<span class="badge bg-success">${escapeHtml(t('backupStatusSuccess'))}</span>`;
    }
    if (st === 'error' || String(ex).toLowerCase() === 'error') {
        return `<span class="badge bg-danger">${escapeHtml(t('backupStatusError'))}</span>`;
    }
    if (st === 'running') {
        return `<span class="badge bg-primary">${escapeHtml(t('backupStatusRunning'))}</span>`;
    }
    if (st) return `<span class="badge bg-warning text-dark">${escapeHtml(st)}</span>`;
    return `<span class="badge bg-secondary">${escapeHtml(t('backupStatusUnknown'))}</span>`;
}

/** Короткая дата/время для одной строки на экране монитора */
function monitorBackupShortTime(fmt) {
    if (!fmt) return '—';
    const s = String(fmt).trim();
    const comma = s.indexOf(',');
    if (comma > 0) {
        const datePart = s.slice(0, comma).trim();
        const timePart = s.slice(comma + 1).trim();
        const dp = datePart.split('.');
        const dateShort = dp.length >= 2 ? `${dp[0]}.${dp[1]}` : datePart.slice(0, 5);
        const tm = timePart.match(/^(\d{1,2}:\d{2})/);
        return `${dateShort} ${tm ? tm[1] : timePart.slice(0, 5)}`;
    }
    return s.length > 14 ? s.slice(0, 14) : s;
}

const MONITOR_BACKUPS_UI_MAX = 10;

/** Экран бэкапов: до 10 vzdump на узел, без скролла */
function renderMonitorBackupRuns(data) {
    const rowEl = document.getElementById('backupsMonitorCardsRow');
    if (!rowEl) return;
    if (!data) {
        rowEl.innerHTML = `<div class="monitor-backup-node-empty w-100">${escapeHtml(t('backupMonitorNoDataYet'))}</div>`;
        return;
    }
    let byNode = data.executions_by_node && typeof data.executions_by_node === 'object' ? { ...data.executions_by_node } : null;
    if (!byNode || !Object.keys(byNode).length) {
        byNode = {};
        const execs = Array.isArray(data.executions) ? data.executions : [];
        for (const e of execs) {
            const n = e.node || '?';
            if (!byNode[n]) byNode[n] = [];
            byNode[n].push(e);
        }
    }
    const nodeNames = Object.keys(byNode).sort((a, b) => a.localeCompare(b, undefined, { sensitivity: 'base' }));

    if (!nodeNames.length) {
        rowEl.innerHTML = `<div class="monitor-backup-node-empty w-100">${escapeHtml(t('backupNoExecData'))}</div>`;
        return;
    }

    rowEl.innerHTML = nodeNames.map(node => {
        const allRuns = byNode[node] || [];
        const displayRuns = allRuns.slice(0, MONITOR_BACKUPS_UI_MAX);
        const totalOnNode = allRuns.length;
        const shown = displayRuns.length;
        const maxOnNode = Math.min(totalOnNode, 10);
        const countBadge = totalOnNode
            ? `<span class="monitor-backup-count-badge badge bg-secondary text-nowrap" title="${escapeHtml(t('backupMonitorFullListHint'))}"><span class="monitor-backup-count-num">${shown}</span><span class="mx-1">/</span><span>${maxOnNode}</span></span>`
            : '';
        const thVm = escapeHtml(t('backupMonitorColVm'));
        const thTime = escapeHtml(t('backupMonitorColTime'));
        const thSt = escapeHtml(t('backupMonitorColStatus'));
        const strips = displayRuns.length
            ? `<div class="monitor-backup-table-scroll">
                <table class="table monitor-backup-node-table mb-0">
                <thead><tr>
                    <th class="monitor-backup-col-vm">${thVm}</th>
                    <th class="monitor-backup-col-time">${thTime}</th>
                    <th class="monitor-backup-col-st text-end">${thSt}</th>
                </tr></thead>
                <tbody>${displayRuns.map(task => {
                const vm = task.id != null && task.id !== '' ? String(task.id) : '—';
                const rowCls = monitorBackupStripClass(task).replace('monitor-backup-run-strip--', 'monitor-backup-tr--');
                const ts = escapeHtml(monitorBackupShortTime(task.starttime_fmt));
                const timeTd = task.endtime_fmt
                    ? `<span class="monitor-backup-time-start">${ts}</span><span class="monitor-backup-time-sep"> → </span><span class="monitor-backup-time-end">${escapeHtml(monitorBackupShortTime(task.endtime_fmt))}</span>`
                    : `<span class="monitor-backup-time-single">${ts}</span>`;
                return `<tr class="monitor-backup-tr ${rowCls}" title="${escapeHtml(task.upid || '')}">
                    <td class="monitor-backup-col-vm">${escapeHtml(vm)}</td>
                    <td class="monitor-backup-col-time">${timeTd}</td>
                    <td class="monitor-backup-col-st">${monitorBackupBadge(task)}</td>
                </tr>`;
            }).join('')}</tbody></table></div>`
            : `<div class="monitor-backup-node-empty">${escapeHtml(t('backupMonitorNodeEmpty'))}</div>`;
        return `<div class="monitor-backup-node-col">
            <div class="card monitor-backup-node-card border h-100">
                <div class="card-header d-flex align-items-center gap-2">
                    <span class="text-truncate min-w-0 flex-grow-1"><i class="bi bi-hdd-network me-1 flex-shrink-0"></i>${escapeHtml(node)}</span>
                    ${countBadge}
                </div>
                <div class="card-body monitor-backup-card-body-table p-0">${strips}</div>
            </div>
        </div>`;
    }).join('');
}

// ==================== SERVICE MONITORING (отдельная вкладка, TCP/UDP/HTTP) ====================

// Monitored services are persisted via API; no local save needed

function toggleServiceTypeFields() {
    const typeSelect = document.getElementById('settingsServiceTypeSelect');
    const hostWrap = document.getElementById('settingsServiceHostWrap');
    const portWrap = document.getElementById('settingsServicePortWrap');
    const urlWrap = document.getElementById('settingsServiceUrlWrap');
    const urlLabel = document.getElementById('settingsServiceUrlLabel');
    const urlInput = document.getElementById('settingsServiceUrlInput');
    if (!typeSelect || !hostWrap || !portWrap || !urlWrap) return;
    const type = (typeSelect.value || 'tcp').toLowerCase();
    const isHttpUrl = type === 'http' || type === 'https';
    const needUrl = type === 'http' || type === 'https' || type === 'snmp' || type === 'nut';

    // For http/https: host+port are not needed, only URL is required.
    // For snmp/nut: host+port are needed + extra params in the URL field.
    hostWrap.classList.toggle('d-none', isHttpUrl);
    portWrap.classList.toggle('d-none', isHttpUrl);
    urlWrap.classList.toggle('d-none', !needUrl);

    if (urlLabel && urlInput) {
        if (type === 'snmp') {
            urlLabel.textContent = t('serviceUrlLabelSnmp');
            urlInput.placeholder = 'public|1.3.6.1.2.1.1.3.0';
        } else if (type === 'nut') {
            urlLabel.textContent = t('serviceUrlLabelNutHint');
            urlInput.placeholder = 'myups|ups.status';
        } else {
            urlLabel.textContent = 'URL';
            urlInput.placeholder = 'https://example.local/';
        }
    }
}

function getServiceTargetDisplay(s) {
    if (s.type === 'http' || s.type === 'https' || s.url) return s.url || '—';
    const host = s.host || '';
    const port = s.port != null ? s.port : '';
    return host && port ? `${host}:${port}` : (host || port || '—');
}

function buildServiceTargetForApi(s) {
    const type = (s.type || 'tcp').toLowerCase();
    const name = s.name || getServiceTargetDisplay(s);
    if (type === 'http' || type === 'https') {
        return { name, type: 'http', url: (s.url || '').trim() };
    }
    if (type === 'snmp' || type === 'nut') {
        return { name, type, host: (s.host || '').trim(), port: parseInt(s.port, 10) || null, url: (s.url || '').trim() };
    }
    return { name, type: type || 'tcp', host: (s.host || '').trim(), port: parseInt(s.port, 10) };
}

function renderMonitoredServices() {
    const container = document.getElementById('servicesCards');
    if (!container) return;
    const list = Array.isArray(monitoredServices) ? monitoredServices : [];
    if (!list.length) {
        container.innerHTML = '<div class="col-12 text-muted small">' + escapeHtml(t('servicesNotConfigured')) + '</div>';
        return;
    }
    const cards = list.map((s, idx) => {
        const statusBadge = s.lastStatus === 'up'
            ? `<span class="badge bg-success">${t('connected')}</span>`
            : (s.lastStatus === 'down'
                ? `<span class="badge bg-danger">${t('serverError')}</span>`
                : `<span class="badge bg-secondary">${t('notConnected')}</span>`);
        const latency = typeof s.lastLatency === 'number' ? `${s.lastLatency} ms` : '—';
        const typeLabel = (s.type || 'tcp').toUpperCase();
        const target = getServiceTargetDisplay(s);
        const iconHtml = renderServiceIconHtml(s, 'service-card-icon');
        return `
            <div class="col-md-4 col-lg-3 mb-3">
                <div class="node-card service-card-layout">
                    <div class="service-card-layout__icon">
                        ${iconHtml}
                    </div>
                    <div class="service-card-layout__info">
                        <h6 class="mb-1 text-truncate" title="${escapeHtml(s.name || target)}">${escapeHtml(s.name || target)}</h6>
                        <div class="mb-1">
                            <span class="badge bg-secondary me-1">${escapeHtml(typeLabel)}</span>
                            <code class="small">${escapeHtml(target)}</code>
                        </div>
                        <div class="small text-muted">
                            ${t('serviceLatencyHeader') || 'Задержка'}: ${latency}
                        </div>
                    </div>
                    <div class="service-card-layout__status">
                        ${statusBadge}
                    </div>
                </div>
            </div>
        `;
    }).join('');
    setHTMLIfChanged('servicesCards', cards || '');
}

function renderSettingsMonitoredServices() {
    const body = document.getElementById('settingsServicesBody');
    if (!body) return;
    const list = Array.isArray(monitoredServices) ? monitoredServices : [];
    const rows = list.map((s) => {
        const typeLabel = (s.type || 'tcp').toUpperCase();
        const target = getServiceTargetDisplay(s);
        const id = s.id != null ? s.id : 0;
        const showInMonitor = !monitorHiddenServiceIds.includes(Number(id));
        const iconName = getServiceIconName(s);
        const tintBg = getServiceIconTintOrDefault(s);
        const tintFg = getContrastForegroundForBg(tintBg);
        const pickerTitle = t('iconPickerChoose') || 'Выбрать иконку';
        const clearTitle = t('clear') || 'Сбросить';
        const colorTitle = t('settingsServiceIconColorLabel') || 'Цвет иконки';
        const randomColorTitle = t('iconColorRandom') || 'Случайный цвет';
        return `
            <tr>
                <td>
                    <div class="d-flex align-items-center gap-2">
                        ${renderServiceIconHtml(s, 'service-settings-icon')}
                        <span>${escapeHtml(s.name || target)}</span>
                    </div>
                </td>
                <td><span class="badge bg-secondary">${escapeHtml(typeLabel)}</span></td>
                <td><code>${escapeHtml(target)}</code></td>
                <td style="min-width: 260px;">
                    <div class="icon-setting-control">
                        <button type="button" class="btn btn-sm icon-picker-trigger icon-picker-trigger--tinted" style="background-color:${escapeHtml(tintBg)};color:${escapeHtml(tintFg)};" onclick="openIconPicker('service', ${id})" title="${escapeHtml(pickerTitle)}">
                            ${renderServiceIconHtml(s, 'service-settings-icon', tintFg)}
                        </button>
                        <div class="icon-setting-control__meta">
                            <div class="small text-truncate">${iconName ? escapeHtml(iconName) : (t('iconPickerNotSelected') || 'Не выбрано')}</div>
                        </div>
                        <input type="color" class="form-control form-control-color icon-color-input" value="${escapeHtml(tintBg)}" title="${escapeHtml(colorTitle)}" onchange="saveServiceIconColorSetting(${id}, this.value)">
                        <button type="button" class="btn btn-sm btn-outline-secondary" onclick="applyRandomIconColor('service', ${id})" title="${escapeHtml(randomColorTitle)}">
                            <i class="bi bi-shuffle"></i>
                        </button>
                        <button type="button" class="btn btn-sm btn-outline-secondary" onclick="saveServiceIconSetting(${id}, '')" title="${escapeHtml(clearTitle)}">
                            <i class="bi bi-x-lg"></i>
                        </button>
                    </div>
                </td>
                <td class="text-center align-middle">
                    <input type="checkbox" class="form-check-input" id="monitorVisible_${id}" ${showInMonitor ? 'checked' : ''}
                           onchange="toggleMonitorVisible(${id})" title="${t('settingsServiceShowInMonitor') || 'Показывать в режиме монитора'}">
                </td>
                <td class="text-nowrap">
                    <button class="btn btn-sm btn-outline-danger" onclick="removeMonitoredService(${id})" title="${t('remove') || 'Удалить'}">
                        <i class="bi bi-trash"></i>
                    </button>
                </td>
            </tr>
        `;
    }).join('');
    setHTMLIfChanged('settingsServicesBody', rows || '');
    renderClusterDashboardTilesSettings();
}

function saveServiceIconSetting(serviceId, rawValue) {
    const id = Number(serviceId);
    if (Number.isNaN(id)) return;
    const icon = normalizeVmIconName(rawValue);
    const current = normalizeVmIconName(monitorServiceIcons[String(id)] || '');
    if (icon === current) return;
    if (icon) monitorServiceIcons[String(id)] = icon;
    else delete monitorServiceIcons[String(id)];
    saveSettingsToServer({ monitorServiceIcons });
    renderMonitoredServices();
    renderSettingsMonitoredServices();
    renderMonitorServicesList();
    renderClusterDashboardTiles().catch(() => {});
}

function saveServiceIconColorSetting(serviceId, rawValue) {
    const id = Number(serviceId);
    if (Number.isNaN(id)) return;
    const color = normalizeHexColor(rawValue);
    const current = normalizeHexColor(monitorServiceIconColors[String(id)] || '');
    if (color === current) return;
    if (color) monitorServiceIconColors[String(id)] = color;
    else delete monitorServiceIconColors[String(id)];
    saveSettingsToServer({ monitorServiceIconColors });
    renderMonitoredServices();
    renderSettingsMonitoredServices();
    renderMonitorServicesList();
    renderClusterDashboardTiles().catch(() => {});
}

function toggleMonitorVisible(serviceId) {
    const id = Number(serviceId);
    if (monitorHiddenServiceIds.includes(id)) {
        monitorHiddenServiceIds = monitorHiddenServiceIds.filter(x => x !== id);
    } else {
        monitorHiddenServiceIds = [...monitorHiddenServiceIds, id];
    }
    saveSettingsToServer({ monitorHiddenServiceIds: monitorHiddenServiceIds });
    renderSettingsMonitoredServices();
    renderMonitorServicesList();
}

function getClusterVms() {
    return (lastClusterData && Array.isArray(lastClusterData.vms)) ? lastClusterData.vms : [];
}

async function loadClusterVmsForSettings(options) {
    const silent = options && options.silent === true;
    if (!getAuthHeadersForType('proxmox')) return;
    const btn = document.getElementById('loadClusterVmsBtn');
    if (btn && !silent) { btn.disabled = true; setText('loadClusterVmsBtnText', t('loading') || 'Загрузка…'); }
    try {
        const headers = getCurrentProxmoxHeaders();
        if (!headers) {
            if (!silent) showToast(t('errorNoToken') || t('tokenRequired'), 'error');
            return;
        }
        const res = await fetch('/api/cluster/full', { headers });
        const data = await res.json();
        if (res.ok && data && Array.isArray(data.vms)) {
            lastClusterData = data;
            renderSettingsMonitoredVms();
            renderMonitorVmsList();
            renderClusterDashboardTiles().catch(() => {});
            if (!silent) showToast(t('dataUpdated') || 'Список обновлён', 'success');
        } else {
            if (!silent) showToast(data?.error || (t('connectError') || 'Ошибка загрузки'), 'error');
        }
    } catch (e) {
        if (!silent) showToast((t('connectError') || 'Ошибка') + ': ' + e.message, 'error');
    }
    if (btn) { btn.disabled = false; setText('loadClusterVmsBtnText', t('loadClusterVmsBtnText')); }
}

/** Добавить VM/CT в монитор по введённому ID или имени */
function addVmToMonitorByIdOrName() {
    const input = document.getElementById('settingsVmIdOrNameInput');
    if (!input) return;
    const raw = (input.value || '').trim();
    if (!raw) {
        showToast(t('settingsVmEnterIdOrName') || 'Введите ID или имя VM/CT', 'warning');
        return;
    }
    let vms = getClusterVms();
    if (!vms.length) {
        showToast(t('settingsVmRefreshListFirst') || 'Сначала нажмите «Обновить список VM/CT»', 'warning');
        return;
    }
    const asNum = parseInt(raw, 10);
    const isNumeric = String(asNum) === raw && !Number.isNaN(asNum);
    const matched = vms.filter(vm => {
        if (isNumeric && vm.vmid != null) return Number(vm.vmid) === asNum;
        const name = (vm.name || '').toLowerCase();
        return name === raw.toLowerCase() || name.includes(raw.toLowerCase());
    });
    if (matched.length === 0) {
        showToast(t('settingsVmNotFound') || 'Не найдено. Проверьте ID/имя или обновите список.', 'warning');
        return;
    }
    matched.forEach(vm => {
        if (vm.vmid == null) return;
        const nid = Number(vm.vmid);
        if (!monitoredVmIds.includes(nid)) monitoredVmIds = [...monitoredVmIds, nid];
        monitorHiddenVmIds = monitorHiddenVmIds.filter(x => x !== nid);
    });
    saveSettingsToServer({ monitorVms: monitoredVmIds, monitorHiddenVmIds });
    renderSettingsMonitoredVms();
    renderMonitorVmsList();
    renderClusterDashboardTiles().catch(() => {});
    input.value = '';
    showToast(matched.length === 1
        ? (t('settingsVmAdded') || 'Добавлено в монитор')
        : (t('settingsVmAddedCount') || 'Добавлено в монитор').replace('{n}', matched.length),
        'success');
}

function getVmStatusBadgeClass(status) {
    const s = (status || '').toLowerCase();
    if (s === 'running') return 'bg-success';
    if (s === 'stopped') return 'bg-secondary';
    return 'bg-warning text-dark';
}

function getVmStatusLabel(status) {
    const key = 'vmStatus_' + (status || 'unknown').toLowerCase();
    return t(key) || (status || 'unknown');
}

function renderSettingsMonitoredVms() {
    const body = document.getElementById('settingsVmsBody');
    if (!body) return;
    const list = getClusterVms().filter(vm => monitoredVmIds.includes(Number(vm.vmid != null ? vm.vmid : vm.id)));
    const rows = list.map((vm) => {
        const id = vm.vmid != null ? vm.vmid : vm.id != null ? vm.id : 0;
        const showInMonitor = !monitorHiddenVmIds.includes(Number(id));
        const typeLabel = (vm.type || 'vm').toUpperCase();
        const status = vm.status || 'unknown';
        const note = vm.node ? (vm.node + (vm.vmid != null ? ` / ${vm.vmid}` : '')) : (vm.note || '');
        const statusClass = getVmStatusBadgeClass(status);
        const showInMonitorTitle = t('settingsVmShowInMonitor') || 'Показывать в режиме монитора';
        const iconValue = getVmIconName(vm);
        const tintBg = getVmIconTintOrDefault(vm);
        const tintFg = getContrastForegroundForBg(tintBg);
        const pickerTitle = t('iconPickerChoose') || 'Выбрать иконку';
        const clearTitle = t('clear') || 'Сбросить';
        const colorTitle = t('settingsVmIconColorLabel') || 'Цвет иконки';
        const randomColorTitle = t('iconColorRandom') || 'Случайный цвет';
        return `
            <tr>
                <td>
                    <div class="d-flex align-items-center gap-2">
                        ${renderVmIconHtml(vm, 'vm-settings-icon')}
                        <span>${escapeHtml(vm.name || '')}</span>
                    </div>
                </td>
                <td><span class="badge bg-secondary">${escapeHtml(typeLabel)}</span></td>
                <td><span class="badge ${statusClass}">${escapeHtml(getVmStatusLabel(status))}</span></td>
                <td>${note ? `<span class="text-muted small">${escapeHtml(note)}</span>` : '&mdash;'}</td>
                <td style="min-width: 260px;">
                    <div class="icon-setting-control">
                        <button type="button" class="btn btn-sm icon-picker-trigger icon-picker-trigger--tinted" style="background-color:${escapeHtml(tintBg)};color:${escapeHtml(tintFg)};" onclick="openIconPicker('vm', ${id})" title="${escapeHtml(pickerTitle)}">
                            ${renderVmIconHtml(vm, 'vm-settings-icon', tintFg)}
                        </button>
                        <div class="icon-setting-control__meta">
                            <div class="small text-truncate">${iconValue ? escapeHtml(iconValue) : (t('iconPickerNotSelected') || 'Не выбрано')}</div>
                        </div>
                        <input type="color" class="form-control form-control-color icon-color-input" value="${escapeHtml(tintBg)}" title="${escapeHtml(colorTitle)}" onchange="saveVmIconColorSetting(${id}, this.value)">
                        <button type="button" class="btn btn-sm btn-outline-secondary" onclick="applyRandomIconColor('vm', ${id})" title="${escapeHtml(randomColorTitle)}">
                            <i class="bi bi-shuffle"></i>
                        </button>
                        <button type="button" class="btn btn-sm btn-outline-secondary" onclick="saveVmIconSetting(${id}, '')" title="${escapeHtml(clearTitle)}">
                            <i class="bi bi-x-lg"></i>
                        </button>
                    </div>
                </td>
                <td class="text-center align-middle">
                    <input type="checkbox" class="form-check-input" id="monitorVmVisible_${id}" ${showInMonitor ? 'checked' : ''}
                           onchange="toggleMonitorVmVisible(${id})" title="${escapeHtml(showInMonitorTitle)}">
                </td>
                <td class="text-nowrap">
                    <button class="btn btn-sm btn-outline-danger" onclick="removeMonitoredVm(${id})" title="${t('remove') || 'Удалить'}">
                        <i class="bi bi-trash"></i>
                    </button>
                </td>
            </tr>
        `;
    }).join('');
    setHTMLIfChanged('settingsVmsBody', rows || '');
    renderClusterDashboardTilesSettings();
}

function toggleMonitorVmVisible(vmId) {
    const id = Number(vmId);
    if (monitorHiddenVmIds.includes(id)) {
        monitorHiddenVmIds = monitorHiddenVmIds.filter(x => x !== id);
    } else {
        monitorHiddenVmIds = [...monitorHiddenVmIds, id];
    }
    saveSettingsToServer({ monitorHiddenVmIds });
    renderSettingsMonitoredVms();
    renderMonitorVmsList();
}

function saveVmIconSetting(vmId, rawValue) {
    const id = Number(vmId);
    if (Number.isNaN(id)) return;
    const icon = normalizeVmIconName(rawValue);
    const current = normalizeVmIconName(monitorVmIcons[String(id)] || '');
    if (icon === current) return;
    if (icon) monitorVmIcons[String(id)] = icon;
    else delete monitorVmIcons[String(id)];
    saveSettingsToServer({ monitorVmIcons });
    renderSettingsMonitoredVms();
    renderMonitorVmsList();
    renderVmsMonitorCards();
    renderClusterDashboardTiles().catch(() => {});
}

function saveVmIconColorSetting(vmId, rawValue) {
    const id = Number(vmId);
    if (Number.isNaN(id)) return;
    const color = normalizeHexColor(rawValue);
    const current = normalizeHexColor(monitorVmIconColors[String(id)] || '');
    if (color === current) return;
    if (color) monitorVmIconColors[String(id)] = color;
    else delete monitorVmIconColors[String(id)];
    saveSettingsToServer({ monitorVmIconColors });
    renderSettingsMonitoredVms();
    renderMonitorVmsList();
    renderVmsMonitorCards();
    renderClusterDashboardTiles().catch(() => {});
}

function removeMonitoredVm(vmId) {
    const id = Number(vmId);
    monitoredVmIds = monitoredVmIds.filter(x => x !== id);
    monitorHiddenVmIds = monitorHiddenVmIds.filter(x => x !== id);
    delete monitorVmIcons[String(id)];
    delete monitorVmIconColors[String(id)];
    saveSettingsToServer({ monitorVms: monitoredVmIds, monitorHiddenVmIds, monitorVmIcons, monitorVmIconColors });
    renderSettingsMonitoredVms();
    renderMonitorVmsList();
    renderVmsMonitorCards();
    if (lastClusterData) {
        const visible = (lastClusterData.vms || []).filter(vm => monitoredVmIds.includes(Number(vm.vmid)) && !monitorHiddenVmIds.includes(Number(vm.vmid)));
        const wrap = document.getElementById('monitoredVmsDashboardWrap');
        const tbody = document.getElementById('monitoredVmsDashboardBody');
        if (wrap) wrap.style.display = visible.length ? 'block' : 'none';
        if (tbody && visible.length) {
            tbody.innerHTML = visible.map(vm => {
                const typeLabel = (vm.type || 'vm').toUpperCase();
                const status = vm.status || 'unknown';
                const statusClass = getVmStatusBadgeClass(status);
                return `<tr><td>${escapeHtml(vm.name || '')}</td><td><span class="badge bg-secondary">${escapeHtml(typeLabel)}</span></td><td><span class="badge ${statusClass}">${escapeHtml(getVmStatusLabel(status))}</span></td><td class="text-muted small">${escapeHtml(vm.node || '')}</td></tr>`;
            }).join('');
        }
    }
}

async function checkService(index) {
    const list = Array.isArray(monitoredServices) ? monitoredServices : [];
    const svc = list[index];
    if (!svc) return;
    try {
        const resp = await fetch('/api/health/check', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ targets: [buildServiceTargetForApi(svc)] })
        });
        const data = await resp.json();
        const r = data.results && data.results[0];
        if (r) {
            svc.lastStatus = r.up ? 'up' : 'down';
            svc.lastLatency = r.latency ?? null;
            try {
                await fetch(`/api/settings/services/${svc.id}`, {
                    method: 'PATCH',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ lastStatus: svc.lastStatus, lastLatency: svc.lastLatency })
                });
            } catch (_) {}
        }
        renderMonitoredServices();
        renderSettingsMonitoredServices();
    } catch (e) {
        showToast(t('connectError') + ': ' + e.message, 'error');
    }
}

async function checkAllServices() {
    const list = Array.isArray(monitoredServices) ? monitoredServices : [];
    if (!list.length) return;
    try {
        const targets = list.map(buildServiceTargetForApi);
        const resp = await fetch('/api/health/check', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ targets })
        });
        const data = await resp.json();
        const results = data.results || [];
        results.forEach((r, i) => {
            if (!list[i]) return;
            list[i].lastStatus = r.up ? 'up' : 'down';
            list[i].lastLatency = r.latency ?? null;
        });
        await Promise.all(list.map((s) =>
            fetch(`/api/settings/services/${s.id}`, {
                method: 'PATCH',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ lastStatus: s.lastStatus, lastLatency: s.lastLatency })
            }).catch(() => {})
        ));
        renderMonitoredServices();
    } catch (e) {
        showToast(t('connectError') + ': ' + e.message, 'error');
    }
}

async function exportServicesOnly() {
    try {
        const resp = await fetch('/api/settings/export/services');
        if (!resp.ok) {
            const data = await resp.json().catch(() => ({}));
            throw new Error(data.error || `HTTP ${resp.status}`);
        }
        const json = await resp.json();
        const only = {
            services: json.services || [],
            monitor_service_icons: normalizeMonitorServiceIconsMap(json.monitor_service_icons),
            monitor_service_icon_colors: normalizeMonitorServiceIconColorsMap(json.monitor_service_icon_colors)
        };
        const blob = new Blob([JSON.stringify(only, null, 2)], { type: 'application/json' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = 'homelab-monitor-services' + new Date().toISOString().slice(0, 19).replace(/:/g, '-') + '.json';
        document.body.appendChild(a);
        a.click();
        a.remove();
        URL.revokeObjectURL(url);
    } catch (e) {
        showToast((t('settingsImportError') || t('errorUpdate')) + ': ' + e.message, 'error');
    }
}

function triggerImportServices() {
    const input = document.getElementById('servicesImportFile');
    if (input) input.click();
}

async function handleImportServicesFile(event) {
    const file = event.target.files && event.target.files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = async (e) => {
        let parsed;
        try {
            parsed = JSON.parse(String(e.target.result || ''));
        } catch {
            showToast(t('settingsImportError') || 'Неверный файл импорта', 'error');
            return;
        }
        try {
            const body = {};
            if (Array.isArray(parsed.services)) body.services = parsed.services;
            else if (Array.isArray(parsed)) body.services = parsed;
            if (parsed.monitor_service_icons && typeof parsed.monitor_service_icons === 'object' && !Array.isArray(parsed.monitor_service_icons)) {
                body.monitor_service_icons = normalizeMonitorServiceIconsMap(parsed.monitor_service_icons);
            }
            if (parsed.monitor_service_icon_colors && typeof parsed.monitor_service_icon_colors === 'object' && !Array.isArray(parsed.monitor_service_icon_colors)) {
                body.monitor_service_icon_colors = normalizeMonitorServiceIconColorsMap(parsed.monitor_service_icon_colors);
            }
            const resp = await fetch('/api/settings/import/services', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(body)
            });
            const data = await resp.json().catch(() => ({}));
            if (!resp.ok || data.success === false) {
                throw new Error(data.error || `HTTP ${resp.status}`);
            }
            showToast(t('settingsImportSuccess') || 'Настройки импортированы, данные обновлены', 'success');
            const settingsData = await fetch('/api/settings').then(r => r.json()).catch(() => ({}));
            const servicesData = await fetch('/api/settings/services').then(r => r.json()).catch(() => ({ services: [] }));
            monitoredServices = Array.isArray(servicesData.services) ? servicesData.services : [];
            monitorServiceIcons = normalizeMonitorServiceIconsMap(settingsData.monitor_service_icons);
            monitorServiceIconColors = normalizeMonitorServiceIconColorsMap(settingsData.monitor_service_icon_colors);
            renderMonitoredServices();
            renderSettingsMonitoredServices();
            renderMonitorServicesList();
        } catch (err) {
            showToast((t('settingsImportError') || t('errorUpdate')) + ': ' + err.message, 'error');
        } finally {
            event.target.value = '';
        }
    };
    reader.readAsText(file, 'utf-8');
}

async function exportVmsOnly() {
    try {
        const resp = await fetch('/api/settings/export/vms');
        if (!resp.ok) {
            const data = await resp.json().catch(() => ({}));
            throw new Error(data.error || `HTTP ${resp.status}`);
        }
        const json = await resp.json();
        const only = {
            monitor_vms: Array.isArray(json.monitor_vms) ? json.monitor_vms : [],
            monitor_hidden_vm_ids: Array.isArray(json.monitor_hidden_vm_ids) ? json.monitor_hidden_vm_ids : [],
            monitor_vm_icons: normalizeMonitorVmIconsMap(json.monitor_vm_icons),
            monitor_vm_icon_colors: normalizeMonitorVmIconColorsMap(json.monitor_vm_icon_colors)
        };
        const blob = new Blob([JSON.stringify(only, null, 2)], { type: 'application/json' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = 'homelab-monitor-vms-' + new Date().toISOString().slice(0, 19).replace(/:/g, '-') + '.json';
        document.body.appendChild(a);
        a.click();
        a.remove();
        URL.revokeObjectURL(url);
    } catch (e) {
        showToast((t('settingsImportError') || t('errorUpdate')) + ': ' + e.message, 'error');
    }
}

function triggerImportVms() {
    const input = document.getElementById('vmsImportFile');
    if (input) input.click();
}

async function handleImportVmsFile(event) {
    const file = event.target.files && event.target.files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = async (e) => {
        let parsed;
        try {
            parsed = JSON.parse(String(e.target.result || ''));
        } catch {
            showToast(t('settingsImportError') || 'Неверный файл импорта', 'error');
            return;
        }
        const body = {};
        if (Array.isArray(parsed.monitor_vms)) body.monitor_vms = parsed.monitor_vms;
        if (Array.isArray(parsed.monitor_hidden_vm_ids)) body.monitor_hidden_vm_ids = parsed.monitor_hidden_vm_ids;
        if (parsed.monitor_vm_icons && typeof parsed.monitor_vm_icons === 'object' && !Array.isArray(parsed.monitor_vm_icons)) {
            body.monitor_vm_icons = normalizeMonitorVmIconsMap(parsed.monitor_vm_icons);
        }
        if (parsed.monitor_vm_icon_colors && typeof parsed.monitor_vm_icon_colors === 'object' && !Array.isArray(parsed.monitor_vm_icon_colors)) {
            body.monitor_vm_icon_colors = normalizeMonitorVmIconColorsMap(parsed.monitor_vm_icon_colors);
        }
        if (!body.monitor_vms && !body.monitor_hidden_vm_ids && !body.monitor_vm_icons && !body.monitor_vm_icon_colors) {
            showToast(t('settingsImportError') || 'В файле нет monitor_vms, monitor_hidden_vm_ids, monitor_vm_icons или monitor_vm_icon_colors', 'error');
            event.target.value = '';
            return;
        }
        try {
            const resp = await fetch('/api/settings/import/vms', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(body)
            });
            const data = await resp.json().catch(() => ({}));
            if (!resp.ok || data.success === false) {
                throw new Error(data.error || `HTTP ${resp.status}`);
            }
            showToast(t('settingsImportSuccess') || 'Настройки импортированы', 'success');
            await loadSettings();
            renderSettingsMonitoredVms();
            renderMonitorVmsList();
            renderVmsMonitorCards();
        } catch (err) {
            showToast((t('settingsImportError') || t('errorUpdate')) + ': ' + err.message, 'error');
        } finally {
            event.target.value = '';
        }
    };
    reader.readAsText(file, 'utf-8');
}

async function exportAllConfig() {
    try {
        const resp = await fetch('/api/settings/export/all');
        if (!resp.ok) {
            const data = await resp.json().catch(() => ({}));
            throw new Error(data.error || `HTTP ${resp.status}`);
        }
        const json = await resp.json();
        const blob = new Blob([JSON.stringify(json, null, 2)], { type: 'application/json' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = 'homelab-monitor-config-' + new Date().toISOString().slice(0, 19).replace(/:/g, '-') + '.json';
        document.body.appendChild(a);
        a.click();
        a.remove();
        URL.revokeObjectURL(url);
    } catch (e) {
        showToast((t('settingsImportError') || t('errorUpdate')) + ': ' + e.message, 'error');
    }
}

function triggerImportAllConfig() {
    const input = document.getElementById('allConfigImportFile');
    if (input) input.click();
}

async function importAllConfigFromParsedJson(parsed) {
    const resp = await fetch('/api/settings/import/all', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(parsed)
    });
    const data = await resp.json().catch(() => ({}));
    if (!resp.ok || data.success === false) {
        throw new Error(data.error || `HTTP ${resp.status}`);
    }
    await loadSettings();
    renderMonitoredServices();
    renderSettingsMonitoredServices();
    renderSettingsMonitoredVms();
    renderMonitorVmsList();
}

async function handleImportAllConfigFile(event) {
    const file = event.target.files && event.target.files[0];
    if (!file) return;
    let parsed;
    try {
        parsed = JSON.parse(await file.text());
    } catch {
        showToast(t('settingsImportError') || 'Неверный файл импорта', 'error');
        event.target.value = '';
        return;
    }
    try {
        await importAllConfigFromParsedJson(parsed);
        showToast(t('settingsImportSuccess') || 'Настройки импортированы, данные обновлены', 'success');
    } catch (err) {
        showToast((t('settingsImportError') || t('errorUpdate')) + ': ' + err.message, 'error');
    } finally {
        event.target.value = '';
    }
}

async function addMonitoredService() {
    const nameInput = document.getElementById('settingsServiceNameInput');
    const typeSelect = document.getElementById('settingsServiceTypeSelect');
    const hostInput = document.getElementById('settingsServiceHostInput');
    const portInput = document.getElementById('settingsServicePortInput');
    const urlInput = document.getElementById('settingsServiceUrlInput');
    if (!typeSelect) return;
    const type = (typeSelect.value || 'tcp').toLowerCase();
    const name = nameInput ? nameInput.value.trim() : '';
    let body = { name, type: type === 'https' ? 'https' : (type === 'http' ? 'http' : type) };
    if (type === 'http' || type === 'https') {
        const url = urlInput ? urlInput.value.trim() : '';
        if (!url) {
            showToast(t('serviceUrlRequired') || 'Укажите URL', 'error');
            return;
        }
        body.url = url;
    } else if (type === 'snmp' || type === 'nut') {
        const url = urlInput ? urlInput.value.trim() : '';
        const host = hostInput ? hostInput.value.trim() : '';
        const port = portInput ? parseInt(portInput.value, 10) : null;
        if (!url) {
            showToast((t('serviceUrlRequired') || 'Укажите параметры') + '', 'error');
            return;
        }
        if (!host || !port || port < 1 || port > 65535) {
            showToast(t('serviceHostPortRequired') || 'Укажите хост и порт (1–65535)', 'error');
            return;
        }
        body.url = url;
        body.host = host;
        body.port = port;
    } else {
        const host = hostInput ? hostInput.value.trim() : '';
        const port = portInput ? parseInt(portInput.value, 10) : null;
        if (!host || !port || port < 1 || port > 65535) {
            showToast(t('serviceHostPortRequired') || 'Укажите хост и порт (1–65535)', 'error');
            return;
        }
        body.host = host;
        body.port = port;
    }
    try {
        const resp = await fetch('/api/settings/services', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(body)
        });
        const data = await resp.json();
        if (!resp.ok) {
            showToast(data.error || 'Error', 'error');
            return;
        }
        const list = (await fetch('/api/settings/services').then(r => r.json())).services || [];
        monitoredServices = list;
        if (nameInput) nameInput.value = '';
        if (urlInput) urlInput.value = '';
        if (hostInput) hostInput.value = '';
        if (portInput) portInput.value = '';
        renderMonitoredServices();
        renderSettingsMonitoredServices();
        renderClusterDashboardTiles().catch(() => {});
        showToast(t('dataUpdated'), 'success');
    } catch (e) {
        showToast(t('connectError') + ': ' + e.message, 'error');
    }
}

async function removeMonitoredService(id) {
    try {
        const resp = await fetch(`/api/settings/services/${id}`, { method: 'DELETE' });
        if (!resp.ok) {
            const data = await resp.json().catch(() => ({}));
            showToast(data.error || 'Error', 'error');
            return;
        }
        monitoredServices = monitoredServices.filter(s => s.id !== id);
        monitorHiddenServiceIds = monitorHiddenServiceIds.filter(x => x !== Number(id));
        delete monitorServiceIcons[String(id)];
        delete monitorServiceIconColors[String(id)];
        saveSettingsToServer({ monitorHiddenServiceIds: monitorHiddenServiceIds, monitorServiceIcons, monitorServiceIconColors });
        renderMonitoredServices();
        renderSettingsMonitoredServices();
        renderMonitorServicesList();
        renderClusterDashboardTiles().catch(() => {});
    } catch (e) {
        showToast(t('connectError') + ': ' + e.message, 'error');
    }
}

function updateSettingsSecurityUI() {
    const hasPassword = isSettingsPasswordEnabled();
    const applyText = hasPassword ? t('settingsPasswordChange') : t('settingsPasswordEnable');
    setText('settingsPasswordApplyText', applyText);
    setText('settingsPasswordDisableText', t('settingsPasswordDisable'));
    const disableBtn = el('settingsPasswordDisableBtn');
    if (disableBtn) disableBtn.disabled = !hasPassword;
}

async function applySettingsPassword() {
    const currentEl = el('settingsPasswordCurrent');
    const newEl = el('settingsPasswordNew');
    const repeatEl = el('settingsPasswordRepeat');
    const current = currentEl ? currentEl.value : '';
    const next = newEl ? newEl.value : '';
    const repeat = repeatEl ? repeatEl.value : '';
    if (!next) {
        showToast(t('settingsPasswordEmptyNew') || 'Введите новый пароль', 'error');
        return;
    }
    if (next !== repeat) {
        showToast(t('settingsPasswordMismatch') || 'Пароли не совпадают', 'error');
        return;
    }
    try {
        const resp = await fetch('/api/settings/password', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ currentPassword: current || undefined, newPassword: next })
        });
        const data = await resp.json();
        if (!data.success) {
            if (data.error === 'wrong_current') {
                showToast(t('settingsPasswordWrongCurrent') || 'Неверный текущий пароль', 'error');
            } else {
                showToast(data.error || t('settingsPasswordWrongCurrent'), 'error');
            }
            return;
        }
        settingsPasswordRequired = true;
        settingsUnlocked = true;
        persistSettingsSession();
        if (currentEl) currentEl.value = '';
        if (newEl) newEl.value = '';
        if (repeatEl) repeatEl.value = '';
        updateSettingsSecurityUI();
        showToast((isSettingsPasswordEnabled() ? t('settingsPasswordChanged') : t('settingsPasswordEnabled')) || 'Пароль для настроек сохранён', 'success');
    } catch (e) {
        showToast(t('connectError') + ': ' + e.message, 'error');
    }
}

async function disableSettingsPassword() {
    const currentEl = el('settingsPasswordCurrent');
    const current = currentEl ? currentEl.value : '';
    if (!settingsPasswordRequired) {
        showToast(t('settingsPasswordNotSet') || 'Пароль не задан', 'info');
        return;
    }
    try {
        const resp = await fetch('/api/settings/password', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ currentPassword: current, newPassword: '' })
        });
        const data = await resp.json();
        if (!data.success) {
            if (data.error === 'wrong_current') {
                showToast(t('settingsPasswordWrongCurrent') || 'Неверный текущий пароль', 'error');
            } else {
                showToast(data.error || 'Error', 'error');
            }
            return;
        }
        settingsPasswordRequired = false;
        settingsUnlocked = true;
        persistSettingsSession();
        if (currentEl) currentEl.value = '';
        const newEl = el('settingsPasswordNew');
        const repeatEl = el('settingsPasswordRepeat');
        if (newEl) newEl.value = '';
        if (repeatEl) repeatEl.value = '';
        updateSettingsSecurityUI();
        showToast(t('settingsPasswordDisabled') || 'Пароль для настроек отключён', 'success');
    } catch (e) {
        showToast(t('connectError') + ': ' + e.message, 'error');
    }
}

function logoutSettings() {
    clearSettingsSession();
    showToast(t('settingsLogoutDone') || 'Сессия настроек завершена', 'info');
    showDashboard();
}

// ==================== NEW SETTINGS FUNCTIONS ====================

// Load settings from API (database)
async function loadSettings() {
    let data = {};
    let servicesData = { services: [] };
    try {
        const [settingsRes, servicesRes] = await Promise.all([
            fetch('/api/settings'),
            fetch('/api/settings/services')
        ]);
        if (settingsRes.ok) data = await settingsRes.json();
        if (servicesRes.ok) servicesData = await servicesRes.json();
    } catch (e) {
        console.error('Failed to load settings:', e);
    }

    settingsPasswordRequired = !!data.password_required;
    setupCompleted = data.setup_completed !== false;
    settingsSessionTtlMinutes = parseInt(data.session_ttl_minutes, 10) || 30;
    try {
        const expiry = sessionStorage.getItem(SETTINGS_UNLOCK_EXPIRY_KEY);
        if (expiry && Date.now() < parseInt(expiry, 10)) {
            settingsUnlocked = true;
        }
    } catch (_) {}

    if (data.refresh_interval != null) {
        refreshIntervalMs = parseInt(data.refresh_interval, 10) || 30000;
        const sel = document.getElementById('refreshIntervalSelect');
        if (sel) sel.value = refreshIntervalMs;
    }
    if (data.theme) {
        currentTheme = data.theme;
        applyTheme(currentTheme);
    }
    if (data.units) {
        currentUnits = data.units;
        updateUnitsButtons();
    }
    if (data.thresholds && typeof data.thresholds === 'object') {
        thresholds = normalizeThresholds(data.thresholds);
        const g = document.getElementById('cpuGreenThreshold');
        const y = document.getElementById('cpuYellowThreshold');
        const cr = document.getElementById('cpuRedThreshold');
        const rg = document.getElementById('ramGreenThreshold');
        const ry = document.getElementById('ramYellowThreshold');
        const rr = document.getElementById('ramRedThreshold');
        if (g) g.value = String(thresholds.cpuGreen);
        if (y) y.value = String(thresholds.cpuYellow);
        if (cr) cr.value = String(thresholds.cpuRed);
        if (rg) rg.value = String(thresholds.ramGreen);
        if (ry) ry.value = String(thresholds.ramYellow);
        if (rr) rr.value = String(thresholds.ramRed);
    }
    if (Object.prototype.hasOwnProperty.call(data, 'proxmox_servers')) {
        proxmoxServers = Array.isArray(data.proxmox_servers)
            ? data.proxmox_servers.map((u) => normalizeUrlClient(u))
            : [];
    }
    if (Object.prototype.hasOwnProperty.call(data, 'truenas_servers')) {
        truenasServers = Array.isArray(data.truenas_servers)
            ? data.truenas_servers.map((u) => normalizeUrlClient(u))
            : [];
    }
    if (data.connection_id_map && typeof data.connection_id_map === 'object') {
        connectionIdMap = {};
        for (const [k, id] of Object.entries(data.connection_id_map)) {
            const parts = String(k).split('|');
            if (parts.length >= 2) {
                const type = parts[0];
                const url = parts.slice(1).join('|');
                connectionIdMap[connectionKey(type, url)] = id;
            } else {
                connectionIdMap[k] = id;
            }
        }
    }
    monitoredServices = Array.isArray(servicesData.services) ? servicesData.services : [];
    monitorServiceIcons = normalizeMonitorServiceIconsMap(data.monitor_service_icons);
    monitorServiceIconColors = normalizeMonitorServiceIconColorsMap(data.monitor_service_icon_colors);
    monitoredVmIds = [];
    if (Array.isArray(data.monitor_vms) && data.monitor_vms.length) {
        data.monitor_vms.forEach(x => {
            const id = typeof x === 'number' ? x : (x && (x.vmid ?? x.id));
            if (id != null) monitoredVmIds.push(Number(id));
        });
    }
    clusterDashboardTilesSettingPresent = Object.prototype.hasOwnProperty.call(data, 'cluster_dashboard_tiles');
    clusterDashboardTiles = normalizeClusterDashboardTiles(data.cluster_dashboard_tiles);
    clusterDashboardTilesDirty = false;
    savedTileViews = normalizeSavedTileViews(data.saved_tile_views);
    dashboardWeatherCity = normalizeDashboardWeatherCity(data.dashboard_weather_city);
    dashboardWeatherProvider = normalizeDashboardWeatherProvider(data.dashboard_weather_provider);
    weatherOpenweathermapApiKeySet = !!data.weather_openweathermap_api_key_set;
    weatherYandexApiKeySet = !!data.weather_yandex_api_key_set;
    weatherGismeteoApiKeySet = !!data.weather_gismeteo_api_key_set;
    dashboardTimezone = normalizeDashboardTimezone(data.dashboard_timezone);
    dashboardShowTime = parseBoolSettingClient(data.dashboard_show_time, true);
    dashboardShowWeather = parseBoolSettingClient(data.dashboard_show_weather, true);
    monitorShowTime = parseBoolSettingClient(data.monitor_show_time, true);
    monitorShowWeather = parseBoolSettingClient(data.monitor_show_weather, true);
    monitorDisableChromeGestures = parseBoolSettingClient(data.monitor_disable_chrome_gestures, true);
    if (data.monitor_tiles_chart_axis_time !== undefined
        || data.monitor_tiles_chart_axis_values !== undefined
        || data.monitor_tiles_chart_axis_y_unit !== undefined) {
        monitorTilesChartAxisTime = parseBoolSettingClient(data.monitor_tiles_chart_axis_time, true);
        monitorTilesChartAxisValues = parseBoolSettingClient(data.monitor_tiles_chart_axis_values, true);
        monitorTilesChartAxisYUnit = parseBoolSettingClient(data.monitor_tiles_chart_axis_y_unit, true);
    } else {
        const leg = parseBoolSettingClient(data.monitor_tiles_chart_axis_labels, true);
        monitorTilesChartAxisTime = leg;
        monitorTilesChartAxisValues = leg;
        monitorTilesChartAxisYUnit = leg;
    }
    metricsHistoryRetentionHoursCluster = Math.max(24, Math.min(24 * 30, parseInt(data.metrics_history_retention_hours_cluster ?? data.metrics_history_retention_hours, 10) || 72));
    metricsHistoryRetentionHoursHost = Math.max(24, Math.min(24 * 30, parseInt(data.metrics_history_retention_hours_host ?? data.metrics_history_retention_hours, 10) || 72));
    metricsHistoryRetentionHoursUps = Math.max(24, Math.min(24 * 30, parseInt(data.metrics_history_retention_hours_ups ?? data.metrics_history_retention_hours, 10) || 72));
    metricsHistoryRetentionHoursSmart = Math.max(24, Math.min(24 * 30, parseInt(data.metrics_history_retention_hours_smart ?? data.metrics_history_retention_hours, 10) || 72));
    chartWindowClusterMetricMin = normalizeChartWindowMinutes(data.chart_window_cluster_metric_min, 1440);
    chartWindowHostMetricMin = normalizeChartWindowMinutes(data.chart_window_host_metric_min, 1440);
    chartWindowUpsMetricMin = normalizeChartWindowMinutes(data.chart_window_ups_metric_min, 1440);
    chartWindowSmartSensorMetricMin = normalizeChartWindowMinutes(data.chart_window_smart_sensor_metric_min, 1440);
    tilesChartDisplayVariant = ['area', 'line', 'minimal'].includes(String(data.tiles_chart_display_variant || '').toLowerCase())
        ? String(data.tiles_chart_display_variant).toLowerCase()
        : 'area';
    monitorHotkeys = normalizeMonitorHotkeys(data.monitor_hotkeys);
    setValue('settingsDashboardWeatherCityInput', dashboardWeatherCity);
    setValue('settingsDashboardTimezoneInput', dashboardTimezone);
    const pSel = el('settingsDashboardWeatherProviderSelect');
    if (pSel) pSel.value = dashboardWeatherProvider;
    onDashboardWeatherProviderChange();
    const cDashT = el('settingsDashboardShowTimeCheckbox');
    if (cDashT) cDashT.checked = dashboardShowTime;
    const cDashW = el('settingsDashboardShowWeatherCheckbox');
    if (cDashW) cDashW.checked = dashboardShowWeather;
    const cMonT = el('settingsMonitorShowTimeCheckbox');
    if (cMonT) cMonT.checked = monitorShowTime;
    const cMonW = el('settingsMonitorShowWeatherCheckbox');
    if (cMonW) cMonW.checked = monitorShowWeather;
    const cMonChrome = el('settingsMonitorDisableChromeGesturesCheckbox');
    if (cMonChrome) cMonChrome.checked = monitorDisableChromeGestures;
    const cTilesAxisT = el('settingsMonitorTilesChartAxisTimeCheckbox');
    const cTilesAxisV = el('settingsMonitorTilesChartAxisValuesCheckbox');
    const cTilesAxisU = el('settingsMonitorTilesChartAxisYUnitCheckbox');
    if (cTilesAxisT) cTilesAxisT.checked = monitorTilesChartAxisTime;
    if (cTilesAxisV) cTilesAxisV.checked = monitorTilesChartAxisValues;
    if (cTilesAxisU) cTilesAxisU.checked = monitorTilesChartAxisYUnit;
    const retentionClusterEl = el('settingsRetentionClusterSelect');
    const retentionHostEl = el('settingsRetentionHostSelect');
    const retentionUpsEl = el('settingsRetentionUpsSelect');
    const retentionSmartEl = el('settingsRetentionSmartSelect');
    const cwClusterEl = el('settingsChartWindowClusterMetricSelect');
    const cwHostEl = el('settingsChartWindowHostMetricSelect');
    const cwUpsEl = el('settingsChartWindowUpsMetricSelect');
    const cwSmartEl = el('settingsChartWindowSmartSensorMetricSelect');
    const tilesVariantEl = el('settingsTilesChartDisplayVariantSelect');
    if (retentionClusterEl) retentionClusterEl.value = String(metricsHistoryRetentionHoursCluster);
    if (retentionHostEl) retentionHostEl.value = String(metricsHistoryRetentionHoursHost);
    if (retentionUpsEl) retentionUpsEl.value = String(metricsHistoryRetentionHoursUps);
    if (retentionSmartEl) retentionSmartEl.value = String(metricsHistoryRetentionHoursSmart);
    if (cwClusterEl) cwClusterEl.value = String(chartWindowClusterMetricMin);
    if (cwHostEl) cwHostEl.value = String(chartWindowHostMetricMin);
    if (cwUpsEl) cwUpsEl.value = String(chartWindowUpsMetricMin);
    if (cwSmartEl) cwSmartEl.value = String(chartWindowSmartSensorMetricMin);
    if (tilesVariantEl) tilesVariantEl.value = tilesChartDisplayVariant;
    renderMonitorHotkeysSettingsUI();
    monitorVmIcons = normalizeMonitorVmIconsMap(data.monitor_vm_icons);
    monitorVmIconColors = normalizeMonitorVmIconColorsMap(data.monitor_vm_icon_colors);
    if (data.current_server_index != null) currentServerIndex = parseInt(data.current_server_index, 10) || 0;
    if (data.current_truenas_index != null) currentTrueNASServerIndex = parseInt(data.current_truenas_index, 10) || 0;
    if (proxmoxServers.length) {
        currentServerIndex = Math.max(0, Math.min(currentServerIndex, proxmoxServers.length - 1));
    }
    if (truenasServers.length) {
        currentTrueNASServerIndex = Math.max(0, Math.min(currentTrueNASServerIndex, truenasServers.length - 1));
    }
    if (data.monitor_theme === 'light' || data.monitor_theme === 'dark') monitorTheme = data.monitor_theme;
    if (data.custom_theme_style_settings !== undefined) {
        customThemeStyleSettings = data.custom_theme_style_settings;
        applyCustomThemeStyleSettings();
    } else if (data.custom_theme_css) {
        customThemeCss = normalizeCustomThemeCssInput(data.custom_theme_css);
        applyCustomThemeCss();
    }
    syncCustomThemeCssEditorUI();
    monitorHiddenServiceIds = Array.isArray(data.monitor_hidden_service_ids) ? data.monitor_hidden_service_ids : [];
    monitorHiddenVmIds = Array.isArray(data.monitor_hidden_vm_ids) ? data.monitor_hidden_vm_ids : [];
    monitorScreensOrder = Array.isArray(data.monitor_screens_order) && data.monitor_screens_order.length
        ? normalizeMonitorScreensOrder(data.monitor_screens_order)
        : MONITOR_SCREEN_IDS_ALL.slice();
    monitorScreensEnabled = normalizeMonitorScreensEnabled(data.monitor_screens_enabled);
    monitorDefaultScreen = normalizeMonitorDefaultScreenFromServer(data.monitor_default_screen);
    savedViews = normalizeSavedViews(data.saved_views);
    speedtestClientEnabled = !!(data.speedtest_enabled === true || data.speedtest_enabled === '1'
        || data.speedtest_enabled === 1 || data.speedtest_enabled === 'true');
    speedtestEngine = String(data.speedtest_engine || '').trim().toLowerCase() === 'librespeed'
        ? 'librespeed'
        : 'ookla';
    const spEn = document.getElementById('speedtestEnabledSelect');
    if (spEn) spEn.value = speedtestClientEnabled ? '1' : '0';
    const spEngine = document.getElementById('speedtestEngineSelect');
    if (spEngine) spEngine.value = speedtestEngine;
    const spSrv = document.getElementById('speedtestServerInput');
    if (spSrv) spSrv.value = data.speedtest_server != null ? String(data.speedtest_server) : '';
    const spLibreSrv = document.getElementById('speedtestLibrespeedServerInput');
    if (spLibreSrv) spLibreSrv.value = data.speedtest_librespeed_server != null ? String(data.speedtest_librespeed_server) : '';
    const spDay = document.getElementById('speedtestPerDayInput');
    if (spDay) {
        let n = parseInt(data.speedtest_per_day, 10);
        if (!Number.isFinite(n) || n < 1) n = 4;
        if (n > 6) n = 6;
        spDay.value = String(n);
    }
    const spProvDl = document.getElementById('speedtestProviderDownloadMbpsInput');
    if (spProvDl) {
        const v = data.speedtest_provider_download_mbps;
        spProvDl.value = v != null && v !== '' && Number.isFinite(Number(v)) ? String(v) : '';
    }
    const spProvUl = document.getElementById('speedtestProviderUploadMbpsInput');
    if (spProvUl) {
        const v = data.speedtest_provider_upload_mbps;
        spProvUl.value = v != null && v !== '' && Number.isFinite(Number(v)) ? String(v) : '';
    }
    const spHttpPx = document.getElementById('speedtestHttpProxyInput');
    if (spHttpPx) spHttpPx.value = data.speedtest_http_proxy != null ? String(data.speedtest_http_proxy) : '';
    const spHttpsPx = document.getElementById('speedtestHttpsProxyInput');
    if (spHttpsPx) spHttpsPx.value = data.speedtest_https_proxy != null ? String(data.speedtest_https_proxy) : '';
    const spNoPx = document.getElementById('speedtestNoProxyInput');
    if (spNoPx) spNoPx.value = data.speedtest_no_proxy != null ? String(data.speedtest_no_proxy) : '';
    updateSpeedtestSettingsEngineUI();
    updateSpeedtestProxySettingsUI(true);
    iperf3ClientEnabled = !!(data.iperf3_enabled === true || data.iperf3_enabled === '1'
        || data.iperf3_enabled === 1 || data.iperf3_enabled === 'true');
    const ipEn = document.getElementById('iperf3EnabledSelect');
    if (ipEn) ipEn.value = iperf3ClientEnabled ? '1' : '0';
    const ipHost = document.getElementById('iperf3HostInput');
    if (ipHost) ipHost.value = data.iperf3_host != null ? String(data.iperf3_host) : '';
    const ipPort = document.getElementById('iperf3PortInput');
    if (ipPort) {
        let p = parseInt(data.iperf3_port, 10);
        if (!Number.isFinite(p) || p < 1 || p > 65535) p = 5201;
        ipPort.value = String(p);
    }
    const ipDur = document.getElementById('iperf3DurationInput');
    if (ipDur) {
        let d = parseInt(data.iperf3_duration_sec, 10);
        if (!Number.isFinite(d) || d < 1) d = 8;
        if (d > 120) d = 120;
        ipDur.value = String(d);
    }
    const ipPar = document.getElementById('iperf3ParallelInput');
    if (ipPar) {
        let n = parseInt(data.iperf3_parallel, 10);
        if (!Number.isFinite(n) || n < 1) n = 1;
        if (n > 32) n = 32;
        ipPar.value = String(n);
    }
    const ipDay = document.getElementById('iperf3PerDayInput');
    if (ipDay) {
        let n = parseInt(data.iperf3_per_day, 10);
        if (!Number.isFinite(n) || n < 1) n = 4;
        if (n > 6) n = 6;
        ipDay.value = String(n);
    }
    const ipProvDl = document.getElementById('iperf3ProviderDownloadMbpsInput');
    if (ipProvDl) {
        const v = data.iperf3_provider_download_mbps;
        ipProvDl.value = v != null && v !== '' && Number.isFinite(Number(v)) ? String(v) : '';
    }
    const ipProvUl = document.getElementById('iperf3ProviderUploadMbpsInput');
    if (ipProvUl) {
        const v = data.iperf3_provider_upload_mbps;
        ipProvUl.value = v != null && v !== '' && Number.isFinite(Number(v)) ? String(v) : '';
    }
    telegramNotificationRules = normalizeTelegramNotificationRules(data.telegram_notification_rules);
    if (!telegramNotificationRules.length && data.telegram_routes) {
        telegramNotificationRules = migrateLegacyTelegramRoutesToRulesClient(normalizeTelegramRoutes(data.telegram_routes));
    }
    telegramBotTokenSet = !!data.telegram_bot_token_set;
    const tgEn = document.getElementById('settingsTelegramNotifyEnabled');
    if (tgEn) tgEn.value = (data.telegram_notify_enabled === true || data.telegram_notify_enabled === '1') ? '1' : '0';
    const tgInt = document.getElementById('settingsTelegramIntervalSec');
    if (tgInt) {
        let n = parseInt(data.telegram_notify_interval_sec, 10);
        if (!Number.isFinite(n) || n < 15) n = 60;
        if (n > 3600) n = 3600;
        tgInt.value = String(n);
    }
    const tgProxy = document.getElementById('settingsTelegramProxyUrlInput');
    if (tgProxy) tgProxy.value = data.telegram_proxy_url != null ? String(data.telegram_proxy_url) : '';
    renderTelegramRulesTable();
    renderSettingsMonitorScreensOrderList();
    renderClusterDashboardTilesSettings();
    const ttlSel = document.getElementById('settingsSessionTtlSelect');
    if (ttlSel) {
        const v = String(settingsSessionTtlMinutes);
        if (ttlSel.querySelector('option[value="' + v + '"]')) ttlSel.value = v;
        else ttlSel.value = '30';
    }
    const wasMonitorActive = monitorMode;
    if (data.monitor_mode === true || data.monitor_mode === 'true') {
        monitorMode = true;
        document.body.classList.add('monitor-mode');
        const monitorBtn = document.getElementById('monitorModeBtn');
        if (monitorBtn) {
            monitorBtn.classList.add('active');
            monitorBtn.classList.remove('btn-outline-secondary');
            monitorBtn.classList.add('btn-primary');
            monitorBtn.innerHTML = '<i class="bi bi-check-lg"></i><span id="monitorModeText">' + t('monitorModeOn') + '</span>';
        }
        if (!wasMonitorActive) {
            monitorCurrentView = resolveMonitorStartupView();
        }
        applyMonitorView(monitorCurrentView);
        applyMonitorTheme();
        initMonitorSwipes();
        initMonitorKeyboardNavigation();
        applyMonitorChromeGestureGuards();
        applyMonitorToolbarHiddenState();
    }
    applyMonitorRootLayoutClass(!!monitorMode);
    applyMonitorViewportPageZoomLock(!!monitorMode);
    startDashboardClockTimer();
    refreshDashboardWeather().catch(() => {});
    // Preferred language select in settings
    const langSelect = document.getElementById('settingsPreferredLanguageSelect');
    if (langSelect && Array.isArray(availableLanguages) && availableLanguages.length) {
        langSelect.innerHTML = availableLanguages.map(code => {
            return `<option value="${code}">${code.toUpperCase()}</option>`;
        }).join('');
        if (data.preferred_language && availableLanguages.includes(data.preferred_language)) {
            langSelect.value = data.preferred_language;
        } else if (serverDefaultLanguage && availableLanguages.includes(serverDefaultLanguage)) {
            langSelect.value = serverDefaultLanguage;
        }
    }
    updateSettingsSecurityUI();
    renderServerList();
    if (!monitorMode) {
        applyStoredDashboardHomeTab();
    }
    syncClusterResourcesCardInteractivity();
    return data;
}

// Update refresh interval
function updateRefreshInterval() {
    const select = document.getElementById('refreshIntervalSelect');
    refreshIntervalMs = parseInt(select.value, 10);
    saveSettingsToServer({ refreshInterval: refreshIntervalMs });
    showToast(t('dataUpdated'), 'success');
    if (apiToken) startAutoRefresh();
}

// Theme toggle function
function toggleTheme() {
    const newTheme = currentTheme === 'dark' ? 'light' : 'dark';
    setTheme(newTheme);
}

// Set theme
function setTheme(theme) {
    currentTheme = theme;
    saveSettingsToServer({ theme });
    applyTheme(theme);
}

// Apply theme
function applyTheme(theme) {
    if (theme === 'dark') {
        document.body.classList.add('dark-mode');
        document.getElementById('themeToggle').innerHTML = '<i class="bi bi-sun-fill"></i>';
    } else {
        document.body.classList.remove('dark-mode');
        document.getElementById('themeToggle').innerHTML = '<i class="bi bi-moon-stars-fill"></i>';
    }
}

// Set units
function setUnits(units) {
    currentUnits = units;
    saveSettingsToServer({ units });
    updateUnitsButtons();
    if (apiToken) refreshData();
}

// Update units buttons
function updateUnitsButtons() {
    const decimalBtn = document.getElementById('unitsDecimal');
    const binaryBtn = document.getElementById('unitsBinary');
    
    if (currentUnits === 'decimal') {
        decimalBtn.classList.add('active');
        binaryBtn.classList.remove('active');
    } else {
        decimalBtn.classList.remove('active');
        binaryBtn.classList.add('active');
    }
}

// Update thresholds
function updateThreshold(type, value) {
    const n = parseInt(value, 10);
    if (!Number.isFinite(n)) return;
    thresholds[type] = n;
    thresholds = normalizeThresholds(thresholds);
    const g = document.getElementById('cpuGreenThreshold');
    const y = document.getElementById('cpuYellowThreshold');
    const cr = document.getElementById('cpuRedThreshold');
    const rg = document.getElementById('ramGreenThreshold');
    const ry = document.getElementById('ramYellowThreshold');
    const rr = document.getElementById('ramRedThreshold');
    if (g) g.value = String(thresholds.cpuGreen);
    if (y) y.value = String(thresholds.cpuYellow);
    if (cr) cr.value = String(thresholds.cpuRed);
    if (rg) rg.value = String(thresholds.ramGreen);
    if (ry) ry.value = String(thresholds.ramYellow);
    if (rr) rr.value = String(thresholds.ramRed);
    saveSettingsToServer({ thresholds: { ...thresholds } });
}

// Reset thresholds
function resetThresholds() {
    thresholds = { ...THRESHOLD_DEFAULTS };
    saveSettingsToServer({ thresholds: { ...thresholds } });
    const g = document.getElementById('cpuGreenThreshold');
    const y = document.getElementById('cpuYellowThreshold');
    const cr = document.getElementById('cpuRedThreshold');
    const rg = document.getElementById('ramGreenThreshold');
    const ry = document.getElementById('ramYellowThreshold');
    const rr = document.getElementById('ramRedThreshold');
    if (g) g.value = String(thresholds.cpuGreen);
    if (y) y.value = String(thresholds.cpuYellow);
    if (cr) cr.value = String(thresholds.cpuRed);
    if (rg) rg.value = String(thresholds.ramGreen);
    if (ry) ry.value = String(thresholds.ramYellow);
    if (rr) rr.value = String(thresholds.ramRed);
    showToast(t('dataUpdated'), 'success');
}

// Format size based on selected units
function formatSize(bytes) {
    if (bytes === null || bytes === undefined) return 'N/A';
    
    if (currentUnits === 'binary') {
        // GiB / TiB (binary)
        const gib = bytes / Math.pow(1024, 3);
        if (gib >= 1024) {
            return (gib / 1024).toFixed(2) + ' ТиБ';
        }
        return gib.toFixed(2) + ' ГиБ';
    } else {
        // GB / TB (decimal)
        const gb = bytes / Math.pow(1000, 3);
        if (gb >= 1000) {
            return (gb / 1000).toFixed(2) + ' ТБ';
        }
        return gb.toFixed(2) + ' ГБ';
    }
}

// Get color class for percentage based on thresholds
function getColorClass(percent, type) {
    const t = normalizeThresholds(thresholds);
    let greenThreshold;
    let yellowThreshold;
    let redThreshold;
    if (type === 'cpu') {
        greenThreshold = t.cpuGreen;
        yellowThreshold = t.cpuYellow;
        redThreshold = t.cpuRed;
    } else {
        greenThreshold = t.ramGreen;
        yellowThreshold = t.ramYellow;
        redThreshold = t.ramRed;
    }
    const p = Number(percent);
    const x = Number.isFinite(p) ? p : 0;
    if (x <= greenThreshold) {
        return 'bg-success';
    }
    if (x <= yellowThreshold) {
        return 'bg-warning';
    }
    if (x <= redThreshold) {
        return 'bg-danger';
    }
    return 'bg-danger';
}

/** Bootstrap progress-bar: цвет по порогам (настройки «Пороговые значения»). */
function setProgressBarThresholdClass(el, percent, type) {
    if (!el) return;
    el.className = 'progress-bar ' + getColorClass(percent, type);
}

/** Полоса CPU/RAM в компактном режиме монитора (кастомные div, не .progress-bar). */
function setMonitorResFillThresholdClass(el, percent, type) {
    if (!el) return;
    const g = getColorClass(percent, type);
    const tier = g === 'bg-warning'
        ? 'monitor-view__res-fill--tier-warning'
        : (g === 'bg-danger' ? 'monitor-view__res-fill--tier-danger' : 'monitor-view__res-fill--tier-success');
    el.className = 'monitor-view__res-fill ' + tier;
}

// ==================== PROXMOX / TRUENAS SERVERS (HomeLab, без переключателя типа) ====================

/** URL считается настроенным, если задан хост (пустой «https://» не считается). */
function isMonitorServerUrlConfigured(url) {
    const u = String(url || '').trim();
    if (!u) return false;
    if (u === 'https://' || u === 'http://') return false;
    try {
        const parsed = new URL(u);
        return parsed.hostname.length > 0;
    } catch {
        return false;
    }
}

function hasProxmoxBackendConfigured() {
    return Array.isArray(proxmoxServers) && proxmoxServers.some(isMonitorServerUrlConfigured);
}

function hasTrueNASBackendConfigured() {
    return Array.isArray(truenasServers) && truenasServers.some(isMonitorServerUrlConfigured);
}

/** Легаси-переключатель Proxmox/TrueNAS убран — скрываем остатки разметки. */
function updateServerTypeBackendChoiceUI() {
    const wrap = document.getElementById('monitorServerTypeSelectWrap');
    if (wrap) wrap.classList.add('d-none');
    document.querySelectorAll('.server-menu-backend-choice').forEach((el) => el.classList.add('d-none'));
}

/** Сброс URL, привязок и токенов в БД только для Proxmox или TrueNAS. */
async function resetBackendSettings(type) {
    const t = String(type || '').toLowerCase();
    if (t !== 'proxmox' && t !== 'truenas') return;
    const confirmKey = t === 'proxmox' ? 'settingsResetBackendConfirmProxmox' : 'settingsResetBackendConfirmTrueNAS';
    if (!confirm(t(confirmKey))) return;
    try {
        const resp = await fetch('/api/settings/reset-backend', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ type: t })
        });
        const data = await resp.json().catch(() => ({}));
        if (!resp.ok || data.success === false) {
            showToast(data.error || t('errorUpdate'), 'error');
            return;
        }
        await loadSettings();
        if (t === 'proxmox') {
            apiToken = null;
            const idEl = document.getElementById('apiTokenId');
            const secretEl = document.getElementById('apiTokenSecret');
            if (idEl) idEl.value = '';
            if (secretEl) secretEl.value = '';
            syncProxmoxApiTokenFromParts();
        }
        const tn = document.getElementById('apiTokenTrueNAS');
        if (t === 'truenas' && tn) tn.value = '';
        syncHomelabChrome();
        updateConnectionStatus(false, 'proxmox');
        updateConnectionStatus(false, 'truenas');
        const lp = document.getElementById('logoutContainerProxmox');
        const lt = document.getElementById('logoutContainerTrueNAS');
        if (lp) lp.style.display = 'none';
        if (lt) lt.style.display = 'none';
        updateCurrentServerBadge();
        showToast(t('dataUpdated'), 'success');
    } catch (e) {
        showToast((t('connectError') || '') + ': ' + e.message, 'error');
    }
}

// Render one server list into a container
function renderOneServerList(containerId, servers, currentIdx, type) {
    const container = document.getElementById(containerId);
    if (!container) return;
    container.innerHTML = '';
    const placeholder = type === 'truenas' ? 'https://truenas.local' : 'https://192.168.1.1:8006';
    servers.forEach((server, index) => {
        const div = document.createElement('div');
        div.className = 'input-group mb-2';
        const isCurrent = index === currentIdx;
        div.innerHTML = `
            <input type="text" class="form-control form-control-sm ${isCurrent ? 'border-success' : ''}"
                   value="${escapeHtml(server)}" data-index="${index}"
                   onchange="updateServerUrlByType('${type}', ${index}, this.value)"
                   placeholder="${placeholder}">
            <button class="btn btn-outline-secondary btn-sm" type="button" onclick="setCurrentServerByType('${type}', ${index})"
                    title="${t('currentServer')}">
                <i class="bi bi-${isCurrent ? 'check-lg' : 'arrow-right'}"></i>
            </button>
            <button class="btn btn-outline-danger btn-sm" type="button" onclick="removeServerByType('${type}', ${index})"
                    title="${t('removeServer')}">
                <i class="bi bi-trash"></i>
            </button>
        `;
        container.appendChild(div);
    });
}

// Render servers list (both Proxmox and TrueNAS blocks)
function renderServerList() {
    renderOneServerList('serverListProxmox', proxmoxServers, currentServerIndex, 'proxmox');
    renderOneServerList('serverListTrueNAS', truenasServers, currentTrueNASServerIndex, 'truenas');
    updateServerTypeBackendChoiceUI();
}

// Add new server by type
function addServerByType(type) {
    if (type === 'truenas') {
        truenasServers.push('https://');
    } else {
        proxmoxServers.push('https://');
    }
    renderServerList();
    saveServers();
}

// Update server URL by type
function updateServerUrlByType(type, index, url) {
    const servers = type === 'truenas' ? truenasServers : proxmoxServers;
    const oldUrl = servers[index];
    const trimmed = String(url || '').trim();
    migrateConnectionIdOnUrlChange(type, oldUrl, trimmed);
    servers[index] = normalizeUrlClient(trimmed) || trimmed;
    renderServerList();
    saveServers();
}

// Set current server by type
function setCurrentServerByType(type, index) {
    if (type === 'truenas') {
        currentTrueNASServerIndex = index;
        saveSettingsToServer({ currentTrueNASServerIndex: index });
    } else {
        currentServerIndex = index;
        saveSettingsToServer({ currentServerIndex: index });
    }
    renderServerList();
    updateCurrentServerBadge();
    const servers = type === 'truenas' ? truenasServers : proxmoxServers;
    if (servers[index]) {
        showToast(`${t('currentServer')}: ${servers[index]}`, 'info');
        refreshData({ silent: true });
    }
}

// Remove server by type
function removeServerByType(type, index) {
    const servers = type === 'truenas' ? truenasServers : proxmoxServers;
    if (servers.length <= 1) {
        showToast(t('toastCannotRemoveLastServer'), 'warning');
        return;
    }
    const removedUrl = servers[index];
    servers.splice(index, 1);

    let currentIdx = type === 'truenas' ? currentTrueNASServerIndex : currentServerIndex;
    if (index < currentIdx) {
        currentIdx -= 1;
    } else if (index === currentIdx) {
        currentIdx = Math.min(currentIdx, servers.length - 1);
    }
    currentIdx = Math.max(0, Math.min(currentIdx, servers.length - 1));

    if (type === 'truenas') {
        currentTrueNASServerIndex = currentIdx;
    } else {
        currentServerIndex = currentIdx;
    }

    if (removedUrl != null && String(removedUrl).trim() !== '') {
        delete connectionIdMap[connectionKey(type, normalizeUrlClient(removedUrl))];
    }

    renderServerList();
    saveServers();
}

// Save servers list
function saveServers() {
    saveSettingsToServer({
        proxmoxServers: [...proxmoxServers],
        truenasServers: [...truenasServers],
        currentServerIndex: currentServerIndex,
        currentTrueNASServerIndex: currentTrueNASServerIndex,
        connectionIdMap: { ...connectionIdMap }
    });
    updateCurrentServerBadge();
}

// Update current server badge in navbar (оба URL — Proxmox и TrueNAS)
function updateCurrentServerBadge() {
    const badge = document.getElementById('currentServerBadge');
    const nameSpan = document.getElementById('currentServerName');

    if (!badge || !nameSpan) return;

    const hostFromUrl = (urlStr) => {
        const u = String(urlStr || '').trim();
        if (!u) return '';
        try {
            return new URL(u).hostname;
        } catch {
            return u;
        }
    };
    const parts = [];
    if (Array.isArray(proxmoxServers) && proxmoxServers.length && currentServerIndex < proxmoxServers.length) {
        const h = hostFromUrl(proxmoxServers[currentServerIndex]);
        if (h) parts.push(h);
    }
    if (Array.isArray(truenasServers) && truenasServers.length && currentTrueNASServerIndex < truenasServers.length) {
        const h = hostFromUrl(truenasServers[currentTrueNASServerIndex]);
        if (h) parts.push(h);
    }
    const uniq = Array.from(new Set(parts.filter(Boolean)));
    if (uniq.length) {
        nameSpan.textContent = uniq.join(' · ');
        badge.style.display = 'inline-block';
    } else {
        badge.style.display = 'none';
    }
}
