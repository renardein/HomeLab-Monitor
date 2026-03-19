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
    initSchema(db);
    migrateFromJson();
    if (!dbExisted) saveDb();
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
