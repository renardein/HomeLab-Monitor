const express = require('express');
const net = require('net');
const { log } = require('../utils');
const store = require('../settings-store');

const router = express.Router();

const CHECK_TIMEOUT_MS = 5000;
/** Один сеанс NUT: таймаут на весь опрос всех переменных (параллельные сокеты upsd часто даёт таймауты). */
const NUT_BATCH_TIMEOUT_MS = 20000;
const UPS_CONFIGS_KEY = 'ups_configs';
const MAX_UPS_CONFIGS = 4;
const UPS_DISPLAY_SLOTS_MONITOR_KEY = 'ups_display_slots_monitor';
const UPS_DISPLAY_SLOTS_DASHBOARD_KEY = 'ups_display_slots_dashboard';
const DEFAULT_UPS_DISPLAY_SLOTS = [1, 2, 3, 4];

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
        return { enabled, type, host, port, name, ...nut };
    }
    const snmp = normalizeSnmpDefaults(cfg);
    return { enabled, type, host, port, name, ...snmp };
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

function mapNutStatus(statusRaw) {
    const s = String(statusRaw || '').toUpperCase();
    // NUT common codes:
    // OL: On line (mains)
    // OB: On battery
    // LB: Low battery
    // OFF: Off / not supported
    if (!s) return { label: 'unknown', up: null, badge: 'bg-secondary' };
    if (s === 'OL') return { label: 'Online', up: true, badge: 'bg-success' };
    if (s === 'OB') return { label: 'On battery', up: false, badge: 'bg-warning text-dark' };
    if (s === 'LB') return { label: 'Low battery', up: false, badge: 'bg-danger' };
    if (s === 'OFF') return { label: 'Off', up: false, badge: 'bg-secondary' };
    return { label: s, up: null, badge: 'bg-secondary' };
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

router.get('/current', async (req, res) => {
    try {
        const configs = loadUpsConfigsFromStore();
        const enabledConfigs = configs
            .map((cfg, idx) => ({ cfg, idx }))
            .filter(x => x.cfg && x.cfg.enabled && x.cfg.host);

        if (!enabledConfigs.length) {
            return res.json({
                configured: false,
                updatedAt: new Date().toISOString()
            });
        }

        const nowIso = new Date().toISOString();

        const pollOneNut = async (cfg) => {
            const upsName = cfg.name;
            const nutPort = cfg.port || 3493;
            if (!upsName) {
                return { type: 'nut', host: cfg.host, upsName: null, error: 'ups_name missing' };
            }

            const varNames = [
                cfg.nutVarStatus,
                cfg.nutVarCharge,
                cfg.nutVarRuntime,
                cfg.nutVarInputVoltage,
                cfg.nutVarOutputVoltage,
                cfg.nutVarPower,
                cfg.nutVarLoad,
                cfg.nutVarFrequency
            ];
            const batch = await nutGetVarsBatch(cfg.host, nutPort, upsName, varNames);
            const [
                st, ch, rt,
                inV, outV, pwr, loadRes, freqRes
            ] = batch;

            const statusRaw = st.ok ? st.value : null;
            const mapped = mapNutStatus(statusRaw);
            const chargeRaw = ch.ok ? ch.value : null;
            const runtimeRaw = rt.ok ? rt.value : null;

            if (!st.ok) {
                log('warn', `[UPS] NUT ${cfg.host}:${nutPort} "${upsName}": статус (${cfg.nutVarStatus}) недоступен`, {
                    error: st.error || 'fail'
                });
            }

            return {
                type: 'nut',
                host: cfg.host,
                upsName,
                status: {
                    raw: statusRaw,
                    label: mapped.label,
                    up: mapped.up
                },
                battery: {
                    chargeRaw,
                    chargePct: firstNumberFromString(chargeRaw),
                    runtimeRaw,
                    runtimeFormatted: runtimeRaw != null ? formatRuntimeSeconds(runtimeRaw) : null
                },
                electrical: {
                    inputVoltage: metricFromRaw(inV.ok ? inV.value : null),
                    outputVoltage: metricFromRaw(outV.ok ? outV.value : null),
                    powerW: metricFromRaw(pwr.ok ? pwr.value : null),
                    loadPercent: metricFromRaw(loadRes.ok ? loadRes.value : null),
                    frequencyHz: metricFromRaw(freqRes.ok ? freqRes.value : null)
                },
                updatedAt: nowIso
            };
        };

        const pollOneSnmp = async (cfg) => {
            const snmpPort = cfg.port || 161;
            const community = cfg.snmpCommunity;
            const oidStatus = cfg.snmpOidStatus;
            if (!community || !oidStatus) {
                return { type: 'snmp', host: cfg.host, error: 'community or status oid missing' };
            }

            const [
                st, ch, rt,
                inV, outV, pwr, loadRes, freqRes
            ] = await Promise.all([
                snmpGetOid(cfg.host, snmpPort, community, oidStatus),
                cfg.snmpOidCharge ? snmpGetOid(cfg.host, snmpPort, community, cfg.snmpOidCharge) : Promise.resolve({ ok: false }),
                cfg.snmpOidRuntime ? snmpGetOid(cfg.host, snmpPort, community, cfg.snmpOidRuntime) : Promise.resolve({ ok: false }),
                cfg.snmpOidInputVoltage ? snmpGetOid(cfg.host, snmpPort, community, cfg.snmpOidInputVoltage) : Promise.resolve({ ok: false }),
                cfg.snmpOidOutputVoltage ? snmpGetOid(cfg.host, snmpPort, community, cfg.snmpOidOutputVoltage) : Promise.resolve({ ok: false }),
                cfg.snmpOidPower ? snmpGetOid(cfg.host, snmpPort, community, cfg.snmpOidPower) : Promise.resolve({ ok: false }),
                cfg.snmpOidLoad ? snmpGetOid(cfg.host, snmpPort, community, cfg.snmpOidLoad) : Promise.resolve({ ok: false }),
                cfg.snmpOidFrequency ? snmpGetOid(cfg.host, snmpPort, community, cfg.snmpOidFrequency) : Promise.resolve({ ok: false })
            ]);

            const statusRaw = st.ok ? st.value : null;
            const chargeRaw = ch.ok ? ch.value : null;
            const runtimeRaw = rt.ok ? rt.value : null;

            const snmpReads = [['status', st]];
            if (cfg.snmpOidCharge) snmpReads.push(['charge', ch]);
            if (cfg.snmpOidRuntime) snmpReads.push(['runtime', rt]);
            if (cfg.snmpOidInputVoltage) snmpReads.push(['inputVoltage', inV]);
            if (cfg.snmpOidOutputVoltage) snmpReads.push(['outputVoltage', outV]);
            if (cfg.snmpOidPower) snmpReads.push(['power', pwr]);
            if (cfg.snmpOidLoad) snmpReads.push(['load', loadRes]);
            if (cfg.snmpOidFrequency) snmpReads.push(['frequency', freqRes]);
            const snmpFailed = snmpReads.filter(([, r]) => !r.ok);
            if (snmpFailed.length) {
                log('warn', `[UPS] SNMP ${cfg.host}:${snmpPort}: не прочитаны OID (${snmpFailed.length}/${snmpReads.length})`, {
                    errors: snmpFailed.map(([name, r]) => `${name}=${r.error || 'fail'}`).join('; ')
                });
            }

            return {
                type: 'snmp',
                host: cfg.host,
                status: {
                    raw: statusRaw,
                    label: statusRaw != null ? String(statusRaw) : 'unknown',
                    up: null
                },
                battery: {
                    chargeRaw,
                    chargePct: firstNumberFromString(chargeRaw),
                    runtimeRaw,
                    runtimeFormatted: runtimeRaw != null ? formatRuntimeSeconds(runtimeRaw) : null
                },
                electrical: {
                    inputVoltage: metricFromRaw(inV.ok ? inV.value : null),
                    outputVoltage: metricFromRaw(outV.ok ? outV.value : null),
                    powerW: metricFromRaw(pwr.ok ? pwr.value : null),
                    loadPercent: metricFromRaw(loadRes.ok ? loadRes.value : null),
                    frequencyHz: metricFromRaw(freqRes.ok ? freqRes.value : null)
                },
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

        return res.json({
            configured: true,
            items: results,
            updatedAt: nowIso
        });
    } catch (e) {
        log('error', `[UPS] GET /current: ${e.message}`, e.stack ? { stack: e.stack } : null);
        res.status(500).json({ configured: false, error: e.message, updatedAt: new Date().toISOString() });
    }
});

module.exports = router;

