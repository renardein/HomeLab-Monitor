const { log } = require('../utils');
const connectionStore = require('../connection-store');

// Middleware для проверки авторизации (из заголовка или cookies)
function checkAuth(req, res, next) {
    const connectionId = req.headers['x-connection-id'];
    if (connectionId) {
        const conn = connectionStore.getConnectionById(String(connectionId));
        if (!conn || conn.type !== 'proxmox') {
            return res.status(401).json({ error: 'Неверный connectionId для Proxmox' });
        }
        req.token = conn.secret;
        req.serverUrl = conn.url;
        return next();
    }

    const authHeader = req.headers['authorization'] || req.headers['x-api-token'];
    const cookieToken = req.cookies?.proxmox_token;
    
    const token = authHeader || cookieToken;

    const serverUrlHeader = req.headers['x-server-url'];
    const cookieServer = req.cookies?.proxmox_server;
    req.serverUrl = (serverUrlHeader || cookieServer || null);
    
    if (!token) {
        log('warn', 'No token provided in request or cookies');
        return res.status(401).json({ 
            error: 'Требуется API токен'
        });
    }
    
    req.token = token;
    next();
}

module.exports = checkAuth;
