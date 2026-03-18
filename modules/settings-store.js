const crypto = require('crypto');
const { getDbSync, saveDb } = require('./db');

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
    saveDb();
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
    const services = listMonitoredServices();
    return { settings, services };
}

function importSettingsAndServices(payload) {
    const db = getDbSync();
    const settings = payload && payload.settings && typeof payload.settings === 'object' ? payload.settings : {};
    const hasServices = Array.isArray(payload && payload.services);
    const services = hasServices ? payload.services : [];

    // apply settings (without touching password)
    for (const [key, value] of Object.entries(settings)) {
        if (!key || key === PASSWORD_KEY) continue;
        setSetting(key, value);
    }

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

function getMonitoredVmsExport() {
    return {
        monitor_vms: parseMonitorVmsFromStored(getSetting('monitor_vms')),
        monitor_hidden_vm_ids: parseHiddenVmIdsFromStored(getSetting('monitor_hidden_vm_ids'))
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
}

module.exports = {
    getSetting,
    setSetting,
    hasSettingsPassword,
    verifySettingsPassword,
    setSettingsPassword,
    clearSettingsPassword,
    listMonitoredServices,
    addMonitoredService,
    removeMonitoredService,
    updateMonitoredServiceStatus,
    exportSettingsAndServices,
    importSettingsAndServices,
    getMonitoredVmsExport,
    importMonitoredVmsConfig
};
