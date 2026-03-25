const express = require('express');
const axios = require('axios');
const https = require('https');
const { randomUUID, constants: cryptoConstants } = require('crypto');
const { log } = require('../utils');
const store = require('../settings-store');
const cache = require('../cache');

const router = express.Router();

const CONFIG_KEY = 'smart_sensors_configs';
const MAX_SENSORS = 24;
const MAX_REST_FIELDS = 15;
const REST_TIMEOUT_MS = 10000;
const CURRENT_CACHE_TTL_SEC = 8;
const BLE_SCAN_MS = 22000;

const httpsAgent = new https.Agent({
    rejectUnauthorized: false,
    secureOptions: cryptoConstants.SSL_OP_NO_TLSv1 | cryptoConstants.SSL_OP_NO_TLSv1_1
});

let nobleModule = null;
let nobleLoadAttempted = false;
let nobleLoadError = null;

function getNoble() {
    if (nobleLoadAttempted) {
        return nobleModule;
    }
    nobleLoadAttempted = true;
    try {
        nobleModule = require('@abandonware/noble');
    } catch (e) {
        nobleLoadError = e;
        nobleModule = null;
        log('warn', `[SmartSensors] BLE: модуль @abandonware/noble недоступен (${e.message})`);
    }
    return nobleModule;
}

function bleCapabilities() {
    const noble = getNoble();
    if (!noble) {
        return {
            available: false,
            reason: nobleLoadError ? String(nobleLoadError.message || nobleLoadError) : 'noble not installed'
        };
    }
    const st = noble.state;
    return {
        available: true,
        state: st || 'unknown',
        hint: 'Linux с BLE-адаптером; на Windows обычно не поддерживается. При сбоях используйте REST (шлюз/ESPHome).'
    };
}

function safeJsonParse(raw, fallback = null) {
    if (raw == null || raw === '') return fallback;
    try {
        return JSON.parse(String(raw));
    } catch {
        return fallback;
    }
}

function loadConfigsFromStore() {
    const raw = store.getSetting(CONFIG_KEY);
    const parsed = safeJsonParse(raw, null);
    if (!Array.isArray(parsed)) return [];
    return parsed
        .slice(0, MAX_SENSORS)
        .map(normalizeStoredConfig)
        .filter(Boolean);
}

function saveConfigsToStore(configs) {
    if (!Array.isArray(configs)) {
        throw new Error('configs must be array');
    }
    const trimmed = configs.slice(0, MAX_SENSORS).map(normalizeStoredConfig).filter(Boolean);
    store.setSetting(CONFIG_KEY, JSON.stringify(trimmed));
}

function toBool(v) {
    if (v === true) return true;
    if (v === false) return false;
    const s = String(v || '').toLowerCase();
    return s === '1' || s === 'true' || s === 'yes' || s === 'on';
}

function normalizeBleAddress(addr) {
    if (addr == null) return '';
    const s = String(addr).trim().toLowerCase().replace(/-/g, ':');
    const parts = s.split(':').filter(Boolean);
    if (parts.length === 6) {
        return parts.map((p) => p.padStart(2, '0')).join(':');
    }
    return s;
}

function expandBleUuid(input) {
    const raw = String(input || '').trim().toLowerCase().replace(/-/g, '');
    if (!raw) return '';
    if (raw.length <= 4) {
        const short = raw.padStart(4, '0');
        return `0000${short}-0000-1000-8000-00805f9b34fb`;
    }
    if (raw.length === 8) {
        return `${raw}-0000-1000-8000-00805f9b34fb`;
    }
    if (raw.length === 32) {
        return `${raw.slice(0, 8)}-${raw.slice(8, 12)}-${raw.slice(12, 16)}-${raw.slice(16, 20)}-${raw.slice(20)}`;
    }
    return String(input).trim().toLowerCase();
}

const LEGACY_REST_PATH_MAP = [
    ['pathTemperature', 'temperature'],
    ['pathHumidity', 'humidity'],
    ['pathPressure', 'pressure'],
    ['pathBattery', 'battery'],
    ['pathRssi', 'rssi']
];

function normalizeRestFields(raw) {
    if (!Array.isArray(raw)) return [];
    const out = [];
    for (const row of raw) {
        if (!row || typeof row !== 'object') continue;
        let label = row.label != null ? String(row.label).trim().slice(0, 64) : '';
        const path = row.path != null ? String(row.path).trim().slice(0, 512) : '';
        if (!path) continue;
        if (!label) {
            const parts = path.split('.').filter(Boolean);
            label = (parts.length ? parts[parts.length - 1] : 'value').slice(0, 64) || 'value';
        }
        out.push({
            label,
            path,
            enabled: row.enabled !== false
        });
        if (out.length >= MAX_REST_FIELDS) break;
    }
    return out;
}

/** Миграция со старых полей pathTemperature / pathHumidity / … */
function restFieldsFromLegacyOrArray(cfg) {
    const fromArr = normalizeRestFields(cfg.restFields);
    if (fromArr.length) return fromArr;
    const legacy = [];
    for (const [key, defaultLabel] of LEGACY_REST_PATH_MAP) {
        const v = cfg[key];
        if (v != null && String(v).trim() !== '') {
            legacy.push({
                label: defaultLabel,
                path: String(v).trim(),
                enabled: true
            });
        }
        if (legacy.length >= MAX_REST_FIELDS) break;
    }
    return legacy;
}

function normalizeBleChannels(raw) {
    if (!Array.isArray(raw)) return [];
    const allowedMetrics = new Set(['temperature', 'humidity', 'pressure', 'battery', 'custom']);
    const allowedFmt = new Set(['int16le', 'uint16le', 'int16be', 'uint16be', 'int8', 'uint8', 'floatle', 'floatbe']);
    const out = [];
    for (const row of raw) {
        if (!row || typeof row !== 'object') continue;
        const metric = String(row.metric || '').trim().toLowerCase();
        if (!allowedMetrics.has(metric)) continue;
        const uuid = expandBleUuid(row.uuid);
        if (!uuid) continue;
        let fmt = String(row.format || 'int16le').trim().toLowerCase();
        if (!allowedFmt.has(fmt)) fmt = 'int16le';
        const scale = Number(row.scale);
        const offset = Number(row.offset);
        const label = row.label != null ? String(row.label).trim().slice(0, 48) : '';
        out.push({
            metric,
            uuid,
            format: fmt,
            scale: Number.isFinite(scale) ? scale : 1,
            offset: Number.isFinite(offset) ? offset : 0,
            label: metric === 'custom' ? (label || 'custom') : metric
        });
        if (out.length >= 12) break;
    }
    return out;
}

function normalizeStoredConfig(cfg) {
    if (!cfg || typeof cfg !== 'object') return null;
    let id = cfg.id != null ? String(cfg.id).trim() : '';
    if (!id) id = randomUUID();

    const type = String(cfg.type || 'rest').trim().toLowerCase() === 'ble' ? 'ble' : 'rest';
    const name = cfg.name != null ? String(cfg.name).trim().slice(0, 120) : '';
    const enabled = toBool(cfg.enabled);

    if (type === 'rest') {
        const restUrl = cfg.restUrl != null ? String(cfg.restUrl).trim() : '';
        const method = String(cfg.restMethod || 'GET').trim().toUpperCase();
        const restMethod = method === 'POST' ? 'POST' : 'GET';
        let restHeaders = {};
        if (cfg.restHeaders && typeof cfg.restHeaders === 'object' && !Array.isArray(cfg.restHeaders)) {
            restHeaders = cfg.restHeaders;
        } else if (typeof cfg.restHeadersJson === 'string') {
            const p = safeJsonParse(cfg.restHeadersJson, {});
            if (p && typeof p === 'object' && !Array.isArray(p)) restHeaders = p;
        }
        const restBody = cfg.restBody != null ? String(cfg.restBody) : '';
        const restFields = restFieldsFromLegacyOrArray(cfg);
        return {
            id,
            type: 'rest',
            name: name || (restUrl ? restUrl.slice(0, 48) : 'REST'),
            enabled,
            restUrl,
            restMethod,
            restHeaders,
            restBody,
            restFields
        };
    }

    const bleAddress = normalizeBleAddress(cfg.bleAddress);
    const bleServiceUuid = expandBleUuid(cfg.bleServiceUuid) || expandBleUuid('1809');
    const channels = normalizeBleChannels(cfg.bleChannels);
    return {
        id,
        type: 'ble',
        name: name || bleAddress || 'BLE',
        enabled,
        bleAddress,
        bleServiceUuid,
        bleChannels: channels
    };
}

function getByPath(obj, pathStr) {
    if (obj == null || !pathStr) return undefined;
    const parts = String(pathStr).split('.').filter((p) => p !== '');
    let cur = obj;
    for (const p of parts) {
        if (cur == null) return undefined;
        if (/^\d+$/.test(p)) {
            const i = parseInt(p, 10);
            cur = Array.isArray(cur) ? cur[i] : undefined;
        } else {
            cur = cur[p];
        }
    }
    return cur;
}

function toNumberOrNull(v) {
    if (v == null) return null;
    if (typeof v === 'number' && Number.isFinite(v)) return v;
    const n = parseFloat(String(v).replace(',', '.'));
    return Number.isFinite(n) ? n : null;
}

function decodeBleBuffer(buf, spec) {
    if (!buf || !spec || !Buffer.isBuffer(buf)) return null;
    const fmt = String(spec.format || 'int16le').toLowerCase();
    const scale = Number.isFinite(Number(spec.scale)) ? Number(spec.scale) : 1;
    const offset = Number.isFinite(Number(spec.offset)) ? Number(spec.offset) : 0;
    try {
        let v = null;
        if (fmt === 'int16le' && buf.length >= 2) v = buf.readInt16LE(0);
        else if (fmt === 'uint16le' && buf.length >= 2) v = buf.readUInt16LE(0);
        else if (fmt === 'int16be' && buf.length >= 2) v = buf.readInt16BE(0);
        else if (fmt === 'uint16be' && buf.length >= 2) v = buf.readUInt16BE(0);
        else if (fmt === 'int8' && buf.length >= 1) v = buf.readInt8(0);
        else if (fmt === 'uint8' && buf.length >= 1) v = buf.readUInt8(0);
        else if (fmt === 'floatle' && buf.length >= 4) v = buf.readFloatLE(0);
        else if (fmt === 'floatbe' && buf.length >= 4) v = buf.readFloatBE(0);
        if (v == null || !Number.isFinite(v)) return null;
        return v * scale + offset;
    } catch {
        return null;
    }
}

function isAllowedRestUrl(url) {
    try {
        const u = new URL(url);
        return u.protocol === 'http:' || u.protocol === 'https:';
    } catch {
        return false;
    }
}

async function pollOneRest(cfg) {
    if (!cfg.restUrl || !isAllowedRestUrl(cfg.restUrl)) {
        return { type: 'rest', error: 'invalid or missing URL', values: {} };
    }
    const headers = { ...(cfg.restHeaders || {}) };
    const method = cfg.restMethod === 'POST' ? 'POST' : 'GET';
    try {
        const resp = await axios({
            method,
            url: cfg.restUrl,
            headers,
            data: method === 'POST' && cfg.restBody ? cfg.restBody : undefined,
            timeout: REST_TIMEOUT_MS,
            httpsAgent,
            validateStatus: () => true,
            transformResponse: [(data) => data]
        });
        const status = resp.status;
        if (status >= 400) {
            return { type: 'rest', error: `HTTP ${status}`, values: {}, httpStatus: status };
        }
        let body = resp.data;
        if (typeof body === 'string') {
            body = safeJsonParse(body.trim(), body);
        }
        const values = {};
        const usedKeys = new Set();
        const fields = Array.isArray(cfg.restFields) ? cfg.restFields : [];
        for (const f of fields) {
            if (!f || f.enabled === false) continue;
            const p = f.path != null ? String(f.path).trim() : '';
            if (!p) continue;
            let baseKey = f.label != null ? String(f.label).trim() : '';
            if (!baseKey) {
                const parts = p.split('.').filter(Boolean);
                baseKey = (parts.length ? parts[parts.length - 1] : 'value') || 'value';
            }
            baseKey = baseKey.slice(0, 64);
            let outKey = baseKey;
            let n = 2;
            while (usedKeys.has(outKey)) {
                outKey = `${baseKey}_${n++}`;
            }
            usedKeys.add(outKey);
            const raw = getByPath(body, p);
            const num = toNumberOrNull(raw);
            values[outKey] = {
                raw: raw != null && typeof raw !== 'object' ? String(raw) : raw,
                value: num
            };
        }
        return { type: 'rest', values, httpStatus: status };
    } catch (e) {
        log('warn', `[SmartSensors] REST ${cfg.name}: ${e.message}`);
        return { type: 'rest', error: e.message || 'request failed', values: {} };
    }
}

function peripheralMatchesAddress(peripheral, targetAddr) {
    const a = (peripheral.address || peripheral.id || '').toLowerCase();
    const t = targetAddr.toLowerCase();
    if (!a || !t) return false;
    if (a === t) return true;
    return a.replace(/:/g, '') === t.replace(/:/g, '');
}

function readBleSensor(cfg) {
    return new Promise((resolve) => {
        const noble = getNoble();
        if (!noble) {
            return resolve({ type: 'ble', error: 'BLE stack unavailable (install @abandonware/noble on Linux)', values: {} });
        }
        if (!cfg.bleAddress) {
            return resolve({ type: 'ble', error: 'BLE address missing', values: {} });
        }
        if (!cfg.bleChannels || !cfg.bleChannels.length) {
            return resolve({ type: 'ble', error: 'no BLE channels configured', values: {} });
        }

        const targetAddr = cfg.bleAddress;
        const serviceUuid = cfg.bleServiceUuid;
        let finished = false;
        const done = (payload) => {
            if (finished) return;
            finished = true;
            try {
                noble.removeListener('discover', onDiscover);
            } catch (_) {}
            try {
                noble.stopScanning();
            } catch (_) {}
            resolve(payload);
        };

        const timer = setTimeout(() => {
            done({ type: 'ble', error: 'BLE scan/connect timeout', values: {} });
        }, BLE_SCAN_MS);

        const onDiscover = (peripheral) => {
            if (finished) return;
            if (!peripheralMatchesAddress(peripheral, targetAddr)) return;
            clearTimeout(timer);
            noble.removeListener('discover', onDiscover);
            try {
                noble.stopScanning();
            } catch (_) {}

            peripheral.connect((connErr) => {
                if (connErr) {
                    return done({ type: 'ble', error: connErr.message || 'connect failed', values: {} });
                }
                peripheral.discoverServices([serviceUuid], (sErr, services) => {
                    if (sErr || !services || !services.length) {
                        try { peripheral.disconnect(); } catch (_) {}
                        return done({ type: 'ble', error: sErr ? sErr.message : 'service not found', values: {} });
                    }
                    const svc = services[0];
                    const chans = cfg.bleChannels;
                    const wantUuids = chans.map((c) => c.uuid);
                    svc.discoverCharacteristics(wantUuids, (cErr, characteristics) => {
                        if (cErr || !characteristics) {
                            try { peripheral.disconnect(); } catch (_) {}
                            return done({ type: 'ble', error: cErr ? cErr.message : 'characteristics not found', values: {} });
                        }
                        const values = {};
                        const byUuid = new Map(characteristics.map((ch) => [String(ch.uuid).toLowerCase(), ch]));
                        let pending = chans.length;
                        if (!pending) {
                            try { peripheral.disconnect(); } catch (_) {}
                            return done({ type: 'ble', values });
                        }
                        const checkDone = () => {
                            pending--;
                            if (pending <= 0) {
                                try { peripheral.disconnect(); } catch (_) {}
                                done({ type: 'ble', values });
                            }
                        };
                        for (const spec of chans) {
                            const ch = byUuid.get(spec.uuid.toLowerCase());
                            if (!ch) {
                                checkDone();
                                continue;
                            }
                            ch.read((rErr, data) => {
                                try {
                                    if (!rErr && data) {
                                        const num = decodeBleBuffer(data, spec);
                                        const key = spec.metric === 'custom' ? (spec.label || 'custom') : spec.metric;
                                        values[key] = {
                                            raw: data.toString('hex'),
                                            value: num
                                        };
                                    }
                                } finally {
                                    checkDone();
                                }
                            });
                        }
                    });
                });
            });
        };

        const startScan = () => {
            try {
                noble.on('discover', onDiscover);
                noble.startScanning([], false);
            } catch (e) {
                done({ type: 'ble', error: e.message || 'scan failed', values: {} });
            }
        };

        if (noble.state === 'poweredOn') {
            startScan();
        } else {
            noble.once('stateChange', (st) => {
                if (finished) return;
                if (st === 'poweredOn') startScan();
                else done({ type: 'ble', error: `BLE adapter: ${st}`, values: {} });
            });
        }
    });
}

function buildCurrentCacheKey() {
    return 'smart_sensors_current_v1';
}

async function fetchSmartSensorsCurrent() {
    const configs = loadConfigsFromStore();
    const enabled = configs.filter((c) => c && c.enabled);
    if (!enabled.length) {
        return {
            configured: false,
            ble: bleCapabilities(),
            updatedAt: new Date().toISOString()
        };
    }

    const nowIso = new Date().toISOString();
    const items = [];

    for (const cfg of enabled) {
        if (cfg.type === 'rest') {
            const data = await pollOneRest(cfg);
            items.push({
                id: cfg.id,
                name: cfg.name,
                type: 'rest',
                error: data.error || null,
                values: data.values || {},
                httpStatus: data.httpStatus
            });
        } else {
            const data = await readBleSensor(cfg);
            items.push({
                id: cfg.id,
                name: cfg.name,
                type: 'ble',
                error: data.error || null,
                values: data.values || {}
            });
        }
    }

    return {
        configured: true,
        ble: bleCapabilities(),
        items,
        updatedAt: nowIso
    };
}

router.get('/capabilities', (req, res) => {
    try {
        res.json({ success: true, ble: bleCapabilities() });
    } catch (e) {
        res.status(500).json({ success: false, error: e.message });
    }
});

router.get('/settings', (req, res) => {
    try {
        const configs = loadConfigsFromStore();
        res.json({ success: true, configs, maxConfigs: MAX_SENSORS, ble: bleCapabilities() });
    } catch (e) {
        log('error', `[SmartSensors] GET /settings: ${e.message}`);
        res.status(500).json({ success: false, error: e.message });
    }
});

router.post('/settings', (req, res) => {
    try {
        const body = req.body || {};
        if (!Array.isArray(body.configs)) {
            return res.status(400).json({ success: false, error: 'configs array required' });
        }
        saveConfigsToStore(body.configs);
        cache.del(buildCurrentCacheKey());
        log('info', '[SmartSensors] configs updated');
        res.json({ success: true });
    } catch (e) {
        log('error', `[SmartSensors] POST /settings: ${e.message}`);
        res.status(500).json({ success: false, error: e.message });
    }
});

router.get('/current', async (req, res) => {
    const cacheKey = buildCurrentCacheKey();
    const cached = cache.get(cacheKey);
    if (cached) return res.json(cached);

    try {
        const data = await fetchSmartSensorsCurrent();
        cache.set(cacheKey, data, CURRENT_CACHE_TTL_SEC);
        return res.json(data);
    } catch (e) {
        log('error', `[SmartSensors] GET /current: ${e.message}`);
        res.status(500).json({ configured: false, error: e.message, updatedAt: new Date().toISOString() });
    }
});

module.exports = router;
