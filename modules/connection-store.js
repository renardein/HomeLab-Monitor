const crypto = require('crypto');
const { getDbSync, saveDb } = require('./db');

function publicConnection(row) {
    return {
        id: row.id,
        type: row.type,
        url: row.url,
        name: row.name || null,
        updatedAt: row.updatedAt || null,
        createdAt: row.createdAt || null
    };
}

function listConnections() {
    const db = getDbSync();
    const stmt = db.prepare('SELECT id, type, url, name, createdAt, updatedAt FROM connections ORDER BY createdAt ASC');
    const rows = [];
    while (stmt.step()) rows.push(stmt.get());
    stmt.free();
    return rows.map((row) => ({
        id: row[0],
        type: row[1],
        url: row[2],
        name: row[3] || null,
        createdAt: row[4],
        updatedAt: row[5]
    }));
}

function getConnectionById(id) {
    const db = getDbSync();
    const stmt = db.prepare('SELECT id, type, url, name, secret, createdAt, updatedAt FROM connections WHERE id = ?');
    stmt.bind([String(id)]);
    if (!stmt.step()) {
        stmt.free();
        return null;
    }
    const row = stmt.get();
    stmt.free();
    return {
        id: row[0],
        type: row[1],
        url: row[2],
        name: row[3] || null,
        secret: row[4],
        createdAt: row[5],
        updatedAt: row[6]
    };
}

function findByTypeUrl(type, url) {
    const db = getDbSync();
    const stmt = db.prepare('SELECT id, type, url, name, secret, createdAt, updatedAt FROM connections WHERE type = ? AND url = ?');
    stmt.bind([String(type), String(url)]);
    if (!stmt.step()) {
        stmt.free();
        return null;
    }
    const row = stmt.get();
    stmt.free();
    return {
        id: row[0],
        type: row[1],
        url: row[2],
        name: row[3] || null,
        secret: row[4],
        createdAt: row[5],
        updatedAt: row[6]
    };
}

function upsertConnection({ type, url, name = null, secret }) {
    const db = getDbSync();
    const now = new Date().toISOString();
    const existing = findByTypeUrl(type, url);

    if (existing) {
        db.run('UPDATE connections SET name = ?, secret = ?, updatedAt = ? WHERE id = ?', [name || null, secret, now, existing.id]);
        saveDb();
        const updated = getConnectionById(existing.id);
        return publicConnection(updated);
    }

    const id = crypto.randomUUID();
    db.run(
        'INSERT INTO connections (id, type, url, name, secret, createdAt, updatedAt) VALUES (?, ?, ?, ?, ?, ?, ?)',
        [id, type, url, name || null, secret, now, now]
    );
    saveDb();
    const created = getConnectionById(id);
    return publicConnection(created);
}

function deleteConnection(id) {
    const existing = getConnectionById(id);
    if (!existing) return false;
    const db = getDbSync();
    db.run('DELETE FROM connections WHERE id = ?', [String(id)]);
    saveDb();
    return true;
}

function exportConnectionsWithSecrets() {
    const db = getDbSync();
    const stmt = db.prepare('SELECT id, type, url, name, secret, createdAt, updatedAt FROM connections ORDER BY createdAt ASC');
    const rows = [];
    while (stmt.step()) rows.push(stmt.get());
    stmt.free();
    return rows.map((row) => ({
        id: row[0],
        type: row[1],
        url: row[2],
        name: row[3] || null,
        secret: row[4],
        createdAt: row[5],
        updatedAt: row[6]
    }));
}

function importConnectionsWithSecrets(list) {
    const db = getDbSync();
    db.run('DELETE FROM connections');
    if (Array.isArray(list) && list.length) {
        const stmt = db.prepare('INSERT INTO connections (id, type, url, name, secret, createdAt, updatedAt) VALUES (?, ?, ?, ?, ?, ?, ?)');
        for (const c of list) {
            stmt.run([
                c.id || crypto.randomUUID(),
                String(c.type || 'proxmox'),
                String(c.url || ''),
                c.name != null ? String(c.name) : null,
                String(c.secret || ''),
                c.createdAt || new Date().toISOString(),
                c.updatedAt || new Date().toISOString()
            ]);
        }
        stmt.free();
    }
    saveDb();
}

function clearConnections() {
    const db = getDbSync();
    db.run('DELETE FROM connections');
    saveDb();
}

/** Удаляет только подключения указанного типа (proxmox | truenas). */
function deleteConnectionsByType(type) {
    const t = String(type || '').toLowerCase();
    if (t !== 'proxmox' && t !== 'truenas') return false;
    const db = getDbSync();
    db.run('DELETE FROM connections WHERE type = ?', [t]);
    saveDb();
    return true;
}

module.exports = {
    listConnections,
    getConnectionById,
    findByTypeUrl,
    upsertConnection,
    deleteConnection,
    exportConnectionsWithSecrets,
    importConnectionsWithSecrets,
    clearConnections,
    deleteConnectionsByType
};
