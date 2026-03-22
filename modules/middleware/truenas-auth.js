const { log } = require('../utils');
const connectionStore = require('../connection-store');
const { resolveServerUrlForConnection } = require('./auth-utils');

function checkTrueNASAuth(req, res, next) {
    const connectionId = req.headers['x-connection-id'];
    if (connectionId) {
        const conn = connectionStore.getConnectionById(String(connectionId));
        if (!conn || conn.type !== 'truenas') {
            return res.status(401).json({ error: 'Неверный connectionId для TrueNAS' });
        }
        req.apiKey = conn.secret;
        req.serverUrl = resolveServerUrlForConnection(req, conn.url, 'truenas_servers');
        return next();
    }

    let apiKey = req.headers['authorization'] || req.headers['x-api-key'] || req.cookies?.truenas_key;
    if (apiKey && typeof apiKey === 'string') {
        if (apiKey.toLowerCase().startsWith('bearer ')) apiKey = apiKey.slice(7).trim();
        else apiKey = apiKey.trim();
    }

    const serverUrlHeader = req.headers['x-server-url'];
    const cookieServer = req.cookies?.truenas_server;
    req.serverUrl = (serverUrlHeader || cookieServer || null);

    if (!apiKey) {
        log('warn', 'No TrueNAS key provided in request or cookies');
        return res.status(401).json({
            error: 'Требуется TrueNAS API Key'
        });
    }

    req.apiKey = apiKey;
    next();
}

module.exports = checkTrueNASAuth;

