const express = require('express');
const router = express.Router();
const { log } = require('../utils');
const store = require('../settings-store');

const DEFAULT_THRESHOLDS = {
    cpuGreen: 70, cpuYellow: 90, cpuRed: 100,
    ramGreen: 70, ramYellow: 90, ramRed: 100
};

function normalizeThresholdsObject(raw) {
    if (!raw || typeof raw !== 'object') return { ...DEFAULT_THRESHOLDS };
    const clamp = (v) => {
        const n = parseInt(v, 10);
        if (!Number.isFinite(n)) return null;
        return Math.max(0, Math.min(100, n));
    };
    let cpuG = clamp(raw.cpuGreen) ?? DEFAULT_THRESHOLDS.cpuGreen;
    let cpuY = clamp(raw.cpuYellow) ?? DEFAULT_THRESHOLDS.cpuYellow;
    let cpuR = clamp(raw.cpuRed) ?? DEFAULT_THRESHOLDS.cpuRed;
    let ramG = clamp(raw.ramGreen) ?? DEFAULT_THRESHOLDS.ramGreen;
    let ramY = clamp(raw.ramYellow) ?? DEFAULT_THRESHOLDS.ramYellow;
    let ramR = clamp(raw.ramRed) ?? DEFAULT_THRESHOLDS.ramRed;
    if (cpuG === 0 && cpuY === 0) {
        cpuG = DEFAULT_THRESHOLDS.cpuGreen;
        cpuY = DEFAULT_THRESHOLDS.cpuYellow;
        cpuR = DEFAULT_THRESHOLDS.cpuRed;
    }
    if (ramG === 0 && ramY === 0) {
        ramG = DEFAULT_THRESHOLDS.ramGreen;
        ramY = DEFAULT_THRESHOLDS.ramYellow;
        ramR = DEFAULT_THRESHOLDS.ramRed;
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

/**
 * Первый запуск / сброс: setup_completed отсутствует или '0' → показать мастер.
 * Обновление с существующими серверами/подключениями: миграция в '1' без мастера.
 */
function normalizeSpeedtestProviderMbpsField(v) {
    if (v === undefined) return undefined;
    const s = String(v).trim().replace(',', '.');
    if (s === '') return '';
    const n = parseFloat(s);
    if (!Number.isFinite(n) || n < 0) return '';
    const capped = Math.min(n, 1_000_000);
    return String(Math.round(capped * 1000) / 1000);
}

function normalizeSpeedtestProxyField(v) {
    if (v === undefined) return undefined;
    let s = String(v).trim();
    if (s === '') return '';
    if (/[\r\n\0]/.test(s)) return '';
    if (s.length > 2048) s = s.slice(0, 2048);
    return s;
}

function normalizeSpeedtestEngineField(v) {
    if (v === undefined) return undefined;
    const s = String(v).trim().toLowerCase();
    return s === 'librespeed' ? 'librespeed' : 'ookla';
}

function computeSetupCompleted(st) {
    const raw = st.getSetting('setup_completed');
    if (raw === '0' || raw === 'false') return false;
    if (raw === '1' || raw === 'true') return true;
    let hasProxmoxServers = false;
    try {
        const ps = JSON.parse(st.getSetting('proxmox_servers') || '[]');
        hasProxmoxServers = Array.isArray(ps) && ps.length > 0;
    } catch (_) {}
    let hasMap = false;
    try {
        const m = JSON.parse(st.getSetting('connection_id_map') || '{}');
        hasMap = m && typeof m === 'object' && Object.keys(m).length > 0;
    } catch (_) {}
    let hasTrueNAS = false;
    try {
        const ts = JSON.parse(st.getSetting('truenas_servers') || '[]');
        hasTrueNAS = Array.isArray(ts) && ts.length > 0;
    } catch (_) {}
    if (hasProxmoxServers || hasMap || hasTrueNAS) {
        st.setSetting('setup_completed', '1');
        return true;
    }
    return false;
}

const SETTING_KEYS = [
    'theme', 'refresh_interval', 'units', 'thresholds',
    'ui_design', 'classic_design',
    'monitor_theme', 'monitor_mode', 'server_type',
    'current_server_index', 'current_truenas_index',
    'proxmox_servers', 'truenas_servers', 'connection_id_map',
    'preferred_language',
    'session_ttl_minutes',
    // Custom theme CSS (import/export)
    'custom_theme_css',
    // Custom theme plain settings (import/export)
    'custom_theme_style_settings',
    // UPS (NUT/SNMP) monitoring settings
    'ups_enabled', 'ups_type', 'ups_host', 'ups_port', 'ups_name',
    'nut_var_status', 'nut_var_charge', 'nut_var_runtime',
    'nut_var_input_voltage', 'nut_var_output_voltage',
    'nut_var_power', 'nut_var_load', 'nut_var_frequency',
    'snmp_community',
    'snmp_oid_status', 'snmp_oid_charge', 'snmp_oid_runtime',
    'snmp_oid_input_voltage', 'snmp_oid_output_voltage',
    'snmp_oid_power', 'snmp_oid_load', 'snmp_oid_frequency',
    // monitor-mode specific
    'monitor_hidden_service_ids',
    'monitor_vms',
    'monitor_hidden_vm_ids',
    'monitor_screens_order',
    'monitor_screens_enabled',
    'cluster_dashboard_tiles',
    'dashboard_weather_city',
    'dashboard_weather_provider',
    'dashboard_timezone',
    'dashboard_show_time',
    'dashboard_show_weather',
    'monitor_show_time',
    'monitor_show_weather',
    // Speedtest (Ookla CLI)
    'speedtest_enabled',
    'speedtest_engine',
    'speedtest_server',
    'speedtest_librespeed_server',
    'speedtest_per_day',
    'speedtest_provider_download_mbps',
    'speedtest_provider_upload_mbps',
    'speedtest_http_proxy',
    'speedtest_https_proxy',
    'speedtest_no_proxy',
    // iperf3 (LAN throughput)
    'iperf3_enabled',
    'iperf3_host',
    'iperf3_port',
    'iperf3_duration_sec',
    'iperf3_parallel',
    'iperf3_per_day',
    'iperf3_provider_download_mbps',
    'iperf3_provider_upload_mbps',
    // Telegram alerts (server-side)
    'telegram_notify_enabled',
    'telegram_notify_interval_sec',
    'telegram_routes',
    'telegram_notification_rules',
    'telegram_proxy_url'
];

// GET /api/settings — все настройки (без пароля), флаг password_required
router.get('/', (req, res) => {
    try {
        const payload = { password_required: store.hasSettingsPassword() };
        const tok = store.getSetting('telegram_bot_token');
        payload.telegram_bot_token_set = !!(tok && String(tok).trim());
        payload.setup_completed = computeSetupCompleted(store);

        for (const key of SETTING_KEYS) {
            const value = store.getSetting(key);
            if (value !== null && value !== undefined && value !== '') {
                if (
                    key === 'thresholds' ||
                    key === 'proxmox_servers' ||
                    key === 'truenas_servers' ||
                    key === 'connection_id_map' ||
                    key === 'custom_theme_css' ||
                    key === 'custom_theme_style_settings' ||
                    key === 'monitor_hidden_service_ids' ||
                    key === 'monitor_vms' ||
                    key === 'monitor_hidden_vm_ids' ||
                    key === 'monitor_screens_order' ||
                    key === 'monitor_screens_enabled' ||
                    key === 'cluster_dashboard_tiles' ||
                    key === 'telegram_routes' ||
                    key === 'telegram_notification_rules'
                ) {
                    try {
                        payload[key] = JSON.parse(value);
                    } catch {
                        payload[key] = value;
                    }
                    if (key === 'thresholds' && payload.thresholds && typeof payload.thresholds === 'object') {
                        payload.thresholds = normalizeThresholdsObject(payload.thresholds);
                    }
                } else if (key === 'speedtest_per_day' || key === 'iperf3_per_day') {
                    const n = parseInt(value, 10);
                    let perDay = Number.isFinite(n) ? n : 4;
                    if (perDay < 1) perDay = 4;
                    if (perDay > 6) perDay = 6;
                    payload[key] = perDay;
                } else if (key === 'iperf3_port' || key === 'iperf3_duration_sec' || key === 'iperf3_parallel') {
                    const n = parseInt(value, 10);
                    if (key === 'iperf3_port') {
                        payload[key] = Number.isFinite(n) && n >= 1 && n <= 65535 ? n : 5201;
                    } else if (key === 'iperf3_duration_sec') {
                        let d = Number.isFinite(n) ? n : 8;
                        if (d < 1) d = 8;
                        if (d > 120) d = 120;
                        payload[key] = d;
                    } else {
                        let p = Number.isFinite(n) ? n : 1;
                        if (p < 1) p = 1;
                        if (p > 32) p = 32;
                        payload[key] = p;
                    }
                } else if (key === 'speedtest_provider_download_mbps' || key === 'speedtest_provider_upload_mbps') {
                    const n = parseFloat(String(value).trim().replace(',', '.'));
                    if (Number.isFinite(n) && n > 0) payload[key] = Math.min(n, 1_000_000);
                } else if (key === 'iperf3_provider_download_mbps' || key === 'iperf3_provider_upload_mbps') {
                    const n = parseFloat(String(value).trim().replace(',', '.'));
                    if (Number.isFinite(n) && n > 0) payload[key] = Math.min(n, 1_000_000);
                } else if (key === 'refresh_interval' || key === 'current_server_index' || key === 'current_truenas_index' || key === 'session_ttl_minutes' || key === 'telegram_notify_interval_sec') {
                    payload[key] = parseInt(value, 10);
                } else if (key === 'telegram_notify_enabled') {
                    payload[key] = value === '1' || value === 'true';
                } else if (
                    key === 'dashboard_show_time' ||
                    key === 'dashboard_show_weather' ||
                    key === 'monitor_show_time' ||
                    key === 'monitor_show_weather'
                ) {
                    payload[key] = !(value === '0' || value === 'false' || value === false);
                } else if (key === 'classic_design') {
                    payload[key] = !(value === '0' || value === 'false' || value === false);
                } else if (key === 'ui_design') {
                    const raw = String(value || '').trim().toLowerCase();
                    payload[key] = raw === 'classic' ? 'classic' : 'retro';
                } else {
                    payload[key] = value;
                }
            }
        }
        if (payload.session_ttl_minutes == null || payload.session_ttl_minutes === '') {
            payload.session_ttl_minutes = 30;
        }
        if (payload.telegram_notify_enabled === undefined) payload.telegram_notify_enabled = false;
        if (payload.telegram_notify_interval_sec == null || !Number.isFinite(parseInt(payload.telegram_notify_interval_sec, 10))) {
            payload.telegram_notify_interval_sec = 60;
        }
        for (const k of ['dashboard_show_time', 'dashboard_show_weather', 'monitor_show_time', 'monitor_show_weather', 'monitor_disable_chrome_gestures']) {
            if (payload[k] === undefined) payload[k] = true;
            else payload[k] = !(payload[k] === false || payload[k] === '0' || payload[k] === 0 || payload[k] === 'false');
        }
        if (payload.classic_design === undefined) payload.classic_design = false;
        if (payload.ui_design === undefined) payload.ui_design = payload.classic_design ? 'classic' : 'retro';
        if (!payload.telegram_routes || typeof payload.telegram_routes !== 'object') {
            payload.telegram_routes = { service: {}, vm: {}, node: {}, netdev: {} };
        }
        if (!Array.isArray(payload.telegram_notification_rules)) {
            payload.telegram_notification_rules = [];
        }
        // Всегда отдаём списки URL — иначе клиент оставляет дефолтные placeholder-URL и считает бэкенд «настроенным».
        if (!Array.isArray(payload.proxmox_servers)) payload.proxmox_servers = [];
        if (!Array.isArray(payload.truenas_servers)) payload.truenas_servers = [];
        const iconMaps = store.getMonitorIconMapsFromDb();
        payload.monitor_service_icons = iconMaps.monitor_service_icons;
        payload.monitor_service_icon_colors = iconMaps.monitor_service_icon_colors;
        payload.monitor_vm_icons = iconMaps.monitor_vm_icons;
        payload.monitor_vm_icon_colors = iconMaps.monitor_vm_icon_colors;
        if (!payload.dashboard_weather_provider) payload.dashboard_weather_provider = 'open_meteo';
        if (!payload.speedtest_engine) payload.speedtest_engine = 'ookla';
        const wk = (k) => !!(store.getSetting(k) && String(store.getSetting(k)).trim());
        payload.weather_openweathermap_api_key_set = wk('weather_openweathermap_api_key');
        payload.weather_yandex_api_key_set = wk('weather_yandex_api_key');
        payload.weather_gismeteo_api_key_set = wk('weather_gismeteo_api_key');
        res.json(payload);
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
});

// POST /api/settings — сохранить настройки (тело: те же ключи в camelCase или snake_case)
router.post('/', (req, res) => {
    try {
        const body = req.body || {};
        const map = {
            theme: body.theme,
            refresh_interval: body.refresh_interval ?? body.refreshInterval,
            units: body.units,
            thresholds: (() => {
                const v = body.thresholds;
                if (v === undefined) return undefined;
                return normalizeThresholdsObject(v);
            })(),
            monitor_theme: body.monitor_theme ?? body.monitorTheme,
            ui_design: (() => {
                const v = body.ui_design ?? body.uiDesign;
                if (v === undefined) return undefined;
                return String(v).trim().toLowerCase() === 'classic' ? 'classic' : 'retro';
            })(),
            classic_design: (() => {
                const v = body.classic_design ?? body.classicDesign;
                if (v === undefined) {
                    const d = String(body.ui_design ?? body.uiDesign ?? '').trim().toLowerCase();
                    if (!d) return undefined;
                    return d === 'classic' ? '1' : '0';
                }
                return v === true || v === '1' || v === 1 || v === 'true' ? '1' : '0';
            })(),
            monitor_mode: body.monitor_mode ?? body.monitorMode,
            server_type: body.server_type ?? body.serverType,
            current_server_index: body.current_server_index ?? body.currentServerIndex,
            current_truenas_index: body.current_truenas_index ?? body.currentTrueNASServerIndex,
            proxmox_servers: body.proxmox_servers ?? body.proxmoxServers,
            truenas_servers: body.truenas_servers ?? body.truenasServers,
            connection_id_map: body.connection_id_map ?? body.connectionIdMap,
            preferred_language: body.preferred_language ?? body.preferredLanguage,
            session_ttl_minutes: body.session_ttl_minutes ?? body.sessionTtlMinutes,
            custom_theme_css: body.custom_theme_css ?? body.customThemeCss,
            custom_theme_style_settings: body.custom_theme_style_settings ?? body.customThemeStyleSettings,
            monitor_hidden_service_ids: body.monitor_hidden_service_ids ?? body.monitorHiddenServiceIds,
            monitor_service_icons: body.monitor_service_icons ?? body.monitorServiceIcons,
            monitor_service_icon_colors: body.monitor_service_icon_colors ?? body.monitorServiceIconColors,
            monitor_vms: body.monitor_vms ?? body.monitorVms,
            monitor_hidden_vm_ids: body.monitor_hidden_vm_ids ?? body.monitorHiddenVmIds,
            monitor_vm_icons: body.monitor_vm_icons ?? body.monitorVmIcons,
            monitor_vm_icon_colors: body.monitor_vm_icon_colors ?? body.monitorVmIconColors,
            monitor_screens_order: body.monitor_screens_order ?? body.monitorScreensOrder,
            monitor_screens_enabled: body.monitor_screens_enabled ?? body.monitorScreensEnabled,
            cluster_dashboard_tiles: body.cluster_dashboard_tiles ?? body.clusterDashboardTiles,
            dashboard_weather_city: body.dashboard_weather_city ?? body.dashboardWeatherCity,
            dashboard_weather_provider: (() => {
                const v = body.dashboard_weather_provider ?? body.dashboardWeatherProvider;
                if (v === undefined) return undefined;
                const s = String(v).trim().toLowerCase().replace(/-/g, '_');
                const allowed = ['open_meteo', 'openweathermap', 'yandex', 'gismeteo'];
                return allowed.includes(s) ? s : 'open_meteo';
            })(),
            dashboard_timezone: body.dashboard_timezone ?? body.dashboardTimezone,
            dashboard_show_time: (() => {
                const v = body.dashboard_show_time ?? body.dashboardShowTime;
                if (v === undefined) return undefined;
                return v === true || v === '1' || v === 1 || v === 'true' ? '1' : '0';
            })(),
            dashboard_show_weather: (() => {
                const v = body.dashboard_show_weather ?? body.dashboardShowWeather;
                if (v === undefined) return undefined;
                return v === true || v === '1' || v === 1 || v === 'true' ? '1' : '0';
            })(),
            monitor_show_time: (() => {
                const v = body.monitor_show_time ?? body.monitorShowTime;
                if (v === undefined) return undefined;
                return v === true || v === '1' || v === 1 || v === 'true' ? '1' : '0';
            })(),
            monitor_show_weather: (() => {
                const v = body.monitor_show_weather ?? body.monitorShowWeather;
                if (v === undefined) return undefined;
                return v === true || v === '1' || v === 1 || v === 'true' ? '1' : '0';
            })(),
            monitor_disable_chrome_gestures: (() => {
                const v = body.monitor_disable_chrome_gestures ?? body.monitorDisableChromeGestures;
                if (v === undefined) return undefined;
                return v === true || v === '1' || v === 1 || v === 'true' ? '1' : '0';
            })(),
            speedtest_enabled: (() => {
                const v = body.speedtest_enabled ?? body.speedtestEnabled;
                if (v === undefined) return undefined;
                return v === true || v === '1' || v === 1 || v === 'true' ? '1' : '0';
            })(),
            speedtest_engine: normalizeSpeedtestEngineField(
                body.speedtest_engine ?? body.speedtestEngine
            ),
            speedtest_server: (() => {
                const v = body.speedtest_server ?? body.speedtestServer;
                if (v === undefined) return undefined;
                return String(v).trim();
            })(),
            speedtest_librespeed_server: (() => {
                const v = body.speedtest_librespeed_server ?? body.speedtestLibrespeedServer;
                if (v === undefined) return undefined;
                let s = String(v).trim();
                if (s.length > 1024) s = s.slice(0, 1024);
                if (/[\r\n\0]/.test(s)) return '';
                return s;
            })(),
            speedtest_per_day: (() => {
                const v = body.speedtest_per_day ?? body.speedtestPerDay;
                if (v === undefined) return undefined;
                let n = parseInt(v, 10);
                if (!Number.isFinite(n) || n < 1) n = 4;
                if (n > 6) n = 6;
                return n;
            })(),
            speedtest_provider_download_mbps: normalizeSpeedtestProviderMbpsField(
                body.speedtest_provider_download_mbps ?? body.speedtestProviderDownloadMbps
            ),
            speedtest_provider_upload_mbps: normalizeSpeedtestProviderMbpsField(
                body.speedtest_provider_upload_mbps ?? body.speedtestProviderUploadMbps
            ),
            speedtest_http_proxy: normalizeSpeedtestProxyField(
                body.speedtest_http_proxy ?? body.speedtestHttpProxy
            ),
            speedtest_https_proxy: normalizeSpeedtestProxyField(
                body.speedtest_https_proxy ?? body.speedtestHttpsProxy
            ),
            speedtest_no_proxy: normalizeSpeedtestProxyField(
                body.speedtest_no_proxy ?? body.speedtestNoProxy
            ),
            iperf3_enabled: (() => {
                const v = body.iperf3_enabled ?? body.iperf3Enabled;
                if (v === undefined) return undefined;
                return v === true || v === '1' || v === 1 || v === 'true' ? '1' : '0';
            })(),
            iperf3_host: (() => {
                const v = body.iperf3_host ?? body.iperf3Host;
                if (v === undefined) return undefined;
                let s = String(v).trim();
                if (s.length > 512) s = s.slice(0, 512);
                if (/[\r\n\0]/.test(s)) return '';
                return s;
            })(),
            iperf3_port: (() => {
                const v = body.iperf3_port ?? body.iperf3Port;
                if (v === undefined) return undefined;
                let n = parseInt(v, 10);
                if (!Number.isFinite(n) || n < 1 || n > 65535) n = 5201;
                return n;
            })(),
            iperf3_duration_sec: (() => {
                const v = body.iperf3_duration_sec ?? body.iperf3DurationSec;
                if (v === undefined) return undefined;
                let n = parseInt(v, 10);
                if (!Number.isFinite(n) || n < 1) n = 8;
                if (n > 120) n = 120;
                return n;
            })(),
            iperf3_parallel: (() => {
                const v = body.iperf3_parallel ?? body.iperf3Parallel;
                if (v === undefined) return undefined;
                let n = parseInt(v, 10);
                if (!Number.isFinite(n) || n < 1) n = 1;
                if (n > 32) n = 32;
                return n;
            })(),
            iperf3_per_day: (() => {
                const v = body.iperf3_per_day ?? body.iperf3PerDay;
                if (v === undefined) return undefined;
                let n = parseInt(v, 10);
                if (!Number.isFinite(n) || n < 1) n = 4;
                if (n > 6) n = 6;
                return n;
            })(),
            iperf3_provider_download_mbps: normalizeSpeedtestProviderMbpsField(
                body.iperf3_provider_download_mbps ?? body.iperf3ProviderDownloadMbps
            ),
            iperf3_provider_upload_mbps: normalizeSpeedtestProviderMbpsField(
                body.iperf3_provider_upload_mbps ?? body.iperf3ProviderUploadMbps
            ),
            telegram_notify_enabled: (() => {
                const v = body.telegram_notify_enabled ?? body.telegramNotifyEnabled;
                if (v === undefined) return undefined;
                return v === true || v === '1' || v === 1 || v === 'true' ? '1' : '0';
            })(),
            telegram_notify_interval_sec: body.telegram_notify_interval_sec ?? body.telegramNotifyIntervalSec,
            telegram_routes: body.telegram_routes ?? body.telegramRoutes,
            telegram_notification_rules: body.telegram_notification_rules ?? body.telegramNotificationRules,
            telegram_proxy_url: (() => {
                const v = body.telegram_proxy_url ?? body.telegramProxyUrl;
                if (v === undefined) return undefined;
                return String(v).trim();
            })(),
            setup_completed: (() => {
                const v = body.setup_completed ?? body.setupCompleted;
                if (v === undefined) return undefined;
                return v === true || v === '1' || v === 1 ? '1' : '0';
            })()
        };
        const clearTg = body.telegram_clear_bot_token === true || body.telegramClearBotToken === true;
        const newTgTok = body.telegram_bot_token ?? body.telegramBotToken;
        const { isValidTelegramBotTokenFormat } = require('../telegram');
        if (clearTg) {
            store.setSetting('telegram_bot_token', '');
            map._telegram_cleared = true;
        } else if (newTgTok !== undefined && newTgTok !== null && String(newTgTok).trim() !== '') {
            const t = String(newTgTok).trim();
            if (isValidTelegramBotTokenFormat(t)) {
                store.setSetting('telegram_bot_token', t);
                map._telegram_token_set = true;
            }
        }
        const wOwm = body.weather_openweathermap_api_key ?? body.weatherOpenweathermapApiKey;
        if (wOwm !== undefined && String(wOwm).trim() !== '') {
            store.setSetting('weather_openweathermap_api_key', String(wOwm).trim());
        }
        const wYandex = body.weather_yandex_api_key ?? body.weatherYandexApiKey;
        if (wYandex !== undefined && String(wYandex).trim() !== '') {
            store.setSetting('weather_yandex_api_key', String(wYandex).trim());
        }
        const wGis = body.weather_gismeteo_api_key ?? body.weatherGismeteoApiKey;
        if (wGis !== undefined && String(wGis).trim() !== '') {
            store.setSetting('weather_gismeteo_api_key', String(wGis).trim());
        }
        if (map.monitor_service_icons !== undefined || map.monitor_service_icon_colors !== undefined) {
            store.replaceMonitorIconScope('service', map.monitor_service_icons, map.monitor_service_icon_colors);
            delete map.monitor_service_icons;
            delete map.monitor_service_icon_colors;
        }
        if (map.monitor_vm_icons !== undefined || map.monitor_vm_icon_colors !== undefined) {
            store.replaceMonitorIconScope('vm', map.monitor_vm_icons, map.monitor_vm_icon_colors);
            delete map.monitor_vm_icons;
            delete map.monitor_vm_icon_colors;
        }
        const savedKeys = [];
        for (const [key, value] of Object.entries(map)) {
            if (key.startsWith('_')) continue;
            if (value === undefined) continue;
            if (typeof value === 'object' && value !== null && !Array.isArray(value)) {
                store.setSetting(key, JSON.stringify(value));
                savedKeys.push(key);
            } else {
                store.setSetting(key, value);
                savedKeys.push(key);
            }
        }
        if (savedKeys.length) {
            log('info', '[Settings] updated', {
                keys: savedKeys,
                monitorMode: map.monitor_mode ?? map.monitorMode,
                theme: map.theme,
                monitorTheme: map.monitor_theme ?? map.monitorTheme,
                serverType: map.server_type ?? map.serverType
            });
        } else {
            log('info', '[Settings] updated (no keys)');
        }
        res.json({ success: true });
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
});

// POST /api/settings/unlock — проверка пароля
router.post('/unlock', (req, res) => {
    const password = req.body?.password;
    if (password == null) {
        return res.status(400).json({ success: false, error: 'password required' });
    }
    const success = store.verifySettingsPassword(String(password));
    res.json({ success });
});

// POST /api/settings/password — установить/сменить/отключить пароль
router.post('/password', (req, res) => {
    const { currentPassword, newPassword } = req.body || {};
    const hasCurrent = store.hasSettingsPassword();

    if (hasCurrent) {
        if (currentPassword == null || !store.verifySettingsPassword(String(currentPassword))) {
            return res.status(400).json({ success: false, error: 'wrong_current' });
        }
        if (newPassword === '' || newPassword == null) {
            store.clearSettingsPassword();
            return res.json({ success: true, disabled: true });
        }
    }
    if (newPassword === '' || newPassword == null) {
        return res.status(400).json({ success: false, error: 'new_password_required' });
    }
    store.setSettingsPassword(String(newPassword));
    res.json({ success: true });
});

// POST /api/settings/reset-backend — очистить серверы, токены и привязки только для одного типа (proxmox | truenas)
router.post('/reset-backend', (req, res) => {
    try {
        const raw = (req.body && (req.body.type || req.body.backend)) || '';
        const type = String(raw).toLowerCase();
        if (type !== 'proxmox' && type !== 'truenas') {
            return res.status(400).json({ success: false, error: 'invalid type' });
        }
        const connectionsStore = require('../connection-store');
        connectionsStore.deleteConnectionsByType(type);

        if (type === 'proxmox') {
            store.setSetting('proxmox_servers', '[]');
            store.setSetting('current_server_index', '0');
        } else {
            store.setSetting('truenas_servers', '[]');
            store.setSetting('current_truenas_index', '0');
        }

        let map = {};
        try {
            map = JSON.parse(store.getSetting('connection_id_map') || '{}');
        } catch (_) {}
        const prefix = `${type}|`;
        const next = {};
        for (const [k, v] of Object.entries(map)) {
            if (String(k).startsWith(prefix)) continue;
            next[k] = v;
        }
        store.setSetting('connection_id_map', JSON.stringify(next));

        const parseArr = (key) => {
            try {
                const parsed = JSON.parse(store.getSetting(key) || '[]');
                return Array.isArray(parsed) ? parsed : [];
            } catch (_) {
                return [];
            }
        };
        const ps = parseArr('proxmox_servers');
        const ts = parseArr('truenas_servers');
        const hasP = ps.length > 0;
        const hasT = ts.length > 0;
        const curSt = String(store.getSetting('server_type') || 'proxmox').toLowerCase();
        if (curSt === 'proxmox' && !hasP && hasT) {
            store.setSetting('server_type', 'truenas');
        } else if (curSt === 'truenas' && !hasT && hasP) {
            store.setSetting('server_type', 'proxmox');
        }

        log('info', `[Settings] reset-backend ${type}`);
        res.json({ success: true });
    } catch (e) {
        log('error', '[Settings] reset-backend failed', { error: e.message });
        res.status(500).json({ success: false, error: e.message });
    }
});

// POST /api/settings/reset — сброс всех настроек (без пароля настроек), плюс мониторы сервисов и подключений
router.post('/reset', (req, res) => {
    try {
        store.resetAllSettingsPreservingPassword();
        store.clearMonitoredServices();
        const connectionsStore = require('../connection-store');
        connectionsStore.clearConnections();
        log('warn', '[Settings] reset', {
            preservePassword: true,
            clearedMonitoredServices: true,
            clearedConnections: true
        });
        res.json({ success: true });
    } catch (e) {
        log('error', '[Settings] reset failed', { error: e.message });
        res.status(500).json({ success: false, error: e.message });
    }
});

// GET /api/settings/services — список сервисов для мониторинга
router.get('/services', (req, res) => {
    try {
        const list = store.listMonitoredServices();
        res.json({ services: list });
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
});

// POST /api/settings/services — добавить сервис
router.post('/services', (req, res) => {
    const { name, type, host, port, url } = req.body || {};
    const t = String(type || 'tcp').toLowerCase();
    if (t === 'http' || t === 'https') {
        if (!url || !String(url).trim()) {
            return res.status(400).json({ error: 'url required' });
        }
    } else if (t === 'snmp' || t === 'nut') {
        if (!url || !String(url).trim()) {
            return res.status(400).json({ error: 'url required' });
        }
        const h = host != null ? String(host).trim() : '';
        const p = port != null ? parseInt(port, 10) : null;
        if (!h || !p || p < 1 || p > 65535) {
            return res.status(400).json({ error: 'host and port (1-65535) required' });
        }
    } else {
        const h = host != null ? String(host).trim() : '';
        const p = port != null ? parseInt(port, 10) : null;
        if (!h || !p || p < 1 || p > 65535) {
            return res.status(400).json({ error: 'host and port (1-65535) required' });
        }
    }
    try {
        const id = store.addMonitoredService({
            name: name != null ? String(name).trim() : '',
            type: t === 'https' ? 'https' : (t === 'http' ? 'http' : t),
            host: host != null ? String(host).trim() : null,
            port: port != null ? parseInt(port, 10) : null,
            url: url != null ? String(url).trim() : null
        });
        const list = store.listMonitoredServices();
        const added = list.find((s) => s.id === id);
        res.status(201).json(added ? { id, service: added } : { id });
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
});

// PATCH /api/settings/services/:id — обновить last_status, last_latency
router.patch('/services/:id', (req, res) => {
    const id = parseInt(req.params.id, 10);
    const { lastStatus, lastLatency } = req.body || {};
    if (Number.isNaN(id)) return res.status(400).json({ error: 'invalid id' });
    try {
        store.updateMonitoredServiceStatus(id, lastStatus, lastLatency);
        res.json({ success: true });
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
});

// DELETE /api/settings/services/:id
router.delete('/services/:id', (req, res) => {
    const id = req.params.id;
    try {
        store.removeMonitoredService(id);
        res.json({ success: true });
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
});

// GET /api/settings/export/services — только сервисы мониторинга
router.get('/export/services', (req, res) => {
    try {
        res.json(store.getMonitoredServicesExport());
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
});

// POST /api/settings/import/services — только сервисы мониторинга и их иконки
router.post('/import/services', (req, res) => {
    try {
        const payload = req.body;
        const hasServices = !!(payload && typeof payload === 'object' && Array.isArray(payload.services));
        const hasIcons = !!(payload && typeof payload === 'object' && payload.monitor_service_icons && typeof payload.monitor_service_icons === 'object' && !Array.isArray(payload.monitor_service_icons));
        const hasColors = !!(payload && typeof payload === 'object' && payload.monitor_service_icon_colors && typeof payload.monitor_service_icon_colors === 'object' && !Array.isArray(payload.monitor_service_icon_colors));
        if (!hasServices && !hasIcons && !hasColors) {
            return res.status(400).json({ success: false, error: 'invalid_payload' });
        }
        store.importMonitoredServicesConfig(payload);
        res.json({ success: true });
    } catch (e) {
        res.status(500).json({ success: false, error: e.message });
    }
});

// GET /api/settings/export/vms — только списки VM/CT для монитора
router.get('/export/vms', (req, res) => {
    try {
        res.json(store.getMonitoredVmsExport());
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
});

// POST /api/settings/import/vms — только списки VM/CT и их иконки
router.post('/import/vms', (req, res) => {
    try {
        const payload = req.body;
        if (!payload || typeof payload !== 'object') {
            return res.status(400).json({ success: false, error: 'invalid_payload' });
        }
        const hasMv = Array.isArray(payload.monitor_vms);
        const hasHidden = Array.isArray(payload.monitor_hidden_vm_ids);
        const hasIcons = !!(payload.monitor_vm_icons && typeof payload.monitor_vm_icons === 'object' && !Array.isArray(payload.monitor_vm_icons));
        const hasColors = !!(payload.monitor_vm_icon_colors && typeof payload.monitor_vm_icon_colors === 'object' && !Array.isArray(payload.monitor_vm_icon_colors));
        if (!hasMv && !hasHidden && !hasIcons && !hasColors) {
            return res.status(400).json({ success: false, error: 'invalid_payload' });
        }
        store.importMonitoredVmsConfig(payload);
        res.json({ success: true });
    } catch (e) {
        res.status(500).json({ success: false, error: e.message });
    }
});

// GET /api/settings/export/all — все настройки + сервисы + подключения (c секретами) + явные списки VM/CT
router.get('/export/all', (req, res) => {
    try {
        const base = store.exportSettingsAndServices();
        const connectionsStore = require('../connection-store');
        const connections = connectionsStore.exportConnectionsWithSecrets();
        const vmCfg = store.getMonitoredVmsExport();
        res.json({ ...base, ...vmCfg, connections });
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
});

// POST /api/settings/import/all — все настройки + сервисы + подключения
router.post('/import/all', (req, res) => {
    try {
        const payload = req.body;
        if (!payload || typeof payload !== 'object') {
            return res.status(400).json({ success: false, error: 'invalid_payload' });
        }
        const connectionsStore = require('../connection-store');
        if (payload.connections) {
            connectionsStore.importConnectionsWithSecrets(payload.connections);
        }
        store.importSettingsAndServices(payload);
        store.importMonitoredVmsConfig(payload);
        res.json({ success: true });
    } catch (e) {
        res.status(500).json({ success: false, error: e.message });
    }
});

// POST /api/settings/telegram-test-rule — тестовое сообщение по одному правилу (токен из тела или из БД)
router.post('/telegram-test-rule', async (req, res) => {
    try {
        const { sendTelegramMessage, buildTelegramTestRuleMessage, isValidTelegramBotTokenFormat } = require('../telegram');
        const body = req.body || {};
        const rule = body.rule && typeof body.rule === 'object' ? body.rule : {};
        const chatId = String(rule.chatId != null ? rule.chatId : body.chatId || '').trim();
        if (!chatId) {
            return res.status(400).json({ success: false, error: 'chat_id required' });
        }
        const threadRaw = rule.threadId != null ? rule.threadId : body.threadId;
        const threadId = threadRaw != null && String(threadRaw).trim() !== '' ? threadRaw : undefined;

        let token = String(body.telegramBotToken ?? body.telegram_bot_token ?? '').trim();
        if (token && !isValidTelegramBotTokenFormat(token)) {
            token = '';
        }
        if (!token) token = String(store.getSetting('telegram_bot_token') || '').trim();
        if (!token) {
            return res.status(400).json({ success: false, error: 'bot_token required' });
        }

        const proxyUrl = String(
            body.telegramProxyUrl ?? body.telegram_proxy_url ?? store.getSetting('telegram_proxy_url') ?? ''
        ).trim();

        const text = buildTelegramTestRuleMessage(rule);
        await sendTelegramMessage(token, chatId, text, threadId, { proxyUrl });
        res.json({ success: true });
    } catch (e) {
        log('warn', `[Settings] telegram-test-rule: ${e.message}`);
        res.status(500).json({ success: false, error: e.message || 'send failed' });
    }
});

// POST /api/settings/telegram-fetch-chats — чаты и темы из getUpdates (токен из тела или БД)
router.post('/telegram-fetch-chats', async (req, res) => {
    try {
        const { fetchTelegramChatsAndThreadsFromUpdates, isValidTelegramBotTokenFormat } = require('../telegram');
        const body = req.body || {};
        let token = String(body.telegramBotToken ?? body.telegram_bot_token ?? '').trim();
        if (token && !isValidTelegramBotTokenFormat(token)) token = '';
        if (!token) token = String(store.getSetting('telegram_bot_token') || '').trim();
        if (!token) {
            return res.status(400).json({ success: false, error: 'bot_token_required' });
        }
        const proxyUrl = String(
            body.telegramProxyUrl ?? body.telegram_proxy_url ?? store.getSetting('telegram_proxy_url') ?? ''
        ).trim();
        const { updatesCount, chats, threadsByChat } = await fetchTelegramChatsAndThreadsFromUpdates(token, proxyUrl);
        res.json({ success: true, updatesCount, chats, threadsByChat });
    } catch (e) {
        const code = e && e.telegramErrorCode;
        const msg = e && e.message ? String(e.message) : 'getUpdates failed';
        if (code === 409 || /webhook|getupdates/i.test(msg)) {
            return res.status(400).json({
                success: false,
                error: 'telegram_webhook_or_conflict',
                description: msg
            });
        }
        log('warn', `[Settings] telegram-fetch-chats: ${msg}`);
        res.status(500).json({ success: false, error: msg });
    }
});

module.exports = router;
