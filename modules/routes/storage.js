const express = require('express');
const router = express.Router();
const proxmox = require('../proxmox-api');
const cache = require('../cache');
const { formatBytes, log } = require('../utils');
const checkAuth = require('../middleware/auth');

// Информация о хранилищах
router.get('/', checkAuth, async (req, res) => {
    const cacheKey = `storage_${req.token}`;
    const cached = cache.get(cacheKey);
    
    if (cached) {
        return res.json(cached);
    }
    
    try {
        const nodes = await proxmox.getNodes(req.token);
        const allStorage = [];
        const storageMap = new Map();
        
        for (const node of nodes) {
            const nodeName = node.node || node.name;
            
            const storages = await proxmox.getNodeStorage(nodeName, req.token);
            
            storages.forEach(storage => {
                // Пропускаем отключенные
                if (storage.enabled !== 1) return;
                
                const storageId = `${storage.storage}_${storage.type}`;
                
                // Для NFS и shared хранилищ объединяем
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
                    existing.active = existing.active || (storage.active === 1);
                    
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
        
        // Добавляем объединенные NFS
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
        
        // Группировка по типам
        const byType = {};
        allStorage.forEach(s => {
            if (!byType[s.type]) {
                byType[s.type] = { count: 0, total: 0, used: 0 };
            }
            byType[s.type].count++;
            byType[s.type].total += s.total;
            byType[s.type].used += s.used;
        });
        
        const result = {
            all: allStorage,
            byType: byType,
            summary: {
                total: allStorage.length,
                active: allStorage.filter(s => s.active).length,
                total_space: allStorage.reduce((sum, s) => sum + s.total, 0),
                used_space: allStorage.reduce((sum, s) => sum + s.used, 0),
                total_space_fmt: formatBytes(allStorage.reduce((sum, s) => sum + s.total, 0)),
                used_space_fmt: formatBytes(allStorage.reduce((sum, s) => sum + s.used, 0))
            }
        };
        
        cache.set(cacheKey, result);
        res.json(result);
        
    } catch (error) {
        log('error', `Error fetching storage: ${error.message}`);
        if (error?.response?.status) {
            const st = error.response.status;
            res.status(st).json({ error: st === 401 ? 'Требуется API токен (или токен неверный)' : `Ошибка API: ${st}` });
        } else {
            res.status(500).json({ error: 'Ошибка получения данных хранилищ' });
        }
    }
});

module.exports = router;
