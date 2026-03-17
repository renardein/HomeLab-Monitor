const express = require('express');
const router = express.Router();
const truenas = require('../truenas-api');
const { log } = require('../utils');
const config = require('../config');

router.post('/test', async (req, res) => {
    const { apiKey, token, remember, serverUrl } = req.body || {};
    const key = apiKey || token; // allow reuse of existing UI field name

    if (!key) {
        log('warn', 'TrueNAS key test failed: no key provided');
        return res.status(400).json({
            success: false,
            error: 'API Key не предоставлен'
        });
    }

    log('info', 'Testing TrueNAS API key');

    try {
        const info = await truenas.getSystemInfo(key, serverUrl || null);

        if (remember) {
            const cookieOptions = {
                httpOnly: true,
                secure: config.env === 'production',
                sameSite: 'lax',
                path: '/',
                maxAge: 30 * 24 * 60 * 60 * 1000
            };
            res.cookie('truenas_key', key, cookieOptions);
            if (serverUrl) res.cookie('truenas_server', serverUrl, cookieOptions);
        }

        res.json({
            success: true,
            message: 'Подключение к TrueNAS успешно',
            system: {
                hostname: info?.hostname || info?.system_hostname || null,
                version: info?.version || info?.product_version || null
            }
        });
    } catch (error) {
        log('error', `TrueNAS key test failed: ${error.message}`);

        let errorMessage = 'Ошибка подключения к TrueNAS';
        let statusCode = 401;

        if (error.code === 'ECONNREFUSED') {
            errorMessage = 'TrueNAS недоступен. Проверьте host и port';
            statusCode = 503;
        } else if (error.code === 'ENOTFOUND') {
            errorMessage = 'Хост TrueNAS не найден. Проверьте host';
            statusCode = 404;
        } else if (error.response) {
            statusCode = error.response.status || statusCode;
            if (statusCode === 401 || statusCode === 403) {
                errorMessage = 'Неверный API Key или недостаточно прав';
            } else {
                errorMessage = `Ошибка API: ${statusCode}${error.response.statusText ? ` ${error.response.statusText}` : ''}`;
            }
        } else if (String(error.message || '').includes('timeout')) {
            errorMessage = 'Таймаут подключения. Сервер не отвечает';
            statusCode = 504;
        }

        res.status(statusCode).json({
            success: false,
            error: errorMessage
        });
    }
});

router.get('/key', (req, res) => {
    const key = req.cookies.truenas_key;
    if (key) {
        res.json({ success: true, apiKey: key, serverUrl: req.cookies.truenas_server || null });
    } else {
        res.json({ success: false, error: 'API Key не найден в cookies' });
    }
});

router.post('/logout', (req, res) => {
    res.clearCookie('truenas_key', {
        httpOnly: true,
        secure: config.env === 'production',
        sameSite: 'lax',
        path: '/'
    });
    res.clearCookie('truenas_server', {
        httpOnly: true,
        secure: config.env === 'production',
        sameSite: 'lax',
        path: '/'
    });

    res.json({ success: true, message: 'API Key удален из cookies' });
});

module.exports = router;

