const crypto = require('crypto');
const { getDbSync, saveDb } = require('./db');

function normalizeIconMapInput(obj) {
    if (!obj || typeof obj !== 'object' || Array.isArray(obj)) return {};
    const out = {};
    for (const [key, raw] of Object.entries(obj)) {
        const id = Number(key);
        const icon = raw != null ? String(raw).trim() : '';
        if (!Number.isNaN(id) && icon) out[String(id)] = icon;
    }
    return out;
}

function normalizeColorMapInput(obj) {
    if (!obj || typeof obj !== 'object' || Array.isArray(obj)) return {};
    const out = {};
    for (const [key, raw] of Object.entries(obj)) {
        const id = Number(key);
        if (Number.isNaN(id)) continue;
        const c = raw != null ? String(raw).trim() : '';
        if (/^#[0-9a-fA-F]{6}$/.test(c)) out[String(id)] = c.toLowerCase();
        else if (/^#[0-9a-fA-F]{3}$/.test(c)) {
            const x = c.slice(1).toLowerCase();
            out[String(id)] = '#' + x[0] + x[0] + x[1] + x[1] + x[2] + x[2];
        }
    }
    return out;
}

/** Иконки и цвета VM/сервисов — таблица monitor_icon_styles (не JSON в app_settings). */
function getMonitorIconMapsFromDb() {
    const db = getDbSync();
    const out = {
        monitor_service_icons: {},
        monitor_service_icon_colors: {},
        monitor_vm_icons: {},
        monitor_vm_icon_colors: {}
    };
    const stmt = db.prepare('SELECT scope, entity_id, icon, color FROM monitor_icon_styles');
    while (stmt.step()) {
        const row = stmt.get();
        const scope = row[0];
        const entityId = row[1];
        const icon = row[2];
        const color = row[3];
        const idStr = String(entityId);
        if (scope === 'service') {
            if (icon) out.monitor_service_icons[idStr] = icon;
            if (color) out.monitor_service_icon_colors[idStr] = color;
        } else if (scope === 'vm') {
            if (icon) out.monitor_vm_icons[idStr] = icon;
            if (color) out.monitor_vm_icon_colors[idStr] = color;
        }
    }
    stmt.free();
    return out;
}

/**
 * Полная замена строк scope по объединённым картам (с учётом частичных обновлений).
 * @param {'service'|'vm'} scope
 */
function replaceMonitorIconScope(scope, iconsMap, colorsMap) {
    if (scope !== 'service' && scope !== 'vm') return;
    const cur = getMonitorIconMapsFromDb();
    const iconsKey = scope === 'service' ? 'monitor_service_icons' : 'monitor_vm_icons';
    const colorsKey = scope === 'service' ? 'monitor_service_icon_colors' : 'monitor_vm_icon_colors';
    const icons = iconsMap !== undefined ? normalizeIconMapInput(iconsMap) : { ...cur[iconsKey] };
    const colors = colorsMap !== undefined ? normalizeColorMapInput(colorsMap) : { ...cur[colorsKey] };
    const db = getDbSync();
    db.run('DELETE FROM monitor_icon_styles WHERE scope = ?', [scope]);
    const idSet = new Set([
        ...Object.keys(icons).map((k) => parseInt(k, 10)),
        ...Object.keys(colors).map((k) => parseInt(k, 10))
    ]);
    const ins = db.prepare('INSERT INTO monitor_icon_styles (scope, entity_id, icon, color) VALUES (?, ?, ?, ?)');
    for (const id of idSet) {
        if (Number.isNaN(id)) continue;
        const idStr = String(id);
        const iconVal = icons[idStr] || null;
        const colorVal = colors[idStr] || null;
        if (!iconVal && !colorVal) continue;
        ins.run([scope, id, iconVal || null, colorVal || null]);
    }
    ins.free();
    saveDb();
}

function deleteMonitorIconStyle(scope, entityId) {
    const id = parseInt(entityId, 10);
    if (Number.isNaN(id)) return;
    const db = getDbSync();
    db.run('DELETE FROM monitor_icon_styles WHERE scope = ? AND entity_id = ?', [scope, id]);
    saveDb();
}

function applyIconMapsFromImportedSettings(settings) {
    if (!settings || typeof settings !== 'object') return;
    const parse = (k) => {
        if (!Object.prototype.hasOwnProperty.call(settings, k)) return undefined;
        const raw = settings[k];
        if (raw == null || raw === '') return undefined;
        if (typeof raw === 'object' && !Array.isArray(raw)) {
            return k.includes('color') ? normalizeColorMapInput(raw) : normalizeIconMapInput(raw);
        }
        try {
            const p = JSON.parse(String(raw));
            if (typeof p !== 'object' || !p || Array.isArray(p)) return undefined;
            return k.includes('color') ? normalizeColorMapInput(p) : normalizeIconMapInput(p);
        } catch {
            return undefined;
        }
    };
    if (settings.monitor_service_icons !== undefined || settings.monitor_service_icon_colors !== undefined) {
        replaceMonitorIconScope('service', parse('monitor_service_icons'), parse('monitor_service_icon_colors'));
    }
    if (settings.monitor_vm_icons !== undefined || settings.monitor_vm_icon_colors !== undefined) {
        replaceMonitorIconScope('vm', parse('monitor_vm_icons'), parse('monitor_vm_icon_colors'));
    }
}

const PASSWORD_KEY = 'password';
const SALT_LENGTH = 32;
const PBKDF2_ITERATIONS = 100000;
const HASH_LENGTH = 64;

function getSetting(key) {
    const db = getDbSync();
    const stmt = db.prepare('SELECT value FROM app_settings WHERE key = ?');
    stmt.bind([String(key)]);
    const hasRow = stmt.step();
    const value = hasRow ? stmt.get()[0] : null;
    stmt.free();
    return value;
}

function setSetting(key, value) {
    const db = getDbSync();
    const str = value == null ? '' : (typeof value === 'string' ? value : JSON.stringify(value));
    db.run('INSERT OR REPLACE INTO app_settings (key, value) VALUES (?, ?)', [String(key), str]);
    saveDb();
}

// Password: store { salt, hash } in app_settings['password']
function hashPassword(password, salt) {
    return crypto.pbkdf2Sync(String(password), salt, PBKDF2_ITERATIONS, HASH_LENGTH, 'sha512').toString('hex');
}

function hasSettingsPassword() {
    const raw = getSetting(PASSWORD_KEY);
    if (!raw) return false;
    try {
        const data = JSON.parse(raw);
        return !!(data && data.salt && data.hash);
    } catch {
        return false;
    }
}

function verifySettingsPassword(password) {
    const raw = getSetting(PASSWORD_KEY);
    if (!raw) return false;
    try {
        const data = JSON.parse(raw);
        if (!data || !data.salt || !data.hash) return false;
        const hash = hashPassword(password, Buffer.from(data.salt, 'hex'));
        return crypto.timingSafeEqual(Buffer.from(data.hash, 'hex'), Buffer.from(hash, 'hex'));
    } catch {
        return false;
    }
}

function setSettingsPassword(newPassword) {
    const salt = crypto.randomBytes(SALT_LENGTH);
    const hash = hashPassword(newPassword, salt);
    setSetting(PASSWORD_KEY, JSON.stringify({
        salt: salt.toString('hex'),
        hash: hash
    }));
}

function clearSettingsPassword() {
    setSetting(PASSWORD_KEY, '');
}

function resetAllSettingsPreservingPassword() {
    const db = getDbSync();
    // Preserve settings password itself; clear everything else.
    db.run('DELETE FROM app_settings WHERE key != ?', [PASSWORD_KEY]);
    db.run('DELETE FROM monitor_icon_styles');
    saveDb();
}

function clearMonitoredServices() {
    const db = getDbSync();
    db.run('DELETE FROM monitored_services');
    db.run("DELETE FROM monitor_icon_styles WHERE scope = 'service'");
    saveDb();
}

// Monitored services
function listMonitoredServices() {
    const db = getDbSync();
    const stmt = db.prepare('SELECT id, name, type, host, port, url, sort_order, last_status, last_latency FROM monitored_services ORDER BY sort_order ASC, id ASC');
    const rows = [];
    while (stmt.step()) rows.push(stmt.get());
    stmt.free();
    return rows.map((row) => ({
        id: row[0],
        name: row[1] || '',
        type: row[2] || 'tcp',
        host: row[3] || null,
        port: row[4] != null ? row[4] : null,
        url: row[5] || null,
        sort_order: row[6] || 0,
        lastStatus: row[7] || null,
        lastLatency: row[8] != null ? row[8] : null
    }));
}

function addMonitoredService(service) {
    const db = getDbSync();
    const name = String(service.name || '').trim() || null;
    const type = String(service.type || 'tcp').toLowerCase().trim();
    const host = service.host != null ? String(service.host).trim() : null;
    const port = service.port != null ? parseInt(service.port, 10) : null;
    const url = service.url != null ? String(service.url).trim() : null;
    const sortOrder = service.sort_order != null ? parseInt(service.sort_order, 10) : 0;
    const stmt = db.prepare('INSERT INTO monitored_services (name, type, host, port, url, sort_order) VALUES (?, ?, ?, ?, ?, ?)');
    stmt.run([name, type, host, port, url, sortOrder]);
    stmt.free();
    const idStmt = db.prepare('SELECT last_insert_rowid()');
    idStmt.step();
    const id = idStmt.get()[0];
    idStmt.free();
    saveDb();
    return id;
}

function removeMonitoredService(id) {
    const db = getDbSync();
    const stmt = db.prepare('DELETE FROM monitored_services WHERE id = ?');
    stmt.run([parseInt(id, 10)]);
    stmt.free();
    deleteMonitorIconStyle('service', id);
    return true;
}

function updateMonitoredServiceStatus(id, lastStatus, lastLatency) {
    const db = getDbSync();
    const stmt = db.prepare('UPDATE monitored_services SET last_status = ?, last_latency = ? WHERE id = ?');
    stmt.run([lastStatus || null, lastLatency != null ? lastLatency : null, parseInt(id, 10)]);
    stmt.free();
    saveDb();
}

function exportSettingsAndServices() {
    const db = getDbSync();
    const settings = {};
    const stmt = db.prepare('SELECT key, value FROM app_settings');
    while (stmt.step()) {
        const [key, value] = stmt.get();
        if (!key || key === PASSWORD_KEY) continue;
        settings[key] = value;
    }
    stmt.free();
    const iconMaps = getMonitorIconMapsFromDb();
    settings.monitor_service_icons = JSON.stringify(iconMaps.monitor_service_icons);
    settings.monitor_service_icon_colors = JSON.stringify(iconMaps.monitor_service_icon_colors);
    settings.monitor_vm_icons = JSON.stringify(iconMaps.monitor_vm_icons);
    settings.monitor_vm_icon_colors = JSON.stringify(iconMaps.monitor_vm_icon_colors);
    const services = listMonitoredServices();
    return { settings, services };
}

const ICON_MAP_SETTING_KEYS = new Set([
    'monitor_service_icons',
    'monitor_service_icon_colors',
    'monitor_vm_icons',
    'monitor_vm_icon_colors'
]);

function importSettingsAndServices(payload) {
    const db = getDbSync();
    const settings = payload && payload.settings && typeof payload.settings === 'object' ? payload.settings : {};
    const hasServices = Array.isArray(payload && payload.services);
    const services = hasServices ? payload.services : [];

    // apply settings (without touching password); иконки — только в таблице monitor_icon_styles
    for (const [key, value] of Object.entries(settings)) {
        if (!key || key === PASSWORD_KEY) continue;
        if (ICON_MAP_SETTING_KEYS.has(key)) continue;
        setSetting(key, value);
    }
    applyIconMapsFromImportedSettings(settings);

    // replace monitored services only if services were provided
    if (hasServices) {
        db.run('DELETE FROM monitored_services');
        if (services.length) {
            const insert = db.prepare('INSERT INTO monitored_services (name, type, host, port, url, sort_order, last_status, last_latency) VALUES (?, ?, ?, ?, ?, ?, ?, ?)');
            for (const svc of services) {
                insert.run([
                    svc.name != null ? String(svc.name).trim() : null,
                    (svc.type || 'tcp').toLowerCase().trim(),
                    svc.host != null ? String(svc.host).trim() : null,
                    svc.port != null ? parseInt(svc.port, 10) : null,
                    svc.url != null ? String(svc.url).trim() : null,
                    svc.sort_order != null ? parseInt(svc.sort_order, 10) : 0,
                    svc.lastStatus != null ? String(svc.lastStatus) : null,
                    svc.lastLatency != null ? parseInt(svc.lastLatency, 10) : null
                ]);
            }
            insert.free();
        }
    }
    saveDb();
}

function parseMonitorVmsFromStored(raw) {
    if (!raw) return [];
    try {
        const p = JSON.parse(raw);
        if (!Array.isArray(p)) return [];
        return p
            .map(x => (typeof x === 'number' ? x : Number(x && (x.vmid ?? x.id))))
            .filter(n => !Number.isNaN(n));
    } catch {
        return [];
    }
}

function parseHiddenVmIdsFromStored(raw) {
    if (!raw) return [];
    try {
        const h = JSON.parse(raw);
        if (!Array.isArray(h)) return [];
        return h.map(Number).filter(n => !Number.isNaN(n));
    } catch {
        return [];
    }
}

function parseIconMapFromStored(raw) {
    if (!raw) return {};
    try {
        const parsed = JSON.parse(raw);
        if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return {};
        const out = {};
        for (const [key, value] of Object.entries(parsed)) {
            const id = Number(key);
            const icon = value != null ? String(value).trim() : '';
            if (!Number.isNaN(id) && icon) out[String(id)] = icon;
        }
        return out;
    } catch {
        return {};
    }
}

function parseColorMapFromStored(raw) {
    if (!raw) return {};
    try {
        const parsed = JSON.parse(raw);
        if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return {};
        const out = {};
        for (const [key, value] of Object.entries(parsed)) {
            const id = Number(key);
            const color = value != null ? String(value).trim() : '';
            if (!Number.isNaN(id) && /^#[0-9a-fA-F]{6}$/.test(color)) out[String(id)] = color.toLowerCase();
        }
        return out;
    } catch {
        return {};
    }
}

function getMonitoredServicesExport() {
    const maps = getMonitorIconMapsFromDb();
    return {
        services: listMonitoredServices(),
        monitor_service_icons: maps.monitor_service_icons,
        monitor_service_icon_colors: maps.monitor_service_icon_colors
    };
}

function importMonitoredServicesConfig(payload) {
    if (!payload || typeof payload !== 'object') return;
    if (Array.isArray(payload.services)) {
        importSettingsAndServices({ services: payload.services });
    }
    if (
        (payload.monitor_service_icons && typeof payload.monitor_service_icons === 'object' && !Array.isArray(payload.monitor_service_icons)) ||
        (payload.monitor_service_icon_colors && typeof payload.monitor_service_icon_colors === 'object' && !Array.isArray(payload.monitor_service_icon_colors))
    ) {
        replaceMonitorIconScope(
            'service',
            payload.monitor_service_icons,
            payload.monitor_service_icon_colors
        );
    }
}

function getMonitoredVmsExport() {
    const maps = getMonitorIconMapsFromDb();
    return {
        monitor_vms: parseMonitorVmsFromStored(getSetting('monitor_vms')),
        monitor_hidden_vm_ids: parseHiddenVmIdsFromStored(getSetting('monitor_hidden_vm_ids')),
        monitor_vm_icons: maps.monitor_vm_icons,
        monitor_vm_icon_colors: maps.monitor_vm_icon_colors
    };
}

/** Apply VM/CT monitoring lists; only keys that are arrays are updated. */
function importMonitoredVmsConfig(payload) {
    if (!payload || typeof payload !== 'object') return;
    if (Array.isArray(payload.monitor_vms)) {
        const arr = payload.monitor_vms
            .map(x => (typeof x === 'number' ? x : Number(x && (x.vmid ?? x.id))))
            .filter(n => !Number.isNaN(n));
        setSetting('monitor_vms', JSON.stringify(arr));
    }
    if (Array.isArray(payload.monitor_hidden_vm_ids)) {
        setSetting(
            'monitor_hidden_vm_ids',
            JSON.stringify(payload.monitor_hidden_vm_ids.map(Number).filter(n => !Number.isNaN(n)))
        );
    }
    if (
        (payload.monitor_vm_icons && typeof payload.monitor_vm_icons === 'object' && !Array.isArray(payload.monitor_vm_icons)) ||
        (payload.monitor_vm_icon_colors && typeof payload.monitor_vm_icon_colors === 'object' && !Array.isArray(payload.monitor_vm_icon_colors))
    ) {
        replaceMonitorIconScope('vm', payload.monitor_vm_icons, payload.monitor_vm_icon_colors);
    }
}

module.exports = {
    getSetting,
    setSetting,
    hasSettingsPassword,
    verifySettingsPassword,
    setSettingsPassword,
    clearSettingsPassword,
    resetAllSettingsPreservingPassword,
    clearMonitoredServices,
    listMonitoredServices,
    addMonitoredService,
    removeMonitoredService,
    updateMonitoredServiceStatus,
    exportSettingsAndServices,
    importSettingsAndServices,
    getMonitoredServicesExport,
    importMonitoredServicesConfig,
    getMonitoredVmsExport,
    importMonitoredVmsConfig,
    getMonitorIconMapsFromDb,
    replaceMonitorIconScope
};
