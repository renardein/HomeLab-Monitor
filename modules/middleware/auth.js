const { log } = require('../utils');

// Middleware для проверки авторизации (из заголовка или cookies)
function checkAuth(req, res, next) {
    const authHeader = req.headers['authorization'] || req.headers['x-api-token'];
    const cookieToken = req.cookies?.proxmox_token;
    
    const token = authHeader || cookieToken;
    
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
