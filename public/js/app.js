// Global variables
let apiToken = null;
let autoRefreshInterval = null;
let storageTable = null;
let backupsTable = null;
let currentLanguage = 'ru';
let refreshIntervalMs = 30000; // Default refresh interval
let currentTheme = 'light';
let currentUnits = 'decimal'; // 'decimal' (GB) or 'binary' (GiB)
let monitorMode = false; // Monitor (display) mode flag
let currentServerType = 'proxmox'; // 'proxmox' | 'truenas'
let thresholds = {
    cpuGreen: 70,
    cpuYellow: 90,
    ramGreen: 70,
    ramYellow: 90
};
let proxmoxServers = ['https://192.168.1.1:8006']; // List of Proxmox servers
let currentServerIndex = 0; // Current server index
let truenasServers = ['https://192.168.1.2']; // List of TrueNAS servers
let currentTrueNASServerIndex = 0;
let connectionIdMap = {}; // key: `${type}|${url}` -> connectionId (no secrets)
let isRefreshing = false;
const htmlCache = {}; // elementId -> last innerHTML string

function el(id) {
    return document.getElementById(id);
}

function setText(id, value) {
    const e = el(id);
    if (e) e.textContent = value;
}

function setHTML(id, value) {
    const e = el(id);
    if (e) e.innerHTML = value;
}

function setHTMLIfChanged(id, value) {
    const v = String(value);
    if (htmlCache[id] === v) return;
    htmlCache[id] = v;
    setHTML(id, v);
}

function setValue(id, value) {
    const e = el(id);
    if (e) e.value = value;
}

function setDisplay(id, display) {
    const e = el(id);
    if (e) e.style.display = display;
}

// Client-side translations (will be loaded from server)
let translations = {
    ru: {},
    en: {}
};

function ensureTranslationsShape(obj) {
    const base = { ru: {}, en: {} };
    if (!obj || typeof obj !== 'object') return base;
    return {
        ...base,
        ...obj,
        ru: (obj.ru && typeof obj.ru === 'object') ? obj.ru : base.ru,
        en: (obj.en && typeof obj.en === 'object') ? obj.en : base.en
    };
}

// Load translations from server
async function loadTranslations() {
    try {
        const response = await fetch('/api/translations');
        const data = await response.json();
        if (data.translations) {
            translations = ensureTranslationsShape(data.translations);
        } else {
            translations = ensureTranslationsShape(translations);
        }
    } catch (error) {
        console.error('Failed to load translations:', error);
        translations = ensureTranslationsShape(translations);
    }
}

function t(key) {
    const dict = ensureTranslationsShape(translations);
    return dict[currentLanguage]?.[key] ?? dict.ru?.[key] ?? key;
}

function setServerType(type) {
    currentServerType = (type === 'truenas') ? 'truenas' : 'proxmox';
    localStorage.setItem('serverType', currentServerType);

    const select = document.getElementById('serverTypeSelect');
    if (select) select.value = currentServerType;
    const quick = document.getElementById('serverTypeQuick');
    if (quick) quick.value = currentServerType;
    const monitorSelect = document.getElementById('monitorServerTypeSelect');
    if (monitorSelect) monitorSelect.value = currentServerType;

    // Update connection labels/hints
    const isTrueNAS = currentServerType === 'truenas';
    setText('connectTitle', t(isTrueNAS ? 'truenasConnectTitle' : 'connectTitle'));
    setText('connectDesc', t(isTrueNAS ? 'truenasConnectDesc' : 'connectDesc'));
    setText('tokenLabel', t(isTrueNAS ? 'truenasKeyLabel' : 'tokenLabel'));
    setText('tokenHint', t(isTrueNAS ? 'truenasKeyHint' : 'tokenHint'));

    const tokenInput = document.getElementById('apiToken');
    if (tokenInput) tokenInput.placeholder = isTrueNAS ? 'API Key' : 'root@pam!tokenid=secret';

    // Proxmox server list UI is not applicable for TrueNAS in MVP
    // Server list is used for both types; just update label/hint
    setText('proxmoxServersLabel', t(isTrueNAS ? 'truenasServersLabel' : 'proxmoxServersLabel'));
    setText('proxmoxServersHint', t(isTrueNAS ? 'truenasServersHint' : 'proxmoxServersHint'));
    renderServerList();
    updateCurrentServerBadge();

    // Hide/Show tabs that are not applicable
    const backupsTab = document.getElementById('backups-tab')?.closest('li');
    const quorumTab = document.getElementById('quorum-tab')?.closest('li');
    const nodesTab = document.getElementById('nodes-tab')?.closest('li');
    if (backupsTab) backupsTab.style.display = isTrueNAS ? 'none' : '';
    if (quorumTab) quorumTab.style.display = isTrueNAS ? 'none' : '';
    if (nodesTab) nodesTab.style.display = isTrueNAS ? 'none' : '';
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
        serverTypeLabel: 'serverTypeLabel',
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
    const themeLight = document.getElementById('themeLight');
    const themeDark = document.getElementById('themeDark');
    const unitsDecimal = document.getElementById('unitsDecimal');
    const unitsBinary = document.getElementById('unitsBinary');
    if (themeLight) themeLight.innerHTML = '<i class="bi bi-sun me-1"></i> ' + t('themeLight');
    if (themeDark) themeDark.innerHTML = '<i class="bi bi-moon me-1"></i> ' + t('themeDark');
    if (unitsDecimal) unitsDecimal.textContent = t('unitsDecimal');
    if (unitsBinary) unitsBinary.textContent = t('unitsBinary');
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

    // Server type selection
    const savedType = localStorage.getItem('serverType');
    if (savedType) currentServerType = savedType;
    setServerType(currentServerType);
    
    checkSavedToken();
    checkServerStatus();
    updateCurrentServerBadge();
});

function connectionKey(type, url) {
    return `${type}|${String(url || '').trim()}`;
}

function getCurrentConnectionId() {
    const url = getCurrentServerUrl();
    return connectionIdMap[connectionKey(currentServerType, url)] || null;
}

function saveConnectionId(type, url, id) {
    connectionIdMap[connectionKey(type, url)] = id;
    localStorage.setItem('connectionIdMap', JSON.stringify(connectionIdMap));
}

// Check saved token
async function checkSavedToken() {
    try {
        const response = await fetch(currentServerType === 'truenas' ? '/api/truenas/auth/key' : '/api/auth/token');
        const data = await response.json();
        
        const key = data.token || data.apiKey;
        if (data.success && key) {
            apiToken = key;
            // restore serverUrl if backend stored it
            const savedServerUrl = data.serverUrl;
            if (savedServerUrl) {
                if (currentServerType === 'truenas') {
                    truenasServers = [savedServerUrl];
                    currentTrueNASServerIndex = 0;
                    localStorage.setItem('truenasServers', JSON.stringify(truenasServers));
                    localStorage.setItem('currentTrueNASServerIndex', '0');
                } else {
                    proxmoxServers = [savedServerUrl];
                    currentServerIndex = 0;
                    localStorage.setItem('proxmoxServers', JSON.stringify(proxmoxServers));
                    localStorage.setItem('currentServerIndex', '0');
                }
            }
            setValue('apiToken', '••••••••••••••••');
            document.getElementById('rememberToken').checked = true;
            setDisplay('logoutContainer', 'block');
            
            showToast(t('tokenFound'), 'info');
            testTokenAndConnect(key);
        }
    } catch (error) {
        console.log('No saved token found');
    }
}

// Test token and connect
async function testTokenAndConnect(token) {
    try {
        const serverUrl = getCurrentServerUrl();
        const response = await fetch(currentServerType === 'truenas' ? '/api/truenas/auth/test' : '/api/auth/test', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(currentServerType === 'truenas'
                ? { apiKey: token, remember: false, serverUrl }
                : { token, remember: false, serverUrl })
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
        // Clear local token and mapping for current url (server-side secrets remain unless user deletes connection)
        const url = getCurrentServerUrl();
        delete connectionIdMap[connectionKey(currentServerType, url)];
        localStorage.setItem('connectionIdMap', JSON.stringify(connectionIdMap));

        showToast(t('logoutSuccess'), 'success');
        apiToken = null;
        setValue('apiToken', '');
        setDisplay('logoutContainer', 'none');
        showConfig();
    } catch (error) {
        showToast('Ошибка при выходе: ' + error.message, 'error');
    }
}

// Check server status
async function checkServerStatus() {
    try {
        const response = await fetch('/api/status');
        const data = await response.json();
        setHTML('serverStatus', '<i class="bi bi-check-circle"></i> <span id="serverStatusText">' + t('serverWorking') + '</span>');
    } catch (error) {
        setHTML('serverStatus', '<i class="bi bi-exclamation-circle"></i> <span id="serverStatusText">' + t('serverError') + '</span>');
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

// Toggle monitor mode
async function toggleMonitorMode() {
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

    // Fullscreen toggle for monitor mode
    try {
        if (monitorMode) {
            if (!document.fullscreenElement && document.documentElement.requestFullscreen) {
                await document.documentElement.requestFullscreen();
            }
        } else {
            if (document.fullscreenElement && document.exitFullscreen) {
                await document.exitFullscreen();
            }
        }
    } catch (e) {
        // Fullscreen can be blocked by browser policy; monitor mode still works.
        console.warn('Fullscreen toggle failed:', e);
    }
    
    // Refresh data when entering/exiting monitor mode
    if (apiToken) refreshData();
}

// Show dashboard
function showDashboard() {
    document.getElementById('configSection').style.display = 'none';
    document.getElementById('dashboardSection').style.display = 'block';
    // Refresh only when authenticated
    if (apiToken) {
        refreshData();
        startAutoRefresh();
    }
}

// Start auto refresh
function startAutoRefresh() {
    if (autoRefreshInterval) clearInterval(autoRefreshInterval);
    autoRefreshInterval = setInterval(() => refreshData({ silent: true }), refreshIntervalMs);
}

// Connect
async function connect() {
    const tokenInput = document.getElementById('apiToken');
    const rawToken = tokenInput ? tokenInput.value.trim() : '';
    // Если в поле маска (после загрузки из cookies), используем сохранённый apiToken
    const token = (rawToken && rawToken.includes('•')) ? (apiToken || '') : rawToken;
    const rememberToken = document.getElementById('rememberToken')?.checked ?? true;
    
    if (!token) {
        showToast(t('tokenRequired'), 'error');
        return;
    }

    const connectBtn = document.getElementById('connectBtn');
    const originalText = connectBtn.innerHTML;
    connectBtn.disabled = true;
    connectBtn.innerHTML = '<span class="spinner-border spinner-border-sm me-2"></span>' + t('loading');
    
    const serverUrl = getCurrentServerUrl();
    try {
        // If user wants to remember, store the secret server-side and keep only connectionId client-side.
        if (rememberToken) {
            const upsertRes = await fetch('/api/connections/upsert', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    type: currentServerType,
                    url: serverUrl,
                    secret: token
                })
            });
            const upsertData = await upsertRes.json();
            if (!upsertRes.ok || !upsertData?.success) {
                throw new Error(upsertData?.error || `connections: HTTP ${upsertRes.status}`);
            }
            saveConnectionId(currentServerType, upsertData.connection.url, upsertData.connection.id);
            apiToken = null; // do not keep secret in memory when remembered
        } else {
            apiToken = token;
        }

        const response = await fetch(currentServerType === 'truenas' ? '/api/truenas/auth/test' : '/api/auth/test', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(currentServerType === 'truenas'
                ? { apiKey: token, remember: rememberToken, serverUrl }
                : { token, remember: rememberToken, serverUrl })
        });
        
        const data = await response.json();
        
        if (data.success) {
            showToast(t('connectSuccess'), 'success');
            setDisplay('logoutContainer', 'block');
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
    const tokenInput = document.getElementById('apiToken');
    const rawToken = tokenInput ? tokenInput.value.trim() : '';
    const token = (rawToken && rawToken.includes('•')) ? (apiToken || '') : rawToken;
    
    if (!token) {
        showToast(t('tokenRequired'), 'warning');
        updateConnectionStatus(false);
        return;
    }
    
    const testBtn = document.getElementById('testConnectionBtn');
    const originalText = testBtn.innerHTML;
    testBtn.disabled = true;
    testBtn.innerHTML = '<span class="spinner-border spinner-border-sm me-2"></span>' + t('loading');
    
    const serverUrl = getCurrentServerUrl();
    try {
        const connId = getCurrentConnectionId();
        if (connId) {
            const testRes = await fetch(`/api/connections/${connId}/test`, { method: 'POST' });
            const testData = await testRes.json();
            if (testRes.ok && testData.success) {
                showToast(t('connectionStatusConnected'), 'success');
                updateConnectionStatus(true);
                return;
            }
            showToast(t('connectionStatusDisconnected') + ': ' + (testData.error || `HTTP ${testRes.status}`), 'error');
            updateConnectionStatus(false);
            return;
        }

        const response = await fetch(currentServerType === 'truenas' ? '/api/truenas/auth/test' : '/api/auth/test', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(currentServerType === 'truenas'
                ? { apiKey: token, remember: false, serverUrl }
                : { token, remember: false, serverUrl })
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
async function refreshData(options = {}) {
    const silent = options === true ? true : !!options.silent;

    if (isRefreshing) return;
    isRefreshing = true;
    const connId = getCurrentConnectionId();
    if (!connId && !apiToken) {
        if (!silent) showToast(t('errorNoToken'), 'error');
        isRefreshing = false;
        return;
    }

    if (!silent) showLoading(true);

    try {
        const prevScrollY = window.scrollY;
        const prevActiveId = document.activeElement && document.activeElement.id ? document.activeElement.id : null;

        if (currentServerType === 'truenas') {
            const serverUrl = getCurrentServerUrl();
            const [systemRes, poolsRes] = await Promise.all([
                fetch('/api/truenas/system', { headers: connId ? { 'X-Connection-Id': connId } : { 'Authorization': apiToken, 'X-Server-Url': serverUrl } }),
                fetch('/api/truenas/storage/pools', { headers: connId ? { 'X-Connection-Id': connId } : { 'Authorization': apiToken, 'X-Server-Url': serverUrl } })
            ]);
            const systemData = await systemRes.json();
            const poolsData = await poolsRes.json();
            if (!systemRes.ok) throw new Error(systemData?.error || `system: HTTP ${systemRes.status}`);
            if (!poolsRes.ok) throw new Error(poolsData?.error || `pools: HTTP ${poolsRes.status}`);
            updateTrueNASDashboard(systemData, poolsData);
        } else {
            const serverUrl = getCurrentServerUrl();
            const [clusterRes, storageRes, backupsRes] = await Promise.all([
                fetch('/api/cluster/full', { headers: connId ? { 'X-Connection-Id': connId } : { 'Authorization': apiToken, 'X-Server-Url': serverUrl } }),
                fetch('/api/storage', { headers: connId ? { 'X-Connection-Id': connId } : { 'Authorization': apiToken, 'X-Server-Url': serverUrl } }),
                fetch('/api/backups/jobs', { headers: connId ? { 'X-Connection-Id': connId } : { 'Authorization': apiToken, 'X-Server-Url': serverUrl } })
            ]);

            const clusterData = await clusterRes.json();
            const storageData = await storageRes.json();
            const backupsData = await backupsRes.json();
            
            if (!clusterRes.ok) throw new Error(clusterData?.error || `cluster: HTTP ${clusterRes.status}`);
            if (!storageRes.ok) throw new Error(storageData?.error || `storage: HTTP ${storageRes.status}`);
            if (!backupsRes.ok) throw new Error(backupsData?.error || `backups: HTTP ${backupsRes.status}`);
            
            updateDashboard(clusterData, storageData, backupsData, {});
        }
        
        // Restore scroll/focus to avoid visible "jumps" on full re-render
        requestAnimationFrame(() => {
            window.scrollTo({ top: prevScrollY, left: 0, behavior: 'auto' });
            if (prevActiveId) {
                const a = document.getElementById(prevActiveId);
                if (a && typeof a.focus === 'function') a.focus({ preventScroll: true });
            }
        });
        if (!silent) showToast(t('dataUpdated'), 'success');

    } catch (error) {
        if (!silent) showToast(t('errorUpdate') + ': ' + error.message, 'error');
    } finally {
        if (!silent) showLoading(false);
        isRefreshing = false;
    }
}

function updateTrueNASDashboard(systemData, poolsData) {
    // Basic header stats
    setText('totalNodes', '1');
    setText('onlineNodes', '1');
    setHTML('quorumStatus', t('notApplicable'));
    const quorumEl = document.getElementById('quorumStatus');
    if (quorumEl) quorumEl.className = 'stat-value text-muted';
    setHTML('connectionStatus', '<i class="bi bi-check-circle-fill text-success"></i> ' + t('connected'));

    // Resources cards: TrueNAS API doesn't directly expose usage in a stable way in MVP
    setText('clusterCpu', '—');
    setText('clusterCpuDetail', t('truenasSystem'));
    const cpuBar = document.getElementById('clusterCpuBar');
    if (cpuBar) cpuBar.style.width = '0%';

    setText('clusterMemory', '—');
    const hostname = systemData?.hostname || systemData?.system_hostname || systemData?.host || 'TrueNAS';
    const version = systemData?.version || systemData?.product_version || systemData?.release || '';
    setText('clusterMemoryDetail', version ? `${hostname} • ${version}` : hostname);
    const memBar = document.getElementById('clusterMemoryBar');
    if (memBar) memBar.style.width = '0%';

    setText('clusterVms', '—');
    setText('clusterContainers', '—');

    // Nodes container: show system summary card
    const nodesContainer = document.getElementById('nodesContainer');
    if (nodesContainer) {
        setHTMLIfChanged('nodesContainer', `
            <div class="col-12">
                <div class="node-card">
                    <div class="d-flex justify-content-between align-items-center mb-2">
                        <h5 class="mb-0">${hostname}</h5>
                        <span class="badge bg-success">${t('connected')}</span>
                    </div>
                    <div class="text-muted small">
                        ${version ? `<div><strong>${t('version')}:</strong> ${version}</div>` : ''}
                        ${systemData?.uptime ? `<div><strong>${t('uptime')}:</strong> ${systemData.uptime}</div>` : ''}
                    </div>
                </div>
            </div>
        `);
    }

    // Storage tab: reuse existing storage UI, but values are bytes/numbers
    updateStorageUI({
        ...poolsData,
        all: (poolsData?.all || []).map(p => ({
            ...p,
            used_fmt: formatSize(p.used),
            total_fmt: formatSize(p.total)
        })),
        summary: poolsData?.summary ? {
            ...poolsData.summary,
            total_space_fmt: formatSize(poolsData.summary.total_space),
            used_space_fmt: formatSize(poolsData.summary.used_space)
        } : poolsData?.summary
    });

    // Clear backups table if present
    if (backupsTable) {
        backupsTable.destroy();
        backupsTable = null;
    }

    setHTMLIfChanged('lastUpdate', '<i class="bi bi-clock"></i> ' + t('lastUpdate') + ': ' + new Date().toLocaleString(currentLanguage === 'ru' ? 'ru-RU' : 'en-US'));
}

// Show/hide loading
function showLoading(show) {
    const ind = document.getElementById('loadingIndicator');
    if (ind) ind.classList.toggle('is-visible', !!show);
    const refreshBtn = el('refreshBtn');
    if (refreshBtn) refreshBtn.disabled = show;
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
    if (!clusterData || !Array.isArray(clusterData.nodes) || !clusterData.cluster?.summary || !clusterData.quorum) {
        throw new Error(clusterData?.error || 'Некорректный ответ кластера');
    }
    const totalNodes = clusterData.nodes.length;
    const onlineNodes = clusterData.nodes.filter(n => n.status === 'online').length;
    
    setText('totalNodes', String(totalNodes));
    setText('onlineNodes', String(onlineNodes));
    
    const quorumOk = onlineNodes >= clusterData.quorum.quorum;
    setHTML('quorumStatus', quorumOk ? t('quorumEnough') : t('quorumNotEnough'));
    const quorumEl = el('quorumStatus');
    if (quorumEl) quorumEl.className = 'stat-value ' + (quorumOk ? 'text-success' : 'text-warning');

    setHTML('connectionStatus', '<i class="bi bi-check-circle-fill text-success"></i> ' + t('connected'));

    const summary = clusterData.cluster.summary;
    setText('clusterCpu', summary.cpuUsagePercent + '%');
    setText('clusterCpuDetail', `${Math.round(summary.usedCPU)}/${summary.totalCPU} ${t('cores')}`);
    const cpuBar = el('clusterCpuBar');
    if (cpuBar) cpuBar.style.width = summary.cpuUsagePercent + '%';
    
    setText('clusterMemory', summary.memoryUsagePercent + '%');
    setText('clusterMemoryDetail', `${summary.usedMemory}/${summary.totalMemory}`);
    const memBar = el('clusterMemoryBar');
    if (memBar) memBar.style.width = summary.memoryUsagePercent + '%';
    
    setText('clusterVms', String(summary.totalVMs || 0));
    setText('clusterContainers', (summary.totalContainers || 0) + ' ' + t('containers'));

    const nodesContainer = el('nodesContainer');
    if (nodesContainer) {
        const nodesHtml = clusterData.nodes.map(node => {
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
        setHTMLIfChanged('nodesContainer', nodesHtml);
    }

    updateStorageUI(storageData);
    updateBackupsUI(backupsData);
    
    setHTMLIfChanged('quorumStats', `
        <div class="col-md-4"><h3>${clusterData.quorum.votes}</h3><p class="text-muted">${t('quorumVotes')}</p></div>
        <div class="col-md-4"><h3>${clusterData.quorum.expected}</h3><p class="text-muted">${t('quorumExpected')}</p></div>
        <div class="col-md-4"><h3 class="${quorumOk ? 'text-success' : 'text-warning'}">${clusterData.quorum.quorum}</h3><p class="text-muted">${t('quorumNeeded')}</p></div>
    `);
    
    const quorumList = el('quorumNodesList');
    if (quorumList) {
        const quorumHtml = clusterData.quorum.nodes.map(node => `
        <div class="col-md-3 mb-2">
            <span class="badge ${node.online ? 'bg-success' : 'bg-secondary'} p-2 w-100">
                ${node.name} (${node.votes} ${node.votes === 1 ? t('quorumVote') : t('quorumVotes_plural')})
            </span>
        </div>
    `).join('');
        setHTMLIfChanged('quorumNodesList', quorumHtml);
    }

    setHTMLIfChanged('lastUpdate', '<i class="bi bi-clock"></i> ' + t('lastUpdate') + ': ' + new Date().toLocaleString(currentLanguage === 'ru' ? 'ru-RU' : 'en-US'));
}

// Update storage UI
function updateStorageUI(data) {
    if (!data || !data.all) return;
    
    setHTMLIfChanged('storageStats', `
        <div class="col-md-3"><div class="stat-card"><div class="stat-value">${data.summary.total}</div><div class="stat-label">${t('storageTotal')}</div></div></div>
        <div class="col-md-3"><div class="stat-card"><div class="stat-value text-success">${data.summary.active}</div><div class="stat-label">${t('storageActive')}</div></div></div>
        <div class="col-md-3"><div class="stat-card"><div class="stat-value">${data.summary.total_space_fmt}</div><div class="stat-label">${t('storageTotalSpace')}</div></div></div>
        <div class="col-md-3"><div class="stat-card"><div class="stat-value">${data.summary.used_space_fmt}</div><div class="stat-label">${t('storageUsedSpace')}</div></div></div>
    `);
    
    setHTMLIfChanged('storageTypes', Object.keys(data.byType).map(type => {
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
    }).join(''));
    
    setHTMLIfChanged('storageBody', data.all.map(s => `
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
    `).join(''));
    
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
    
    setHTMLIfChanged('backupStats', `
        <div class="col-md-2"><div class="stat-card"><div class="stat-value">${data.stats.total}</div><div class="stat-label">${t('backupTotal')}</div></div></div>
        <div class="col-md-2"><div class="stat-card"><div class="stat-value text-success">${data.stats.enabled}</div><div class="stat-label">${t('backupEnabled')}</div></div></div>
        <div class="col-md-2"><div class="stat-card"><div class="stat-value text-success">${data.stats.success}</div><div class="stat-label">${t('backupSuccess')}</div></div></div>
        <div class="col-md-2"><div class="stat-card"><div class="stat-value text-danger">${data.stats.error}</div><div class="stat-label">${t('backupError')}</div></div></div>
        <div class="col-md-2"><div class="stat-card"><div class="stat-value text-primary">${data.stats.running}</div><div class="stat-label">${t('backupRunning')}</div></div></div>
        <div class="col-md-2"><div class="stat-card"><div class="stat-value">${data.stats.disabled}</div><div class="stat-label">${t('backupDisabled')}</div></div></div>
    `);
    
    setHTMLIfChanged('backupsBody', data.jobs.map(job => {
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
    }).join(''));
    
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
    const savedTrueNASSrvs = localStorage.getItem('truenasServers');
    if (savedTrueNASSrvs) {
        truenasServers = JSON.parse(savedTrueNASSrvs);
    }
    const savedMap = localStorage.getItem('connectionIdMap');
    if (savedMap) {
        try { connectionIdMap = JSON.parse(savedMap) || {}; } catch { connectionIdMap = {}; }
    }
    
    // Current server index
    const savedServerIndex = localStorage.getItem('currentServerIndex');
    if (savedServerIndex !== null) {
        currentServerIndex = parseInt(savedServerIndex);
    }
    const savedTrueNASIndex = localStorage.getItem('currentTrueNASServerIndex');
    if (savedTrueNASIndex !== null) {
        currentTrueNASServerIndex = parseInt(savedTrueNASIndex);
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
function getServersForCurrentType() {
    return currentServerType === 'truenas' ? truenasServers : proxmoxServers;
}

function getCurrentIndexForType() {
    return currentServerType === 'truenas' ? currentTrueNASServerIndex : currentServerIndex;
}

function setCurrentIndexForType(index) {
    if (currentServerType === 'truenas') {
        currentTrueNASServerIndex = index;
        localStorage.setItem('currentTrueNASServerIndex', String(index));
    } else {
        currentServerIndex = index;
        localStorage.setItem('currentServerIndex', String(index));
    }
}

// Render servers list
function renderServerList() {
    const container = document.getElementById('serverList');
    if (!container) return;
    
    container.innerHTML = '';
    
    const servers = getServersForCurrentType();
    const currentIdx = getCurrentIndexForType();
    servers.forEach((server, index) => {
        const div = document.createElement('div');
        div.className = 'input-group mb-2';
        
        const isCurrent = index === currentIdx;
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
    const servers = getServersForCurrentType();
    servers.push('https://');
    renderServerList();
    saveServers();
}

// Update server URL
function updateServerUrl(index, url) {
    const servers = getServersForCurrentType();
    servers[index] = url.trim();
    saveServers();
}

// Set current server
function setCurrentServer(index) {
    setCurrentIndexForType(index);
    renderServerList();
    updateCurrentServerBadge();
    
    if (apiToken) {
        const servers = getServersForCurrentType();
        showToast(`${t('currentServer')}: ${servers[index]}`, 'info');
        refreshData();
    }
}

// Remove server
function removeServer(index) {
    const servers = getServersForCurrentType();
    if (servers.length <= 1) {
        showToast(currentLanguage === 'ru' ? 'Нельзя удалить последний сервер' : 'Cannot remove the last server', 'warning');
        return;
    }
    
    servers.splice(index, 1);
    
    const currentIdx = getCurrentIndexForType();
    if (currentIdx >= servers.length) {
        setCurrentIndexForType(servers.length - 1);
    }
    
    renderServerList();
    saveServers();
}

// Save servers list
function saveServers() {
    localStorage.setItem('proxmoxServers', JSON.stringify(proxmoxServers));
    localStorage.setItem('truenasServers', JSON.stringify(truenasServers));
    localStorage.setItem('currentServerIndex', String(currentServerIndex));
    localStorage.setItem('currentTrueNASServerIndex', String(currentTrueNASServerIndex));
    updateCurrentServerBadge();
}

// Update current server badge in navbar
function updateCurrentServerBadge() {
    const badge = document.getElementById('currentServerBadge');
    const nameSpan = document.getElementById('currentServerName');
    
    if (!badge || !nameSpan) return;
    
    const servers = getServersForCurrentType();
    const idx = getCurrentIndexForType();
    if (servers && servers.length > 0 && idx < servers.length) {
        const serverUrl = servers[idx];
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
    const servers = getServersForCurrentType();
    const idx = getCurrentIndexForType();
    if (servers && servers[idx]) return servers[idx];
    return currentServerType === 'truenas' ? 'https://192.168.1.2' : 'https://192.168.1.1:8006';
}
