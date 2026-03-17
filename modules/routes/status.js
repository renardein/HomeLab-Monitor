const express = require('express');
const router = express.Router();
const config = require('../config');
const { log } = require('../utils');

// Статус сервера
router.get('/', (req, res) => {
    log('info', 'Status check');
    
    res.json({
        status: 'ok',
        timestamp: new Date().toISOString(),
        server: 'Proxmox Monitor',
        version: config.version,
        proxmox: {
            host: config.proxmox.host,
            port: config.proxmox.port
        }
    });
});

module.exports = router;
