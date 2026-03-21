const axios = require('axios');
const https = require('https');
const { constants: cryptoConstants } = require('crypto');
const cache = require('./cache');
const { log } = require('./utils');
const connectionStore = require('./connection-store');

// HTTPS agent for self-signed certs
const httpsAgent = new https.Agent({
    rejectUnauthorized: false,
    secureOptions: cryptoConstants.SSL_OP_NO_TLSv1 | cryptoConstants.SSL_OP_NO_TLSv1_1
});

// Default settings
const DEFAULT_SETTINGS = {
    pollIntervalSec: 10,
    timeoutMs: 3000,
    cacheTtlSec: 8
};

// Cache keys
const CACHE_KEYS = {
    SETTINGS: 'host_metrics_settings',
    CONFIGS: 'host_metrics_configs',
    DISCOVERY: 'host_metrics_discovery',
    CURRENT: 'host_metrics_current'
};

// Get settings from DB or defaults
function getSettings() {
    const cached = cache.get(CACHE_KEYS.SETTINGS);
    if (cached) return cached;

    const settingsStore = require('./settings-store');
    const raw = settingsStore.getSetting(CACHE_KEYS.SETTINGS);
    let settings = DEFAULT_SETTINGS;

    if (raw) {
        try {
            const parsed = JSON.parse(raw);
            settings = { ...DEFAULT_SETTINGS, ...parsed };
        } catch (e) {
            log('warn', `Host metrics: invalid settings, using defaults: ${e.message}`);
        }
    }

    // Validate pollIntervalSec
    if (settings.pollIntervalSec < 5) settings.pollIntervalSec = 5;
    if (settings.pollIntervalSec > 300) settings.pollIntervalSec = 300;

    cache.set(CACHE_KEYS.SETTINGS, settings, 60);
    return settings;
}

// Save settings to DB
function saveSettings(settings) {
    const settingsStore = require('./settings-store');
    const validated = {
        pollIntervalSec: Math.max(5, Math.min(300, parseInt(settings.pollIntervalSec) || 10)),
        timeoutMs: parseInt(settings.timeoutMs) || 3000,
        cacheTtlSec: parseInt(settings.cacheTtlSec) || 8
    };
    settingsStore.setSetting(CACHE_KEYS.SETTINGS, JSON.stringify(validated));
    cache.del(CACHE_KEYS.SETTINGS);
    return validated;
}

// Get configs from DB
function getConfigs() {
    const cached = cache.get(CACHE_KEYS.CONFIGS);
    if (cached) return cached;

    const settingsStore = require('./settings-store');
    const raw = settingsStore.getSetting(CACHE_KEYS.CONFIGS);
    let configs = {};

    if (raw) {
        try {
            configs = JSON.parse(raw);
        } catch (e) {
            log('warn', `Host metrics: invalid configs: ${e.message}`);
        }
    }

    cache.set(CACHE_KEYS.CONFIGS, configs, 60);
    return configs;
}

// Save configs to DB
function saveConfigs(configs) {
    const settingsStore = require('./settings-store');
    settingsStore.setSetting(CACHE_KEYS.CONFIGS, JSON.stringify(configs));
    cache.del(CACHE_KEYS.CONFIGS);
    return configs;
}

// Get connection URL by connectionId
function getConnectionUrl(connectionId) {
    const conn = connectionStore.getConnectionById(connectionId);
    if (!conn) return null;
    return conn.url;
}

// Call external exporter on host
async function callExporter(baseUrl, path, timeoutMs = 3000) {
    const url = `${baseUrl.replace(/\/$/, '')}${path}`;
    try {
        const response = await axios.get(url, {
            httpsAgent,
            timeout: timeoutMs,
            validateStatus: () => true
        });
        if (response.status >= 400) {
            throw new Error(`HTTP ${response.status}: ${response.statusText}`);
        }
        return response.data;
    } catch (error) {
        log('warn', `Host metrics exporter error (${url}): ${error.message}`);
        throw error;
    }
}

// Discovery: get sensors and interfaces for all nodes in a connection
async function discoverConnection(connectionId) {
    const baseUrl = getConnectionUrl(connectionId);
    if (!baseUrl) {
        throw new Error(`Connection not found: ${connectionId}`);
    }

    const proxmoxApi = require('./proxmox-api');
    const settingsStore = require('./settings-store');
    
    // Get token from connection secret
    const conn = connectionStore.getConnectionById(connectionId);
    const token = conn?.secret || null;

    // Get nodes from Proxmox API
    let nodes = [];
    try {
        nodes = await proxmoxApi.getNodes(token, baseUrl);
    } catch (e) {
        log('warn', `Host metrics: cannot get nodes for ${connectionId}: ${e.message}`);
        return { connectionId, nodes: [], error: e.message };
    }

    const results = [];
    for (const node of nodes) {
        const nodeName = node.node || node.name;
        if (!nodeName) continue;

        const item = {
            connectionId,
            node: nodeName,
            cpuSensors: [],
            interfaces: [],
            updatedAt: new Date().toISOString(),
            error: null
        };

        try {
            // Call exporter on this node's host
            // We assume exporter runs on same host as Proxmox, so use base URL
            const data = await callExporter(baseUrl, '/metrics/discovery', getSettings().timeoutMs);
            
            if (data && Array.isArray(data.cpuSensors)) {
                item.cpuSensors = data.cpuSensors.map(s => String(s));
            }
            if (data && Array.isArray(data.interfaces)) {
                item.interfaces = data.interfaces.map(i => String(i));
            }
        } catch (e) {
            item.error = e.message;
            item.cpuSensors = [];
            item.interfaces = [];
        }

        results.push(item);
    }

    return { connectionId, nodes: results, error: null };
}

// Get current metrics for all configured nodes
async function getCurrentMetrics() {
    const configs = getConfigs();
    const settings = getSettings();
    const items = [];
    let hasConfig = false;

    for (const [connectionId, connConfig] of Object.entries(configs || {})) {
        if (!connConfig || !connConfig.nodes) continue;

        for (const [nodeName, nodeConfig] of Object.entries(connConfig.nodes || {})) {
            if (!nodeConfig) continue;
            hasConfig = true;

            const item = {
                connectionId,
                node: nodeName,
                enabled: !!nodeConfig.enabled,
                cpu: {
                    sensor: nodeConfig.cpuTempSensor || null,
                    tempC: null,
                    ok: false,
                    error: null
                },
                link: {
                    interface: nodeConfig.linkInterface || null,
                    speedMbps: null,
                    state: 'unknown',
                    ok: false,
                    error: null
                },
                updatedAt: null,
                stale: false
            };

            if (!nodeConfig.enabled) {
                items.push(item);
                continue;
            }

            // Try to get from cache first
            const cacheKey = `host_metrics_data:${connectionId}:${nodeName}`;
            const cached = cache.get(cacheKey);
            if (cached && Date.now() - cached.timestamp < settings.cacheTtlSec * 1000) {
                item.cpu = cached.cpu || item.cpu;
                item.link = cached.link || item.link;
                item.updatedAt = cached.updatedAt;
                item.stale = cached.stale || false;
                items.push(item);
                continue;
            }

            // Fetch from exporter
            const baseUrl = getConnectionUrl(connectionId);
            if (!baseUrl) {
                item.cpu.error = 'connection_not_found';
                item.link.error = 'connection_not_found';
                items.push(item);
                continue;
            }

            try {
                const data = await callExporter(baseUrl, '/metrics/current', settings.timeoutMs);
                
                // Find matching node in response
                const nodeData = Array.isArray(data.items) 
                    ? data.items.find(d => d.node === nodeName)
                    : null;

                if (!nodeData) {
                    item.cpu.error = 'node_not_found_in_response';
                    item.link.error = 'node_not_found_in_response';
                } else {
                    // CPU temperature
                    if (nodeConfig.cpuTempSensor && nodeData.cpu) {
                        const sensorData = Array.isArray(nodeData.cpu.sensors)
                            ? nodeData.cpu.sensors.find(s => s.name === nodeConfig.cpuTempSensor)
                            : null;
                        
                        if (sensorData && typeof sensorData.tempC === 'number') {
                            item.cpu.tempC = sensorData.tempC;
                            item.cpu.ok = true;
                        } else {
                            item.cpu.error = 'sensor_not_found';
                        }
                    } else if (!nodeConfig.cpuTempSensor) {
                        item.cpu.error = 'no_sensor_configured';
                    }

                    // Link speed
                    if (nodeConfig.linkInterface && nodeData.network) {
                        const ifaceData = Array.isArray(nodeData.network.interfaces)
                            ? nodeData.network.interfaces.find(i => i.name === nodeConfig.linkInterface)
                            : null;
                        
                        if (ifaceData) {
                            item.link.interface = nodeConfig.linkInterface;
                            item.link.state = ifaceData.state || 'unknown';
                            
                            const speed = ifaceData.speedMbps;
                            if (typeof speed === 'number' && speed >= 0) {
                                item.link.speedMbps = speed;
                                item.link.ok = true;
                            } else if (speed === -1 || speed === null || speed === undefined) {
                                item.link.speedMbps = null;
                                item.link.ok = true; // Interface exists, speed just unknown
                            } else {
                                item.link.error = 'invalid_speed';
                            }
                        } else {
                            item.link.error = 'interface_not_found';
                        }
                    } else if (!nodeConfig.linkInterface) {
                        item.link.error = 'no_interface_configured';
                    }

                    item.updatedAt = nodeData.updatedAt || new Date().toISOString();
                }
            } catch (e) {
                // Return last known values with stale flag if available
                item.cpu.error = e.message;
                item.link.error = e.message;
                item.stale = true;
            }

            // Cache the result
            cache.set(cacheKey, {
                cpu: item.cpu,
                link: item.link,
                updatedAt: item.updatedAt,
                stale: item.stale,
                timestamp: Date.now()
            }, settings.cacheTtlSec);

            items.push(item);
        }
    }

    return {
        configured: hasConfig,
        items,
        updatedAt: new Date().toISOString()
    };
}

module.exports = {
    getSettings,
    saveSettings,
    getConfigs,
    saveConfigs,
    discoverConnection,
    getCurrentMetrics,
    CACHE_KEYS
};
