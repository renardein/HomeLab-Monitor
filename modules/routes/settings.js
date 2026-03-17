const express = require('express');
const router = express.Router();
const store = require('../settings-store');

const SETTING_KEYS = [
    'theme', 'refresh_interval', 'units', 'thresholds',
    'monitor_theme', 'monitor_mode', 'server_type',
    'current_server_index', 'current_truenas_index',
    'proxmox_servers', 'truenas_servers', 'connection_id_map',
    'preferred_language'
];

// GET /api/settings — все настройки (без пароля), флаг password_required
router.get('/', (req, res) => {
    try {
        const payload = { password_required: store.hasSettingsPassword() };
        for (const key of SETTING_KEYS) {
            const value = store.getSetting(key);
            if (value !== null && value !== undefined && value !== '') {
                if (key === 'thresholds' || key === 'proxmox_servers' || key === 'truenas_servers' || key === 'connection_id_map') {
                    try {
                        payload[key] = JSON.parse(value);
                    } catch {
                        payload[key] = value;
                    }
                } else if (key === 'refresh_interval' || key === 'current_server_index' || key === 'current_truenas_index') {
                    payload[key] = parseInt(value, 10);
                } else {
                    payload[key] = value;
                }
            }
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
            preferred_language: body.preferred_language ?? body.preferredLanguage
        };
        for (const [key, value] of Object.entries(map)) {
            if (value === undefined) continue;
            if (typeof value === 'object' && value !== null && !Array.isArray(value)) {
                store.setSetting(key, JSON.stringify(value));
            } else {
                store.setSetting(key, value);
            }
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

// GET /api/settings/export — экспорт настроек и сервисов мониторинга (без пароля)
router.get('/export', (req, res) => {
    try {
        const data = store.exportSettingsAndServices();
        res.json(data);
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
});

// POST /api/settings/import — импорт настроек и сервисов мониторинга
router.post('/import', (req, res) => {
    try {
        const payload = req.body;
        if (!payload || typeof payload !== 'object') {
            return res.status(400).json({ success: false, error: 'invalid_payload' });
        }
        store.importSettingsAndServices(payload);
        res.json({ success: true });
    } catch (e) {
        res.status(500).json({ success: false, error: e.message });
    }
});

module.exports = router;
