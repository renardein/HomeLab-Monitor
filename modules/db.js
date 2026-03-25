const path = require('path');
const fs = require('fs');
const initSqlJs = require('sql.js');

const dataDir = path.join(__dirname, '..', 'data');
const dbPath = path.join(dataDir, 'app.db');

let db = null;
let SQL = null;

async function getSql() {
    if (SQL) return SQL;
    SQL = await initSqlJs();
    return SQL;
}

async function getDb() {
    if (db) return db;
    if (!fs.existsSync(dataDir)) fs.mkdirSync(dataDir, { recursive: true });
    const SQL = await getSql();
    const dbExisted = fs.existsSync(dbPath);
    if (dbExisted) {
        const buf = fs.readFileSync(dbPath);
        db = new SQL.Database(buf);
    } else {
        db = new SQL.Database();
    }
    const iconStylesMigrated = initSchema(db);
    migrateFromJson();
    if (!dbExisted || iconStylesMigrated) saveDb();
    return db;
}

function initSchema(database) {
    database.run(`
        CREATE TABLE IF NOT EXISTS connections (
            id TEXT PRIMARY KEY,
            type TEXT NOT NULL CHECK (type IN ('proxmox', 'truenas')),
            url TEXT NOT NULL,
            name TEXT,
            secret TEXT NOT NULL,
            createdAt TEXT NOT NULL,
            updatedAt TEXT NOT NULL
        )
    `);
    database.run(`CREATE INDEX IF NOT EXISTS idx_connections_type_url ON connections(type, url)`);

    database.run(`
        CREATE TABLE IF NOT EXISTS app_settings (
            key TEXT PRIMARY KEY,
            value TEXT NOT NULL DEFAULT ''
        )
    `);
    database.run(`
        CREATE TABLE IF NOT EXISTS monitored_services (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            name TEXT NOT NULL DEFAULT '',
            type TEXT NOT NULL DEFAULT 'tcp',
            host TEXT,
            port INTEGER,
            url TEXT,
            sort_order INTEGER NOT NULL DEFAULT 0,
            last_status TEXT,
            last_latency INTEGER
        )
    `);
    database.run(`
        CREATE TABLE IF NOT EXISTS speedtest_results (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            run_at TEXT NOT NULL,
            download_mbps REAL,
            upload_mbps REAL,
            ping_ms REAL,
            server_id TEXT,
            server_name TEXT,
            error TEXT
        )
    `);
    database.run(`CREATE INDEX IF NOT EXISTS idx_speedtest_run_at ON speedtest_results(run_at)`);

    database.run(`
        CREATE TABLE IF NOT EXISTS iperf3_results (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            run_at TEXT NOT NULL,
            download_mbps REAL,
            upload_mbps REAL,
            ping_ms REAL,
            server_id TEXT,
            server_name TEXT,
            error TEXT
        )
    `);
    database.run(`CREATE INDEX IF NOT EXISTS idx_iperf3_run_at ON iperf3_results(run_at)`);

    database.run(`
        CREATE TABLE IF NOT EXISTS monitor_icon_styles (
            scope TEXT NOT NULL CHECK (scope IN ('service', 'vm')),
            entity_id INTEGER NOT NULL,
            icon TEXT,
            color TEXT,
            PRIMARY KEY (scope, entity_id)
        )
    `);
    database.run(`CREATE INDEX IF NOT EXISTS idx_monitor_icon_styles_scope ON monitor_icon_styles(scope)`);

    return migrateIconStylesFromAppSettings(database);
}

/** Переносит JSON из app_settings в таблицу (один раз), затем удаляет старые ключи. Возвращает true, если нужен saveDb. */
function migrateIconStylesFromAppSettings(database) {
    const markerStmt = database.prepare('SELECT value FROM app_settings WHERE key = ?');
    markerStmt.bind(['icon_styles_migrated_v1']);
    let already = false;
    if (markerStmt.step()) {
        already = markerStmt.get()[0] === '1';
    }
    markerStmt.free();
    if (already) return false;

    const keys = ['monitor_service_icons', 'monitor_service_icon_colors', 'monitor_vm_icons', 'monitor_vm_icon_colors'];
    const stmt = database.prepare(`SELECT key, value FROM app_settings WHERE key IN ('${keys.join("','")}')`);
    const data = {};
    while (stmt.step()) {
        const row = stmt.get();
        data[row[0]] = row[1];
    }
    stmt.free();

    function parseObj(str) {
        if (!str) return {};
        try {
            const p = JSON.parse(str);
            return p && typeof p === 'object' && !Array.isArray(p) ? p : {};
        } catch {
            return {};
        }
    }

    function mergeInsert(scope, iconsJson, colorsJson) {
        const icons = parseObj(iconsJson);
        const colors = parseObj(colorsJson);
        const idSet = new Set([...Object.keys(icons), ...Object.keys(colors)]);
        const ins = database.prepare(
            'INSERT OR REPLACE INTO monitor_icon_styles (scope, entity_id, icon, color) VALUES (?, ?, ?, ?)'
        );
        for (const idStr of idSet) {
            const id = parseInt(idStr, 10);
            if (Number.isNaN(id)) continue;
            const rawIcon = icons[idStr];
            const rawCol = colors[idStr];
            const iconVal = rawIcon != null && String(rawIcon).trim() ? String(rawIcon).trim() : null;
            let colorVal = null;
            if (rawCol != null) {
                const c = String(rawCol).trim();
                if (/^#[0-9a-fA-F]{6}$/.test(c)) colorVal = c.toLowerCase();
                else if (/^#[0-9a-fA-F]{3}$/.test(c)) {
                    const x = c.slice(1).toLowerCase();
                    colorVal = '#' + x[0] + x[0] + x[1] + x[1] + x[2] + x[2];
                }
            }
            if (!iconVal && !colorVal) continue;
            ins.run([scope, id, iconVal, colorVal]);
        }
        ins.free();
    }

    mergeInsert('service', data.monitor_service_icons, data.monitor_service_icon_colors);
    mergeInsert('vm', data.monitor_vm_icons, data.monitor_vm_icon_colors);

    database.run(`INSERT OR REPLACE INTO app_settings (key, value) VALUES ('icon_styles_migrated_v1', '1')`);
    for (const k of keys) {
        database.run('DELETE FROM app_settings WHERE key = ?', [k]);
    }
    return true;
}

function saveDb() {
    if (!db) return;
    const data = db.export();
    const buf = Buffer.from(data);
    fs.writeFileSync(dbPath, buf);
}

async function migrateFromJson() {
    const storePath = path.join(dataDir, 'connections.json');
    if (!fs.existsSync(storePath)) return;
    let parsed;
    try {
        const raw = fs.readFileSync(storePath, 'utf8');
        parsed = JSON.parse(raw);
    } catch {
        return;
    }
    const connections = Array.isArray(parsed?.connections) ? parsed.connections : [];
    if (connections.length === 0) return;
    const stmt = db.prepare(`
        INSERT OR IGNORE INTO connections (id, type, url, name, secret, createdAt, updatedAt)
        VALUES (?, ?, ?, ?, ?, ?, ?)
    `);
    for (const c of connections) {
        if (c.id && c.type && c.url && c.secret) {
            stmt.run([
                c.id,
                c.type,
                c.url,
                c.name || null,
                c.secret,
                c.createdAt || new Date().toISOString(),
                c.updatedAt || new Date().toISOString()
            ]);
        }
    }
    stmt.free();
    saveDb();
    try {
        fs.renameSync(storePath, storePath + '.migrated');
    } catch (_) {}
}

function getDbSync() {
    if (!db) throw new Error('Database not initialized. Call getDb() at startup.');
    return db;
}

function closeDb() {
    if (db) {
        saveDb();
        db.close();
        db = null;
    }
}

function getDbPath() {
    return dbPath;
}

module.exports = {
    getDb,
    getDbSync,
    saveDb,
    closeDb,
    getDbPath
};
