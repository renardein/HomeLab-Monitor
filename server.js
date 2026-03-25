const express = require('express');
const http = require('http');
const https = require('https');
const cors = require('cors');
const path = require('path');
const helmet = require('helmet');
const compression = require('compression');
const cookieParser = require('cookie-parser');
const config = require('./modules/config');
const i18n = require('./modules/i18n');
const { log } = require('./modules/utils');
const { getDb, closeDb } = require('./modules/db');

if (config.ssl.error) {
    log('error', '[Server] SSL misconfiguration', { error: config.ssl.error });
    process.exit(1);
}

// Создаем приложение
const app = express();

if (config.trustProxy) {
    app.set('trust proxy', config.trustProxy);
}

// EJS templates (for splitting index.html into partials safely)
app.set('views', path.join(__dirname, 'views'));
app.set('view engine', 'ejs');

// Middleware
app.use(helmet({
    contentSecurityPolicy: false
}));

app.use(cors({
    origin: config.corsOrigin,
    credentials: true
}));

app.use(compression());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(cookieParser());

// Логирование запросов
app.use((req, res, next) => {
    log('info', `${req.method} ${req.url}`);
    next();
});

// Старый `public/index.html` без EJS-шаблонов; иначе GET / отдаёт его вместо `views/index.ejs`
app.get('/index.html', (req, res) => {
    res.redirect(301, '/');
});

// Статические файлы (index: false — не подставлять index.html для GET /)
app.use(express.static(path.join(__dirname, 'public'), { index: false }));

// Подключаем маршруты
app.use('/api/status', require('./modules/routes/status'));
app.use('/api/auth', require('./modules/routes/auth'));
app.use('/api/health', require('./modules/routes/health'));
app.use('/api/cluster', require('./modules/routes/cluster'));
app.use('/api/nodes', require('./modules/routes/nodes'));
app.use('/api/storage', require('./modules/routes/storage'));
app.use('/api/backups', require('./modules/routes/backups'));
app.use('/api/truenas/auth', require('./modules/routes/truenas-auth'));
app.use('/api/truenas', require('./modules/routes/truenas-status'));
app.use('/api/connections', require('./modules/routes/connections'));
app.use('/api/settings', require('./modules/routes/settings'));
app.use('/api/about', require('./modules/routes/about'));
app.use('/api/updates', require('./modules/routes/updates'));
app.use('/api/ups', require('./modules/routes/ups'));
app.use('/api/smart-sensors', require('./modules/routes/smart-sensors'));
app.use('/api/netdevices', require('./modules/routes/netdevices-snmp'));
app.use('/api/host-metrics', require('./modules/routes/host-metrics'));
app.use('/api/speedtest', require('./modules/routes/speedtest'));

// Доступные языки
app.get('/api/languages', (req, res) => {
    res.json({
        available: i18n.getAvailableLanguages(),
        current: i18n.getLanguage()
    });
});

// Переводы для клиента
app.get('/api/translations', (req, res) => {
    const allTranslations = {};
    const availableLangs = i18n.getAvailableLanguages();
    
    for (const lang of availableLangs) {
        allTranslations[lang] = i18n.locales[lang];
    }
    
    res.json({ translations: allTranslations });
});

// Метрики для раздела отладки в настройках
app.get('/api/debug', (req, res) => {
    const fs = require('fs');
    const mem = process.memoryUsage();
    const uptime = process.uptime();
    const cache = require('./modules/cache');
    const db = require('./modules/db');
    const connStore = require('./modules/connection-store');
    const settingsStore = require('./modules/settings-store');
    const cacheStats = cache.stats && typeof cache.stats === 'function' ? cache.stats() : {};
    const cacheKeys = cache.keys && typeof cache.keys === 'function' ? cache.keys() : [];
    const logDir = process.env.LOG_DIR
        ? String(process.env.LOG_DIR)
        : path.join(__dirname, 'data', 'logs');
    const logFilePath = path.join(logDir, 'app.log');
    const rotated1Path = path.join(logDir, 'app.log.1');
    const logFileSizeBytes = fs.existsSync(logFilePath) ? fs.statSync(logFilePath).size : 0;
    const logRotated1SizeBytes = fs.existsSync(rotated1Path) ? fs.statSync(rotated1Path).size : 0;
    res.json({
        version: config.version,
        env: config.env,
        nodeVersion: process.version,
        platform: process.platform,
        arch: process.arch,
        uptimeSeconds: Math.floor(uptime),
        startTime: new Date(Date.now() - uptime * 1000).toISOString(),
        dbPath: typeof db.getDbPath === 'function' ? db.getDbPath() : null,
        memory: {
            rss: mem.rss,
            heapUsed: mem.heapUsed,
            heapTotal: mem.heapTotal,
            external: mem.external
        },
        cache: {
            keys: cacheKeys.length,
            hits: cacheStats.hits ?? 0,
            misses: cacheStats.misses ?? 0
        },
        connectionsCount: (() => { try { const L = connStore.listConnections(); return Array.isArray(L) ? L.length : 0; } catch (_) { return 0; } })(),
        settingsPasswordSet: !!settingsStore.hasSettingsPassword(),
        logs: {
            dir: logDir,
            appLogSizeBytes: logFileSizeBytes,
            appLog1SizeBytes: logRotated1SizeBytes
        }
    });
});

app.post('/api/cache/clear', (req, res) => {
    try {
        const cache = require('./modules/cache');
        if (typeof cache.flush === 'function') cache.flush();
        res.json({ success: true });
    } catch (e) {
        res.status(500).json({ success: false, error: e.message });
    }
});

// Перезапуск Node.js-приложения (процесс завершается, PM2/nodemon/systemd перезапустят)
app.post('/api/restart', (req, res) => {
    res.json({ success: true, message: 'Restarting...' });
    res.end();
    setTimeout(() => {
        closeDb();
        process.exit(0);
    }, 300);
});

// Тестовый эндпоинт для диагностики
app.get('/api/diagnose', (req, res) => {
    res.json({
        server: {
            port: config.port,
            bindHost: config.bindHost,
            env: config.env,
            version: config.version,
            https: config.ssl.enabled,
            trustProxy: !!config.trustProxy,
            publicUrl: config.publicUrl || null
        },
        proxmox: {
            host: config.proxmox.host,
            port: config.proxmox.port,
            url: `https://${config.proxmox.host}:${config.proxmox.port}`
        },
        truenas: {
            host: config.truenas.host,
            port: config.truenas.port,
            url: `https://${config.truenas.host}:${config.truenas.port}`
        },
        cors: {
            origin: config.corsOrigin
        },
        cache: {
            ttl: config.cacheTTL
        },
        language: config.defaultLanguage,
        availableLanguages: i18n.getAvailableLanguages(),
        cookies: {
            hasProxmoxToken: !!req.cookies.proxmox_token,
            hasTrueNASKey: !!req.cookies.truenas_key
        }
    });
});

// Проверка токена из cookies
app.get('/api/auth/check', (req, res) => {
    const token = req.cookies.proxmox_token;
    
    if (token) {
        res.json({ 
            authenticated: true,
            hasToken: true
        });
    } else {
        res.json({ 
            authenticated: false,
            hasToken: false
        });
    }
});

// Выход (удаление cookies)
app.post('/api/auth/logout', (req, res) => {
    res.clearCookie('proxmox_token', {
        httpOnly: true,
        secure: config.cookieSecure,
        sameSite: 'lax',
        path: '/'
    });
    
    res.json({ success: true, message: 'Выход выполнен' });
});

// Все остальные запросы отдаем index.html
app.get('*', (req, res) => {
    res.render('index');
});

// Обработка ошибок
app.use((err, req, res, next) => {
    log('error', `Unhandled error: ${err.message}`);
    // Частая причина: некорректный JSON в body (например, при ручных запросах)
    const isJsonParseError =
        err?.type === 'entity.parse.failed' ||
        (err instanceof SyntaxError && Object.prototype.hasOwnProperty.call(err, 'body'));
    
    if (isJsonParseError) {
        return res.status(400).json({ error: 'Некорректный JSON в запросе' });
    }
    
    res.status(500).json({ error: 'Внутренняя ошибка сервера' });
});

// Запуск сервера после инициализации SQLite
getDb()
    .then(() => {
        try {
            require('./modules/speedtest').startScheduler();
        } catch (e) {
            log('warn', `Speedtest scheduler: ${e.message}`);
        }
        try {
            require('./modules/monitor-notify').startMonitorNotifyScheduler();
        } catch (e) {
            log('warn', `Monitor notify scheduler: ${e.message}`);
        }
        const scheme = config.ssl.enabled ? 'https' : 'http';
        const publicBase = config.publicUrl || `${scheme}://localhost:${config.port}`;
        const srv = config.ssl.enabled
            ? https.createServer(config.ssl.options, app)
            : http.createServer(app);
        srv.listen(config.port, config.bindHost, () => {
            log('info', '[Server] started', {
                port: config.port,
                bind: config.bindHost,
                scheme: config.ssl.enabled ? 'HTTPS' : 'HTTP',
                env: config.env,
                db: 'SQLite (data/app.db)',
                proxmox: `${config.proxmox.host}:${config.proxmox.port}`,
                trustProxy: !!config.trustProxy,
                publicUrl: config.publicUrl || null,
                cookies: config.cookieSecure ? 'Secure' : 'Non-secure',
                url: publicBase
            });
        });
    })
    .catch((err) => {
        log('error', '[Server] DB init failed', { error: err?.message || String(err) });
        process.exit(1);
    });

process.on('SIGINT', () => { closeDb(); process.exit(0); });
process.on('SIGTERM', () => { closeDb(); process.exit(0); });
