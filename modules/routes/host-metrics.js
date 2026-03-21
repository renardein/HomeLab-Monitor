const express = require('express');
const router = express.Router();
const { log } = require('../utils');
const hostMetrics = require('../host-metrics');

// GET /api/host-metrics/settings - Get settings and configs
router.get('/settings', (req, res) => {
    try {
        const settings = hostMetrics.getSettings();
        const configs = hostMetrics.getConfigs();
        res.json({
            host_metrics_settings: settings,
            host_metrics_configs: configs
        });
    } catch (e) {
        log('error', `Host metrics settings error: ${e.message}`);
        res.status(500).json({ error: e.message });
    }
});

// POST /api/host-metrics/settings - Save settings and configs
router.post('/settings', (req, res) => {
    try {
        const body = req.body || {};
        let result = {};

        if (body.host_metrics_settings !== undefined) {
            result.settings = hostMetrics.saveSettings(body.host_metrics_settings);
        }

        if (body.host_metrics_configs !== undefined) {
            result.configs = hostMetrics.saveConfigs(body.host_metrics_configs);
        }

        log('info', '[Host Metrics] settings updated', {
            settingsUpdated: !!result.settings,
            configsUpdated: !!result.configs
        });

        res.json({ success: true, ...result });
    } catch (e) {
        log('error', `Host metrics save settings error: ${e.message}`);
        res.status(500).json({ error: e.message });
    }
});

// GET /api/host-metrics/discovery - Discover sensors and interfaces
router.get('/discovery', async (req, res) => {
    try {
        const connectionStore = require('../connection-store');
        const connections = connectionStore.listConnections().filter(c => c.type === 'proxmox');
        
        const items = [];
        const errors = [];

        for (const conn of connections) {
            try {
                const result = await hostMetrics.discoverConnection(conn.id);
                if (result.nodes && Array.isArray(result.nodes)) {
                    items.push(...result.nodes);
                }
                if (result.error) {
                    errors.push({ connectionId: conn.id, error: result.error });
                }
            } catch (e) {
                errors.push({ connectionId: conn.id, error: e.message });
                // Still add entry with error for each node we know about
                try {
                    const proxmoxApi = require('../proxmox-api');
                    const token = conn.secret || null;
                    const nodes = await proxmoxApi.getNodes(token, conn.url);
                    for (const node of nodes) {
                        const nodeName = node.node || node.name;
                        if (nodeName) {
                            items.push({
                                connectionId: conn.id,
                                node: nodeName,
                                cpuSensors: [],
                                interfaces: [],
                                updatedAt: new Date().toISOString(),
                                error: e.message
                            });
                        }
                    }
                } catch (_) {
                    // Can't even get node list
                }
            }
        }

        res.json({ items, errors: errors.length ? errors : null });
    } catch (e) {
        log('error', `Host metrics discovery error: ${e.message}`);
        res.status(500).json({ error: e.message });
    }
});

// GET /api/host-metrics/current - Get current metrics
router.get('/current', async (req, res) => {
    try {
        const metrics = await hostMetrics.getCurrentMetrics();
        res.json(metrics);
    } catch (e) {
        log('error', `Host metrics current error: ${e.message}`);
        res.status(500).json({ error: e.message });
    }
});

module.exports = router;
