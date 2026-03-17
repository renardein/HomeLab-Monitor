const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const dataDir = path.join(__dirname, '..', 'data');
const storePath = path.join(dataDir, 'connections.json');

function ensureStoreFile() {
    if (!fs.existsSync(dataDir)) fs.mkdirSync(dataDir, { recursive: true });
    if (!fs.existsSync(storePath)) fs.writeFileSync(storePath, JSON.stringify({ connections: [] }, null, 2), 'utf8');
}

function readStore() {
    ensureStoreFile();
    const raw = fs.readFileSync(storePath, 'utf8');
    try {
        const parsed = JSON.parse(raw);
        if (!parsed || typeof parsed !== 'object') return { connections: [] };
        if (!Array.isArray(parsed.connections)) return { connections: [] };
        return parsed;
    } catch {
        return { connections: [] };
    }
}

function writeStore(store) {
    ensureStoreFile();
    fs.writeFileSync(storePath, JSON.stringify(store, null, 2), 'utf8');
}

function publicConnection(c) {
    return {
        id: c.id,
        type: c.type,
        url: c.url,
        name: c.name || null,
        updatedAt: c.updatedAt || null,
        createdAt: c.createdAt || null
    };
}

function listConnections() {
    const store = readStore();
    return store.connections.map(publicConnection);
}

function getConnectionById(id) {
    const store = readStore();
    return store.connections.find(c => c.id === id) || null;
}

function findByTypeUrl(type, url) {
    const store = readStore();
    return store.connections.find(c => c.type === type && c.url === url) || null;
}

function upsertConnection({ type, url, name = null, secret }) {
    const store = readStore();
    const now = new Date().toISOString();

    let existing = store.connections.find(c => c.type === type && c.url === url);
    if (existing) {
        existing.name = name || existing.name || null;
        existing.secret = secret;
        existing.updatedAt = now;
        writeStore(store);
        return publicConnection(existing);
    }

    const created = {
        id: crypto.randomUUID(),
        type,
        url,
        name,
        secret,
        createdAt: now,
        updatedAt: now
    };
    store.connections.push(created);
    writeStore(store);
    return publicConnection(created);
}

function deleteConnection(id) {
    const store = readStore();
    const before = store.connections.length;
    store.connections = store.connections.filter(c => c.id !== id);
    writeStore(store);
    return store.connections.length !== before;
}

module.exports = {
    listConnections,
    getConnectionById,
    findByTypeUrl,
    upsertConnection,
    deleteConnection
};

