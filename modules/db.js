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
    const schemaMigrated = initSchema(db);
    migrateFromJson();
    if (!dbExisted || schemaMigrated) saveDb();
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

    database.run(`
        CREATE TABLE IF NOT EXISTS host_node_metric_samples (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            connection_id TEXT NOT NULL,
            node_name TEXT NOT NULL,
            recorded_at TEXT NOT NULL,
            temp_c REAL,
            cpu_usage_pct REAL,
            mem_usage_pct REAL
        )
    `);
    database.run(
        `CREATE INDEX IF NOT EXISTS idx_host_node_metric_conn_node_time ON host_node_metric_samples (connection_id, node_name, recorded_at)`
    );
    database.run(`CREATE INDEX IF NOT EXISTS idx_host_node_metric_time ON host_node_metric_samples (recorded_at)`);

    database.run(`
        CREATE TABLE IF NOT EXISTS cluster_aggregate_samples (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            connection_id TEXT NOT NULL,
            recorded_at TEXT NOT NULL,
            cpu_usage_pct REAL NOT NULL,
            mem_usage_pct REAL NOT NULL
        )
    `);
    database.run(
        `CREATE INDEX IF NOT EXISTS idx_cluster_agg_conn_time ON cluster_aggregate_samples (connection_id, recorded_at)`
    );
    database.run(`CREATE INDEX IF NOT EXISTS idx_cluster_agg_time ON cluster_aggregate_samples (recorded_at)`);

    database.run(`
        CREATE TABLE IF NOT EXISTS ups_metric_samples (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            ups_slot INTEGER NOT NULL,
            recorded_at TEXT NOT NULL,
            metric_id TEXT NOT NULL,
            metric_format TEXT NOT NULL,
            metric_value REAL NOT NULL
        )
    `);
    database.run(`CREATE INDEX IF NOT EXISTS idx_ups_metric_conn_metric_time ON ups_metric_samples (ups_slot, metric_id, recorded_at)`);
    database.run(`CREATE INDEX IF NOT EXISTS idx_ups_metric_time ON ups_metric_samples (recorded_at)`);

    const iconMigrated = migrateIconStylesFromAppSettings(database);
    const hostMetricMigrated = migrateHostCpuTempToNodeMetrics(database);
    return iconMigrated || hostMetricMigrated;
}

/** Однократный перенос host_cpu_temp_samples → host_node_metric_samples (nullable метрики). */
function migrateHostCpuTempToNodeMetrics(database) {
    const markerStmt = database.prepare('SELECT value FROM app_settings WHERE key = ?');
    markerStmt.bind(['host_node_metric_table_v1']);
    if (markerStmt.step() && markerStmt.get()[0] === '1') {
        markerStmt.free();
        return false;
    }
    markerStmt.free();

    const oldStmt = database.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name='host_cpu_temp_samples' LIMIT 1");
    const hasOld = oldStmt.step();
    oldStmt.free();
    if (hasOld) {
        database.run(`INSERT INTO host_node_metric_samples (connection_id, node_name, recorded_at, temp_c, cpu_usage_pct, mem_usage_pct)
            SELECT connection_id, node_name, recorded_at, temp_c, NULL, NULL FROM host_cpu_temp_samples`);
        database.run(`DROP TABLE host_cpu_temp_samples`);
    }
    database.run(`INSERT OR REPLACE INTO app_settings (key, value) VALUES ('host_node_metric_table_v1', '1')`);
    return true;
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
