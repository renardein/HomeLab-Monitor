const express = require('express');
const router = express.Router();
const proxmox = require('../proxmox-api');
const { log } = require('../utils');
const checkAuth = require('../middleware/auth');
const { getCachedOrFetch } = require('../proxmox-route-cache');

router.get('/', checkAuth, async (req, res) => {
    try {
        const orderedNodes = await getCachedOrFetch('nodes', req, async () => {
            const [nodes, clusterStatus] = await Promise.all([
                proxmox.getNodes(req.token, req.serverUrl || null),
                proxmox.getClusterStatus(req.token, req.serverUrl || null)
            ]);
            return proxmox.sortRowsByClusterNodeOrder(nodes, clusterStatus);
        });
        res.json(orderedNodes);
    } catch (error) {
        log('error', `Error fetching nodes: ${error.message}`);
        if (error?.response?.status) {
            const st = error.response.status;
            res.status(st).json({
                error: st === 401 ? 'Требуется API токен (или токен неверный)' : `Ошибка API: ${st}`
            });
        } else {
            res.status(500).json({ error: 'Ошибка получения списка узлов' });
        }
    }
});

router.get('/:node/status', checkAuth, async (req, res) => {
    const { node } = req.params;
    const prefix = `node_status_${String(node || '').replace(/[^\w.-]/g, '_')}`;

    try {
        const status = await getCachedOrFetch(prefix, req, () =>
            proxmox.getNodeStatus(node, req.token, req.serverUrl || null)
        );
        res.json(status);
    } catch (error) {
        log('error', `Error fetching node ${node} status: ${error.message}`);
        if (error?.response?.status) {
            const st = error.response.status;
            res.status(st).json({
                error: st === 401 ? 'Требуется API токен (или токен неверный)' : `Ошибка API: ${st}`
            });
        } else {
            res.status(500).json({ error: `Ошибка получения статуса узла ${node}` });
        }
    }
});

module.exports = router;
