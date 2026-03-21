#!/usr/bin/env node

const http = require('http');
const fs = require('fs');
const path = require('path');
const { URL } = require('url');
const { execFile } = require('child_process');

const HOST = process.env.HOST_METRICS_AGENT_HOST || '0.0.0.0';
const PORT = clampInt(process.env.HOST_METRICS_AGENT_PORT, 1, 65535, 9105);
const BASE_PATH = normalizeBasePath(process.env.HOST_METRICS_AGENT_BASE_PATH || '/host-metrics');
const SENSORS_BIN = process.env.HOST_METRICS_SENSORS_BIN || 'sensors';
const ETHTOOL_BIN = process.env.HOST_METRICS_ETHTOOL_BIN || 'ethtool';
const COMMAND_TIMEOUT_MS = clampInt(process.env.HOST_METRICS_COMMAND_TIMEOUT_MS, 500, 30000, 3000);

function clampInt(v, min, max, fallback) {
    const n = parseInt(v, 10);
    if (!Number.isFinite(n)) return fallback;
    if (n < min) return min;
    if (n > max) return max;
    return n;
}

function normalizeBasePath(v) {
    const raw = String(v || '').trim();
    if (!raw) return '/host-metrics';
    const prefixed = raw.startsWith('/') ? raw : '/' + raw;
    return prefixed.replace(/\/+$/, '') || '/host-metrics';
}

function json(res, statusCode, payload) {
    const body = JSON.stringify(payload);
    res.writeHead(statusCode, {
        'Content-Type': 'application/json; charset=utf-8',
        'Cache-Control': 'no-store',
        'Content-Length': Buffer.byteLength(body)
    });
    res.end(body);
}

function runCommand(file, args) {
    return new Promise((resolve, reject) => {
        execFile(file, args, { timeout: COMMAND_TIMEOUT_MS, maxBuffer: 1024 * 1024 }, (error, stdout, stderr) => {
            if (error) {
                const msg = stderr && String(stderr).trim()
                    ? String(stderr).trim()
                    : (error.message || String(error));
                return reject(new Error(msg));
            }
            resolve(String(stdout || ''));
        });
    });
}

function isPlainObject(v) {
    return !!v && typeof v === 'object' && !Array.isArray(v);
}

function numberOrNull(v) {
    const n = Number(v);
    return Number.isFinite(n) ? n : null;
}

function looksLikeCpuSensor(chipName, featureLabel) {
    const chip = String(chipName || '').toLowerCase();
    const label = String(featureLabel || '').toLowerCase();
    if (/(coretemp|k10temp|zenpower|fam15h|cpu|x86_pkg_temp)/.test(chip)) return true;
    if (/(package id|tctl|tdie|cpu|core \d+|ccd\d+)/.test(label)) return true;
    return false;
}

function collectTemperatureEntries(sensorsJson) {
    const rawEntries = [];

    function walk(node, chipName, trail) {
        if (!isPlainObject(node)) return;
        for (const [key, value] of Object.entries(node)) {
            if (isPlainObject(value)) {
                walk(value, chipName, trail.concat(key));
                continue;
            }
            if (!/_input$/i.test(key)) continue;
            const tempC = numberOrNull(value);
            if (tempC == null) continue;
            const featureLabel = trail.length ? trail[0] : key.replace(/_input$/i, '');
            rawEntries.push({
                chipName,
                featureLabel,
                tempC
            });
        }
    }

    if (isPlainObject(sensorsJson)) {
        for (const [chipName, chipData] of Object.entries(sensorsJson)) {
            if (!isPlainObject(chipData)) continue;
            walk(chipData, chipName, []);
        }
    }

    const filtered = rawEntries.length
        ? rawEntries
        : [];

    const byFeature = new Map();
    for (const entry of filtered) {
        const key = String(entry.featureLabel || '').trim();
        byFeature.set(key, (byFeature.get(key) || 0) + 1);
    }

    const seen = new Set();
    const out = [];
    for (const entry of filtered) {
        const baseLabel = String(entry.featureLabel || '').trim() || 'sensor';
        const duplicate = (byFeature.get(baseLabel) || 0) > 1;
        const generic = /^temp\d+$/i.test(baseLabel);
        const name = duplicate || generic
            ? `${baseLabel} [${entry.chipName}]`
            : baseLabel;
        if (seen.has(name)) continue;
        seen.add(name);
        out.push({
            name,
            featureLabel: baseLabel,
            chipName: entry.chipName,
            tempC: entry.tempC,
            priority: looksLikeCpuSensor(entry.chipName, baseLabel) ? 0 : 1
        });
    }

    out.sort((a, b) => {
        if (a.priority !== b.priority) return a.priority - b.priority;
        return a.name.localeCompare(b.name);
    });

    return out;
}

async function readSensorsJson() {
    const stdout = await runCommand(SENSORS_BIN, ['-j']);
    let parsed;
    try {
        parsed = JSON.parse(stdout);
    } catch (e) {
        throw new Error('invalid JSON from sensors -j');
    }
    return parsed;
}

async function getCpuSensors() {
    const sensorsJson = await readSensorsJson();
    return collectTemperatureEntries(sensorsJson);
}

async function getInterfaces() {
    const root = '/sys/class/net';
    const names = await fs.promises.readdir(root);
    return names
        .map((name) => String(name || '').trim())
        .filter((name) => name && name !== 'lo')
        .sort((a, b) => a.localeCompare(b));
}

async function readText(filePath) {
    const data = await fs.promises.readFile(filePath, 'utf8');
    return String(data || '').trim();
}

async function readOperState(iface) {
    try {
        return await readText(path.join('/sys/class/net', iface, 'operstate'));
    } catch {
        return 'unknown';
    }
}

async function readSpeedFromSysfs(iface) {
    try {
        const raw = await readText(path.join('/sys/class/net', iface, 'speed'));
        const n = parseInt(raw, 10);
        if (!Number.isFinite(n) || n <= 0) return null;
        return n;
    } catch {
        return null;
    }
}

async function readSpeedFromEthtool(iface) {
    try {
        const stdout = await runCommand(ETHTOOL_BIN, [iface]);
        const match = stdout.match(/Speed:\s*([0-9]+)\s*Mb\/s/i);
        if (!match) return null;
        const n = parseInt(match[1], 10);
        return Number.isFinite(n) && n > 0 ? n : null;
    } catch {
        return null;
    }
}

async function readInterfaceLink(iface) {
    if (!iface) throw new Error('iface query parameter is required');
    const state = await readOperState(iface);
    const speedFromSysfs = await readSpeedFromSysfs(iface);
    const speedMbps = speedFromSysfs != null ? speedFromSysfs : await readSpeedFromEthtool(iface);
    return {
        interface: iface,
        speedMbps,
        state: state || 'unknown'
    };
}

function findSensorByName(entries, name) {
    const wanted = String(name || '').trim();
    if (!wanted) return null;
    const byExact = entries.find((entry) => entry.name === wanted);
    if (byExact) return byExact;
    const byFeature = entries.find((entry) => entry.featureLabel === wanted);
    if (byFeature) return byFeature;
    return null;
}

function routePath(p) {
    return `${BASE_PATH}/${String(p || '').replace(/^\/+/, '')}`.replace(/\/{2,}/g, '/');
}

async function handleDiscovery(_req, res) {
    try {
        const [entries, interfaces] = await Promise.all([
            getCpuSensors(),
            getInterfaces()
        ]);
        json(res, 200, {
            cpuSensors: entries.map((entry) => entry.name),
            interfaces,
            updatedAt: new Date().toISOString()
        });
    } catch (error) {
        json(res, 500, {
            error: error.message || String(error),
            updatedAt: new Date().toISOString()
        });
    }
}

async function handleCurrent(req, res, parsedUrl) {
    const cpuSensor = parsedUrl.searchParams.get('cpuSensor') || '';
    const iface = parsedUrl.searchParams.get('iface') || '';

    try {
        const entries = await getCpuSensors();
        const selected = findSensorByName(entries, cpuSensor);
        if (!selected) {
            return json(res, 400, {
                error: 'cpu sensor not found',
                requestedCpuSensor: cpuSensor,
                updatedAt: new Date().toISOString()
            });
        }

        const link = await readInterfaceLink(iface);
        json(res, 200, {
            cpu: {
                sensor: selected.name,
                featureLabel: selected.featureLabel,
                chipName: selected.chipName,
                tempC: selected.tempC
            },
            link,
            updatedAt: new Date().toISOString()
        });
    } catch (error) {
        json(res, 500, {
            error: error.message || String(error),
            updatedAt: new Date().toISOString()
        });
    }
}

async function handleRoot(_req, res) {
    json(res, 200, {
        ok: true,
        service: 'proxmox-host-metrics-agent',
        basePath: BASE_PATH,
        endpoints: {
            discovery: routePath('discovery'),
            current: routePath('current'),
            healthz: routePath('healthz')
        },
        updatedAt: new Date().toISOString()
    });
}

const server = http.createServer((req, res) => {
    const parsedUrl = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
    const pathname = parsedUrl.pathname.replace(/\/+$/, '') || '/';

    if (req.method !== 'GET') {
        return json(res, 405, { error: 'method not allowed' });
    }

    if (pathname === BASE_PATH || pathname === routePath('')) {
        return handleRoot(req, res);
    }
    if (pathname === routePath('healthz')) {
        return json(res, 200, { ok: true, updatedAt: new Date().toISOString() });
    }
    if (pathname === routePath('discovery')) {
        return handleDiscovery(req, res);
    }
    if (pathname === routePath('current')) {
        return handleCurrent(req, res, parsedUrl);
    }

    return json(res, 404, { error: 'not found' });
});

server.listen(PORT, HOST, () => {
    process.stdout.write(
        `[host-metrics-agent] listening on http://${HOST}:${PORT}${BASE_PATH}\n`
    );
});
