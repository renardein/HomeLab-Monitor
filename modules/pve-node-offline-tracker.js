'use strict';

const crypto = require('crypto');
const store = require('./settings-store');
const connectionStore = require('./connection-store');
const { normalizeServerUrl } = require('./middleware/auth-utils');

const SETTING_KEY = 'pve_node_offline_tracking';

function loadAll() {
    try {
        const raw = store.getSetting(SETTING_KEY);
        if (!raw) return {};
        const p = JSON.parse(raw);
        return p && typeof p === 'object' && !Array.isArray(p) ? p : {};
    } catch {
        return {};
    }
}

function saveAll(data) {
    store.setSetting(SETTING_KEY, JSON.stringify(data));
}

/**
 * Ключ области: подключение Proxmox (предпочтительно connection id из заголовка / хранилища).
 */
function getScopeKeyFromRequest(req) {
    if (req && req.headers && req.headers['x-connection-id']) {
        return 'c:' + String(req.headers['x-connection-id']).trim();
    }
    const urlRaw = String((req && req.serverUrl) || '').trim();
    const tok = String((req && req.token) || '').trim();
    const urlNorm = normalizeServerUrl(urlRaw) || urlRaw;
    if (urlNorm && tok) {
        const conn = connectionStore.findByTypeUrl('proxmox', urlNorm);
        if (conn && conn.secret === tok) {
            return 'c:' + String(conn.id);
        }
        const h = crypto.createHash('sha256').update(String(urlNorm) + '\n' + tok).digest('hex').slice(0, 32);
        return 'h:' + h;
    }
    if (tok) return 't:' + crypto.createHash('sha256').update(tok).digest('hex').slice(0, 32);
    return null;
}

function getScopeKeyFromConnectionId(connectionId) {
    const id = connectionId != null ? String(connectionId).trim() : '';
    return id ? 'c:' + id : null;
}

/**
 * Обновляет сохранённые отметки «с какого момента узел офлайн» по списку имён и флагу online.
 * @param {string|null} scopeKey
 * @param {{ name: string, online: boolean }[]} items
 */
function applyOfflineStatusList(scopeKey, items) {
    if (!scopeKey || !Array.isArray(items) || !items.length) return;

    const all = loadAll();
    let scopeMap = all[scopeKey];
    if (!scopeMap || typeof scopeMap !== 'object' || Array.isArray(scopeMap)) scopeMap = {};

    const nextScope = {};

    for (const it of items) {
        if (!it || !it.name) continue;
        const name = String(it.name);
        const online = !!it.online;
        if (online) {
            nextScope[name] = null;
        } else {
            const prevTs = scopeMap[name];
            nextScope[name] = typeof prevTs === 'string' && prevTs ? prevTs : new Date().toISOString();
        }
    }

    all[scopeKey] = nextScope;
    saveAll(all);
}

/**
 * Подставляет в объекты узлов поле offlineSince (ISO или null).
 * @param {string|null} scopeKey
 * @param {Array<{ name: string }>} nodes
 */
function attachOfflineSinceToNodes(scopeKey, nodes) {
    if (!scopeKey || !Array.isArray(nodes)) return;
    const all = loadAll();
    const scopeMap = all[scopeKey] && typeof all[scopeKey] === 'object' ? all[scopeKey] : {};
    for (const node of nodes) {
        if (!node || !node.name) continue;
        const ts = scopeMap[String(node.name)];
        node.offlineSince = ts && typeof ts === 'string' ? ts : null;
    }
}

function applyOfflineToClusterNodes(scopeKey, nodes) {
    if (!scopeKey || !Array.isArray(nodes)) return;
    const items = nodes
        .filter((n) => n && n.name)
        .map((n) => ({
            name: String(n.name),
            online: String(n.status || '').toLowerCase() === 'online'
        }));
    applyOfflineStatusList(scopeKey, items);
    attachOfflineSinceToNodes(scopeKey, nodes);
}

function getOfflineSinceIso(scopeKey, nodeName) {
    if (!scopeKey || !nodeName) return null;
    const all = loadAll();
    const scopeMap = all[scopeKey];
    if (!scopeMap || typeof scopeMap !== 'object') return null;
    const ts = scopeMap[String(nodeName)];
    return ts && typeof ts === 'string' ? ts : null;
}

module.exports = {
    getScopeKeyFromRequest,
    getScopeKeyFromConnectionId,
    applyOfflineStatusList,
    attachOfflineSinceToNodes,
    applyOfflineToClusterNodes,
    getOfflineSinceIso
};
