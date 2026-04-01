const express = require('express');
const router = express.Router();
const proxmox = require('../proxmox-api');
const { formatBytes, log } = require('../utils');
const checkAuth = require('../middleware/auth');
const { getCachedOrFetch } = require('../proxmox-route-cache');

function buildStorageResult(nodes, storagesByNode) {
    const allStorage = [];
    const storageMap = new Map();

    for (const node of nodes) {
        const nodeName = node.node || node.name;
        const storages = storagesByNode.get(nodeName) || [];

        storages.forEach((storage) => {
            if (storage.enabled !== 1) return;

            const storageId = `${storage.storage}_${storage.type}`;

            if (storage.shared === 1 && storage.type === 'nfs') {
                if (!storageMap.has(storageId)) {
                    storageMap.set(storageId, {
                        name: storage.storage,
                        type: storage.type,
                        server: storage.server || 'N/A',
                        export: storage.export || 'N/A',
                        content: storage.content || [],
                        nodes: [],
                        total: 0,
                        used: 0,
                        active: false
                    });
                }

                const existing = storageMap.get(storageId);
                existing.nodes.push(nodeName);
                existing.total = storage.total || 0;
                existing.used = storage.used || 0;
                existing.active = existing.active || storage.active === 1;
            } else {
                allStorage.push({
                    id: storageId,
                    node: nodeName,
                    name: storage.storage,
                    type: storage.type,
                    server: storage.server || null,
                    export: storage.export || null,
                    used: storage.used || 0,
                    total: storage.total || 0,
                    used_fmt: formatBytes(storage.used),
                    total_fmt: formatBytes(storage.total),
                    usage_percent: storage.total > 0 ? Math.round((storage.used / storage.total) * 100) : 0,
                    content: storage.content || [],
                    active: storage.active === 1,
                    shared: storage.shared === 1
                });
            }
        });
    }

    storageMap.forEach((value) => {
        allStorage.push({
            node: value.nodes.join(', '),
            name: value.name,
            type: value.type,
            server: value.server,
            export: value.export,
            used: value.used,
            total: value.total,
            used_fmt: formatBytes(value.used),
            total_fmt: formatBytes(value.total),
            usage_percent: value.total > 0 ? Math.round((value.used / value.total) * 100) : 0,
            content: value.content,
            active: value.active,
            shared: true,
            nodes: value.nodes
        });
    });

    const byType = {};
    allStorage.forEach((s) => {
        if (!byType[s.type]) {
            byType[s.type] = { count: 0, total: 0, used: 0 };
        }
        byType[s.type].count++;
        byType[s.type].total += s.total;
        byType[s.type].used += s.used;
    });

    return {
        all: allStorage,
        byType,
        summary: {
            total: allStorage.length,
            active: allStorage.filter((s) => s.active).length,
            total_space: allStorage.reduce((sum, s) => sum + s.total, 0),
            used_space: allStorage.reduce((sum, s) => sum + s.used, 0),
            total_space_fmt: formatBytes(allStorage.reduce((sum, s) => sum + s.total, 0)),
            used_space_fmt: formatBytes(allStorage.reduce((sum, s) => sum + s.used, 0))
        }
    };
}

router.get('/', checkAuth, async (req, res) => {
    try {
        const result = await getCachedOrFetch('storage', req, async () => {
            const nodes = await proxmox.getNodes(req.token, req.serverUrl || null);
            const rows = await Promise.all(
                nodes.map(async (node) => {
                    const nodeName = node.node || node.name;
                    const storages = await proxmox.getNodeStorage(nodeName, req.token, req.serverUrl || null);
                    return { nodeName, storages };
                })
            );
            const storagesByNode = new Map(rows.map((r) => [r.nodeName, r.storages]));
            return buildStorageResult(nodes, storagesByNode);
        });
        res.json(result);
    } catch (error) {
        log('error', `Error fetching storage: ${error.message}`);
        if (error?.response?.status) {
            const st = error.response.status;
            res.status(st).json({
                error: st === 401 ? 'Требуется API токен (или токен неверный)' : `Ошибка API: ${st}`
            });
        } else {
            res.status(500).json({ error: 'Ошибка получения данных хранилищ' });
        }
    }
});

module.exports = router;
