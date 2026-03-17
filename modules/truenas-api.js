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
    // CORE + SCALE both expose /system/info; keep fallback for older variants.
    try {
        return await request('/system/info', apiKey, 'GET', null, serverUrl);
    } catch (e) {
        if (e?.response?.status === 404) {
            return {
                version: await request('/system/version', apiKey, 'GET', null, serverUrl)
            };
        }
        throw e;
    }
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

async function getPools(apiKey, serverUrl = null) {
    const pools = await request('/pool', apiKey, 'GET', null, serverUrl);
    if (!Array.isArray(pools)) return [];

    const results = await Promise.all(pools.map(async (p) => {
        const name = p?.name || p?.id;
        if (!name) return null;

        // Prefer dataset info for accurate used/available.
        let used = null;
        let available = null;
        let total = null;

        try {
            const ds = await request(`/pool/dataset/id/${encodeURIComponent(name)}`, apiKey, 'GET', null, serverUrl);
            used = extractBytes(ds?.used);
            available = extractBytes(ds?.available);
            if (used !== null && available !== null) total = used + available;
        } catch (e) {
            // fallback: try pool object fields
            const size = extractBytes(p?.size);
            const alloc = extractBytes(p?.allocated);
            if (size !== null) total = size;
            if (alloc !== null) used = alloc;
            if (total !== null && used !== null) available = Math.max(0, total - used);
        }

        return {
            name,
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

