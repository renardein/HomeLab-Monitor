'use strict';

const axios = require('axios');
const { log } = require('./utils');

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

module.exports = { sendTelegramMessage, buildTelegramTestRuleMessage };
