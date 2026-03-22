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

function parseNutUrl(url) {
    // Expected: "upsName|varName" (also accept "upsName,varName")
    const raw = String(url || '').trim();
    if (!raw) return { upsName: null, varName: null };
    const parts = raw.includes('|') ? raw.split('|') : raw.split(',');
    if (parts.length < 2) return { upsName: null, varName: null };
    const upsName = String(parts[0] || '').trim();
    const varName = String(parts.slice(1).join('|') || '').trim();
    if (!upsName || !varName) return { upsName: null, varName: null };
    return { upsName, varName };
}

function parseSnmpUrl(url) {
    // Expected: "community|oid" (also accept "community,oid")
    const raw = String(url || '').trim();
    if (!raw) return { community: null, oid: null };
    const parts = raw.includes('|') ? raw.split('|') : raw.split(',');
    if (parts.length < 2) return { community: null, oid: null };
    const community = String(parts[0] || '').trim();
    const oid = String(parts.slice(1).join('|') || '').trim();
    if (!community || !oid) return { community: null, oid: null };
    return { community, oid };
}

function nutCheck(host, port, upsName, varName) {
    return new Promise((resolve) => {
        const started = Date.now();
        const socket = new net.Socket();
        let finished = false;
        let buf = '';

        const finish = (up, error) => {
            if (finished) return;
            finished = true;
            clearTimeout(timeout);
            try { socket.destroy(); } catch (_) {}
            resolve({
                up: !!up,
                latency: up ? (Date.now() - started) : null,
                error: up ? null : (error || 'error')
            });
        };

        const timeout = setTimeout(() => {
            try { socket.destroy(); } catch (_) {}
            finish(false, 'timeout');
        }, CHECK_TIMEOUT_MS);

        socket.once('error', (err) => {
            clearTimeout(timeout);
            finish(false, err.code || err.message);
        });

        socket.once('connect', () => {
            // NUT upsd protocol: "GET VAR <upsname> <varname>"
            socket.write(`GET VAR ${upsName} ${varName}\n`);
        });

        socket.on('data', (chunk) => {
            buf += chunk.toString('utf8');
            if (!buf.includes('\n')) return;

            // Try to extract quoted value from the first VAR response line
            const m = buf.match(/VAR\s+.+?\s+.+?\s+"([^"]*)"/);
            if (!m) return;
            const value = (m[1] || '').trim();

            // If this variable looks like ups.status, map common statuses.
            if (String(varName).trim() === 'ups.status') {
                const v = value.toUpperCase();
                const up = v === 'OL' || v === 'OB' || v === 'ONLINE' || v === 'BATTERY';
                finish(up, up ? null : `ups.status=${value}`);
                return;
            }

            const up = value.length > 0;
            finish(up, up ? null : 'empty-value');
        });
    });
}

async function snmpCheck(host, port, community, oid) {
    const started = Date.now();
    try {
        const snmp = require('net-snmp');
        const session = snmp.createSession(host, community, {
            port: port || 161,
            timeout: CHECK_TIMEOUT_MS,
            retries: 0
        });

        const result = await new Promise((resolve) => {
            session.get([oid], (error, varbinds) => {
                try { session.close(); } catch (_) {}
                if (error) return resolve({ up: false, latency: null, error: error.message || String(error) });
                const vb = Array.isArray(varbinds) ? varbinds[0] : null;
                if (!vb) return resolve({ up: false, latency: null, error: 'no-varbind' });
                if (snmp.isVarbindError && snmp.isVarbindError(vb)) {
                    return resolve({ up: false, latency: null, error: vb.toString() });
                }
                const strVal = vb.value != null ? String(vb.value).trim() : '';
                const up = strVal.length > 0;
                resolve({ up, latency: up ? (Date.now() - started) : null, error: up ? null : 'empty-value' });
            });
        });
        return result;
    } catch (e) {
        return { up: false, latency: null, error: e.message || String(e) };
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

    if (type === 'nut') {
        const host = String(target.host || '').trim();
        const port = parsePort(target.port);
        if (!host || !port) {
            return { name, type, up: false, latency: null, error: 'host and port required', target: `${host || '?'}:${target.port ?? '?'}` };
        }
        const { upsName, varName } = parseNutUrl(target.url);
        if (!upsName || !varName) {
            return { name, type, up: false, latency: null, error: 'url required (upsName|varName)', target: '' };
        }
        const result = await nutCheck(host, port, upsName, varName);
        return { name, type, target: `${host}:${port} ${upsName} ${varName}`, ...result };
    }

    if (type === 'snmp') {
        const host = String(target.host || '').trim();
        const port = parsePort(target.port);
        if (!host) {
            return { name, type, up: false, latency: null, error: 'host required', target: '' };
        }
        const { community, oid } = parseSnmpUrl(target.url);
        if (!community || !oid) {
            return { name, type, up: false, latency: null, error: 'url required (community|oid)', target: '' };
        }
        const result = await snmpCheck(host, port || 161, community, oid);
        return { name, type, target: `${host}:${port || 161} ${community} ${oid}`, ...result };
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
module.exports.checkOne = checkOne;
