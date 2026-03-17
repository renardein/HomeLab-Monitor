const express = require('express');
const router = express.Router();
const truenas = require('../truenas-api');
const cache = require('../cache');
const { log } = require('../utils');
const checkTrueNASAuth = require('../middleware/truenas-auth');

router.get('/system', checkTrueNASAuth, async (req, res) => {
    const cacheKey = `truenas_system_${req.apiKey}`;
    const cached = cache.get(cacheKey);
    if (cached) return res.json(cached);

    try {
        const info = await truenas.getSystemInfo(req.apiKey, req.serverUrl || null);
        cache.set(cacheKey, info);
        res.json(info);
    } catch (error) {
        log('error', `Error fetching TrueNAS system info: ${error.message}`);
        if (error?.response?.status) {
            res.status(error.response.status).json({ error: `Ошибка API: ${error.response.status}` });
        } else {
            res.status(500).json({ error: 'Ошибка получения данных TrueNAS' });
        }
    }
});

router.get('/storage/pools', checkTrueNASAuth, async (req, res) => {
    const cacheKey = `truenas_pools_${req.apiKey}`;
    const cached = cache.get(cacheKey);
    if (cached) return res.json(cached);

    try {
        const pools = await truenas.getPools(req.apiKey, req.serverUrl || null);

        const all = pools.map(p => {
            const total = p.total ?? 0;
            const used = p.used ?? 0;
            const usage_percent = total > 0 ? Math.round((used / total) * 100) : 0;
            return {
                node: 'truenas',
                name: p.name,
                type: 'pool',
                server: null,
                export: null,
                used,
                total,
                used_fmt: used,
                total_fmt: total,
                usage_percent,
                content: [],
                active: p.healthy === null ? true : !!p.healthy,
                shared: true,
                status: p.status || null
            };
        });

        const byType = { pool: { count: all.length, total: all.reduce((s, x) => s + x.total, 0), used: all.reduce((s, x) => s + x.used, 0) } };
        const total_space = byType.pool.total;
        const used_space = byType.pool.used;

        const result = {
            all,
            byType,
            summary: {
                total: all.length,
                active: all.filter(s => s.active).length,
                total_space,
                used_space,
                total_space_fmt: total_space,
                used_space_fmt: used_space
            }
        };

        cache.set(cacheKey, result);
        res.json(result);
    } catch (error) {
        log('error', `Error fetching TrueNAS pools: ${error.message}`);
        if (error?.response?.status) {
            res.status(error.response.status).json({ error: `Ошибка API: ${error.response.status}` });
        } else {
            res.status(500).json({ error: 'Ошибка получения пулов TrueNAS' });
        }
    }
});

module.exports = router;

