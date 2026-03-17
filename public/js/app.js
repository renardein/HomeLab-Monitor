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
/** Тема режима монитора: 'light' | 'dark' (независимо от общей темы) */
let monitorTheme = 'dark';
/** Разблокированы ли настройки в этой сессии (для защиты паролем) */
let settingsUnlocked = false;
/** Пароль настроек включён (из API) */
let settingsPasswordRequired = false;
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
let monitoredServices = []; // [{ name, type: 'tcp'|'udp'|'http', host?, port?, url?, lastStatus, lastLatency }]
let lastClusterData = null;   // for monitor view (Proxmox)
let lastTrueNASData = null;   // { system, pools } for monitor view (TrueNAS)

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

function escapeHtml(s) {
    if (s == null) return '';
    const t = String(s);
    return t.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function setDisplay(id, display) {
    const e = el(id);
    if (e) e.style.display = display;
}

function isSettingsPasswordEnabled() {
    return !!settingsPasswordRequired;
}

async function saveSettingsToServer(payload) {
    const body = {};
    if (payload.theme !== undefined) body.theme = payload.theme;
    if (payload.refreshInterval !== undefined) body.refreshInterval = payload.refreshInterval;
    if (payload.units !== undefined) body.units = payload.units;
    if (payload.thresholds !== undefined) body.thresholds = payload.thresholds;
    if (payload.monitorTheme !== undefined) body.monitorTheme = payload.monitorTheme;
    if (payload.monitorMode !== undefined) body.monitorMode = payload.monitorMode;
    if (payload.serverType !== undefined) body.serverType = payload.serverType;
    if (payload.currentServerIndex !== undefined) body.currentServerIndex = payload.currentServerIndex;
    if (payload.currentTrueNASServerIndex !== undefined) body.currentTrueNASServerIndex = payload.currentTrueNASServerIndex;
    if (payload.proxmoxServers !== undefined) body.proxmoxServers = payload.proxmoxServers;
    if (payload.truenasServers !== undefined) body.truenasServers = payload.truenasServers;
    if (payload.connectionIdMap !== undefined) body.connectionIdMap = payload.connectionIdMap;
    if (payload.preferredLanguage !== undefined) body.preferredLanguage = payload.preferredLanguage;
    try {
        await fetch('/api/settings', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
    } catch (e) {
        console.error('Failed to save settings:', e);
    }
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
    saveSettingsToServer({ serverType: currentServerType });

    const select = document.getElementById('serverTypeSelect');
    if (select) select.value = currentServerType;
    const monitorSelect = document.getElementById('monitorServerTypeSelect');
    if (monitorSelect) monitorSelect.value = currentServerType;
    const serverMenuTitle = document.getElementById('serverMenuTitle');
    if (serverMenuTitle) {
        serverMenuTitle.textContent = currentServerType === 'truenas' ? 'TrueNAS' : 'Proxmox';
    }

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
    const serversTab = document.getElementById('servers-tab')?.closest('li');
    if (backupsTab) backupsTab.style.display = isTrueNAS ? 'none' : '';
    if (quorumTab) quorumTab.style.display = isTrueNAS ? 'none' : '';
    if (nodesTab) nodesTab.style.display = isTrueNAS ? 'none' : '';
    if (serversTab) serversTab.style.display = isTrueNAS ? '' : 'none';

    // Переключаем активную вкладку при смене типа
    const defaultTabId = isTrueNAS ? 'servers-tab' : 'nodes-tab';
    const btn = document.getElementById(defaultTabId);
    if (btn) btn.click();
}

function openServicesMonitorFromMenu() {
    const dashboardSection = document.getElementById('dashboardSection');
    const servicesSection = document.getElementById('servicesMonitorSection');
    const configSection = document.getElementById('configSection');
    if (dashboardSection) dashboardSection.style.display = 'none';
    if (configSection) configSection.style.display = 'none';
    if (servicesSection) servicesSection.style.display = 'block';
    renderMonitoredServices();
}

function closeServicesMonitor() {
    const dashboardSection = document.getElementById('dashboardSection');
    const servicesSection = document.getElementById('servicesMonitorSection');
    if (servicesSection) servicesSection.style.display = 'none';
    if (dashboardSection) dashboardSection.style.display = '';
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
    
    try {
        localStorage.setItem('preferred_language', lang);
    } catch (_) {}
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
        loadingText: 'loadingClusterData',
        totalNodesLabel: 'totalNodes',
        onlineNodesLabel: 'nodesOnline',
        quorumLabel: 'quorum',
        clusterResources: 'clusterResources',
        cpuLabel: 'cpu',
        memoryLabel: 'memory',
        virtualizationLabel: 'virtualization',
        tabNodes: 'tabNodes',
        tabStorage: 'tabStorage',
        tabServers: 'tabServers',
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
        tabServicesMonitor: 'tabServicesMonitor',
        menuServicesMonitorText: 'tabServicesMonitor',
        servicesMonitorTitle: 'servicesMonitorTitle',
        serviceNameLabel: 'serviceNameLabel',
        serviceTypeLabel: 'serviceTypeLabel',
        serviceHostLabel: 'serviceHostLabel',
        servicePortLabel: 'servicePortLabel',
        serviceUrlLabel: 'serviceUrlLabel',
        addServiceText: 'addServiceText',
        servicesListTitle: 'servicesListTitle',
        pingAllText: 'pingAllText',
        serviceNameHeader: 'serviceNameHeader',
        serviceTypeHeader: 'serviceTypeHeader',
        serviceTargetHeader: 'serviceTargetHeader',
        serviceStatusHeader: 'serviceStatusHeader',
        serviceLatencyHeader: 'serviceLatencyHeader',
        serviceActionsHeader: 'serviceActionsHeader',
        backToDashboardText: 'backToDashboardText',
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
        currentServer: 'currentServer',
        monitorModeText: 'monitorMode'
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
    const monitorModeBtn = document.getElementById('monitorModeBtn');
    if (monitorModeBtn) monitorModeBtn.title = t('monitorModeTitle');
    const monitorToolbarTitle = document.getElementById('monitorToolbarTitle');
    if (monitorToolbarTitle) monitorToolbarTitle.textContent = t('monitorMode');
    const monitorExitBtnText = document.getElementById('monitorExitBtnText');
    if (monitorExitBtnText) monitorExitBtnText.textContent = t('monitorExitText');
    const monitorExitBtn = document.getElementById('monitorExitBtnFixed');
    if (monitorExitBtn) monitorExitBtn.title = t('monitorExitTitle');
    const monitorThemeLight = document.getElementById('monitorThemeLight');
    const monitorThemeDark = document.getElementById('monitorThemeDark');
    if (monitorThemeLight) monitorThemeLight.title = t('themeLight');
    if (monitorThemeDark) monitorThemeDark.title = t('themeDark');
    if (monitorMode) {
        setText('monitorTotalNodesLabel', t('totalNodes'));
        setText('monitorOnlineNodesLabel', t('nodesOnline'));
        setText('monitorQuorumLabel', t('quorum'));
        setText('monitorNodesTitle', currentServerType === 'truenas' ? t('tabServers') : t('tabNodes'));
        setText('monitorServicesTitle', t('tabServicesMonitor'));
        setText('monitorVmsLabel', t('virtualization'));
    }
    setText('settingsServicesTitle', t('settingsServicesTitle'));
    setText('settingsServicesHint', t('settingsServicesHint'));
    setText('servicesMonitorHint', t('servicesMonitorHint'));
    setText('settingsServiceNameLabel', t('serviceNameLabel'));
    setText('settingsServiceTypeLabel', t('serviceTypeLabel'));
    setText('settingsServiceHostLabel', t('serviceHostLabel'));
    setText('settingsServicePortLabel', t('servicePortLabel'));
    setText('settingsServiceUrlLabel', t('serviceUrlLabel'));
    setText('settingsServiceNameHeader', t('serviceNameHeader'));
    setText('settingsServiceTypeHeader', t('serviceTypeHeader'));
    setText('settingsServiceTargetHeader', t('serviceTargetHeader'));
    setText('settingsServiceActionsHeader', t('serviceActionsHeader'));
    setText('settingsExportBtn', t('settingsExportBtn'));
    setText('settingsImportBtn', t('settingsImportBtn'));
    setText('settingsNavConnection', t('settingsNavConnection'));
    setText('settingsNavDisplay', t('settingsNavDisplay'));
    setText('settingsNavThresholds', t('settingsNavThresholds'));
    setText('settingsNavServices', t('settingsNavServices'));
    setText('settingsNavSecurity', t('settingsNavSecurity'));
    setText('settingsSecurityTitle', t('settingsSecurityTitle'));
    setText('settingsSecurityHint', t('settingsSecurityHint'));
    setText('settingsPasswordCurrentLabel', t('settingsPasswordCurrentLabel'));
    setText('settingsPasswordNewLabel', t('settingsPasswordNewLabel'));
    setText('settingsPasswordRepeatLabel', t('settingsPasswordRepeatLabel'));
    setText('settingsPasswordApplyText', isSettingsPasswordEnabled() ? t('settingsPasswordChange') : t('settingsPasswordEnable'));
    setText('settingsPasswordDisableText', t('settingsPasswordDisable'));
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
    
    // Load saved settings from API (servers, thresholds, defaults, etc.)
    const settingsData = await loadSettings();

    // Determine language: localStorage -> default from settings -> first available
    let storedLang = null;
    try {
        storedLang = localStorage.getItem('preferred_language');
    } catch (_) {}
    const defaultLang = settingsData && settingsData.preferred_language ? settingsData.preferred_language : null;
    const chosenLang = (storedLang && availableLanguages.includes(storedLang))
        ? storedLang
        : (defaultLang && availableLanguages.includes(defaultLang)
            ? defaultLang
            : (availableLanguages[0] || 'ru'));
    setLanguage(chosenLang);
    setServerType(currentServerType);

    toggleServiceTypeFields();
    renderMonitoredServices();
    renderSettingsMonitoredServices();
    
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
    saveSettingsToServer({ connectionIdMap: { ...connectionIdMap } });
}

// Check saved token
async function checkSavedToken() {
    try {
        const response = await fetch(currentServerType === 'truenas' ? '/api/truenas/auth/key' : '/api/auth/token');
        const data = await response.json();
        
        const key = data.token || data.apiKey;
        if (data.success && key) {
            apiToken = key;
            const savedServerUrl = data.serverUrl;
            if (savedServerUrl) {
                if (currentServerType === 'truenas') {
                    truenasServers = [savedServerUrl];
                    currentTrueNASServerIndex = 0;
                    saveSettingsToServer({ truenasServers: [...truenasServers], currentTrueNASServerIndex: 0 });
                } else {
                    proxmoxServers = [savedServerUrl];
                    currentServerIndex = 0;
                    saveSettingsToServer({ proxmoxServers: [...proxmoxServers], currentServerIndex: 0 });
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
        saveSettingsToServer({ connectionIdMap: { ...connectionIdMap } });
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

async function ensureSettingsUnlocked() {
    if (!isSettingsPasswordEnabled()) return true;
    if (settingsUnlocked) return true;
    const entered = prompt(t('enterSettingsPassword') || 'Введите пароль для настроек');
    if (entered === null) return false;
    try {
        const resp = await fetch('/api/settings/unlock', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ password: entered })
        });
        const data = await resp.json();
        if (data.success) {
            settingsUnlocked = true;
            showToast(t('settingsPasswordUnlocked') || 'Настройки разблокированы', 'success');
            return true;
        }
    } catch (e) {
        console.error(e);
    }
    showToast(t('settingsPasswordIncorrect') || 'Неверный пароль', 'error');
    return false;
}

// Show settings section
async function showConfig() {
    if (!(await ensureSettingsUnlocked())) return;
    document.getElementById('configSection').style.display = 'block';
    document.getElementById('dashboardSection').style.display = 'none';
    const servicesSection = document.getElementById('servicesMonitorSection');
    if (servicesSection) servicesSection.style.display = 'none';
    renderSettingsMonitoredServices();
    if (autoRefreshInterval) {
        clearInterval(autoRefreshInterval);
        autoRefreshInterval = null;
    }
}

// Toggle settings visibility
async function toggleSettings() {
    const configSection = document.getElementById('configSection');
    const dashboardSection = document.getElementById('dashboardSection');
    
    const servicesSection = document.getElementById('servicesMonitorSection');
    if (configSection.style.display === 'none' || configSection.style.display === '') {
        if (!(await ensureSettingsUnlocked())) return;
        configSection.style.display = 'block';
        dashboardSection.style.display = 'none';
        if (servicesSection) servicesSection.style.display = 'none';
        if (autoRefreshInterval) {
            clearInterval(autoRefreshInterval);
            autoRefreshInterval = null;
        }
    } else {
        configSection.style.display = 'none';
        dashboardSection.style.display = 'block';
        if (servicesSection) servicesSection.style.display = 'none';
        if (apiToken) {
            refreshData();
            startAutoRefresh();
        }
    }
}

// Toggle monitor mode — показываем полный дашборд (крупные блоки), переключение по свайпам
async function toggleMonitorMode() {
    monitorMode = !monitorMode;
    saveSettingsToServer({ monitorMode });

    const dashboardContent = document.getElementById('dashboardContent');
    const monitorView = document.getElementById('monitorView');
    if (dashboardContent) dashboardContent.style.display = 'block';
    if (monitorView) monitorView.style.display = 'none';

    document.body.classList.toggle('monitor-mode', monitorMode);

    const btn = document.getElementById('monitorModeBtn');
    if (monitorMode) {
        btn.classList.add('active');
        btn.classList.remove('btn-outline-info');
        btn.classList.add('btn-info');
        btn.innerHTML = '<i class="bi bi-check-lg"></i> <span id="monitorModeText">' + t('monitorModeOn') + '</span>';
        monitorCurrentView = currentServerType === 'truenas' ? 'truenas' : 'proxmox';
        applyMonitorView(monitorCurrentView);
        applyMonitorTheme();
        initMonitorSwipes();
    } else {
        btn.classList.remove('active');
        btn.classList.remove('btn-info');
        btn.classList.add('btn-outline-info');
        btn.innerHTML = '<i class="bi bi-display"></i> <span id="monitorModeText">' + t('monitorMode') + '</span>';
        document.body.classList.remove('monitor-theme-dark');
        destroyMonitorSwipes();
    }

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
        console.warn('Fullscreen toggle failed:', e);
    }

    if (apiToken) refreshData();
}

let monitorSwipeStartX = null;
let monitorSwipeHandlersAttached = false;
/** Текущий раздел в режиме монитора: 'proxmox' | 'truenas' | 'services' */
let monitorCurrentView = 'proxmox';

const MONITOR_VIEWS = ['proxmox', 'truenas', 'services'];

function applyMonitorView(view) {
    monitorCurrentView = view;
    const dashboardSection = document.getElementById('dashboardSection');
    const servicesSection = document.getElementById('servicesMonitorSection');
    if (view === 'proxmox' || view === 'truenas') {
        if (dashboardSection) dashboardSection.style.display = 'block';
        if (servicesSection) servicesSection.style.display = 'none';
        setServerType(view);
    } else {
        if (dashboardSection) dashboardSection.style.display = 'none';
        if (servicesSection) {
            servicesSection.style.display = 'block';
            renderMonitoredServices();
        }
    }
}

function setMonitorTheme(theme) {
    monitorTheme = theme === 'dark' ? 'dark' : 'light';
    saveSettingsToServer({ monitorTheme });
    if (monitorMode) applyMonitorTheme();
}

function applyMonitorTheme() {
    document.body.classList.toggle('monitor-theme-dark', monitorTheme === 'dark');
    const lightBtn = document.getElementById('monitorThemeLight');
    const darkBtn = document.getElementById('monitorThemeDark');
    if (lightBtn) lightBtn.classList.toggle('active', monitorTheme === 'light');
    if (darkBtn) darkBtn.classList.toggle('active', monitorTheme === 'dark');
}

function goMonitorView(direction) {
    const currentIndex = MONITOR_VIEWS.indexOf(monitorCurrentView);
    const nextIndex = direction === 'next'
        ? (currentIndex + 1) % MONITOR_VIEWS.length
        : (currentIndex - 1 + MONITOR_VIEWS.length) % MONITOR_VIEWS.length;
    applyMonitorView(MONITOR_VIEWS[nextIndex]);
}

function destroyMonitorSwipes() {
    monitorSwipeStartX = null;
    monitorSwipeHandlersAttached = false;
    const target = document.body;
    if (!target._monitorSwipeStart) return;
    target.removeEventListener('touchstart', target._monitorSwipeStart);
    target.removeEventListener('touchend', target._monitorSwipeEnd);
    delete target._monitorSwipeStart;
    delete target._monitorSwipeEnd;
}

function initMonitorSwipes() {
    if (monitorSwipeHandlersAttached) return;
    const minDist = 80;
    function onStart(e) {
        const x = e.touches ? e.touches[0].clientX : e.clientX;
        monitorSwipeStartX = x;
    }
    function onEnd(e) {
        if (monitorSwipeStartX == null) return;
        const x = e.changedTouches ? e.changedTouches[0].clientX : e.clientX;
        const delta = x - monitorSwipeStartX;
        if (delta < -minDist) goMonitorView('next');
        else if (delta > minDist) goMonitorView('prev');
        monitorSwipeStartX = null;
    }
    document.body._monitorSwipeStart = onStart;
    document.body._monitorSwipeEnd = onEnd;
    document.body.addEventListener('touchstart', onStart, { passive: true });
    document.body.addEventListener('touchend', onEnd, { passive: true });
    document.body.addEventListener('mousedown', function mouseStart(e) {
        monitorSwipeStartX = e.clientX;
        function mouseEnd(ev) {
            const d = ev.clientX - monitorSwipeStartX;
            if (Math.abs(d) > minDist) goMonitorView(d < 0 ? 'next' : 'prev');
            document.body.removeEventListener('mouseup', mouseEnd);
        }
        document.body.addEventListener('mouseup', mouseEnd, { once: true });
    });
    monitorSwipeHandlersAttached = true;
}

// Show dashboard
function showDashboard() {
    document.getElementById('configSection').style.display = 'none';
    document.getElementById('dashboardSection').style.display = 'block';
    const servicesSection = document.getElementById('servicesMonitorSection');
    if (servicesSection) servicesSection.style.display = 'none';
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
        if (monitorMode) {
            const toolbarEl = document.getElementById('monitorToolbarUpdate');
            if (toolbarEl) {
                const now = new Date();
                const timeStr = now.getHours().toString().padStart(2, '0') + ':' + now.getMinutes().toString().padStart(2, '0');
                toolbarEl.textContent = t('lastUpdated') + ' ' + timeStr;
            }
            checkAllServices().then(() => renderMonitorServicesList());
        }
        if (!silent) showToast(t('dataUpdated'), 'success');

    } catch (error) {
        if (!silent) showToast(t('errorUpdate') + ': ' + error.message, 'error');
    } finally {
        if (!silent) showLoading(false);
        isRefreshing = false;
    }
}

function updateTrueNASDashboard(systemData, poolsData) {
    const sys = systemData && typeof systemData === 'object' ? systemData : {};
    const hostname = sys.hostname || sys.system_hostname || sys.host || 'TrueNAS';
    const version = sys.version || sys.product_version || sys.release || '';
    const uptimeRaw = sys.uptime;
    const uptimeStr = (typeof uptimeRaw === 'number' && uptimeRaw >= 0)
        ? formatUptime(uptimeRaw)
        : (uptimeRaw && String(uptimeRaw).trim() ? String(uptimeRaw) : '');

    // Попробуем вытащить CPU usage
    let cpuPercent = null;
    if (typeof sys.cpu_usage === 'number') {
        cpuPercent = Math.max(0, Math.min(100, Math.round(sys.cpu_usage)));
    } else if (Array.isArray(sys.loadavg) && typeof sys.loadavg[0] === 'number' && typeof sys.cores === 'number' && sys.cores > 0) {
        cpuPercent = Math.max(0, Math.min(100, Math.round((sys.loadavg[0] / sys.cores) * 100)));
    }

    // И память
    let memTotal = null;
    let memUsed = null;
    if (sys.memory && typeof sys.memory === 'object') {
        const m = sys.memory;
        // TrueNAS часто возвращает байты
        if (typeof m.total === 'number' && typeof m.free === 'number') {
            memTotal = m.total;
            memUsed = m.total - m.free;
        } else if (typeof m.total === 'number' && typeof m.used === 'number') {
            memTotal = m.total;
            memUsed = m.used;
        }
    }

    setText('totalNodes', '1');
    setText('onlineNodes', '1');
    setHTML('quorumStatus', t('notApplicable'));
    const quorumEl = document.getElementById('quorumStatus');
    if (quorumEl) quorumEl.className = 'stat-value text-muted';
    setHTML('connectionStatus', '<i class="bi bi-check-circle-fill text-success"></i> ' + t('connected'));

    // CPU card
    if (cpuPercent !== null) {
        setText('clusterCpu', cpuPercent + '%');
        setText('clusterCpuDetail', t('truenasSystem'));
        const cpuBar = document.getElementById('clusterCpuBar');
        if (cpuBar) cpuBar.style.width = cpuPercent + '%';
    } else {
        setText('clusterCpu', '—');
        setText('clusterCpuDetail', t('truenasSystem'));
        const cpuBar = document.getElementById('clusterCpuBar');
        if (cpuBar) cpuBar.style.width = '0%';
    }

    // Memory card
    if (memTotal && memUsed !== null) {
        const memPercent = memTotal > 0 ? Math.round((memUsed / memTotal) * 100) : 0;
        setText('clusterMemory', memPercent + '%');
        setText('clusterMemoryDetail', `${formatSize(memUsed)} / ${formatSize(memTotal)}`);
        const memBar = document.getElementById('clusterMemoryBar');
        if (memBar) memBar.style.width = memPercent + '%';
    } else {
        setText('clusterMemory', '—');
        setText('clusterMemoryDetail', version ? `${hostname} • ${version}` : hostname);
        const memBar = document.getElementById('clusterMemoryBar');
        if (memBar) memBar.style.width = '0%';
    }

    setText('clusterVms', '—');
    setText('clusterContainers', '—');

    const serversContainer = document.getElementById('serversContainer') || document.getElementById('nodesContainer');
    if (serversContainer) {
        setHTMLIfChanged(serversContainer.id, `
            <div class="col-12">
                <div class="node-card">
                    <div class="d-flex justify-content-between align-items-center mb-2">
                        <h5 class="mb-0">${escapeHtml(hostname)}</h5>
                        <span class="badge bg-success">${t('connected')}</span>
                    </div>
                    <div class="text-muted small">
                        ${version ? `<div><strong>${t('version')}:</strong> ${escapeHtml(version)}</div>` : ''}
                        ${uptimeStr ? `<div><strong>${t('uptime')}:</strong> ${escapeHtml(uptimeStr)}</div>` : ''}
                    </div>
                </div>
            </div>
        `);
    }


    const pools = (poolsData && Array.isArray(poolsData.all)) ? poolsData.all : [];
    const summary = (poolsData && poolsData.summary) ? poolsData.summary : { total: 0, active: 0, total_space: 0, used_space: 0 };
    updateStorageUI({
        all: pools.map(p => ({
            ...p,
            used_fmt: formatSize(p.used),
            total_fmt: formatSize(p.total)
        })),
        byType: (poolsData && poolsData.byType) ? poolsData.byType : { pool: { count: 0, total: 0, used: 0 } },
        summary: {
            ...summary,
            total_space_fmt: formatSize(summary.total_space),
            used_space_fmt: formatSize(summary.used_space)
        }
    });

    // Clear backups table if present
    if (backupsTable) {
        backupsTable.destroy();
        backupsTable = null;
    }

    setHTMLIfChanged('lastUpdate', '<i class="bi bi-clock"></i> ' + t('lastUpdate') + ': ' + new Date().toLocaleString(currentLanguage === 'ru' ? 'ru-RU' : 'en-US'));

    lastTrueNASData = { system: systemData, pools: poolsData };
    if (monitorMode) {
        updateMonitorViewTrueNAS(systemData, poolsData);
        renderMonitorServicesList();
    }
}

// Компактный вид режима монитора (Proxmox)
function updateMonitorView(clusterData) {
    if (!clusterData || !clusterData.nodes) return;
    const total = clusterData.nodes.length;
    const online = clusterData.nodes.filter(n => n.status === 'online').length;
    const quorumOk = clusterData.quorum && online >= clusterData.quorum.quorum;
    setText('monitorTotalNodes', String(total));
    setText('monitorOnlineNodes', String(online));
    setText('monitorQuorum', quorumOk ? t('quorumEnough') : t('quorumNotEnough'));
    setText('monitorTotalNodesLabel', t('totalNodes'));
    setText('monitorOnlineNodesLabel', t('nodesOnline'));
    setText('monitorQuorumLabel', t('quorum'));
    const summary = clusterData.cluster && clusterData.cluster.summary ? clusterData.cluster.summary : {};
    const cpuPct = summary.cpuUsagePercent != null ? summary.cpuUsagePercent : 0;
    const memPct = summary.memoryUsagePercent != null ? summary.memoryUsagePercent : 0;
    setText('monitorCpu', cpuPct + '%');
    setText('monitorMemory', memPct + '%');
    setText('monitorVms', String(summary.totalVMs || 0));
    setText('monitorVmsLabel', t('virtualization'));
    const cpuBar = el('monitorCpuBar');
    if (cpuBar) cpuBar.style.width = Math.min(100, cpuPct) + '%';
    const memBar = el('monitorMemoryBar');
    if (memBar) memBar.style.width = Math.min(100, memPct) + '%';
    setText('monitorNodesTitle', t('tabNodes'));
    const listEl = el('monitorNodesList');
    if (listEl) {
        listEl.innerHTML = clusterData.nodes.map(node => {
            const statusClass = node.status === 'online' ? 'online' : 'offline';
            return `<div class="monitor-view__node-row"><span class="monitor-view__node-name">${escapeHtml(node.name)}</span><span class="monitor-view__node-status ${statusClass}" title="${node.status === 'online' ? t('nodeOnline') : t('nodeOffline')}"></span></div>`;
        }).join('');
    }
}

// Компактный вид режима монитора (TrueNAS)
function updateMonitorViewTrueNAS(systemData, poolsData) {
    const sys = systemData && typeof systemData === 'object' ? systemData : {};
    setText('monitorTotalNodes', '1');
    setText('monitorOnlineNodes', '1');
    setText('monitorQuorum', t('notApplicable'));
    setText('monitorTotalNodesLabel', t('totalNodes'));
    setText('monitorOnlineNodesLabel', t('nodesOnline'));
    setText('monitorQuorumLabel', t('quorum'));
    let cpuPct = 0, memPct = 0;
    if (typeof sys.cpu_usage === 'number') cpuPct = Math.round(sys.cpu_usage);
    else if (Array.isArray(sys.loadavg) && sys.cores) cpuPct = Math.min(100, Math.round((sys.loadavg[0] / sys.cores) * 100));
    if (sys.memory && typeof sys.memory.total === 'number' && typeof sys.memory.used === 'number') {
        memPct = sys.memory.total > 0 ? Math.round((sys.memory.used / sys.memory.total) * 100) : 0;
    } else if (sys.memory && sys.memory.total && sys.memory.free != null) {
        memPct = sys.memory.total > 0 ? Math.round(((sys.memory.total - sys.memory.free) / sys.memory.total) * 100) : 0;
    }
    setText('monitorCpu', cpuPct + '%');
    setText('monitorMemory', memPct + '%');
    setText('monitorVms', '—');
    setText('monitorVmsLabel', t('virtualization'));
    const cpuBar = el('monitorCpuBar');
    if (cpuBar) cpuBar.style.width = cpuPct + '%';
    const memBar = el('monitorMemoryBar');
    if (memBar) memBar.style.width = memPct + '%';
    const hostname = sys.hostname || sys.system_hostname || sys.host || 'TrueNAS';
    setText('monitorNodesTitle', t('tabServers'));
    const listEl = el('monitorNodesList');
    if (listEl) {
        listEl.innerHTML = `<div class="monitor-view__node-row"><span class="monitor-view__node-name">${escapeHtml(hostname)}</span><span class="monitor-view__node-status online" title="${t('connected')}"></span></div>`;
    }
}

// Список сервисов в компактном виде монитора
function renderMonitorServicesList() {
    const listEl = document.getElementById('monitorServicesList');
    if (!listEl) return;
    const list = Array.isArray(monitoredServices) ? monitoredServices : [];
    setText('monitorServicesTitle', t('tabServicesMonitor'));
    if (!list.length) {
        listEl.innerHTML = '<div class="text-muted small">' + (t('servicesListTitle') || 'Сервисы') + '</div>';
        return;
    }
    listEl.innerHTML = list.map(s => {
        const name = s.name || getServiceTargetDisplay(s);
        const dotClass = s.lastStatus === 'up' ? 'up' : (s.lastStatus === 'down' ? 'down' : 'unknown');
        return `<div class="monitor-view__service-row"><span class="monitor-view__service-name" title="${escapeHtml(getServiceTargetDisplay(s))}">${escapeHtml(name)}</span><span class="monitor-view__service-dot ${dotClass}" title="${s.lastStatus === 'up' ? t('connected') : (s.lastStatus === 'down' ? t('serverError') : t('notConnected'))}"></span></div>`;
    }).join('');
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

    lastClusterData = clusterData;
    if (monitorMode) {
        updateMonitorView(clusterData);
        renderMonitorServicesList();
    }
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

// ==================== SERVICE MONITORING (отдельная вкладка, TCP/UDP/HTTP) ====================

// Monitored services are persisted via API; no local save needed

function toggleServiceTypeFields() {
    const typeSelect = document.getElementById('settingsServiceTypeSelect');
    const hostWrap = document.getElementById('settingsServiceHostWrap');
    const portWrap = document.getElementById('settingsServicePortWrap');
    const urlWrap = document.getElementById('settingsServiceUrlWrap');
    if (!typeSelect || !hostWrap || !portWrap || !urlWrap) return;
    const type = (typeSelect.value || 'tcp').toLowerCase();
    const isHttp = type === 'http' || type === 'https';
    hostWrap.classList.toggle('d-none', isHttp);
    portWrap.classList.toggle('d-none', isHttp);
    urlWrap.classList.toggle('d-none', !isHttp);
}

function getServiceTargetDisplay(s) {
    if (s.type === 'http' || s.type === 'https' || s.url) return s.url || '—';
    const host = s.host || '';
    const port = s.port != null ? s.port : '';
    return host && port ? `${host}:${port}` : (host || port || '—');
}

function buildServiceTargetForApi(s) {
    const type = (s.type || 'tcp').toLowerCase();
    const name = s.name || getServiceTargetDisplay(s);
    if (type === 'http' || type === 'https') {
        return { name, type: 'http', url: (s.url || '').trim() };
    }
    return { name, type: type || 'tcp', host: (s.host || '').trim(), port: parseInt(s.port, 10) };
}

function renderMonitoredServices() {
    const body = document.getElementById('servicesBody');
    if (!body) return;
    const list = Array.isArray(monitoredServices) ? monitoredServices : [];
    const rows = list.map((s, idx) => {
        const statusBadge = s.lastStatus === 'up'
            ? `<span class="badge bg-success">${t('connected')}</span>`
            : (s.lastStatus === 'down'
                ? `<span class="badge bg-danger">${t('serverError')}</span>`
                : `<span class="badge bg-secondary">${t('notConnected')}</span>`);
        const latency = typeof s.lastLatency === 'number' ? `${s.lastLatency} ms` : '—';
        const typeLabel = (s.type || 'tcp').toUpperCase();
        const target = getServiceTargetDisplay(s);
        return `
            <tr>
                <td>${escapeHtml(s.name || target)}</td>
                <td><span class="badge bg-secondary">${escapeHtml(typeLabel)}</span></td>
                <td><code>${escapeHtml(target)}</code></td>
                <td>${statusBadge}</td>
                <td>${latency}</td>
            </tr>
        `;
    }).join('');
    setHTMLIfChanged('servicesBody', rows || '');
}

function renderSettingsMonitoredServices() {
    const body = document.getElementById('settingsServicesBody');
    if (!body) return;
    const list = Array.isArray(monitoredServices) ? monitoredServices : [];
    const rows = list.map((s) => {
        const typeLabel = (s.type || 'tcp').toUpperCase();
        const target = getServiceTargetDisplay(s);
        const id = s.id != null ? s.id : 0;
        return `
            <tr>
                <td>${escapeHtml(s.name || target)}</td>
                <td><span class="badge bg-secondary">${escapeHtml(typeLabel)}</span></td>
                <td><code>${escapeHtml(target)}</code></td>
                <td class="text-nowrap">
                    <button class="btn btn-sm btn-outline-danger" onclick="removeMonitoredService(${id})" title="${t('remove') || 'Удалить'}">
                        <i class="bi bi-trash"></i>
                    </button>
                </td>
            </tr>
        `;
    }).join('');
    setHTMLIfChanged('settingsServicesBody', rows || '');
}

async function checkService(index) {
    const list = Array.isArray(monitoredServices) ? monitoredServices : [];
    const svc = list[index];
    if (!svc) return;
    try {
        const resp = await fetch('/api/health/check', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ targets: [buildServiceTargetForApi(svc)] })
        });
        const data = await resp.json();
        const r = data.results && data.results[0];
        if (r) {
            svc.lastStatus = r.up ? 'up' : 'down';
            svc.lastLatency = r.latency ?? null;
            try {
                await fetch(`/api/settings/services/${svc.id}`, {
                    method: 'PATCH',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ lastStatus: svc.lastStatus, lastLatency: svc.lastLatency })
                });
            } catch (_) {}
        }
        renderMonitoredServices();
        renderSettingsMonitoredServices();
    } catch (e) {
        showToast(t('connectError') + ': ' + e.message, 'error');
    }
}

async function checkAllServices() {
    const list = Array.isArray(monitoredServices) ? monitoredServices : [];
    if (!list.length) return;
    try {
        const targets = list.map(buildServiceTargetForApi);
        const resp = await fetch('/api/health/check', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ targets })
        });
        const data = await resp.json();
        const results = data.results || [];
        results.forEach((r, i) => {
            if (!list[i]) return;
            list[i].lastStatus = r.up ? 'up' : 'down';
            list[i].lastLatency = r.latency ?? null;
        });
        await Promise.all(list.map((s) =>
            fetch(`/api/settings/services/${s.id}`, {
                method: 'PATCH',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ lastStatus: s.lastStatus, lastLatency: s.lastLatency })
            }).catch(() => {})
        ));
        renderMonitoredServices();
    } catch (e) {
        showToast(t('connectError') + ': ' + e.message, 'error');
    }
}

async function exportSettingsAndServices() {
    try {
        const resp = await fetch('/api/settings/export');
        if (!resp.ok) {
            const data = await resp.json().catch(() => ({}));
            throw new Error(data.error || `HTTP ${resp.status}`);
        }
        const json = await resp.json();
        const blob = new Blob([JSON.stringify(json, null, 2)], { type: 'application/json' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = 'proxmox-monitor-settings.json';
        document.body.appendChild(a);
        a.click();
        a.remove();
        URL.revokeObjectURL(url);
    } catch (e) {
        showToast((t('settingsImportError') || t('errorUpdate')) + ': ' + e.message, 'error');
    }
}

function triggerImportSettings() {
    const input = document.getElementById('settingsImportFile');
    if (input) input.click();
}

async function handleImportSettingsFile(event) {
    const file = event.target.files && event.target.files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = async (e) => {
        let parsed;
        try {
            parsed = JSON.parse(String(e.target.result || ''));
        } catch {
            showToast(t('settingsImportError') || 'Неверный файл импорта', 'error');
            return;
        }
        try {
            const resp = await fetch('/api/settings/import', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(parsed)
            });
            const data = await resp.json().catch(() => ({}));
            if (!resp.ok || data.success === false) {
                throw new Error(data.error || `HTTP ${resp.status}`);
            }
            showToast(t('settingsImportSuccess') || 'Настройки импортированы, данные обновлены', 'success');
            const settingsData = await loadSettings();
            monitoredServices = Array.isArray((await fetch('/api/settings/services').then(r => r.json())).services) ? (await fetch('/api/settings/services').then(r => r.json())).services : [];
            renderMonitoredServices();
            renderSettingsMonitoredServices();
        } catch (err) {
            showToast((t('settingsImportError') || t('errorUpdate')) + ': ' + err.message, 'error');
        } finally {
            event.target.value = '';
        }
    };
    reader.readAsText(file, 'utf-8');
}

async function addMonitoredService() {
    const nameInput = document.getElementById('settingsServiceNameInput');
    const typeSelect = document.getElementById('settingsServiceTypeSelect');
    const hostInput = document.getElementById('settingsServiceHostInput');
    const portInput = document.getElementById('settingsServicePortInput');
    const urlInput = document.getElementById('settingsServiceUrlInput');
    if (!typeSelect) return;
    const type = (typeSelect.value || 'tcp').toLowerCase();
    const name = nameInput ? nameInput.value.trim() : '';
    let body = { name, type: type === 'https' ? 'https' : (type === 'http' ? 'http' : type) };
    if (type === 'http' || type === 'https') {
        const url = urlInput ? urlInput.value.trim() : '';
        if (!url) {
            showToast(t('serviceUrlRequired') || 'Укажите URL', 'error');
            return;
        }
        body.url = url;
    } else {
        const host = hostInput ? hostInput.value.trim() : '';
        const port = portInput ? parseInt(portInput.value, 10) : null;
        if (!host || !port || port < 1 || port > 65535) {
            showToast(t('serviceHostPortRequired') || 'Укажите хост и порт (1–65535)', 'error');
            return;
        }
        body.host = host;
        body.port = port;
    }
    try {
        const resp = await fetch('/api/settings/services', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(body)
        });
        const data = await resp.json();
        if (!resp.ok) {
            showToast(data.error || 'Error', 'error');
            return;
        }
        const list = (await fetch('/api/settings/services').then(r => r.json())).services || [];
        monitoredServices = list;
        if (nameInput) nameInput.value = '';
        if (urlInput) urlInput.value = '';
        if (hostInput) hostInput.value = '';
        if (portInput) portInput.value = '';
        renderMonitoredServices();
        renderSettingsMonitoredServices();
        showToast(t('dataUpdated'), 'success');
    } catch (e) {
        showToast(t('connectError') + ': ' + e.message, 'error');
    }
}

async function removeMonitoredService(id) {
    try {
        const resp = await fetch(`/api/settings/services/${id}`, { method: 'DELETE' });
        if (!resp.ok) {
            const data = await resp.json().catch(() => ({}));
            showToast(data.error || 'Error', 'error');
            return;
        }
        monitoredServices = monitoredServices.filter(s => s.id !== id);
        renderMonitoredServices();
        renderSettingsMonitoredServices();
    } catch (e) {
        showToast(t('connectError') + ': ' + e.message, 'error');
    }
}

function updateSettingsSecurityUI() {
    const hasPassword = isSettingsPasswordEnabled();
    const applyText = hasPassword ? t('settingsPasswordChange') : t('settingsPasswordEnable');
    setText('settingsPasswordApplyText', applyText);
    setText('settingsPasswordDisableText', t('settingsPasswordDisable'));
    const disableBtn = el('settingsPasswordDisableBtn');
    if (disableBtn) disableBtn.disabled = !hasPassword;
}

async function applySettingsPassword() {
    const currentEl = el('settingsPasswordCurrent');
    const newEl = el('settingsPasswordNew');
    const repeatEl = el('settingsPasswordRepeat');
    const current = currentEl ? currentEl.value : '';
    const next = newEl ? newEl.value : '';
    const repeat = repeatEl ? repeatEl.value : '';
    if (!next) {
        showToast(t('settingsPasswordEmptyNew') || 'Введите новый пароль', 'error');
        return;
    }
    if (next !== repeat) {
        showToast(t('settingsPasswordMismatch') || 'Пароли не совпадают', 'error');
        return;
    }
    try {
        const resp = await fetch('/api/settings/password', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ currentPassword: current || undefined, newPassword: next })
        });
        const data = await resp.json();
        if (!data.success) {
            if (data.error === 'wrong_current') {
                showToast(t('settingsPasswordWrongCurrent') || 'Неверный текущий пароль', 'error');
            } else {
                showToast(data.error || t('settingsPasswordWrongCurrent'), 'error');
            }
            return;
        }
        settingsPasswordRequired = true;
        settingsUnlocked = true;
        if (currentEl) currentEl.value = '';
        if (newEl) newEl.value = '';
        if (repeatEl) repeatEl.value = '';
        updateSettingsSecurityUI();
        showToast((isSettingsPasswordEnabled() ? t('settingsPasswordChanged') : t('settingsPasswordEnabled')) || 'Пароль для настроек сохранён', 'success');
    } catch (e) {
        showToast(t('connectError') + ': ' + e.message, 'error');
    }
}

async function disableSettingsPassword() {
    const currentEl = el('settingsPasswordCurrent');
    const current = currentEl ? currentEl.value : '';
    if (!settingsPasswordRequired) {
        showToast(t('settingsPasswordNotSet') || 'Пароль не задан', 'info');
        return;
    }
    try {
        const resp = await fetch('/api/settings/password', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ currentPassword: current, newPassword: '' })
        });
        const data = await resp.json();
        if (!data.success) {
            if (data.error === 'wrong_current') {
                showToast(t('settingsPasswordWrongCurrent') || 'Неверный текущий пароль', 'error');
            } else {
                showToast(data.error || 'Error', 'error');
            }
            return;
        }
        settingsPasswordRequired = false;
        settingsUnlocked = true;
        if (currentEl) currentEl.value = '';
        const newEl = el('settingsPasswordNew');
        const repeatEl = el('settingsPasswordRepeat');
        if (newEl) newEl.value = '';
        if (repeatEl) repeatEl.value = '';
        updateSettingsSecurityUI();
        showToast(t('settingsPasswordDisabled') || 'Пароль для настроек отключён', 'success');
    } catch (e) {
        showToast(t('connectError') + ': ' + e.message, 'error');
    }
}

// ==================== NEW SETTINGS FUNCTIONS ====================

// Load settings from API (database)
async function loadSettings() {
    let data = {};
    let servicesData = { services: [] };
    try {
        const [settingsRes, servicesRes] = await Promise.all([
            fetch('/api/settings'),
            fetch('/api/settings/services')
        ]);
        if (settingsRes.ok) data = await settingsRes.json();
        if (servicesRes.ok) servicesData = await servicesRes.json();
    } catch (e) {
        console.error('Failed to load settings:', e);
    }

    settingsPasswordRequired = !!data.password_required;

    if (data.refresh_interval != null) {
        refreshIntervalMs = parseInt(data.refresh_interval, 10) || 30000;
        const sel = document.getElementById('refreshIntervalSelect');
        if (sel) sel.value = refreshIntervalMs;
    }
    if (data.theme) {
        currentTheme = data.theme;
        applyTheme(currentTheme);
    }
    if (data.units) {
        currentUnits = data.units;
        updateUnitsButtons();
    }
    if (data.thresholds && typeof data.thresholds === 'object') {
        thresholds = { ...thresholds, ...data.thresholds };
        const g = document.getElementById('cpuGreenThreshold');
        const y = document.getElementById('cpuYellowThreshold');
        const rg = document.getElementById('ramGreenThreshold');
        const ry = document.getElementById('ramYellowThreshold');
        if (g) g.value = thresholds.cpuGreen;
        if (y) y.value = thresholds.cpuYellow;
        if (rg) rg.value = thresholds.ramGreen;
        if (ry) ry.value = thresholds.ramYellow;
        updateThresholdLabels();
    }
    if (Array.isArray(data.proxmox_servers) && data.proxmox_servers.length) proxmoxServers = data.proxmox_servers;
    if (Array.isArray(data.truenas_servers) && data.truenas_servers.length) truenasServers = data.truenas_servers;
    if (data.connection_id_map && typeof data.connection_id_map === 'object') connectionIdMap = data.connection_id_map;
    monitoredServices = Array.isArray(servicesData.services) ? servicesData.services : [];
    if (data.current_server_index != null) currentServerIndex = parseInt(data.current_server_index, 10) || 0;
    if (data.current_truenas_index != null) currentTrueNASServerIndex = parseInt(data.current_truenas_index, 10) || 0;
    if (data.server_type) currentServerType = data.server_type === 'truenas' ? 'truenas' : 'proxmox';
    if (data.monitor_theme === 'light' || data.monitor_theme === 'dark') monitorTheme = data.monitor_theme;
    if (data.monitor_mode === true || data.monitor_mode === 'true') {
        monitorMode = true;
        document.body.classList.add('monitor-mode');
        const dashboardContent = document.getElementById('dashboardContent');
        const monitorView = document.getElementById('monitorView');
        if (dashboardContent) dashboardContent.style.display = 'block';
        if (monitorView) monitorView.style.display = 'none';
        const monitorBtn = document.getElementById('monitorModeBtn');
        if (monitorBtn) {
            monitorBtn.classList.add('active');
            monitorBtn.classList.remove('btn-outline-info');
            monitorBtn.classList.add('btn-info');
            monitorBtn.innerHTML = '<i class="bi bi-check-lg"></i> <span id="monitorModeText">' + t('monitorModeOn') + '</span>';
        }
        monitorCurrentView = currentServerType === 'truenas' ? 'truenas' : 'proxmox';
        applyMonitorTheme();
        initMonitorSwipes();
    }
    updateSettingsSecurityUI();
    renderServerList();
    return data;
}

// Update refresh interval
function updateRefreshInterval() {
    const select = document.getElementById('refreshIntervalSelect');
    refreshIntervalMs = parseInt(select.value, 10);
    saveSettingsToServer({ refreshInterval: refreshIntervalMs });
    showToast(t('dataUpdated'), 'success');
    if (apiToken) startAutoRefresh();
}

// Theme toggle function
function toggleTheme() {
    const newTheme = currentTheme === 'dark' ? 'light' : 'dark';
    setTheme(newTheme);
}

// Set theme
function setTheme(theme) {
    currentTheme = theme;
    saveSettingsToServer({ theme });
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
    saveSettingsToServer({ units });
    updateUnitsButtons();
    if (apiToken) refreshData();
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
    thresholds[type] = parseInt(value, 10);
    saveSettingsToServer({ thresholds: { ...thresholds } });
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
    thresholds = { cpuGreen: 70, cpuYellow: 90, ramGreen: 70, ramYellow: 90 };
    saveSettingsToServer({ thresholds: { ...thresholds } });
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
        saveSettingsToServer({ currentTrueNASServerIndex: index });
    } else {
        currentServerIndex = index;
        saveSettingsToServer({ currentServerIndex: index });
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
    saveSettingsToServer({
        proxmoxServers: [...proxmoxServers],
        truenasServers: [...truenasServers],
        currentServerIndex: currentServerIndex,
        currentTrueNASServerIndex: currentTrueNASServerIndex
    });
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
