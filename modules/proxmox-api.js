const axios = require('axios');
const https = require('https');
const { constants: cryptoConstants } = require('crypto');
const config = require('./config');
const { log } = require('./utils');

// Создаем HTTPS агент для игнорирования SSL ошибок
const httpsAgent = new https.Agent({
    rejectUnauthorized: false,
    // Proxmox чаще всего работает с современным TLS, но на старых Node/SSL стэках
    // явное отключение TLSv1/1.1 помогает избежать negotiation edge-cases.
    secureOptions: cryptoConstants.SSL_OP_NO_TLSv1 | cryptoConstants.SSL_OP_NO_TLSv1_1
});

// Базовый URL для API
const getBaseUrl = () => `https://${config.proxmox.host}:${config.proxmox.port}/api2/json`;

function normalizeToken(rawToken) {
    if (!rawToken) return null;
    let t = String(rawToken).trim();
    // Пользователи часто вставляют токен вместе с префиксом заголовка
    if (t.toLowerCase().startsWith('pveapitoken=')) {
        t = t.slice('pveapitoken='.length).trim();
    }
    // Некоторые форматы встречаются как user@realm!tokenid:secret
    if (!t.includes('=') && t.includes(':')) {
        const idx = t.indexOf(':');
        t = `${t.slice(0, idx)}=${t.slice(idx + 1)}`;
    }
    return t;
}

// Выполнение запроса к Proxmox API
async function request(endpoint, token, method = 'GET', data = null) {
    const url = `${getBaseUrl()}${endpoint}`;
    const normalizedToken = normalizeToken(token);
    
    log('debug', `Proxmox API Request: ${method} ${url}`);
    log('debug', `Token: ${normalizedToken ? normalizedToken.substring(0, 16) + '...' : 'none'}`);
    
    try {
        const response = await axios({
            method,
            url,
            headers: {
                ...(normalizedToken ? { 'Authorization': `PVEAPIToken=${normalizedToken}` } : {}),
                'Content-Type': 'application/json',
                'Accept': 'application/json'
            },
            httpsAgent,
            timeout: 10000,
            data,
            validateStatus: function (status) {
                return true; // Разбираем любые статусы сами, чтобы не терять тело ответа
            }
        });
        
        // Проверяем статус ответа
        if (response.status >= 400) {
            const err = new Error(
                response.status === 401
                    ? 'Unauthorized: Invalid token'
                    : response.status === 403
                        ? 'Forbidden: Insufficient permissions'
                        : `HTTP ${response.status}: ${response.statusText}`
            );
            // Сохраняем response, чтобы роуты могли корректно разобрать причину
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
        log('error', `Proxmox API Error: ${error.message}${status ? ` (HTTP ${status}${statusText ? ` ${statusText}` : ''})` : ''}`);
        if (dataPreview) log('error', `Proxmox API Error body (preview): ${dataPreview}`);
        
        // Пробрасываем ошибку дальше с понятным сообщением
        if (error.response) {
            // Не затираем исходную ошибку, иначе теряются детали (status/data)
            throw error;
        } else if (error.code === 'ECONNREFUSED') {
            const err = new Error('Connection refused');
            err.code = 'ECONNREFUSED';
            throw err;
        } else if (error.code === 'ENOTFOUND') {
            const err = new Error('Host not found');
            err.code = 'ENOTFOUND';
            throw err;
        } else if (error.code === 'ETIMEDOUT') {
            const err = new Error('Connection timeout');
            err.code = 'ETIMEDOUT';
            throw err;
        } else {
            throw error;
        }
    }
}

// Получение списка узлов
async function getNodes(token) {
    try {
        const data = await request('/nodes', token);
        return data.data || [];
    } catch (error) {
        log('error', `Error in getNodes: ${error.message}`);
        throw error;
    }
}

// Получение статуса узла
async function getNodeStatus(node, token) {
    try {
        const data = await request(`/nodes/${node}/status`, token);
        return data.data || {};
    } catch (error) {
        log('error', `Error in getNodeStatus for ${node}: ${error.message}`);
        throw error;
    }
}

// Получение статуса кластера
async function getClusterStatus(token) {
    try {
        const data = await request('/cluster/status', token);
        return data.data || [];
    } catch (error) {
        log('warn', `Could not fetch cluster status: ${error.message}`);
        return [];
    }
}

// Получение ресурсов кластера
async function getClusterResources(token) {
    try {
        const data = await request('/cluster/resources', token);
        return data.data || [];
    } catch (error) {
        log('warn', `Could not fetch cluster resources: ${error.message}`);
        return [];
    }
}

// Получение хранилищ узла
async function getNodeStorage(node, token) {
    try {
        const data = await request(`/nodes/${node}/storage`, token);
        return data.data || [];
    } catch (error) {
        log('warn', `Could not fetch storage for node ${node}: ${error.message}`);
        return [];
    }
}

// Получение заданий бэкапа кластера
async function getBackupJobs(token) {
    try {
        const data = await request('/cluster/backup', token);
        return data.data || [];
    } catch (error) {
        log('warn', `Could not fetch backup jobs: ${error.message}`);
        return [];
    }
}

// Получение задач кластера
async function getClusterTasks(token, limit = 20) {
    try {
        const data = await request(`/cluster/tasks?limit=${limit}`, token);
        return data.data || [];
    } catch (error) {
        log('warn', `Could not fetch cluster tasks: ${error.message}`);
        return [];
    }
}

module.exports = {
    request,
    getNodes,
    getNodeStatus,
    getClusterStatus,
    getClusterResources,
    getNodeStorage,
    getBackupJobs,
    getClusterTasks
};
