'use strict';

const { log } = require('./utils');
const store = require('./settings-store');
const connectionStore = require('./connection-store');
const proxmox = require('./proxmox-api');
const truenas = require('./truenas-api');
const { checkOne } = require('./routes/health');
const { sendTelegramMessage, formatTelegramNotifyMessage } = require('./telegram');
const { pollNetdevMonitoringItems } = require('./routes/netdevices-snmp');
const { getEffectiveRules } = require('./telegram-rules');
const hostMetricsRoute = require('./routes/host-metrics');
const upsRoute = require('./routes/ups');
const smartSensorsRoute = require('./routes/smart-sensors');
const {
    getScopeKeyFromConnectionId,
    applyOfflineStatusList,
    getOfflineSinceIso
} = require('./pve-node-offline-tracker');

function normalizeUrl(u) {
    try {
        const url = new URL(String(u));
        if (!url.protocol.startsWith('http')) return String(u || '').trim();
        return url.toString().replace(/\/+$/, '');
    } catch {
        return String(u || '').trim();
    }
}

function parseTelegramRoutes() {
    const raw = store.getSetting('telegram_routes');
    if (!raw) return { service: {}, vm: {}, node: {}, netdev: {} };
    try {
        const p = JSON.parse(raw);
        if (!p || typeof p !== 'object') return { service: {}, vm: {}, node: {}, netdev: {} };
        return {
            service: p.service && typeof p.service === 'object' ? p.service : {},
            vm: p.vm && typeof p.vm === 'object' ? p.vm : {},
            node: p.node && typeof p.node === 'object' ? p.node : {},
            netdev: p.netdev && typeof p.netdev === 'object' ? p.netdev : {}
        };
    } catch {
        return { service: {}, vm: {}, node: {}, netdev: {} };
    }
}

function resolveProxmoxConnectionFromStore() {
    const raw = store.getSetting('proxmox_servers');
    const idx = parseInt(store.getSetting('current_server_index'), 10) || 0;
    let servers = [];
    try {
        servers = JSON.parse(raw);
    } catch {
        servers = [];
    }
    if (!Array.isArray(servers) || !servers.length) return null;
    const url = normalizeUrl(servers[idx] || servers[0]);
    if (!url) return null;
    const mapRaw = store.getSetting('connection_id_map');
    let map = {};
    try {
        map = JSON.parse(mapRaw);
    } catch {
        map = {};
    }
    const key = `proxmox|${url}`;
    let connId = map[key];
    if (!connId) {
        for (const k of Object.keys(map)) {
            if (String(k).startsWith('proxmox|')) {
                connId = map[k];
                if (connId) break;
            }
        }
    }
    if (!connId) return null;
    const conn = connectionStore.getConnectionById(String(connId));
    if (!conn || conn.type !== 'proxmox') return null;
    return { token: conn.secret, serverUrl: url, connectionId: connId };
}

function getProxmoxConnection() {
    const r = resolveProxmoxConnectionFromStore();
    if (!r) return null;
    return { token: r.token, serverUrl: r.serverUrl };
}

function getProxmoxConnectionId() {
    const r = resolveProxmoxConnectionFromStore();
    return r ? String(r.connectionId) : null;
}

function resolveTrueNASConnectionFromStore() {
    const raw = store.getSetting('truenas_servers');
    const idx = parseInt(store.getSetting('current_truenas_index'), 10) || 0;
    let servers = [];
    try {
        servers = JSON.parse(raw);
    } catch {
        servers = [];
    }
    if (!Array.isArray(servers) || !servers.length) return null;
    const url = normalizeUrl(servers[idx] || servers[0]);
    if (!url) return null;
    const mapRaw = store.getSetting('connection_id_map');
    let map = {};
    try {
        map = JSON.parse(mapRaw);
    } catch {
        map = {};
    }
    const key = `truenas|${url}`;
    let connId = map[key];
    if (!connId) {
        for (const k of Object.keys(map)) {
            if (String(k).startsWith('truenas|')) {
                connId = map[k];
                if (connId) break;
            }
        }
    }
    if (!connId) return null;
    const conn = connectionStore.getConnectionById(String(connId));
    if (!conn || conn.type !== 'truenas') return null;
    return { apiKey: conn.secret, serverUrl: url, connectionId: connId };
}

function getTrueNASConnection() {
    const r = resolveTrueNASConnectionFromStore();
    if (!r) return null;
    return { apiKey: r.apiKey, serverUrl: r.serverUrl };
}

function parseNotifyState() {
    const raw = store.getSetting('telegram_notify_state');
    if (!raw) {
        return {
            service: {},
            vm: {},
            node: {},
            netdev: {},
            hostTemp: {},
            hostLink: {},
            upsLoad: {},
            upsPower: {},
            upsCharge: {},
            truenasDisk: {},
            truenasPoolUsage: {},
            truenasService: {},
            truenasPoolState: {},
            smartSensorError: {},
            smartSensorThreshold: {}
        };
    }
    try {
        const p = JSON.parse(raw);
        if (!p || typeof p !== 'object') {
            return {
                service: {},
                vm: {},
                node: {},
                netdev: {},
                hostTemp: {},
                hostLink: {},
                smartSensorError: {},
                smartSensorThreshold: {}
            };
        }
        return {
            service: p.service && typeof p.service === 'object' ? p.service : {},
            vm: p.vm && typeof p.vm === 'object' ? p.vm : {},
            node: p.node && typeof p.node === 'object' ? p.node : {},
            netdev: p.netdev && typeof p.netdev === 'object' ? p.netdev : {},
            hostTemp: p.hostTemp && typeof p.hostTemp === 'object' ? p.hostTemp : {},
            hostLink: p.hostLink && typeof p.hostLink === 'object' ? p.hostLink : {},
            upsLoad: p.upsLoad && typeof p.upsLoad === 'object' ? p.upsLoad : {},
            upsPower: p.upsPower && typeof p.upsPower === 'object' ? p.upsPower : {},
            upsCharge: p.upsCharge && typeof p.upsCharge === 'object' ? p.upsCharge : {},
            truenasDisk: p.truenasDisk && typeof p.truenasDisk === 'object' ? p.truenasDisk : {},
            truenasPoolUsage: p.truenasPoolUsage && typeof p.truenasPoolUsage === 'object' ? p.truenasPoolUsage : {},
            truenasService: p.truenasService && typeof p.truenasService === 'object' ? p.truenasService : {},
            truenasPoolState: p.truenasPoolState && typeof p.truenasPoolState === 'object' ? p.truenasPoolState : {},
            smartSensorError: p.smartSensorError && typeof p.smartSensorError === 'object' ? p.smartSensorError : {},
            smartSensorThreshold: p.smartSensorThreshold && typeof p.smartSensorThreshold === 'object' ? p.smartSensorThreshold : {}
        };
    } catch {
        return {
            service: {},
            vm: {},
            node: {},
            netdev: {},
            hostTemp: {},
            hostLink: {},
            upsLoad: {},
            upsPower: {},
            upsCharge: {},
            truenasDisk: {},
            truenasPoolUsage: {},
            truenasService: {},
            truenasPoolState: {},
            smartSensorError: {},
            smartSensorThreshold: {}
        };
    }
}

function buildServiceTarget(s) {
    const type = String(s.type || 'tcp').toLowerCase();
    const name = String(s.name || '').trim() || '—';
    if (type === 'http' || type === 'https') {
        return { name, type: type === 'https' ? 'https' : 'http', url: String(s.url || '').trim() };
    }
    if (type === 'snmp' || type === 'nut') {
        return {
            name,
            type,
            host: String(s.host || '').trim(),
            port: s.port != null ? parseInt(s.port, 10) : null,
            url: String(s.url || '').trim()
        };
    }
    return {
        name,
        type: type || 'tcp',
        host: String(s.host || '').trim(),
        port: s.port != null ? parseInt(s.port, 10) : null
    };
}

function smartSensorNumericFromEntry(entry) {
    if (!entry || typeof entry !== 'object') return null;
    if (entry.value != null && Number.isFinite(Number(entry.value))) return Number(entry.value);
    const raw = entry.raw;
    if (raw != null && typeof raw !== 'object') {
        const n = parseFloat(String(raw).replace(',', '.').trim());
        if (Number.isFinite(n)) return n;
    }
    return null;
}

function smartSensorThresholdCompare(op, value, thr) {
    switch (String(op || '').toLowerCase()) {
        case 'gt': return value > thr;
        case 'gte': return value >= thr;
        case 'lt': return value < thr;
        case 'lte': return value <= thr;
        default: return value >= thr;
    }
}

function routeChat(rule) {
    const chatId = rule.chatId != null ? String(rule.chatId).trim() : '';
    const threadId = rule.threadId != null && String(rule.threadId).trim() !== '' ? rule.threadId : null;
    return { chatId, threadId };
}

function getRuleNodeTargets(rule) {
    const list = Array.isArray(rule && rule.nodeNames) ? rule.nodeNames : [];
    const out = list.map((x) => String(x || '').trim()).filter(Boolean);
    if (out.length) return Array.from(new Set(out));
    const one = String(rule && rule.nodeName || '').trim();
    return one ? [one] : [];
}

function getRuleNumberTargets(rule, pluralKey, singleKey) {
    const arr = Array.isArray(rule && rule[pluralKey]) ? rule[pluralKey] : [];
    const nums = arr.map((x) => parseInt(x, 10)).filter((n) => Number.isFinite(n));
    if (nums.length) return Array.from(new Set(nums));
    const one = parseInt(rule && rule[singleKey], 10);
    return Number.isFinite(one) ? [one] : [];
}

async function runNotifyTick() {
    const enabled =
        store.getSetting('telegram_notify_enabled') === '1' ||
        store.getSetting('telegram_notify_enabled') === 'true';
    const token = String(store.getSetting('telegram_bot_token') || '').trim();
    const telegramProxyUrl = String(store.getSetting('telegram_proxy_url') || '').trim();
    if (!enabled || !token) return;

    const rules = getEffectiveRules(store, parseTelegramRoutes);
    if (!rules.length) return;

    const state = parseNotifyState();
    const servicesById = new Map(store.listMonitoredServices().map((s) => [String(s.id), s]));

    const conn = getProxmoxConnection();
    const connectionId = getProxmoxConnectionId();
    const tnConn = getTrueNASConnection();

    let nodeDetails = null;
    let vmByVmid = null;
    if (conn) {
        try {
            const nodes = await proxmox.getNodes(conn.token, conn.serverUrl);
            const resources = await proxmox.getClusterResources(conn.token, conn.serverUrl);
            vmByVmid = new Map();
            for (const res of resources) {
                if (res && (res.type === 'qemu' || res.type === 'lxc') && res.vmid != null) {
                    vmByVmid.set(Number(res.vmid), res);
                }
            }
            nodeDetails = await Promise.all(
                (nodes || []).map(async (node) => {
                    const nodeName = node.node || node.name;
                    try {
                        await proxmox.getNodeStatus(nodeName, conn.token, conn.serverUrl);
                        return { name: nodeName, online: String(node.status || '').toLowerCase() === 'online' };
                    } catch {
                        return { name: nodeName, online: false };
                    }
                })
            );
        } catch (e) {
            log('warn', `[MonitorNotify] proxmox batch: ${e.message}`);
        }
    }

    const pveNodeScopeKey = getScopeKeyFromConnectionId(connectionId);
    if (pveNodeScopeKey && nodeDetails && nodeDetails.length) {
        applyOfflineStatusList(
            pveNodeScopeKey,
            nodeDetails.map((nd) => ({ name: nd.name, online: !!nd.online }))
        );
    }

    let netdevItems = null;
    try {
        netdevItems = await pollNetdevMonitoringItems();
    } catch (e) {
        log('warn', `[MonitorNotify] netdev batch: ${e.message}`);
    }
    const netdevBySlot = new Map((netdevItems || []).map((it) => [String(it.slot), it]));

    const hostSnapCache = new Map();
    async function getHostSnap(nodeName) {
        const key = String(nodeName || '').trim();
        if (!key || !connectionId) return null;
        if (hostSnapCache.has(key)) return hostSnapCache.get(key);
        const snap = await hostMetricsRoute.fetchHostMetricsForNotify(connectionId, key);
        hostSnapCache.set(key, snap);
        return snap;
    }

    let upsBySlot = null;
    async function getUpsBySlot() {
        if (upsBySlot) return upsBySlot;
        try {
            const data = await upsRoute.fetchUpsCurrentForNotify();
            const items = data && Array.isArray(data.items) ? data.items : [];
            upsBySlot = new Map(items.map((it) => [String(it.slot), it]));
        } catch (e) {
            log('warn', `[MonitorNotify] ups batch: ${e.message}`);
            upsBySlot = new Map();
        }
        return upsBySlot;
    }

    let trueNASOverview = null;
    async function getTrueNASOverview() {
        if (trueNASOverview) return trueNASOverview;
        if (!tnConn) return null;
        try {
            const [pools, disks, services] = await Promise.all([
                truenas.getPools(tnConn.apiKey, tnConn.serverUrl),
                truenas.getDisks(tnConn.apiKey, tnConn.serverUrl),
                truenas.getServices(tnConn.apiKey, tnConn.serverUrl)
            ]);
            trueNASOverview = { pools: pools || [], disks: disks || [], services: services || [] };
        } catch (e) {
            log('warn', `[MonitorNotify] truenas batch: ${e.message}`);
            trueNASOverview = { pools: [], disks: [], services: [] };
        }
        return trueNASOverview;
    }

    let smartSensorsNotifyPromise = null;
    async function loadSmartSensorsForNotify() {
        if (smartSensorsNotifyPromise) return smartSensorsNotifyPromise;
        smartSensorsNotifyPromise = (async () => {
            try {
                return await smartSensorsRoute.fetchSmartSensorsCurrent();
            } catch (e) {
                log('warn', `[MonitorNotify] smart sensors: ${e.message}`);
                return { configured: false, items: [] };
            }
        })();
        return smartSensorsNotifyPromise;
    }

    function getUpsPowerState(upsItem) {
        const raw = String(upsItem && upsItem.status && upsItem.status.raw || '').toUpperCase();
        if (!raw) return null;
        if (raw.includes('OB') || raw.includes('LB')) return 'battery';
        if (raw.includes('OL')) return 'mains';
        return null;
    }

    for (const rule of rules) {
        if (!rule.enabled) continue;
        const { chatId, threadId } = routeChat(rule);
        if (!chatId) continue;

        try {
            if (rule.type === 'service_updown') {
                const serviceIds = getRuleNumberTargets(rule, 'serviceIds', 'serviceId');
                for (const serviceId of serviceIds) {
                    const sid = String(serviceId);
                    const svc = servicesById.get(sid);
                    if (!svc) continue;
                    const r = await checkOne(buildServiceTarget(svc));
                    const nowUp = !!r.up;
                    const stateNow = nowUp ? 'up' : 'down';
                    const stateKey = `${String(rule.id || 'rule')}|${sid}`;
                    const legacyPrev = state.service[sid];
                    const prev = state.service[stateKey] != null ? state.service[stateKey] : legacyPrev;
                    if (prev !== undefined && prev !== stateNow) {
                        const title = svc.name || r.name || sid;
                        const stateRu = stateNow === 'up' ? 'Онлайн' : 'Офлайн';
                        const msg = formatTelegramNotifyMessage(
                            rule,
                            {
                                name: title,
                                serviceId: sid,
                                state: stateNow,
                                stateRu
                            },
                            `Сервис «${title}»\n${stateRu}`
                        );
                        await sendTelegramMessage(token, chatId, msg, threadId, { proxyUrl: telegramProxyUrl });
                    }
                    state.service[stateKey] = stateNow;
                }
                continue;
            }

            if (rule.type === 'vm_state') {
                if (!vmByVmid) continue;
                const vmids = getRuleNumberTargets(rule, 'vmids', 'vmid');
                for (const vmid of vmids) {
                    const key = String(vmid);
                    const res = vmByVmid.get(Number(vmid));
                    const running = res && String(res.status || '').toLowerCase() === 'running';
                    const stateNow = running ? 'running' : 'stopped';
                    const stateKey = `${String(rule.id || 'rule')}|${key}`;
                    const legacyPrev = state.vm[key];
                    const prev = state.vm[stateKey] != null ? state.vm[stateKey] : legacyPrev;
                    if (prev !== undefined && prev !== stateNow) {
                        const label = res && res.name ? String(res.name) : `VM/CT ${vmid}`;
                        const kind = res && res.type === 'lxc' ? 'CT' : 'VM';
                        const stateRu = stateNow === 'running' ? 'Запущен' : 'Остановлен';
                        const msg = formatTelegramNotifyMessage(
                            rule,
                            {
                                name: label,
                                vmid: String(vmid),
                                kind,
                                state: stateNow,
                                stateRu
                            },
                            `${kind} «${label}» (${vmid})\n${stateRu}`
                        );
                        await sendTelegramMessage(token, chatId, msg, threadId, { proxyUrl: telegramProxyUrl });
                    }
                    state.vm[stateKey] = stateNow;
                }
                continue;
            }

            if (rule.type === 'node_online') {
                if (!nodeDetails) continue;
                const nodes = getRuleNodeTargets(rule);
                for (const nname of nodes) {
                    const nd = nodeDetails.find((x) => String(x.name) === nname);
                    if (!nd) continue;
                    const stateNow = nd.online ? 'online' : 'offline';
                    const nodeStateKey = `${String(rule.id || 'rule')}|${nname}`;
                    const legacyPrev = state.node[nname];
                    const prev = state.node[nodeStateKey] != null ? state.node[nodeStateKey] : legacyPrev;
                    if (prev !== undefined && prev !== stateNow) {
                        const stateRu = stateNow === 'online' ? 'Онлайн' : 'Офлайн';
                        let offlineSince = '';
                        let offlineSinceRu = '';
                        if (stateNow === 'offline' && pveNodeScopeKey) {
                            const iso = getOfflineSinceIso(pveNodeScopeKey, nname);
                            if (iso) {
                                offlineSince = iso;
                                offlineSinceRu = new Date(iso).toLocaleString('ru-RU');
                            }
                        }
                        let defaultBody = `Узел Proxmox «${nname}»\n${stateRu}`;
                        if (offlineSinceRu) defaultBody += `\nНе в сети с: ${offlineSinceRu}`;
                        const msg = formatTelegramNotifyMessage(
                            rule,
                            {
                                nodeName: nname,
                                state: stateNow,
                                stateRu,
                                offlineSince,
                                offlineSinceRu
                            },
                            defaultBody
                        );
                        await sendTelegramMessage(token, chatId, msg, threadId, { proxyUrl: telegramProxyUrl });
                    }
                    state.node[nodeStateKey] = stateNow;
                }
                continue;
            }

            if (rule.type === 'netdev_updown') {
                const it = netdevBySlot.get(String(rule.netdevSlot));
                if (!it) continue;
                const up = !!it.up;
                const stateNow = up ? 'up' : 'down';
                const slot = String(rule.netdevSlot);
                const prev = state.netdev[slot];
                if (prev !== undefined && prev !== stateNow) {
                    const disp = String(it.name || it.host || slot);
                    const host = String(it.host || '');
                    const stateRu = stateNow === 'up' ? 'Онлайн' : 'Офлайн';
                    const msg = formatTelegramNotifyMessage(
                        rule,
                        {
                            name: disp,
                            host,
                            slot,
                            state: stateNow,
                            stateRu
                        },
                        `SNMP «${disp}»\n${stateRu}`
                    );
                    await sendTelegramMessage(token, chatId, msg, threadId, { proxyUrl: telegramProxyUrl });
                }
                state.netdev[slot] = stateNow;
                continue;
            }

            if (rule.type === 'host_temp') {
                const nodes = getRuleNodeTargets(rule);
                const thr = Number(rule.tempThresholdC);
                for (const nname of nodes) {
                    const snap = await getHostSnap(nname);
                    const tempC = snap && snap.cpu && snap.cpu.tempC != null ? Number(snap.cpu.tempC) : null;
                    if (tempC == null || !Number.isFinite(tempC)) continue;
                    // Keep per-rule/per-node state to avoid collisions between rules and targets.
                    const tempStateKey = `${String(rule.id || 'rule')}|${nname}`;
                    const legacyPrev = state.hostTemp[nname];
                    const rawPrev = state.hostTemp[tempStateKey] != null ? state.hostTemp[tempStateKey] : legacyPrev;
                    const prevLevel = rawPrev === 'high' ? 'high' : 'ok';
                    const nowHigh = tempC >= thr;
                    const nowLevel = nowHigh ? 'high' : 'ok';
                    if (prevLevel === 'ok' && nowLevel === 'high') {
                        const msg = formatTelegramNotifyMessage(
                            rule,
                            {
                                nodeName: nname,
                                tempC: tempC.toFixed(1),
                                thr: String(thr),
                                state: 'high',
                                stateRu: 'Превышение'
                            },
                            `Узел «${nname}»: температура CPU ${tempC.toFixed(1)}°C (порог ${thr}°C)`
                        );
                        await sendTelegramMessage(token, chatId, msg, threadId, { proxyUrl: telegramProxyUrl });
                    } else if (prevLevel === 'high' && nowLevel === 'ok') {
                        const msg = formatTelegramNotifyMessage(
                            rule,
                            {
                                nodeName: nname,
                                tempC: tempC.toFixed(1),
                                thr: String(thr),
                                state: 'ok',
                                stateRu: 'Норма'
                            },
                            `Узел «${nname}»: температура CPU снизилась до ${tempC.toFixed(1)}°C (порог ${thr}°C)`
                        );
                        await sendTelegramMessage(token, chatId, msg, threadId, { proxyUrl: telegramProxyUrl });
                    }
                    state.hostTemp[tempStateKey] = nowLevel;
                }
                continue;
            }

            if (rule.type === 'host_link_speed') {
                const nodes = getRuleNodeTargets(rule);
                for (const nname of nodes) {
                    const snap = await getHostSnap(nname);
                    const mbps = snap && snap.link && snap.link.speedMbps != null ? Number(snap.link.speedMbps) : null;
                    if (mbps == null || !Number.isFinite(mbps)) continue;
                    // Keep per-rule/per-node state and notify only on state transitions.
                    const linkStateKey = `${String(rule.id || 'rule')}|${nname}`;
                    const legacyPrev = state.hostLink[nname];
                    const prevStored = state.hostLink[linkStateKey] != null ? state.hostLink[linkStateKey] : legacyPrev;
                    const prev = Number(prevStored);
                    const prevUp = Number.isFinite(prev) && prev > 0;
                    const nowUp = mbps > 0;
                    if (prevStored !== undefined && prevUp !== nowUp) {
                        const msg = formatTelegramNotifyMessage(
                            rule,
                            {
                                nodeName: nname,
                                prev: Number.isFinite(prev) ? String(prev) : '0',
                                mbps: String(mbps),
                                state: nowUp ? 'up' : 'down',
                                stateRu: nowUp ? 'Онлайн' : 'Офлайн'
                            },
                            nowUp
                                ? `Узел «${nname}»: линк восстановлен, скорость ${mbps} Мбит/с`
                                : `Узел «${nname}»: линк упал до 0 Мбит/с`
                        );
                        await sendTelegramMessage(token, chatId, msg, threadId, { proxyUrl: telegramProxyUrl });
                    }
                    state.hostLink[linkStateKey] = mbps;
                }
                continue;
            }

            if (rule.type === 'truenas_disk_state') {
                const ov = await getTrueNASOverview();
                if (!ov) continue;
                const selected = Array.isArray(rule.diskIds) && rule.diskIds.length
                    ? rule.diskIds
                    : (rule.diskId ? [rule.diskId] : []);
                for (const diskIdRaw of selected) {
                    const diskId = String(diskIdRaw || '').trim();
                    if (!diskId) continue;
                    const disk = (ov.disks || []).find((d, idx) => {
                        const id = String(d?.entityId || d?.id || d?.name || (idx + 1));
                        return id === diskId;
                    });
                    if (!disk) continue;
                    const nowState = disk.healthy === false ? 'degraded' : 'healthy';
                    const key = `${String(rule.id || 'rule')}|${diskId}`;
                    const prev = state.truenasDisk[key];
                    if (prev !== undefined && prev !== nowState) {
                        const diskName = String(disk.name || diskId);
                        const stateRu = nowState === 'healthy' ? 'Исправен' : 'Проблема';
                        const msg = formatTelegramNotifyMessage(
                            rule,
                            { diskName, diskId, state: nowState, stateRu },
                            `TrueNAS disk «${diskName}»\n${stateRu}`
                        );
                        await sendTelegramMessage(token, chatId, msg, threadId, { proxyUrl: telegramProxyUrl });
                    }
                    state.truenasDisk[key] = nowState;
                }
                continue;
            }

            if (rule.type === 'truenas_service_state') {
                const ov = await getTrueNASOverview();
                if (!ov) continue;
                const selected = Array.isArray(rule.truenasServiceIds) && rule.truenasServiceIds.length
                    ? rule.truenasServiceIds
                    : (rule.truenasServiceId ? [rule.truenasServiceId] : []);
                for (const serviceIdRaw of selected) {
                    const serviceId = String(serviceIdRaw || '').trim();
                    if (!serviceId) continue;
                    const svc = (ov.services || []).find((s, idx) => {
                        const id = String(s?.entityId || s?.id || s?.name || (idx + 1));
                        return id === serviceId;
                    });
                    if (!svc) continue;
                    const nowState = svc.running ? 'running' : 'stopped';
                    const key = `${String(rule.id || 'rule')}|${serviceId}`;
                    const prev = state.truenasService[key];
                    if (prev !== undefined && prev !== nowState) {
                        const serviceName = String(svc.name || serviceId);
                        const stateRu = nowState === 'running' ? 'Запущен' : 'Остановлен';
                        const msg = formatTelegramNotifyMessage(
                            rule,
                            { serviceName, serviceId, state: nowState, stateRu },
                            `TrueNAS service «${serviceName}»\n${stateRu}`
                        );
                        await sendTelegramMessage(token, chatId, msg, threadId, { proxyUrl: telegramProxyUrl });
                    }
                    state.truenasService[key] = nowState;
                }
                continue;
            }

            if (rule.type === 'truenas_pool_state') {
                const ov = await getTrueNASOverview();
                if (!ov) continue;
                const selected = Array.isArray(rule.poolIds) && rule.poolIds.length
                    ? rule.poolIds
                    : (rule.poolId ? [rule.poolId] : []);
                for (const poolIdRaw of selected) {
                    const poolId = String(poolIdRaw || '').trim();
                    if (!poolId) continue;
                    const pool = (ov.pools || []).find((p, idx) => {
                        const id = String(p?.id || p?.name || (idx + 1));
                        return id === poolId;
                    });
                    if (!pool) continue;
                    const nowState = pool.healthy === false ? 'degraded' : 'healthy';
                    const key = `${String(rule.id || 'rule')}|${poolId}`;
                    const prev = state.truenasPoolState[key];
                    if (prev !== undefined && prev !== nowState) {
                        const poolName = String(pool.name || poolId);
                        const stateRu = nowState === 'healthy' ? 'Исправен' : 'Проблема';
                        const msg = formatTelegramNotifyMessage(
                            rule,
                            { poolName, poolId, state: nowState, stateRu },
                            `TrueNAS pool «${poolName}»\n${stateRu}`
                        );
                        await sendTelegramMessage(token, chatId, msg, threadId, { proxyUrl: telegramProxyUrl });
                    }
                    state.truenasPoolState[key] = nowState;
                }
                continue;
            }

            if (rule.type === 'truenas_pool_usage') {
                const ov = await getTrueNASOverview();
                if (!ov) continue;
                const thr = Number(rule.poolUsageThresholdPct);
                const selected = Array.isArray(rule.poolIds) && rule.poolIds.length
                    ? rule.poolIds
                    : (rule.poolId ? [rule.poolId] : []);
                for (const poolIdRaw of selected) {
                    const poolId = String(poolIdRaw || '').trim();
                    if (!poolId) continue;
                    const pool = (ov.pools || []).find((p, idx) => {
                        const id = String(p?.id || p?.name || (idx + 1));
                        return id === poolId;
                    });
                    if (!pool) continue;
                    const total = Number(pool.total || 0);
                    const used = Number(pool.used || 0);
                    if (!Number.isFinite(total) || total <= 0 || !Number.isFinite(used)) continue;
                    const usagePct = (used / total) * 100;
                    const nowLevel = usagePct >= thr ? 'high' : 'ok';
                    const key = `${String(rule.id || 'rule')}|${poolId}`;
                    const prev = state.truenasPoolUsage[key];
                    if (prev !== undefined && prev !== nowLevel) {
                        const poolName = String(pool.name || poolId);
                        const stateRu = nowLevel === 'high' ? 'Порог превышен' : 'Норма';
                        const msg = formatTelegramNotifyMessage(
                            rule,
                            { poolName, poolId, usagePct: usagePct.toFixed(1), thr: String(thr), state: nowLevel, stateRu },
                            `TrueNAS pool «${poolName}»: ${usagePct.toFixed(1)}% used (threshold ${thr}%)`
                        );
                        await sendTelegramMessage(token, chatId, msg, threadId, { proxyUrl: telegramProxyUrl });
                    }
                    state.truenasPoolUsage[key] = nowLevel;
                }
                continue;
            }

            if (rule.type === 'smart_sensor_error') {
                const snap = await loadSmartSensorsForNotify();
                const items = Array.isArray(snap.items) ? snap.items : [];
                const selected = Array.isArray(rule.smartSensorIds) && rule.smartSensorIds.length
                    ? rule.smartSensorIds.map((x) => String(x || '').trim()).filter(Boolean)
                    : (rule.smartSensorId ? [String(rule.smartSensorId).trim()] : []);
                const { chatId, threadId } = routeChat(rule);
                if (!chatId) continue;
                for (const sid of selected) {
                    if (!sid) continue;
                    const item = items.find((it) => String(it?.id || '') === sid);
                    const nowSig = !item ? 'absent' : (item.error ? `err:${String(item.error)}` : 'ok');
                    const key = `${String(rule.id || 'rule')}|${sid}`;
                    const prev = state.smartSensorError[key];
                    if (prev === undefined) {
                        state.smartSensorError[key] = nowSig;
                        continue;
                    }
                    if (prev === nowSig) {
                        state.smartSensorError[key] = nowSig;
                        continue;
                    }
                    const name = item ? String(item.name || sid) : sid;
                    const typeLabel = item && item.type === 'ble' ? 'BLE' : 'REST';
                    if (nowSig === 'ok') {
                        const msg = formatTelegramNotifyMessage(
                            rule,
                            {
                                sensorName: name,
                                sensorId: sid,
                                sensorType: typeLabel,
                                state: 'ok',
                                stateRu: 'Ок',
                                error: ''
                            },
                            `Датчик «${name}» (${typeLabel}): снова в норме`
                        );
                        await sendTelegramMessage(token, chatId, msg, threadId, { proxyUrl: telegramProxyUrl });
                    } else if (nowSig.startsWith('err:')) {
                        const errText = nowSig.slice(4);
                        const msg = formatTelegramNotifyMessage(
                            rule,
                            {
                                sensorName: name,
                                sensorId: sid,
                                sensorType: typeLabel,
                                state: 'error',
                                stateRu: 'Ошибка',
                                error: errText
                            },
                            `Датчик «${name}» (${typeLabel}): ${errText}`
                        );
                        await sendTelegramMessage(token, chatId, msg, threadId, { proxyUrl: telegramProxyUrl });
                    } else if (nowSig === 'absent') {
                        const msg = formatTelegramNotifyMessage(
                            rule,
                            {
                                sensorName: name,
                                sensorId: sid,
                                sensorType: '—',
                                state: 'absent',
                                stateRu: 'Нет в опросе',
                                error: ''
                            },
                            `Датчик id=${sid} не найден в текущем опросе (выключен или удалён)`
                        );
                        await sendTelegramMessage(token, chatId, msg, threadId, { proxyUrl: telegramProxyUrl });
                    }
                    state.smartSensorError[key] = nowSig;
                }
                continue;
            }

            if (rule.type === 'smart_sensor_threshold') {
                const snap = await loadSmartSensorsForNotify();
                const items = Array.isArray(snap.items) ? snap.items : [];
                const fieldKey = String(rule.smartSensorFieldKey || '').trim();
                const op = String(rule.smartSensorCompare || 'gte').toLowerCase();
                const thr = Number(rule.smartSensorThreshold);
                const { chatId, threadId } = routeChat(rule);
                if (!fieldKey || !Number.isFinite(thr) || !chatId) continue;
                const selected = Array.isArray(rule.smartSensorIds) && rule.smartSensorIds.length
                    ? rule.smartSensorIds.map((x) => String(x || '').trim()).filter(Boolean)
                    : (rule.smartSensorId ? [String(rule.smartSensorId).trim()] : []);
                for (const sid of selected) {
                    if (!sid) continue;
                    const item = items.find((it) => String(it?.id || '') === sid);
                    if (!item || item.error) continue;
                    const entry = item.values && typeof item.values === 'object' ? item.values[fieldKey] : null;
                    const num = smartSensorNumericFromEntry(entry);
                    if (num == null || !Number.isFinite(num)) continue;
                    const nowHigh = smartSensorThresholdCompare(op, num, thr);
                    const nowLevel = nowHigh ? 'high' : 'ok';
                    const key = `${String(rule.id || 'rule')}|${sid}|${fieldKey}|${op}|${thr}`;
                    const prev = state.smartSensorThreshold[key];
                    if (prev === undefined) {
                        state.smartSensorThreshold[key] = nowLevel;
                        continue;
                    }
                    const prevLevel = prev === 'high' ? 'high' : 'ok';
                    const name = String(item.name || sid);
                    const typeLabel = item.type === 'ble' ? 'BLE' : 'REST';
                    if (prevLevel === 'ok' && nowLevel === 'high') {
                        const msg = formatTelegramNotifyMessage(
                            rule,
                            {
                                sensorName: name,
                                sensorId: sid,
                                sensorType: typeLabel,
                                field: fieldKey,
                                value: String(num),
                                thr: String(thr),
                                op: op,
                                state: 'high',
                                stateRu: 'Порог превышен'
                            },
                            `Датчик «${name}» (${typeLabel}): ${fieldKey} = ${num} (условие ${op} ${thr})`
                        );
                        await sendTelegramMessage(token, chatId, msg, threadId, { proxyUrl: telegramProxyUrl });
                    } else if (prevLevel === 'high' && nowLevel === 'ok') {
                        const msg = formatTelegramNotifyMessage(
                            rule,
                            {
                                sensorName: name,
                                sensorId: sid,
                                sensorType: typeLabel,
                                field: fieldKey,
                                value: String(num),
                                thr: String(thr),
                                op: op,
                                state: 'ok',
                                stateRu: 'Норма'
                            },
                            `Датчик «${name}» (${typeLabel}): ${fieldKey} = ${num} — ниже порога (${op} ${thr})`
                        );
                        await sendTelegramMessage(token, chatId, msg, threadId, { proxyUrl: telegramProxyUrl });
                    }
                    state.smartSensorThreshold[key] = nowLevel;
                }
                continue;
            }

            if (rule.type === 'ups_load_high') {
                const upsMap = await getUpsBySlot();
                const thr = Number(rule.loadThresholdPct);
                const upsSlots = getRuleNumberTargets(rule, 'upsSlots', 'upsSlot');
                for (const upsSlot of upsSlots) {
                    const slot = String(upsSlot);
                    const it = upsMap.get(slot);
                    if (!it) continue;
                    const loadPct = it && it.electrical && it.electrical.loadPercent
                        ? Number(it.electrical.loadPercent.value)
                        : null;
                    if (!Number.isFinite(loadPct)) continue;
                    const loadStateKey = `${String(rule.id || 'rule')}|${slot}`;
                    const legacyPrev = state.upsLoad[slot];
                    const rawPrev = state.upsLoad[loadStateKey] != null ? state.upsLoad[loadStateKey] : legacyPrev;
                    const prevLevel = rawPrev === 'high' ? 'high' : 'ok';
                    const nowLevel = loadPct >= thr ? 'high' : 'ok';
                    if (prevLevel === 'ok' && nowLevel === 'high') {
                        const msg = formatTelegramNotifyMessage(
                            rule,
                            {
                                upsName: String(it.name || `UPS ${slot}`),
                                slot,
                                loadPct: loadPct.toFixed(1),
                                thr: String(thr),
                                state: 'high',
                                stateRu: 'Превышение'
                            },
                            `UPS «${String(it.name || `UPS ${slot}`)}»: нагрузка ${loadPct.toFixed(1)}% (порог ${thr}%)`
                        );
                        await sendTelegramMessage(token, chatId, msg, threadId, { proxyUrl: telegramProxyUrl });
                    } else if (prevLevel === 'high' && nowLevel === 'ok') {
                        const msg = formatTelegramNotifyMessage(
                            rule,
                            {
                                upsName: String(it.name || `UPS ${slot}`),
                                slot,
                                loadPct: loadPct.toFixed(1),
                                thr: String(thr),
                                state: 'ok',
                                stateRu: 'Норма'
                            },
                            `UPS «${String(it.name || `UPS ${slot}`)}»: нагрузка снизилась до ${loadPct.toFixed(1)}% (порог ${thr}%)`
                        );
                        await sendTelegramMessage(token, chatId, msg, threadId, { proxyUrl: telegramProxyUrl });
                    }
                    state.upsLoad[loadStateKey] = nowLevel;
                }
                continue;
            }

            if (rule.type === 'ups_on_battery' || rule.type === 'ups_back_to_mains') {
                const upsMap = await getUpsBySlot();
                const upsSlots = getRuleNumberTargets(rule, 'upsSlots', 'upsSlot');
                for (const upsSlot of upsSlots) {
                    const slot = String(upsSlot);
                    const it = upsMap.get(slot);
                    if (!it) continue;
                    const nowPower = getUpsPowerState(it);
                    if (!nowPower) continue;
                    const powerStateKey = `${String(rule.id || 'rule')}|${slot}`;
                    const legacyPrev = state.upsPower[slot];
                    const prevPower = state.upsPower[powerStateKey] != null ? state.upsPower[powerStateKey] : legacyPrev;
                    const changed = prevPower !== undefined && prevPower !== nowPower;
                    const shouldSend =
                        changed &&
                        ((rule.type === 'ups_on_battery' && nowPower === 'battery') ||
                            (rule.type === 'ups_back_to_mains' && nowPower === 'mains'));
                    if (shouldSend) {
                        const msg = formatTelegramNotifyMessage(
                            rule,
                            {
                                upsName: String(it.name || `UPS ${slot}`),
                                slot,
                                state: nowPower,
                                stateRu: nowPower === 'battery' ? 'От батареи' : 'От сети'
                            },
                            nowPower === 'battery'
                                ? `UPS «${String(it.name || `UPS ${slot}`)}»: переход на работу от батареи`
                                : `UPS «${String(it.name || `UPS ${slot}`)}»: возвращение на питание от сети`
                        );
                        await sendTelegramMessage(token, chatId, msg, threadId, { proxyUrl: telegramProxyUrl });
                    }
                    state.upsPower[powerStateKey] = nowPower;
                }
                continue;
            }

            if (rule.type === 'ups_charge_low') {
                const upsMap = await getUpsBySlot();
                const upsSlots = getRuleNumberTargets(rule, 'upsSlots', 'upsSlot');
                const thr = Number(rule.chargeThresholdPct);
                for (const upsSlot of upsSlots) {
                    const slot = String(upsSlot);
                    const it = upsMap.get(slot);
                    if (!it) continue;
                    const charge = it && it.battery ? Number(it.battery.chargePct) : null;
                    if (!Number.isFinite(charge)) continue;
                    const stateKey = `${String(rule.id || 'rule')}|${slot}`;
                    const legacyPrev = state.upsCharge[slot];
                    const rawPrev = state.upsCharge[stateKey] != null ? state.upsCharge[stateKey] : legacyPrev;
                    const prevLevel = rawPrev === 'low' ? 'low' : 'ok';
                    const nowLevel = charge <= thr ? 'low' : 'ok';
                    if (prevLevel === 'ok' && nowLevel === 'low') {
                        const msg = formatTelegramNotifyMessage(
                            rule,
                            {
                                upsName: String(it.name || `UPS ${slot}`),
                                slot,
                                chargePct: charge.toFixed(1),
                                thr: String(thr),
                                state: 'low',
                                stateRu: 'Разряжен'
                            },
                            `UPS «${String(it.name || `UPS ${slot}`)}»: заряд ${charge.toFixed(1)}% (порог ${thr}%)`
                        );
                        await sendTelegramMessage(token, chatId, msg, threadId, { proxyUrl: telegramProxyUrl });
                    } else if (prevLevel === 'low' && nowLevel === 'ok') {
                        const msg = formatTelegramNotifyMessage(
                            rule,
                            {
                                upsName: String(it.name || `UPS ${slot}`),
                                slot,
                                chargePct: charge.toFixed(1),
                                thr: String(thr),
                                state: 'ok',
                                stateRu: 'Норма'
                            },
                            `UPS «${String(it.name || `UPS ${slot}`)}»: заряд восстановился до ${charge.toFixed(1)}% (порог ${thr}%)`
                        );
                        await sendTelegramMessage(token, chatId, msg, threadId, { proxyUrl: telegramProxyUrl });
                    }
                    state.upsCharge[stateKey] = nowLevel;
                }
                continue;
            }

            if (rule.type === 'ups_charge_full') {
                const upsMap = await getUpsBySlot();
                const upsSlots = getRuleNumberTargets(rule, 'upsSlots', 'upsSlot');
                for (const upsSlot of upsSlots) {
                    const slot = String(upsSlot);
                    const it = upsMap.get(slot);
                    if (!it) continue;
                    const charge = it && it.battery ? Number(it.battery.chargePct) : null;
                    if (!Number.isFinite(charge)) continue;
                    const nowFull = charge >= 99;
                    const stateKey = `${String(rule.id || 'rule')}|${slot}|full`;
                    const legacyPrev = state.upsCharge[slot];
                    const rawPrev = state.upsCharge[stateKey] != null ? state.upsCharge[stateKey] : legacyPrev;
                    const prevFull = rawPrev === 'full';
                    if (prevFull !== nowFull) {
                        const msg = formatTelegramNotifyMessage(
                            rule,
                            {
                                upsName: String(it.name || `UPS ${slot}`),
                                slot,
                                chargePct: charge.toFixed(1),
                                state: nowFull ? 'full' : 'not_full',
                                stateRu: nowFull ? 'Полный' : 'Не полный'
                            },
                            nowFull
                                ? `UPS «${String(it.name || `UPS ${slot}`)}»: аккумулятор полностью заряжен (${charge.toFixed(1)}%)`
                                : `UPS «${String(it.name || `UPS ${slot}`)}»: аккумулятор больше не полностью заряжен (${charge.toFixed(1)}%)`
                        );
                        await sendTelegramMessage(token, chatId, msg, threadId, { proxyUrl: telegramProxyUrl });
                    }
                    state.upsCharge[stateKey] = nowFull ? 'full' : 'not_full';
                }
                continue;
            }
        } catch (e) {
            log('warn', `[MonitorNotify] rule ${rule.id}: ${e.message}`);
        }
    }

    store.setSetting('telegram_notify_state', JSON.stringify(state));
}

let timer = null;
let running = false;

function readIntervalMs() {
    let sec = parseInt(store.getSetting('telegram_notify_interval_sec'), 10);
    if (!Number.isFinite(sec) || sec < 15) sec = 60;
    if (sec > 3600) sec = 3600;
    return sec * 1000;
}

function scheduleNext() {
    if (timer) clearTimeout(timer);
    timer = setTimeout(async () => {
        if (!running) {
            running = true;
            try {
                await runNotifyTick();
            } catch (e) {
                log('error', `[MonitorNotify] tick: ${e.message}`);
            } finally {
                running = false;
            }
        }
        scheduleNext();
    }, readIntervalMs());
}

function startMonitorNotifyScheduler() {
    if (timer) clearTimeout(timer);
    timer = setTimeout(async () => {
        if (!running) {
            running = true;
            try {
                await runNotifyTick();
            } catch (e) {
                log('error', `[MonitorNotify] first tick: ${e.message}`);
            } finally {
                running = false;
            }
        }
        scheduleNext();
    }, 5000);
}

module.exports = { startMonitorNotifyScheduler, runNotifyTick };
