'use strict';

const { log } = require('./utils');
const store = require('./settings-store');
const connectionStore = require('./connection-store');
const proxmox = require('./proxmox-api');
const { checkOne } = require('./routes/health');
const { sendTelegramMessage, formatTelegramNotifyMessage } = require('./telegram');
const { pollNetdevMonitoringItems } = require('./routes/netdevices-snmp');
const { getEffectiveRules } = require('./telegram-rules');
const hostMetricsRoute = require('./routes/host-metrics');

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

function parseNotifyState() {
    const raw = store.getSetting('telegram_notify_state');
    if (!raw) {
        return {
            service: {},
            vm: {},
            node: {},
            netdev: {},
            hostTemp: {},
            hostLink: {}
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
                hostLink: {}
            };
        }
        return {
            service: p.service && typeof p.service === 'object' ? p.service : {},
            vm: p.vm && typeof p.vm === 'object' ? p.vm : {},
            node: p.node && typeof p.node === 'object' ? p.node : {},
            netdev: p.netdev && typeof p.netdev === 'object' ? p.netdev : {},
            hostTemp: p.hostTemp && typeof p.hostTemp === 'object' ? p.hostTemp : {},
            hostLink: p.hostLink && typeof p.hostLink === 'object' ? p.hostLink : {}
        };
    } catch {
        return {
            service: {},
            vm: {},
            node: {},
            netdev: {},
            hostTemp: {},
            hostLink: {}
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

function routeChat(rule) {
    const chatId = rule.chatId != null ? String(rule.chatId).trim() : '';
    const threadId = rule.threadId != null && String(rule.threadId).trim() !== '' ? rule.threadId : null;
    return { chatId, threadId };
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

    for (const rule of rules) {
        if (!rule.enabled) continue;
        const { chatId, threadId } = routeChat(rule);
        if (!chatId) continue;

        try {
            if (rule.type === 'service_updown') {
                const svc = servicesById.get(String(rule.serviceId));
                if (!svc) continue;
                const r = await checkOne(buildServiceTarget(svc));
                const nowUp = !!r.up;
                const stateNow = nowUp ? 'up' : 'down';
                const sid = String(rule.serviceId);
                const prev = state.service[sid];
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
                state.service[sid] = stateNow;
                continue;
            }

            if (rule.type === 'vm_state') {
                if (!vmByVmid) continue;
                const key = String(rule.vmid);
                const res = vmByVmid.get(Number(rule.vmid));
                const running = res && String(res.status || '').toLowerCase() === 'running';
                const stateNow = running ? 'running' : 'stopped';
                const prev = state.vm[key];
                if (prev !== undefined && prev !== stateNow) {
                    const label = res && res.name ? String(res.name) : `VM/CT ${rule.vmid}`;
                    const kind = res && res.type === 'lxc' ? 'CT' : 'VM';
                    const stateRu = stateNow === 'running' ? 'Запущен' : 'Остановлен';
                    const msg = formatTelegramNotifyMessage(
                        rule,
                        {
                            name: label,
                            vmid: String(rule.vmid),
                            kind,
                            state: stateNow,
                            stateRu
                        },
                        `${kind} «${label}» (${rule.vmid})\n${stateRu}`
                    );
                    await sendTelegramMessage(token, chatId, msg, threadId, { proxyUrl: telegramProxyUrl });
                }
                state.vm[key] = stateNow;
                continue;
            }

            if (rule.type === 'node_online') {
                if (!nodeDetails) continue;
                const nname = String(rule.nodeName || '').trim();
                const nd = nodeDetails.find((x) => String(x.name) === nname);
                if (!nd) continue;
                const stateNow = nd.online ? 'online' : 'offline';
                const prev = state.node[nname];
                if (prev !== undefined && prev !== stateNow) {
                    const stateRu = stateNow === 'online' ? 'Онлайн' : 'Офлайн';
                    const msg = formatTelegramNotifyMessage(
                        rule,
                        {
                            nodeName: nname,
                            state: stateNow,
                            stateRu
                        },
                        `Узел Proxmox «${nname}»\n${stateRu}`
                    );
                    await sendTelegramMessage(token, chatId, msg, threadId, { proxyUrl: telegramProxyUrl });
                }
                state.node[nname] = stateNow;
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
                const nname = String(rule.nodeName || '').trim();
                const thr = Number(rule.tempThresholdC);
                const snap = await getHostSnap(nname);
                const tempC = snap && snap.cpu && snap.cpu.tempC != null ? Number(snap.cpu.tempC) : null;
                if (tempC == null || !Number.isFinite(tempC)) continue;
                const prevLevel = state.hostTemp[nname] === 'high' ? 'high' : 'ok';
                const nowHigh = tempC >= thr;
                const nowLevel = nowHigh ? 'high' : 'ok';
                if (prevLevel === 'ok' && nowLevel === 'high') {
                    const msg = formatTelegramNotifyMessage(
                        rule,
                        {
                            nodeName: nname,
                            tempC: tempC.toFixed(1),
                            thr: String(thr)
                        },
                        `Узел «${nname}»: температура CPU ${tempC.toFixed(1)}°C (порог ${thr}°C)`
                    );
                    await sendTelegramMessage(token, chatId, msg, threadId, { proxyUrl: telegramProxyUrl });
                }
                state.hostTemp[nname] = nowLevel;
                continue;
            }

            if (rule.type === 'host_link_speed') {
                const nname = String(rule.nodeName || '').trim();
                const snap = await getHostSnap(nname);
                const mbps = snap && snap.link && snap.link.speedMbps != null ? Number(snap.link.speedMbps) : null;
                if (mbps == null || !Number.isFinite(mbps)) continue;
                const prev = state.hostLink[nname];
                if (prev !== undefined && Number.isFinite(Number(prev)) && Number(prev) !== mbps) {
                    const msg = formatTelegramNotifyMessage(
                        rule,
                        {
                            nodeName: nname,
                            prev: String(Number(prev)),
                            mbps: String(mbps)
                        },
                        `Узел «${nname}»: скорость линка ${Number(prev)} → ${mbps} Мбит/с`
                    );
                    await sendTelegramMessage(token, chatId, msg, threadId, { proxyUrl: telegramProxyUrl });
                }
                state.hostLink[nname] = mbps;
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
