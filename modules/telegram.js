'use strict';

const axios = require('axios');
const { HttpsProxyAgent } = require('https-proxy-agent');
const { SocksProxyAgent } = require('socks-proxy-agent');
const { log } = require('./utils');

/** Bot token: digits:secret (Telegram Bot API). Used to reject masked/invalid input overwriting stored token. */
function isValidTelegramBotTokenFormat(s) {
    const t = String(s || '').trim();
    return /^[0-9]{5,}:[A-Za-z0-9_-]{25,}$/.test(t);
}

/**
 * @param {string} [proxyUrl] — http(s)://host:port or with user:pass
 * @returns {import('axios').AxiosRequestConfig}
 */
function buildAxiosConfigForTelegram(proxyUrl) {
    const p = String(proxyUrl || '').trim();
    const base = { timeout: 25000, validateStatus: () => true };
    if (!p) return base;
    try {
        const u = new URL(p);
        const proto = (u.protocol || '').toLowerCase();
        if (proto === 'socks5:' || proto === 'socks4:' || proto === 'socks:') {
            base.httpsAgent = new SocksProxyAgent(p);
        } else {
            base.httpsAgent = new HttpsProxyAgent(p);
        }
        base.proxy = false;
    } catch (e) {
        log('warn', `[Telegram] invalid proxy URL (${e.message})`);
    }
    return base;
}

/**
 * Telegram Bot API MarkdownV2: escape dynamic text so sendMessage(parse_mode=MarkdownV2) succeeds.
 * @see https://core.telegram.org/bots/api#markdownv2-style
 */
function escapeMarkdownV2(text) {
    return String(text ?? '')
        .replace(/\\/g, '\\\\')
        .replace(/_/g, '\\_')
        .replace(/\*/g, '\\*')
        .replace(/\[/g, '\\[')
        .replace(/\]/g, '\\]')
        .replace(/\(/g, '\\(')
        .replace(/\)/g, '\\)')
        .replace(/~/g, '\\~')
        .replace(/`/g, '\\`')
        .replace(/>/g, '\\>')
        .replace(/#/g, '\\#')
        .replace(/\+/g, '\\+')
        .replace(/-/g, '\\-')
        .replace(/=/g, '\\=')
        .replace(/\|/g, '\\|')
        .replace(/\{/g, '\\{')
        .replace(/\}/g, '\\}')
        .replace(/\./g, '\\.')
        .replace(/!/g, '\\!');
}

/**
 * Replace `{name}`-style placeholders; unknown keys stay unchanged.
 * @param {string} template
 * @param {Record<string, string|number|boolean|null|undefined>} vars
 * @param {{ escapeMdV2Values?: boolean }} [options] — escape values for MarkdownV2 (recommended for notify bodies)
 */
function applyTelegramTemplate(template, vars, options) {
    const escapeVals = options && options.escapeMdV2Values === true;
    const t = String(template || '');
    const v = vars && typeof vars === 'object' ? vars : {};
    return t.replace(/\{([a-zA-Z0-9_]+)\}/g, (match, key) => {
        if (Object.prototype.hasOwnProperty.call(v, key)) {
            const val = v[key];
            const s = val == null ? '' : String(val);
            return escapeVals ? escapeMarkdownV2(s) : s;
        }
        return match;
    });
}

/**
 * Шаблон из правила или экранированный текст по умолчанию (MarkdownV2).
 */
function formatTelegramNotifyMessage(rule, vars, defaultText) {
    const tmpl = rule && String(rule.messageTemplate || '').trim();
    if (tmpl) return applyTelegramTemplate(tmpl, vars, { escapeMdV2Values: true });
    return escapeMarkdownV2(String(defaultText || ''));
}

function buildSampleVarsForTelegramRule(rule) {
    const r = rule && typeof rule === 'object' ? rule : {};
    const type = String(r.type || '');
    const firstServiceId = Array.isArray(r.serviceIds) && r.serviceIds.length
        ? Number(r.serviceIds[0])
        : Number(r.serviceId != null ? r.serviceId : 1);
    const firstVmid = Array.isArray(r.vmids) && r.vmids.length
        ? Number(r.vmids[0])
        : Number(r.vmid != null ? r.vmid : 100);
    const firstUpsSlot = Array.isArray(r.upsSlots) && r.upsSlots.length
        ? Number(r.upsSlots[0])
        : Number(r.upsSlot != null ? r.upsSlot : 1);
    const firstNodeName = Array.isArray(r.nodeNames) && r.nodeNames.length
        ? String(r.nodeNames[0])
        : String(r.nodeName || 'pve');
    switch (type) {
        case 'service_updown':
            return {
                name: 'My Service',
                serviceId: String(Number.isFinite(firstServiceId) ? firstServiceId : 1),
                state: 'up',
                stateRu: 'Онлайн'
            };
        case 'vm_state':
            return {
                name: 'vm-example',
                vmid: String(Number.isFinite(firstVmid) ? firstVmid : 100),
                kind: 'VM',
                state: 'running',
                stateRu: 'Запущен'
            };
        case 'node_online':
            return {
                nodeName: firstNodeName,
                state: 'online',
                stateRu: 'Онлайн'
            };
        case 'netdev_updown':
            return {
                name: 'switch-01',
                host: '192.168.1.1',
                slot: String(r.netdevSlot != null ? r.netdevSlot : 1),
                state: 'up',
                stateRu: 'Онлайн'
            };
        case 'host_temp':
            return {
                nodeName: firstNodeName,
                tempC: '72.5',
                thr: String(r.tempThresholdC != null ? r.tempThresholdC : 85)
            };
        case 'host_link_speed':
            return {
                nodeName: firstNodeName,
                prev: '1000',
                mbps: '100'
            };
        case 'truenas_disk_state':
            return {
                diskName: 'ada0',
                diskId: String(r.diskId || 'ada0'),
                state: 'healthy',
                stateRu: 'Исправен'
            };
        case 'truenas_pool_usage':
            return {
                poolName: 'tank',
                poolId: String(r.poolId || 'tank'),
                usagePct: '87.2',
                thr: String(r.poolUsageThresholdPct != null ? r.poolUsageThresholdPct : 85),
                state: 'high',
                stateRu: 'Порог превышен'
            };
        case 'truenas_service_state':
            return {
                serviceName: 'smb',
                serviceId: String(r.truenasServiceId || 'smb'),
                state: 'running',
                stateRu: 'Запущен'
            };
        case 'truenas_pool_state':
            return {
                poolName: 'tank',
                poolId: String(r.poolId || 'tank'),
                state: 'healthy',
                stateRu: 'Исправен'
            };
        case 'ups_load_high':
            return {
                upsName: `UPS ${Number.isFinite(firstUpsSlot) ? firstUpsSlot : 1}`,
                slot: String(Number.isFinite(firstUpsSlot) ? firstUpsSlot : 1),
                loadPct: '72.5',
                thr: String(r.loadThresholdPct != null ? r.loadThresholdPct : 80),
                state: 'high',
                stateRu: 'Превышение'
            };
        case 'ups_on_battery':
        case 'ups_back_to_mains':
            return {
                upsName: `UPS ${Number.isFinite(firstUpsSlot) ? firstUpsSlot : 1}`,
                slot: String(Number.isFinite(firstUpsSlot) ? firstUpsSlot : 1),
                state: type === 'ups_on_battery' ? 'battery' : 'mains',
                stateRu: type === 'ups_on_battery' ? 'От батареи' : 'От сети'
            };
        case 'ups_charge_low':
            return {
                upsName: `UPS ${Number.isFinite(firstUpsSlot) ? firstUpsSlot : 1}`,
                slot: String(Number.isFinite(firstUpsSlot) ? firstUpsSlot : 1),
                chargePct: '18.5',
                thr: String(r.chargeThresholdPct != null ? r.chargeThresholdPct : 20),
                state: 'low',
                stateRu: 'Разряжен'
            };
        case 'ups_charge_full':
            return {
                upsName: `UPS ${Number.isFinite(firstUpsSlot) ? firstUpsSlot : 1}`,
                slot: String(Number.isFinite(firstUpsSlot) ? firstUpsSlot : 1),
                chargePct: '100.0',
                state: 'full',
                stateRu: 'Полный'
            };
        default:
            return {};
    }
}

/**
 * @param {string} botToken
 * @param {string} chatId
 * @param {string} text
 * @param {string|number|null|undefined} threadId message_thread_id (forum topics)
 */
/**
 * @param {string|number|null|undefined} threadId message_thread_id (forum topics)
 * @param {{ proxyUrl?: string }} [options]
 */
async function sendTelegramMessage(botToken, chatId, text, threadId, options) {
    const token = String(botToken || '').trim();
    const cid = String(chatId || '').trim();
    if (!token) throw new Error('bot token required');
    if (!cid) throw new Error('chat_id required');
    const msg = String(text || '').slice(0, 4096);
    if (!msg.trim()) throw new Error('message text empty');

    const url = `https://api.telegram.org/bot${encodeURIComponent(token)}/sendMessage`;
    const axiosCfg = buildAxiosConfigForTelegram(options && options.proxyUrl);

    const buildBody = (withMarkdown) => {
        const body = {
            chat_id: cid,
            text: msg,
            disable_web_page_preview: true
        };
        if (withMarkdown) body.parse_mode = 'MarkdownV2';
        if (threadId != null && String(threadId).trim() !== '') {
            const n = parseInt(String(threadId).trim(), 10);
            if (Number.isFinite(n)) body.message_thread_id = n;
        }
        return body;
    };

    const post = async (body) => {
        const resp = await axios.post(url, body, axiosCfg);
        return { resp, data: resp.data };
    };

    let { data } = await post(buildBody(true));
    if (!data || data.ok !== true) {
        const desc = data && data.description ? String(data.description) : '';
        const retryPlain = desc && /parse|entity|markdown/i.test(desc);
        if (retryPlain) {
            log('warn', `[Telegram] MarkdownV2 send failed, retrying plain: ${desc}`);
            const second = await post(buildBody(false));
            data = second.data;
        }
    }
    if (!data || data.ok !== true) {
        const desc = data && data.description ? String(data.description) : `HTTP error`;
        log('warn', `[Telegram] sendMessage failed: ${desc}`);
        throw new Error(desc);
    }
}

/**
 * Текст тестового сообщения для проверки правила (chat_id / thread_id / токен).
 * @param {object} rule — одно правило из telegram_notification_rules
 */
function buildTelegramTestRuleMessage(rule) {
    const r = rule && typeof rule === 'object' ? rule : {};
    const type = String(r.type || 'unknown');
    const tmpl = String(r.messageTemplate || '').trim();
    if (tmpl) {
        const sample = buildSampleVarsForTelegramRule(r);
        const preview = applyTelegramTemplate(tmpl, sample, { escapeMdV2Values: true });
        const header = escapeMarkdownV2('🔔 Proxmox Monitor — test (message template preview)');
        const footer = escapeMarkdownV2(
            'Sample placeholder values were used. Save the rule and use the same {placeholders} in real notifications.'
        );
        return [header, '', preview, '', footer].join('\n');
    }
    const lines = [];
    lines.push(escapeMarkdownV2('🔔 Proxmox Monitor — test'));
    lines.push(escapeMarkdownV2(`Rule: ${type}`));
    switch (type) {
        case 'service_updown':
            lines.push(escapeMarkdownV2(`Target: service id ${r.serviceId != null ? r.serviceId : '—'}`));
            break;
        case 'vm_state':
            lines.push(escapeMarkdownV2(`Target: VM/CT vmid ${r.vmid != null ? r.vmid : '—'}`));
            break;
        case 'node_online':
        case 'host_temp':
        case 'host_link_speed':
            lines.push(escapeMarkdownV2(`Target: node ${r.nodeName ? String(r.nodeName) : '—'}`));
            if (type === 'host_temp') {
                lines.push(escapeMarkdownV2(`Threshold: ${r.tempThresholdC != null ? r.tempThresholdC : '—'} °C`));
            }
            break;
        case 'netdev_updown':
            lines.push(escapeMarkdownV2(`Target: SNMP slot ${r.netdevSlot != null ? r.netdevSlot : '—'}`));
            break;
        case 'truenas_disk_state':
            lines.push(escapeMarkdownV2(`Target: TrueNAS disk ${r.diskId != null ? r.diskId : '—'}`));
            break;
        case 'truenas_pool_usage':
            lines.push(escapeMarkdownV2(`Target: TrueNAS pool ${r.poolId != null ? r.poolId : '—'}`));
            lines.push(escapeMarkdownV2(`Threshold: ${r.poolUsageThresholdPct != null ? r.poolUsageThresholdPct : '—'} %`));
            break;
        case 'truenas_service_state':
            lines.push(escapeMarkdownV2(`Target: TrueNAS service ${r.truenasServiceId != null ? r.truenasServiceId : '—'}`));
            break;
        case 'truenas_pool_state':
            lines.push(escapeMarkdownV2(`Target: TrueNAS pool ${r.poolId != null ? r.poolId : '—'}`));
            break;
        case 'ups_load_high':
            lines.push(escapeMarkdownV2(`Target: UPS slot ${r.upsSlot != null ? r.upsSlot : '—'}`));
            lines.push(escapeMarkdownV2(`Threshold: ${r.loadThresholdPct != null ? r.loadThresholdPct : '—'} %`));
            break;
        case 'ups_on_battery':
            lines.push(escapeMarkdownV2(`Target: UPS slot ${r.upsSlot != null ? r.upsSlot : '—'}`));
            lines.push(escapeMarkdownV2('Event: switched to battery mode'));
            break;
        case 'ups_back_to_mains':
            lines.push(escapeMarkdownV2(`Target: UPS slot ${r.upsSlot != null ? r.upsSlot : '—'}`));
            lines.push(escapeMarkdownV2('Event: returned to mains power'));
            break;
        case 'ups_charge_low':
            lines.push(escapeMarkdownV2(`Target: UPS slot ${r.upsSlot != null ? r.upsSlot : '—'}`));
            lines.push(escapeMarkdownV2(`Threshold: ${r.chargeThresholdPct != null ? r.chargeThresholdPct : '—'} %`));
            break;
        case 'ups_charge_full':
            lines.push(escapeMarkdownV2(`Target: UPS slot ${r.upsSlot != null ? r.upsSlot : '—'}`));
            lines.push(escapeMarkdownV2('Event: battery fully charged'));
            break;
        default:
            lines.push(escapeMarkdownV2('Target: —'));
    }
    lines.push('');
    lines.push(
        escapeMarkdownV2(
            'If you see this message, the bot token and chat_id (and thread_id if used) are configured correctly.'
        )
    );
    return lines.join('\n');
}

module.exports = {
    sendTelegramMessage,
    buildTelegramTestRuleMessage,
    applyTelegramTemplate,
    buildSampleVarsForTelegramRule,
    escapeMarkdownV2,
    formatTelegramNotifyMessage,
    isValidTelegramBotTokenFormat,
    buildAxiosConfigForTelegram
};
