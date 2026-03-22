const express = require('express');
const { log } = require('../utils');
const store = require('../settings-store');

const router = express.Router();

const CHECK_TIMEOUT_MS = 5000;

const NETDEV_CONFIGS_KEY = 'netdev_configs';
const MAX_NETDEV_CONFIGS = 10;
const NETDEV_MAX_FIELDS = 15;

const NETDEV_DISPLAY_SLOTS_MONITOR_KEY = 'netdev_display_slots_monitor';
const NETDEV_DISPLAY_SLOTS_DASHBOARD_KEY = 'netdev_display_slots_dashboard';
const DEFAULT_NETDEV_DISPLAY_SLOTS = Array.from({ length: MAX_NETDEV_CONFIGS }, (_, i) => i + 1);

function normalizeDisplaySlots(raw) {
    const maxSlot = MAX_NETDEV_CONFIGS;
    let arr = null;

    if (Array.isArray(raw)) {
        arr = raw;
    } else if (raw != null && raw !== '') {
        const s = String(raw).trim();
        if (s) {
            try {
                const parsed = JSON.parse(s);
                arr = Array.isArray(parsed) ? parsed : null;
            } catch {
                arr = s.split(',').map(x => x.trim());
            }
        }
    }

    if (!Array.isArray(arr)) return DEFAULT_NETDEV_DISPLAY_SLOTS.slice();

    const nums = arr
        .map((x) => {
            const n = typeof x === 'number' ? x : parseInt(String(x), 10);
            return Number.isFinite(n) ? n : null;
        })
        .filter((x) => x != null);

    if (!nums.length) return [];

    const uniq = Array.from(new Set(nums))
        .filter((n) => Number.isInteger(n) && n >= 1 && n <= maxSlot)
        .sort((a, b) => a - b);

    return uniq;
}

function toBool(v) {
    if (v === true) return true;
    if (v === false) return false;
    const s = String(v || '').toLowerCase();
    return s === '1' || s === 'true' || s === 'yes' || s === 'on';
}

function safeString(v) {
    return v == null ? '' : String(v);
}

/** Допустимые типы нормализации отображения значения SNMP-поля */
const NETDEV_FIELD_FORMATS = new Set(['text', 'time', 'mb', 'gb', 'boot', 'status']);
const NETDEV_STATUS_LIST_MAX = 40;

function normalizeFieldFormat(v) {
    const s = safeString(v).trim().toLowerCase();
    if (s === 'bool') return 'boot'; // синоним: bool / 0–1
    if (NETDEV_FIELD_FORMATS.has(s)) return s;
    return 'text';
}

/** Список значений для ручного сопоставления up/down (из массива или строки «a,b,c»). */
function parseStatusValueList(v) {
    if (Array.isArray(v)) {
        return v
            .map((x) => safeString(x).trim().toLowerCase())
            .filter((x) => x.length > 0)
            .slice(0, NETDEV_STATUS_LIST_MAX);
    }
    return safeString(v)
        .split(/[,;|]/)
        .map((s) => s.trim().toLowerCase())
        .filter((x) => x.length > 0)
        .slice(0, NETDEV_STATUS_LIST_MAX);
}

function normalizeField(raw) {
    const f = raw && typeof raw === 'object' ? raw : {};
    const label = safeString(f.label).trim();
    const oid = safeString(f.oid).trim();
    const format = normalizeFieldFormat(f.format);
    const enabled = f.enabled === false ? false : true;
    const statusUpValues = parseStatusValueList(f.statusUpValues);
    const statusDownValues = parseStatusValueList(f.statusDownValues);
    return { label, oid, format, enabled, statusUpValues, statusDownValues };
}

function normalizeNetdevConfig(raw) {
    const cfg = raw && typeof raw === 'object' ? raw : {};

    const enabled = toBool(cfg.enabled);
    const host = safeString(cfg.host).trim();
    const portNum = cfg.port != null && String(cfg.port).trim() !== '' ? parseInt(cfg.port, 10) : null;
    const port = Number.isFinite(portNum) ? portNum : null;
    const community = safeString(cfg.community).trim();

    const name = safeString(cfg.name).trim();
    // allow both nameOid and name_oid
    const nameOid = safeString(cfg.nameOid ?? cfg.name_oid).trim();

    const fieldsRaw = Array.isArray(cfg.fields) ? cfg.fields : [];
    const fields = fieldsRaw
        .slice(0, NETDEV_MAX_FIELDS)
        .map(normalizeField);

    return { enabled, host, port, community, name, nameOid, fields };
}

function createDefaultNetdevConfig() {
    return normalizeNetdevConfig({ enabled: false, fields: [] });
}

function firstNonEmptyString(...xs) {
    for (const x of xs) {
        const s = safeString(x).trim();
        if (s) return s;
    }
    return '';
}

function lastOidPart(oid) {
    const s = safeString(oid).trim();
    if (!s) return '';
    const parts = s.split('.').filter(Boolean);
    return parts.length ? parts[parts.length - 1] : s;
}

function getAppUnitsMode() {
    const u = safeString(store.getSetting('units')).toLowerCase();
    return u === 'binary' ? 'binary' : 'decimal';
}

/**
 * Число из строки SNMP (в т.ч. большие Counter64).
 * Для очень длинных целых без точки используем BigInt → Number (для отображения достаточно).
 */
function parseNumericFromSnmp(raw) {
    if (raw == null) return null;
    const s = String(raw).trim().replace(/,/g, '');
    if (!s) return null;
    if (/^-?\d+$/.test(s) && s.replace(/^-/, '').length > 15) {
        try {
            return Number(BigInt(s));
        } catch {
            return null;
        }
    }
    const n = Number(s);
    return Number.isFinite(n) ? n : null;
}

function formatDurationSeconds(totalSec) {
    const sec = Math.floor(Math.max(0, Number(totalSec) || 0));
    const d = Math.floor(sec / 86400);
    const h = Math.floor((sec % 86400) / 3600);
    const m = Math.floor((sec % 3600) / 60);
    const r = sec % 60;
    if (d > 0) return `${d}д ${h}ч ${m}м`;
    if (h > 0) return `${h}ч ${m}м ${r}с`;
    if (m > 0) return `${m}м ${r}с`;
    return `${r}с`;
}

/**
 * @param {string} rawStr - сырое значение из SNMP
 * @param {string} format - text | time | mb | gb | boot | status
 */
function formatNetdevFieldDisplay(rawStr, format) {
    const fmt = normalizeFieldFormat(format);
    if (fmt === 'text' || rawStr == null || String(rawStr).trim() === '') {
        return String(rawStr);
    }

    if (fmt === 'boot' || fmt === 'status') {
        return String(rawStr);
    }

    const n = parseNumericFromSnmp(rawStr);
    if (n == null) return String(rawStr);

    if (fmt === 'time') {
        // SNMP TimeTicks: сотые доли секунды (стандарт для sysUpTime и др.)
        const sec = n / 100;
        return formatDurationSeconds(sec);
    }

    const binary = getAppUnitsMode() === 'binary';

    if (fmt === 'mb') {
        const bytes = n;
        if (binary) {
            const mib = bytes / (1024 * 1024);
            return `${mib.toFixed(2)} МиБ`;
        }
        const mb = bytes / 1e6;
        return `${mb.toFixed(2)} МБ`;
    }

    if (fmt === 'gb') {
        const bytes = n;
        if (binary) {
            const gib = bytes / Math.pow(1024, 3);
            if (gib >= 1024) return `${(gib / 1024).toFixed(2)} ТиБ`;
            return `${gib.toFixed(2)} ГиБ`;
        }
        const gb = bytes / 1e9;
        if (gb >= 1000) return `${(gb / 1000).toFixed(2)} ТБ`;
        return `${gb.toFixed(2)} ГБ`;
    }

    return String(rawStr);
}

function normalizeStatusMatchToken(rawStr) {
    if (rawStr == null) return '';
    return String(rawStr).trim().toLowerCase();
}

/**
 * Классификация для локализации на клиенте: connected | disconnected | unknown
 * @param {string} rawStr
 * @param {string} format
 * @param {{ statusUpValues?: string[], statusDownValues?: string[] }} field
 */
function classifyNetdevStatusDisplay(rawStr, format, field) {
    const fmt = normalizeFieldFormat(format);
    if (fmt !== 'boot' && fmt !== 'status') return null;

    const rawTrim = rawStr != null ? String(rawStr).trim() : '';
    if (!rawTrim) return 'unknown';

    const token = normalizeStatusMatchToken(rawStr);

    const customUps = new Set(Array.isArray(field.statusUpValues) ? field.statusUpValues : []);
    const customDowns = new Set(Array.isArray(field.statusDownValues) ? field.statusDownValues : []);

    // Сначала ручные списки (если заданы) — и для boot, и для status
    if (customUps.size || customDowns.size) {
        if (customUps.has(token)) return 'connected';
        if (customDowns.has(token)) return 'disconnected';
        // Для status без совпадения — unknown; для boot ниже попробуем авто-эвристику
        if (fmt === 'status') return 'unknown';
    }

    if (fmt === 'boot') {
        const upTokens = new Set(['1', 'true', 'yes', 'on', 'up', 'online', 'connected', 'linkup']);
        const downTokens = new Set(['0', 'false', 'no', 'off', 'down', 'offline', 'disconnected', 'linkdown', '2']);
        if (upTokens.has(token)) return 'connected';
        if (downTokens.has(token)) return 'disconnected';
        const n = parseNumericFromSnmp(rawStr);
        if (n === 1) return 'connected';
        if (n === 0 || n === 2) return 'disconnected';
        return 'unknown';
    }

    // status — только ручные списки (уже проверены выше)
    return 'unknown';
}

async function snmpGetOids(host, port, community, oidList) {
    const snmp = require('net-snmp');

    const oids = Array.isArray(oidList) ? oidList : [];
    if (!oids.length) return { ok: true, results: [] };

    return new Promise((resolve) => {
        const session = snmp.createSession(host, community, {
            port: port || 161,
            timeout: CHECK_TIMEOUT_MS,
            retries: 0
        });

        session.get(oids, (error, varbinds) => {
            try { session.close(); } catch (_) {}

            if (error) {
                return resolve({
                    ok: false,
                    error: error.message || String(error),
                    results: oids.map(() => ({ ok: false, value: null, error: 'session-error' }))
                });
            }

            const values = Array.isArray(varbinds) ? varbinds : [];

            const results = oids.map((_, i) => {
                const vb = values[i] || null;
                if (!vb) return { ok: false, value: null, error: 'no-varbind' };
                if (snmp.isVarbindError && snmp.isVarbindError(vb)) {
                    return { ok: false, value: null, error: vb.toString() };
                }
                const strVal = vb.value != null ? String(vb.value).trim() : '';
                if (!strVal) return { ok: false, value: null, error: 'empty-value' };
                return { ok: true, value: strVal, error: null };
            });

            resolve({ ok: true, results });
        });
    });
}

function loadNetdevConfigsFromStore() {
    const raw = store.getSetting(NETDEV_CONFIGS_KEY);
    if (raw) {
        try {
            const parsed = JSON.parse(raw);
            if (Array.isArray(parsed)) {
                const out = parsed.slice(0, MAX_NETDEV_CONFIGS).map(normalizeNetdevConfig);
                while (out.length < MAX_NETDEV_CONFIGS) out.push(createDefaultNetdevConfig());
                return out;
            }
        } catch (e) {
            log('warn', '[NetDev] Не удалось разобрать netdev_configs JSON, используются дефолтные/по умолчанию', {
                message: e && e.message ? e.message : String(e)
            });
        }
    }

    const out = [];
    for (let i = 0; i < MAX_NETDEV_CONFIGS; i++) out.push(createDefaultNetdevConfig());
    return out;
}

function saveNetdevConfigsToStore(configs) {
    const arr = Array.isArray(configs) ? configs : [];
    const normalized = arr.slice(0, MAX_NETDEV_CONFIGS).map(normalizeNetdevConfig);
    while (normalized.length < MAX_NETDEV_CONFIGS) normalized.push(createDefaultNetdevConfig());
    store.setSetting(NETDEV_CONFIGS_KEY, JSON.stringify(normalized));
    return normalized;
}

async function pollNetdevSlot(cfg, slotIdx, nowIso) {
    const snmpPort = cfg.port || 161;
    const community = cfg.community;
    if (!community) {
        return {
            type: 'snmp',
            host: cfg.host,
            slot: slotIdx + 1,
            name: cfg.name || `NetDev ${slotIdx + 1}`,
            up: false,
            fields: cfg.fields.map(f => ({
                ...f,
                format: normalizeFieldFormat(f.format),
                enabled: f.enabled !== false,
                value: null,
                displayValue: null,
                statusDisplay: null,
                ok: false
            })),
            error: 'community required',
            updatedAt: nowIso
        };
    }

    const wantNameFromSnmp = !safeString(cfg.name).trim() && safeString(cfg.nameOid).trim();
    const oidList = [];
    const meta = [];

    if (wantNameFromSnmp) {
        oidList.push(cfg.nameOid);
        meta.push({ kind: 'name' });
    }

    for (let i = 0; i < cfg.fields.length; i++) {
        const fld = cfg.fields[i];
        if (!fld || fld.enabled === false) continue;
        const oid = safeString(fld.oid).trim();
        if (!oid) continue;
        oidList.push(oid);
        meta.push({ kind: 'field', fieldIdx: i });
    }

    if (!oidList.length) {
        const name = firstNonEmptyString(cfg.name, cfg.host, `NetDev ${slotIdx + 1}`) || `NetDev ${slotIdx + 1}`;
        return {
            type: 'snmp',
            host: cfg.host,
            slot: slotIdx + 1,
            name,
            up: false,
            fields: cfg.fields.map(f => ({
                ...f,
                format: normalizeFieldFormat(f.format),
                enabled: f.enabled !== false,
                value: null,
                displayValue: null,
                statusDisplay: null,
                ok: false
            })),
            updatedAt: nowIso
        };
    }

    const snmpRes = await snmpGetOids(cfg.host, snmpPort, community, oidList);
    if (!snmpRes.ok) {
        const name = firstNonEmptyString(cfg.name, cfg.host, `NetDev ${slotIdx + 1}`) || `NetDev ${slotIdx + 1}`;
        log('warn', `[NetDev] SNMP ${cfg.host}:${snmpPort}: ${snmpRes.error}`);
        return {
            type: 'snmp',
            host: cfg.host,
            slot: slotIdx + 1,
            name,
            up: false,
            fields: cfg.fields.map(f => ({
                ...f,
                format: normalizeFieldFormat(f.format),
                enabled: f.enabled !== false,
                value: null,
                displayValue: null,
                statusDisplay: null,
                ok: false
            })),
            error: snmpRes.error,
            updatedAt: nowIso
        };
    }

    let resolvedName = firstNonEmptyString(cfg.name, cfg.host, `NetDev ${slotIdx + 1}`) || `NetDev ${slotIdx + 1}`;
    let nameOk = false;

    const fieldValues = new Array(cfg.fields.length).fill(null).map(() => ({ value: null, ok: false }));

    for (let i = 0; i < snmpRes.results.length; i++) {
        const r = snmpRes.results[i];
        const m = meta[i];
        if (!m) continue;

        if (m.kind === 'name') {
            if (r.ok && safeString(r.value).trim()) {
                resolvedName = String(r.value).trim();
                nameOk = true;
            }
            continue;
        }

        if (m.kind === 'field') {
            const idx = m.fieldIdx;
            if (idx == null || idx < 0 || idx >= fieldValues.length) continue;
            if (r.ok && safeString(r.value).trim()) {
                fieldValues[idx] = { value: String(r.value).trim(), ok: true };
            }
        }
    }

    const fieldOkCount = fieldValues.reduce((acc, fv) => acc + (fv && fv.ok ? 1 : 0), 0);
    const up = fieldOkCount > 0 || nameOk;

    const fieldsOut = cfg.fields.map((f, i) => {
        const oid = safeString(f.oid).trim();
        const label = safeString(f.label).trim();
        const format = normalizeFieldFormat(f.format);
        const fieldOn = f.enabled !== false;
        const effectiveLabel = label || (oid ? lastOidPart(oid) : `Field ${i + 1}`);
        const ok = fieldOn ? (fieldValues[i] ? fieldValues[i].ok : false) : false;
        const rawVal = ok && fieldValues[i].value != null ? String(fieldValues[i].value) : null;
        let displayValue = null;
        let statusDisplay = null;
        if (ok && rawVal != null) {
            const st = classifyNetdevStatusDisplay(rawVal, format, f);
            if (st) {
                statusDisplay = st;
            } else {
                displayValue = formatNetdevFieldDisplay(rawVal, format);
            }
        }
        return {
            label: effectiveLabel,
            oid,
            format,
            enabled: fieldOn,
            statusUpValues: f.statusUpValues,
            statusDownValues: f.statusDownValues,
            value: rawVal,
            displayValue,
            statusDisplay,
            ok
        };
    });

    return {
        type: 'snmp',
        host: cfg.host,
        slot: slotIdx + 1,
        name: resolvedName,
        up,
        fields: fieldsOut,
        updatedAt: nowIso
    };
}

async function pollNetdevMonitoringItems() {
    const configs = loadNetdevConfigsFromStore();
    const enabledConfigs = configs
        .map((cfg, idx) => ({ cfg, idx }))
        .filter(x => x.cfg && x.cfg.enabled && x.cfg.host);
    if (!enabledConfigs.length) return [];
    const nowIso = new Date().toISOString();
    return Promise.all(enabledConfigs.map(({ cfg, idx }) => pollNetdevSlot(cfg, idx, nowIso)));
}

router.get('/settings', (req, res) => {
    try {
        const configs = loadNetdevConfigsFromStore();
        res.json({ success: true, configs, maxConfigs: MAX_NETDEV_CONFIGS, maxFields: NETDEV_MAX_FIELDS });
    } catch (e) {
        log('error', `[NetDev] GET /settings: ${e.message}`);
        res.status(500).json({ success: false, error: e.message });
    }
});

router.post('/settings', (req, res) => {
    try {
        const body = req.body || {};
        if (!Array.isArray(body.configs)) {
            return res.status(400).json({ success: false, error: 'configs required' });
        }
        saveNetdevConfigsToStore(body.configs);
        res.json({ success: true });
    } catch (e) {
        log('error', `[NetDev] POST /settings: ${e.message}`);
        res.status(500).json({ success: false, error: e.message });
    }
});

router.get('/display', (req, res) => {
    try {
        const monitorSlots = normalizeDisplaySlots(store.getSetting(NETDEV_DISPLAY_SLOTS_MONITOR_KEY));
        const dashboardSlots = normalizeDisplaySlots(store.getSetting(NETDEV_DISPLAY_SLOTS_DASHBOARD_KEY));
        res.json({ success: true, monitorSlots, dashboardSlots });
    } catch (e) {
        log('error', `[NetDev] GET /display: ${e.message}`);
        res.status(500).json({ success: false, error: e.message });
    }
});

router.post('/display', (req, res) => {
    try {
        const body = req.body || {};
        const monitorSlots = normalizeDisplaySlots(body.monitorSlots);
        const dashboardSlots = normalizeDisplaySlots(body.dashboardSlots);
        store.setSetting(NETDEV_DISPLAY_SLOTS_MONITOR_KEY, JSON.stringify(monitorSlots));
        store.setSetting(NETDEV_DISPLAY_SLOTS_DASHBOARD_KEY, JSON.stringify(dashboardSlots));
        res.json({ success: true });
    } catch (e) {
        log('error', `[NetDev] POST /display: ${e.message}`);
        res.status(500).json({ success: false, error: e.message });
    }
});

router.get('/current', async (req, res) => {
    try {
        const results = await pollNetdevMonitoringItems();
        if (!results.length) {
            return res.json({
                configured: false,
                updatedAt: new Date().toISOString()
            });
        }
        const nowIso = results[0].updatedAt || new Date().toISOString();

        res.json({
            configured: true,
            items: results,
            updatedAt: nowIso
        });
    } catch (e) {
        log('error', `[NetDev] GET /current: ${e.message}`, e.stack ? { stack: e.stack } : null);
        res.status(500).json({ configured: false, error: e.message, updatedAt: new Date().toISOString() });
    }
});

module.exports = router;
module.exports.pollNetdevMonitoringItems = pollNetdevMonitoringItems;

