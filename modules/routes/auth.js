const express = require('express');
const router = express.Router();
const proxmox = require('../proxmox-api');
const { log } = require('../utils');
const config = require('../config');

// Тест токена
router.post('/test', async (req, res) => {
    const { token, remember } = req.body;
    
    if (!token) {
        log('warn', 'Token test failed: no token provided');
        return res.status(400).json({ 
            success: false, 
            error: 'Токен не предоставлен' 
        });
    }
    
    log('info', 'Testing token');
    
    try {
        const nodes = await proxmox.getNodes(token);
        
        log('info', `Token test successful, found ${nodes.length} nodes`);
        
        if (remember) {
            const cookieOptions = {
                httpOnly: true,
                secure: config.env === 'production',
                sameSite: 'lax',
                path: '/',
                maxAge: 30 * 24 * 60 * 60 * 1000
            };
            
            res.cookie('proxmox_token', token, cookieOptions);
            log('info', 'Token saved to cookies');
        }
        
        res.json({ 
            success: true, 
            message: 'Подключение успешно',
            nodes: nodes.length
        });
        
    } catch (error) {
        log('error', `Token test failed: ${error.message}`);
        
        let errorMessage = 'Ошибка подключения';
        let statusCode = 401;
        
        if (error.code === 'ECONNREFUSED') {
            errorMessage = 'Сервер Proxmox недоступен. Проверьте host и port';
            statusCode = 503;
        } else if (error.code === 'ENOTFOUND') {
            errorMessage = 'Хост Proxmox не найден. Проверьте host';
            statusCode = 404;
        } else if (error.response) {
            if (error.response.status === 401) {
                errorMessage = 'Неверный API токен. Проверьте правильность токена';
            } else if (error.response.status === 403) {
                errorMessage = 'Недостаточно прав. Токену нужны права: Sys.Audit, VM.Audit';
            } else if (error.response.status === 404) {
                errorMessage = 'API endpoint не найден. Проверьте версию Proxmox';
            } else {
                errorMessage = `Ошибка API: ${error.response.status}`;
            }
        } else if (error.message.includes('timeout')) {
            errorMessage = 'Таймаут подключения. Сервер не отвечает';
            statusCode = 504;
        }
        
        res.status(statusCode).json({ 
            success: false, 
            error: errorMessage
        });
    }
});

// Получение токена из cookies
router.get('/token', (req, res) => {
    const token = req.cookies.proxmox_token;
    
    if (token) {
        res.json({ 
            success: true, 
            token: token
        });
    } else {
        res.json({ 
            success: false, 
            error: 'Токен не найден в cookies'
        });
    }
});

// Удаление токена из cookies
router.post('/logout', (req, res) => {
    res.clearCookie('proxmox_token', {
        httpOnly: true,
        secure: config.env === 'production',
        sameSite: 'lax',
        path: '/'
    });
    
    res.json({ success: true, message: 'Токен удален из cookies' });
});

module.exports = router;
