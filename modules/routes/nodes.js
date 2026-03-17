const express = require('express');
const router = express.Router();
const proxmox = require('../proxmox-api');
const cache = require('../cache');
const { log } = require('../utils');
const checkAuth = require('../middleware/auth');

// Список узлов
router.get('/', checkAuth, async (req, res) => {
    const cacheKey = `nodes_${req.token}`;
    const cached = cache.get(cacheKey);
    
    if (cached) {
        return res.json(cached);
    }
    
    try {
        const nodes = await proxmox.getNodes(req.token);
        cache.set(cacheKey, nodes);
        res.json(nodes);
    } catch (error) {
        log('error', `Error fetching nodes: ${error.message}`);
        res.status(500).json({ error: 'Ошибка получения списка узлов' });
    }
});

// Статус конкретного узла
router.get('/:node/status', checkAuth, async (req, res) => {
    const { node } = req.params;
    const cacheKey = `node_status_${node}_${req.token}`;
    const cached = cache.get(cacheKey);
    
    if (cached) {
        return res.json(cached);
    }
    
    try {
        const status = await proxmox.getNodeStatus(node, req.token);
        cache.set(cacheKey, status);
        res.json(status);
    } catch (error) {
        log('error', `Error fetching node ${node} status: ${error.message}`);
        res.status(500).json({ error: `Ошибка получения статуса узла ${node}` });
    }
});

module.exports = router;
