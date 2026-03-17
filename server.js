const express = require('express');
const cors = require('cors');
const path = require('path');
const helmet = require('helmet');
const compression = require('compression');
const cookieParser = require('cookie-parser');
const config = require('./modules/config');
const i18n = require('./modules/i18n');
const { log } = require('./modules/utils');
const { getDb, closeDb } = require('./modules/db');

// Создаем приложение
const app = express();

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

// Статические файлы
app.use(express.static(path.join(__dirname, 'public')));

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

// Тестовый эндпоинт для диагностики
app.get('/api/diagnose', (req, res) => {
    res.json({
        server: {
            port: config.port,
            env: config.env,
            version: config.version
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
        secure: config.env === 'production',
        sameSite: 'lax',
        path: '/'
    });
    
    res.json({ success: true, message: 'Выход выполнен' });
});

// Все остальные запросы отдаем index.html
app.get('*', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'index.html'));
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
        app.listen(config.port, '0.0.0.0', () => {
            console.log('=================================');
            console.log(`Proxmox Monitor запущен на порту ${config.port}`);
            console.log('=================================');
            console.log(`Режим: ${config.env}`);
            console.log(`БД: SQLite (data/app.db)`);
            console.log(`Proxmox: ${config.proxmox.host}:${config.proxmox.port}`);
            console.log(`Cookies: ${config.env === 'production' ? 'Secure' : 'Development'}`);
            console.log('=================================');
            console.log(`URL: http://localhost:${config.port}`);
            console.log('=================================');
        });
    })
    .catch((err) => {
        console.error('Ошибка инициализации БД:', err);
        process.exit(1);
    });

process.on('SIGINT', () => { closeDb(); process.exit(0); });
process.on('SIGTERM', () => { closeDb(); process.exit(0); });
