const express = require('express');
const axios = require('axios');
const https = require('https');
const net = require('net');
const dgram = require('dgram');
const { constants: cryptoConstants } = require('crypto');
const { log } = require('../utils');

const router = express.Router();

const httpsAgent = new https.Agent({
    rejectUnauthorized: false,
    secureOptions: cryptoConstants.SSL_OP_NO_TLSv1 | cryptoConstants.SSL_OP_NO_TLSv1_1
});

const CHECK_TIMEOUT_MS = 5000;

function parsePort(v) {
    const n = parseInt(String(v), 10);
    return Number.isFinite(n) && n >= 1 && n <= 65535 ? n : null;
}

function tcpCheck(host, port) {
    return new Promise((resolve) => {
        const started = Date.now();
        const socket = new net.Socket();
        const timeout = setTimeout(() => {
            socket.destroy();
            resolve({ up: false, latency: null, error: 'timeout' });
        }, CHECK_TIMEOUT_MS);

        socket.once('connect', () => {
            clearTimeout(timeout);
            const latency = Date.now() - started;
            socket.destroy();
            resolve({ up: true, latency });
        });

        socket.once('error', (err) => {
            clearTimeout(timeout);
            socket.destroy();
            resolve({ up: false, latency: null, error: err.code || err.message });
        });

        socket.connect(port, host);
    });
}

function udpCheck(host, port) {
    return new Promise((resolve) => {
        const started = Date.now();
        const socket = dgram.createSocket('udp4');
        const timeout = setTimeout(() => {
            try { socket.close(); } catch (_) {}
            resolve({ up: false, latency: null, error: 'timeout' });
        }, CHECK_TIMEOUT_MS);

        socket.once('error', (err) => {
            clearTimeout(timeout);
            try { socket.close(); } catch (_) {}
            resolve({ up: false, latency: null, error: err.code || err.message });
        });

        socket.send(Buffer.alloc(0), 0, 0, port, host, (err) => {
            clearTimeout(timeout);
            const latency = Date.now() - started;
            try { socket.close(); } catch (_) {}
            if (err) {
                resolve({ up: false, latency: null, error: err.code || err.message });
            } else {
                resolve({ up: true, latency });
            }
        });
    });
}

async function httpCheck(url) {
    const started = Date.now();
    try {
        const resp = await axios({
            method: 'GET',
            url,
            timeout: CHECK_TIMEOUT_MS,
            httpsAgent,
            validateStatus: () => true
        });
        const latency = Date.now() - started;
        const up = resp.status < 500;
        return {
            up,
            latency: up ? latency : null,
            error: up ? null : `HTTP ${resp.status}`,
            status: resp.status
        };
    } catch (error) {
        const latency = Date.now() - started;
        log('warn', `HTTP check failed for ${url}: ${error.message}`);
        return {
            up: false,
            latency: null,
            error: error.code || error.message || 'error',
            status: error?.response?.status || null
        };
    }
}

async function checkOne(target) {
    const name = String(target.name || '').trim() || '—';
    const type = String(target.type || 'http').toLowerCase();

    if (type === 'tcp' || type === 'udp') {
        const host = String(target.host || '').trim();
        const port = parsePort(target.port);
        if (!host || !port) {
            return { name, type, up: false, latency: null, error: 'host and port required', target: `${host || '?'}:${target.port ?? '?'}` };
        }
        const result = type === 'tcp' ? await tcpCheck(host, port) : await udpCheck(host, port);
        return { name, type, target: `${host}:${port}`, ...result };
    }

    if (type === 'http' || type === 'https') {
        const url = String(target.url || '').trim();
        if (!url) {
            return { name, type: 'http', up: false, latency: null, error: 'url required', target: '' };
        }
        const result = await httpCheck(url);
        return { name, type: type === 'https' ? 'https' : 'http', target: url, ...result };
    }

    return { name, type, up: false, latency: null, error: 'unknown type', target: '' };
}

router.post('/check', async (req, res) => {
    const targets = Array.isArray(req.body?.targets) ? req.body.targets : [];
    if (!targets.length) {
        return res.json({ results: [] });
    }
    const limited = targets.slice(0, 30);
    const results = await Promise.all(limited.map(checkOne));
    res.json({ results });
});

module.exports = router;
