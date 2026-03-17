// Global variables
let apiToken = null;
let autoRefreshInterval = null;
let storageTable = null;
let backupsTable = null;
let currentLanguage = 'ru';
let refreshIntervalMs = 30000; // Default refresh interval
let currentTheme = 'light';
let currentUnits = 'decimal'; // 'decimal' (GB) or 'binary' (GiB)
let demoMode = false; // Demo mode flag
let monitorMode = false; // Monitor (display) mode flag
let thresholds = {
    cpuGreen: 70,
    cpuYellow: 90,
    ramGreen: 70,
    ramYellow: 90
};
let proxmoxServers = ['https://192.168.1.1:8006']; // List of Proxmox servers
let currentServerIndex = 0; // Current server index

// Client-side translations (will be loaded from server)
let translations = {
    ru: {},
    en: {}
};

// Load translations from server
async function loadTranslations() {
    try {
        const response = await fetch('/api/translations');
        const data = await response.json();
        if (data.translations) {
            translations = data.translations;
        }
    } catch (error) {
        console.error('Failed to load translations:', error);
    }
}

function t(key) {
    return translations[currentLanguage]?.[key] || translations.ru[key] || key;
}

// Language switch function
function setLanguage(lang) {
    currentLanguage = lang;
    
    document.querySelectorAll('.language-switcher').forEach(btn => {
        btn.classList.remove('active');
        if (btn.dataset.lang === lang) {
            btn.classList.add('active');
        }
    });
    
    localStorage.setItem('preferred_language', lang);
    updateUILanguage();
    
    // Re-render server list to update translated tooltips and text
    renderServerList();
    
    if (storageTable) {
        storageTable.destroy();
        storageTable = null;
    }
    if (backupsTable) {
        backupsTable.destroy();
        backupsTable = null;
    }
}

// Render language switcher buttons dynamically
function renderLanguageSwitchers() {
    const container = document.querySelector('.language-switcher-container');
    if (!container) return;
    
    container.innerHTML = '';
    
    availableLanguages.forEach(langCode => {
        const btn = document.createElement('button');
        btn.className = `btn btn-sm language-switcher${currentLanguage === langCode ? ' active' : ''}`;
        btn.dataset.lang = langCode;
        btn.textContent = langCode.toUpperCase();
        btn.onclick = () => setLanguage(langCode);
        container.appendChild(btn);
    });
}

// Update all UI texts
function updateUILanguage() {
    const elements = {
        pageTitle: 'appName',
        appName: 'appName',
        serverStatusText: 'serverWorking',
        settingsText: 'settings',
        settingsTitle: 'settingsTitle',
        connectTitle: 'connectTitle',
        connectDesc: 'connectDesc',
        tokenLabel: 'tokenLabel',
        tokenHint: 'tokenHint',
        connectButton: 'connectButton',
        clusterState: 'appName',
        notConnectedText: 'notConnected',
        refreshText: 'refresh',
        loadingText: 'loading',
        totalNodesLabel: 'totalNodes',
        onlineNodesLabel: 'nodesOnline',
        quorumLabel: 'quorum',
        clusterResources: 'clusterResources',
        cpuLabel: 'cpu',
        memoryLabel: 'memory',
        virtualizationLabel: 'virtualization',
        tabNodes: 'tabNodes',
        tabStorage: 'tabStorage',
        tabBackups: 'tabBackups',
        tabQuorum: 'tabQuorum',
        displaySettings: 'displaySettings',
        refreshIntervalLabel: 'refreshIntervalLabel',
        themeLabel: 'themeLabel',
        unitsLabel: 'unitsLabel',
        thresholdSettings: 'thresholdSettings',
        cpuGreenLabel: 'cpuGreenLabel',
        cpuYellowLabel: 'cpuYellowLabel',
        ramGreenLabel: 'ramGreenLabel',
        ramYellowLabel: 'ramYellowLabel',
        resetThresholds: 'resetThresholds',
        storageNodeHeader: 'storageNode',
        storageNameHeader: 'storageName',
        storageTypeHeader: 'storageType',
        storageStatusHeader: 'storageStatus',
        storageUsedHeader: 'storageUsed',
        storageTotalHeader: 'storageTotalSize',
        storageUsageHeader: 'storageUsage',
        storageDetailsHeader: 'storageDetails',
        backupIdHeader: 'backupId',
        backupScheduleHeader: 'backupSchedule',
        backupStatusHeader: 'backupStatus',
        backupStorageHeader: 'backupStorage',
        backupVmidHeader: 'backupVmid',
        backupModeHeader: 'backupMode',
        backupLastRunHeader: 'backupLastRun',
        backupResultHeader: 'backupResult',
        backupNextRunHeader: 'backupNextRun',
        rememberLabel: 'rememberLabel',
        logoutText: 'logoutText',
        // New connection settings
        connectionSettings: 'connectionSettings',
        apiTokenLabel: 'apiTokenLabel',
        testConnectionBtn: 'testConnectionBtn',
        connectionStatusConnected: 'connectionStatusConnected',
        connectionStatusDisconnected: 'connectionStatusDisconnected',
        proxmoxServersLabel: 'proxmoxServersLabel',
        proxmoxServersHint: 'proxmoxServersHint',
        addServer: 'addServer',
        removeServer: 'removeServer',
        currentServer: 'currentServer'
    };
    
    for (const [id, key] of Object.entries(elements)) {
        const el = document.getElementById(id);
        if (el) el.textContent = t(key);
    }
    
    // Update theme and units button texts
    document.getElementById('themeLight').innerHTML = '<i class="bi bi-sun me-1"></i> ' + t('themeLight');
    document.getElementById('themeDark').innerHTML = '<i class="bi bi-moon me-1"></i> ' + t('themeDark');
    document.getElementById('unitsDecimal').textContent = t('unitsDecimal');
    document.getElementById('unitsBinary').textContent = t('unitsBinary');
}

// Available languages (will be populated from server)
let availableLanguages = ['ru', 'en'];

// Load available languages from server and initialize
document.addEventListener('DOMContentLoaded', async function() {
    console.log('DOM loaded');
    
    // Load translations and available languages from server
    await loadTranslations();
    
    // Load available languages from server
    try {
        const response = await fetch('/api/languages');
        const data = await response.json();
        if (data.available && data.available.length > 0) {
            availableLanguages = data.available;
            renderLanguageSwitchers();
        }
    } catch (error) {
        console.error('Failed to load languages:', error);
    }
    
    const savedLang = localStorage.getItem('preferred_language');
    if (savedLang && availableLanguages.includes(savedLang)) {
        setLanguage(savedLang);
    } else {
        setLanguage(availableLanguages[0] || 'ru');
    }
    
    // Load saved settings
    loadSettings();
    
    checkSavedToken();
    checkServerStatus();
    updateCurrentServerBadge();
});

// Check saved token
async function checkSavedToken() {
    try {
        const response = await fetch('/api/auth/token');
        const data = await response.json();
        
        if (data.success && data.token) {
            apiToken = data.token;
            document.getElementById('apiToken').value = '••••••••••••••••';
            document.getElementById('rememberToken').checked = true;
            document.getElementById('logoutContainer').style.display = 'block';
            
            showToast(t('tokenFound'), 'info');
            testTokenAndConnect(data.token);
        }
    } catch (error) {
        console.log('No saved token found');
    }
}

// Test token and connect
async function testTokenAndConnect(token) {
    try {
        const response = await fetch('/api/auth/test', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ token, remember: false })
        });
        
        const data = await response.json();
        
        if (data.success) {
            showToast(t('connectSuccess'), 'success');
            apiToken = token;
            showDashboard();
        }
    } catch (error) {
        console.log('Token test failed');
    }
}

// Logout function
async function logout() {
    try {
        const response = await fetch('/api/auth/logout', {
            method: 'POST'
        });
        
        const data = await response.json();
        
        if (data.success) {
            showToast(t('logoutSuccess'), 'success');
            apiToken = null;
            document.getElementById('apiToken').value = '';
            document.getElementById('logoutContainer').style.display = 'none';
            showConfig();
        }
    } catch (error) {
        showToast('Ошибка при выходе: ' + error.message, 'error');
    }
}

// Check server status
async function checkServerStatus() {
    try {
        const response = await fetch('/api/status');
        const data = await response.json();
        document.getElementById('serverStatus').innerHTML = 
            '<i class="bi bi-check-circle"></i> <span id="serverStatusText">' + t('serverWorking') + '</span>';
    } catch (error) {
        document.getElementById('serverStatus').innerHTML = 
            '<i class="bi bi-exclamation-circle"></i> <span id="serverStatusText">' + t('serverError') + '</span>';
    }
}

// Show notification
function showToast(message, type = 'info') {
    const toastContainer = document.getElementById('toastContainer');
    const toastId = 'toast-' + Date.now();
    
    const colors = {
        success: '#28a745',
        error: '#dc3545',
        warning: '#ffc107',
        info: '#17a2b8'
    };
    
    const icons = {
        success: 'bi-check-circle-fill',
        error: 'bi-exclamation-circle-fill',
        warning: 'bi-exclamation-triangle-fill',
        info: 'bi-info-circle-fill'
    };
    
    const typeNames = {
        success: t('toastSuccess'),
        error: t('toastError'),
        warning: t('toastWarning'),
        info: t('toastInfo')
    };
    
    const toast = document.createElement('div');
    toast.className = 'toast show align-items-center border-0';
    toast.id = toastId;
    toast.style.borderLeft = '4px solid ' + (colors[type] || colors.info);
    toast.innerHTML = `
        <div class="d-flex">
            <div class="toast-body">
                <i class="bi ${icons[type]} me-2"></i>
                <strong>${typeNames[type]}:</strong> ${message}
            </div>
            <button type="button" class="btn-close me-2 m-auto" onclick="this.closest('.toast').remove()"></button>
        </div>
    `;
    
    toastContainer.appendChild(toast);
    
    setTimeout(() => {
        const toast = document.getElementById(toastId);
        if (toast) toast.remove();
    }, 5000);
}

// Show settings section
function showConfig() {
    document.getElementById('configSection').style.display = 'block';
    document.getElementById('dashboardSection').style.display = 'none';
    if (autoRefreshInterval) {
        clearInterval(autoRefreshInterval);
        autoRefreshInterval = null;
    }
}

// Toggle settings visibility
function toggleSettings() {
    const configSection = document.getElementById('configSection');
    const dashboardSection = document.getElementById('dashboardSection');
    
    if (configSection.style.display === 'none' || configSection.style.display === '') {
        configSection.style.display = 'block';
        dashboardSection.style.display = 'none';
        if (autoRefreshInterval) {
            clearInterval(autoRefreshInterval);
            autoRefreshInterval = null;
        }
    } else {
        configSection.style.display = 'none';
        dashboardSection.style.display = 'block';
        if (apiToken) {
            refreshData();
            startAutoRefresh();
        }
    }
}

// Toggle demo mode
function toggleDemoMode() {
    demoMode = !demoMode;
    localStorage.setItem('demoMode', demoMode);
    
    const btn = document.getElementById('demoModeBtn');
    if (demoMode) {
        btn.classList.add('active');
        btn.classList.remove('btn-outline-success');
        btn.classList.add('btn-success');
        btn.innerHTML = '<i class="bi bi-check-lg"></i> <span id="demoModeText">Демо ВКЛ</span>';
    } else {
        btn.classList.remove('active');
        btn.classList.remove('btn-success');
        btn.classList.add('btn-outline-success');
        btn.innerHTML = '<i class="bi bi-mask"></i> <span id="demoModeText">Демо</span>';
    }
    
    // Always refresh when toggling demo mode
    refreshData();
}

// Toggle monitor mode
function toggleMonitorMode() {
    monitorMode = !monitorMode;
    localStorage.setItem('monitorMode', monitorMode);
    
    document.body.classList.toggle('monitor-mode', monitorMode);
    
    const btn = document.getElementById('monitorModeBtn');
    if (monitorMode) {
        btn.classList.add('active');
        btn.classList.remove('btn-outline-info');
        btn.classList.add('btn-info');
        btn.innerHTML = '<i class="bi bi-check-lg"></i> <span id="monitorModeText">Монитор ВКЛ</span>';
    } else {
        btn.classList.remove('active');
        btn.classList.remove('btn-info');
        btn.classList.add('btn-outline-info');
        btn.innerHTML = '<i class="bi bi-display"></i> <span id="monitorModeText">Монитор</span>';
    }
    
    // Refresh data when entering/exiting monitor mode
    if (demoMode) {
        refreshData();
    }
}

// Show dashboard
function showDashboard() {
    document.getElementById('configSection').style.display = 'none';
    document.getElementById('dashboardSection').style.display = 'block';
    // Always refresh data in demo mode or if we have a token
    if (demoMode || apiToken) {
        refreshData();
        if (apiToken) {
            startAutoRefresh();
        }
    }
}

// Start auto refresh
function startAutoRefresh() {
    if (autoRefreshInterval) clearInterval(autoRefreshInterval);
    autoRefreshInterval = setInterval(refreshData, refreshIntervalMs);
}

// Connect
async function connect() {
    const token = document.getElementById('apiToken').value.trim();
    const rememberToken = document.getElementById('rememberToken')?.checked || true;
    
    // Allow connecting without token if demo mode is active
    if (!token && !demoMode) {
        showToast(t('tokenRequired'), 'error');
        return;
    }

    const connectBtn = document.getElementById('connectBtn');
    const originalText = connectBtn.innerHTML;
    connectBtn.disabled = true;
    connectBtn.innerHTML = '<span class="spinner-border spinner-border-sm me-2"></span>' + t('loading');
    
    try {
        // Skip API test if in demo mode
        if (demoMode && !token) {
            showToast(t('connectSuccess'), 'success');
            updateConnectionStatus(true);
            showDashboard();
            connectBtn.disabled = false;
            connectBtn.innerHTML = originalText;
            return;
        }
        
        const response = await fetch('/api/auth/test', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ token, remember: rememberToken })
        });
        
        const data = await response.json();
        
        if (data.success) {
            showToast(t('connectSuccess'), 'success');
            apiToken = token;
            document.getElementById('logoutContainer').style.display = 'block';
            updateConnectionStatus(true);
            showDashboard();
        } else {
            showToast(t('connectError') + ': ' + data.error, 'error');
            updateConnectionStatus(false);
        }
    } catch (error) {
        showToast(t('connectError') + ': ' + error.message, 'error');
        updateConnectionStatus(false);
    } finally {
        connectBtn.disabled = false;
        connectBtn.innerHTML = originalText;
    }
}

// Test connection
async function testConnection() {
    const token = document.getElementById('apiToken').value.trim();
    
    // Allow testing in demo mode without token
    if (!token && !demoMode) {
        showToast(t('tokenRequired'), 'warning');
        updateConnectionStatus(false);
        return;
    }
    
    // In demo mode without token, simulate successful connection
    if (demoMode && !token) {
        showToast(t('connectionStatusConnected'), 'success');
        updateConnectionStatus(true);
        return;
    }
    
    const testBtn = document.getElementById('testConnectionBtn');
    const originalText = testBtn.innerHTML;
    testBtn.disabled = true;
    testBtn.innerHTML = '<span class="spinner-border spinner-border-sm me-2"></span>' + t('loading');
    
    try {
        const response = await fetch('/api/auth/test', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ token, remember: false })
        });
        
        const data = await response.json();
        
        if (data.success) {
            showToast(t('connectionStatusConnected'), 'success');
            updateConnectionStatus(true);
        } else {
            showToast(t('connectionStatusDisconnected') + ': ' + data.error, 'error');
            updateConnectionStatus(false);
        }
    } catch (error) {
        showToast(t('connectionStatusDisconnected') + ': ' + error.message, 'error');
        updateConnectionStatus(false);
    } finally {
        testBtn.disabled = false;
        testBtn.innerHTML = originalText;
    }
}

// Update connection status
function updateConnectionStatus(connected) {
    const statusDisplay = document.getElementById('connectionStatusDisplay');
    const statusBadge = document.getElementById('connectionStatusBadge');
    const statusText = document.getElementById('connectionStatusText');
    
    if (statusDisplay && statusBadge && statusText) {
        statusDisplay.style.display = 'block';
        
        if (connected) {
            statusBadge.className = 'badge bg-success';
            statusText.textContent = t('connectionStatusConnected');
        } else {
            statusBadge.className = 'badge bg-danger';
            statusText.textContent = t('connectionStatusDisconnected');
        }
    }
}

// Refresh data
async function refreshData() {
    // Demo mode - use fake data for the entire application
    if (demoMode) {
        showLoading(true);
        const demoClusterData = {
            nodes: [
                { node: 'pve1', level: '', id: 'node/pve1', maxdisk: 500000000000, disk: 200000000000, maxmem: 32000000000, mem: 16000000000, maxcpu: 8, cpu: 0.25, uptime: 864000, status: 'online', name: 'pve1' },
                { node: 'pve2', level: '', id: 'node/pve2', maxdisk: 500000000000, disk: 250000000000, maxmem: 32000000000, mem: 20000000000, maxcpu: 8, cpu: 0.45, uptime: 764000, status: 'online', name: 'pve2' },
                { node: 'pve3', level: '', id: 'node/pve3', maxdisk: 500000000000, disk: 180000000000, maxmem: 32000000000, mem: 12000000000, maxcpu: 8, cpu: 0.15, uptime: 964000, status: 'online', name: 'pve3' }
            ],
            cluster: {
                summary: {
                    totalCPU: 24,
                    usedCPU: 10.2,
                    cpuUsagePercent: 42,
                    totalMemory: 96000000000,
                    usedMemory: 48000000000,
                    memoryUsagePercent: 50,
                    totalVMs: 12,
                    totalContainers: 8
                }
            },
            quorum: {
                votes: 3,
                expected: 3,
                quorum: 2,
                nodes: [
                    { name: 'pve1', online: true, votes: 1 },
                    { name: 'pve2', online: true, votes: 1 },
                    { name: 'pve3', online: true, votes: 1 }
                ]
            }
        };
        
        // Demo storage data - formatted correctly for updateStorageUI
        const demoStorageData = {
            all: [
                { node: 'pve1', name: 'local', type: 'dir', server: null, export: null, used: 200000000000, total: 500000000000, used_fmt: '200 GB', total_fmt: '500 GB', usage_percent: 40, content: ['images', 'vztmpl', 'iso'], active: true, shared: false },
                { node: 'pve1', name: 'local-lvm', type: 'lvmthin', server: null, export: null, used: 180000000000, total: 450000000000, used_fmt: '180 GB', total_fmt: '450 GB', usage_percent: 40, content: ['images', 'rootdir'], active: true, shared: false },
                { node: 'pve2', name: 'nfs-backup', type: 'nfs', server: '192.168.1.100', export: '/backup', used: 450000000000, total: 1000000000000, used_fmt: '450 GB', total_fmt: '1 TB', usage_percent: 45, content: ['images', 'vztmpl', 'backup'], active: true, shared: true },
                { node: 'pve3', name: 'ceph-pool', type: 'rbd', server: null, export: null, used: 800000000000, total: 2000000000000, used_fmt: '800 GB', total_fmt: '2 TB', usage_percent: 40, content: ['images'], active: true, shared: true }
            ],
            byType: {
                dir: { count: 1, total: 500000000000, used: 200000000000 },
                lvmthin: { count: 1, total: 450000000000, used: 180000000000 },
                nfs: { count: 1, total: 1000000000000, used: 450000000000 },
                rbd: { count: 1, total: 2000000000000, used: 800000000000 }
            },
            summary: {
                total: 4,
                active: 4,
                total_space: 3950000000000,
                used_space: 1630000000000,
                total_space_fmt: '3.95 TB',
                used_space_fmt: '1.63 TB'
            }
        };
        
        // Demo backup jobs data - formatted correctly for updateBackupsUI
        const now = Date.now();
        const demoBackupsData = {
            jobs: [
                { 
                    id: 'backup-job-1', 
                    enable: 1, 
                    enabled: true,
                    schedule: 'daily', 
                    storage: 'nfs-backup', 
                    vmid: '100,101,102', 
                    mode: 'snapshot',
                    last_run: { starttime_fmt: new Date(now - 86400000).toLocaleString(), status: 'OK', exitstatus: 'OK' },
                    lastResult: 'OK',
                    next_run: new Date(now + 3600000).toLocaleString(),
                    status: 'success'
                },
                { 
                    id: 'backup-job-2', 
                    enable: 1, 
                    enabled: true,
                    schedule: 'weekly', 
                    storage: 'nfs-backup', 
                    vmid: '200,201', 
                    mode: 'suspend',
                    last_run: { starttime_fmt: new Date(now - 604800000).toLocaleString(), status: 'OK', exitstatus: 'OK' },
                    lastResult: 'OK',
                    next_run: new Date(now + 172800000).toLocaleString(),
                    status: 'success'
                },
                { 
                    id: 'backup-job-3', 
                    enable: 0, 
                    enabled: false,
                    schedule: 'daily', 
                    storage: 'local', 
                    vmid: '300', 
                    mode: 'snapshot',
                    last_run: { starttime_fmt: new Date(now - 172800000).toLocaleString(), status: 'ERROR', exitstatus: 'FAILED' },
                    lastResult: 'ERROR',
                    next_run: null,
                    status: 'error'
                }
            ],
            stats: {
                total: 3,
                enabled: 2,
                disabled: 1,
                success: 2,
                error: 1,
                running: 0
            }
        };
        
        // Demo data
        updateDashboard(demoClusterData, demoStorageData, demoBackupsData, {});
        showLoading(false);
        return;
    }
    
    if (!apiToken) {
        try {
            const tokenResponse = await fetch('/api/auth/token');
            const tokenData = await tokenResponse.json();
            
            if (tokenData.success) {
                apiToken = tokenData.token;
            } else {
                showToast(t('errorNoToken'), 'error');
                return;
            }
        } catch (error) {
            showToast(t('errorNoToken'), 'error');
            return;
        }
    }

    showLoading(true);

    try {
        const [clusterRes, storageRes, backupsRes] = await Promise.all([
            fetch('/api/cluster/full', { headers: { 'Authorization': apiToken } }),
            fetch('/api/storage', { headers: { 'Authorization': apiToken } }),
            fetch('/api/backups/jobs', { headers: { 'Authorization': apiToken } })
        ]);

        const clusterData = await clusterRes.json();
        const storageData = await storageRes.json();
        const backupsData = await backupsRes.json();
        
        updateDashboard(clusterData, storageData, backupsData, {});
        showToast(t('dataUpdated'), 'success');

    } catch (error) {
        showToast(t('errorUpdate') + ': ' + error.message, 'error');
    } finally {
        showLoading(false);
    }
}

// Show/hide loading
function showLoading(show) {
    document.getElementById('loadingIndicator').style.display = show ? 'block' : 'none';
    document.getElementById('refreshBtn').disabled = show;
}

// Format time
function formatUptime(seconds) {
    if (!seconds || seconds === 0) return 'N/A';
    const days = Math.floor(seconds / 86400);
    const hours = Math.floor((seconds % 86400) / 3600);
    const minutes = Math.floor((seconds % 3600) / 60);
    
    if (days > 0) return `${days}${t('days')} ${hours}${t('hours')}`;
    if (hours > 0) return `${hours}${t('hours')} ${minutes}${t('minutes')}`;
    return `${minutes}${t('minutes')}`;
}

// Format bytes
function formatBytes(bytes) {
    if (!bytes || bytes === 0) return '0 B';
    const units = ['B', 'KB', 'MB', 'GB', 'TB'];
    let value = bytes;
    let unitIndex = 0;
    while (value >= 1024 && unitIndex < units.length - 1) {
        value /= 1024;
        unitIndex++;
    }
    return `${value.toFixed(1)} ${units[unitIndex]}`;
}

// Update dashboard
function updateDashboard(clusterData, storageData, backupsData) {
    const totalNodes = clusterData.nodes.length;
    const onlineNodes = clusterData.nodes.filter(n => n.status === 'online').length;
    
    document.getElementById('totalNodes').textContent = totalNodes;
    document.getElementById('onlineNodes').textContent = onlineNodes;
    
    const quorumOk = onlineNodes >= clusterData.quorum.quorum;
    document.getElementById('quorumStatus').innerHTML = quorumOk ? 
        t('quorumEnough') : t('quorumNotEnough');
    document.getElementById('quorumStatus').className = 'stat-value ' + (quorumOk ? 'text-success' : 'text-warning');

    document.getElementById('connectionStatus').innerHTML = 
        '<i class="bi bi-check-circle-fill text-success"></i> ' + t('connected');

    const summary = clusterData.cluster.summary;
    document.getElementById('clusterCpu').textContent = summary.cpuUsagePercent + '%';
    document.getElementById('clusterCpuDetail').textContent = `${Math.round(summary.usedCPU)}/${summary.totalCPU} ${t('cores')}`;
    document.getElementById('clusterCpuBar').style.width = summary.cpuUsagePercent + '%';
    
    document.getElementById('clusterMemory').textContent = summary.memoryUsagePercent + '%';
    document.getElementById('clusterMemoryDetail').textContent = `${summary.usedMemory}/${summary.totalMemory}`;
    document.getElementById('clusterMemoryBar').style.width = summary.memoryUsagePercent + '%';
    
    document.getElementById('clusterVms').textContent = summary.totalVMs || 0;
    document.getElementById('clusterContainers').textContent = (summary.totalContainers || 0) + ' ' + t('containers');

    const nodesContainer = document.getElementById('nodesContainer');
    nodesContainer.innerHTML = clusterData.nodes.map(node => {
        return `
            <div class="col-md-6 col-lg-3">
                <div class="node-card">
                    <div class="d-flex justify-content-between align-items-center mb-3">
                        <h5 class="mb-0">${node.name}</h5>
                        <span class="badge ${node.status === 'online' ? 'bg-success' : 'bg-danger'}">
                            ${node.status === 'online' ? t('nodeOnline') : t('nodeOffline')}
                        </span>
                    </div>
                    <div class="row g-2">
                        <div class="col-6">
                            <small class="text-muted">${t('nodeCpu')}</small>
                            <div class="fw-bold">${node.cpu}%</div>
                            <div class="progress"><div class="progress-bar bg-primary" style="width: ${node.cpu}%"></div></div>
                        </div>
                        <div class="col-6">
                            <small class="text-muted">${t('nodeRam')}</small>
                            <div class="fw-bold">${node.memory}%</div>
                            <div class="progress"><div class="progress-bar bg-success" style="width: ${node.memory}%"></div></div>
                        </div>
                        <div class="col-6 mt-2">
                            <small class="text-muted">${t('nodeUptime')}</small>
                            <div class="fw-bold">${formatUptime(node.uptime)}</div>
                        </div>
                        <div class="col-6 mt-2">
                            <small class="text-muted">${t('nodeCpuCores')}</small>
                            <div class="fw-bold">${node.cpuCount}</div>
                        </div>
                    </div>
                </div>
            </div>
        `;
    }).join('');

    updateStorageUI(storageData);
    updateBackupsUI(backupsData);
    
    document.getElementById('quorumStats').innerHTML = `
        <div class="col-md-4"><h3>${clusterData.quorum.votes}</h3><p class="text-muted">${t('quorumVotes')}</p></div>
        <div class="col-md-4"><h3>${clusterData.quorum.expected}</h3><p class="text-muted">${t('quorumExpected')}</p></div>
        <div class="col-md-4"><h3 class="${quorumOk ? 'text-success' : 'text-warning'}">${clusterData.quorum.quorum}</h3><p class="text-muted">${t('quorumNeeded')}</p></div>
    `;
    
    document.getElementById('quorumNodesList').innerHTML = clusterData.quorum.nodes.map(node => `
        <div class="col-md-3 mb-2">
            <span class="badge ${node.online ? 'bg-success' : 'bg-secondary'} p-2 w-100">
                ${node.name} (${node.votes} ${node.votes === 1 ? t('quorumVote') : t('quorumVotes_plural')})
            </span>
        </div>
    `).join('');

    document.getElementById('lastUpdate').innerHTML = 
        '<i class="bi bi-clock"></i> ' + t('lastUpdate') + ': ' + new Date().toLocaleString(currentLanguage === 'ru' ? 'ru-RU' : 'en-US');
}

// Update storage UI
function updateStorageUI(data) {
    if (!data || !data.all) return;
    
    document.getElementById('storageStats').innerHTML = `
        <div class="col-md-3"><div class="stat-card"><div class="stat-value">${data.summary.total}</div><div class="stat-label">${t('storageTotal')}</div></div></div>
        <div class="col-md-3"><div class="stat-card"><div class="stat-value text-success">${data.summary.active}</div><div class="stat-label">${t('storageActive')}</div></div></div>
        <div class="col-md-3"><div class="stat-card"><div class="stat-value">${data.summary.total_space_fmt}</div><div class="stat-label">${t('storageTotalSpace')}</div></div></div>
        <div class="col-md-3"><div class="stat-card"><div class="stat-value">${data.summary.used_space_fmt}</div><div class="stat-label">${t('storageUsedSpace')}</div></div></div>
    `;
    
    document.getElementById('storageTypes').innerHTML = Object.keys(data.byType).map(type => {
        const tData = data.byType[type];
        const usage = tData.total > 0 ? Math.round((tData.used / tData.total) * 100) : 0;
        return `
            <div class="col-md-3 mb-2">
                <div class="card"><div class="card-body p-2">
                    <h6 class="mb-1">${type.toUpperCase()}</h6>
                    <small>${tData.count} ${t('storageTotal')}</small>
                    <div class="progress mt-1" style="height:5px">
                        <div class="progress-bar ${usage > 80 ? 'bg-danger' : (usage > 60 ? 'bg-warning' : 'bg-success')}" style="width:${usage}%"></div>
                    </div>
                    <small class="text-muted">${formatBytes(tData.used)} / ${formatBytes(tData.total)}</small>
                </div></div>
            </div>
        `;
    }).join('');
    
    document.getElementById('storageBody').innerHTML = data.all.map(s => `
        <tr>
            <td>${s.node}</td>
            <td><strong>${s.name}</strong></td>
            <td><span class="badge bg-info">${s.type}</span></td>
            <td><span class="badge ${s.active ? 'bg-success' : 'bg-danger'}">${s.active ? t('storageActive_yes') : t('storageActive_no')}</span></td>
            <td>${s.used_fmt}</td>
            <td>${s.total_fmt}</td>
            <td>
                <div class="d-flex align-items-center">
                    <div class="progress flex-grow-1 me-2" style="height:8px">
                        <div class="progress-bar ${s.usage_percent > 80 ? 'bg-danger' : (s.usage_percent > 60 ? 'bg-warning' : 'bg-success')}" 
                             style="width:${s.usage_percent}%"></div>
                    </div>
                    <span>${s.usage_percent}%</span>
                </div>
            </td>
            <td><small>${s.type === 'nfs' && s.server ? `${s.server}:${s.export || ''}` : s.node}</small></td>
        </tr>
    `).join('');
    
    if (!storageTable) {
        storageTable = $('#storageTable').DataTable({ 
            pageLength: 10, 
            order: [[0,'asc']],
            language: {
                url: currentLanguage === 'ru' 
                    ? 'https://cdn.datatables.net/plug-ins/1.13.6/i18n/ru.json'
                    : 'https://cdn.datatables.net/plug-ins/1.13.6/i18n/en-GB.json'
            }
        });
    } else {
        storageTable.clear().rows.add($('#storageBody').find('tr')).draw();
    }
}

// Update backups UI
function updateBackupsUI(data) {
    if (!data || !data.jobs) return;
    
    document.getElementById('backupStats').innerHTML = `
        <div class="col-md-2"><div class="stat-card"><div class="stat-value">${data.stats.total}</div><div class="stat-label">${t('backupTotal')}</div></div></div>
        <div class="col-md-2"><div class="stat-card"><div class="stat-value text-success">${data.stats.enabled}</div><div class="stat-label">${t('backupEnabled')}</div></div></div>
        <div class="col-md-2"><div class="stat-card"><div class="stat-value text-success">${data.stats.success}</div><div class="stat-label">${t('backupSuccess')}</div></div></div>
        <div class="col-md-2"><div class="stat-card"><div class="stat-value text-danger">${data.stats.error}</div><div class="stat-label">${t('backupError')}</div></div></div>
        <div class="col-md-2"><div class="stat-card"><div class="stat-value text-primary">${data.stats.running}</div><div class="stat-label">${t('backupRunning')}</div></div></div>
        <div class="col-md-2"><div class="stat-card"><div class="stat-value">${data.stats.disabled}</div><div class="stat-label">${t('backupDisabled')}</div></div></div>
    `;
    
    document.getElementById('backupsBody').innerHTML = data.jobs.map(job => {
        let statusBadge = '';
        
        switch(job.status) {
            case 'success':
                statusBadge = `<span class="badge bg-success">${t('backupStatusSuccess')}</span>`;
                break;
            case 'error':
                statusBadge = `<span class="badge bg-danger">${t('backupStatusError')}</span>`;
                break;
            case 'running':
                statusBadge = `<span class="badge bg-primary">${t('backupStatusRunning')}</span>`;
                break;
            case 'warning':
                statusBadge = `<span class="badge bg-warning">${t('backupStatusWarning')}</span>`;
                break;
            default:
                statusBadge = `<span class="badge bg-secondary">${t('backupStatusUnknown')}</span>`;
        }
        
        const lastRun = job.last_run 
            ? `<small>${job.last_run.starttime_fmt}<br><span class="${job.last_run.status === 'OK' ? 'text-success' : 'text-danger'}">${job.last_run.exitstatus || job.last_run.status}</span></small>`
            : t('backupNoData');
        
        return `
            <tr>
                <td><strong>${job.id}</strong> ${job.enabled ? '' : `<span class="badge bg-secondary">${t('backupDisabled_yes')}</span>`}</td>
                <td><code>${job.schedule || 'N/A'}</code></td>
                <td>${statusBadge}</td>
                <td>${job.storage || 'N/A'}</td>
                <td>${job.vmid || t('backupAll')}</td>
                <td><span class="badge bg-info">${job.mode || 'snapshot'}</span></td>
                <td>${lastRun}</td>
                <td class="${job.last_run?.status === 'OK' ? 'text-success' : 'text-danger'}">${job.last_run?.exitstatus || 'N/A'}</td>
                <td><small>${job.next_run || 'N/A'}</small></td>
            </tr>
        `;
    }).join('');
    
    if (!backupsTable) {
        backupsTable = $('#backupsTable').DataTable({ 
            pageLength: 10, 
            order: [[0,'asc']],
            language: {
                url: currentLanguage === 'ru' 
                    ? 'https://cdn.datatables.net/plug-ins/1.13.6/i18n/ru.json'
                    : 'https://cdn.datatables.net/plug-ins/1.13.6/i18n/en-GB.json'
            }
        });
    } else {
        backupsTable.clear().rows.add($('#backupsBody').find('tr')).draw();
    }
}

// ==================== NEW SETTINGS FUNCTIONS ====================

// Load settings from localStorage
function loadSettings() {
    // Refresh interval
    const savedInterval = localStorage.getItem('refreshInterval');
    if (savedInterval) {
        refreshIntervalMs = parseInt(savedInterval);
        document.getElementById('refreshIntervalSelect').value = refreshIntervalMs;
    }
    
    // Theme
    const savedTheme = localStorage.getItem('theme');
    if (savedTheme) {
        currentTheme = savedTheme;
        applyTheme(currentTheme);
    }
    
    // Units
    const savedUnits = localStorage.getItem('units');
    if (savedUnits) {
        currentUnits = savedUnits;
        updateUnitsButtons();
    }
    
    // Thresholds
    const savedThresholds = localStorage.getItem('thresholds');
    if (savedThresholds) {
        thresholds = JSON.parse(savedThresholds);
        document.getElementById('cpuGreenThreshold').value = thresholds.cpuGreen;
        document.getElementById('cpuYellowThreshold').value = thresholds.cpuYellow;
        document.getElementById('ramGreenThreshold').value = thresholds.ramGreen;
        document.getElementById('ramYellowThreshold').value = thresholds.ramYellow;
        updateThresholdLabels();
    }
    
    // Proxmox servers
    const savedServers = localStorage.getItem('proxmoxServers');
    if (savedServers) {
        proxmoxServers = JSON.parse(savedServers);
    }
    
    // Current server index
    const savedServerIndex = localStorage.getItem('currentServerIndex');
    if (savedServerIndex !== null) {
        currentServerIndex = parseInt(savedServerIndex);
    }
    
    // Demo mode
    const savedDemoMode = localStorage.getItem('demoMode') === 'true';
    if (savedDemoMode) {
        demoMode = true;
        const demoBtn = document.getElementById('demoModeBtn');
        demoBtn.classList.add('active');
        demoBtn.classList.remove('btn-outline-success');
        demoBtn.classList.add('btn-success');
        demoBtn.innerHTML = '<i class="bi bi-check-lg"></i> <span id="demoModeText">Демо ВКЛ</span>';
        // Refresh data immediately in demo mode
        setTimeout(() => refreshData(), 500);
    }
    
    // Monitor mode
    const savedMonitorMode = localStorage.getItem('monitorMode') === 'true';
    if (savedMonitorMode) {
        monitorMode = true;
        document.body.classList.add('monitor-mode');
        const monitorBtn = document.getElementById('monitorModeBtn');
        monitorBtn.classList.add('active');
        monitorBtn.classList.remove('btn-outline-info');
        monitorBtn.classList.add('btn-info');
        monitorBtn.innerHTML = '<i class="bi bi-check-lg"></i> <span id="monitorModeText">Монитор ВКЛ</span>';
    }
    
    renderServerList();
}

// Update refresh interval
function updateRefreshInterval() {
    const select = document.getElementById('refreshIntervalSelect');
    refreshIntervalMs = parseInt(select.value);
    localStorage.setItem('refreshInterval', refreshIntervalMs);
    
    showToast(t('dataUpdated'), 'success');
    
    if (apiToken) {
        startAutoRefresh();
    }
}

// Theme toggle function
function toggleTheme() {
    const newTheme = currentTheme === 'dark' ? 'light' : 'dark';
    setTheme(newTheme);
}

// Set theme
function setTheme(theme) {
    currentTheme = theme;
    localStorage.setItem('theme', theme);
    applyTheme(theme);
}

// Apply theme
function applyTheme(theme) {
    if (theme === 'dark') {
        document.body.classList.add('dark-mode');
        document.getElementById('themeToggle').innerHTML = '<i class="bi bi-sun-fill"></i>';
    } else {
        document.body.classList.remove('dark-mode');
        document.getElementById('themeToggle').innerHTML = '<i class="bi bi-moon-stars-fill"></i>';
    }
}

// Set units
function setUnits(units) {
    currentUnits = units;
    localStorage.setItem('units', units);
    updateUnitsButtons();
    
    // Redraw data with new units
    if (apiToken) {
        refreshData();
    }
}

// Update units buttons
function updateUnitsButtons() {
    const decimalBtn = document.getElementById('unitsDecimal');
    const binaryBtn = document.getElementById('unitsBinary');
    
    if (currentUnits === 'decimal') {
        decimalBtn.classList.add('active');
        binaryBtn.classList.remove('active');
    } else {
        decimalBtn.classList.remove('active');
        binaryBtn.classList.add('active');
    }
}

// Update thresholds
function updateThreshold(type, value) {
    thresholds[type] = parseInt(value);
    localStorage.setItem('thresholds', JSON.stringify(thresholds));
    updateThresholdLabels();
}

// Update threshold labels
function updateThresholdLabels() {
    document.getElementById('cpuGreenValue').textContent = thresholds.cpuGreen + '%';
    document.getElementById('cpuYellowValue').textContent = thresholds.cpuYellow + '%';
    document.getElementById('ramGreenValue').textContent = thresholds.ramGreen + '%';
    document.getElementById('ramYellowValue').textContent = thresholds.ramYellow + '%';
}

// Reset thresholds
function resetThresholds() {
    thresholds = {
        cpuGreen: 70,
        cpuYellow: 90,
        ramGreen: 70,
        ramYellow: 90
    };
    localStorage.setItem('thresholds', JSON.stringify(thresholds));
    
    document.getElementById('cpuGreenThreshold').value = 70;
    document.getElementById('cpuYellowThreshold').value = 90;
    document.getElementById('ramGreenThreshold').value = 70;
    document.getElementById('ramYellowThreshold').value = 90;
    
    updateThresholdLabels();
    showToast(t('dataUpdated'), 'success');
}

// Format size based on selected units
function formatSize(bytes) {
    if (bytes === null || bytes === undefined) return 'N/A';
    
    if (currentUnits === 'binary') {
        // GiB / TiB (binary)
        const gib = bytes / Math.pow(1024, 3);
        if (gib >= 1024) {
            return (gib / 1024).toFixed(2) + ' ТиБ';
        }
        return gib.toFixed(2) + ' ГиБ';
    } else {
        // GB / TB (decimal)
        const gb = bytes / Math.pow(1000, 3);
        if (gb >= 1000) {
            return (gb / 1000).toFixed(2) + ' ТБ';
        }
        return gb.toFixed(2) + ' ГБ';
    }
}

// Get color class for percentage based on thresholds
function getColorClass(percent, type) {
    let greenThreshold, yellowThreshold;
    
    if (type === 'cpu') {
        greenThreshold = thresholds.cpuGreen;
        yellowThreshold = thresholds.cpuYellow;
    } else {
        greenThreshold = thresholds.ramGreen;
        yellowThreshold = thresholds.ramYellow;
    }
    
    if (percent <= greenThreshold) {
        return 'bg-success';
    } else if (percent <= yellowThreshold) {
        return 'bg-warning';
    } else {
        return 'bg-danger';
    }
}

// ==================== PROXMOX SERVERS MANAGEMENT ====================

// Render servers list
function renderServerList() {
    const container = document.getElementById('serverList');
    if (!container) return;
    
    container.innerHTML = '';
    
    proxmoxServers.forEach((server, index) => {
        const div = document.createElement('div');
        div.className = 'input-group mb-2';
        
        const isCurrent = index === currentServerIndex;
        const statusBadge = isCurrent 
            ? '<span class="badge bg-success ms-2">✓</span>' 
            : '';
        
        div.innerHTML = `
            <input type="text" class="form-control form-control-sm ${isCurrent ? 'border-success' : ''}" 
                   value="${server}" data-index="${index}" 
                   onchange="updateServerUrl(${index}, this.value)"
                   placeholder="https://192.168.1.1:8006">
            <button class="btn btn-outline-secondary btn-sm" type="button" onclick="setCurrentServer(${index})" 
                    title="${t('currentServer')}">
                <i class="bi bi-${isCurrent ? 'check-lg' : 'arrow-right'}"></i>
            </button>
            <button class="btn btn-outline-danger btn-sm" type="button" onclick="removeServer(${index})" 
                    title="${t('removeServer')}">
                <i class="bi bi-trash"></i>
            </button>
            ${statusBadge}
        `;
        
        container.appendChild(div);
    });
}

// Add new server
function addServer() {
    proxmoxServers.push('https://');
    renderServerList();
    saveServers();
}

// Update server URL
function updateServerUrl(index, url) {
    proxmoxServers[index] = url.trim();
    saveServers();
}

// Set current server
function setCurrentServer(index) {
    currentServerIndex = index;
    localStorage.setItem('currentServerIndex', index);
    renderServerList();
    updateCurrentServerBadge();
    
    if (apiToken) {
        showToast(`${t('currentServer')}: ${proxmoxServers[index]}`, 'info');
        refreshData();
    }
}

// Remove server
function removeServer(index) {
    if (proxmoxServers.length <= 1) {
        showToast(currentLanguage === 'ru' ? 'Нельзя удалить последний сервер' : 'Cannot remove the last server', 'warning');
        return;
    }
    
    proxmoxServers.splice(index, 1);
    
    if (currentServerIndex >= proxmoxServers.length) {
        currentServerIndex = proxmoxServers.length - 1;
    }
    
    renderServerList();
    saveServers();
}

// Save servers list
function saveServers() {
    localStorage.setItem('proxmoxServers', JSON.stringify(proxmoxServers));
    localStorage.setItem('currentServerIndex', currentServerIndex);
    updateCurrentServerBadge();
}

// Update current server badge in navbar
function updateCurrentServerBadge() {
    const badge = document.getElementById('currentServerBadge');
    const nameSpan = document.getElementById('currentServerName');
    
    if (!badge || !nameSpan) return;
    
    if (proxmoxServers && proxmoxServers.length > 0 && currentServerIndex < proxmoxServers.length) {
        const serverUrl = proxmoxServers[currentServerIndex];
        // Extract hostname from URL
        try {
            const url = new URL(serverUrl);
            nameSpan.textContent = url.hostname;
        } catch (e) {
            nameSpan.textContent = serverUrl;
        }
        badge.style.display = 'inline-block';
    } else {
        badge.style.display = 'none';
    }
}

// Get current server URL
function getCurrentServerUrl() {
    return proxmoxServers[currentServerIndex] || 'https://192.168.1.1:8006';
}
