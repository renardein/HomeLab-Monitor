const express = require('express');
const router = express.Router();
const { log } = require('../utils');
const store = require('../settings-store');

const SETTING_KEYS = [
    'theme', 'refresh_interval', 'units', 'thresholds',
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
    'monitor_service_icons',
    'monitor_service_icon_colors',
    'monitor_vms',
    'monitor_hidden_vm_ids',
    'monitor_vm_icons',
    'monitor_vm_icon_colors',
    'monitor_screens_order',
    'cluster_dashboard_tiles',
    'dashboard_weather_city',
    'dashboard_timezone',
    // Speedtest (Ookla CLI)
    'speedtest_enabled',
    'speedtest_server',
    'speedtest_per_day',
    // Telegram alerts (server-side)
    'telegram_notify_enabled',
    'telegram_notify_interval_sec',
    'telegram_routes',
    'telegram_notification_rules'
];

// GET /api/settings — все настройки (без пароля), флаг password_required
router.get('/', (req, res) => {
    try {
        const payload = { password_required: store.hasSettingsPassword() };
        const tok = store.getSetting('telegram_bot_token');
        payload.telegram_bot_token_set = !!(tok && String(tok).trim());

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
                    key === 'monitor_service_icons' ||
                    key === 'monitor_service_icon_colors' ||
                    key === 'monitor_vms' ||
                    key === 'monitor_hidden_vm_ids' ||
                    key === 'monitor_vm_icons' ||
                    key === 'monitor_vm_icon_colors' ||
                    key === 'monitor_screens_order' ||
                    key === 'cluster_dashboard_tiles' ||
                    key === 'telegram_routes' ||
                    key === 'telegram_notification_rules'
                ) {
                    try {
                        payload[key] = JSON.parse(value);
                    } catch {
                        payload[key] = value;
                    }
                } else if (key === 'speedtest_per_day') {
                    const n = parseInt(value, 10);
                    payload[key] = Number.isFinite(n) ? n : 4;
                } else if (key === 'refresh_interval' || key === 'current_server_index' || key === 'current_truenas_index' || key === 'session_ttl_minutes' || key === 'telegram_notify_interval_sec') {
                    payload[key] = parseInt(value, 10);
                } else if (key === 'telegram_notify_enabled') {
                    payload[key] = value === '1' || value === 'true';
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
        if (!payload.telegram_routes || typeof payload.telegram_routes !== 'object') {
            payload.telegram_routes = { service: {}, vm: {}, node: {}, netdev: {} };
        }
        if (!Array.isArray(payload.telegram_notification_rules)) {
            payload.telegram_notification_rules = [];
        }
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
            thresholds: body.thresholds,
            monitor_theme: body.monitor_theme ?? body.monitorTheme,
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
            cluster_dashboard_tiles: body.cluster_dashboard_tiles ?? body.clusterDashboardTiles,
            dashboard_weather_city: body.dashboard_weather_city ?? body.dashboardWeatherCity,
            dashboard_timezone: body.dashboard_timezone ?? body.dashboardTimezone,
            speedtest_enabled: (() => {
                const v = body.speedtest_enabled ?? body.speedtestEnabled;
                if (v === undefined) return undefined;
                return v === true || v === '1' || v === 1 || v === 'true' ? '1' : '0';
            })(),
            speedtest_server: (() => {
                const v = body.speedtest_server ?? body.speedtestServer;
                if (v === undefined) return undefined;
                return String(v).trim();
            })(),
            speedtest_per_day: body.speedtest_per_day ?? body.speedtestPerDay,
            telegram_notify_enabled: (() => {
                const v = body.telegram_notify_enabled ?? body.telegramNotifyEnabled;
                if (v === undefined) return undefined;
                return v === true || v === '1' || v === 1 || v === 'true' ? '1' : '0';
            })(),
            telegram_notify_interval_sec: body.telegram_notify_interval_sec ?? body.telegramNotifyIntervalSec,
            telegram_routes: body.telegram_routes ?? body.telegramRoutes,
            telegram_notification_rules: body.telegram_notification_rules ?? body.telegramNotificationRules
        };
        const clearTg = body.telegram_clear_bot_token === true || body.telegramClearBotToken === true;
        const newTgTok = body.telegram_bot_token ?? body.telegramBotToken;
        if (clearTg) {
            store.setSetting('telegram_bot_token', '');
            map._telegram_cleared = true;
        } else if (newTgTok !== undefined && newTgTok !== null && String(newTgTok).trim() !== '') {
            store.setSetting('telegram_bot_token', String(newTgTok).trim());
            map._telegram_token_set = true;
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
        const { sendTelegramMessage, buildTelegramTestRuleMessage } = require('../telegram');
        const body = req.body || {};
        const rule = body.rule && typeof body.rule === 'object' ? body.rule : {};
        const chatId = String(rule.chatId != null ? rule.chatId : body.chatId || '').trim();
        if (!chatId) {
            return res.status(400).json({ success: false, error: 'chat_id required' });
        }
        const threadRaw = rule.threadId != null ? rule.threadId : body.threadId;
        const threadId = threadRaw != null && String(threadRaw).trim() !== '' ? threadRaw : undefined;

        let token = String(body.telegramBotToken ?? body.telegram_bot_token ?? '').trim();
        if (!token) token = String(store.getSetting('telegram_bot_token') || '').trim();
        if (!token) {
            return res.status(400).json({ success: false, error: 'bot_token required' });
        }

        const text = buildTelegramTestRuleMessage(rule);
        await sendTelegramMessage(token, chatId, text, threadId);
        res.json({ success: true });
    } catch (e) {
        log('warn', `[Settings] telegram-test-rule: ${e.message}`);
        res.status(500).json({ success: false, error: e.message || 'send failed' });
    }
});

module.exports = router;
