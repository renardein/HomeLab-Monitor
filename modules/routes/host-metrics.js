const express = require('express');
const axios = require('axios');
const { URL } = require('url');
const proxmox = require('../proxmox-api');
const settingsStore = require('../settings-store');
const connectionStore = require('../connection-store');
const { resolveProxmoxConnectionId } = require('../proxmox-connection-id');
const checkAuth = require('../middleware/auth');
const { log } = require('../utils');
const hostMetricsAgentInstall = require('../host-metrics-agent-install');
const hostCpuTempSamples = require('../host-cpu-temp-samples');

const router = express.Router();

const HOST_METRICS_SETTINGS_KEY = 'host_metrics_settings';
const HOST_METRICS_CONFIGS_KEY = 'host_metrics_configs';

const DEFAULT_AGENT_URL_PORT = 9105;
const DEFAULT_AGENT_URL_PATH = '/host-metrics';
const DEFAULT_POLL_INTERVAL_SEC = 10;
const DEFAULT_TIMEOUT_MS = 3000;
const DEFAULT_CACHE_TTL_SEC = 8;
const DEFAULT_CRITICAL_TEMP_C = 85;
const DEFAULT_CRITICAL_LINK_SPEED_MBPS = 1000;

const runtimeCache = new Map();

function toBool(v) {
    if (v === true || v === false) return v;
    const s = String(v || '').trim().toLowerCase();
    return s === '1' || s === 'true' || s === 'yes' || s === 'on';
}

function safeString(v) {
    return v == null ? '' : String(v);
}

function clampInt(v, min, max, fallback) {
    const n = parseInt(v, 10);
    if (!Number.isFinite(n)) return fallback;
    if (n < min) return min;
    if (n > max) return max;
    return n;
}

function normalizeSettings(raw) {
    const s = raw && typeof raw === 'object' ? raw : {};
    return {
        pollIntervalSec: clampInt(s.pollIntervalSec, 5, 300, DEFAULT_POLL_INTERVAL_SEC),
        timeoutMs: clampInt(s.timeoutMs, 500, 30000, DEFAULT_TIMEOUT_MS),
        cacheTtlSec: clampInt(s.cacheTtlSec, 1, 300, DEFAULT_CACHE_TTL_SEC),
        criticalTempC: clampInt(s.criticalTempC, 0, 120, DEFAULT_CRITICAL_TEMP_C),
        criticalLinkSpeedMbps: clampInt(s.criticalLinkSpeedMbps, 0, 400000, DEFAULT_CRITICAL_LINK_SPEED_MBPS)
    };
}

function normalizeAgentPath(p) {
    let path = safeString(p).trim() || DEFAULT_AGENT_URL_PATH;
    if (path[0] !== '/') path = `/${path}`;
    return path;
}

function parseLegacyFullAgentUrl(raw) {
    const s = safeString(raw).trim();
    if (!s || !/^https?:\/\//i.test(s)) return null;
    try {
        const u = new URL(s);
        const port = u.port ? parseInt(u.port, 10) : DEFAULT_AGENT_URL_PORT;
        let path = u.pathname || DEFAULT_AGENT_URL_PATH;
        if (path === '/' || !path.trim()) path = DEFAULT_AGENT_URL_PATH;
        return { port, path: normalizeAgentPath(path) };
    } catch {
        return null;
    }
}

function normalizeNodeConfig(raw) {
    const cfg = raw && typeof raw === 'object' ? raw : {};
    let agentPort = clampInt(cfg.agentPort, 1, 65535, NaN);
    if (!Number.isFinite(agentPort)) agentPort = DEFAULT_AGENT_URL_PORT;
    let agentPath = safeString(cfg.agentPath || cfg.agentEndpoint).trim();
    const legacyUrl = safeString(cfg.agentUrl).trim();
    const fromLegacy = parseLegacyFullAgentUrl(legacyUrl);
    if (fromLegacy) {
        agentPort = fromLegacy.port;
        agentPath = fromLegacy.path;
    }
    agentPath = normalizeAgentPath(agentPath);

    return {
        enabled: toBool(cfg.enabled),
        agentPort,
        agentPath,
        cpuTempSensor: safeString(cfg.cpuTempSensor).trim(),
        linkInterface: safeString(cfg.linkInterface).trim()
    };
}

function normalizeConnectionConfig(raw) {
    const cfg = raw && typeof raw === 'object' ? raw : {};
    const nodesRaw = cfg.nodes && typeof cfg.nodes === 'object' ? cfg.nodes : {};
    const nodes = {};
    for (const [nodeName, nodeCfg] of Object.entries(nodesRaw)) {
        const key = safeString(nodeName).trim();
        if (!key) continue;
        nodes[key] = normalizeNodeConfig(nodeCfg);
    }
    return { nodes };
}

function normalizeAllConfigs(raw) {
    const src = raw && typeof raw === 'object' ? raw : {};
    const out = {};
    for (const [connectionId, cfg] of Object.entries(src)) {
        const key = safeString(connectionId).trim();
        if (!key) continue;
        out[key] = normalizeConnectionConfig(cfg);
    }
    return out;
}

function loadSettings() {
    const raw = settingsStore.getSetting(HOST_METRICS_SETTINGS_KEY);
    if (!raw) return normalizeSettings(null);
    try {
        return normalizeSettings(JSON.parse(raw));
    } catch {
        return normalizeSettings(null);
    }
}

function saveSettings(settings) {
    const normalized = normalizeSettings(settings);
    settingsStore.setSetting(HOST_METRICS_SETTINGS_KEY, JSON.stringify(normalized));
    return normalized;
}

function loadConfigs() {
    const raw = settingsStore.getSetting(HOST_METRICS_CONFIGS_KEY);
    if (!raw) return {};
    try {
        return normalizeAllConfigs(JSON.parse(raw));
    } catch {
        return {};
    }
}

function saveConfigs(configs) {
    const normalized = normalizeAllConfigs(configs);
    settingsStore.setSetting(HOST_METRICS_CONFIGS_KEY, JSON.stringify(normalized));
    return normalized;
}

function hostForHttpUrl(hostRaw) {
    const h = safeString(hostRaw).trim();
    if (!h) return '127.0.0.1';
    if (h.includes(':') && !h.startsWith('[')) return `[${h}]`;
    return h;
}

/** Base URL for the agent: cluster/discovery IP (or node name) + configured port + path. */
function resolveAgentUrl(nodeName, cfg, nodeIp = null) {
    const nn = safeString(nodeName).trim();
    const hostRaw = safeString(nodeIp).trim() || nn || '127.0.0.1';
    const port = clampInt(cfg && cfg.agentPort, 1, 65535, DEFAULT_AGENT_URL_PORT);
    const path = normalizeAgentPath(cfg && cfg.agentPath);
    const host = hostForHttpUrl(hostRaw);
    return `http://${host}:${port}${path}`;
}

function joinAgentUrl(baseUrl, suffix) {
    const u = new URL(String(baseUrl));
    const pathBase = u.pathname && u.pathname !== '/' ? u.pathname.replace(/\/+$/, '') : '';
    const pathSuffix = safeString(suffix).trim().replace(/^\/+/, '');
    u.pathname = `${pathBase}/${pathSuffix}`.replace(/\/{2,}/g, '/');
    u.search = '';
    return u.toString();
}

async function fetchAgentJson(baseUrl, suffix, timeoutMs, params = {}) {
    const url = joinAgentUrl(baseUrl, suffix);
    const response = await axios.get(url, {
        timeout: timeoutMs,
        params,
        validateStatus: () => true
    });
    if (response.status >= 400) {
        const msg = response?.data?.error || response?.data?.message || `HTTP ${response.status}`;
        throw new Error(msg);
    }
    if (!response.data || typeof response.data !== 'object') {
        throw new Error('invalid agent response');
    }
    return response.data;
}

function uniqueStrings(arr) {
    const out = [];
    const seen = new Set();
    for (const item of Array.isArray(arr) ? arr : []) {
        const s = safeString(item && item.name != null ? item.name : item).trim();
        if (!s || seen.has(s)) continue;
        seen.add(s);
        out.push(s);
    }
    return out;
}

function parseLinkSpeedMbps(raw) {
    if (raw == null || raw === '') return null;
    if (Number.isFinite(Number(raw))) return Number(raw);

    const text = safeString(raw).trim().toLowerCase().replace(/,/g, '.');
    if (!text) return null;
    if (['unknown', 'n/a', 'na', 'none', 'down', 'auto', '-1'].includes(text)) return null;

    const match = text.match(/(\d+(?:\.\d+)?)/);
    if (!match) return null;

    const value = Number(match[1]);
    if (!Number.isFinite(value) || value < 0) return null;

    const rest = text.slice((match.index || 0) + match[0].length).trim();
    const normalizedRest = rest.replace(/[\s_-]+/g, '');

    // Common Ethernet-style notation, e.g. 10Gbase-T / 1000baseX.
    if (normalizedRest.startsWith('gbase')) return value * 1000;
    if (normalizedRest.startsWith('mbase') || normalizedRest.startsWith('base')) return value;
    if (normalizedRest.startsWith('kbase')) return value / 1000;
    if (normalizedRest.startsWith('tbase')) return value * 1000 * 1000;

    // Broad unit support: Mbps, Mb/s, Mbit/s, Gbps, Gbit/sec, 2.5G, etc.
    const firstChar = normalizedRest.charAt(0);
    if (firstChar === 't') return value * 1000 * 1000;
    if (firstChar === 'g') return value * 1000;
    if (firstChar === 'm') return value;
    if (firstChar === 'k') return value / 1000;

    // If there is no recognizable unit after the number, assume the source already uses Mbps.
    return value;
}

function parseDiscoveryPayload(data) {
    const cpuSensors = uniqueStrings(
        data.cpuSensors ||
        data.cpu?.sensors ||
        data.discovery?.cpuSensors ||
        []
    );
    const interfaces = uniqueStrings(
        data.interfaces ||
        data.network?.interfaces ||
        data.discovery?.interfaces ||
        []
    );
    return { cpuSensors, interfaces };
}

function parseCurrentPayload(data, cfg) {
    const cpuTempRaw =
        data.cpuTempC ??
        data.cpu?.tempC ??
        data.cpu?.valueC ??
        data.temperature?.cpuTempC ??
        null;
    const cpuTempC = Number.isFinite(Number(cpuTempRaw)) ? Number(cpuTempRaw) : null;

    const linkSpeedRaw =
        data.linkSpeedMbps ??
        data.link?.speedMbps ??
        data.network?.linkSpeedMbps ??
        null;
    const linkSpeedMbps = parseLinkSpeedMbps(linkSpeedRaw);
    const linkState = safeString(
        data.linkState ??
        data.link?.state ??
        data.network?.linkState ??
        'unknown'
    ).trim() || 'unknown';

    return {
        cpu: {
            sensor: cfg.cpuTempSensor || null,
            tempC: cpuTempC,
            ok: cpuTempC != null,
            error: cpuTempC == null ? 'cpu_metric_missing' : null
        },
        link: {
            interface: cfg.linkInterface || null,
            speedMbps: linkSpeedMbps,
            state: linkState,
            ok: linkSpeedMbps != null || linkState === 'up' || linkState === 'down',
            error: linkSpeedMbps == null && linkState === 'unknown' ? 'link_metric_missing' : null
        }
    };
}

function cacheKey(connectionId, nodeName, cfg, nodeIp) {
    return `${connectionId}::${nodeName}::${resolveAgentUrl(nodeName, cfg, nodeIp)}::${safeString(cfg.cpuTempSensor)}::${safeString(cfg.linkInterface)}`;
}

async function getCachedCurrent(connectionId, nodeName, cfg, settings, nodeIp = null) {
    const key = cacheKey(connectionId, nodeName, cfg, nodeIp);
    const now = Date.now();
    const existing = runtimeCache.get(key) || null;
    const freshForMs = Math.max(settings.pollIntervalSec, settings.cacheTtlSec) * 1000;

    if (existing && (now - existing.fetchedAt) < freshForMs) {
        return { ...existing.payload, nodeIp: nodeIp || existing.payload.nodeIp || null, stale: false };
    }

    try {
        const payload = await fetchNodeCurrent(nodeName, cfg, settings, nodeIp);
        const merged = { ...payload, nodeIp: nodeIp || null };
        runtimeCache.set(key, { fetchedAt: now, payload: merged });
        return { ...merged, stale: false };
    } catch (error) {
        if (existing && existing.payload) {
            return {
                ...existing.payload,
                stale: true,
                error: error.message || String(error)
            };
        }
        return {
            node: nodeName,
            nodeIp: nodeIp || null,
            enabled: true,
            agentUrl: resolveAgentUrl(nodeName, cfg, nodeIp),
            cpu: {
                sensor: cfg.cpuTempSensor || null,
                tempC: null,
                ok: false,
                error: error.message || String(error)
            },
            link: {
                interface: cfg.linkInterface || null,
                speedMbps: null,
                state: 'unknown',
                ok: false,
                error: error.message || String(error)
            },
            updatedAt: new Date().toISOString(),
            stale: true,
            error: error.message || String(error)
        };
    }
}

async function fetchNodeDiscovery(nodeName, cfg, settings, nodeIp = null) {
    const agentUrl = resolveAgentUrl(nodeName, cfg, nodeIp);
    const data = await fetchAgentJson(agentUrl, 'discovery', settings.timeoutMs);
    const parsed = parseDiscoveryPayload(data);
    return {
        node: nodeName,
        nodeIp: nodeIp || null,
        agentUrl,
        config: normalizeNodeConfig(cfg),
        cpuSensors: parsed.cpuSensors,
        interfaces: parsed.interfaces,
        updatedAt: new Date().toISOString(),
        error: null
    };
}

async function fetchNodeCurrent(nodeName, cfg, settings, nodeIp = null) {
    const agentUrl = resolveAgentUrl(nodeName, cfg, nodeIp);
    if (!cfg.cpuTempSensor) throw new Error('cpu sensor is not configured');
    if (!cfg.linkInterface) throw new Error('network interface is not configured');
    const data = await fetchAgentJson(agentUrl, 'current', settings.timeoutMs, {
        cpuSensor: cfg.cpuTempSensor,
        iface: cfg.linkInterface
    });
    const parsed = parseCurrentPayload(data, cfg);
    return {
        node: nodeName,
        enabled: true,
        agentUrl,
        ...parsed,
        updatedAt: new Date().toISOString(),
        error: null
    };
}

router.get('/settings', (req, res) => {
    try {
        res.json({
            success: true,
            settings: loadSettings(),
            configs: loadConfigs()
        });
    } catch (e) {
        log('error', `[HostMetrics] GET /settings: ${e.message}`);
        res.status(500).json({ success: false, error: e.message });
    }
});

router.post('/settings', (req, res) => {
    try {
        const body = req.body || {};
        const savedSettings = body.settings !== undefined ? saveSettings(body.settings) : loadSettings();

        let savedConfigs;
        if (body.configs && typeof body.configs === 'object') {
            savedConfigs = saveConfigs(body.configs);
        } else if (body.connectionId) {
            const allConfigs = loadConfigs();
            allConfigs[String(body.connectionId)] = normalizeConnectionConfig({ nodes: body.nodes });
            savedConfigs = saveConfigs(allConfigs);
        } else {
            savedConfigs = loadConfigs();
        }

        log('info', '[HostMetrics] settings saved', {
            hasConnectionId: !!body.connectionId,
            pollIntervalSec: savedSettings.pollIntervalSec
        });
        res.json({ success: true, settings: savedSettings, configs: savedConfigs });
    } catch (e) {
        log('error', `[HostMetrics] POST /settings: ${e.message}`);
        res.status(500).json({ success: false, error: e.message });
    }
});

router.post('/agent-install/preview', checkAuth, (req, res) => {
    try {
        const plan = hostMetricsAgentInstall.getInstallPlan();
        res.json({ success: true, plan });
    } catch (e) {
        log('error', `[HostMetrics] agent-install/preview: ${e.message}`);
        res.status(500).json({ success: false, error: e.message });
    }
});

router.post('/agent-install/run', checkAuth, async (req, res) => {
    try {
        const body = req.body || {};
        if (!body.confirm) {
            return res.status(400).json({ success: false, error: 'confirm required' });
        }
        const sshHost = safeString(body.sshHost).trim();
        const sshPort = body.sshPort != null ? parseInt(body.sshPort, 10) : 22;
        const sshUser = safeString(body.sshUser).trim() || 'root';
        const sshPassword = body.sshPassword != null ? String(body.sshPassword) : '';

        if (!sshHost) {
            return res.status(400).json({ success: false, error: 'ssh_host required' });
        }
        if (!sshPassword) {
            return res.status(400).json({ success: false, error: 'ssh_password required' });
        }

        const result = await hostMetricsAgentInstall.runRemoteInstall({
            sshHost,
            sshPort: Number.isFinite(sshPort) ? sshPort : 22,
            sshUser,
            sshPassword
        });

        log('info', '[HostMetrics] agent install SSH', { host: sshHost, user: sshUser });
        res.json({ success: true, log: result.log });
    } catch (e) {
        log('warn', `[HostMetrics] agent-install/run: ${e.message}`);
        res.status(500).json({ success: false, error: e.message || String(e) });
    }
});

router.post('/agent-uninstall/preview', checkAuth, (req, res) => {
    try {
        const plan = hostMetricsAgentInstall.getUninstallPlan();
        res.json({ success: true, plan });
    } catch (e) {
        log('error', `[HostMetrics] agent-uninstall/preview: ${e.message}`);
        res.status(500).json({ success: false, error: e.message });
    }
});

router.post('/agent-uninstall/run', checkAuth, async (req, res) => {
    try {
        const body = req.body || {};
        if (!body.confirm) {
            return res.status(400).json({ success: false, error: 'confirm required' });
        }
        const sshHost = safeString(body.sshHost).trim();
        const sshPort = body.sshPort != null ? parseInt(body.sshPort, 10) : 22;
        const sshUser = safeString(body.sshUser).trim() || 'root';
        const sshPassword = body.sshPassword != null ? String(body.sshPassword) : '';

        if (!sshHost) {
            return res.status(400).json({ success: false, error: 'ssh_host required' });
        }
        if (!sshPassword) {
            return res.status(400).json({ success: false, error: 'ssh_password required' });
        }

        const result = await hostMetricsAgentInstall.runRemoteUninstall({
            sshHost,
            sshPort: Number.isFinite(sshPort) ? sshPort : 22,
            sshUser,
            sshPassword
        });

        log('info', '[HostMetrics] agent uninstall SSH', { host: sshHost, user: sshUser });
        res.json({ success: true, log: result.log });
    } catch (e) {
        log('warn', `[HostMetrics] agent-uninstall/run: ${e.message}`);
        res.status(500).json({ success: false, error: e.message || String(e) });
    }
});

router.get('/discovery', checkAuth, async (req, res) => {
    const settings = loadSettings();
    const connectionId = resolveProxmoxConnectionId(req);
    if (!connectionId) {
        return res.status(400).json({ success: false, error: 'connectionId required' });
    }

    try {
        const nodes = await proxmox.getNodes(req.token, req.serverUrl || null);
        const clusterStatus = await proxmox.getClusterStatus(req.token, req.serverUrl || null);
        const orderedNodes = proxmox.sortRowsByClusterNodeOrder(nodes, clusterStatus);
        const nodeNames = (orderedNodes || []).map((n) => n.node || n.name).filter(Boolean);
        const nodeIpMap = proxmox.extractNodeIpMap(clusterStatus);
        const connCfg = loadConfigs()[connectionId] || { nodes: {} };

        const items = await Promise.all(nodeNames.map(async (nodeName) => {
            const cfg = normalizeNodeConfig(connCfg.nodes && connCfg.nodes[nodeName]);
            const nodeIp = nodeIpMap[nodeName] || null;
            try {
                return await fetchNodeDiscovery(nodeName, cfg, settings, nodeIp);
            } catch (e) {
                return {
                    node: nodeName,
                    nodeIp,
                    agentUrl: resolveAgentUrl(nodeName, cfg, nodeIp),
                    config: cfg,
                    cpuSensors: [],
                    interfaces: [],
                    updatedAt: new Date().toISOString(),
                    error: e.message || String(e)
                };
            }
        }));

        res.json({
            success: true,
            connectionId,
            settings,
            items,
            updatedAt: new Date().toISOString()
        });
    } catch (e) {
        log('error', `[HostMetrics] GET /discovery: ${e.message}`);
        res.status(500).json({ success: false, error: e.message });
    }
});

function sendNodeMetricHistory(req, res, fixedMetric) {
    const connectionId = resolveProxmoxConnectionId(req);
    const node = safeString(req.query.node).trim();
    const metricRaw = fixedMetric != null ? fixedMetric : safeString(req.query.metric).trim();
    const metric = metricRaw === 'cpu' || metricRaw === 'mem' || metricRaw === 'temp' ? metricRaw : null;
    if (!connectionId) {
        return res.status(400).json({ success: false, error: 'connectionId required' });
    }
    if (!node) {
        return res.status(400).json({ success: false, error: 'node required' });
    }
    if (!metric) {
        return res.status(400).json({ success: false, error: 'metric must be temp, cpu, or mem' });
    }
    try {
        const points = hostCpuTempSamples.getHostNodeMetricHistory(connectionId, node, metric);
        res.json({
            success: true,
            node,
            metric,
            retentionHours: hostCpuTempSamples.HOST_NODE_METRIC_RETENTION_HOURS,
            points
        });
    } catch (e) {
        log('error', `[HostMetrics] GET metric history (${metric}): ${e.message}`);
        res.status(500).json({ success: false, error: e.message });
    }
}

router.get('/node-metric-history', checkAuth, (req, res) => {
    sendNodeMetricHistory(req, res, null);
});

router.get('/cpu-temp-history', checkAuth, (req, res) => {
    sendNodeMetricHistory(req, res, 'temp');
});

router.get('/current', checkAuth, async (req, res) => {
    const settings = loadSettings();
    const connectionId = resolveProxmoxConnectionId(req);
    if (!connectionId) {
        return res.status(400).json({ configured: false, error: 'connectionId required' });
    }

    try {
        const nodes = await proxmox.getNodes(req.token, req.serverUrl || null);
        const clusterStatus = await proxmox.getClusterStatus(req.token, req.serverUrl || null);
        const orderedNodes = proxmox.sortRowsByClusterNodeOrder(nodes, clusterStatus);
        const nodeNames = (orderedNodes || []).map((n) => n.node || n.name).filter(Boolean);
        const nodeIpMap = proxmox.extractNodeIpMap(clusterStatus);
        const connCfg = loadConfigs()[connectionId] || { nodes: {} };

        const enabledNodeNames = nodeNames.filter((nodeName) => {
            const cfg = normalizeNodeConfig(connCfg.nodes && connCfg.nodes[nodeName]);
            return cfg.enabled;
        });

        if (!enabledNodeNames.length) {
            return res.json({
                configured: false,
                items: [],
                updatedAt: new Date().toISOString()
            });
        }

        const items = await Promise.all(enabledNodeNames.map(async (nodeName) => {
            const cfg = normalizeNodeConfig(connCfg.nodes && connCfg.nodes[nodeName]);
            const nodeIp = nodeIpMap[nodeName] || null;
            return getCachedCurrent(connectionId, nodeName, cfg, settings, nodeIp);
        }));

        const updatedAt = new Date().toISOString();
        try {
            hostCpuTempSamples.recordHostCpuTempSamples(connectionId, items, updatedAt);
        } catch (e) {
            log('warn', `[HostMetrics] record cpu temp samples: ${e.message}`);
        }

        res.json({
            configured: true,
            settings,
            items,
            updatedAt
        });
    } catch (e) {
        log('error', `[HostMetrics] GET /current: ${e.message}`);
        res.status(500).json({ configured: false, error: e.message, updatedAt: new Date().toISOString() });
    }
});

async function fetchHostMetricsForNotify(connectionId, nodeName) {
    const cid = safeString(connectionId).trim();
    const nn = safeString(nodeName).trim();
    if (!cid || !nn) return null;
    const settings = loadSettings();
    const all = loadConfigs();
    const cfg = normalizeNodeConfig(all[cid]?.nodes?.[nn]);
    if (!cfg.enabled) return null;
    let nodeIp = null;
    try {
        const conn = connectionStore.getConnectionById(cid);
        if (conn && conn.type === 'proxmox' && conn.secret && conn.url) {
            const clusterStatus = await proxmox.getClusterStatus(conn.secret, conn.url);
            const nodeIpMap = proxmox.extractNodeIpMap(clusterStatus);
            nodeIp = nodeIpMap[nn] || null;
        }
    } catch (e) {
        log('warn', `[HostMetrics] fetchHostMetricsForNotify nodeIp: ${e.message}`);
    }
    return getCachedCurrent(cid, nn, cfg, settings, nodeIp);
}

module.exports = router;
module.exports.fetchHostMetricsForNotify = fetchHostMetricsForNotify;
