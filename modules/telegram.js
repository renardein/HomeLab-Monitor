'use strict';

const axios = require('axios');
const { log } = require('./utils');

/**
 * Replace `{name}`-style placeholders; unknown keys stay unchanged.
 * @param {string} template
 * @param {Record<string, string|number|boolean|null|undefined>} vars
 */
function applyTelegramTemplate(template, vars) {
    const t = String(template || '');
    const v = vars && typeof vars === 'object' ? vars : {};
    return t.replace(/\{([a-zA-Z0-9_]+)\}/g, (match, key) => {
        if (Object.prototype.hasOwnProperty.call(v, key)) {
            const val = v[key];
            return val == null ? '' : String(val);
        }
        return match;
    });
}

function buildSampleVarsForTelegramRule(rule) {
    const r = rule && typeof rule === 'object' ? rule : {};
    const type = String(r.type || '');
    switch (type) {
        case 'service_updown':
            return {
                name: 'My Service',
                serviceId: String(r.serviceId != null ? r.serviceId : 1),
                state: 'up',
                stateRu: 'Онлайн'
            };
        case 'vm_state':
            return {
                name: 'vm-example',
                vmid: String(r.vmid != null ? r.vmid : 100),
                kind: 'VM',
                state: 'running',
                stateRu: 'Запущен'
            };
        case 'node_online':
            return {
                nodeName: String(r.nodeName || 'pve'),
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
                nodeName: String(r.nodeName || 'pve'),
                tempC: '72.5',
                thr: String(r.tempThresholdC != null ? r.tempThresholdC : 85)
            };
        case 'host_link_speed':
            return {
                nodeName: String(r.nodeName || 'pve'),
                prev: '1000',
                mbps: '100'
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
async function sendTelegramMessage(botToken, chatId, text, threadId) {
    const token = String(botToken || '').trim();
    const cid = String(chatId || '').trim();
    if (!token) throw new Error('bot token required');
    if (!cid) throw new Error('chat_id required');
    const url = `https://api.telegram.org/bot${encodeURIComponent(token)}/sendMessage`;
    const body = {
        chat_id: cid,
        text: String(text || ''),
        disable_web_page_preview: true
    };
    if (threadId != null && String(threadId).trim() !== '') {
        const n = parseInt(String(threadId).trim(), 10);
        if (Number.isFinite(n)) body.message_thread_id = n;
    }
    const resp = await axios.post(url, body, { timeout: 25000, validateStatus: () => true });
    const data = resp.data;
    if (!data || data.ok !== true) {
        const desc = data && data.description ? String(data.description) : `HTTP ${resp.status}`;
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
        const preview = applyTelegramTemplate(tmpl, sample);
        return [
            '🔔 Proxmox Monitor — test (message template preview)',
            '',
            preview,
            '',
            'Sample placeholder values were used. Save the rule and use the same {placeholders} in real notifications.'
        ].join('\n');
    }
    const lines = ['🔔 Proxmox Monitor — test'];
    lines.push(`Rule: ${type}`);
    switch (type) {
        case 'service_updown':
            lines.push(`Target: service id ${r.serviceId != null ? r.serviceId : '—'}`);
            break;
        case 'vm_state':
            lines.push(`Target: VM/CT vmid ${r.vmid != null ? r.vmid : '—'}`);
            break;
        case 'node_online':
        case 'host_temp':
        case 'host_link_speed':
            lines.push(`Target: node ${r.nodeName ? String(r.nodeName) : '—'}`);
            if (type === 'host_temp') lines.push(`Threshold: ${r.tempThresholdC != null ? r.tempThresholdC : '—'} °C`);
            break;
        case 'netdev_updown':
            lines.push(`Target: SNMP slot ${r.netdevSlot != null ? r.netdevSlot : '—'}`);
            break;
        default:
            lines.push('Target: —');
    }
    lines.push('');
    lines.push('If you see this message, the bot token and chat_id (and thread_id if used) are configured correctly.');
    return lines.join('\n');
}

module.exports = { sendTelegramMessage, buildTelegramTestRuleMessage, applyTelegramTemplate, buildSampleVarsForTelegramRule };
