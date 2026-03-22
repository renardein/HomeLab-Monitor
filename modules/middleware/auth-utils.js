'use strict';

const settingsStore = require('../settings-store');

function normalizeServerUrl(u) {
    try {
        const url = new URL(String(u).trim());
        if (!url.protocol.startsWith('http')) return null;
        return url.toString().replace(/\/+$/, '');
    } catch {
        return null;
    }
}

/**
 * При авторизации по connectionId выбранный в UI хост (X-Server-Url) должен иметь приоритет над url в строке connections,
 * но только если он есть в сохранённом списке серверов (защита от подмены произвольного URL).
 */
function resolveServerUrlForConnection(req, connectionRowUrl, settingKey) {
    const headerRaw = req.headers['x-server-url'];
    if (!headerRaw || !String(headerRaw).trim()) return connectionRowUrl;
    const candidate = normalizeServerUrl(headerRaw);
    if (!candidate) return connectionRowUrl;
    try {
        const raw = settingsStore.getSetting(settingKey);
        const list = JSON.parse(raw || '[]');
        if (!Array.isArray(list)) return connectionRowUrl;
        const ok = list.some((item) => normalizeServerUrl(item) === candidate);
        return ok ? candidate : connectionRowUrl;
    } catch {
        return connectionRowUrl;
    }
}

module.exports = {
    normalizeServerUrl,
    resolveServerUrlForConnection
};
