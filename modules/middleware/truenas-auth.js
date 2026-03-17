const { log } = require('../utils');

function checkTrueNASAuth(req, res, next) {
    const authHeader = req.headers['authorization'] || req.headers['x-api-key'];
    const cookieKey = req.cookies?.truenas_key;
    const apiKey = authHeader || cookieKey;

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

