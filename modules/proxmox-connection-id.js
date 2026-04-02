'use strict';

const connectionStore = require('./connection-store');

function safeString(v) {
    return v == null ? '' : String(v);
}

/** Resolves Proxmox connection UUID from X-Connection-Id or X-Server-Url + DB. */
function resolveProxmoxConnectionId(req) {
    if (!req) return null;
    const headerId = safeString(req.headers && req.headers['x-connection-id']).trim();
    if (headerId) return headerId;
    const url = safeString(req.serverUrl).trim();
    if (url) {
        const conn = connectionStore.findByTypeUrl('proxmox', url);
        if (conn && conn.id) return conn.id;
    }
    return null;
}

module.exports = { resolveProxmoxConnectionId };
