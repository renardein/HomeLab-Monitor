const axios = require('axios');
const https = require('https');
const config = require('./config');
const { log } = require('./utils');

// Создаем HTTPS агент для игнорирования SSL ошибок
const httpsAgent = new https.Agent({
    rejectUnauthorized: false,
    secureOptions: require('constants').SSL_OP_NO_TLSv1 | require('constants').SSL_OP_NO_TLSv1_1
});

// Базовый URL для API
const getBaseUrl = () => `https://${config.proxmox.host}:${config.proxmox.port}/api2/json`;

// Выполнение запроса к Proxmox API
async function request(endpoint, token, method = 'GET', data = null) {
    const url = `${getBaseUrl()}${endpoint}`;
    
    log('debug', `Proxmox API Request: ${method} ${url}`);
    log('debug', `Token: ${token ? token.substring(0, 20) + '...' : 'none'}`);
    
    try {
        const response = await axios({
            method,
            url,
            headers: {
                'Authorization': `PVEAPIToken=${token}`,
                'Content-Type': 'application/json',
                'Accept': 'application/json'
            },
            httpsAgent,
            timeout: 10000,
            validateStatus: function (status) {
                return status >= 200 && status < 500; // Не кидаем ошибку на 401/403
            }
        });
        
        // Проверяем статус ответа
        if (response.status === 401) {
            throw new Error('Unauthorized: Invalid token');
        } else if (response.status === 403) {
            throw new Error('Forbidden: Insufficient permissions');
        } else if (response.status >= 400) {
            throw new Error(`HTTP ${response.status}: ${response.statusText}`);
        }
        
        return response.data;
    } catch (error) {
        log('error', `Proxmox API Error: ${error.message}`);
        
        // Пробрасываем ошибку дальше с понятным сообщением
        if (error.response) {
            throw new Error(`API error: ${error.response.status}`);
        } else if (error.code === 'ECONNREFUSED') {
            throw new Error('Connection refused');
        } else if (error.code === 'ENOTFOUND') {
            throw new Error('Host not found');
        } else if (error.code === 'ETIMEDOUT') {
            throw new Error('Connection timeout');
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
