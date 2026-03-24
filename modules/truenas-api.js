const axios = require('axios');
const https = require('https');
const { constants: cryptoConstants, createHash } = require('crypto');
const config = require('./config');
const { log } = require('./utils');
const cache = require('./cache');

const httpsAgent = new https.Agent({
    rejectUnauthorized: false,
    secureOptions: cryptoConstants.SSL_OP_NO_TLSv1 | cryptoConstants.SSL_OP_NO_TLSv1_1
});

const METHOD_PROBES = {
    alerts: ['/alert/list', '/alert'],
    services: ['/service', '/service/query'],
    interfaces: ['/interface', '/interface/query'],
    disks: ['/disk', '/disk/query'],
    scrubs: ['/pool/scrub', '/pool/scrub/query'],
    reportingGraphs: ['/reporting/netdata/graphs', '/reporting/graph'],
    apps: ['/app', '/app/query']
};

const capabilityCache = new Map();
const integrationStats = {
    callsTotal: 0,
    byMethod: {},
    errorsByClass: {},
    lastError: null
};
const inFlightGetRequests = new Map();

function buildRequestCacheKey(baseUrl, endpoint, apiKey) {
    const keyHash = createHash('sha1').update(String(apiKey || '')).digest('hex').slice(0, 16);
    return `tn_req_${createHash('sha1').update(`${baseUrl}|${endpoint}|${keyHash}`).digest('hex')}`;
}

function getBaseUrl(serverUrl) {
    if (serverUrl) {
        const u = new URL(serverUrl);
        const port = u.port ? `:${u.port}` : '';
        return `${u.protocol}//${u.hostname}${port}/api/v2.0`;
    }
    const host = config.truenas?.host;
    const port = config.truenas?.port;
    return `https://${host}:${port}/api/v2.0`;
}

function classifyTrueNASError(error) {
    const status = Number(error?.response?.status || 0);
    const code = String(error?.code || '').toUpperCase();
    if (status === 401 || status === 403) return 'auth';
    if (status === 404 || status === 405) return 'unsupported_method';
    if (status >= 500) return 'remote_server';
    if (status >= 400) return 'bad_request';
    if (code === 'ETIMEDOUT' || code === 'ECONNABORTED') return 'timeout';
    if (code === 'ECONNREFUSED' || code === 'ENOTFOUND') return 'unreachable';
    return 'unknown';
}

function updateIntegrationStats(method, startedMs, error) {
    const elapsedMs = Math.max(0, Date.now() - startedMs);
    integrationStats.callsTotal += 1;
    if (!integrationStats.byMethod[method]) {
        integrationStats.byMethod[method] = {
            calls: 0,
            ok: 0,
            failed: 0,
            avgLatencyMs: 0,
            lastLatencyMs: 0,
            lastOkAt: null,
            lastErrorAt: null,
            lastErrorClass: null
        };
    }
    const m = integrationStats.byMethod[method];
    m.calls += 1;
    m.lastLatencyMs = elapsedMs;
    m.avgLatencyMs = Math.round(((m.avgLatencyMs * (m.calls - 1)) + elapsedMs) / m.calls);
    if (!error) {
        m.ok += 1;
        m.lastOkAt = new Date().toISOString();
    } else {
        const cls = classifyTrueNASError(error);
        m.failed += 1;
        m.lastErrorAt = new Date().toISOString();
        m.lastErrorClass = cls;
        integrationStats.errorsByClass[cls] = (integrationStats.errorsByClass[cls] || 0) + 1;
        integrationStats.lastError = {
            at: new Date().toISOString(),
            method,
            class: cls,
            message: error?.message || String(error),
            status: error?.response?.status || null
        };
    }
}

function getStatsSnapshot() {
    return {
        callsTotal: integrationStats.callsTotal,
        errorsByClass: { ...integrationStats.errorsByClass },
        byMethod: JSON.parse(JSON.stringify(integrationStats.byMethod)),
        lastError: integrationStats.lastError ? { ...integrationStats.lastError } : null
    };
}

function capabilityCacheKey(apiKey, serverUrl) {
    return `${getBaseUrl(serverUrl)}|${String(apiKey || '').slice(0, 12)}`;
}

async function request(endpoint, apiKey, method = 'GET', data = null, serverUrl = null) {
    const baseUrl = getBaseUrl(serverUrl);
    const url = `${baseUrl}${endpoint}`;
    const normalizedKey = apiKey ? String(apiKey).trim() : null;
    const startMs = Date.now();
    const upperMethod = String(method || 'GET').toUpperCase();
    const shouldUseCache = upperMethod === 'GET' && (data === null || data === undefined);
    const cacheKey = shouldUseCache ? buildRequestCacheKey(baseUrl, endpoint, normalizedKey) : null;
    const statMethod = `${String(method || 'GET').toUpperCase()} ${endpoint}`;

    log('debug', `TrueNAS API Request: ${method} ${url}`);

    if (shouldUseCache && cacheKey) {
        const cached = cache.get(cacheKey);
        if (cached !== undefined) return cached;
        if (inFlightGetRequests.has(cacheKey)) {
            return inFlightGetRequests.get(cacheKey);
        }
    }

    try {
        const execRequest = async () => {
            const axiosConfig = {
                method,
                url,
                headers: {
                    ...(normalizedKey ? { Authorization: `Bearer ${normalizedKey}` } : {}),
                    Accept: 'application/json'
                },
                httpsAgent,
                timeout: 10000,
                validateStatus: () => true
            };
            if (data !== null && data !== undefined && upperMethod !== 'GET' && upperMethod !== 'HEAD') {
                axiosConfig.data = data;
                axiosConfig.headers['Content-Type'] = 'application/json';
            }

            const response = await axios(axiosConfig);
            if (response.status >= 400) {
                const err = new Error(`HTTP ${response.status}: ${response.statusText}`);
                err.response = response;
                throw err;
            }
            if (shouldUseCache && cacheKey) {
                cache.set(cacheKey, response.data, config.cacheTTLs.status);
            }
            updateIntegrationStats(statMethod, startMs, null);
            return response.data;
        };

        if (shouldUseCache && cacheKey) {
            const promise = execRequest().finally(() => {
                inFlightGetRequests.delete(cacheKey);
            });
            inFlightGetRequests.set(cacheKey, promise);
            return await promise;
        }
        return await execRequest();
    } catch (error) {
        const status = error?.response?.status;
        const statusText = error?.response?.statusText;
        log('error', `TrueNAS API Error: ${error.message}${status ? ` (HTTP ${status}${statusText ? ` ${statusText}` : ''})` : ''}`);
        if (error.response) {
            updateIntegrationStats(statMethod, startMs, error);
            throw error;
        }
        if (error.code === 'ECONNREFUSED' || error.code === 'ENOTFOUND' || error.code === 'ETIMEDOUT') {
            const err = new Error(error.code === 'ETIMEDOUT' ? 'Connection timeout' : (error.code === 'ENOTFOUND' ? 'Host not found' : 'Connection refused'));
            err.code = error.code;
            updateIntegrationStats(statMethod, startMs, err);
            throw err;
        }
        updateIntegrationStats(statMethod, startMs, error);
        throw error;
    }
}

function parseIntLike(x) {
    if (x === null || x === undefined) return null;
    if (typeof x === 'number') return Number.isFinite(x) ? x : null;
    const n = parseFloat(String(x));
    return Number.isFinite(n) ? n : null;
}

function extractBytes(value) {
    if (value === null || value === undefined) return null;
    if (typeof value === 'number') return value;
    if (typeof value === 'object') {
        if (typeof value.rawvalue === 'number') return value.rawvalue;
        if (typeof value.parsed === 'number') return value.parsed;
        if (typeof value.value === 'number') return value.value;
    }
    return parseIntLike(value);
}

function extractPowerOnHours(disk) {
    const direct = parseIntLike(
        disk?.power_on_hours
        ?? disk?.hours
        ?? disk?.smart_poweron_hours
        ?? disk?.smart?.power_on_hours
        ?? disk?.smart_info?.power_on_hours
    );
    if (Number.isFinite(direct)) return direct;
    const attrs = Array.isArray(disk?.smart_attributes) ? disk.smart_attributes : [];
    for (const attr of attrs) {
        const key = String(attr?.name || attr?.attribute || '').toLowerCase();
        if (key.includes('power') && key.includes('hour')) {
            const v = parseIntLike(attr?.raw ?? attr?.value ?? attr?.rawvalue);
            if (Number.isFinite(v)) return v;
        }
    }
    return null;
}

function parsePoolList(data) {
    if (Array.isArray(data)) return data;
    if (data && typeof data === 'object' && Array.isArray(data.pools)) return data.pools;
    if (data && typeof data === 'object' && Array.isArray(data.pool)) return data.pool;
    return [];
}

async function getSystemInfo(apiKey, serverUrl = null) {
    let raw;
    try {
        raw = await request('/system/info', apiKey, 'GET', null, serverUrl);
    } catch (e) {
        if (e?.response?.status === 404) {
            const ver = await request('/system/version', apiKey, 'GET', null, serverUrl);
            raw = typeof ver === 'string' ? { version: ver } : (ver || {});
        } else {
            throw e;
        }
    }
    const hostname = raw?.hostname ?? raw?.system_hostname ?? raw?.host ?? null;
    const version = raw?.version ?? raw?.product_version ?? raw?.release ?? raw?.full_version ?? null;
    let uptime = raw?.uptime ?? raw?.uptime_seconds ?? null;
    if (typeof uptime === 'string' && /^\d+$/.test(uptime)) uptime = parseInt(uptime, 10);
    return { ...raw, hostname, version, uptime: typeof uptime === 'number' ? uptime : uptime };
}

async function getPools(apiKey, serverUrl = null) {
    let poolList = [];
    try {
        const data = await request('/pool', apiKey, 'GET', null, serverUrl);
        poolList = parsePoolList(data);
    } catch (e) {
        if (e?.response?.status === 404) {
            try {
                const dsList = await request('/pool/dataset', apiKey, 'GET', null, serverUrl);
                const arr = Array.isArray(dsList) ? dsList : (dsList && typeof dsList === 'object' ? (dsList.pool_dataset || dsList.pool || Object.values(dsList).find(Array.isArray) || []) : []);
                const rootOnly = arr.filter((d) => d && typeof d === 'object' && (d.name || d.id) && !String(d.name || d.id || '').includes('/'));
                poolList = (rootOnly.length ? rootOnly : arr).map((d) => ({ name: d.name || d.id, id: d.id || d.name, healthy: d.healthy, status: d.status }));
            } catch {
                return [];
            }
        } else {
            throw e;
        }
    }
    const results = await Promise.all(poolList.map(async (p) => {
        const name = p?.name || p?.id;
        if (!name) return null;
        let used = null;
        let available = null;
        let total = null;
        try {
            const idEnc = encodeURIComponent(String(name));
            const ds = await request(`/pool/dataset/id/${idEnc}`, apiKey, 'GET', null, serverUrl);
            used = extractBytes(ds?.used);
            available = extractBytes(ds?.available);
            if (used !== null && available !== null) total = used + available;
        } catch (_) {
            const size = extractBytes(p?.size);
            const alloc = extractBytes(p?.allocated);
            if (size !== null) total = size;
            if (alloc !== null) used = alloc;
            if (total !== null && used !== null) available = Math.max(0, total - used);
        }
        return { name: String(name), id: String(name), healthy: p?.healthy ?? null, status: p?.status ?? null, used, available, total };
    }));
    return results.filter(Boolean);
}

async function detectCapabilities(apiKey, serverUrl = null, options = {}) {
    const force = !!options.force;
    const ttlMs = Number(options.ttlMs) > 0 ? Number(options.ttlMs) : (10 * 60 * 1000);
    const key = capabilityCacheKey(apiKey, serverUrl);
    const cached = capabilityCache.get(key);
    if (!force && cached && (Date.now() - cached.checkedAt) < cached.ttlMs) return cached.capabilities;

    const capabilities = {
        checkedAt: new Date().toISOString(),
        transport: { restV2: true, websocketJsonRpcAvailable: true },
        methods: {}
    };
    for (const [name, endpoints] of Object.entries(METHOD_PROBES)) {
        let ok = false;
        let usedEndpoint = null;
        for (const endpoint of endpoints) {
            try {
                await request(endpoint, apiKey, 'GET', null, serverUrl);
                ok = true;
                usedEndpoint = endpoint;
                break;
            } catch (e) {
                const status = Number(e?.response?.status || 0);
                if (status === 401 || status === 403) throw e;
            }
        }
        capabilities.methods[name] = { supported: ok, endpoint: usedEndpoint };
    }
    capabilityCache.set(key, { checkedAt: Date.now(), ttlMs, capabilities });
    return capabilities;
}

async function tryFallbackGet(endpoints, apiKey, serverUrl) {
    for (const endpoint of endpoints) {
        try {
            return await request(endpoint, apiKey, 'GET', null, serverUrl);
        } catch (e) {
            if (e?.response?.status === 404 || e?.response?.status === 405) continue;
            throw e;
        }
    }
    return [];
}

async function getAlerts(apiKey, serverUrl = null) {
    const raw = await tryFallbackGet(['/alert/list', '/alert'], apiKey, serverUrl);
    const arr = Array.isArray(raw) ? raw : [];
    const nowIso = new Date().toISOString();
    return arr.map((item, idx) => {
        const levelRaw = String(item?.level || item?.severity || '').toUpperCase();
        const severity = levelRaw.includes('CRIT') ? 'critical' : (levelRaw.includes('WARN') ? 'warning' : 'info');
        const dt = item?.datetime || item?.time || item?.created_at || null;
        return {
            id: String(item?.id || item?.uuid || `alert_${idx}`),
            sourceType: 'alert',
            entityId: String(item?.klass || item?.source || item?.id || `alert_${idx}`),
            severity,
            level: levelRaw || null,
            title: String(item?.formatted || item?.text || item?.msg || item?.message || 'TrueNAS alert'),
            statusLabel: item?.dismissed ? 'dismissed' : 'active',
            dismissed: !!item?.dismissed,
            updatedAt: dt ? new Date(dt).toISOString() : nowIso,
            raw: item
        };
    });
}

async function getServices(apiKey, serverUrl = null) {
    const raw = await tryFallbackGet(['/service', '/service/query'], apiKey, serverUrl);
    const arr = Array.isArray(raw) ? raw : [];
    const nowIso = new Date().toISOString();
    return arr.map((svc, idx) => {
        const stateRaw = String(svc?.state || svc?.status || '').toLowerCase();
        const enabled = !!svc?.enable || !!svc?.enabled;
        const running = stateRaw === 'running' || stateRaw === 'up';
        return {
            id: String(svc?.id || svc?.service || svc?.name || `service_${idx}`),
            name: String(svc?.service || svc?.name || svc?.id || `service_${idx}`),
            sourceType: 'service',
            entityId: String(svc?.service || svc?.name || svc?.id || `service_${idx}`),
            enabled,
            running,
            statusLabel: running ? 'running' : 'stopped',
            severity: running || !enabled ? 'info' : 'warning',
            updatedAt: nowIso,
            raw: svc
        };
    });
}

async function getInterfaces(apiKey, serverUrl = null) {
    const raw = await tryFallbackGet(['/interface', '/interface/query'], apiKey, serverUrl);
    const arr = Array.isArray(raw) ? raw : [];
    const nowIso = new Date().toISOString();
    return arr.map((iface, idx) => {
        const stateRaw = String(iface?.state?.link_state || iface?.link_state || iface?.status || '').toUpperCase();
        const up = ['UP', 'LINK_STATE_UP', 'ACTIVE'].some((x) => stateRaw.includes(x));
        return {
            id: String(iface?.id || iface?.name || iface?.interface || `if_${idx}`),
            name: String(iface?.name || iface?.interface || iface?.id || `if_${idx}`),
            sourceType: 'interface',
            entityId: String(iface?.name || iface?.interface || iface?.id || `if_${idx}`),
            up,
            statusLabel: up ? 'up' : 'down',
            severity: up ? 'info' : 'warning',
            speed: iface?.state?.media_type || iface?.media_type || null,
            updatedAt: nowIso,
            raw: iface
        };
    });
}

async function getDisks(apiKey, serverUrl = null) {
    const raw = await tryFallbackGet(['/disk', '/disk/query'], apiKey, serverUrl);
    const arr = Array.isArray(raw) ? raw : [];
    const nowIso = new Date().toISOString();
    return arr.map((disk, idx) => {
        const smartRaw = String(disk?.smart_status || disk?.smart_result || disk?.health || disk?.status || '').toLowerCase();
        const stateRaw = String(disk?.state || disk?.status || '').toLowerCase();
        const healthy = !(smartRaw.includes('fail') || smartRaw.includes('bad') || smartRaw.includes('degrad') || stateRaw.includes('fault') || stateRaw.includes('offline'));
        const temp = parseIntLike(disk?.temperature ?? disk?.temp ?? disk?.smart_temp);
        const sizeBytes = extractBytes(disk?.size ?? disk?.size_bytes ?? disk?.mediasize);
        const powerOnHours = extractPowerOnHours(disk);
        const rotationRpm = parseIntLike(disk?.rotationrate ?? disk?.rpm ?? disk?.rotation_rate);
        const interfaceType = String(disk?.bus || disk?.type || disk?.transport || '').trim() || null;
        let severity = 'info';
        if (!healthy && (smartRaw.includes('fail') || stateRaw.includes('fault') || stateRaw.includes('offline'))) severity = 'critical';
        else if (!healthy) severity = 'warning';
        return {
            id: String(disk?.identifier || disk?.name || disk?.devname || `disk_${idx}`),
            name: String(disk?.name || disk?.devname || disk?.identifier || `disk_${idx}`),
            sourceType: 'disk',
            entityId: String(disk?.identifier || disk?.name || disk?.devname || `disk_${idx}`),
            healthy,
            statusLabel: healthy ? 'healthy' : (stateRaw || smartRaw || 'degraded'),
            severity,
            model: disk?.model || null,
            serial: disk?.serial || null,
            temperatureC: Number.isFinite(temp) ? temp : null,
            sizeBytes: Number.isFinite(sizeBytes) ? sizeBytes : null,
            powerOnHours: Number.isFinite(powerOnHours) ? powerOnHours : null,
            rotationRpm: Number.isFinite(rotationRpm) ? rotationRpm : null,
            interfaceType,
            pool: disk?.pool || disk?.pool_name || null,
            updatedAt: nowIso,
            raw: disk
        };
    });
}

async function getPoolScrubs(apiKey, serverUrl = null) {
    const raw = await tryFallbackGet(['/pool/scrub', '/pool/scrub/query'], apiKey, serverUrl);
    const arr = Array.isArray(raw) ? raw : [];
    const nowIso = new Date().toISOString();
    return arr.map((scrub, idx) => {
        const st = String(scrub?.state || scrub?.status || '').toLowerCase();
        const sev = st.includes('failed') || st.includes('error') ? 'critical' : 'info';
        return {
            id: String(scrub?.id || scrub?.pool || `scrub_${idx}`),
            pool: String(scrub?.pool || scrub?.pool_name || scrub?.id || `pool_${idx}`),
            sourceType: 'scrub',
            entityId: String(scrub?.pool || scrub?.pool_name || scrub?.id || `pool_${idx}`),
            severity: sev,
            statusLabel: st || 'unknown',
            updatedAt: scrub?.last_scrub ? new Date(scrub.last_scrub).toISOString() : nowIso,
            raw: scrub
        };
    });
}

async function getReportingSnapshot(apiKey, serverUrl = null) {
    let graphs = [];
    try {
        graphs = await request('/reporting/netdata/graphs', apiKey, 'GET', null, serverUrl);
    } catch (e) {
        if (e?.response?.status !== 404 && e?.response?.status !== 405) throw e;
        try {
            graphs = await request('/reporting/graph', apiKey, 'GET', null, serverUrl);
        } catch (e2) {
            if (e2?.response?.status !== 404 && e2?.response?.status !== 405) throw e2;
        }
    }
    const arr = Array.isArray(graphs) ? graphs : [];
    return { graphs: arr, graphCount: arr.length, updatedAt: new Date().toISOString() };
}

async function getApps(apiKey, serverUrl = null) {
    const raw = await tryFallbackGet(['/app', '/app/query'], apiKey, serverUrl);
    const arr = Array.isArray(raw) ? raw : [];
    const nowIso = new Date().toISOString();
    return arr.map((app, idx) => {
        const state = String(app?.state || app?.status || app?.active_workloads?.state || '').toLowerCase();
        const running = state.includes('run') || state === 'active';
        const desired = parseIntLike(app?.active_workloads?.desired);
        const available = parseIntLike(app?.active_workloads?.available);
        const healthyWorkloads = desired === null || available === null ? true : available >= desired;
        const severity = running && healthyWorkloads ? 'info' : (running ? 'warning' : 'critical');
        return {
            id: String(app?.id || app?.name || app?.app_name || `app_${idx}`),
            name: String(app?.name || app?.app_name || app?.id || `app_${idx}`),
            sourceType: 'app',
            entityId: String(app?.id || app?.name || app?.app_name || `app_${idx}`),
            running,
            statusLabel: running ? (healthyWorkloads ? 'running' : 'degraded') : (state || 'stopped'),
            severity,
            desiredWorkloads: desired,
            availableWorkloads: available,
            updatedAt: nowIso,
            raw: app
        };
    });
}

function buildHealthSummary({ system, pools, alerts, services, interfaces, disks, scrubs, apps, capabilities }) {
    const alertsArr = Array.isArray(alerts) ? alerts : [];
    const servicesArr = Array.isArray(services) ? services : [];
    const poolsArr = Array.isArray(pools) ? pools : [];
    const disksArr = Array.isArray(disks) ? disks : [];
    const ifArr = Array.isArray(interfaces) ? interfaces : [];
    const scrubsArr = Array.isArray(scrubs) ? scrubs : [];
    const appsArr = Array.isArray(apps) ? apps : [];

    const criticalAlerts = alertsArr.filter((a) => a.severity === 'critical').length;
    const warningAlerts = alertsArr.filter((a) => a.severity === 'warning').length;
    const stoppedCriticalServices = servicesArr.filter((s) => !s.running && s.enabled).length;
    const degradedDisks = disksArr.filter((d) => !d.healthy).length;
    const downInterfaces = ifArr.filter((i) => !i.up).length;
    const failedScrubs = scrubsArr.filter((s) => s.severity === 'critical').length;
    const unhealthyPools = poolsArr.filter((p) => p.healthy === false).length;
    const appIssues = appsArr.filter((a) => !a.running).length;
    const score = Math.max(
        0,
        100
        - criticalAlerts * 20
        - warningAlerts * 8
        - stoppedCriticalServices * 10
        - degradedDisks * 10
        - downInterfaces * 5
        - failedScrubs * 15
        - unhealthyPools * 12
        - appIssues * 5
    );
    return {
        status: score >= 85 ? 'ok' : (score >= 60 ? 'warning' : 'critical'),
        score,
        counts: {
            criticalAlerts,
            warningAlerts,
            stoppedCriticalServices,
            degradedDisks,
            downInterfaces,
            failedScrubs,
            unhealthyPools,
            totalApps: appsArr.length,
            appIssues
        },
        system: { hostname: system?.hostname || null, version: system?.version || null },
        capabilities: capabilities || null,
        updatedAt: new Date().toISOString()
    };
}

module.exports = {
    request,
    getSystemInfo,
    getPools,
    detectCapabilities,
    getAlerts,
    getServices,
    getInterfaces,
    getDisks,
    getPoolScrubs,
    getReportingSnapshot,
    getApps,
    buildHealthSummary,
    getStatsSnapshot,
    classifyTrueNASError
};

