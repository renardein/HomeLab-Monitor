const axios = require('axios');
const https = require('https');
const { constants: cryptoConstants } = require('crypto');
const config = require('./config');
const { log } = require('./utils');

const httpsAgent = new https.Agent({
    rejectUnauthorized: false,
    secureOptions: cryptoConstants.SSL_OP_NO_TLSv1 | cryptoConstants.SSL_OP_NO_TLSv1_1
});

function getBaseUrl(serverUrl) {
    if (serverUrl) {
        const u = new URL(serverUrl);
        const port = u.port ? `:${u.port}` : '';
        return `${u.protocol}//${u.hostname}${port}/api/v2.0`;
    }
    const host = config.truenas?.host;
    const port = config.truenas?.port;
    return `https://${host}:${port}/api/v2.0`;
}

async function request(endpoint, apiKey, method = 'GET', data = null, serverUrl = null) {
    const url = `${getBaseUrl(serverUrl)}${endpoint}`;
    const normalizedKey = apiKey ? String(apiKey).trim() : null;

    log('debug', `TrueNAS API Request: ${method} ${url}`);
    log('debug', `Key: ${normalizedKey ? normalizedKey.substring(0, 8) + '...' : 'none'}`);

    try {
        const axiosConfig = {
            method,
            url,
            headers: {
                ...(normalizedKey ? { 'Authorization': `Bearer ${normalizedKey}` } : {}),
                'Accept': 'application/json'
            },
            httpsAgent,
            timeout: 10000,
            validateStatus: () => true
        };

        const upperMethod = String(method || 'GET').toUpperCase();
        if (data !== null && data !== undefined && upperMethod !== 'GET' && upperMethod !== 'HEAD') {
            axiosConfig.data = data;
            axiosConfig.headers['Content-Type'] = 'application/json';
        }

        const response = await axios(axiosConfig);

        if (response.status >= 400) {
            const err = new Error(`HTTP ${response.status}: ${response.statusText}`);
            err.response = response;
            throw err;
        }

        return response.data;
    } catch (error) {
        const status = error?.response?.status;
        const statusText = error?.response?.statusText;
        const dataPreview = (() => {
            const d = error?.response?.data;
            if (!d) return null;
            if (typeof d === 'string') return d.slice(0, 500);
            try { return JSON.stringify(d).slice(0, 500); } catch { return '[unserializable]'; }
        })();

        log('error', `TrueNAS API Error: ${error.message}${status ? ` (HTTP ${status}${statusText ? ` ${statusText}` : ''})` : ''}`);
        if (dataPreview) log('error', `TrueNAS API Error body (preview): ${dataPreview}`);

        if (error.response) throw error;
        if (error.code === 'ECONNREFUSED') {
            const err = new Error('Connection refused');
            err.code = 'ECONNREFUSED';
            throw err;
        }
        if (error.code === 'ENOTFOUND') {
            const err = new Error('Host not found');
            err.code = 'ENOTFOUND';
            throw err;
        }
        if (error.code === 'ETIMEDOUT') {
            const err = new Error('Connection timeout');
            err.code = 'ETIMEDOUT';
            throw err;
        }
        throw error;
    }
}

async function getSystemInfo(apiKey, serverUrl = null) {
    let raw;
    try {
        raw = await request('/system/info', apiKey, 'GET', null, serverUrl);
    } catch (e) {
        if (e?.response?.status === 404) {
            const ver = await request('/system/version', apiKey, 'GET', null, serverUrl);
            raw = typeof ver === 'string' ? { version: ver } : (ver || {});
        } else {
            throw e;
        }
    }
    const hostname = raw?.hostname ?? raw?.system_hostname ?? raw?.host ?? null;
    const version = raw?.version ?? raw?.product_version ?? raw?.release ?? raw?.full_version ?? null;
    let uptime = raw?.uptime ?? raw?.uptime_seconds ?? null;
    if (typeof uptime === 'string' && /^\d+$/.test(uptime)) uptime = parseInt(uptime, 10);
    return {
        ...raw,
        hostname,
        version,
        uptime: typeof uptime === 'number' ? uptime : uptime
    };
}

function parseIntLike(x) {
    if (x === null || x === undefined) return null;
    if (typeof x === 'number') return Number.isFinite(x) ? x : null;
    const n = parseFloat(String(x));
    return Number.isFinite(n) ? n : null;
}

function extractBytes(value) {
    // TrueNAS often returns objects like { rawvalue: 123, value: "1 GiB" } or plain numbers
    if (value === null || value === undefined) return null;
    if (typeof value === 'number') return value;
    if (typeof value === 'object') {
        if (typeof value.rawvalue === 'number') return value.rawvalue;
        if (typeof value.parsed === 'number') return value.parsed;
        if (typeof value.value === 'number') return value.value;
    }
    return parseIntLike(value);
}

function parsePoolList(data) {
    if (Array.isArray(data)) return data;
    if (data && typeof data === 'object' && Array.isArray(data.pools)) return data.pools;
    if (data && typeof data === 'object' && Array.isArray(data.pool)) return data.pool;
    return [];
}

async function getPools(apiKey, serverUrl = null) {
    let poolList = [];
    try {
        const data = await request('/pool', apiKey, 'GET', null, serverUrl);
        poolList = parsePoolList(data);
    } catch (e) {
        if (e?.response?.status === 404) {
            try {
                const dsList = await request('/pool/dataset', apiKey, 'GET', null, serverUrl);
                const arr = Array.isArray(dsList) ? dsList : (dsList && typeof dsList === 'object' ? (dsList.pool_dataset || dsList.pool || Object.values(dsList).find(Array.isArray) || []) : []);
                const rootOnly = arr.filter(d => d && typeof d === 'object' && (d.name || d.id) && !String(d.name || d.id || '').includes('/'));
                poolList = (rootOnly.length ? rootOnly : arr).map(d => ({ name: d.name || d.id, id: d.id || d.name, healthy: d.healthy, status: d.status }));
            } catch {
                return [];
            }
        } else {
            throw e;
        }
    }

    const results = await Promise.all(poolList.map(async (p) => {
        const name = p?.name || p?.id;
        if (!name) return null;

        let used = null;
        let available = null;
        let total = null;

        try {
            const idEnc = encodeURIComponent(String(name));
            const ds = await request(`/pool/dataset/id/${idEnc}`, apiKey, 'GET', null, serverUrl);
            used = extractBytes(ds?.used);
            available = extractBytes(ds?.available);
            if (used !== null && available !== null) total = used + available;
        } catch (e) {
            const size = extractBytes(p?.size);
            const alloc = extractBytes(p?.allocated);
            if (size !== null) total = size;
            if (alloc !== null) used = alloc;
            if (total !== null && used !== null) available = Math.max(0, total - used);
        }

        return {
            name: String(name),
            id: String(name),
            healthy: p?.healthy ?? null,
            status: p?.status ?? null,
            used,
            available,
            total
        };
    }));

    return results.filter(Boolean);
}

module.exports = {
    request,
    getSystemInfo,
    getPools
};

