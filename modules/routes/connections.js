const express = require('express');
const router = express.Router();
const store = require('../connection-store');
const proxmox = require('../proxmox-api');
const truenas = require('../truenas-api');
const { log } = require('../utils');

function isValidType(type) {
    return type === 'proxmox' || type === 'truenas';
}

function normalizeUrl(u) {
    const url = new URL(String(u));
    if (!url.protocol.startsWith('http')) throw new Error('Invalid protocol');
    return url.toString().replace(/\/+$/, '');
}

router.get('/', (req, res) => {
    res.json({ connections: store.listConnections() });
});

router.post('/upsert', async (req, res) => {
    const { type, url, name, secret } = req.body || {};
    if (!isValidType(type)) return res.status(400).json({ error: 'Invalid type' });
    if (!url) return res.status(400).json({ error: 'URL is required' });
    if (!secret) return res.status(400).json({ error: 'Secret is required' });

    let normalizedUrl;
    try {
        normalizedUrl = normalizeUrl(url);
    } catch {
        return res.status(400).json({ error: 'Invalid URL' });
    }

    try {
        const saved = store.upsertConnection({ type, url: normalizedUrl, name: name || null, secret: String(secret) });
        res.json({ success: true, connection: saved });
    } catch (e) {
        log('error', `Connection upsert failed: ${e.message}`);
        res.status(500).json({ error: 'Failed to save connection' });
    }
});

router.post('/:id/test', async (req, res) => {
    const { id } = req.params;
    const conn = store.getConnectionById(id);
    if (!conn) return res.status(404).json({ error: 'Not found' });

    try {
        if (conn.type === 'proxmox') {
            const nodes = await proxmox.getNodes(conn.secret, conn.url);
            return res.json({ success: true, nodes: nodes.length });
        }
        const info = await truenas.getSystemInfo(conn.secret, conn.url);
        return res.json({ success: true, system: { hostname: info?.hostname || null } });
    } catch (e) {
        const st = e?.response?.status;
        return res.status(st || 500).json({ success: false, error: e.message });
    }
});

router.delete('/:id', (req, res) => {
    const { id } = req.params;
    const ok = store.deleteConnection(id);
    if (!ok) return res.status(404).json({ error: 'Not found' });
    res.json({ success: true });
});

module.exports = router;

