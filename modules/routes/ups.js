const express = require('express');
const net = require('net');
const crypto = require('crypto');
const { log } = require('../utils');
const store = require('../settings-store');
const cache = require('../cache');

const router = express.Router();

const CHECK_TIMEOUT_MS = 5000;
/** Один сеанс NUT: таймаут на весь опрос всех переменных (параллельные сокеты upsd часто даёт таймауты). */
const NUT_BATCH_TIMEOUT_MS = 20000;
const UPS_CONFIGS_KEY = 'ups_configs';
const MAX_UPS_CONFIGS = 4;
const UPS_DISPLAY_SLOTS_MONITOR_KEY = 'ups_display_slots_monitor';
const UPS_DISPLAY_SLOTS_DASHBOARD_KEY = 'ups_display_slots_dashboard';
const DEFAULT_UPS_DISPLAY_SLOTS = [1, 2, 3, 4];
const UPS_CURRENT_CACHE_TTL_SEC = 8;

function normalizeDisplaySlots(raw) {
    const maxSlot = MAX_UPS_CONFIGS;
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

    if (!Array.isArray(arr)) return DEFAULT_UPS_DISPLAY_SLOTS.slice();

    const nums = arr
        .map((x) => {
            const n = typeof x === 'number' ? x : parseInt(String(x), 10);
            return Number.isFinite(n) ? n : null;
        })
        .filter((x) => x != null);

    if (!nums.length) return [];

    // Если пришли 0-based слоты [0..3] — переводим в [1..4]
    const isZeroBased = nums.every((n) => Number.isInteger(n) && n >= 0 && n < maxSlot);
    const slots = isZeroBased ? nums.map(n => n + 1) : nums;

    // uniq + clamp в диапазон 1..maxSlot
    const uniq = Array.from(new Set(slots))
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

function firstNumberFromString(s) {
    if (s == null) return null;
    const m = String(s).match(/-?\d+(?:\.\d+)?/);
    if (!m) return null;
    const n = Number(m[0]);
    return Number.isFinite(n) ? n : null;
}

function metricFromRaw(raw) {
    const r = raw != null ? String(raw).trim() : '';
    return {
        raw: r || null,
        value: firstNumberFromString(r)
    };
}

function formatRuntimeSeconds(seconds) {
    const n = Number(seconds);
    if (!Number.isFinite(n) || n <= 0) return null;
    const h = Math.floor(n / 3600);
    const m = Math.floor((n % 3600) / 60);
    const s = Math.floor(n % 60);
    if (h > 0) return `${h}h ${m}m`;
    if (m > 0) return `${m}m ${s}s`;
    return `${s}s`;
}

function mapNutStatus(statusRaw) {
    const s = String(statusRaw || '').toUpperCase();
    if (!s) return { label: 'unknown', up: null, badge: 'bg-secondary' };
    if (s === 'OL') return { label: 'Online', up: true, badge: 'bg-success' };
    if (s === 'OB') return { label: 'On battery', up: false, badge: 'bg-warning text-dark' };
    if (s === 'LB') return { label: 'Low battery', up: false, badge: 'bg-danger' };
    if (s === 'OFF') return { label: 'Off', up: false, badge: 'bg-secondary' };
    return { label: s, up: null, badge: 'bg-secondary' };
}

const MAX_UPS_FIELDS = 15;
const UPS_SEMANTIC_IDS = ['status', 'charge', 'runtime', 'inputVoltage', 'outputVoltage', 'power', 'load', 'frequency'];
const UPS_FIELD_FORMATS = new Set(['text', 'number', 'percent', 'voltage', 'watt', 'frequency', 'time', 'nut_status', 'boot', 'status']);

const LEGACY_NUT_KEYS = {
    status: 'nutVarStatus',
    charge: 'nutVarCharge',
    runtime: 'nutVarRuntime',
    inputVoltage: 'nutVarInputVoltage',
    outputVoltage: 'nutVarOutputVoltage',
    power: 'nutVarPower',
    load: 'nutVarLoad',
    frequency: 'nutVarFrequency'
};

const LEGACY_SNMP_KEYS = {
    status: 'snmpOidStatus',
    charge: 'snmpOidCharge',
    runtime: 'snmpOidRuntime',
    inputVoltage: 'snmpOidInputVoltage',
    outputVoltage: 'snmpOidOutputVoltage',
    power: 'snmpOidPower',
    load: 'snmpOidLoad',
    frequency: 'snmpOidFrequency'
};

function normalizeNutDefaults(cfg) {
    return {
        nutVarStatus: cfg.nutVarStatus || 'ups.status',
        nutVarCharge: cfg.nutVarCharge || 'battery.charge',
        nutVarRuntime: cfg.nutVarRuntime || 'battery.runtime',
        nutVarInputVoltage: cfg.nutVarInputVoltage || 'input.voltage',
        nutVarOutputVoltage: cfg.nutVarOutputVoltage || 'output.voltage',
        nutVarPower: cfg.nutVarPower || 'ups.realpower',
        nutVarLoad: cfg.nutVarLoad || 'ups.load',
        nutVarFrequency: cfg.nutVarFrequency || 'input.frequency'
    };
}

function normalizeSnmpDefaults(cfg) {
    return {
        snmpCommunity: cfg.snmpCommunity || '',
        snmpOidStatus: cfg.snmpOidStatus || '',
        snmpOidCharge: cfg.snmpOidCharge || '',
        snmpOidRuntime: cfg.snmpOidRuntime || '',
        snmpOidInputVoltage: cfg.snmpOidInputVoltage || '',
        snmpOidOutputVoltage: cfg.snmpOidOutputVoltage || '',
        snmpOidPower: cfg.snmpOidPower || '',
        snmpOidLoad: cfg.snmpOidLoad || '',
        snmpOidFrequency: cfg.snmpOidFrequency || ''
    };
}

function parseUpsStatusList(arr) {
    if (!Array.isArray(arr)) return [];
    return arr.map((x) => String(x || '').trim().toLowerCase()).filter(Boolean);
}

function normalizeUpsFieldDef(raw, idx, upsType) {
    const f = raw && typeof raw === 'object' ? raw : {};
    let id = String(f.id || '').trim().replace(/[^\w-]/g, '');
    if (!id) id = `field_${idx}`;

    let format = String(f.format || 'text').trim().toLowerCase();
    if (format === 'bool') format = 'boot';
    if (!UPS_FIELD_FORMATS.has(format)) format = 'text';
    if (upsType === 'snmp' && format === 'nut_status') format = 'status';

    const path = String(f.path != null ? f.path : f.oid || '').trim();
    const label = String(f.label || '').trim() || `Field ${idx + 1}`;
    const enabled = f.enabled !== false && f.poll !== false;

    return {
        id,
        label,
        path,
        format,
        enabled,
        statusUpValues: parseUpsStatusList(f.statusUpValues),
        statusDownValues: parseUpsStatusList(f.statusDownValues)
    };
}

function buildDefaultNutFields(nut) {
    const defs = [
        ['status', 'nut_status', nut.nutVarStatus],
        ['charge', 'percent', nut.nutVarCharge],
        ['runtime', 'time', nut.nutVarRuntime],
        ['inputVoltage', 'voltage', nut.nutVarInputVoltage],
        ['outputVoltage', 'voltage', nut.nutVarOutputVoltage],
        ['power', 'watt', nut.nutVarPower],
        ['load', 'percent', nut.nutVarLoad],
        ['frequency', 'frequency', nut.nutVarFrequency]
    ];
    return defs.map(([id, format, path]) => ({
        id,
        label: id,
        path: path || '',
        format,
        enabled: true,
        statusUpValues: [],
        statusDownValues: []
    }));
}

function buildDefaultSnmpFields(snmp) {
    const defs = [
        ['status', 'status', snmp.snmpOidStatus],
        ['charge', 'percent', snmp.snmpOidCharge],
        ['runtime', 'time', snmp.snmpOidRuntime],
        ['inputVoltage', 'voltage', snmp.snmpOidInputVoltage],
        ['outputVoltage', 'voltage', snmp.snmpOidOutputVoltage],
        ['power', 'watt', snmp.snmpOidPower],
        ['load', 'percent', snmp.snmpOidLoad],
        ['frequency', 'frequency', snmp.snmpOidFrequency]
    ];
    return defs.map(([id, format, path]) => ({
        id,
        label: id,
        path: path || '',
        format,
        enabled: true,
        statusUpValues: [],
        statusDownValues: []
    }));
}

function resolveUpsFieldList(cfg, type) {
    if (Array.isArray(cfg.fields) && cfg.fields.length > 0) {
        return cfg.fields.map((f, i) => normalizeUpsFieldDef(f, i, type)).slice(0, MAX_UPS_FIELDS);
    }
    const base = type === 'nut' ? normalizeNutDefaults(cfg) : normalizeSnmpDefaults(cfg);
    const built = type === 'nut' ? buildDefaultNutFields(base) : buildDefaultSnmpFields(base);
    return built.slice(0, MAX_UPS_FIELDS);
}

function applyFieldsToLegacyKeys(legacyObj, fields, type) {
    const map = type === 'nut' ? LEGACY_NUT_KEYS : LEGACY_SNMP_KEYS;
    for (const id of UPS_SEMANTIC_IDS) {
        const key = map[id];
        const f = fields.find((x) => x.id === id);
        if (f && String(f.path || '').trim()) {
            legacyObj[key] = f.path.trim();
        }
    }
}

function normalizeUpsConfig(raw) {
    const cfg = raw && typeof raw === 'object' ? raw : {};
    const enabled = toBool(cfg.enabled);
    const type = String(cfg.type || 'nut').toLowerCase() === 'snmp' ? 'snmp' : 'nut';
    const host = safeString(cfg.host).trim();
    const portNum = cfg.port != null && String(cfg.port).trim() !== '' ? parseInt(cfg.port, 10) : null;
    const port = Number.isFinite(portNum) ? portNum : null;
    const name = safeString(cfg.name || cfg.upsName || cfg.nutName).trim();

    if (type === 'nut') {
        const nut = normalizeNutDefaults(cfg);
        const fields = resolveUpsFieldList({ ...cfg, ...nut }, 'nut');
        applyFieldsToLegacyKeys(nut, fields, 'nut');
        return { enabled, type, host, port, name, ...nut, fields };
    }
    const snmp = normalizeSnmpDefaults(cfg);
    const fields = resolveUpsFieldList({ ...cfg, ...snmp }, 'snmp');
    applyFieldsToLegacyKeys(snmp, fields, 'snmp');
    return { enabled, type, host, port, name, ...snmp, fields };
}

function classifyUpsSnmpStatus(raw, field) {
    const r = raw != null ? String(raw).trim().toLowerCase() : '';
    const ups = field.statusUpValues || [];
    const downs = field.statusDownValues || [];
    if (ups.length && ups.includes(r)) {
        return { up: true, label: String(raw) };
    }
    if (downs.length && downs.includes(r)) {
        return { up: false, label: String(raw) };
    }
    if (field.format === 'boot') {
        if (['1', 'true', 'yes', 'on', 'up', 'online'].includes(r)) return { up: true, label: String(raw) };
        if (['0', 'false', 'no', 'off', 'down', 'offline'].includes(r)) return { up: false, label: String(raw) };
    }
    return { up: null, label: r !== '' ? String(raw) : 'unknown' };
}

function buildUpsMetricRow(field, raw, ok, pollError) {
    const row = {
        id: field.id,
        label: field.label,
        format: field.format,
        path: field.path,
        ok: !!ok,
        raw: ok && raw != null ? String(raw) : null,
        display: '—',
        value: null,
        up: null,
        error: ok ? null : (pollError || 'fail')
    };
    if (!ok) return row;
    const r = raw;
    switch (field.format) {
        case 'nut_status': {
            const m = mapNutStatus(r);
            row.display = m.label;
            row.up = m.up;
            break;
        }
        case 'status':
        case 'boot': {
            const c = classifyUpsSnmpStatus(r, field);
            row.display = c.label;
            row.up = c.up;
            break;
        }
        case 'percent':
        case 'number': {
            const n = firstNumberFromString(r);
            row.value = n;
            row.display = n != null ? (field.format === 'percent' ? `${n}%` : String(n)) : String(r);
            break;
        }
        case 'voltage':
        case 'watt':
        case 'frequency': {
            const n = firstNumberFromString(r);
            row.value = n;
            const suf = field.format === 'voltage' ? ' V' : field.format === 'watt' ? ' W' : ' Hz';
            row.display = n != null ? `${n}${suf}` : String(r);
            break;
        }
        case 'time': {
            const n = firstNumberFromString(r);
            row.value = n;
            row.display = n != null ? (formatRuntimeSeconds(n) || String(n)) : String(r);
            break;
        }
        default:
            row.display = r != null ? String(r) : '—';
    }
    return row;
}

function findOkUpsMetric(metrics, pred) {
    return metrics.find((m) => m.ok && pred(m)) || null;
}

function buildLegacyUpsFromMetrics(metrics) {
    const st =
        findOkUpsMetric(metrics, (m) => m.id === 'status' && ['nut_status', 'status', 'boot'].includes(m.format)) ||
        findOkUpsMetric(metrics, (m) => m.format === 'nut_status') ||
        findOkUpsMetric(metrics, (m) => m.format === 'status' || m.format === 'boot');

    const status = { raw: null, label: 'unknown', up: null };
    if (st) {
        status.raw = st.raw;
        if (st.format === 'nut_status') {
            const mm = mapNutStatus(st.raw);
            status.label = mm.label;
            status.up = mm.up;
        } else {
            status.label = st.display || (st.raw != null ? String(st.raw) : 'unknown');
            status.up = st.up;
        }
    }

    const ch =
        findOkUpsMetric(metrics, (m) => m.id === 'charge') ||
        findOkUpsMetric(metrics, (m) => m.format === 'percent' && m.id !== 'load') ||
        findOkUpsMetric(metrics, (m) => m.format === 'percent');

    const loadM = findOkUpsMetric(metrics, (m) => m.id === 'load');

    const rt = findOkUpsMetric(metrics, (m) => m.id === 'runtime') || findOkUpsMetric(metrics, (m) => m.format === 'time');

    const inVm = findOkUpsMetric(metrics, (m) => m.id === 'inputVoltage');
    const outVm = findOkUpsMetric(metrics, (m) => m.id === 'outputVoltage');
    const vols = metrics.filter((m) => m.ok && m.format === 'voltage');
    const inVmet = inVm || vols[0] || null;
    const outVmet = outVm || vols[1] || null;

    const pwr = findOkUpsMetric(metrics, (m) => m.id === 'power') || findOkUpsMetric(metrics, (m) => m.format === 'watt');
    const freqM = findOkUpsMetric(metrics, (m) => m.id === 'frequency') || findOkUpsMetric(metrics, (m) => m.format === 'frequency');

    const chargeRaw = ch ? ch.raw : null;
    const runtimeRaw = rt ? rt.raw : null;
    const rtSec = runtimeRaw != null ? firstNumberFromString(runtimeRaw) : null;

    return {
        status,
        battery: {
            chargeRaw,
            chargePct: firstNumberFromString(chargeRaw),
            runtimeRaw,
            runtimeFormatted: rtSec != null ? formatRuntimeSeconds(rtSec) : null
        },
        electrical: {
            inputVoltage: metricFromRaw(inVmet ? inVmet.raw : null),
            outputVoltage: metricFromRaw(outVmet ? outVmet.raw : null),
            powerW: metricFromRaw(pwr ? pwr.raw : null),
            loadPercent: metricFromRaw(loadM ? loadM.raw : null),
            frequencyHz: metricFromRaw(freqM ? freqM.raw : null)
        }
    };
}

function getSnmpUpsStatusPath(cfg) {
    const fields = cfg.fields;
    if (Array.isArray(fields)) {
        const st = fields.find((f) =>
            f.enabled &&
            String(f.path || '').trim() &&
            (f.id === 'status' || f.format === 'status' || f.format === 'boot' || f.format === 'nut_status')
        );
        if (st) return st.path.trim();
    }
    return String(cfg.snmpOidStatus || '').trim();
}

function loadUpsConfigsFromStore() {
    const raw = store.getSetting(UPS_CONFIGS_KEY);
    if (raw) {
        try {
            const parsed = JSON.parse(raw);
            if (Array.isArray(parsed)) {
                const out = parsed.slice(0, MAX_UPS_CONFIGS).map(normalizeUpsConfig);
                while (out.length < MAX_UPS_CONFIGS) out.push(normalizeUpsConfig({ enabled: false }));
                return out;
            }
        } catch (e) {
            log('warn', '[UPS] Не удалось разобрать ups_configs JSON, используются legacy-ключи или значения по умолчанию', {
                message: e && e.message ? e.message : String(e)
            });
        }
    }

    // Legacy single UPS -> slot 0
    const legacy = normalizeUpsConfig({
        enabled: toBool(store.getSetting('ups_enabled')),
        type: store.getSetting('ups_type') || 'nut',
        host: store.getSetting('ups_host'),
        port: store.getSetting('ups_port'),
        name: store.getSetting('ups_name'),

        nutVarStatus: store.getSetting('nut_var_status') || 'ups.status',
        nutVarCharge: store.getSetting('nut_var_charge') || 'battery.charge',
        nutVarRuntime: store.getSetting('nut_var_runtime') || 'battery.runtime',
        nutVarInputVoltage: store.getSetting('nut_var_input_voltage') || 'input.voltage',
        nutVarOutputVoltage: store.getSetting('nut_var_output_voltage') || 'output.voltage',
        nutVarPower: store.getSetting('nut_var_power') || 'ups.realpower',
        nutVarLoad: store.getSetting('nut_var_load') || 'ups.load',
        nutVarFrequency: store.getSetting('nut_var_frequency') || 'input.frequency',

        snmpCommunity: store.getSetting('snmp_community'),
        snmpOidStatus: store.getSetting('snmp_oid_status'),
        snmpOidCharge: store.getSetting('snmp_oid_charge'),
        snmpOidRuntime: store.getSetting('snmp_oid_runtime'),
        snmpOidInputVoltage: store.getSetting('snmp_oid_input_voltage'),
        snmpOidOutputVoltage: store.getSetting('snmp_oid_output_voltage'),
        snmpOidPower: store.getSetting('snmp_oid_power'),
        snmpOidLoad: store.getSetting('snmp_oid_load'),
        snmpOidFrequency: store.getSetting('snmp_oid_frequency')
    });

    const out = [legacy];
    while (out.length < MAX_UPS_CONFIGS) out.push(normalizeUpsConfig({ enabled: false }));
    return out;
}

function saveUpsConfigsToStore(configs) {
    const arr = Array.isArray(configs) ? configs : [];
    const normalized = arr.slice(0, MAX_UPS_CONFIGS).map(normalizeUpsConfig);
    while (normalized.length < MAX_UPS_CONFIGS) normalized.push(normalizeUpsConfig({ enabled: false }));

    store.setSetting(UPS_CONFIGS_KEY, JSON.stringify(normalized));

    // Keep legacy keys in sync for backward compatibility (slot 0 only)
    const slot0 = normalized[0] || normalizeUpsConfig({ enabled: false });
    store.setSetting('ups_enabled', slot0.enabled ? '1' : '0');
    store.setSetting('ups_type', slot0.type);
    store.setSetting('ups_host', slot0.host);
    store.setSetting('ups_port', slot0.port != null ? String(slot0.port) : '');
    store.setSetting('ups_name', slot0.name);

    if (slot0.type === 'nut') {
        store.setSetting('nut_var_status', slot0.nutVarStatus);
        store.setSetting('nut_var_charge', slot0.nutVarCharge);
        store.setSetting('nut_var_runtime', slot0.nutVarRuntime);
        store.setSetting('nut_var_input_voltage', slot0.nutVarInputVoltage);
        store.setSetting('nut_var_output_voltage', slot0.nutVarOutputVoltage);
        store.setSetting('nut_var_power', slot0.nutVarPower);
        store.setSetting('nut_var_load', slot0.nutVarLoad);
        store.setSetting('nut_var_frequency', slot0.nutVarFrequency);
    } else {
        store.setSetting('snmp_community', slot0.snmpCommunity);
        store.setSetting('snmp_oid_status', slot0.snmpOidStatus);
        store.setSetting('snmp_oid_charge', slot0.snmpOidCharge);
        store.setSetting('snmp_oid_runtime', slot0.snmpOidRuntime);
        store.setSetting('snmp_oid_input_voltage', slot0.snmpOidInputVoltage);
        store.setSetting('snmp_oid_output_voltage', slot0.snmpOidOutputVoltage);
        store.setSetting('snmp_oid_power', slot0.snmpOidPower);
        store.setSetting('snmp_oid_load', slot0.snmpOidLoad);
        store.setSetting('snmp_oid_frequency', slot0.snmpOidFrequency);
    }

    const activeCount = normalized.filter((c) => c && c.enabled && c.host).length;
    log('info', '[UPS] Настройки сохранены', {
        activeSlots: activeCount,
        maxSlots: MAX_UPS_CONFIGS
    });

    return normalized;
}

function buildUpsCurrentCacheKey() {
    const configs = loadUpsConfigsFromStore();
    const fingerprint = crypto
        .createHash('sha1')
        .update(JSON.stringify(configs))
        .digest('hex')
        .slice(0, 16);
    return `ups_current_${fingerprint}`;
}

function parseVarLine(line) {
    // Expected: VAR <upsname> <varname> "<value>"
    const m = String(line || '').match(/VAR\s+.+?\s+.+?\s+"([^"]*)"/);
    if (!m) return null;
    return (m[1] || '').trim();
}

/**
 * Читает несколько переменных по одному TCP-соединению (upsd плохо переносит много параллельных клиентов).
 * Запросы идут по одному: GET → ответ → следующий GET. Строки приветствия upsd пропускаются.
 */
function nutGetVarsBatch(host, port, upsName, varNameList) {
    const list = Array.isArray(varNameList) ? varNameList.filter((v) => String(v || '').trim()) : [];
    return new Promise((resolve) => {
        if (!list.length) {
            return resolve([]);
        }

        const started = Date.now();
        let settled = false;
        const socket = new net.Socket();
        let buf = '';
        let sent = 0;
        let received = 0;
        const out = list.map(() => ({ ok: false, value: null, latency: null, error: 'pending' }));

        const mapResult = (o) => ({
            ok: o.ok,
            value: o.value,
            latency: o.ok ? (Date.now() - started) : null,
            error: o.ok ? null : (o.error === 'pending' ? 'timeout' : o.error)
        });

        const done = () => {
            if (settled) return;
            settled = true;
            clearTimeout(timeout);
            try { socket.destroy(); } catch (_) {}
            resolve(out.map(mapResult));
        };

        const timeout = setTimeout(() => {
            for (let i = 0; i < out.length; i++) {
                if (out[i].error === 'pending') {
                    out[i] = { ok: false, value: null, latency: null, error: 'timeout' };
                }
            }
            try { socket.destroy(); } catch (_) {}
            done();
        }, NUT_BATCH_TIMEOUT_MS);

        const trySendNext = () => {
            if (settled) return;
            if (received >= list.length) {
                return done();
            }
            if (sent >= list.length) return;
            if (sent > received) return;
            const vn = list[sent];
            sent += 1;
            socket.write(`GET VAR ${upsName} ${vn}\n`);
        };

        const onLine = (trimmed) => {
            if (!trimmed || settled) return;

            if (trimmed.startsWith('VAR ')) {
                if (received >= sent) return;
                const pos = received;
                const v = parseVarLine(trimmed);
                if (v != null) {
                    out[pos] = { ok: true, value: v, latency: null, error: null };
                } else {
                    out[pos] = { ok: false, value: null, latency: null, error: 'parse-error' };
                }
                received += 1;
                if (received >= list.length) {
                    return done();
                }
                trySendNext();
                return;
            }

            if (trimmed.startsWith('ERR ')) {
                if (received >= sent) return;
                const pos = received;
                out[pos] = { ok: false, value: null, latency: null, error: trimmed };
                received += 1;
                if (received >= list.length) {
                    return done();
                }
                trySendNext();
            }
        };

        const flushBuf = () => {
            let idx;
            while ((idx = buf.indexOf('\n')) >= 0) {
                const line = buf.slice(0, idx).replace(/\r$/, '');
                buf = buf.slice(idx + 1);
                onLine(line.trim());
                if (settled) return;
            }
        };

        socket.once('error', (err) => {
            clearTimeout(timeout);
            const msg = err.code || err.message;
            for (let i = 0; i < out.length; i++) {
                if (!out[i].ok && out[i].error === 'pending') {
                    out[i] = { ok: false, value: null, latency: null, error: msg };
                }
            }
            if (!settled) {
                settled = true;
                try { socket.destroy(); } catch (_) {}
                resolve(out.map(mapResult));
            }
        });

        socket.on('data', (chunk) => {
            buf += chunk.toString('utf8');
            flushBuf();
        });

        socket.once('connect', () => {
            trySendNext();
        });

        socket.connect(port, host);
    });
}

async function snmpGetOid(host, port, community, oid) {
    const snmp = require('net-snmp');
    return new Promise((resolve) => {
        const session = snmp.createSession(host, community, {
            port: port || 161,
            timeout: CHECK_TIMEOUT_MS,
            retries: 0
        });

        session.get([oid], (error, varbinds) => {
            try { session.close(); } catch (_) {}
            if (error) return resolve({ ok: false, error: error.message || String(error) });
            const vb = Array.isArray(varbinds) ? varbinds[0] : null;
            if (!vb) return resolve({ ok: false, error: 'no-varbind' });
            if (snmp.isVarbindError && snmp.isVarbindError(vb)) {
                return resolve({ ok: false, error: vb.toString() });
            }
            const value = vb.value != null ? String(vb.value).trim() : '';
            resolve({ ok: true, value });
        });
    });
}

router.get('/settings', (req, res) => {
    try {
        const configs = loadUpsConfigsFromStore();
        res.json({ success: true, configs, maxConfigs: MAX_UPS_CONFIGS });
    } catch (e) {
        log('error', `[UPS] GET /settings: ${e.message}`);
        res.status(500).json({ success: false, error: e.message });
    }
});

router.post('/settings', (req, res) => {
    try {
        const body = req.body || {};
        if (Array.isArray(body.configs)) {
            saveUpsConfigsToStore(body.configs);
            log('info', '[UPS] POST /settings: обновлён массив configs');
            return res.json({ success: true });
        }

        // Backward compatibility: accept single config fields (slot 0 only)
        if (body && (body.host || body.name || body.type)) {
            saveUpsConfigsToStore([normalizeUpsConfig(body)]);
            log('info', '[UPS] POST /settings: обновлён одиночный конфиг (слот 0, совместимость)');
            return res.json({ success: true });
        }

        log('warn', '[UPS] POST /settings: тело запроса без configs');
        res.status(400).json({ success: false, error: 'configs required' });
    } catch (e) {
        log('error', `[UPS] POST /settings: ${e.message}`);
        res.status(500).json({ success: false, error: e.message });
    }
});

// GET /api/ups/display — какие UPS показывать на «дашборде» (обычный режим)
// и на экране монитора (Cluster). На экране UPS показываем всё.
router.get('/display', (req, res) => {
    try {
        const monitorSlots = normalizeDisplaySlots(store.getSetting(UPS_DISPLAY_SLOTS_MONITOR_KEY));
        const dashboardSlots = normalizeDisplaySlots(store.getSetting(UPS_DISPLAY_SLOTS_DASHBOARD_KEY));
        res.json({ success: true, monitorSlots, dashboardSlots });
    } catch (e) {
        log('error', `[UPS] GET /display: ${e.message}`);
        res.status(500).json({ success: false, error: e.message });
    }
});

// POST /api/ups/display
// body: { monitorSlots: number[], dashboardSlots: number[] }
router.post('/display', (req, res) => {
    try {
        const body = req.body || {};
        const monitorSlots = normalizeDisplaySlots(body.monitorSlots);
        const dashboardSlots = normalizeDisplaySlots(body.dashboardSlots);
        store.setSetting(UPS_DISPLAY_SLOTS_MONITOR_KEY, JSON.stringify(monitorSlots));
        store.setSetting(UPS_DISPLAY_SLOTS_DASHBOARD_KEY, JSON.stringify(dashboardSlots));
        res.json({ success: true });
    } catch (e) {
        log('error', `[UPS] POST /display: ${e.message}`);
        res.status(500).json({ success: false, error: e.message });
    }
});

async function fetchUpsCurrentForNotify() {
    const configs = loadUpsConfigsFromStore();
    const enabledConfigs = configs
        .map((cfg, idx) => ({ cfg, idx }))
        .filter(x => x.cfg && x.cfg.enabled && x.cfg.host);

    if (!enabledConfigs.length) {
        return {
            configured: false,
            updatedAt: new Date().toISOString()
        };
    }

    const nowIso = new Date().toISOString();

    const pollOneNut = async (cfg) => {
        const upsName = cfg.name;
        const nutPort = cfg.port || 3493;
        if (!upsName) {
            return { type: 'nut', host: cfg.host, upsName: null, error: 'ups_name missing' };
        }

        const fields = Array.isArray(cfg.fields) ? cfg.fields : resolveUpsFieldList(cfg, 'nut');
        const active = fields.filter((f) => f.enabled && String(f.path || '').trim());
        if (!active.length) {
            return { type: 'nut', host: cfg.host, upsName, error: 'no fields configured' };
        }

        const paths = [];
        const idxMap = [];
        for (const f of active) {
            const p = f.path.trim();
            let ix = paths.indexOf(p);
            if (ix < 0) {
                ix = paths.length;
                paths.push(p);
            }
            idxMap.push(ix);
        }

        const batchRaw = await nutGetVarsBatch(cfg.host, nutPort, upsName, paths);
        const metrics = active.map((f, i) => {
            const br = batchRaw[idxMap[i]];
            const raw = br && br.ok ? br.value : null;
            return buildUpsMetricRow(f, raw, !!(br && br.ok), br && br.ok ? null : (br && br.error) || 'fail');
        });

        const stRowIdx = active.findIndex((f) => f.id === 'status' || f.format === 'nut_status');
        const stBatchIdx = stRowIdx >= 0 ? idxMap[stRowIdx] : idxMap[0];
        const stRes = batchRaw[stBatchIdx];
        if (!stRes || !stRes.ok) {
            const pathShown = stRowIdx >= 0 ? active[stRowIdx].path : paths[0];
            log('warn', `[UPS] NUT ${cfg.host}:${nutPort} "${upsName}": (${pathShown}) недоступен`, {
                error: (stRes && stRes.error) || 'fail'
            });
        }

        const legacy = buildLegacyUpsFromMetrics(metrics);
        return {
            type: 'nut',
            host: cfg.host,
            upsName,
            fields: metrics,
            ...legacy,
            updatedAt: nowIso
        };
    };

    const pollOneSnmp = async (cfg) => {
        const snmpPort = cfg.port || 161;
        const community = cfg.snmpCommunity;
        const statusPath = getSnmpUpsStatusPath(cfg);
        if (!community || !statusPath) {
            return { type: 'snmp', host: cfg.host, error: 'community or status oid missing' };
        }

        const fields = Array.isArray(cfg.fields) ? cfg.fields : resolveUpsFieldList(cfg, 'snmp');
        const active = fields.filter((f) => f.enabled && String(f.path || '').trim());
        if (!active.length) {
            return { type: 'snmp', host: cfg.host, error: 'no fields configured' };
        }

        const results = await Promise.all(
            active.map((f) => snmpGetOid(cfg.host, snmpPort, community, f.path.trim()))
        );

        const metrics = active.map((f, i) => {
            const r = results[i];
            const raw = r.ok ? r.value : null;
            return buildUpsMetricRow(f, raw, r.ok, r.ok ? null : r.error || 'fail');
        });

        const snmpReads = metrics.map((m, i) => [active[i].id || `f${i}`, results[i]]);
        const snmpFailed = snmpReads.filter(([, r]) => !r.ok);
        if (snmpFailed.length) {
            log('warn', `[UPS] SNMP ${cfg.host}:${snmpPort}: не прочитаны OID (${snmpFailed.length}/${snmpReads.length})`, {
                errors: snmpFailed.map(([name, r]) => `${name}=${r.error || 'fail'}`).join('; ')
            });
        }

        const legacy = buildLegacyUpsFromMetrics(metrics);
        return {
            type: 'snmp',
            host: cfg.host,
            fields: metrics,
            ...legacy,
            updatedAt: nowIso
        };
    };

    const results = await Promise.all(enabledConfigs.map(async ({ cfg, idx }) => {
        const slot = idx + 1;
        const displayName = cfg.name || `UPS ${slot}`;
        if (cfg.type === 'nut') {
            const data = await pollOneNut(cfg);
            if (data.error) {
                log('warn', `[UPS] Слот ${slot} (${displayName}, NUT): ${data.error}`);
            }
            return { slot, name: displayName, ...data };
        }
        if (cfg.type === 'snmp') {
            const data = await pollOneSnmp(cfg);
            if (data.error) {
                log('warn', `[UPS] Слот ${slot} (${displayName}, SNMP): ${data.error}`);
            }
            return { slot, name: displayName, ...data };
        }
        log('warn', `[UPS] Слот ${slot}: неизвестный тип ${cfg.type}`);
        return { slot, name: displayName, error: `unknown ups_type: ${cfg.type}` };
    }));

    return {
        configured: true,
        items: results,
        updatedAt: nowIso
    };
}

router.get('/current', async (req, res) => {
    const cacheKey = buildUpsCurrentCacheKey();
    const cached = cache.get(cacheKey);
    if (cached) {
        return res.json(cached);
    }
    try {
        const data = await fetchUpsCurrentForNotify();
        cache.set(cacheKey, data, UPS_CURRENT_CACHE_TTL_SEC);
        return res.json(data);
    } catch (e) {
        log('error', `[UPS] GET /current: ${e.message}`, e.stack ? { stack: e.stack } : null);
        res.status(500).json({ configured: false, error: e.message, updatedAt: new Date().toISOString() });
    }
});

module.exports = router;
module.exports.fetchUpsCurrentForNotify = fetchUpsCurrentForNotify;

