const express = require('express');
const crypto = require('crypto');
const router = express.Router();
const truenas = require('../truenas-api');
const cache = require('../cache');
const { log } = require('../utils');
const checkTrueNASAuth = require('../middleware/truenas-auth');

function cacheKey(prefix, req) {
    const salt = `${req.serverUrl || 'default'}\n${req.apiKey || ''}`;
    const h = crypto.createHash('sha256').update(salt).digest('hex').slice(0, 16);
    return `truenas_${prefix}_${h}`;
}

const TTL = {
    system: 15,
    pools: 25,
    alerts: 8,
    services: 12,
    network: 20,
    disks: 30,
    scrubs: 45,
    apps: 15,
    overview: 10,
    capabilities: 300
};

async function respondWithCachedJson(req, res, prefix, ttlSec, producer) {
    const key = cacheKey(prefix, req);
    const cached = cache.get(key);
    if (cached) return res.json(cached);
    const payload = await producer();
    cache.set(key, payload, ttlSec);
    return res.json(payload);
}

function handleTrueNASError(res, error, fallbackMessage) {
    log('error', `${fallbackMessage}: ${error.message}`);
    const status = error?.response?.status;
    const msg = error?.response?.data?.message || error?.response?.data?.error || error.message;
    if (status) return res.status(status).json({ error: msg || `Ошибка API: ${status}` });
    return res.status(500).json({ error: fallbackMessage });
}

router.get('/system', checkTrueNASAuth, async (req, res) => {
    try {
        return respondWithCachedJson(req, res, 'system', TTL.system, async () => {
            return truenas.getSystemInfo(req.apiKey, req.serverUrl || null);
        });
    } catch (error) {
        return handleTrueNASError(res, error, 'Ошибка получения данных TrueNAS');
    }
});

router.get('/storage/pools', checkTrueNASAuth, async (req, res) => {
    try {
        return respondWithCachedJson(req, res, 'pools', TTL.pools, async () => {
            const pools = await truenas.getPools(req.apiKey, req.serverUrl || null);
            const all = pools.map((p) => {
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
            return {
                all,
                byType,
                summary: {
                    total: all.length,
                    active: all.filter((s) => s.active).length,
                    total_space,
                    used_space,
                    total_space_fmt: total_space,
                    used_space_fmt: used_space
                }
            };
        });
    } catch (error) {
        return handleTrueNASError(res, error, 'Ошибка получения пулов TrueNAS');
    }
});

router.get('/capabilities', checkTrueNASAuth, async (req, res) => {
    try {
        return respondWithCachedJson(req, res, 'capabilities', TTL.capabilities, async () => {
            return truenas.detectCapabilities(req.apiKey, req.serverUrl || null);
        });
    } catch (error) {
        return handleTrueNASError(res, error, 'Ошибка получения возможностей TrueNAS API');
    }
});

router.get('/alerts', checkTrueNASAuth, async (req, res) => {
    try {
        return respondWithCachedJson(req, res, 'alerts', TTL.alerts, async () => {
            const items = await truenas.getAlerts(req.apiKey, req.serverUrl || null);
            return { items, updatedAt: new Date().toISOString() };
        });
    } catch (error) {
        return handleTrueNASError(res, error, 'Ошибка получения алертов TrueNAS');
    }
});

router.get('/services', checkTrueNASAuth, async (req, res) => {
    try {
        return respondWithCachedJson(req, res, 'services', TTL.services, async () => {
            const items = await truenas.getServices(req.apiKey, req.serverUrl || null);
            return { items, updatedAt: new Date().toISOString() };
        });
    } catch (error) {
        return handleTrueNASError(res, error, 'Ошибка получения сервисов TrueNAS');
    }
});

router.get('/network', checkTrueNASAuth, async (req, res) => {
    try {
        return respondWithCachedJson(req, res, 'network', TTL.network, async () => {
            const items = await truenas.getInterfaces(req.apiKey, req.serverUrl || null);
            return { items, updatedAt: new Date().toISOString() };
        });
    } catch (error) {
        return handleTrueNASError(res, error, 'Ошибка получения сетевых данных TrueNAS');
    }
});

router.get('/disks', checkTrueNASAuth, async (req, res) => {
    try {
        return respondWithCachedJson(req, res, 'disks', TTL.disks, async () => {
            const items = await truenas.getDisks(req.apiKey, req.serverUrl || null);
            return { items, updatedAt: new Date().toISOString() };
        });
    } catch (error) {
        return handleTrueNASError(res, error, 'Ошибка получения дисков TrueNAS');
    }
});

router.get('/scrubs', checkTrueNASAuth, async (req, res) => {
    try {
        return respondWithCachedJson(req, res, 'scrubs', TTL.scrubs, async () => {
            const items = await truenas.getPoolScrubs(req.apiKey, req.serverUrl || null);
            return { items, updatedAt: new Date().toISOString() };
        });
    } catch (error) {
        return handleTrueNASError(res, error, 'Ошибка получения статуса scrub TrueNAS');
    }
});

router.get('/apps', checkTrueNASAuth, async (req, res) => {
    try {
        return respondWithCachedJson(req, res, 'apps', TTL.apps, async () => {
            const items = await truenas.getApps(req.apiKey, req.serverUrl || null);
            return {
                items,
                summary: {
                    total: items.length,
                    running: items.filter((x) => x.running).length,
                    stopped: items.filter((x) => !x.running).length
                },
                updatedAt: new Date().toISOString()
            };
        });
    } catch (error) {
        return handleTrueNASError(res, error, 'Ошибка получения приложений TrueNAS');
    }
});

router.get('/health-summary', checkTrueNASAuth, async (req, res) => {
    try {
        return respondWithCachedJson(req, res, 'health_summary', TTL.overview, async () => {
            const [system, pools, alerts, services, interfaces, disks, scrubs, apps, capabilities] = await Promise.all([
                truenas.getSystemInfo(req.apiKey, req.serverUrl || null),
                truenas.getPools(req.apiKey, req.serverUrl || null),
                truenas.getAlerts(req.apiKey, req.serverUrl || null).catch(() => []),
                truenas.getServices(req.apiKey, req.serverUrl || null).catch(() => []),
                truenas.getInterfaces(req.apiKey, req.serverUrl || null).catch(() => []),
                truenas.getDisks(req.apiKey, req.serverUrl || null).catch(() => []),
                truenas.getPoolScrubs(req.apiKey, req.serverUrl || null).catch(() => []),
                truenas.getApps(req.apiKey, req.serverUrl || null).catch(() => []),
                truenas.detectCapabilities(req.apiKey, req.serverUrl || null).catch(() => null)
            ]);
            return truenas.buildHealthSummary({ system, pools, alerts, services, interfaces, disks, scrubs, apps, capabilities });
        });
    } catch (error) {
        return handleTrueNASError(res, error, 'Ошибка получения health summary TrueNAS');
    }
});

router.get('/overview', checkTrueNASAuth, async (req, res) => {
    try {
        return respondWithCachedJson(req, res, 'overview', TTL.overview, async () => {
            const [system, pools, alerts, services, interfaces, disks, scrubs, reporting, apps, capabilities] = await Promise.all([
                truenas.getSystemInfo(req.apiKey, req.serverUrl || null),
                truenas.getPools(req.apiKey, req.serverUrl || null),
                truenas.getAlerts(req.apiKey, req.serverUrl || null).catch(() => []),
                truenas.getServices(req.apiKey, req.serverUrl || null).catch(() => []),
                truenas.getInterfaces(req.apiKey, req.serverUrl || null).catch(() => []),
                truenas.getDisks(req.apiKey, req.serverUrl || null).catch(() => []),
                truenas.getPoolScrubs(req.apiKey, req.serverUrl || null).catch(() => []),
                truenas.getReportingSnapshot(req.apiKey, req.serverUrl || null).catch(() => ({ graphs: [], graphCount: 0, updatedAt: new Date().toISOString() })),
                truenas.getApps(req.apiKey, req.serverUrl || null).catch(() => []),
                truenas.detectCapabilities(req.apiKey, req.serverUrl || null).catch(() => null)
            ]);
            const health = truenas.buildHealthSummary({ system, pools, alerts, services, interfaces, disks, scrubs, apps, capabilities });
            return { system, pools, alerts, services, interfaces, disks, scrubs, reporting, apps, capabilities, health, updatedAt: new Date().toISOString() };
        });
    } catch (error) {
        return handleTrueNASError(res, error, 'Ошибка получения overview TrueNAS');
    }
});

router.get('/debug/integration', checkTrueNASAuth, async (req, res) => {
    try {
        const stats = truenas.getStatsSnapshot();
        const capabilities = await truenas.detectCapabilities(req.apiKey, req.serverUrl || null).catch(() => null);
        return res.json({ now: new Date().toISOString(), serverUrl: req.serverUrl || null, capabilities, stats });
    } catch (error) {
        return handleTrueNASError(res, error, 'Ошибка диагностики интеграции TrueNAS');
    }
});

module.exports = router;

