'use strict';

const crypto = require('crypto');
const cache = require('./cache');

/** Параллельные запросы с одним ключом ждут один и тот же fetch (аналог inflight TrueNAS). */
const inflight = new Map();

/**
 * Стабильный ключ кэша: URL + токен (нельзя свешивать разные Proxmox по одному токену).
 */
function cacheKeyFromReq(prefix, req) {
    const url = String((req && req.serverUrl) || '').trim();
    const tok = String((req && req.token) || '').trim();
    const h = crypto.createHash('sha256').update(`${url}\n${tok}`).digest('hex').slice(0, 20);
    return `${prefix}_${h}`;
}

/**
 * Вернуть кэш или вычислить один раз; параллельные вызовы объединяются.
 * @param {string} prefix
 * @param {object} req
 * @param {() => Promise<object>} compute
 */
async function getCachedOrFetch(prefix, req, compute) {
    const key = cacheKeyFromReq(prefix, req);
    const hit = cache.get(key);
    if (hit !== undefined && hit !== null) {
        return hit;
    }
    let wait = inflight.get(key);
    if (!wait) {
        wait = (async () => {
            try {
                const data = await compute();
                cache.set(key, data);
                return data;
            } finally {
                inflight.delete(key);
            }
        })();
        inflight.set(key, wait);
    }
    return wait;
}

module.exports = { cacheKeyFromReq, getCachedOrFetch };
