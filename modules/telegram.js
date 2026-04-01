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
                stateRu: 'Онлайн',
                offlineSince: '',
                offlineSinceRu: ''
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
        case 'smart_sensor_error': {
            const sid = String(r.smartSensorId || 'sensor-id');
            return {
                sensorName: 'Sensor',
                sensorId: sid,
                sensorType: 'REST',
                state: 'error',
                stateRu: 'Ошибка',
                error: 'timeout'
            };
        }
        case 'smart_sensor_threshold':
            return {
                sensorName: 'Sensor',
                sensorId: String(r.smartSensorId || 'sensor-id'),
                sensorType: 'REST',
                field: String(r.smartSensorFieldKey || 'temperature'),
                value: '28.5',
                thr: String(r.smartSensorThreshold != null ? r.smartSensorThreshold : 30),
                op: String(r.smartSensorCompare || 'gte'),
                state: 'high',
                stateRu: 'Порог превышен'
            };
        default:
            return {};
    }
}

/** Один запрос getUpdates (limit 100). При ошибке API поле telegramErrorCode на объекте Error. */
async function telegramBotGetUpdates(botToken, proxyUrl, params) {
    const token = String(botToken || '').trim();
    if (!token) throw new Error('bot token required');
    const url = `https://api.telegram.org/bot${encodeURIComponent(token)}/getUpdates`;
    const axiosCfg = buildAxiosConfigForTelegram(proxyUrl);
    const query = { timeout: 0, limit: 100, ...(params && typeof params === 'object' ? params : {}) };
    const resp = await axios.get(url, { ...axiosCfg, params: query });
    const data = resp && resp.data;
    if (!data || data.ok !== true) {
        const desc = data && data.description ? String(data.description) : 'getUpdates failed';
        const err = new Error(desc);
        err.telegramErrorCode = data && data.error_code;
        throw err;
    }
    return Array.isArray(data.result) ? data.result : [];
}

async function telegramBotCallGet(botToken, method, proxyUrl, params) {
    const token = String(botToken || '').trim();
    if (!token) throw new Error('bot token required');
    const m = String(method || '').replace(/^\//, '');
    if (!m) throw new Error('method required');
    const url = `https://api.telegram.org/bot${encodeURIComponent(token)}/${m}`;
    const axiosCfg = buildAxiosConfigForTelegram(proxyUrl);
    const resp = await axios.get(url, { ...axiosCfg, params: params && typeof params === 'object' ? params : {} });
    const data = resp && resp.data;
    if (!data || data.ok !== true) {
        const err = new Error(data && data.description ? String(data.description) : `${m} failed`);
        err.telegramErrorCode = data && data.error_code;
        err.telegramMethodFailed = true;
        throw err;
    }
    return data.result;
}

function _labelFromTelegramChatApi(chat, idStr) {
    const fallbackId = idStr != null ? String(idStr) : String(chat && chat.id != null ? chat.id : '');
    if (!chat || chat.id == null) return fallbackId;
    const title = chat.title != null ? String(chat.title).trim() : '';
    const username = chat.username != null ? String(chat.username).trim() : '';
    const fn = [chat.first_name, chat.last_name]
        .filter((x) => x != null && String(x).trim() !== '')
        .map((x) => String(x).trim())
        .join(' ');
    return title || (username ? `@${username}` : '') || fn || fallbackId;
}

async function _enrichChatsMapWithGetChat(botToken, proxyUrl, chatsMap) {
    const ids = Array.from(chatsMap.keys());
    await Promise.all(
        ids.map(async (idStr) => {
            try {
                const chat = await telegramBotCallGet(botToken, 'getChat', proxyUrl, { chat_id: idStr });
                if (!chat || chat.id == null) return;
                const title = chat.title != null ? String(chat.title).trim() : '';
                const username = chat.username != null ? String(chat.username).trim() : '';
                const label = _labelFromTelegramChatApi(chat, idStr);
                chatsMap.set(idStr, {
                    id: idStr,
                    type: chat.type != null ? String(chat.type) : '',
                    title: title || null,
                    username: username || null,
                    first_name: chat.first_name != null ? String(chat.first_name) : null,
                    last_name: chat.last_name != null ? String(chat.last_name) : null,
                    label
                });
            } catch (_) {
                /* оставляем данные из getUpdates */
            }
        })
    );
}

function _sleepMs(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
}

/** Для названий тем нужны права администратора с can_manage_topics (иначе запрос тихо пропускается). */
async function _enrichThreadsMapWithGetForumTopic(botToken, proxyUrl, threadsMap) {
    const pairs = [];
    for (const [cid, tmap] of threadsMap) {
        for (const tid of tmap.keys()) {
            pairs.push([cid, tid]);
        }
    }
    for (let i = 0; i < pairs.length; i++) {
        const [cid, tid] = pairs[i];
        try {
            const ft = await telegramBotCallGet(botToken, 'getForumTopic', proxyUrl, {
                chat_id: cid,
                message_thread_id: tid
            });
            if (ft && ft.name != null && String(ft.name).trim()) {
                const tmap = threadsMap.get(cid);
                if (tmap) tmap.set(tid, String(ft.name).trim());
            }
        } catch (_) {
            /* нет прав или не форум — остаётся имя из update / topic id */
        }
        if (i < pairs.length - 1) await _sleepMs(45);
    }
}

function _telegramAddChatFromApi(chatsMap, chat) {
    if (!chat || chat.id == null) return;
    const idStr = String(chat.id);
    if (chatsMap.has(idStr)) return;
    const title = chat.title != null ? String(chat.title).trim() : '';
    const username = chat.username != null ? String(chat.username).trim() : '';
    const fn = [chat.first_name, chat.last_name]
        .filter((x) => x != null && String(x).trim() !== '')
        .map((x) => String(x).trim())
        .join(' ');
    const label = title || (username ? `@${username}` : '') || fn || idStr;
    chatsMap.set(idStr, {
        id: idStr,
        type: chat.type != null ? String(chat.type) : '',
        title: title || null,
        username: username || null,
        first_name: chat.first_name != null ? String(chat.first_name) : null,
        last_name: chat.last_name != null ? String(chat.last_name) : null,
        label
    });
}

function _telegramAddThread(threadsMap, chatId, threadId, nameHint) {
    if (chatId == null || threadId == null) return;
    const cid = String(chatId);
    const tid = parseInt(String(threadId), 10);
    if (!Number.isFinite(tid)) return;
    if (!threadsMap.has(cid)) threadsMap.set(cid, new Map());
    const m = threadsMap.get(cid);
    const hint = nameHint != null && String(nameHint).trim() ? String(nameHint).trim() : '';
    if (hint) m.set(tid, hint);
    else if (!m.has(tid)) m.set(tid, `topic ${tid}`);
}

function _collectTelegramChatsFromMessageLike(msg, chatsMap, threadsMap) {
    if (!msg || !msg.chat) return;
    _telegramAddChatFromApi(chatsMap, msg.chat);
    const mtid = msg.message_thread_id;
    if (mtid != null) {
        let topicName = '';
        if (msg.forum_topic_created && msg.forum_topic_created.name) {
            topicName = String(msg.forum_topic_created.name);
        } else if (msg.forum_topic_edited && msg.forum_topic_edited.name) {
            topicName = String(msg.forum_topic_edited.name);
        }
        _telegramAddThread(threadsMap, msg.chat.id, mtid, topicName);
    }
}

function _processTelegramUpdateForChatList(upd, chatsMap, threadsMap) {
    if (!upd || typeof upd !== 'object') return;
    if (upd.message) _collectTelegramChatsFromMessageLike(upd.message, chatsMap, threadsMap);
    if (upd.edited_message) _collectTelegramChatsFromMessageLike(upd.edited_message, chatsMap, threadsMap);
    if (upd.channel_post) _collectTelegramChatsFromMessageLike(upd.channel_post, chatsMap, threadsMap);
    if (upd.edited_channel_post) _collectTelegramChatsFromMessageLike(upd.edited_channel_post, chatsMap, threadsMap);
    if (upd.callback_query && upd.callback_query.message) {
        _collectTelegramChatsFromMessageLike(upd.callback_query.message, chatsMap, threadsMap);
    }
    const cJoin = upd.my_chat_member && upd.my_chat_member.chat;
    if (cJoin) _telegramAddChatFromApi(chatsMap, cJoin);
    const cMem = upd.chat_member && upd.chat_member.chat;
    if (cMem) _telegramAddChatFromApi(chatsMap, cMem);
    const cReq = upd.chat_join_request && upd.chat_join_request.chat;
    if (cReq) _telegramAddChatFromApi(chatsMap, cReq);
}

/**
 * Чаты и темы форумов из одной порции getUpdates (до 100). Не вызывайте параллельно с другим long polling этим же ботом.
 * При активном webhook Telegram вернёт 409 — см. telegramErrorCode на ошибке (если пробросили).
 */
async function fetchTelegramChatsAndThreadsFromUpdates(botToken, proxyUrl) {
    const updates = await telegramBotGetUpdates(botToken, proxyUrl);
    const chatsMap = new Map();
    const threadsMap = new Map();
    for (const u of updates) {
        _processTelegramUpdateForChatList(u, chatsMap, threadsMap);
    }
    if (chatsMap.size) {
        await _enrichChatsMapWithGetChat(botToken, proxyUrl, chatsMap);
    }
    if (threadsMap.size) {
        await _enrichThreadsMapWithGetForumTopic(botToken, proxyUrl, threadsMap);
    }
    const chats = Array.from(chatsMap.values()).sort((a, b) =>
        a.label.localeCompare(b.label, undefined, { sensitivity: 'base' })
    );
    const threadsByChat = {};
    for (const [cid, tmap] of threadsMap) {
        threadsByChat[cid] = Array.from(tmap.entries())
            .map(([threadId, name]) => ({
                threadId,
                name: name != null && String(name).trim() ? String(name).trim() : `topic ${threadId}`
            }))
            .sort((a, b) => a.threadId - b.threadId);
    }
    return { updatesCount: updates.length, chats, threadsByChat };
}

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
        case 'smart_sensor_error':
            lines.push(escapeMarkdownV2(`Target: smart sensor id ${r.smartSensorId != null ? r.smartSensorId : '—'}`));
            break;
        case 'smart_sensor_threshold':
            lines.push(escapeMarkdownV2(`Target: smart sensor id ${r.smartSensorId != null ? r.smartSensorId : '—'}`));
            lines.push(escapeMarkdownV2(`Field: ${r.smartSensorFieldKey != null ? r.smartSensorFieldKey : '—'}`));
            lines.push(escapeMarkdownV2(`Compare: ${r.smartSensorCompare != null ? r.smartSensorCompare : 'gte'} ${r.smartSensorThreshold != null ? r.smartSensorThreshold : '—'}`));
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
    buildAxiosConfigForTelegram,
    fetchTelegramChatsAndThreadsFromUpdates
};
