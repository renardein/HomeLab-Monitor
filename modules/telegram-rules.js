'use strict';

const RULE_TYPES = new Set([
    'service_updown',
    'vm_state',
    'node_online',
    'netdev_updown',
    'host_temp',
    'host_link_speed',
    'ups_load_high',
    'ups_on_battery',
    'ups_back_to_mains',
    'ups_charge_low',
    'ups_charge_full'
]);

function safeStr(v) {
    return v == null ? '' : String(v).trim();
}

function normalizeStringList(raw) {
    if (!Array.isArray(raw)) return [];
    return raw.map((x) => safeStr(x)).filter(Boolean);
}

function normalizeNumberList(raw) {
    if (!Array.isArray(raw)) return [];
    return raw
        .map((x) => parseInt(x, 10))
        .filter((n) => Number.isFinite(n));
}

function migrateLegacyTelegramRoutesToRules(routes) {
    if (!routes || typeof routes !== 'object') return [];
    const out = [];
    let n = 0;
    const id = () => `legacy_${Date.now()}_${++n}`;

    const svc = routes.service && typeof routes.service === 'object' ? routes.service : {};
    for (const [sid, r] of Object.entries(svc)) {
        const chatId = safeStr(r && r.chatId);
        if (!chatId) continue;
        const serviceId = parseInt(sid, 10);
        if (!Number.isFinite(serviceId)) continue;
        out.push({
            id: id(),
            enabled: true,
            type: 'service_updown',
            serviceId,
            chatId,
            threadId: safeStr(r && r.threadId) || undefined
        });
    }

    const vm = routes.vm && typeof routes.vm === 'object' ? routes.vm : {};
    for (const [vid, r] of Object.entries(vm)) {
        const chatId = safeStr(r && r.chatId);
        if (!chatId) continue;
        const vmid = parseInt(vid, 10);
        if (!Number.isFinite(vmid)) continue;
        out.push({
            id: id(),
            enabled: true,
            type: 'vm_state',
            vmid,
            chatId,
            threadId: safeStr(r && r.threadId) || undefined
        });
    }

    const node = routes.node && typeof routes.node === 'object' ? routes.node : {};
    for (const [name, r] of Object.entries(node)) {
        const chatId = safeStr(r && r.chatId);
        if (!chatId) continue;
        const nodeName = safeStr(name);
        if (!nodeName) continue;
        out.push({
            id: id(),
            enabled: true,
            type: 'node_online',
            nodeName,
            chatId,
            threadId: safeStr(r && r.threadId) || undefined
        });
    }

    const nd = routes.netdev && typeof routes.netdev === 'object' ? routes.netdev : {};
    for (const [slot, r] of Object.entries(nd)) {
        const chatId = safeStr(r && r.chatId);
        if (!chatId) continue;
        const netdevSlot = parseInt(slot, 10);
        if (!Number.isFinite(netdevSlot)) continue;
        out.push({
            id: id(),
            enabled: true,
            type: 'netdev_updown',
            netdevSlot,
            chatId,
            threadId: safeStr(r && r.threadId) || undefined
        });
    }

    return out;
}

function normalizeRule(raw) {
    if (!raw || typeof raw !== 'object') return null;
    const type = safeStr(raw.type).toLowerCase();
    if (!RULE_TYPES.has(type)) return null;
    const chatId = safeStr(raw.chatId);
    const id = safeStr(raw.id) || `r_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`;
    const threadId = safeStr(raw.threadId);
    let messageTemplate = safeStr(raw.messageTemplate);
    if (messageTemplate.length > 4096) messageTemplate = messageTemplate.slice(0, 4096);
    const base = {
        id,
        enabled: raw.enabled !== false,
        type,
        chatId,
        threadId: threadId || undefined,
        messageTemplate: messageTemplate || undefined
    };

    if (type === 'service_updown') {
        const serviceIds = normalizeNumberList(raw.serviceIds);
        const fallback = parseInt(raw.serviceId, 10);
        if (!serviceIds.length && !Number.isFinite(fallback)) return null;
        const uniq = serviceIds.length ? Array.from(new Set(serviceIds)) : [fallback];
        return { ...base, serviceId: uniq[0], serviceIds: uniq };
    }
    if (type === 'vm_state') {
        const vmids = normalizeNumberList(raw.vmids);
        const fallback = parseInt(raw.vmid, 10);
        if (!vmids.length && !Number.isFinite(fallback)) return null;
        const uniq = vmids.length ? Array.from(new Set(vmids)) : [fallback];
        return { ...base, vmid: uniq[0], vmids: uniq };
    }
    if (type === 'node_online') {
        const nodeNames = normalizeStringList(raw.nodeNames);
        const fallback = safeStr(raw.nodeName);
        if (!nodeNames.length && !fallback) return null;
        const uniq = nodeNames.length ? Array.from(new Set(nodeNames)) : [fallback];
        return { ...base, nodeName: uniq[0], nodeNames: uniq };
    }
    if (type === 'netdev_updown') {
        const netdevSlot = parseInt(raw.netdevSlot, 10);
        if (!Number.isFinite(netdevSlot)) return null;
        return { ...base, netdevSlot };
    }
    if (type === 'host_temp') {
        const nodeNames = normalizeStringList(raw.nodeNames);
        const fallback = safeStr(raw.nodeName);
        if (!nodeNames.length && !fallback) return null;
        const uniq = nodeNames.length ? Array.from(new Set(nodeNames)) : [fallback];
        let t = parseFloat(raw.tempThresholdC);
        if (!Number.isFinite(t)) t = 85;
        if (t < 0) t = 0;
        if (t > 120) t = 120;
        return { ...base, nodeName: uniq[0], nodeNames: uniq, tempThresholdC: t };
    }
    if (type === 'host_link_speed') {
        const nodeNames = normalizeStringList(raw.nodeNames);
        const fallback = safeStr(raw.nodeName);
        if (!nodeNames.length && !fallback) return null;
        const uniq = nodeNames.length ? Array.from(new Set(nodeNames)) : [fallback];
        return { ...base, nodeName: uniq[0], nodeNames: uniq };
    }
    if (type === 'ups_load_high') {
        const upsSlots = normalizeNumberList(raw.upsSlots);
        const fallback = parseInt(raw.upsSlot, 10);
        if (!upsSlots.length && !Number.isFinite(fallback)) return null;
        const uniq = upsSlots.length ? Array.from(new Set(upsSlots)) : [fallback];
        let t = parseFloat(raw.loadThresholdPct);
        if (!Number.isFinite(t)) t = 80;
        if (t < 0) t = 0;
        if (t > 100) t = 100;
        return { ...base, upsSlot: uniq[0], upsSlots: uniq, loadThresholdPct: t };
    }
    if (type === 'ups_on_battery' || type === 'ups_back_to_mains') {
        const upsSlots = normalizeNumberList(raw.upsSlots);
        const fallback = parseInt(raw.upsSlot, 10);
        if (!upsSlots.length && !Number.isFinite(fallback)) return null;
        const uniq = upsSlots.length ? Array.from(new Set(upsSlots)) : [fallback];
        return { ...base, upsSlot: uniq[0], upsSlots: uniq };
    }
    if (type === 'ups_charge_low') {
        const upsSlots = normalizeNumberList(raw.upsSlots);
        const fallback = parseInt(raw.upsSlot, 10);
        if (!upsSlots.length && !Number.isFinite(fallback)) return null;
        const uniq = upsSlots.length ? Array.from(new Set(upsSlots)) : [fallback];
        let t = parseFloat(raw.chargeThresholdPct);
        if (!Number.isFinite(t)) t = 20;
        if (t < 0) t = 0;
        if (t > 100) t = 100;
        return { ...base, upsSlot: uniq[0], upsSlots: uniq, chargeThresholdPct: t };
    }
    if (type === 'ups_charge_full') {
        const upsSlots = normalizeNumberList(raw.upsSlots);
        const fallback = parseInt(raw.upsSlot, 10);
        if (!upsSlots.length && !Number.isFinite(fallback)) return null;
        const uniq = upsSlots.length ? Array.from(new Set(upsSlots)) : [fallback];
        return { ...base, upsSlot: uniq[0], upsSlots: uniq };
    }
    return null;
}

function parseRulesJson(raw) {
    if (!raw) return [];
    try {
        const p = JSON.parse(raw);
        if (!Array.isArray(p)) return [];
        return p.map(normalizeRule).filter(Boolean);
    } catch {
        return [];
    }
}

/**
 * @param {{ getSetting: (k: string) => string }} store
 * @param {(raw: string) => object} parseLegacyRoutes — same shape as old telegram_routes
 */
function getEffectiveRules(store, parseLegacyRoutes) {
    const parsed = parseRulesJson(store.getSetting('telegram_notification_rules'));
    if (parsed.length) return parsed;
    const legacy = parseLegacyRoutes();
    return migrateLegacyTelegramRoutesToRules(legacy);
}

module.exports = {
    RULE_TYPES,
    migrateLegacyTelegramRoutesToRules,
    normalizeRule,
    parseRulesJson,
    getEffectiveRules
};
