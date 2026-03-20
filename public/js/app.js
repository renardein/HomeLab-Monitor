// Global variables
let apiToken = null;
let autoRefreshInterval = null;
let storageTable = null;
let backupsJobsTable = null;
let backupsExecTable = null;
let currentLanguage = 'ru';
let refreshIntervalMs = 30000; // Default refresh interval
let currentTheme = 'light';
let currentUnits = 'decimal'; // 'decimal' (GB) or 'binary' (GiB)
let monitorMode = false; // Monitor (display) mode flag
/** Тема режима монитора: 'light' | 'dark' (независимо от общей темы) */
let monitorTheme = 'dark';
/** Пользовательские CSS-стили для 2 режимов x 2 тем */
let customThemeCss = {
    normal: { light: '', dark: '' },
    monitor: { light: '', dark: '' }
};
let customThemeStyleSettings = null; // plain settings object (generated -> CSS)
const CUSTOM_THEME_STYLE_EL_ID = 'customThemeCssStyle';
/** Разблокированы ли настройки в этой сессии (для защиты паролем) */
let settingsUnlocked = false;
/** Пароль настроек включён (из API) */
let settingsPasswordRequired = false;
/** TTL сессии настроек в минутах (из API, по умолчанию 30) */
let settingsSessionTtlMinutes = 30;
const SETTINGS_UNLOCK_EXPIRY_KEY = 'settings_unlock_expiry';
/** Время последнего успешного обновления данных (для раздела отладки) */
let lastRefreshTime = null;
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
let monitoredServices = []; // [{ id, name, type: 'tcp'|'udp'|'http', host?, port?, url?, lastStatus, lastLatency }]
let monitorHiddenServiceIds = []; // IDs of services to hide in monitor mode (empty = show all)
let monitoredVmIds = []; // VMids that are in the "monitored" list (shown in settings table)
let monitorHiddenVmIds = []; // Of those, VMids to hide in monitor mode (checkbox unchecked)
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

function setPlaceholder(id, value) {
    const e = el(id);
    if (e && 'placeholder' in e) e.placeholder = value;
}

function localizeRefreshIntervalSelect() {
    const sel = document.getElementById('refreshIntervalSelect');
    if (!sel) return;
    const map = {
        5000: 'refreshInterval5s',
        10000: 'refreshInterval10s',
        30000: 'refreshInterval30s',
        60000: 'refreshInterval1m'
    };
    for (let i = 0; i < sel.options.length; i++) {
        const o = sel.options[i];
        const k = map[Number(o.value)];
        if (k) o.textContent = t(k);
    }
}

function localizeYesNoSelect(selectId) {
    const sel = document.getElementById(selectId);
    if (!sel || sel.options.length < 2) return;
    sel.options[0].textContent = t('optionNo');
    sel.options[1].textContent = t('optionYes');
}

function localizeServiceTypeSelect() {
    const sel = document.getElementById('settingsServiceTypeSelect');
    if (!sel) return;
    const map = { tcp: 'TCP', udp: 'UDP', http: 'HTTP(S)', snmp: 'SNMP', nut: t('serviceTypeNut') };
    for (let i = 0; i < sel.options.length; i++) {
        const o = sel.options[i];
        if (map[o.value]) o.textContent = map[o.value];
    }
}

function localizeUpsTypeSelect() {
    const sel = document.getElementById('upsTypeSelect');
    if (!sel) return;
    for (let i = 0; i < sel.options.length; i++) {
        const o = sel.options[i];
        if (o.value === 'nut') o.textContent = t('serviceTypeNut');
        if (o.value === 'snmp') o.textContent = 'SNMP';
    }
}

function syncSettingsConnectionStatusText() {
    ['Proxmox', 'TrueNAS'].forEach((suf) => {
        const tel = document.getElementById('connectionStatusText' + suf);
        const badge = document.getElementById('connectionStatusBadge' + suf);
        if (!tel || !badge) return;
        if (badge.classList.contains('bg-success')) {
            tel.textContent = t('connectionStatusConnected');
        } else {
            tel.textContent = t('connectionStatusDisconnected');
        }
    });
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

// Proxmox token parts (backward compatible with old single-field format)
function syncProxmoxApiTokenFromParts() {
    const idEl = document.getElementById('apiTokenId');
    const secretEl = document.getElementById('apiTokenSecret');
    const hiddenEl = document.getElementById('apiToken');
    if (!idEl || !secretEl || !hiddenEl) return;

    const part1 = (idEl.value || '').trim();
    const part2 = (secretEl.value || '').trim();

    let full = '';
    if (part1) {
        // If user pastes full token into part1 field, allow it for compatibility.
        if (!part2 && part1.includes('=')) {
            full = part1;
        } else if (part2) {
            full = part1 + '=' + part2;
        } else {
            full = part1;
        }
    }

    hiddenEl.value = full;
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
    if (payload.customThemeCss !== undefined) body.customThemeCss = payload.customThemeCss;
    if (payload.customThemeStyleSettings !== undefined) body.customThemeStyleSettings = payload.customThemeStyleSettings;
    if (payload.monitorMode !== undefined) body.monitorMode = payload.monitorMode;
    if (payload.serverType !== undefined) body.serverType = payload.serverType;
    if (payload.currentServerIndex !== undefined) body.currentServerIndex = payload.currentServerIndex;
    if (payload.currentTrueNASServerIndex !== undefined) body.currentTrueNASServerIndex = payload.currentTrueNASServerIndex;
    if (payload.proxmoxServers !== undefined) body.proxmoxServers = payload.proxmoxServers;
    if (payload.truenasServers !== undefined) body.truenasServers = payload.truenasServers;
    if (payload.connectionIdMap !== undefined) body.connectionIdMap = payload.connectionIdMap;
    if (payload.preferredLanguage !== undefined) body.preferredLanguage = payload.preferredLanguage;
    if (payload.monitorHiddenServiceIds !== undefined) body.monitorHiddenServiceIds = payload.monitorHiddenServiceIds;
    if (payload.monitorHiddenVmIds !== undefined) body.monitorHiddenVmIds = payload.monitorHiddenVmIds;
    if (payload.monitorVms !== undefined) body.monitorVms = payload.monitorVms;
    if (payload.monitorScreensOrder !== undefined) body.monitorScreensOrder = payload.monitorScreensOrder;
    if (payload.speedtestEnabled !== undefined) body.speedtestEnabled = !!payload.speedtestEnabled;
    if (payload.speedtestServer !== undefined) body.speedtestServer = payload.speedtestServer;
    if (payload.speedtestPerDay !== undefined) body.speedtestPerDay = payload.speedtestPerDay;
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

/** Подстановка {name} в строку перевода (клиент). */
function tParams(key, vars) {
    let s = t(key);
    if (!vars || typeof vars !== 'object') return s;
    Object.keys(vars).forEach((k) => {
        s = s.split('{' + k + '}').join(String(vars[k]));
    });
    return s;
}

function setServerType(type) {
    currentServerType = (type === 'truenas') ? 'truenas' : 'proxmox';
    saveSettingsToServer({ serverType: currentServerType });

    const monitorSelect = document.getElementById('monitorServerTypeSelect');
    if (monitorSelect) monitorSelect.value = currentServerType;
    const serverMenuTitle = document.getElementById('serverMenuTitle');
    if (serverMenuTitle) {
        serverMenuTitle.textContent = currentServerType === 'truenas' ? 'TrueNAS' : 'Proxmox';
    }

    renderServerList();
    updateCurrentServerBadge();

    // Hide/Show tabs that are not applicable
    const isTrueNAS = currentServerType === 'truenas';
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

    if (monitorMode && isTrueNAS && monitorCurrentView === 'backupRuns') {
        applyMonitorView('cluster');
    }
}

function openServicesMonitorFromMenu() {
    const dashboardSection = document.getElementById('dashboardSection');
    const servicesSection = document.getElementById('servicesMonitorSection');
    const vmsSection = document.getElementById('vmsMonitorSection');
    const backupsMon = document.getElementById('backupsMonitorSection');
    const configSection = document.getElementById('configSection');
    if (dashboardSection) dashboardSection.style.display = 'none';
    if (configSection) configSection.style.display = 'none';
    if (vmsSection) vmsSection.style.display = 'none';
    if (backupsMon) backupsMon.style.display = 'none';
    if (servicesSection) servicesSection.style.display = 'block';
    renderMonitoredServices();
}

function closeServicesMonitor() {
    const dashboardSection = document.getElementById('dashboardSection');
    const servicesSection = document.getElementById('servicesMonitorSection');
    const vmsSection = document.getElementById('vmsMonitorSection');
    const backupsMon = document.getElementById('backupsMonitorSection');
    if (servicesSection) servicesSection.style.display = 'none';
    if (vmsSection) vmsSection.style.display = 'none';
    if (backupsMon) backupsMon.style.display = 'none';
    if (dashboardSection) dashboardSection.style.display = '';
}

function openVmsMonitorFromMenu() {
    const dashboardSection = document.getElementById('dashboardSection');
    const servicesSection = document.getElementById('servicesMonitorSection');
    const vmsSection = document.getElementById('vmsMonitorSection');
    const backupsMon = document.getElementById('backupsMonitorSection');
    const configSection = document.getElementById('configSection');
    if (dashboardSection) dashboardSection.style.display = 'none';
    if (servicesSection) servicesSection.style.display = 'none';
    if (configSection) configSection.style.display = 'none';
    if (backupsMon) backupsMon.style.display = 'none';
    if (vmsSection) vmsSection.style.display = 'block';
    renderVmsMonitorCards();
}

function closeVmsMonitor() {
    const dashboardSection = document.getElementById('dashboardSection');
    const vmsSection = document.getElementById('vmsMonitorSection');
    const backupsMon = document.getElementById('backupsMonitorSection');
    if (vmsSection) vmsSection.style.display = 'none';
    if (backupsMon) backupsMon.style.display = 'none';
    if (dashboardSection) dashboardSection.style.display = '';
}

// Language switch function
function setLanguage(lang) {
    currentLanguage = lang;
    try {
        document.documentElement.lang = lang || 'ru';
    } catch (_) {}

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
    if (backupsJobsTable) {
        backupsJobsTable.destroy();
        backupsJobsTable = null;
    }
    if (backupsExecTable) {
        backupsExecTable.destroy();
        backupsExecTable = null;
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

// Update preferred language in app settings (used as default after .env)
async function updatePreferredLanguage() {
    const select = document.getElementById('settingsPreferredLanguageSelect');
    if (!select) return;
    const lang = select.value;
    try {
        await saveSettingsToServer({ preferredLanguage: lang });
        showToast(t('dataUpdated') || 'Настройки сохранены', 'success');
    } catch (e) {
        console.error('Failed to save preferred language', e);
        showToast(t('connectError') + ': ' + e.message, 'error');
    }
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
        backupSectionJobsTitle: 'backupSectionJobsTitle',
        backupSectionExecTitle: 'backupSectionExecTitle',
        backupJobStateHeader: 'backupJobStateHeader',
        backupExecHint: 'backupExecHint',
        backupExecStartHeader: 'backupExecStartHeader',
        backupExecEndHeader: 'backupExecEndHeader',
        backupExecNodeHeader: 'backupExecNodeHeader',
        backupExecTargetHeader: 'backupExecTargetHeader',
        backupExecStatusHeader: 'backupExecStatusHeader',
        backupExecResultHeader: 'backupExecResultHeader',
        backupExecUserHeader: 'backupExecUserHeader',
        backupExecUpidHeader: 'backupExecUpidHeader',
        backupExecShown: 'backupExecShown',
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
        truenasConnectTitle: 'truenasConnectTitle',
        truenasConnectDesc: 'truenasConnectDesc',
        truenasKeyLabel: 'truenasKeyLabel',
        truenasKeyHint: 'truenasKeyHint',
        truenasServersLabel: 'truenasServersLabel',
        truenasServersHint: 'truenasServersHint',
        addServerTrueNAS: 'addServer',
        logoutTextTrueNAS: 'logoutText',
        connectButtonTrueNAS: 'connectButton',
        testConnectionBtnTextProxmox: 'testConnectionBtn',
        testConnectionBtnTextTrueNAS: 'testConnectionBtn',
        removeServer: 'removeServer',
        currentServer: 'currentServer',
        monitorModeText: 'monitorMode',
        menuVmsMonitorText: 'menuVmsMonitorText',
        settingsNavUps: 'settingsNavUps',
        settingsNavNetdevices: 'settingsNavNetdevices',
        settingsNavSpeedtest: 'settingsNavSpeedtest'
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
    const monitorRefreshBtn = document.getElementById('monitorRefreshBtn');
    if (monitorRefreshBtn) monitorRefreshBtn.title = t('monitorRefreshTitle');
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
        setText('monitorBackupBackText', t('monitorBackupBackText'));
        setText('backupsMonitorTitle', t('backupSectionExecTitle'));
        updateMonitorToolbarTitleForView();
    }
    setText('monitorBlockVmTitle', t('monitorBlockVm'));
    setText('monitorBlockCtTitle', t('monitorBlockCt'));
    setText('monitorVmTotalLbl', t('monitorGuestTotal'));
    setText('monitorVmRunningLbl', t('monitorGuestRunning'));
    setText('monitorCtTotalLbl', t('monitorGuestTotal'));
    setText('monitorCtRunningLbl', t('monitorGuestRunning'));
    setText('dashboardClusterVmTitle', t('monitorBlockVm'));
    setText('dashboardClusterCtTitle', t('monitorBlockCt'));
    setText('dashboardClusterVmRunningLbl', t('monitorGuestRunning'));
    setText('dashboardClusterCtRunningLbl', t('monitorGuestRunning'));
    setText('upsTitle', t('upsTitle') || 'UPS');
    setText('dashboardUpsTitle', t('upsTitle') || 'UPS');
    setText('upsLabelInputVoltage', t('upsLabelInputVoltage') || 'Вход U');
    setText('upsLabelOutputVoltage', t('upsLabelOutputVoltage') || 'Выход U');
    setText('upsLabelPower', t('upsLabelPower') || 'Мощность');
    setText('upsLabelLoad', t('upsLabelLoad') || 'Нагрузка');
    setText('upsLabelFrequency', t('upsLabelFrequency') || 'Частота');
    setText('upsLabelCharge', t('upsLabelCharge') || 'Заряд');
    setText('upsLabelRuntime', t('upsLabelRuntime') || 'Время на батарее');
    setText('upsMonitorBackText', t('backToDashboardText') || 'К дашборду');
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
    setText('settingsServiceMonitorVisibleHeader', t('settingsServiceShowInMonitor'));
    setText('settingsServiceActionsHeader', t('serviceActionsHeader'));
    setText('settingsVmsTitle', t('settingsVmsTitle') || 'VM/CT для мониторинга');
    setText('settingsVmsHint', t('settingsVmsHint') || 'Введите ID или имя VM/CT и нажмите «Добавить» — гость будет отображаться в режиме монитора. Список загружается с Proxmox по кнопке «Обновить».');
    setText('settingsVmNameLabel', t('settingsVmNameLabel') || 'Имя');
    setText('settingsVmTypeLabel', t('settingsVmTypeLabel') || 'Тип');
    setText('settingsVmIdOrNameLabel', t('settingsVmIdOrNameLabel') || 'ID или имя VM/CT');
    setText('addVmToMonitorBtnText', t('addVmToMonitorBtnText') || 'Добавить');
    setText('loadClusterVmsBtnText', t('loadClusterVmsBtnText') || 'Обновить список VM/CT');
    setText('settingsVmNameHeader', t('settingsVmNameHeader') || 'Имя');
    setText('settingsVmTypeHeader', t('settingsVmTypeHeader') || 'Тип');
    setText('settingsVmNoteHeader', t('settingsVmNoteHeader') || 'Примечание');
    setText('settingsVmStatusHeader', t('settingsVmStatusHeader') || 'Статус');
    setText('settingsVmShowInMonitorHeader', t('settingsVmShowInMonitor') || 'В режиме монитора');
    setText('settingsVmActionsHeader', t('settingsVmActionsHeader') || 'Действия');
    setText('settingsNavImportExport', t('settingsNavImportExport') || 'Импорт / экспорт');
    setText('settingsImportExportTitle', t('settingsImportExportTitle') || 'Импорт / экспорт');
    setText('settingsServicesOnlyTitle', t('settingsServicesOnlyTitle') || 'Только хосты мониторинга');
    setText('settingsServicesOnlyHint', t('settingsServicesOnlyHint') || 'Экспорт или импорт только списка хостов для мониторинга сервисов.');
    setText('settingsExportServicesBtn', t('settingsExportServicesBtn') || 'Экспорт хостов');
    setText('settingsImportServicesBtn', t('settingsImportServicesBtn') || 'Импорт хостов');
    setText('settingsVmsOnlyTitle', t('settingsVmsOnlyTitle') || 'Только VM/CT');
    setText('settingsVmsOnlyHint', t('settingsVmsOnlyHint') || 'Экспорт или импорт только списков мониторинга VM/CT.');
    setText('settingsExportVmsBtn', t('settingsExportVmsBtn') || 'Экспорт VM/CT');
    setText('settingsImportVmsBtn', t('settingsImportVmsBtn') || 'Импорт VM/CT');
    setText('settingsAllTitle', t('settingsAllTitle') || 'Полная конфигурация');
    setText('settingsAllHint', t('settingsAllHintTokens') || t('settingsAllHint') || '');
    setText('settingsExportAllBtn', t('settingsExportAllBtn') || 'Экспорт всех настроек');
    setText('settingsImportAllBtn', t('settingsImportAllBtn') || 'Импорт всех настроек');
    setText('settingsNavConnection', t('settingsNavConnection'));
        setText('settingsNavDisplay', t('settingsNavDisplay'));
        setText('settingsNavStyles', t('settingsNavStyles'));
        setText('settingsStylesTitle', t('settingsStylesTitle') || 'Стили');
        setText('settingsStylesVariantLabel', t('settingsStylesVariantLabel') || 'Вариант для редактирования');
        setText('settingsStylesHint', t('settingsStylesHint') || 'Настройки меняют оверрайды для карточек, заголовков, таблиц и прогресса. Оверрайды применяются только к выбранному варианту.');
        setText('settingsStylesCardBgLabel', t('settingsStylesCardBgLabel') || 'Фон карточек (`.card`)');
        setText('settingsStylesCardTextColorLabel', t('settingsStylesCardTextColorLabel') || 'Цвет текста карточек');
        setText('settingsStylesCardHeaderFromLabel', t('settingsStylesCardHeaderFromLabel') || 'Градиент заголовка (`.card-header`) — старт');
        setText('settingsStylesCardHeaderToLabel', t('settingsStylesCardHeaderToLabel') || 'Градиент заголовка (`.card-header`) — конец');
        setText('settingsStylesCardHeaderTextColorLabel', t('settingsStylesCardHeaderTextColorLabel') || 'Цвет текста заголовка (`.card-header`)');
        setText('settingsStylesStatValueColorLabel', t('settingsStylesStatValueColorLabel') || 'Цвет значений (`.stat-value` / `monitor-view__stat-value`)');
        setText('settingsStylesStatLabelColorLabel', t('settingsStylesStatLabelColorLabel') || 'Цвет подписей (`.stat-label` / `monitor-view__stat-label`)');
        setText('settingsStylesTableHeaderBgLabel', t('settingsStylesTableHeaderBgLabel') || 'Заголовок таблицы (`.table th`) — bg');
        setText('settingsStylesTableHeaderTextColorLabel', t('settingsStylesTableHeaderTextColorLabel') || 'Заголовок таблицы (`.table th`) — text');
        setText('settingsStylesTableCellTextColorLabel', t('settingsStylesTableCellTextColorLabel') || 'Текст таблицы (`.table td`)');
        setText('settingsStylesTableBorderColorLabel', t('settingsStylesTableBorderColorLabel') || 'Цвет границ таблицы');
        setText('settingsStylesTableHoverTdBgLabel', t('settingsStylesTableHoverTdBgLabel') || 'Фон таблицы при hover (`tr:hover td`)');
        setText('settingsStylesProgressBgLabel', t('settingsStylesProgressBgLabel') || 'Фон прогресса (`.progress`)');
        setText('settingsStylesMonitorViewCardBgLabel', t('settingsStylesMonitorViewCardBgLabel') || 'Фон карточек монитора (`.monitor-view__card`)');
        setText('settingsStylesSaveBtnText', t('settingsStylesSaveBtnText') || 'Сохранить');
        setText('settingsStylesResetBtnText', t('settingsStylesResetBtnText') || 'Сбросить вариант');
        setText('settingsStylesExportBtnText', t('settingsStylesExportBtnText') || 'Выгрузить (JSON)');
        setText('settingsStylesImportBtnText', t('settingsStylesImportBtnText') || 'Загрузить (JSON)');
        setText('settingsStylesDisableBtnText', t('settingsStylesDisableBtnText') || 'Отключить кастомные стили');

        // Localize select options for the styles tab.
        const stylesVariantSelect = document.getElementById('customThemeVariantSelect');
        if (stylesVariantSelect) {
            const setOptionText = (value, key) => {
                const opt = stylesVariantSelect.querySelector('option[value="' + value + '"]');
                if (opt) opt.textContent = t(key);
            };
            setOptionText('normalLight', 'settingsStylesVariantNormalLight');
            setOptionText('normalDark', 'settingsStylesVariantNormalDark');
            setOptionText('monitorLight', 'settingsStylesVariantMonitorLight');
            setOptionText('monitorDark', 'settingsStylesVariantMonitorDark');
        }
        setText('settingsMonitorScreensOrderTitle', t('settingsMonitorScreensOrderTitle'));
        setText('settingsMonitorScreensOrderHint', t('settingsMonitorScreensOrderHint'));
        renderSettingsMonitorScreensOrderList();
    setText('settingsNavThresholds', t('settingsNavThresholds'));
    setText('settingsNavServices', t('settingsNavServices'));
    setText('settingsNavDebug', t('settingsNavDebug'));
    setText('settingsDebugTitle', t('settingsDebugTitle'));
    setText('settingsDebugHint', t('settingsDebugHint'));
    setText('settingsDebugServerTitle', t('settingsDebugServerTitle'));
    setText('settingsDebugClientTitle', t('settingsDebugClientTitle'));
    setText('settingsDebugRefreshText', t('settingsDebugRefreshText') || 'Refresh metrics');
    setText('settingsDebugPingText', t('settingsDebugPingText') || 'Ping API');
    setText('settingsDebugClearCacheText', t('settingsDebugClearCacheText') || 'Clear cache');
    setText('settingsDebugResetAllText', t('settingsDebugResetAllText') || 'Reset all settings');
    setText('settingsDebugExportText', t('settingsDebugExportText') || 'Download report');
    setText('settingsDebugReloadText', t('settingsDebugReloadText') || 'Reload application');
    setText('settingsDebugResetAllConfirmLabel', t('settingsDebugResetAllConfirmLabel') || 'Confirm by checkbox to reset all settings');
    setText('settingsNavSecurity', t('settingsNavSecurity'));
    setText('settingsSecurityTitle', t('settingsSecurityTitle'));
    setText('settingsSecurityHint', t('settingsSecurityHint'));
    setText('settingsPasswordCurrentLabel', t('settingsPasswordCurrentLabel'));
    setText('settingsPasswordNewLabel', t('settingsPasswordNewLabel'));
    setText('settingsPasswordRepeatLabel', t('settingsPasswordRepeatLabel'));
    setText('settingsPasswordApplyText', isSettingsPasswordEnabled() ? t('settingsPasswordChange') : t('settingsPasswordEnable'));
    setText('settingsPasswordDisableText', t('settingsPasswordDisable'));
    setText('settingsUnlockModalTitleText', t('enterSettingsPassword'));
    setText('settingsUnlockPasswordLabel', t('settingsUnlockPasswordLabel') || t('settingsPasswordCurrentLabel') || 'Пароль');
    setText('settingsUnlockSubmitText', t('settingsUnlockSubmitText') || 'Войти');
    setText('settingsUnlockCancelText', t('settingsUnlockCancelText') || 'Отмена');
    setText('settingsSessionTtlLabel', t('settingsSessionTtlLabel') || 'Время жизни сессии (мин)');
    setText('settingsSessionTtlHint', t('settingsSessionTtlHint') || 'Повторный ввод пароля не требуется в течение этого времени после входа.');
    setText('settingsLogoutText', t('settingsLogoutText') || 'Выйти из настроек');

    const unlockClose = document.getElementById('settingsUnlockModalCloseBtn');
    if (unlockClose) unlockClose.setAttribute('aria-label', t('ariaClose'));

    setText('apiTokenIdPartHint', t('tokenPartBeforeEquals'));
    setText('apiTokenSecretHint', t('tokenPartSecretHint'));

    setText('upsSettingsCardTitle', t('upsSettingsCardTitle'));
    setText('upsSlotLabel', t('upsSlotLabel'));
    setText('upsEnabledLabel', t('upsEnabledLabel'));
    setText('upsTypeLabel', t('serviceTypeLabel'));
    setText('upsHostLabel', t('serviceHostLabel'));
    setText('upsPortLabel', t('servicePortLabel'));
    setText('upsDisplayDashboardTabLabel', t('upsDisplayNormalModeTab'));
    setText('upsDisplayMonitorTabLabel', t('upsDisplayMonitorModeTab'));
    setText('upsShowOnDashboardLabel', t('upsShowOnDashboardLabel'));
    setText('upsShowOnMonitorClusterLabel', t('upsShowOnMonitorClusterLabel'));
    setText('upsSaveButtonText', t('upsSaveButton'));
    setText('upsNutVarStatusLabel', t('upsNutVarStatus'));
    setText('upsNutVarChargeLabel', t('upsNutVarCharge'));
    setText('upsNutVarRuntimeLabel', t('upsNutVarRuntime'));
    setText('upsNutVarInputVoltageLabel', t('upsNutVarInputVoltage'));
    setText('upsNutVarOutputVoltageLabel', t('upsNutVarOutputVoltage'));
    setText('upsNutVarPowerLabel', t('upsNutVarPower'));
    setText('upsNutVarLoadLabel', t('upsNutVarLoad'));
    setText('upsNutVarFrequencyLabel', t('upsNutVarFrequency'));
    setText('upsSnmpOidStatusLabel', t('upsSnmpOidStatus'));
    setText('upsSnmpOidChargeLabel', t('upsSnmpOidCharge'));
    setText('upsSnmpOidRuntimeLabel', t('upsSnmpOidRuntime'));
    setText('upsSnmpOidInputVoltageLabel', t('upsSnmpOidInputVoltage'));
    setText('upsSnmpOidOutputVoltageLabel', t('upsSnmpOidOutputVoltage'));
    setText('upsSnmpOidPowerLabel', t('upsSnmpOidPower'));
    setText('upsSnmpOidLoadLabel', t('upsSnmpOidLoad'));
    setText('upsSnmpOidFrequencyLabel', t('upsSnmpOidFrequency'));
    setText('upsNutNameLabel', t('upsNutNameLabel'));

    setText('netdevSettingsCardTitle', t('netdevSettingsCardTitle'));
    setText('netdevSlotLabel', t('netdevSlotLabel'));
    setText('netdevEnabledLabel', t('netdevEnabledLabel'));
    setText('netdevHostLabel', t('serviceHostLabel'));
    setText('netdevSnmpPortLabel', t('netdevSnmpPortLabel'));
    setText('netdevCommunityLabel', t('netdevCommunityLabel'));
    setText('netdevDeviceNameLabel', t('netdevDeviceNameLabel'));
    setText('netdevNameOidLabel', t('netdevNameOidLabel'));
    setText('netdevFieldsSectionTitle', t('netdevFieldsSectionTitle'));
    setText('netdevFieldsHelpText', t('netdevFieldsHelpText'));
    setText('netdevDisplayDashboardTabLabel', t('netdevDisplayNormalTab'));
    setText('netdevDisplayMonitorTabLabel', t('netdevDisplayMonitorTab'));
    setText('netdevShowOnDashboardLabel', t('netdevShowOnDashboardLabel'));
    setText('netdevShowOnMonitorLabel', t('netdevShowOnMonitorLabel'));
    setText('netdevSaveButtonText', t('netdevSaveButton'));

    setText('speedtestSettingsTitle', t('speedtestSettingsTitle'));
    setText('speedtestSettingsHint', t('speedtestSettingsHint'));
    setText('speedtestEnabledLabel', t('speedtestEnabledLabel'));
    setText('speedtestServerLabel', t('speedtestServerLabel'));
    setText('speedtestServerHint', t('speedtestServerHint'));
    setText('speedtestPerDayLabel', t('speedtestPerDayLabel'));
    setText('speedtestRunNowText', t('speedtestRunNowText'));
    setText('dashboardSpeedtestTitle', t('dashboardSpeedtestTitle'));
    setText('speedtestMonitorTitle', t('dashboardSpeedtestTitle'));
    setText('speedtestLastRunLabel', t('speedtestLastRunLabel'));
    setText('speedtestAvgLabel', t('speedtestAvgLabel'));
    setText('speedtestMinLabel', t('speedtestMinLabel'));
    setText('speedtestMaxLabel', t('speedtestMaxLabel'));
    setText('speedtestMonitorLastRunLabel', t('speedtestLastRunLabel'));
    setText('speedtestMonitorAvgLabel', t('speedtestAvgLabel'));
    setText('speedtestMonitorMinLabel', t('speedtestMinLabel'));
    setText('speedtestMonitorMaxLabel', t('speedtestMaxLabel'));
    setText('speedtestMonitorBackText', t('speedtestMonitorBackText'));

    setPlaceholder('settingsServiceNameInput', t('settingsServicePlaceholderName'));
    setPlaceholder('settingsServiceHostInput', t('settingsServicePlaceholderHost'));
    setPlaceholder('upsHostInput', t('upsHostPlaceholder'));
    setPlaceholder('netdevHostInput', t('netdevHostPlaceholder'));
    setPlaceholder('speedtestServerInput', t('speedtestServerPlaceholder'));

    [
        'upsSnmpOidChargeInput',
        'upsSnmpOidRuntimeInput',
        'upsSnmpOidInputVoltageInput',
        'upsSnmpOidOutputVoltageInput',
        'upsSnmpOidPowerInput',
        'upsSnmpOidLoadInput',
        'upsSnmpOidFrequencyInput'
    ].forEach((pid) => setPlaceholder(pid, t('placeholderOptional')));

    localizeRefreshIntervalSelect();
    localizeYesNoSelect('upsEnabledSelect');
    localizeYesNoSelect('netdevEnabledSelect');
    localizeYesNoSelect('speedtestEnabledSelect');
    localizeServiceTypeSelect();
    localizeUpsTypeSelect();
    syncSettingsConnectionStatusText();

    try {
        const root = document.getElementById('netdevFieldsEditorsRoot');
        if (root && root.querySelector('.netdev-field-block')) {
            const cur = getNetdevFieldsFromDom();
            if (cur.length) renderNetdevFieldsEditors(cur);
        }
    } catch (_) {}
}

// Available languages (will be populated from server)
let availableLanguages = ['ru', 'en'];
let serverDefaultLanguage = null;

// Load available languages from server and initialize
document.addEventListener('DOMContentLoaded', async function() {
    console.log('DOM loaded');
    
    // Load translations and available languages from server
    await loadTranslations();
    
    // Load available languages from server (+ текущий язык с сервера = .env default)
    try {
        const response = await fetch('/api/languages');
        const data = await response.json();
        if (data.available && data.available.length > 0) {
            availableLanguages = data.available;
            renderLanguageSwitchers();
        }
        if (data.current && typeof data.current === 'string') {
            serverDefaultLanguage = data.current;
        }
    } catch (error) {
        console.error('Failed to load languages:', error);
    }
    
    // Load saved settings from API (servers, thresholds, defaults, etc.)
    const settingsData = await loadSettings();

    // Determine language: .env (.server current) -> app settings -> user choice -> first available
    let storedLang = null;
    try {
        storedLang = localStorage.getItem('preferred_language');
    } catch (_) {}
    const envLang = (serverDefaultLanguage && availableLanguages.includes(serverDefaultLanguage))
        ? serverDefaultLanguage
        : null;
    const settingsLang = (settingsData && settingsData.preferred_language && availableLanguages.includes(settingsData.preferred_language))
        ? settingsData.preferred_language
        : null;
    const userLang = (storedLang && availableLanguages.includes(storedLang))
        ? storedLang
        : null;
    const chosenLang = envLang || settingsLang || userLang || (availableLanguages[0] || 'ru');
    setLanguage(chosenLang);
    setServerType(currentServerType);

    // Proxmox token parts -> keep hidden legacy input in sync
    try {
        const idEl = document.getElementById('apiTokenId');
        const secretEl = document.getElementById('apiTokenSecret');
        if (idEl && secretEl) {
            idEl.addEventListener('input', syncProxmoxApiTokenFromParts);
            secretEl.addEventListener('input', syncProxmoxApiTokenFromParts);
            syncProxmoxApiTokenFromParts();
        }
    } catch (_) {}

    toggleServiceTypeFields();
    renderMonitoredServices();
    renderSettingsMonitoredServices();
    renderSettingsMonitoredVms();
    const vmIdOrNameInput = document.getElementById('settingsVmIdOrNameInput');
    if (vmIdOrNameInput) {
        vmIdOrNameInput.addEventListener('change', addVmToMonitorByIdOrName);
        vmIdOrNameInput.addEventListener('keydown', function(e) { if (e.key === 'Enter') { e.preventDefault(); addVmToMonitorByIdOrName(); } });
    }
    const debugNav = document.getElementById('settings-nav-debug');
    if (debugNav) {
        debugNav.addEventListener('shown.bs.tab', () => refreshDebugMetrics());
    }
    const reloadBtn = document.getElementById('settingsDebugReloadBtn');
    if (reloadBtn) {
        reloadBtn.addEventListener('click', function (e) {
            e.preventDefault();
            e.stopPropagation();
            reloadApplication();
            return false;
        });
    }
    const ttlSelect = document.getElementById('settingsSessionTtlSelect');
    if (ttlSelect) {
        ttlSelect.addEventListener('change', async function () {
            const val = parseInt(ttlSelect.value, 10);
            if (!isNaN(val) && val > 0) {
                settingsSessionTtlMinutes = val;
                try {
                    await saveSettingsToServer({ session_ttl_minutes: val });
                    showToast(t('dataUpdated') || 'Настройки сохранены', 'success');
                } catch (e) {
                    showToast((t('connectError') || 'Ошибка') + ': ' + e.message, 'error');
                }
            }
        });
    }

    checkServerStatus();
    updateCurrentServerBadge();

    // Показать дашборд или настройки: при сохранённом подключении — загрузить данные и показать контент, иначе — форму входа
    const hasConnIds = connectionIdMap && typeof connectionIdMap === 'object' && Object.keys(connectionIdMap).length > 0;
    if (apiToken || hasConnIds) {
        try {
            await refreshData();
            startAutoRefresh();
            if (!monitorMode) showDashboard();
            // если monitorMode — видимость уже задана в loadSettings() через applyMonitorView
        } catch (e) {
            console.warn('Initial refresh failed:', e);
            showConfigSectionOnly();
        }
    } else {
        showConfigSectionOnly();
    }
});

function showConfigSectionOnly() {
    const configSection = document.getElementById('configSection');
    const dashboardSection = document.getElementById('dashboardSection');
    const servicesSection = document.getElementById('servicesMonitorSection');
    const vmsSection = document.getElementById('vmsMonitorSection');
    const upsMonSection = document.getElementById('upsMonitorSection');
    const backupsMon = document.getElementById('backupsMonitorSection');
    const monitorView = document.getElementById('monitorView');
    if (configSection) configSection.style.display = 'block';
    if (dashboardSection) dashboardSection.style.display = 'none';
    if (servicesSection) servicesSection.style.display = 'none';
    if (vmsSection) vmsSection.style.display = 'none';
    if (upsMonSection) upsMonSection.style.display = 'none';
    if (backupsMon) backupsMon.style.display = 'none';
    if (monitorView) monitorView.style.display = 'none';
}

function normalizeUrlClient(u) {
    try {
        const url = new URL(String(u));
        if (!url.protocol.startsWith('http')) return String(u || '').trim();
        return url.toString().replace(/\/+$/, '');
    } catch {
        return String(u || '').trim();
    }
}

function connectionKey(type, url) {
    return `${type}|${normalizeUrlClient(url)}`;
}

function getCurrentConnectionId() {
    const url = getCurrentServerUrl();
    return connectionIdMap[connectionKey(currentServerType, url)] || null;
}

function saveConnectionId(type, url, id) {
    const normalizedUrl = normalizeUrlClient(url);
    connectionIdMap[connectionKey(type, normalizedUrl)] = id;

    // Обновляем списки серверов, чтобы URL в настройках совпадал с тем, что в DB
    if (type === 'proxmox') {
        const servers = getServersForCurrentType();
        const idx = getCurrentIndexForType();
        if (servers && typeof idx === 'number' && servers[idx]) {
            servers[idx] = normalizedUrl;
            proxmoxServers = [...servers];
            saveSettingsToServer({ proxmoxServers: [...proxmoxServers], connectionIdMap: { ...connectionIdMap } });
            return;
        }
    } else if (type === 'truenas') {
        const servers = getServersForCurrentType();
        const idx = getCurrentIndexForType();
        if (servers && typeof idx === 'number' && servers[idx]) {
            servers[idx] = normalizedUrl;
            truenasServers = [...servers];
            saveSettingsToServer({ truenasServers: [...truenasServers], connectionIdMap: { ...connectionIdMap } });
            return;
        }
    }

    saveSettingsToServer({ connectionIdMap: { ...connectionIdMap } });
}

// (Запоминание токенов через cookies больше не используется; все секреты хранятся в DB через /api/connections/upsert)

// Logout (called after logoutAs(type) sets currentServerType)
async function logout() {
    try {
        const url = getCurrentServerUrl();
        delete connectionIdMap[connectionKey(currentServerType, url)];
        saveSettingsToServer({ connectionIdMap: { ...connectionIdMap } });
        showToast(t('logoutSuccess'), 'success');
        apiToken = null;
        const tokenInputId = currentServerType === 'truenas' ? 'apiTokenTrueNAS' : 'apiToken';
        const logoutContainerId = currentServerType === 'truenas' ? 'logoutContainerTrueNAS' : 'logoutContainerProxmox';
        setValue(tokenInputId, '');
        if (currentServerType === 'proxmox') {
            const idEl = document.getElementById('apiTokenId');
            const secretEl = document.getElementById('apiTokenSecret');
            if (idEl) setValue('apiTokenId', '');
            if (secretEl) setValue('apiTokenSecret', '');
            if (idEl || secretEl) syncProxmoxApiTokenFromParts();
        }
        setDisplay(logoutContainerId, 'none');
        showConfig();
    } catch (error) {
        showToast(tParams('toastLogoutError', { msg: error.message }), 'error');
    }
}

function logoutAs(type) {
    currentServerType = type === 'truenas' ? 'truenas' : 'proxmox';
    logout();
}

// Check server status
async function checkServerStatus() {
    try {
        const response = await fetch('/api/status');
        const data = await response.json();
        setHTML('serverStatus', '<i class="bi bi-check-circle"></i> <span id="serverStatusText">' + t('serverWorking') + '</span>');
        const verEl = document.getElementById('footerVersion');
        if (verEl && data.version) verEl.textContent = 'v' + data.version;
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

/** Текущий resolve для модала разблокировки (один активный вызов). */
let _settingsUnlockResolve = null;
/** Флаг: обработчики модала разблокировки уже привязаны. */
let _settingsUnlockModalBound = false;

function _settingsUnlockModalFinish(ok) {
    if (_settingsUnlockResolve) {
        _settingsUnlockResolve(ok);
        _settingsUnlockResolve = null;
    }
    const modalEl = document.getElementById('settingsUnlockModal');
    if (modalEl && typeof bootstrap !== 'undefined' && bootstrap.Modal) {
        const inst = bootstrap.Modal.getInstance(modalEl);
        if (inst) inst.hide();
    }
}

function _settingsUnlockModalSubmit() {
    const inputEl = document.getElementById('settingsUnlockPassword');
    const errorEl = document.getElementById('settingsUnlockError');
    if (!inputEl) return;
    const password = inputEl.value.trim();
    if (!password) {
        if (errorEl) {
            errorEl.textContent = t('enterSettingsPassword') || 'Введите пароль';
            errorEl.style.display = 'block';
        }
        inputEl.classList.add('is-invalid');
        return;
    }
    if (errorEl) {
        errorEl.textContent = '';
        errorEl.style.display = 'none';
    }
    inputEl.classList.remove('is-invalid');
    fetch('/api/settings/unlock', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ password: password })
    })
        .then(function (r) { return r.json(); })
        .then(function (data) {
if (data.success) {
                    settingsUnlocked = true;
                    persistSettingsSession();
                    showToast(t('settingsPasswordUnlocked') || 'Настройки разблокированы', 'success');
                    inputEl.value = '';
                    _settingsUnlockModalFinish(true);
                } else {
                if (errorEl) {
                    errorEl.textContent = data.error || t('settingsPasswordIncorrect') || 'Неверный пароль';
                    errorEl.style.display = 'block';
                }
                inputEl.classList.add('is-invalid');
            }
        })
        .catch(function (e) {
            if (errorEl) {
                errorEl.textContent = e.message || t('settingsPasswordIncorrect') || 'Неверный пароль';
                errorEl.style.display = 'block';
            }
            inputEl.classList.add('is-invalid');
        });
}

function _settingsUnlockModalCancel() {
    const inputEl = document.getElementById('settingsUnlockPassword');
    const errorEl = document.getElementById('settingsUnlockError');
    if (inputEl) inputEl.value = '';
    if (errorEl) {
        errorEl.textContent = '';
        errorEl.style.display = 'none';
    }
    if (inputEl) inputEl.classList.remove('is-invalid');
    _settingsUnlockModalFinish(false);
}

/** Показать HTML-модал ввода пароля для доступа к настройкам. Возвращает Promise<boolean>: true при успешной разблокировке, false при отмене. */
function showSettingsUnlockModal() {
    const modalEl = document.getElementById('settingsUnlockModal');
    const inputEl = document.getElementById('settingsUnlockPassword');
    const errorEl = document.getElementById('settingsUnlockError');
    if (!modalEl || !inputEl) return Promise.resolve(false);
    const promise = new Promise(function (resolve) {
        _settingsUnlockResolve = resolve;
    });
    if (!_settingsUnlockModalBound) {
        _settingsUnlockModalBound = true;
        modalEl.addEventListener('hidden.bs.modal', function () {
            if (_settingsUnlockResolve) {
                _settingsUnlockResolve(false);
                _settingsUnlockResolve = null;
            }
        });
        var submitBtn = document.getElementById('settingsUnlockSubmitBtn');
        var cancelBtn = document.getElementById('settingsUnlockCancelBtn');
        var closeBtn = document.getElementById('settingsUnlockModalCloseBtn');
        if (submitBtn) submitBtn.addEventListener('click', _settingsUnlockModalSubmit);
        if (cancelBtn) cancelBtn.addEventListener('click', _settingsUnlockModalCancel);
        if (closeBtn) closeBtn.addEventListener('click', _settingsUnlockModalCancel);
        inputEl.addEventListener('keydown', function (e) {
            if (e.key === 'Enter') {
                e.preventDefault();
                _settingsUnlockModalSubmit();
            }
        });
    }
    inputEl.value = '';
    if (errorEl) {
        errorEl.textContent = '';
        errorEl.style.display = 'none';
    }
    inputEl.classList.remove('is-invalid');
    if (typeof bootstrap !== 'undefined' && bootstrap.Modal) {
        var inst = bootstrap.Modal.getOrCreateInstance(modalEl);
        inst.show();
        setTimeout(function () { inputEl.focus(); }, 300);
    }
    return promise;
}

function persistSettingsSession() {
    try {
        sessionStorage.setItem(SETTINGS_UNLOCK_EXPIRY_KEY, String(Date.now() + settingsSessionTtlMinutes * 60 * 1000));
    } catch (_) {}
}

function clearSettingsSession() {
    try {
        sessionStorage.removeItem(SETTINGS_UNLOCK_EXPIRY_KEY);
    } catch (_) {}
    settingsUnlocked = false;
}

async function ensureSettingsUnlocked() {
    if (!isSettingsPasswordEnabled()) return true;
    if (settingsUnlocked) return true;
    return await showSettingsUnlockModal();
}

// Загрузка данных для таблиц настроек (сервисы + VM/CT)
async function loadSettingsPanelData() {
    delete htmlCache['settingsServicesBody'];
    delete htmlCache['settingsVmsBody'];
    try {
        const servRes = await fetch('/api/settings/services');
        if (servRes.ok) {
            const servData = await servRes.json();
            monitoredServices = Array.isArray(servData.services) ? servData.services : [];
        }
    } catch (e) {
        console.error('Failed to load services for settings:', e);
    }
    if (currentServerType === 'proxmox') {
        await loadClusterVmsForSettings({ silent: true });
        if (monitoredVmIds.length === 0 && getClusterVms().length > 0) {
            monitoredVmIds = getClusterVms().map(v => v.vmid).filter(id => !monitorHiddenVmIds.includes(Number(id)));
            saveSettingsToServer({ monitorVms: monitoredVmIds });
        }
    } else {
        renderSettingsMonitoredVms();
    }
    renderSettingsMonitoredServices();
    await loadUpsSettings();
    await ensureUpsDisplaySlotsLoaded();
    await loadNetdevSettings();
    await ensureNetdevDisplaySlotsLoaded();
    renderServerList();
}

// ==================== UPS MONITORING (NUT/SNMP) ====================

function toggleUpsFields() {
    const enabledSelect = document.getElementById('upsEnabledSelect');
    const typeSelect = document.getElementById('upsTypeSelect');
    const nutFieldsWrap = document.getElementById('upsNutFields');
    const snmpFieldsWrap = document.getElementById('upsSnmpFields');
    if (!enabledSelect || !typeSelect || !nutFieldsWrap || !snmpFieldsWrap) return;

    const enabled = String(enabledSelect.value || '0') === '1';
    const type = String(typeSelect.value || 'nut').toLowerCase();
    nutFieldsWrap.classList.toggle('d-none', !enabled || type !== 'nut');
    snmpFieldsWrap.classList.toggle('d-none', !enabled || type !== 'snmp');
}

function getUpsSlotIndex() {
    const tabsEl = document.getElementById('upsSlotTabs');
    if (tabsEl) {
        const activeBtn = tabsEl.querySelector('button.nav-link.active[data-ups-slot-idx]');
        const idx = activeBtn ? parseInt(activeBtn.dataset.upsSlotIdx, 10) : NaN;
        if (Number.isFinite(idx)) return idx;
    }

    // Fallback: старый селект (на случай если где-то ещё остался)
    const slotSelect = document.getElementById('upsSlotSelect');
    if (!slotSelect) return 0;
    const n = parseInt(slotSelect.value, 10);
    return Number.isFinite(n) ? n : 0;
}

function createDefaultUpsConfig() {
    return {
        enabled: false,
        type: 'nut',
        host: '',
        port: null,
        name: '',
        nutVarStatus: 'ups.status',
        nutVarCharge: 'battery.charge',
        nutVarRuntime: 'battery.runtime',
        nutVarInputVoltage: 'input.voltage',
        nutVarOutputVoltage: 'output.voltage',
        nutVarPower: 'ups.realpower',
        nutVarLoad: 'ups.load',
        nutVarFrequency: 'input.frequency',
        snmpCommunity: '',
        snmpOidStatus: '',
        snmpOidCharge: '',
        snmpOidRuntime: '',
        snmpOidInputVoltage: '',
        snmpOidOutputVoltage: '',
        snmpOidPower: '',
        snmpOidLoad: '',
        snmpOidFrequency: ''
    };
}

let upsConfigs = null;
let upsSlotListenerAttached = false;
let upsDisplaySlotsMonitor = [1, 2, 3, 4];
let upsDisplaySlotsDashboard = [1, 2, 3, 4];
let upsDisplaySlotsLoadedPromise = null;
let upsDisplaySlotsLoadedOnce = false;

function getCheckedUpsSlotsByClass(checkboxClass) {
    const boxes = document.querySelectorAll('input.' + checkboxClass + ':checked');
    const slots = Array.from(boxes)
        .map((b) => parseInt(b.value, 10))
        .filter((n) => Number.isFinite(n) && n >= 1 && n <= 4);
    return Array.from(new Set(slots)).sort((a, b) => a - b);
}

function setUpsDisplayCheckboxes(dashboardSlots, monitorSlots) {
    for (let s = 1; s <= 4; s++) {
        const dashBox = document.getElementById('upsDisplayDashboardSlot' + s);
        if (dashBox) dashBox.checked = Array.isArray(dashboardSlots) && dashboardSlots.includes(s);
        const monBox = document.getElementById('upsDisplayMonitorSlot' + s);
        if (monBox) monBox.checked = Array.isArray(monitorSlots) && monitorSlots.includes(s);
    }
}

async function ensureUpsDisplaySlotsLoaded() {
    if (upsDisplaySlotsLoadedPromise) return upsDisplaySlotsLoadedPromise;

    upsDisplaySlotsLoadedPromise = (async () => {
        try {
            const resp = await fetch('/api/ups/display');
            const data = await resp.json();
            if (data && data.success) {
                if (Array.isArray(data.dashboardSlots)) upsDisplaySlotsDashboard = data.dashboardSlots;
                if (Array.isArray(data.monitorSlots)) upsDisplaySlotsMonitor = data.monitorSlots;
            }
        } catch (e) {
            // Используем дефолтные [1..4]
        }

        // Обновим чекбоксы в панели настроек (если она есть на странице)
        try {
            setUpsDisplayCheckboxes(upsDisplaySlotsDashboard, upsDisplaySlotsMonitor);
        } catch (_) {}

        upsDisplaySlotsLoadedOnce = true;
    })();

    return upsDisplaySlotsLoadedPromise;
}

async function loadUpsSettings() {
    const enabledSelect = document.getElementById('upsEnabledSelect');
    const typeSelect = document.getElementById('upsTypeSelect');
    if (!enabledSelect || !typeSelect) return;

    const hostInput = document.getElementById('upsHostInput');
    const portInput = document.getElementById('upsPortInput');
    const nutNameInput = document.getElementById('upsNutNameInput');
    const nutVarStatusInput = document.getElementById('upsNutVarStatusInput');
    const nutVarChargeInput = document.getElementById('upsNutVarChargeInput');
    const nutVarRuntimeInput = document.getElementById('upsNutVarRuntimeInput');
    const nutVarInputVoltageInput = document.getElementById('upsNutVarInputVoltageInput');
    const nutVarOutputVoltageInput = document.getElementById('upsNutVarOutputVoltageInput');
    const nutVarPowerInput = document.getElementById('upsNutVarPowerInput');
    const nutVarLoadInput = document.getElementById('upsNutVarLoadInput');
    const nutVarFrequencyInput = document.getElementById('upsNutVarFrequencyInput');
    const snmpCommunityInput = document.getElementById('upsSnmpCommunityInput');
    const snmpOidStatusInput = document.getElementById('upsSnmpOidStatusInput');
    const snmpOidChargeInput = document.getElementById('upsSnmpOidChargeInput');
    const snmpOidRuntimeInput = document.getElementById('upsSnmpOidRuntimeInput');
    const snmpOidInputVoltageInput = document.getElementById('upsSnmpOidInputVoltageInput');
    const snmpOidOutputVoltageInput = document.getElementById('upsSnmpOidOutputVoltageInput');
    const snmpOidPowerInput = document.getElementById('upsSnmpOidPowerInput');
    const snmpOidLoadInput = document.getElementById('upsSnmpOidLoadInput');
    const snmpOidFrequencyInput = document.getElementById('upsSnmpOidFrequencyInput');

    const applySlotToForm = (slotIdx) => {
        const cfg = (Array.isArray(upsConfigs) && upsConfigs[slotIdx]) ? upsConfigs[slotIdx] : createDefaultUpsConfig();
        enabledSelect.value = cfg.enabled ? '1' : '0';
        typeSelect.value = cfg.type || 'nut';

        if (hostInput) hostInput.value = cfg.host || '';
        if (portInput) portInput.value = cfg.port != null ? String(cfg.port) : '';

        // NUT
        if (nutNameInput) nutNameInput.value = cfg.name || '';
        if (nutVarStatusInput) nutVarStatusInput.value = cfg.nutVarStatus || 'ups.status';
        if (nutVarChargeInput) nutVarChargeInput.value = cfg.nutVarCharge || 'battery.charge';
        if (nutVarRuntimeInput) nutVarRuntimeInput.value = cfg.nutVarRuntime || 'battery.runtime';
        if (nutVarInputVoltageInput) nutVarInputVoltageInput.value = cfg.nutVarInputVoltage || 'input.voltage';
        if (nutVarOutputVoltageInput) nutVarOutputVoltageInput.value = cfg.nutVarOutputVoltage || 'output.voltage';
        if (nutVarPowerInput) nutVarPowerInput.value = cfg.nutVarPower || 'ups.realpower';
        if (nutVarLoadInput) nutVarLoadInput.value = cfg.nutVarLoad || 'ups.load';
        if (nutVarFrequencyInput) nutVarFrequencyInput.value = cfg.nutVarFrequency || 'input.frequency';

        // SNMP
        if (snmpCommunityInput) snmpCommunityInput.value = cfg.snmpCommunity || '';
        if (snmpOidStatusInput) snmpOidStatusInput.value = cfg.snmpOidStatus || '';
        if (snmpOidChargeInput) snmpOidChargeInput.value = cfg.snmpOidCharge || '';
        if (snmpOidRuntimeInput) snmpOidRuntimeInput.value = cfg.snmpOidRuntime || '';
        if (snmpOidInputVoltageInput) snmpOidInputVoltageInput.value = cfg.snmpOidInputVoltage || '';
        if (snmpOidOutputVoltageInput) snmpOidOutputVoltageInput.value = cfg.snmpOidOutputVoltage || '';
        if (snmpOidPowerInput) snmpOidPowerInput.value = cfg.snmpOidPower || '';
        if (snmpOidLoadInput) snmpOidLoadInput.value = cfg.snmpOidLoad || '';
        if (snmpOidFrequencyInput) snmpOidFrequencyInput.value = cfg.snmpOidFrequency || '';

        toggleUpsFields();
    };

    try {
        const res = await fetch('/api/ups/settings');
        if (!res.ok) {
            const maybe = await res.json().catch(() => ({}));
            throw new Error(maybe.error || maybe.message || `HTTP ${res.status}`);
        }
        const data = await res.json();
        upsConfigs = Array.isArray(data?.configs) ? data.configs : [];
        while (upsConfigs.length < 4) upsConfigs.push(createDefaultUpsConfig());

        const slotIdx = getUpsSlotIndex();
        applySlotToForm(slotIdx);
    } catch (e) {
        console.error('Failed to load UPS settings:', e);
        // UX: если не смогли загрузить с сервера, не “прячем” поля в пустоту.
        try {
            const slotIdx = getUpsSlotIndex();
            if (!upsConfigs) upsConfigs = new Array(4).fill(0).map(createDefaultUpsConfig);
            // Покажем поля формы, чтобы пользователь мог настроить вручную даже при проблемах с API.
            upsConfigs[slotIdx] = {
                ...createDefaultUpsConfig(),
                enabled: true,
                type: 'nut'
            };
            applySlotToForm(slotIdx);
        } catch (_) {}
        showToast((t('connectError') || 'Ошибка загрузки') + ': ' + ((e && e.message) ? e.message : String(e)), 'error');
    } finally {
        if (!upsConfigs) upsConfigs = new Array(4).fill(0).map(createDefaultUpsConfig);
    }

    if (!upsSlotListenerAttached) {
        const tabsEl = document.getElementById('upsSlotTabs');
        if (tabsEl) {
            const btns = tabsEl.querySelectorAll('button[data-ups-slot-idx]');
            btns.forEach((btn) => {
                btn.addEventListener('click', () => {
                    const idx = parseInt(btn.dataset.upsSlotIdx, 10);
                    if (!Number.isFinite(idx)) return;

                    // Переключаем active-класс, чтобы getUpsSlotIndex() работал
                    btns.forEach(b => {
                        b.classList.toggle('active', b === btn);
                        b.setAttribute('aria-selected', String(b === btn));
                    });
                    applySlotToForm(idx);
                });
            });
            upsSlotListenerAttached = true;
        }
    }
}

async function saveUpsSettings() {
    const enabledSelect = document.getElementById('upsEnabledSelect');
    const typeSelect = document.getElementById('upsTypeSelect');
    if (!enabledSelect || !typeSelect) return;

    const enabled = String(enabledSelect.value || '0') === '1';
    const type = String(typeSelect.value || 'nut').toLowerCase();

    const host = (document.getElementById('upsHostInput')?.value || '').trim();
    const port = (document.getElementById('upsPortInput')?.value || '').trim();

    const slotIdx = getUpsSlotIndex();
    const cfg = (Array.isArray(upsConfigs) && upsConfigs[slotIdx]) ? upsConfigs[slotIdx] : createDefaultUpsConfig();
    cfg.enabled = enabled;
    cfg.type = type;
    cfg.host = host;
    cfg.port = port !== '' ? parseInt(port, 10) : null;

    if (type === 'nut') {
        cfg.name = (document.getElementById('upsNutNameInput')?.value || '').trim();
        cfg.nutVarStatus = (document.getElementById('upsNutVarStatusInput')?.value || '').trim() || 'ups.status';
        cfg.nutVarCharge = (document.getElementById('upsNutVarChargeInput')?.value || '').trim() || 'battery.charge';
        cfg.nutVarRuntime = (document.getElementById('upsNutVarRuntimeInput')?.value || '').trim() || 'battery.runtime';
        cfg.nutVarInputVoltage = (document.getElementById('upsNutVarInputVoltageInput')?.value || '').trim() || 'input.voltage';
        cfg.nutVarOutputVoltage = (document.getElementById('upsNutVarOutputVoltageInput')?.value || '').trim() || 'output.voltage';
        cfg.nutVarPower = (document.getElementById('upsNutVarPowerInput')?.value || '').trim() || 'ups.realpower';
        cfg.nutVarLoad = (document.getElementById('upsNutVarLoadInput')?.value || '').trim() || 'ups.load';
        cfg.nutVarFrequency = (document.getElementById('upsNutVarFrequencyInput')?.value || '').trim() || 'input.frequency';
    } else if (type === 'snmp') {
        cfg.snmpCommunity = (document.getElementById('upsSnmpCommunityInput')?.value || '').trim();
        cfg.snmpOidStatus = (document.getElementById('upsSnmpOidStatusInput')?.value || '').trim();
        cfg.snmpOidCharge = (document.getElementById('upsSnmpOidChargeInput')?.value || '').trim();
        cfg.snmpOidRuntime = (document.getElementById('upsSnmpOidRuntimeInput')?.value || '').trim();
        cfg.snmpOidInputVoltage = (document.getElementById('upsSnmpOidInputVoltageInput')?.value || '').trim();
        cfg.snmpOidOutputVoltage = (document.getElementById('upsSnmpOidOutputVoltageInput')?.value || '').trim();
        cfg.snmpOidPower = (document.getElementById('upsSnmpOidPowerInput')?.value || '').trim();
        cfg.snmpOidLoad = (document.getElementById('upsSnmpOidLoadInput')?.value || '').trim();
        cfg.snmpOidFrequency = (document.getElementById('upsSnmpOidFrequencyInput')?.value || '').trim();
    }

    try {
        const res = await fetch('/api/ups/settings', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ configs: (Array.isArray(upsConfigs) ? upsConfigs : []) })
        });
        const data = await res.json();
        if (!res.ok || !data?.success) throw new Error(data?.error || 'failed to save');

        showToast(t('toastUpsSaved'), 'success');

        // Сохраним также, какие слоты UPS показывать на дашборде и в режиме монитора (Cluster)
        try {
            const hasDashboardBoxes = document.querySelectorAll('input.upsDisplayDashboardSlot').length > 0;
            const hasMonitorBoxes = document.querySelectorAll('input.upsDisplayMonitorSlot').length > 0;
            const dashboardSlots = hasDashboardBoxes ? getCheckedUpsSlotsByClass('upsDisplayDashboardSlot') : [1, 2, 3, 4];
            const monitorSlots = hasMonitorBoxes ? getCheckedUpsSlotsByClass('upsDisplayMonitorSlot') : [1, 2, 3, 4];
            await fetch('/api/ups/display', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ dashboardSlots, monitorSlots })
            });
        } catch (e) {
            showToast(t('toastUpsDisplaySaveError'), 'error');
        }

        updateUPSDashboard().catch(() => {});
        toggleUpsFields();
    } catch (e) {
        showToast(tParams('toastUpsSaveError', { msg: e.message || String(e) }), 'error');
    }

    // После изменения UPS обновим доступность экрана в monitor-mode.
    await refreshMonitorScreensAvailability();
    if (monitorMode && monitorCurrentView === 'ups' && upsMonitorConfigured === false) {
        applyMonitorView('cluster');
    }
}

// ==================== SNMP NETWORK DEVICES (UPS-like UI) ====================

const NETDEV_MAX_CONFIGS = 10;
const NETDEV_MAX_FIELDS = 15;
const NETDEV_FIELD_FORMAT_ALLOWED = ['text', 'time', 'mb', 'gb', 'boot', 'bool', 'status'];

let netdevConfigs = null;
let netdevSlotListenerAttached = false;
let netdevDisplaySlotsMonitor = Array.from({ length: NETDEV_MAX_CONFIGS }, (_, i) => i + 1);
let netdevDisplaySlotsDashboard = Array.from({ length: NETDEV_MAX_CONFIGS }, (_, i) => i + 1);
let netdevDisplaySlotsLoadedPromise = null;
let netdevDisplaySlotsLoadedOnce = false;

function createDefaultNetdevConfig() {
    return {
        enabled: false,
        host: '',
        port: null,
        community: '',
        name: '',
        nameOid: '',
        fields: []
    };
}

function createEmptyNetdevField() {
    return {
        label: '',
        oid: '',
        format: 'text',
        enabled: true,
        statusUpValues: [],
        statusDownValues: []
    };
}

function normalizeFieldForEditor(f) {
    const x = f && typeof f === 'object' ? f : {};
    let fmtRaw = String(x.format || 'text').trim().toLowerCase();
    let format = NETDEV_FIELD_FORMAT_ALLOWED.includes(fmtRaw) ? fmtRaw : 'text';
    if (format === 'bool') format = 'boot';
    return {
        label: x.label != null ? String(x.label) : '',
        oid: x.oid != null ? String(x.oid) : '',
        format,
        enabled: x.enabled !== false,
        statusUpValues: Array.isArray(x.statusUpValues) ? x.statusUpValues : [],
        statusDownValues: Array.isArray(x.statusDownValues) ? x.statusDownValues : []
    };
}

function getNetdevFieldsFromDom() {
    const root = document.getElementById('netdevFieldsEditorsRoot');
    if (!root) return [];
    const blocks = root.querySelectorAll('.netdev-field-block[data-netdev-row]');
    const out = [];
    blocks.forEach((block) => {
        const i = parseInt(block.getAttribute('data-netdev-row'), 10);
        if (!Number.isFinite(i)) return;
        const labelEl = document.getElementById('netdevFieldLabel' + i + 'Input');
        const oidEl = document.getElementById('netdevFieldOid' + i + 'Input');
        const formatEl = document.getElementById('netdevFieldFormat' + i + 'Select');
        const upIn = document.getElementById('netdevFieldStatusUp' + i + 'Input');
        const downIn = document.getElementById('netdevFieldStatusDown' + i + 'Input');
        const enEl = document.getElementById('netdevFieldEnabled' + i + 'Checkbox');
        const fmtRaw = formatEl ? String(formatEl.value || 'text').trim().toLowerCase() : 'text';
        let formatVal = NETDEV_FIELD_FORMAT_ALLOWED.includes(fmtRaw) ? fmtRaw : 'text';
        if (formatVal === 'bool') formatVal = 'boot';
        out.push({
            label: labelEl ? labelEl.value.trim() : '',
            oid: oidEl ? oidEl.value.trim() : '',
            format: formatVal,
            enabled: enEl ? !!enEl.checked : true,
            statusUpValues: parseNetdevStatusListInput(upIn ? upIn.value : ''),
            statusDownValues: parseNetdevStatusListInput(downIn ? downIn.value : '')
        });
    });
    return out;
}

function ensureNetdevSlotTabsRendered() {
    const tabsEl = document.getElementById('netdevSlotTabs');
    if (!tabsEl) return;
    if (tabsEl.dataset.rendered === '1') return;

    tabsEl.innerHTML = '';
    tabsEl.dataset.rendered = '1';

    for (let idx = 0; idx < NETDEV_MAX_CONFIGS; idx++) {
        const slotNum = idx + 1;
        const btn = document.createElement('button');
        btn.type = 'button';
        btn.className = 'nav-link py-1' + (idx === 0 ? ' active' : '');
        btn.setAttribute('role', 'tab');
        btn.dataset.netdevSlotIdx = String(idx);
        btn.setAttribute('aria-selected', idx === 0 ? 'true' : 'false');
        btn.textContent = String(slotNum);
        tabsEl.appendChild(btn);
    }
}

function getNetdevSlotIndex() {
    const tabsEl = document.getElementById('netdevSlotTabs');
    if (tabsEl) {
        const activeBtn = tabsEl.querySelector('button.nav-link.active[data-netdev-slot-idx]');
        const idx = activeBtn ? parseInt(activeBtn.dataset.netdevSlotIdx, 10) : NaN;
        if (Number.isFinite(idx)) return idx;
    }
    return 0;
}

function parseNetdevStatusListInput(str) {
    return String(str || '')
        .split(/[,;|]/)
        .map((s) => s.trim().toLowerCase())
        .filter(Boolean);
}

function updateNetdevStatusMapRowVisibility(fieldIndex) {
    const row = document.getElementById('netdevFieldStatusMapRow' + fieldIndex);
    const sel = document.getElementById('netdevFieldFormat' + fieldIndex + 'Select');
    const hint = document.getElementById('netdevFieldStatusMapHint' + fieldIndex);
    if (!row || !sel) return;
    const show = sel.value === 'status' || sel.value === 'boot';
    row.classList.toggle('d-none', !show);
    if (hint && show) {
        if (sel.value === 'boot') {
            hint.textContent =
                t('netdevStatusMapHintBoot') ||
                'Опционально: перечислите значения SNMP для подключён/отключён; если пусто — правила 0/1, true/false, up/down и др.';
        } else {
            hint.textContent =
                t('netdevStatusMapHintStatus') ||
                'Укажите списки значений SNMP; только они определяют подключён/отключён (без авто-правил).';
        }
    }
}

function refreshAllNetdevStatusMapRows() {
    const root = document.getElementById('netdevFieldsEditorsRoot');
    if (!root) return;
    root.querySelectorAll('.netdev-field-block[data-netdev-row]').forEach((block) => {
        const idx = parseInt(block.getAttribute('data-netdev-row'), 10);
        if (Number.isFinite(idx)) updateNetdevStatusMapRowVisibility(idx);
    });
}

function initNetdevFieldFormatUi() {
    const wrap = document.getElementById('netdevFieldsInputsWrap');
    if (!wrap || wrap.dataset.netdevFormatUi === '1') return;
    wrap.dataset.netdevFormatUi = '1';
    wrap.addEventListener('change', (ev) => {
        const el = ev.target;
        if (!el || !el.id) return;
        const m = el.id.match(/^netdevFieldFormat(\d+)Select$/);
        if (m) updateNetdevStatusMapRowVisibility(parseInt(m[1], 10));
    });
}

function renderNetdevFieldsEditors(fields) {
    const root = document.getElementById('netdevFieldsEditorsRoot');
    const hint = document.getElementById('netdevFieldsCountHint');
    const addBtn = document.getElementById('netdevAddFieldBtn');
    if (!root) return;

    const list = Array.isArray(fields) ? fields.map(normalizeFieldForEditor) : [];
    const lblUp = t('netdevStatusConnected') || 'Подключён';
    const lblDown = t('netdevStatusDisconnected') || 'Отключён';
    const lblEnabled = t('netdevFieldEnabled') || 'Опрашивать';
    const lblRemove = t('netdevFieldRemove') || 'Удалить';
    const lblField = t('netdevFieldNumber') || 'Поле';
    const emptyHint = t('netdevFieldsEmptyHint') || 'Нет полей OID. Добавьте поле кнопкой ниже (до 15).';
    const oidLbl = t('netdevOidLabel');
    const fmtLbl = t('netdevFormatLabel');
    const phEx = t('netdevFieldPlaceholderExample');
    const lblNameSuffix = t('netdevFieldNameSuffix');
    const commaHint = t('commaSeparatedValues');
    const fmtOptText = t('netdevFmtText');
    const fmtOptTime = t('netdevFmtTime');
    const fmtOptMb = t('netdevFmtMb');
    const fmtOptGb = t('netdevFmtGb');
    const fmtOptBoot = t('netdevFmtBoot');
    const fmtOptStatus = t('netdevFmtStatus');

    let html = '';
    if (list.length === 0) {
        html += `<div class="text-muted small py-2 mb-2 border rounded px-3 bg-light">${escapeHtml(emptyHint)}</div>`;
    }

    list.forEach((f, i) => {
        const mutedRow = f.enabled ? '' : ' opacity-50';
        const fmtBootSel = f.format === 'boot' ? ' selected' : '';
        const fmtStatusSel = f.format === 'status' ? ' selected' : '';
        const fmtTextSel = f.format === 'text' ? ' selected' : '';
        const fmtTimeSel = f.format === 'time' ? ' selected' : '';
        const fmtMbSel = f.format === 'mb' ? ' selected' : '';
        const fmtGbSel = f.format === 'gb' ? ' selected' : '';
        const upStr = Array.isArray(f.statusUpValues) ? f.statusUpValues.join(', ') : '';
        const downStr = Array.isArray(f.statusDownValues) ? f.statusDownValues.join(', ') : '';
        html += `
            <div class="netdev-field-block border-bottom pb-3 mb-3${mutedRow}" data-netdev-row="${i}">
                <div class="row g-2 align-items-center mb-2 flex-wrap">
                    <div class="col">
                        <span class="fw-semibold">${escapeHtml(lblField)} ${i + 1}</span>
                    </div>
                    <div class="col-auto">
                        <div class="form-check form-switch m-0">
                            <input class="form-check-input" type="checkbox" role="switch" id="netdevFieldEnabled${i}Checkbox" ${f.enabled ? 'checked' : ''}>
                            <label class="form-check-label small" for="netdevFieldEnabled${i}Checkbox">${escapeHtml(lblEnabled)}</label>
                        </div>
                    </div>
                    <div class="col-auto">
                        <button type="button" class="btn btn-sm btn-outline-danger" data-netdev-remove-row="${i}">${escapeHtml(lblRemove)}</button>
                    </div>
                </div>
                <div class="row g-3 align-items-end">
                    <div class="col-lg-3 col-md-4">
                        <label class="form-label fw-bold" for="netdevFieldLabel${i}Input">${escapeHtml(lblField)} ${i + 1} ${escapeHtml(lblNameSuffix)}</label>
                        <input type="text" class="form-control" id="netdevFieldLabel${i}Input" placeholder="${escapeHtml(phEx)}" value="${escapeHtml(f.label)}">
                    </div>
                    <div class="col-lg-5 col-md-5">
                        <label class="form-label fw-bold" for="netdevFieldOid${i}Input">${escapeHtml(oidLbl)}</label>
                        <input type="text" class="form-control" id="netdevFieldOid${i}Input" placeholder="1.3.6...." value="${escapeHtml(f.oid)}">
                    </div>
                    <div class="col-lg-4 col-md-3">
                        <label class="form-label fw-bold" for="netdevFieldFormat${i}Select">${escapeHtml(fmtLbl)}</label>
                        <select class="form-select" id="netdevFieldFormat${i}Select">
                            <option value="text"${fmtTextSel}>${escapeHtml(fmtOptText)}</option>
                            <option value="time"${fmtTimeSel}>${escapeHtml(fmtOptTime)}</option>
                            <option value="mb"${fmtMbSel}>${escapeHtml(fmtOptMb)}</option>
                            <option value="gb"${fmtGbSel}>${escapeHtml(fmtOptGb)}</option>
                            <option value="boot"${fmtBootSel}>${escapeHtml(fmtOptBoot)}</option>
                            <option value="status"${fmtStatusSel}>${escapeHtml(fmtOptStatus)}</option>
                        </select>
                    </div>
                </div>
                <div class="row g-2 mt-1 d-none" id="netdevFieldStatusMapRow${i}">
                    <div class="col-12 small text-muted mb-0" id="netdevFieldStatusMapHint${i}"></div>
                    <div class="col-md-6">
                        <label class="form-label small mb-1" for="netdevFieldStatusUp${i}Input">«${escapeHtml(lblUp)}» ${escapeHtml(commaHint)}</label>
                        <input type="text" class="form-control form-control-sm" id="netdevFieldStatusUp${i}Input" placeholder="1, up, true" value="${escapeHtml(upStr)}">
                    </div>
                    <div class="col-md-6">
                        <label class="form-label small mb-1" for="netdevFieldStatusDown${i}Input">«${escapeHtml(lblDown)}» ${escapeHtml(commaHint)}</label>
                        <input type="text" class="form-control form-control-sm" id="netdevFieldStatusDown${i}Input" placeholder="0, 2, down" value="${escapeHtml(downStr)}">
                    </div>
                </div>
            </div>`;
    });

    root.innerHTML = html;

    root.querySelectorAll('.netdev-field-block').forEach((block) => {
        const i = parseInt(block.getAttribute('data-netdev-row'), 10);
        const en = document.getElementById('netdevFieldEnabled' + i + 'Checkbox');
        if (en) {
            en.addEventListener('change', () => {
                block.classList.toggle('opacity-50', !en.checked);
            });
        }
    });

    if (hint) {
        hint.textContent = `${list.length} / ${NETDEV_MAX_FIELDS}`;
    }
    if (addBtn) {
        addBtn.disabled = list.length >= NETDEV_MAX_FIELDS;
    }
    refreshAllNetdevStatusMapRows();
}

function netdevAddFieldRow() {
    const cur = getNetdevFieldsFromDom();
    if (cur.length >= NETDEV_MAX_FIELDS) {
        showToast(t('netdevFieldsMaxToast') || `Не больше ${NETDEV_MAX_FIELDS} полей`, 'warning');
        return;
    }
    cur.push(createEmptyNetdevField());
    renderNetdevFieldsEditors(cur);
}

function netdevRemoveFieldRow(rowIdx) {
    const cur = getNetdevFieldsFromDom();
    if (rowIdx < 0 || rowIdx >= cur.length) return;
    cur.splice(rowIdx, 1);
    renderNetdevFieldsEditors(cur);
}

function ensureNetdevFieldsInfrastructure() {
    const wrap = document.getElementById('netdevFieldsInputsWrap');
    if (!wrap) return;
    const INFRA_VER = '6';
    if (wrap.dataset.netdevInfraVer !== INFRA_VER) {
        wrap.dataset.netdevInfraVer = INFRA_VER;
        const addLbl = t('netdevFieldAdd') || 'Добавить поле';
        wrap.innerHTML = `
            <div id="netdevFieldsEditorsRoot"></div>
            <div class="mt-2 d-flex flex-wrap align-items-center gap-2">
                <button type="button" class="btn btn-outline-primary btn-sm" id="netdevAddFieldBtn">${escapeHtml(addLbl)}</button>
                <span class="small text-muted" id="netdevFieldsCountHint"></span>
            </div>`;
        const addBtn = document.getElementById('netdevAddFieldBtn');
        if (addBtn) addBtn.addEventListener('click', () => netdevAddFieldRow());
        wrap.addEventListener('click', (e) => {
            const rm = e.target.closest('[data-netdev-remove-row]');
            if (!rm) return;
            e.preventDefault();
            const idx = parseInt(rm.getAttribute('data-netdev-remove-row'), 10);
            if (Number.isFinite(idx)) netdevRemoveFieldRow(idx);
        });
    }
    initNetdevFieldFormatUi();
}

function renderNetdevDisplayCheckboxes() {
    const dashWrap = document.getElementById('netdevDisplayDashboardSlotsWrap');
    const monWrap = document.getElementById('netdevDisplayMonitorSlotsWrap');
    if (!dashWrap || !monWrap) return;

    if (dashWrap.dataset.rendered === '1' && monWrap.dataset.rendered === '1') return;

    dashWrap.innerHTML = '';
    monWrap.innerHTML = '';

    dashWrap.dataset.rendered = '1';
    monWrap.dataset.rendered = '1';

    for (let s = 1; s <= NETDEV_MAX_CONFIGS; s++) {
        dashWrap.insertAdjacentHTML('beforeend', `
            <div class="form-check">
                <input class="form-check-input netdevDisplayDashboardSlot" type="checkbox" id="netdevDisplayDashboardSlot${s}" value="${s}">
                <label class="form-check-label" for="netdevDisplayDashboardSlot${s}">${s}</label>
            </div>
        `);
        monWrap.insertAdjacentHTML('beforeend', `
            <div class="form-check">
                <input class="form-check-input netdevDisplayMonitorSlot" type="checkbox" id="netdevDisplayMonitorSlot${s}" value="${s}">
                <label class="form-check-label" for="netdevDisplayMonitorSlot${s}">${s}</label>
            </div>
        `);
    }
}

function getCheckedNetdevSlotsByClass(checkboxClass) {
    const boxes = document.querySelectorAll('input.' + checkboxClass + ':checked');
    const slots = Array.from(boxes)
        .map((b) => parseInt(b.value, 10))
        .filter((n) => Number.isFinite(n) && n >= 1 && n <= NETDEV_MAX_CONFIGS);
    return Array.from(new Set(slots)).sort((a, b) => a - b);
}

function setNetdevDisplayCheckboxes(dashboardSlots, monitorSlots) {
    for (let s = 1; s <= NETDEV_MAX_CONFIGS; s++) {
        const dashBox = document.getElementById('netdevDisplayDashboardSlot' + s);
        if (dashBox) dashBox.checked = Array.isArray(dashboardSlots) && dashboardSlots.includes(s);
        const monBox = document.getElementById('netdevDisplayMonitorSlot' + s);
        if (monBox) monBox.checked = Array.isArray(monitorSlots) && monitorSlots.includes(s);
    }
}

async function ensureNetdevDisplaySlotsLoaded() {
    if (netdevDisplaySlotsLoadedPromise) return netdevDisplaySlotsLoadedPromise;

    netdevDisplaySlotsLoadedPromise = (async () => {
        try {
            const resp = await fetch('/api/netdevices/display');
            const data = await resp.json();
            if (data && data.success) {
                if (Array.isArray(data.dashboardSlots)) netdevDisplaySlotsDashboard = data.dashboardSlots;
                if (Array.isArray(data.monitorSlots)) netdevDisplaySlotsMonitor = data.monitorSlots;
            }
        } catch (e) {
            // Defaults are already set
        }

        // Update checkboxes
        try {
            setNetdevDisplayCheckboxes(netdevDisplaySlotsDashboard, netdevDisplaySlotsMonitor);
        } catch (_) {}

        netdevDisplaySlotsLoadedOnce = true;
    })();

    return netdevDisplaySlotsLoadedPromise;
}

async function loadNetdevSettings() {
    // Render dynamic parts once
    ensureNetdevSlotTabsRendered();
    ensureNetdevFieldsInfrastructure();
    renderNetdevDisplayCheckboxes();

    const enabledSelect = document.getElementById('netdevEnabledSelect');
    const hostInput = document.getElementById('netdevHostInput');
    const portInput = document.getElementById('netdevPortInput');
    const communityInput = document.getElementById('netdevCommunityInput');
    const nameInput = document.getElementById('netdevNameInput');
    const nameOidInput = document.getElementById('netdevNameOidInput');
    if (!enabledSelect || !hostInput || !portInput || !communityInput || !nameInput || !nameOidInput) return;

    const applySlotToForm = (slotIdx) => {
        const cfg = (Array.isArray(netdevConfigs) && netdevConfigs[slotIdx]) ? netdevConfigs[slotIdx] : createDefaultNetdevConfig();

        enabledSelect.value = cfg.enabled ? '1' : '0';
        if (hostInput) hostInput.value = cfg.host || '';
        if (portInput) portInput.value = cfg.port != null ? String(cfg.port) : '';
        if (communityInput) communityInput.value = cfg.community || '';
        if (nameInput) nameInput.value = cfg.name || '';
        if (nameOidInput) nameOidInput.value = cfg.nameOid || '';

        const fields = Array.isArray(cfg.fields) ? cfg.fields : [];
        renderNetdevFieldsEditors(fields);
    };

    try {
        const res = await fetch('/api/netdevices/settings');
        const data = await res.json();
        if (Array.isArray(data?.configs)) {
            netdevConfigs = data.configs;
        } else {
            netdevConfigs = [];
        }
        while (netdevConfigs.length < NETDEV_MAX_CONFIGS) netdevConfigs.push(createDefaultNetdevConfig());

        const slotIdx = getNetdevSlotIndex();
        applySlotToForm(slotIdx);
    } catch (e) {
        console.error('Failed to load Netdev settings:', e);
        netdevConfigs = Array.from({ length: NETDEV_MAX_CONFIGS }, () => createDefaultNetdevConfig());
        applySlotToForm(0);
    }

    if (!netdevSlotListenerAttached) {
        const tabsEl = document.getElementById('netdevSlotTabs');
        if (tabsEl) {
            const btns = tabsEl.querySelectorAll('button.nav-link[data-netdev-slot-idx]');
            btns.forEach((btn) => {
                btn.addEventListener('click', () => {
                    const idx = parseInt(btn.dataset.netdevSlotIdx, 10);
                    if (!Number.isFinite(idx)) return;

                    btns.forEach(b => {
                        b.classList.toggle('active', b === btn);
                        b.setAttribute('aria-selected', String(b === btn));
                    });
                    applySlotToForm(idx);
                });
            });
            netdevSlotListenerAttached = true;
        }
    }
}

async function saveNetdevSettings() {
    const enabledSelect = document.getElementById('netdevEnabledSelect');
    const hostInput = document.getElementById('netdevHostInput');
    const portInput = document.getElementById('netdevPortInput');
    const communityInput = document.getElementById('netdevCommunityInput');
    const nameInput = document.getElementById('netdevNameInput');
    const nameOidInput = document.getElementById('netdevNameOidInput');
    if (!enabledSelect || !hostInput || !portInput || !communityInput || !nameInput || !nameOidInput) return;

    const enabled = String(enabledSelect.value || '0') === '1';
    const host = hostInput.value.trim();
    const port = portInput.value.trim() !== '' ? parseInt(portInput.value.trim(), 10) : null;
    const community = communityInput.value.trim();
    const name = nameInput.value.trim();
    const nameOid = nameOidInput.value.trim();

    const slotIdx = getNetdevSlotIndex();
    const cfg = (Array.isArray(netdevConfigs) && netdevConfigs[slotIdx]) ? netdevConfigs[slotIdx] : createDefaultNetdevConfig();

    cfg.enabled = enabled;
    cfg.host = host;
    cfg.port = port != null && Number.isFinite(port) ? port : null;
    cfg.community = community;
    cfg.name = name;
    cfg.nameOid = nameOid;

    cfg.fields = getNetdevFieldsFromDom();

    if (!Array.isArray(netdevConfigs)) netdevConfigs = [];
    while (netdevConfigs.length < NETDEV_MAX_CONFIGS) netdevConfigs.push(createDefaultNetdevConfig());
    netdevConfigs[slotIdx] = cfg;

    try {
        const res = await fetch('/api/netdevices/settings', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ configs: Array.isArray(netdevConfigs) ? netdevConfigs : [] })
        });
        const data = await res.json();
        if (!res.ok || !data?.success) throw new Error(data?.error || 'failed to save');

        // Save display slots
        try {
            const hasDashboardBoxes = document.querySelectorAll('input.netdevDisplayDashboardSlot').length > 0;
            const hasMonitorBoxes = document.querySelectorAll('input.netdevDisplayMonitorSlot').length > 0;
            const dashboardSlots = hasDashboardBoxes ? getCheckedNetdevSlotsByClass('netdevDisplayDashboardSlot') : netdevDisplaySlotsDashboard;
            const monitorSlots = hasMonitorBoxes ? getCheckedNetdevSlotsByClass('netdevDisplayMonitorSlot') : netdevDisplaySlotsMonitor;

            await fetch('/api/netdevices/display', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ dashboardSlots, monitorSlots })
            });
        } catch (e) {
            showToast(t('toastNetdevDisplaySaveError'), 'error');
        }

        showToast(t('toastNetdevSaved'), 'success');
        await updateNetdevDashboard();
    } catch (e) {
        showToast(tParams('toastNetdevSaveError', { msg: e.message || String(e) }), 'error');
    }

    // После изменения SNMP обновим доступность экрана в monitor-mode.
    await refreshMonitorScreensAvailability();
    if (monitorMode && monitorCurrentView === 'netdev' && netdevMonitorConfigured === false) {
        applyMonitorView('cluster');
    }
}

function formatNetdevMetricValue(v) {
    if (v == null || (typeof v === 'string' && v.trim() === '')) return '—';
    const s = String(v).trim();
    const n = Number(s);
    if (Number.isFinite(n)) {
        const rounded = Math.abs(n) >= 100 ? Math.round(n) : Math.round(n * 10) / 10;
        return `${rounded}`;
    }
    return s;
}

function netdevMetricTile(label, valueStr) {
    return `
        <div class="col-6 col-md-4 col-xl-3">
            <div class="text-center p-3">
                <h6 class="mb-1"><i class="bi bi-diagram-3 me-1"></i>${escapeHtml(label)}</h6>
                <div class="fs-3 fw-semibold lh-sm text-break">${escapeHtml(valueStr)}</div>
            </div>
        </div>`;
}

function netdevMetricCompactTile(label, valueStr, colClass) {
    return `
        <div class="${colClass || 'col-6'}">
            <div class="text-center p-2 h-100">
                <h6 class="mb-1"><i class="bi bi-diagram-3 me-1"></i>${escapeHtml(label)}</h6>
                <div class="fs-5 fw-semibold lh-sm text-break">${escapeHtml(valueStr)}</div>
            </div>
        </div>`;
}

/** innerHtml уже безопасен (escapeHtml внутри) */
function netdevMetricTileHtml(label, innerHtml) {
    return `
        <div class="col-6 col-md-4 col-xl-3">
            <div class="text-center p-3">
                <h6 class="mb-1"><i class="bi bi-diagram-3 me-1"></i>${escapeHtml(label)}</h6>
                <div class="fs-3 fw-semibold lh-sm text-break">${innerHtml}</div>
            </div>
        </div>`;
}

function netdevMetricCompactTileHtml(label, innerHtml, colClass) {
    return `
        <div class="${colClass || 'col-6'}">
            <div class="text-center p-2 h-100">
                <h6 class="mb-1"><i class="bi bi-diagram-3 me-1"></i>${escapeHtml(label)}</h6>
                <div class="fs-5 fw-semibold lh-sm text-break">${innerHtml}</div>
            </div>
        </div>`;
}

function netdevStatusDisplayInnerHtml(statusKey, displayText, rawVal) {
    const esc = escapeHtml(displayText);
    if (statusKey === 'connected') return `<span class="text-success fw-semibold">${esc}</span>`;
    if (statusKey === 'disconnected') return `<span class="text-danger fw-semibold">${esc}</span>`;
    if (statusKey === 'unknown') {
        const rawTrim = rawVal != null ? String(rawVal).trim() : '';
        const raw =
            rawTrim !== ''
                ? ` <span class="text-muted small fw-normal">(${escapeHtml(rawTrim)})</span>`
                : '';
        return `<span class="text-muted fw-semibold">${esc}</span>${raw}`;
    }
    return esc;
}

function buildNetdevCardsHtml(data) {
    const items = Array.isArray(data?.items) ? data.items : [];
    const netdevColClass = items.length === 1 ? 'col-12' : 'col-md-6';
    const rowClass = items.length === 1 ? 'row g-2' : 'row row-cols-1 row-cols-sm-2 g-2 small';

    const buildFieldsTiles = (fields, opts) => {
        const useCompact = !!opts?.compact;
        const tiles = [];
        for (const f of Array.isArray(fields) ? fields : []) {
            if (f && f.enabled === false) continue;
            const oid = f?.oid ? String(f.oid).trim() : '';
            if (!oid) continue; // Skip unconfigured fields
            const label = f?.label ? String(f.label).trim() : lastFallbackLabel(oid);
            const rawVal = f?.value != null ? String(f.value) : null;
            const disp = f?.displayValue != null && String(f.displayValue).trim() !== ''
                ? String(f.displayValue).trim()
                : null;
            const st = f?.statusDisplay;
            let innerHtml;
            if (st === 'connected' || st === 'disconnected' || st === 'unknown') {
                let valueStr;
                if (st === 'connected') {
                    valueStr = t('netdevStatusConnected') || 'Подключён';
                } else if (st === 'disconnected') {
                    valueStr = t('netdevStatusDisconnected') || 'Отключён';
                } else {
                    valueStr = t('netdevStatusUnknown') || 'Неизвестно';
                }
                innerHtml = netdevStatusDisplayInnerHtml(st, valueStr, rawVal);
            } else {
                let valueStr;
                if (disp != null) {
                    valueStr = disp;
                } else {
                    valueStr =
                        rawVal != null && rawVal.trim() !== '' ? formatNetdevMetricValue(rawVal) : '—';
                }
                innerHtml = escapeHtml(valueStr);
            }
            if (useCompact) tiles.push(netdevMetricCompactTileHtml(label, innerHtml));
            else tiles.push(netdevMetricTileHtml(label, innerHtml));
        }
        return tiles.join('');
    };

    const lastFallbackLabel = (oid) => {
        const s = String(oid || '').trim();
        const parts = s.split('.').filter(Boolean);
        return parts.length ? parts[parts.length - 1] : t('netdevFieldFallbackLabel');
    };

    if (items.length === 1) {
        const item = items[0] || {};
        const name = item.name || tParams('netdevDeviceFallback', { n: String(item.slot || 1) });
        if (item.error) {
            const html = `
                <div class="col-12">
                    <div class="alert alert-warning mb-0 py-2 d-flex flex-wrap justify-content-between align-items-center gap-2">
                        <span class="fw-semibold text-truncate" title="${escapeHtml(name)}">${escapeHtml(name)}</span>
                        <span class="small">${escapeHtml(t('netdevSnmpPrefix'))}: ${escapeHtml(item.error)}</span>
                    </div>
                </div>`;
            return { html, rowClass: 'row g-2' };
        }

        const badgeClass = item.up ? 'bg-success' : 'bg-secondary';
        const statusLabel = item.up ? t('statusOkShort') : t('statusDash');

        const fieldsHtml = buildFieldsTiles(item.fields, {});
        const hostLine = item.host ? tParams('netdevSnmpWithHost', { host: item.host }) : t('netdevSnmpPrefix');

        const html = `
            <div class="col-12">
                <div class="d-flex flex-wrap justify-content-between align-items-center gap-2 mb-3 pb-3 border-bottom">
                    <div class="fw-semibold fs-5 text-truncate" title="${escapeHtml(name)}">${escapeHtml(name)}</div>
                    <span class="badge ${badgeClass}">${escapeHtml(statusLabel)}</span>
                </div>
                <div class="row g-2">
                    ${fieldsHtml}
                </div>
                <p class="small text-muted text-center mb-0 mt-3">${escapeHtml(hostLine)}</p>
            </div>`;

        return { html, rowClass: 'row g-2' };
    }

    const html = items.map((item) => {
        const slotStr = String(item.slot || '').trim();
        const name = item.name || tParams('netdevDeviceFallback', { n: slotStr || '?' });
        const badgeClass = item.up ? 'bg-success' : 'bg-secondary';
        const statusLabel = item.up ? t('statusOkShort') : t('statusDash');
        const fieldsHtml = buildFieldsTiles(item.fields, { compact: true });

        if (item.error) {
            return `
                <div class="${netdevColClass}">
                    <div class="card h-100">
                        <div class="card-header py-2 px-2 d-flex justify-content-between align-items-center">
                            <div class="fw-semibold text-truncate pe-2" title="${escapeHtml(name)}">${escapeHtml(name)}</div>
                            <span class="badge bg-secondary">${escapeHtml(t('netdevSnmpPrefix'))}</span>
                        </div>
                        <div class="card-body p-2">
                            <div class="small text-muted">${escapeHtml(tParams('netdevErrorWithMessage', { msg: item.error }))}</div>
                        </div>
                    </div>
                </div>
            `;
        }

        return `
            <div class="${netdevColClass}">
                <div class="card h-100">
                    <div class="card-header py-2 px-2 d-flex justify-content-between align-items-center">
                        <div class="fw-semibold text-truncate pe-2" title="${escapeHtml(name)}">${escapeHtml(name)}</div>
                        <span class="badge ${badgeClass}">${escapeHtml(statusLabel)}</span>
                    </div>
                    <div class="card-body p-2">
                        <div class="row g-2">
                            ${fieldsHtml}
                        </div>
                    </div>
                </div>
            </div>
        `;
    }).join('');

    return { html, rowClass };
}

async function updateNetdevDashboard() {
    const dashboardCards = document.getElementById('dashboardNetdevCards');
    const dashSection = document.getElementById('dashboardNetdevSection');
    const updatedAtEl = document.getElementById('dashboardNetdevUpdatedAt');

    const netdevMonitorCards = document.getElementById('netdevMonitorCards');
    const netdevMonSection = document.getElementById('netdevMonitorSection');
    const netdevUpdatedAtEl = document.getElementById('netdevUpdatedAt');

    const isNetdevMonitorScreen = monitorMode && monitorCurrentView === 'netdev';
    const cardsEl = isNetdevMonitorScreen ? netdevMonitorCards : dashboardCards;
    const sectionEl = isNetdevMonitorScreen ? netdevMonSection : dashSection;
    const updatedAtTargetEl = isNetdevMonitorScreen ? netdevUpdatedAtEl : updatedAtEl;

    if (!cardsEl || !sectionEl) return;

    cardsEl.innerHTML = '';
    cardsEl.className = 'row g-2 small';
    if (updatedAtTargetEl) updatedAtTargetEl.textContent = '';

    try {
        const res = await fetch('/api/netdevices/current');
        const data = await res.json();

        let items = Array.isArray(data?.items) ? data.items : [];

        // Обновляем кеш доступности экрана для корректного свайп-порядка.
        // Используем “вычисленную” доступность, т.е. configured + есть хотя бы 1 доступный слот.
        netdevMonitorConfigured = !!(data && data.configured && Array.isArray(data.items) && data.items.length > 0);

        if (!isNetdevMonitorScreen) {
            // В monitor-mode на экране Cluster сетка берёт слоты “монитора”, а в обычном режиме — слоты “дашборда”
            const isMonitorCluster = monitorMode && monitorCurrentView === 'cluster';
            const slotsForDashboard = isMonitorCluster ? netdevDisplaySlotsMonitor : netdevDisplaySlotsDashboard;
            const safeSlotsForDashboard = (Array.isArray(slotsForDashboard) && slotsForDashboard.length > 0)
                ? slotsForDashboard
                : (netdevDisplaySlotsLoadedOnce ? [] : Array.from({ length: NETDEV_MAX_CONFIGS }, (_, i) => i + 1));

            items = (Array.isArray(safeSlotsForDashboard) && safeSlotsForDashboard.length > 0)
                ? items.filter((it) => safeSlotsForDashboard.includes(it.slot))
                : items;
        } else {
            // На экране netdev используем слот(ы) “монитора”, чтобы чекбоксы из настроек работали и тут.
            const slotsForMonitor = netdevDisplaySlotsMonitor;
            const safeSlotsForMonitor = (Array.isArray(slotsForMonitor) && slotsForMonitor.length > 0)
                ? slotsForMonitor
                : (netdevDisplaySlotsLoadedOnce ? [] : Array.from({ length: NETDEV_MAX_CONFIGS }, (_, i) => i + 1));

            items = (Array.isArray(safeSlotsForMonitor) && safeSlotsForMonitor.length > 0)
                ? items.filter((it) => safeSlotsForMonitor.includes(it.slot))
                : items;
        }

        const showSection = !!(data && data.configured && Array.isArray(items) && items.length > 0);
        if (isNetdevMonitorScreen) {
            // UX: в monitor-mode не прячем экран целиком — иначе получится пустая зона.
            sectionEl.style.display = '';
        } else {
            sectionEl.style.display = showSection ? '' : 'none';
        }

        if (!showSection) {
            cardsEl.innerHTML = `
                <div class="col-12">
                    <div class="text-muted small">Сетевые устройства не настроены</div>
                </div>`;
            if (updatedAtTargetEl && data?.updatedAt) updatedAtTargetEl.textContent = new Date(data.updatedAt).toLocaleString();
            return;
        }

        if (updatedAtTargetEl && data?.updatedAt) updatedAtTargetEl.textContent = new Date(data.updatedAt).toLocaleString();

        const payload = { ...data, items };
        const { html, rowClass } = buildNetdevCardsHtml(payload);
        cardsEl.className = rowClass || 'row g-2 small';
        cardsEl.innerHTML = html;
    } catch (e) {
        cardsEl.innerHTML = `<div class="col-12"><div class="text-danger small">${escapeHtml((e && e.message) ? e.message : String(e))}</div></div>`;
        sectionEl.style.display = '';
    }
}

function formatSpeedtestMbps(v) {
    if (v == null || !Number.isFinite(Number(v))) return '—';
    const n = Math.round(Number(v) * 10) / 10;
    return `${n} Mbps`;
}

async function updateSpeedtestDashboard() {
    const dashSection = document.getElementById('dashboardSpeedtestSection');
    const setEl = (id, text) => {
        const el = document.getElementById(id);
        if (el) el.textContent = text;
    };
    try {
        const res = await fetch('/api/speedtest/summary');
        const summary = await res.json();
        if (!res.ok) throw new Error(summary.error || `HTTP ${res.status}`);

        const enabled = !!(summary.enabled === true || summary.enabled === '1' || summary.enabled === 1);

        // Обновляем кеш доступности экрана для корректного свайп-порядка.
        speedtestMonitorConfigured = enabled;

        if (dashSection) dashSection.style.display = enabled ? '' : 'none';
        if (!enabled) {
            // Чтобы на экране монитора не оставались “старые” значения.
            setEl('speedtestMonitorLastRun', '—');
            setEl('speedtestMonitorAvg', '—');
            setEl('speedtestMonitorMin', '—');
            setEl('speedtestMonitorMax', '—');
            setEl('speedtestMonitorExtra', t('backupNoData') || 'Нет данных');

            // На главном дашборде оставим “—” на полях, если они есть.
            setEl('dashboardSpeedtestLastRun', '—');
            setEl('dashboardSpeedtestAvg', '—');
            setEl('dashboardSpeedtestMin', '—');
            setEl('dashboardSpeedtestMax', '—');
            setEl('dashboardSpeedtestExtra', '');
            return;
        }

        const last = summary.last;
        const lastTime = last && last.runAt ? new Date(last.runAt).toLocaleString() : '—';
        let lastMain = lastTime;
        if (last && last.error) {
            lastMain = `${lastTime}: ${last.error}`;
        } else if (last && last.downloadMbps != null) {
            lastMain = `${lastTime} · ${formatSpeedtestMbps(last.downloadMbps)} ↓`;
        }

        const td = summary.today || {};
        const dl = td.download || {};
        const ul = td.upload || {};

        setEl('dashboardSpeedtestLastRun', lastMain);
        setEl('dashboardSpeedtestAvg', formatSpeedtestMbps(dl.avg));
        setEl('dashboardSpeedtestMin', formatSpeedtestMbps(dl.min));
        setEl('dashboardSpeedtestMax', formatSpeedtestMbps(dl.max));

        let extra = '';
        if (last && !last.error && last.uploadMbps != null) {
            extra += `${t('speedtestUploadShort')}: ${formatSpeedtestMbps(last.uploadMbps)}`;
        }
        if (last && last.pingMs != null) {
            extra += (extra ? ' · ' : '') + `Ping: ${Math.round(Number(last.pingMs) * 10) / 10} ms`;
        }
        if (last && last.serverName) {
            extra += (extra ? ' · ' : '') + String(last.serverName);
        }
        if (ul.avg != null) {
            extra += (extra ? ' · ' : '') + `${t('speedtestUploadAvgToday')}: ${formatSpeedtestMbps(ul.avg)}`;
        }
        setEl('dashboardSpeedtestExtra', extra);

        setEl('speedtestMonitorLastRun', lastMain);
        setEl('speedtestMonitorAvg', formatSpeedtestMbps(dl.avg));
        setEl('speedtestMonitorMin', formatSpeedtestMbps(dl.min));
        setEl('speedtestMonitorMax', formatSpeedtestMbps(dl.max));
        setEl('speedtestMonitorExtra', extra);

        const cliEl = document.getElementById('speedtestCliStatus');
        if (cliEl) {
            cliEl.textContent = summary.cliAvailable
                ? (t('speedtestCliOk') || 'CLI: OK')
                : (t('speedtestCliMissing') || 'CLI: not found');
            cliEl.className = 'small ' + (summary.cliAvailable ? 'text-success' : 'text-warning');
        }
    } catch (e) {
        // If speedtest fetch fails, show clear placeholders on the monitor screen.
        if (dashSection) dashSection.style.display = 'none';
        setEl('speedtestMonitorLastRun', '—');
        setEl('speedtestMonitorAvg', '—');
        setEl('speedtestMonitorMin', '—');
        setEl('speedtestMonitorMax', '—');
        const fallback = t('backupNoData') || 'Нет данных';
        const msg = (e && e.message) ? String(e.message) : null;
        setEl('speedtestMonitorExtra', msg ? `${fallback}: ${msg}` : fallback);
    }
}

async function saveSpeedtestSettings() {
    const en = document.getElementById('speedtestEnabledSelect') && document.getElementById('speedtestEnabledSelect').value === '1';
    speedtestClientEnabled = en;
    const server = (document.getElementById('speedtestServerInput')?.value || '').trim();
    let perDay = parseInt(document.getElementById('speedtestPerDayInput')?.value, 10);
    if (!Number.isFinite(perDay) || perDay < 1) perDay = 4;
    if (perDay > 48) perDay = 48;
    const dayInput = document.getElementById('speedtestPerDayInput');
    if (dayInput) dayInput.value = String(perDay);
    await saveSettingsToServer({
        speedtestEnabled: en,
        speedtestServer: server,
        speedtestPerDay: perDay
    });
    renderSettingsMonitorScreensOrderList();
    showToast(t('speedtestSaved') || t('dataUpdated'), 'success');
    updateSpeedtestDashboard().catch(() => {});

    // После изменения включения refresh'им доступность экрана в monitor-mode.
    await refreshMonitorScreensAvailability();
    if (monitorMode && monitorCurrentView === 'speedtest' && speedtestMonitorConfigured === false) {
        applyMonitorView('cluster');
    }
}

async function runSpeedtestNow() {
    const btn = document.getElementById('speedtestRunNowBtn');
    if (btn) btn.disabled = true;
    try {
        const res = await fetch('/api/speedtest/run', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' });
        const data = await res.json();
        if (!res.ok) {
            throw new Error(data.error || data.message || `HTTP ${res.status}`);
        }
        showToast(t('speedtestRunDone') || t('dataUpdated'), 'success');
        updateSpeedtestDashboard().catch(() => {});
    } catch (e) {
        const msg = (e && e.message) ? e.message : String(e);
        showToast((t('speedtestRunError') || 'Speedtest: {msg}').replace('{msg}', msg), 'error');
    } finally {
        if (btn) btn.disabled = false;
    }
}

/** Последний ответ /api/debug для экспорта отчёта */
let lastDebugServerData = null;

function getBrowserAndDisplayInfo() {
    const nav = typeof navigator !== 'undefined' ? navigator : {};
    const win = typeof window !== 'undefined' ? window : null;
    const scr = typeof screen !== 'undefined' ? screen : {};
    return {
        userAgent: nav.userAgent || '—',
        language: nav.language || '—',
        languages: (nav.languages && nav.languages.length) ? nav.languages.join(', ') : '—',
        platform: nav.platform || '—',
        hardwareConcurrency: nav.hardwareConcurrency != null ? nav.hardwareConcurrency : '—',
        deviceMemory: nav.deviceMemory != null ? nav.deviceMemory + ' GB' : '—',
        cookieEnabled: !!nav.cookieEnabled,
        screenWidth: scr.width != null ? scr.width : '—',
        screenHeight: scr.height != null ? scr.height : '—',
        availWidth: scr.availWidth != null ? scr.availWidth : '—',
        availHeight: scr.availHeight != null ? scr.availHeight : '—',
        colorDepth: scr.colorDepth != null ? scr.colorDepth + ' bit' : '—',
        pixelRatio: win && win.devicePixelRatio != null ? win.devicePixelRatio : '—',
        innerWidth: win && win.innerWidth != null ? win.innerWidth : '—',
        innerHeight: win && win.innerHeight != null ? win.innerHeight : '—'
    };
}

async function refreshDebugMetrics() {
    const serverEl = document.getElementById('settingsDebugServerMetrics');
    const clientEl = document.getElementById('settingsDebugClientMetrics');
    if (!serverEl || !clientEl) return;
    serverEl.textContent = '…';
    clientEl.textContent = '…';
    let serverText = '—';
    try {
        const res = await fetch('/api/debug');
        const data = await res.json();
        lastDebugServerData = data;
        const mem = data.memory || {};
        const fmt = (n) => (n != null && typeof n === 'number') ? (n / 1024 / 1024).toFixed(2) + ' MB' : '—';
        const cache = data.cache || {};
        serverText = [
            `version: ${data.version ?? '—'}`,
            `env: ${data.env ?? '—'}`,
            `node: ${data.nodeVersion ?? '—'}`,
            `platform: ${data.platform ?? '—'} ${data.arch ?? ''}`,
            `uptime: ${data.uptimeSeconds != null ? data.uptimeSeconds + ' s' : '—'}`,
            `startTime: ${data.startTime ?? '—'}`,
            `dbPath: ${data.dbPath ?? '—'}`,
            `memory.rss: ${fmt(mem.rss)}`,
            `memory.heapUsed: ${fmt(mem.heapUsed)}`,
            `memory.heapTotal: ${fmt(mem.heapTotal)}`,
            `cache.keys: ${cache.keys ?? '—'}`,
            `cache.hits: ${cache.hits ?? '—'}`,
            `cache.misses: ${cache.misses ?? '—'}`,
            `connectionsCount: ${data.connectionsCount ?? '—'}`,
            `settingsPasswordSet: ${!!data.settingsPasswordSet}`
        ].join('\n');
    } catch (e) {
        serverText = 'Ошибка: ' + (e.message || String(e));
        lastDebugServerData = null;
    }
    serverEl.textContent = serverText;
    const connId = getCurrentConnectionId();
    const lastRefreshStr = lastRefreshTime != null ? new Date(lastRefreshTime).toLocaleString() : '—';
    const browserDisplay = getBrowserAndDisplayInfo();
    const clientText = [
        '--- App ---',
        `language: ${currentLanguage ?? '—'}`,
        `serverType: ${currentServerType ?? '—'}`,
        `connectionId: ${connId ?? '—'}`,
        `refreshIntervalMs: ${refreshIntervalMs ?? '—'}`,
        `lastRefreshTime: ${lastRefreshStr}`,
        `monitorMode: ${!!monitorMode}`,
        `monitorTheme: ${monitorTheme ?? '—'}`,
        `settingsPasswordRequired: ${!!settingsPasswordRequired}`,
        '',
        '--- Browser ---',
        `userAgent: ${browserDisplay.userAgent}`,
        `language: ${browserDisplay.language}`,
        `languages: ${browserDisplay.languages}`,
        `platform: ${browserDisplay.platform}`,
        `hardwareConcurrency: ${browserDisplay.hardwareConcurrency}`,
        `deviceMemory: ${browserDisplay.deviceMemory}`,
        `cookieEnabled: ${browserDisplay.cookieEnabled}`,
        '',
        '--- Display ---',
        `screen: ${browserDisplay.screenWidth} × ${browserDisplay.screenHeight}`,
        `avail: ${browserDisplay.availWidth} × ${browserDisplay.availHeight}`,
        `colorDepth: ${browserDisplay.colorDepth}`,
        `devicePixelRatio: ${browserDisplay.pixelRatio}`,
        `inner (viewport): ${browserDisplay.innerWidth} × ${browserDisplay.innerHeight}`
    ].join('\n');
    clientEl.textContent = clientText;
}

async function pingDebugApi() {
    const el = document.getElementById('settingsDebugPingResult');
    if (!el) return;
    el.textContent = '…';
    const t0 = performance.now();
    try {
        await fetch('/api/debug');
        const ms = Math.round(performance.now() - t0);
        el.textContent = (t('settingsDebugPingResult') || 'Пинг: %d ms').replace('%d', String(ms));
    } catch (e) {
        el.textContent = (t('errorUpdate') || 'Ошибка') + ': ' + (e.message || String(e));
    }
}

async function clearDebugCache() {
    try {
        const res = await fetch('/api/cache/clear', { method: 'POST' });
        const data = await res.json();
        if (data.success) {
            showToast(t('settingsDebugCacheCleared') || 'Кэш очищен', 'success');
            refreshDebugMetrics();
        } else {
            showToast((data.error || 'Error') + '', 'error');
        }
    } catch (e) {
        showToast((e.message || String(e)) + '', 'error');
    }
}

async function resetAllSettings() {
    const btn = document.getElementById('settingsDebugResetAllBtn');
    const cb = document.getElementById('settingsDebugResetAllConfirmCheckbox');
    if (btn) btn.disabled = true;

    if (cb && !cb.checked) {
        showToast(t('settingsDebugResetAllNeedCheckboxText') || 'Please confirm by checkbox', 'error');
        if (btn) btn.disabled = false;
        return;
    }

    try {
        const res = await fetch('/api/settings/reset', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' });
        const data = await res.json().catch(() => ({}));
        if (res.ok && data.success !== false) {
            showToast(t('settingsDebugResetAllDone') || 'All settings reset', 'success');
            window.location.reload();
        } else {
            const msg = data.error || t('settingsDebugResetAllError') || 'Reset failed';
            showToast(String(msg), 'error');
        }
    } catch (e) {
        showToast((t('settingsDebugResetAllError') || 'Reset failed') + ': ' + (e.message || String(e)), 'error');
    } finally {
        if (btn) btn.disabled = false;
    }
}

function exportDebugReport() {
    const client = {
        language: currentLanguage,
        serverType: currentServerType,
        connectionId: getCurrentConnectionId(),
        refreshIntervalMs,
        lastRefreshTime: lastRefreshTime != null ? new Date(lastRefreshTime).toISOString() : null,
        monitorMode: !!monitorMode,
        monitorTheme,
        settingsPasswordRequired: !!settingsPasswordRequired,
        browser: getBrowserAndDisplayInfo()
    };
    const report = {
        exportedAt: new Date().toISOString(),
        server: lastDebugServerData,
        client
    };
    const blob = new Blob([JSON.stringify(report, null, 2)], { type: 'application/json' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = 'debug-report-' + new Date().toISOString().slice(0, 19).replace(/:/g, '-') + '.json';
    a.click();
    URL.revokeObjectURL(a.href);
}

function reloadApplication() {
    // Перезапуск Node.js-сервера через API; после ответа сервер завершится (PM2/nodemon перезапустят)
    var url = window.location.href;
    fetch('/api/restart', { method: 'POST' })
        .then(function () {
            showToast(t('settingsDebugRestarting') || 'Перезапуск сервера…', 'info');
            // Ждём завершения сервера и пробуем перезагрузить страницу, когда он поднимется
            var attempts = 0;
            var maxAttempts = 30;
            function poll() {
                attempts++;
                fetch(url, { method: 'HEAD', mode: 'same-origin' }).then(function () {
                    window.location.reload();
                }).catch(function () {
                    if (attempts < maxAttempts) setTimeout(poll, 1000);
                    else window.location.href = url;
                });
            }
            setTimeout(poll, 2000);
        })
        .catch(function (err) {
            showToast((t('settingsDebugRestartError') || 'Ошибка перезапуска') + ': ' + (err.message || err), 'error');
        });
}

// Show settings section
async function showConfig() {
    if (!(await ensureSettingsUnlocked())) return;
    document.getElementById('configSection').style.display = 'block';
    document.getElementById('dashboardSection').style.display = 'none';
    const servicesSection = document.getElementById('servicesMonitorSection');
    if (servicesSection) servicesSection.style.display = 'none';
    await loadSettingsPanelData();
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
        await loadSettingsPanelData();
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

function onSettingsNavSectionChange(section) {
    // Мы держим все настройки UPS/Netdev внутри settings-tab-services по разметке,
    // но по клику слева показываем "только нужный блок", чтобы экраны не выглядели одинаково.
    // section: 'services' | 'ups' | 'netdev'
    const servicesHosts = document.getElementById('servicesHostsSettingsWrap');
    const upsWrap = document.getElementById('upsSettingsCardWrap');
    const netdevWrap = document.getElementById('netdevSettingsCardWrap');
    const vmsWrap = document.getElementById('vmsForMonitoringSettingsWrap');

    if (!servicesHosts || !upsWrap || !netdevWrap || !vmsWrap) return;

    if (section === 'ups') {
        servicesHosts.style.display = 'none';
        upsWrap.style.display = '';
        netdevWrap.style.display = 'none';
        vmsWrap.style.display = 'none';
    } else if (section === 'netdev') {
        servicesHosts.style.display = 'none';
        upsWrap.style.display = 'none';
        netdevWrap.style.display = '';
        vmsWrap.style.display = 'none';
    } else {
        // Service monitoring: только Hosts + VM/CT, без UPS/Netdev.
        servicesHosts.style.display = '';
        upsWrap.style.display = 'none';
        netdevWrap.style.display = 'none';
        vmsWrap.style.display = '';
    }
}

function moveUpsSettingsCardToSeparateTab() {
    const wrap = document.getElementById('upsSettingsCardWrap');
    const container = document.getElementById('upsSettingsContainer');
    if (!wrap || !container) return;
    if (container.contains(wrap)) return;

    try {
        container.innerHTML = '';
        container.appendChild(wrap);
    } catch (e) {
        console.warn('Failed to move UPS settings block:', e);
    }
}

function moveNetdevSettingsCardToSeparateTab() {
    const wrap = document.getElementById('netdevSettingsCardWrap');
    const container = document.getElementById('netdevSettingsContainer');
    if (!wrap || !container) return;
    if (container.contains(wrap)) return;

    try {
        container.innerHTML = '';
        container.appendChild(wrap);
    } catch (e) {
        console.warn('Failed to move Netdev settings block:', e);
    }
}

// Toggle monitor mode — переключаем полноэкранные экраны
async function toggleMonitorMode() {
    monitorMode = !monitorMode;
    saveSettingsToServer({ monitorMode });

    const dashboardSection = document.getElementById('dashboardSection');
    const dashboardContent = document.getElementById('dashboardContent');
    const servicesSection = document.getElementById('servicesMonitorSection');
    const vmsSection = document.getElementById('vmsMonitorSection');
    const monitorView = document.getElementById('monitorView');
    const upsMonSection = document.getElementById('upsMonitorSection');

    document.body.classList.toggle('monitor-mode', monitorMode);

    const btn = document.getElementById('monitorModeBtn');
    if (monitorMode) {
        // Входим в режим монитора: fullscreen, крупные блоки, свайпы, текущий экран — кластер
        if (btn) {
            btn.classList.add('active');
            btn.classList.remove('btn-outline-info');
            btn.classList.add('btn-info');
            btn.innerHTML = '<i class="bi bi-check-lg"></i> <span id="monitorModeText">' + t('monitorModeOn') + '</span>';
        }
        monitorCurrentView = 'cluster';
        applyMonitorTheme();
        initMonitorSwipes();

        // Определяем доступность ups/netdev/speedtest, чтобы свайп-циклы не включали “пустые/не настроенные” экраны.
        await refreshMonitorScreensAvailability();

        applyMonitorView(monitorCurrentView);
    } else {
        // Выходим из режима монитора: возвращаем обычный дашборд
        if (btn) {
            btn.classList.remove('active');
            btn.classList.remove('btn-info');
            btn.classList.add('btn-outline-info');
            btn.innerHTML = '<i class="bi bi-display"></i> <span id="monitorModeText">' + t('monitorMode') + '</span>';
        }
        document.body.classList.remove('monitor-theme-dark');
        destroyMonitorSwipes();

        if (dashboardSection) dashboardSection.style.display = 'block';
        if (dashboardContent) dashboardContent.style.display = 'block';
        if (servicesSection) servicesSection.style.display = 'none';
        if (vmsSection) vmsSection.style.display = 'none';
        if (upsMonSection) upsMonSection.style.display = 'none';
        const backupsMonExit = document.getElementById('backupsMonitorSection');
        if (backupsMonExit) backupsMonExit.style.display = 'none';
        if (monitorView) monitorView.style.display = 'none';
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

    if (apiToken || getCurrentConnectionId()) refreshData();
}

let monitorSwipeStartX = null;
let monitorSwipeHandlersAttached = false;
/** Текущий экран режима монитора: 'cluster' | 'ups' | 'netdev' | 'speedtest' | 'vms' | 'services' | 'backupRuns' (только Proxmox) */
let monitorCurrentView = 'cluster';
/** Последние данные бэкапов для экрана монитора */
let lastBackupsDataForMonitor = null;

/** Полный порядок экранов монитора (в БД); на TrueNAS экран backupRuns пропускается при листании */
const MONITOR_SCREEN_IDS_ALL = ['cluster', 'ups', 'netdev', 'speedtest', 'vms', 'services', 'backupRuns'];
let monitorScreensOrder = MONITOR_SCREEN_IDS_ALL.slice();
/** Speedtest включён в настройках (для скрытия экрана в режиме монитора) */
let speedtestClientEnabled = false;

// Доступность экранов зависит от реальной конфигурации (а не только от порядка в настройках).
// Значение: null = неизвестно (не грузили/ошибка), true/false = известная доступность.
let upsMonitorConfigured = null;
let netdevMonitorConfigured = null;
let speedtestMonitorConfigured = null;

async function refreshMonitorScreensAvailability() {
    // Если пользователь ещё не подключился к серверу/кластеру — не пытаемся определять доступность,
    // чтобы не “обнулить” экраны из-за ошибок авторизации.
    if (!apiToken && !getCurrentConnectionId()) return;

    const safeSet = (key, val) => {
        if (val === true || val === false) {
            if (key === 'ups') upsMonitorConfigured = val;
            if (key === 'netdev') netdevMonitorConfigured = val;
            if (key === 'speedtest') speedtestMonitorConfigured = val;
        }
    };

    try {
        const [upsRes, netdevRes, speedRes] = await Promise.allSettled([
            fetch('/api/ups/current'),
            fetch('/api/netdevices/current'),
            fetch('/api/speedtest/summary')
        ]);

        if (upsRes.status === 'fulfilled' && upsRes.value?.ok) {
            const data = await upsRes.value.json();
            safeSet('ups', !!(data && data.configured && Array.isArray(data.items) && data.items.length > 0));
        }
        if (netdevRes.status === 'fulfilled' && netdevRes.value?.ok) {
            const data = await netdevRes.value.json();
            safeSet('netdev', !!(data && data.configured && Array.isArray(data.items) && data.items.length > 0));
        }
        if (speedRes.status === 'fulfilled' && speedRes.value?.ok) {
            const data = await speedRes.value.json();
            const enabled = !!(data?.enabled === true || data?.enabled === '1' || data?.enabled === 1);
            safeSet('speedtest', enabled);
        }
    } catch (e) {
        // Оставляем значения как есть (null/предыдущие), чтобы не скрыть экраны “по ошибке сети”.
        console.warn('Failed to detect monitor screens availability:', e);
    }
}

function normalizeMonitorScreensOrder(arr) {
    const valid = new Set(MONITOR_SCREEN_IDS_ALL);
    if (!Array.isArray(arr)) return MONITOR_SCREEN_IDS_ALL.slice();
    const seen = new Set();
    const out = [];
    for (const x of arr) {
        const id = String(x || '').trim();
        if (valid.has(id) && !seen.has(id)) {
            seen.add(id);
            out.push(id);
        }
    }
    for (const id of MONITOR_SCREEN_IDS_ALL) {
        if (!seen.has(id)) out.push(id);
    }
    return out;
}

function getMonitorViewsOrder() {
    const order = normalizeMonitorScreensOrder(monitorScreensOrder);
    return order.filter((id) => {
        if (id === 'backupRuns' && currentServerType !== 'proxmox') return false;
        if (id === 'speedtest' && !speedtestClientEnabled) return false;
        if (id === 'ups' && upsMonitorConfigured === false) return false;
        if (id === 'netdev' && netdevMonitorConfigured === false) return false;
        if (id === 'speedtest' && speedtestMonitorConfigured === false) return false;
        return true;
    });
}

function monitorScreenSettingsLabel(id) {
    const map = {
        cluster: t('monitorScreenCluster'),
        ups: t('monitorScreenUps'),
        netdev: t('monitorScreenNetdev'),
        speedtest: t('monitorScreenSpeedtest'),
        vms: t('monitorScreenVms'),
        services: t('monitorScreenServices'),
        backupRuns: t('monitorScreenBackupRuns')
    };
    return map[id] || id;
}

function renderSettingsMonitorScreensOrderList() {
    const ul = document.getElementById('settingsMonitorScreensOrderList');
    if (!ul) return;
    const order = normalizeMonitorScreensOrder(monitorScreensOrder);
    ul.innerHTML = order
        .map(
            (id, i) => `<li class="list-group-item d-flex align-items-center justify-content-between gap-2 py-2">
      <span class="text-truncate"><i class="bi bi-display me-2 text-muted"></i>${escapeHtml(monitorScreenSettingsLabel(id))}</span>
      <span class="btn-group btn-group-sm flex-shrink-0" role="group">
        <button type="button" class="btn btn-outline-secondary" ${i === 0 ? 'disabled' : ''} onclick="moveMonitorScreenOrder(${i},-1)" aria-label="Up"><i class="bi bi-arrow-up"></i></button>
        <button type="button" class="btn btn-outline-secondary" ${i === order.length - 1 ? 'disabled' : ''} onclick="moveMonitorScreenOrder(${i},1)" aria-label="Down"><i class="bi bi-arrow-down"></i></button>
      </span>
    </li>`
        )
        .join('');
}

function moveMonitorScreenOrder(index, delta) {
    const order = normalizeMonitorScreensOrder(monitorScreensOrder);
    const j = index + delta;
    if (j < 0 || j >= order.length) return;
    const next = order.slice();
    const t0 = next[index];
    next[index] = next[j];
    next[j] = t0;
    monitorScreensOrder = next;
    saveSettingsToServer({ monitorScreensOrder: monitorScreensOrder });
    renderSettingsMonitorScreensOrderList();
}

function updateMonitorToolbarTitleForView() {
    const el = document.getElementById('monitorToolbarTitle');
    if (!el || !monitorMode) return;
    const titles = {
        cluster: t('monitorScreenCluster'),
        ups: t('monitorScreenUps'),
        netdev: t('monitorScreenNetdev'),
        speedtest: t('monitorScreenSpeedtest'),
        vms: t('monitorScreenVms'),
        services: t('monitorScreenServices'),
        backupRuns: t('monitorScreenBackupRuns')
    };
    el.textContent = titles[monitorCurrentView] || t('monitorMode');
}

// Переключение экранов в режиме монитора:
// cluster/services/vms -> компактный #monitorView (без скролла/пустых зон)
// ups/netdev/speedtest/backupRuns -> полноэкранные секции
function applyMonitorView(view) {
    monitorCurrentView = view;

    const dashboardSection = document.getElementById('dashboardSection');
    const dashboardContent = document.getElementById('dashboardContent');
    const servicesMonSection = document.getElementById('servicesMonitorSection');
    const vmsMonSection = document.getElementById('vmsMonitorSection');
    const upsMonSection = document.getElementById('upsMonitorSection');
    const netdevMonSection = document.getElementById('netdevMonitorSection');
    const speedtestMonSection = document.getElementById('speedtestMonitorSection');
    const backupsMon = document.getElementById('backupsMonitorSection');
    const monitorView = document.getElementById('monitorView');

    if (!monitorMode) {
        if (dashboardSection) dashboardSection.style.display = 'block';
        if (dashboardContent) dashboardContent.style.display = 'block';
        if (servicesMonSection) servicesMonSection.style.display = 'none';
        if (vmsMonSection) vmsMonSection.style.display = 'none';
        if (upsMonSection) upsMonSection.style.display = 'none';
        if (netdevMonSection) netdevMonSection.style.display = 'none';
        if (speedtestMonSection) speedtestMonSection.style.display = 'none';
        if (backupsMon) backupsMon.style.display = 'none';
        if (monitorView) monitorView.style.display = 'none';
        return;
    }

    // Выключаем все экраны монитора, затем включаем нужный.
    if (dashboardSection) dashboardSection.style.display = 'none';
    if (dashboardContent) dashboardContent.style.display = 'none';
    if (servicesMonSection) servicesMonSection.style.display = 'none';
    if (vmsMonSection) vmsMonSection.style.display = 'none';
    if (upsMonSection) upsMonSection.style.display = 'none';
    if (netdevMonSection) netdevMonSection.style.display = 'none';
    if (speedtestMonSection) speedtestMonSection.style.display = 'none';
    if (backupsMon) backupsMon.style.display = 'none';
    if (monitorView) monitorView.style.display = 'none';

    if (view === 'backupRuns' && currentServerType !== 'proxmox') {
        applyMonitorView('cluster');
        return;
    }

    if (view === 'cluster') {
        if (dashboardSection) dashboardSection.style.display = 'block';
        if (dashboardContent) dashboardContent.style.display = 'block';

        // Гарантируем, что в “кластер” активна панель узлов (как в основном режиме).
        const myTabContent = document.getElementById('myTabContent');
        if (myTabContent) {
            myTabContent.querySelectorAll('.tab-pane').forEach((pane) => {
                pane.classList.remove('show', 'active');
            });
            const nodesPane = document.getElementById('nodes');
            if (nodesPane) nodesPane.classList.add('show', 'active');
        }
    } else if (view === 'services') {
        if (servicesMonSection) servicesMonSection.style.display = 'block';
        renderMonitoredServices();
    } else if (view === 'vms') {
        if (vmsMonSection) vmsMonSection.style.display = 'block';
        renderVmsMonitorCards();
    } else if (view === 'ups') {
        if (upsMonSection) upsMonSection.style.display = 'block';
        updateUPSDashboard().catch(() => {});
    } else if (view === 'netdev') {
        if (netdevMonSection) netdevMonSection.style.display = 'block';
        updateNetdevDashboard().catch(() => {});
    } else if (view === 'speedtest') {
        if (speedtestMonSection) speedtestMonSection.style.display = 'block';
        updateSpeedtestDashboard().catch(() => {});
    } else if (view === 'backupRuns') {
        /* flex, не block — иначе .monitor-backups-main-card не растягивается и card-body с flex:1 схлопывается в 0 */
        if (backupsMon) backupsMon.style.display = 'flex';
        renderMonitorBackupRuns(lastBackupsDataForMonitor);
    }

    updateMonitorToolbarTitleForView();
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

// ==================== CUSTOM THEME CSS (normal/monitor x light/dark) ====================
function ensureCustomThemeStyleEl() {
    let el = document.getElementById(CUSTOM_THEME_STYLE_EL_ID);
    if (!el) {
        el = document.createElement('style');
        el.id = CUSTOM_THEME_STYLE_EL_ID;
        document.head.appendChild(el);
    }
    return el;
}

function normalizeCustomThemeCssInput(input) {
    const base = {
        normal: { light: '', dark: '' },
        monitor: { light: '', dark: '' }
    };
    if (!input || typeof input !== 'object') return base;

    // Accept both nested and flat shapes (for forward/backward compatibility)
    const nested = input.normal || input.monitor ? input : null;
    const flat = !nested ? input : null;

    const normalSource = nested ? nested.normal : input.normal;
    const monitorSource = nested ? nested.monitor : input.monitor;

    const getStr = (obj, key) => (obj && typeof obj[key] === 'string') ? obj[key] : '';
    if (flat) {
        return {
            normal: {
                light: typeof input.normalLight === 'string' ? input.normalLight : '',
                dark: typeof input.normalDark === 'string' ? input.normalDark : ''
            },
            monitor: {
                light: typeof input.monitorLight === 'string' ? input.monitorLight : '',
                dark: typeof input.monitorDark === 'string' ? input.monitorDark : ''
            }
        };
    }

    return {
        normal: {
            light: getStr(normalSource, 'light'),
            dark: getStr(normalSource, 'dark')
        },
        monitor: {
            light: getStr(monitorSource, 'light'),
            dark: getStr(monitorSource, 'dark')
        }
    };
}

function getCustomThemeVariantScope(variantKey) {
    // Note: monitor-mode and dark theme are independent.
    if (variantKey === 'normalLight') return 'body:not(.dark-mode):not(.monitor-mode)';
    if (variantKey === 'normalDark') return 'body.dark-mode:not(.monitor-mode)';
    if (variantKey === 'monitorLight') return 'body.monitor-mode:not(.monitor-theme-dark)';
    if (variantKey === 'monitorDark') return 'body.monitor-mode.monitor-theme-dark';
    return '';
}

function expandCustomCssSnippet(snippet, scope) {
    const s = String(snippet ?? '').trim();
    if (!s) return '';
    const scopeReplaced = s
        .replaceAll('{{SCOPE}}', scope)
        .replaceAll('{{scope}}', scope);
    const t = scopeReplaced.trim();
    if (!t) return '';
    if (t.startsWith('@')) {
        // Heuristic: don't try to scope at-rules. Use {{SCOPE}} in user CSS for full control.
        return t;
    }
    if (t.includes(scope) || s.includes('{{SCOPE}}') || s.includes('{{scope}}')) return t;
    // Best-effort heuristic: prefix the snippet with the scope selector.
    return scope + ' ' + t;
}

function applyCustomThemeCss() {
    const styleEl = ensureCustomThemeStyleEl();
    const normalized = normalizeCustomThemeCssInput(customThemeCss);

    const variants = [
        { key: 'normalLight', scope: getCustomThemeVariantScope('normalLight'), css: normalized.normal.light },
        { key: 'normalDark', scope: getCustomThemeVariantScope('normalDark'), css: normalized.normal.dark },
        { key: 'monitorLight', scope: getCustomThemeVariantScope('monitorLight'), css: normalized.monitor.light },
        { key: 'monitorDark', scope: getCustomThemeVariantScope('monitorDark'), css: normalized.monitor.dark }
    ];

    const parts = variants
        .map(v => expandCustomCssSnippet(v.css, v.scope))
        .filter(Boolean);

    styleEl.textContent = parts.join('\n\n');
}

// ==================== CUSTOM THEME PLAIN SETTINGS ====================
const CUSTOM_THEME_STYLE_DEFAULTS = {
    normal: {
        light: {
            cardBg: '#ffffff',
            cardTextColor: '#2d3748',
            cardHeaderFrom: '#667eea',
            cardHeaderTo: '#764ba2',
            cardHeaderTextColor: '#ffffff',
            statValueColor: '#333333',
            statLabelColor: '#666666',
            statCardBg: '#ffffff',
            nodeCardBg: '#ffffff',
            nodeCardTextColor: '#2d3748',
            tableHeaderBg: '#f8f9fa',
            tableHeaderTextColor: '#2d3748',
            tableCellTextColor: '#2d3748',
            tableBorderColor: 'rgba(0,0,0,0.125)',
            tableHoverTdBg: 'rgba(0,0,0,0.03)',
            progressBg: '#e2e8f0',
            monitorViewCardBg: 'rgba(255, 255, 255, 0.95)'
        },
        dark: {
            cardBg: '#16213e',
            cardTextColor: '#eeeeee',
            cardHeaderFrom: '#0f3460',
            cardHeaderTo: '#533483',
            cardHeaderTextColor: '#ffffff',
            statValueColor: '#eeeeee',
            statLabelColor: '#aaaaaa',
            statCardBg: '#16213e',
            nodeCardBg: '#16213e',
            nodeCardTextColor: '#eeeeee',
            tableHeaderBg: '#0f3460',
            tableHeaderTextColor: '#ffffff',
            tableCellTextColor: '#e2e8f0',
            tableBorderColor: '#2d3748',
            tableHoverTdBg: 'rgba(255, 255, 255, 0.06)',
            progressBg: '#0f3460',
            monitorViewCardBg: 'rgba(0,0,0,0)'
        }
    },
    monitor: {
        light: {
            cardBg: '#ffffff',
            cardTextColor: '#2d3748',
            cardHeaderFrom: '#edf2f7',
            cardHeaderTo: '#e2e8f0',
            cardHeaderTextColor: '#2d3748',
            statValueColor: '#2d3748',
            statLabelColor: '#4a5568',
            statCardBg: '#ffffff',
            nodeCardBg: '#ffffff',
            nodeCardTextColor: '#2d3748',
            tableHeaderBg: '#edf2f7',
            tableHeaderTextColor: '#2d3748',
            tableCellTextColor: '#2d3748',
            tableBorderColor: '#e2e8f0',
            tableHoverTdBg: 'rgba(0,0,0,0.03)',
            progressBg: '#e2e8f0',
            monitorViewCardBg: 'rgba(255, 255, 255, 0.95)'
        },
        dark: {
            cardBg: '#16213e',
            cardTextColor: '#ffffff',
            cardHeaderFrom: '#0f3460',
            cardHeaderTo: '#533483',
            cardHeaderTextColor: '#ffffff',
            statValueColor: '#ffffff',
            statLabelColor: '#a0aec0',
            statCardBg: '#16213e',
            nodeCardBg: '#1a2740',
            nodeCardTextColor: '#e2e8f0',
            tableHeaderBg: '#0f3460',
            tableHeaderTextColor: '#ffffff',
            tableCellTextColor: '#e2e8f0',
            tableBorderColor: '#2d3748',
            tableHoverTdBg: 'rgba(255, 255, 255, 0.06)',
            progressBg: '#2d3748',
            monitorViewCardBg: '#1a2740'
        }
    }
};

function normalizeCustomThemeStyleSettingsInput(input) {
    if (!input || typeof input !== 'object') return null;
    const out = JSON.parse(JSON.stringify(CUSTOM_THEME_STYLE_DEFAULTS));

    const normal = input.normal || {};
    const monitor = input.monitor || {};

    const applyVariant = (target, src) => {
        if (!src || typeof src !== 'object') return;
        Object.keys(target).forEach((k) => {
            if (src[k] !== undefined && src[k] !== null && src[k] !== '') target[k] = String(src[k]);
        });
    };

    applyVariant(out.normal.light, normal.light);
    applyVariant(out.normal.dark, normal.dark);
    applyVariant(out.monitor.light, monitor.light);
    applyVariant(out.monitor.dark, monitor.dark);

    return out;
}

function buildCustomThemeCssSnippetFromStyle(styleVariant) {
    const s = styleVariant || {};
    const safe = (v) => (v == null ? '' : String(v));

    // Snippets are written without {{SCOPE}}; applyCustomThemeCss will prefix by scope automatically.
    return [
        `.card { background: ${safe(s.cardBg)} !important; color: ${safe(s.cardTextColor)} !important; border-color: ${safe(s.tableBorderColor)} !important; }`,
        `.card-header { background: linear-gradient(135deg, ${safe(s.cardHeaderFrom)} 0%, ${safe(s.cardHeaderTo)} 100%) !important; color: ${safe(s.cardHeaderTextColor)} !important; }`,
        `.stat-card { background: ${safe(s.statCardBg)} !important; }`,
        `.stat-value { color: ${safe(s.statValueColor)} !important; }`,
        `.stat-label { color: ${safe(s.statLabelColor)} !important; }`,
        `.node-card { background: ${safe(s.nodeCardBg)} !important; color: ${safe(s.nodeCardTextColor)} !important; border-color: ${safe(s.tableBorderColor)} !important; }`,
        `.table { color: ${safe(s.tableCellTextColor)} !important; border-color: ${safe(s.tableBorderColor)} !important; }`,
        `.table th { background-color: ${safe(s.tableHeaderBg)} !important; color: ${safe(s.tableHeaderTextColor)} !important; border-color: ${safe(s.tableBorderColor)} !important; }`,
        `.table tbody td { color: ${safe(s.tableCellTextColor)} !important; border-color: ${safe(s.tableBorderColor)} !important; }`,
        `.table tbody tr:hover td { background-color: ${safe(s.tableHoverTdBg)} !important; }`,
        `.progress { background: ${safe(s.progressBg)} !important; }`,
        `.monitor-view__card { background: ${safe(s.monitorViewCardBg)} !important; border-color: ${safe(s.tableBorderColor)} !important; }`,
        `.monitor-view__panel-title { color: ${safe(s.cardHeaderTextColor)} !important; }`,
        `.monitor-view__stat-value, .monitor-view__res-value { color: ${safe(s.statValueColor)} !important; }`,
        `.monitor-view__stat-label, .monitor-view__res-label { color: ${safe(s.statLabelColor)} !important; }`
    ].join('\n');
}

function applyCustomThemeStyleSettings() {
    // If unset/null: remove overrides completely (back to base CSS).
    if (customThemeStyleSettings == null) {
        customThemeCss = {
            normal: { light: '', dark: '' },
            monitor: { light: '', dark: '' }
        };
        applyCustomThemeCss();
        return;
    }

    const normalized = normalizeCustomThemeStyleSettingsInput(customThemeStyleSettings);
    if (!normalized) {
        customThemeStyleSettings = null;
        applyCustomThemeStyleSettings();
        return;
    }

    customThemeCss = {
        normal: {
            light: buildCustomThemeCssSnippetFromStyle(normalized.normal.light),
            dark: buildCustomThemeCssSnippetFromStyle(normalized.normal.dark)
        },
        monitor: {
            light: buildCustomThemeCssSnippetFromStyle(normalized.monitor.light),
            dark: buildCustomThemeCssSnippetFromStyle(normalized.monitor.dark)
        }
    };
    applyCustomThemeCss();
    // Update UI if the styles editor is present in DOM.
    syncCustomThemeStyleSettingsUI();
}

function getCustomThemeStyleVariantDefaults(variantKey) {
    const isNormal = variantKey.startsWith('normal');
    const isMonitor = variantKey.startsWith('monitor');
    const isLight = variantKey.endsWith('Light');

    if (isNormal && isLight) return CUSTOM_THEME_STYLE_DEFAULTS.normal.light;
    if (isNormal && !isLight) return CUSTOM_THEME_STYLE_DEFAULTS.normal.dark;
    if (isMonitor && isLight) return CUSTOM_THEME_STYLE_DEFAULTS.monitor.light;
    if (isMonitor && !isLight) return CUSTOM_THEME_STYLE_DEFAULTS.monitor.dark;
    return CUSTOM_THEME_STYLE_DEFAULTS.normal.light;
}

function getCustomThemeStyleVariantFromSelect() {
    const sel = document.getElementById('customThemeVariantSelect');
    if (!sel) return 'normalLight';
    return String(sel.value || 'normalLight');
}

function readCustomThemeStyleVariantFromInputs() {
    const read = (id) => {
        const el = document.getElementById(id);
        return el ? String(el.value ?? '').trim() : '';
    };

    return {
        cardBg: read('customThemeStyleCardBg'),
        cardTextColor: read('customThemeStyleCardTextColor'),
        cardHeaderFrom: read('customThemeStyleCardHeaderFrom'),
        cardHeaderTo: read('customThemeStyleCardHeaderTo'),
        cardHeaderTextColor: read('customThemeStyleCardHeaderTextColor'),
        statValueColor: read('customThemeStyleStatValueColor'),
        statLabelColor: read('customThemeStyleStatLabelColor'),
        tableHeaderBg: read('customThemeStyleTableHeaderBg'),
        tableHeaderTextColor: read('customThemeStyleTableHeaderTextColor'),
        tableCellTextColor: read('customThemeStyleTableCellTextColor'),
        tableBorderColor: read('customThemeStyleTableBorderColor'),
        tableHoverTdBg: read('customThemeStyleTableHoverTdBg'),
        progressBg: read('customThemeStyleProgressBg'),
        monitorViewCardBg: read('customThemeStyleMonitorViewCardBg')
    };
}

function applyCustomThemeStyleVariantToInputs(variantKey) {
    const variantDefaults = getCustomThemeStyleVariantDefaults(variantKey);
    const haveStored = customThemeStyleSettings != null;
    const storedVariant = (() => {
        const isNormal = variantKey.startsWith('normal');
        const isMonitor = variantKey.startsWith('monitor');
        const isLight = variantKey.endsWith('Light');
        if (!haveStored) return null;
        if (isNormal && isLight) return customThemeStyleSettings?.normal?.light ?? null;
        if (isNormal && !isLight) return customThemeStyleSettings?.normal?.dark ?? null;
        if (isMonitor && isLight) return customThemeStyleSettings?.monitor?.light ?? null;
        if (isMonitor && !isLight) return customThemeStyleSettings?.monitor?.dark ?? null;
        return null;
    })();

    const s = storedVariant ? storedVariant : variantDefaults;
    const set = (id, val) => {
        const el = document.getElementById(id);
        if (el) el.value = String(val ?? '');
    };

    set('customThemeStyleCardBg', s.cardBg);
    set('customThemeStyleCardTextColor', s.cardTextColor);
    set('customThemeStyleCardHeaderFrom', s.cardHeaderFrom);
    set('customThemeStyleCardHeaderTo', s.cardHeaderTo);
    set('customThemeStyleCardHeaderTextColor', s.cardHeaderTextColor);
    set('customThemeStyleStatValueColor', s.statValueColor);
    set('customThemeStyleStatLabelColor', s.statLabelColor);
    set('customThemeStyleTableHeaderBg', s.tableHeaderBg);
    set('customThemeStyleTableHeaderTextColor', s.tableHeaderTextColor);
    set('customThemeStyleTableCellTextColor', s.tableCellTextColor);
    set('customThemeStyleTableBorderColor', s.tableBorderColor);
    set('customThemeStyleTableHoverTdBg', s.tableHoverTdBg);
    set('customThemeStyleProgressBg', s.progressBg);
    set('customThemeStyleMonitorViewCardBg', s.monitorViewCardBg);
}

function syncCustomThemeStyleSettingsUI() {
    const variantKey = getCustomThemeStyleVariantFromSelect();
    applyCustomThemeStyleVariantToInputs(variantKey);
}

function onCustomThemeStyleVariantChange() {
    syncCustomThemeStyleSettingsUI();
}

async function saveCustomThemeStyleSettingsVariant() {
    const variantKey = getCustomThemeStyleVariantFromSelect();
    const variantValues = readCustomThemeStyleVariantFromInputs();

    const normalized = normalizeCustomThemeStyleSettingsInput(customThemeStyleSettings || {});
    if (!normalized) return;

    const isNormal = variantKey.startsWith('normal');
    const isMonitor = variantKey.startsWith('monitor');
    const isLight = variantKey.endsWith('Light');

    if (isNormal && isLight) normalized.normal.light = variantValues;
    else if (isNormal && !isLight) normalized.normal.dark = variantValues;
    else if (isMonitor && isLight) normalized.monitor.light = variantValues;
    else if (isMonitor && !isLight) normalized.monitor.dark = variantValues;

    // Preserve default values for fields not represented in the plain-settings UI.
    if (isNormal && isLight) normalized.normal.light = { ...getCustomThemeStyleVariantDefaults('normalLight'), ...normalized.normal.light, ...variantValues };
    if (isNormal && !isLight) normalized.normal.dark = { ...getCustomThemeStyleVariantDefaults('normalDark'), ...normalized.normal.dark, ...variantValues };
    if (isMonitor && isLight) normalized.monitor.light = { ...getCustomThemeStyleVariantDefaults('monitorLight'), ...normalized.monitor.light, ...variantValues };
    if (isMonitor && !isLight) normalized.monitor.dark = { ...getCustomThemeStyleVariantDefaults('monitorDark'), ...normalized.monitor.dark, ...variantValues };

    customThemeStyleSettings = normalized;
    applyCustomThemeStyleSettings();
    saveSettingsToServer({ customThemeStyleSettings });
    showToast('Стили сохранены', 'success');
}

async function resetCustomThemeStyleSettingsVariant() {
    const variantKey = getCustomThemeStyleVariantFromSelect();
    const defaults = getCustomThemeStyleVariantDefaults(variantKey);

    const normalized = normalizeCustomThemeStyleSettingsInput(customThemeStyleSettings || {});
    if (!normalized) return;

    const isNormal = variantKey.startsWith('normal');
    const isMonitor = variantKey.startsWith('monitor');
    const isLight = variantKey.endsWith('Light');

    if (isNormal && isLight) normalized.normal.light = defaults;
    else if (isNormal && !isLight) normalized.normal.dark = defaults;
    else if (isMonitor && isLight) normalized.monitor.light = defaults;
    else if (isMonitor && !isLight) normalized.monitor.dark = defaults;

    customThemeStyleSettings = normalized;
    applyCustomThemeStyleSettings();
    saveSettingsToServer({ customThemeStyleSettings });
    syncCustomThemeStyleSettingsUI();
    showToast('Вариант сброшен к значениям по умолчанию', 'info');
}

async function unloadCustomThemeStyleSettingsAll() {
    customThemeStyleSettings = null;
    applyCustomThemeStyleSettings();
    // Also clear legacy `custom_theme_css` so the disable action persists after reload.
    saveSettingsToServer({
        customThemeStyleSettings: null,
        customThemeCss: {
            normal: { light: '', dark: '' },
            monitor: { light: '', dark: '' }
        }
    });
    syncCustomThemeStyleSettingsUI();
    showToast('Кастомные стили отключены', 'info');
}

function exportCustomThemeStyleSettings() {
    const data = {
        exportedAt: new Date().toISOString(),
        type: 'customThemeStyleSettings',
        version: 1,
        customThemeStyleSettings
    };
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = 'custom-theme-style-settings-' + new Date().toISOString().slice(0, 10) + '.json';
    a.click();
    URL.revokeObjectURL(a.href);
    showToast('Экспорт готов', 'success');
}

function triggerCustomThemeStyleImportFilePicker() {
    const inp = document.getElementById('customThemeStyleImportFile');
    if (!inp) return;
    inp.value = '';
    inp.click();
}

async function importCustomThemeStyleSettingsFromFile(file) {
    if (!file) return;
    const text = await file.text();
    let parsed = null;
    try {
        parsed = JSON.parse(text);
    } catch (_) {
        showToast('Невалидный JSON', 'error');
        return;
    }

    const incoming = parsed?.customThemeStyleSettings ?? parsed;
    const normalized = normalizeCustomThemeStyleSettingsInput(incoming);
    if (!normalized) {
        customThemeStyleSettings = null;
        applyCustomThemeStyleSettings();
        saveSettingsToServer({ customThemeStyleSettings: null });
        showToast('Импорт: стили отключены', 'info');
        return;
    }

    customThemeStyleSettings = normalized;
    applyCustomThemeStyleSettings();
    syncCustomThemeStyleSettingsUI();
    await saveSettingsToServer({ customThemeStyleSettings });
    showToast('Импорт стилей выполнен', 'success');
}

function getCustomThemeVariantFromSelect() {
    const sel = document.getElementById('customThemeVariantSelect');
    if (!sel) return 'normalLight';
    const v = String(sel.value || 'normalLight');
    return v;
}

function syncCustomThemeCssEditorUI() {
    const textarea = document.getElementById('customThemeCssEditor');
    if (!textarea) return;

    const normalized = normalizeCustomThemeCssInput(customThemeCss);
    const variant = getCustomThemeVariantFromSelect();

    if (variant === 'normalLight') textarea.value = normalized.normal.light || '';
    else if (variant === 'normalDark') textarea.value = normalized.normal.dark || '';
    else if (variant === 'monitorLight') textarea.value = normalized.monitor.light || '';
    else if (variant === 'monitorDark') textarea.value = normalized.monitor.dark || '';
}

function onCustomThemeVariantChange() {
    syncCustomThemeCssEditorUI();
}

async function saveCustomThemeCssVariant() {
    const variant = getCustomThemeVariantFromSelect();
    const textarea = document.getElementById('customThemeCssEditor');
    if (!textarea) return;

    const value = String(textarea.value ?? '');
    const normalized = normalizeCustomThemeCssInput(customThemeCss);

    if (variant === 'normalLight') normalized.normal.light = value;
    else if (variant === 'normalDark') normalized.normal.dark = value;
    else if (variant === 'monitorLight') normalized.monitor.light = value;
    else if (variant === 'monitorDark') normalized.monitor.dark = value;

    customThemeCss = normalized;
    applyCustomThemeCss();
    saveSettingsToServer({ customThemeCss });
    showToast('Стили сохранены', 'success');
}

async function clearCustomThemeCssVariant() {
    const variant = getCustomThemeVariantFromSelect();
    const textarea = document.getElementById('customThemeCssEditor');
    if (!textarea) return;

    const normalized = normalizeCustomThemeCssInput(customThemeCss);
    if (variant === 'normalLight') normalized.normal.light = '';
    else if (variant === 'normalDark') normalized.normal.dark = '';
    else if (variant === 'monitorLight') normalized.monitor.light = '';
    else if (variant === 'monitorDark') normalized.monitor.dark = '';

    customThemeCss = normalized;
    textarea.value = '';
    applyCustomThemeCss();
    saveSettingsToServer({ customThemeCss });
    showToast('Стили этого варианта удалены', 'info');
}

async function unloadCustomThemeCssAll() {
    customThemeCss = {
        normal: { light: '', dark: '' },
        monitor: { light: '', dark: '' }
    };
    const textarea = document.getElementById('customThemeCssEditor');
    if (textarea) textarea.value = '';
    applyCustomThemeCss();
    saveSettingsToServer({ customThemeCss });
    showToast('Пользовательские стили удалены', 'info');
}

function exportCustomThemeCss() {
    const normalized = normalizeCustomThemeCssInput(customThemeCss);
    const data = {
        exportedAt: new Date().toISOString(),
        type: 'customThemeCss',
        version: 1,
        customThemeCss: normalized
    };
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = 'custom-theme-css-' + new Date().toISOString().slice(0, 10) + '.json';
    a.click();
    URL.revokeObjectURL(a.href);
    showToast('Экспорт готов', 'success');
}

function triggerCustomThemeImportFilePicker() {
    const inp = document.getElementById('customThemeImportFile');
    if (!inp) return;
    inp.value = '';
    inp.click();
}

async function importCustomThemeCssFromFile(file) {
    if (!file) return;
    const text = await file.text();
    let parsed = null;
    try {
        parsed = JSON.parse(text);
    } catch (e) {
        showToast('Невалидный JSON файла', 'error');
        return;
    }

    const incoming = parsed?.customThemeCss ?? parsed;
    const normalized = normalizeCustomThemeCssInput(incoming);
    customThemeCss = normalized;
    applyCustomThemeCss();
    syncCustomThemeCssEditorUI();
    saveSettingsToServer({ customThemeCss });
    showToast('Импорт стилей выполнен', 'success');
}

function goMonitorView(direction) {
    const views = getMonitorViewsOrder();
    let i = views.indexOf(monitorCurrentView);
    if (i < 0) i = 0;
    const delta = direction === 'next' ? 1 : -1;
    const nextIndex = (i + delta + views.length) % views.length;
    applyMonitorView(views[nextIndex]);
}

function destroyMonitorSwipes() {
    monitorSwipeStartX = null;
    monitorSwipeHandlersAttached = false;
    const target = document.body;
    if (target._monitorSwipeStart) {
        target.removeEventListener('touchstart', target._monitorSwipeStart);
        target.removeEventListener('touchend', target._monitorSwipeEnd);
        delete target._monitorSwipeStart;
        delete target._monitorSwipeEnd;
    }
    if (target._monitorSwipeMouseStart) {
        target.removeEventListener('mousedown', target._monitorSwipeMouseStart);
        delete target._monitorSwipeMouseStart;
    }
}

function initMonitorSwipes() {
    if (monitorSwipeHandlersAttached) return;
    const minDist = 80;
    function onStart(e) {
        if (!monitorMode) return;
        const x = e.touches ? e.touches[0].clientX : e.clientX;
        monitorSwipeStartX = x;
    }
    function onEnd(e) {
        if (!monitorMode) return;
        if (monitorSwipeStartX == null) return;
        const x = e.changedTouches ? e.changedTouches[0].clientX : e.clientX;
        const delta = x - monitorSwipeStartX;
        if (delta < -minDist) goMonitorView('next');
        else if (delta > minDist) goMonitorView('prev');
        monitorSwipeStartX = null;
    }
    function mouseStart(e) {
        if (!monitorMode) return;
        monitorSwipeStartX = e.clientX;
        function mouseEnd(ev) {
            const d = ev.clientX - monitorSwipeStartX;
            if (Math.abs(d) > minDist) goMonitorView(d < 0 ? 'next' : 'prev');
            document.body.removeEventListener('mouseup', mouseEnd);
        }
        document.body.addEventListener('mouseup', mouseEnd, { once: true });
    }
    document.body._monitorSwipeStart = onStart;
    document.body._monitorSwipeEnd = onEnd;
    document.body._monitorSwipeMouseStart = mouseStart;
    document.body.addEventListener('touchstart', onStart, { passive: true });
    document.body.addEventListener('touchend', onEnd, { passive: true });
    document.body.addEventListener('mousedown', mouseStart);
    monitorSwipeHandlersAttached = true;
}

// Show dashboard
function showDashboard() {
    document.getElementById('configSection').style.display = 'none';
    document.getElementById('dashboardSection').style.display = 'block';
    const dashboardContent = document.getElementById('dashboardContent');
    const monitorView = document.getElementById('monitorView');
    if (dashboardContent) dashboardContent.style.display = 'block';
    if (monitorView) monitorView.style.display = 'none';
    const servicesSection = document.getElementById('servicesMonitorSection');
    const backupsMon = document.getElementById('backupsMonitorSection');
    if (servicesSection) servicesSection.style.display = 'none';
    if (backupsMon) backupsMon.style.display = 'none';
    const netdevMonSection = document.getElementById('netdevMonitorSection');
    if (netdevMonSection) netdevMonSection.style.display = 'none';
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

// Connect (called after connectAs(type) sets currentServerType)
async function connect() {
    const tokenInput = currentServerType === 'truenas'
        ? document.getElementById('apiTokenTrueNAS')
        : document.getElementById('apiToken');
    if (currentServerType === 'proxmox') syncProxmoxApiTokenFromParts();
    const rawToken = tokenInput ? tokenInput.value.trim() : '';
    const token = (rawToken && rawToken.includes('•')) ? (apiToken || '') : rawToken;

    if (!token) {
        showToast(t('tokenRequired'), 'error');
        return;
    }

    const connectBtnId = currentServerType === 'truenas' ? 'connectBtnTrueNAS' : 'connectBtnProxmox';
    const connectBtn = document.getElementById(connectBtnId);
    const originalText = connectBtn.innerHTML;
    connectBtn.disabled = true;
    connectBtn.innerHTML = '<span class="spinner-border spinner-border-sm me-2"></span>' + t('loading');
    
    const serverUrl = getCurrentServerUrl();
    try {
        // Всегда сохраняем секрет в DB и используем connectionId
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
        apiToken = null; // секрет в памяти не держим, всё в DB

        const response = await fetch(currentServerType === 'truenas' ? '/api/truenas/auth/test' : '/api/auth/test', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(currentServerType === 'truenas'
                ? { apiKey: token, serverUrl }
                : { token, serverUrl })
        });
        
        const data = await response.json();
        
        if (data.success) {
            showToast(t('connectSuccess'), 'success');
            const logoutContainerId = currentServerType === 'truenas' ? 'logoutContainerTrueNAS' : 'logoutContainerProxmox';
            setDisplay(logoutContainerId, 'block');
            updateConnectionStatus(true, currentServerType);
            showDashboard();
        } else {
            showToast(t('connectError') + ': ' + data.error, 'error');
            updateConnectionStatus(false, currentServerType);
        }
    } catch (error) {
        showToast(t('connectError') + ': ' + error.message, 'error');
        updateConnectionStatus(false, currentServerType);
    } finally {
        connectBtn.disabled = false;
        connectBtn.innerHTML = originalText;
    }
}

function connectAs(type) {
    currentServerType = type === 'truenas' ? 'truenas' : 'proxmox';
    connect();
}

// Test connection
async function testConnection() {
    const tokenInput = currentServerType === 'truenas'
        ? document.getElementById('apiTokenTrueNAS')
        : document.getElementById('apiToken');
    if (currentServerType === 'proxmox') syncProxmoxApiTokenFromParts();
    const rawToken = tokenInput ? tokenInput.value.trim() : '';
    const token = (rawToken && rawToken.includes('•')) ? (apiToken || '') : rawToken;

    if (!token) {
        showToast(t('tokenRequired'), 'warning');
        updateConnectionStatus(false, currentServerType);
        return;
    }

    const testBtnId = currentServerType === 'truenas' ? 'testConnectionBtnTrueNAS' : 'testConnectionBtnProxmox';
    const testBtn = document.getElementById(testBtnId);
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
                updateConnectionStatus(true, currentServerType);
                return;
            }
            showToast(t('connectionStatusDisconnected') + ': ' + (testData.error || `HTTP ${testRes.status}`), 'error');
            updateConnectionStatus(false, currentServerType);
            return;
        }

        const response = await fetch(currentServerType === 'truenas' ? '/api/truenas/auth/test' : '/api/auth/test', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(currentServerType === 'truenas'
                ? { apiKey: token, serverUrl }
                : { token, serverUrl })
        });
        
        const data = await response.json();
        
        if (data.success) {
            showToast(t('connectionStatusConnected'), 'success');
            updateConnectionStatus(true, currentServerType);
        } else {
            showToast(t('connectionStatusDisconnected') + ': ' + data.error, 'error');
            updateConnectionStatus(false, currentServerType);
        }
    } catch (error) {
        showToast(t('connectionStatusDisconnected') + ': ' + error.message, 'error');
        updateConnectionStatus(false, currentServerType);
    } finally {
        testBtn.disabled = false;
        testBtn.innerHTML = originalText;
    }
}

function testConnectionAs(type) {
    currentServerType = type === 'truenas' ? 'truenas' : 'proxmox';
    testConnection();
}

// Update connection status for a given type (proxmox | truenas)
function updateConnectionStatus(connected, type) {
    const suffix = (type || currentServerType) === 'truenas' ? 'TrueNAS' : 'Proxmox';
    const statusDisplay = document.getElementById('connectionStatusDisplay' + suffix);
    const statusBadge = document.getElementById('connectionStatusBadge' + suffix);
    const statusText = document.getElementById('connectionStatusText' + suffix);

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
/** Форматирование значения UPS из API { raw, value } */
function formatUpsMetric(m, unitSuffix) {
    if (!m || (m.raw == null && m.value == null)) return '—';
    const v = m.value;
    if (v != null && Number.isFinite(Number(v))) {
        const n = Number(v);
        const rounded = Math.abs(n) >= 100 ? Math.round(n) : Math.round(n * 10) / 10;
        return `${rounded}${unitSuffix || ''}`;
    }
    return m.raw != null && String(m.raw).trim() !== '' ? String(m.raw) : '—';
}

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
            if (!monitorMode || monitorCurrentView === 'cluster' || monitorCurrentView === 'ups') {
                updateUPSDashboard().catch(() => {});
            }
            if (!monitorMode || monitorCurrentView === 'cluster' || monitorCurrentView === 'netdev') {
                updateNetdevDashboard().catch(() => {});
            }
            if (!monitorMode || monitorCurrentView === 'cluster' || monitorCurrentView === 'speedtest') {
                updateSpeedtestDashboard().catch(() => {});
            }
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
            if (!monitorMode || monitorCurrentView === 'cluster' || monitorCurrentView === 'ups') {
                updateUPSDashboard().catch(() => {});
            }
            if (!monitorMode || monitorCurrentView === 'cluster' || monitorCurrentView === 'netdev') {
                updateNetdevDashboard().catch(() => {});
            }
            if (!monitorMode || monitorCurrentView === 'cluster' || monitorCurrentView === 'speedtest') {
                updateSpeedtestDashboard().catch(() => {});
            }
        }
        
        // Restore scroll/focus to avoid visible "jumps" on full re-render
        requestAnimationFrame(() => {
            window.scrollTo({ top: prevScrollY, left: 0, behavior: 'auto' });
            if (prevActiveId) {
                const a = document.getElementById(prevActiveId);
                if (a && typeof a.focus === 'function') a.focus({ preventScroll: true });
            }
        });
        lastRefreshTime = Date.now();
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

/** Ячейка метрики UPS в стиле блока «Ресурсы кластера» (центр, крупное значение, опционально progress). */
function upsMetricTile(iconBi, label, valueStr, progressPct, barClass) {
    const bar =
        typeof progressPct === 'number' && Number.isFinite(progressPct)
            ? `<div class="progress mt-2 mx-auto" style="height: 10px; max-width: 160px"><div class="progress-bar ${barClass || 'bg-primary'}" style="width: ${Math.min(100, Math.max(0, progressPct))}%"></div></div>`
            : '<div class="mt-2" style="height: 10px" aria-hidden="true"></div>';
    return `
        <div class="col-6 col-md-4 col-xl-3">
            <div class="text-center p-3">
                <h6 class="mb-1"><i class="bi ${iconBi} me-1"></i>${escapeHtml(label)}</h6>
                <div class="fs-3 fw-semibold lh-sm text-break">${escapeHtml(valueStr)}</div>
                ${bar}
            </div>
        </div>`;
}

// Компактная “tile” для случая, когда UPS несколько (внутри уже есть отдельная карточка UPS)
function upsMetricCompactTile(iconBi, label, valueStr, progressPct, barClass, colClass) {
    const bar =
        typeof progressPct === 'number' && Number.isFinite(progressPct)
            ? `<div class="progress mt-2 mx-auto" style="height: 8px; max-width: 120px">
                    <div class="progress-bar ${barClass || 'bg-primary'}" style="width: ${Math.min(100, Math.max(0, progressPct))}%"></div>
               </div>`
            : '';

    return `
        <div class="${colClass || 'col-6'}">
            <div class="text-center p-2 h-100">
                <h6 class="mb-1"><i class="bi ${iconBi} me-1"></i>${escapeHtml(label)}</h6>
                <div class="fs-5 fw-semibold lh-sm text-break">${escapeHtml(valueStr)}</div>
                ${bar}
            </div>
        </div>`;
}

function buildUpsCardsHtml(data) {
    const upsColClass = data.items.length === 1 ? 'col-12' : 'col-md-6';
    const rowClass =
        data.items.length === 1
            ? 'row g-2'
            : 'row row-cols-1 row-cols-sm-2 g-2 small';

    const labels = {
        inV: t('upsLabelInputVoltage') || 'Вход U',
        outV: t('upsLabelOutputVoltage') || 'Выход U',
        power: t('upsLabelPower') || 'Мощность',
        load: t('upsLabelLoad') || 'Нагрузка',
        freq: t('upsLabelFrequency') || 'Частота',
        charge: t('upsLabelCharge') || 'Заряд',
        runtime: t('upsLabelRuntime') || 'Время на батарее'
    };

    if (data.items.length === 1) {
        const item = data.items[0];
        const name = item.name || `UPS ${item.slot}`;
        const backend = item.type ? String(item.type).toUpperCase() : 'UPS';
        const hostLine = item.host ? `${backend} · ${item.host}` : backend;

        if (item.error) {
            const html = `
                <div class="col-12">
                    <div class="alert alert-warning mb-0 py-2 d-flex flex-wrap justify-content-between align-items-center gap-2">
                        <span class="fw-semibold text-truncate" title="${escapeHtml(name)}">${escapeHtml(name)}</span>
                        <span class="small">${escapeHtml(backend)}: ${escapeHtml(item.error)}</span>
                    </div>
                </div>`;
            return { html, rowClass: 'row g-2' };
        }

        const statusRaw = item.status?.raw ?? null;
        const statusLabel = item.status?.label ?? (statusRaw != null ? String(statusRaw) : 'unknown');
        const up = item.status?.up;
        let badgeClass = 'bg-secondary';
        const lowStr = String(statusLabel).toLowerCase();
        if (lowStr.includes('low')) badgeClass = 'bg-danger';
        else if (up === true) badgeClass = 'bg-success';
        else if (up === false) badgeClass = 'bg-warning text-dark';

        const electrical = item.electrical || {};
        const inVText = formatUpsMetric(electrical.inputVoltage, ' V');
        const outVText = formatUpsMetric(electrical.outputVoltage, ' V');
        const powerText = formatUpsMetric(electrical.powerW, ' W');
        const loadText = formatUpsMetric(electrical.loadPercent, ' %');
        const freqText = formatUpsMetric(electrical.frequencyHz, ' Hz');

        const chargePct = item.battery?.chargePct;
        const chargeRaw = item.battery?.chargeRaw;
        const chargeText = (chargePct != null && Number.isFinite(Number(chargePct)))
            ? `${chargePct}%`
            : (chargeRaw != null ? String(chargeRaw) : '—');

        const runtimeText = item.battery?.runtimeFormatted != null
            ? item.battery.runtimeFormatted
            : (item.battery?.runtimeRaw != null ? String(item.battery.runtimeRaw) : '—');

        const loadPctNum = electrical.loadPercent && typeof electrical.loadPercent.value === 'number'
            ? electrical.loadPercent.value
            : null;
        const chargeBarNum = (chargePct != null && Number.isFinite(Number(chargePct))) ? Number(chargePct) : null;

        const hasVal = (v) => v != null && String(v).trim() !== '' && String(v) !== '—';
        const tilesHtml = [
            hasVal(inVText) ? upsMetricTile('bi-plug', labels.inV, inVText, null, null) : null,
            hasVal(outVText) ? upsMetricTile('bi-outlet', labels.outV, outVText, null, null) : null,
            hasVal(powerText) ? upsMetricTile('bi-lightning-charge', labels.power, powerText, null, null) : null,
            hasVal(loadText) ? upsMetricTile('bi-speedometer2', labels.load, loadText, loadPctNum, 'bg-warning') : null,
            hasVal(freqText) ? upsMetricTile('bi-arrow-repeat', labels.freq, freqText, null, null) : null,
            hasVal(chargeText) ? upsMetricTile('bi-battery-half', labels.charge, chargeText, chargeBarNum, 'bg-success') : null,
            hasVal(runtimeText) ? upsMetricTile('bi-clock-history', labels.runtime, runtimeText, null, null) : null
        ].filter(Boolean).join('');

        const html = `
            <div class="col-12">
                <div class="d-flex flex-wrap justify-content-between align-items-center gap-2 mb-3 pb-3 border-bottom">
                    <div class="fw-semibold fs-5 text-truncate" title="${escapeHtml(name)}">${escapeHtml(name)}</div>
                    <span class="badge ${badgeClass}">${escapeHtml(statusLabel)}</span>
                </div>
                <div class="row g-2">
                    ${tilesHtml}
                </div>
                <p class="small text-muted text-center mb-0 mt-3">${escapeHtml(hostLine)}</p>
            </div>`;
        return { html, rowClass: 'row g-2' };
    }

    const html = data.items.map((item) => {
        const statusRaw = item.status?.raw ?? null;
        const statusLabel = item.status?.label ?? (statusRaw != null ? String(statusRaw) : 'unknown');
        const up = item.status?.up;

        let badgeClass = 'bg-secondary';
        const lowStr = String(statusLabel).toLowerCase();
        if (lowStr.includes('low')) badgeClass = 'bg-danger';
        else if (up === true) badgeClass = 'bg-success';
        else if (up === false) badgeClass = 'bg-warning text-dark';

        const electrical = item.electrical || {};
        const inVText = formatUpsMetric(electrical.inputVoltage, ' V');
        const outVText = formatUpsMetric(electrical.outputVoltage, ' V');
        const powerText = formatUpsMetric(electrical.powerW, ' W');
        const loadText = formatUpsMetric(electrical.loadPercent, ' %');
        const freqText = formatUpsMetric(electrical.frequencyHz, ' Hz');

        const chargePct = item.battery?.chargePct;
        const chargeRaw = item.battery?.chargeRaw;
        const chargeText = (chargePct != null && Number.isFinite(Number(chargePct)))
            ? `${chargePct}%`
            : (chargeRaw != null ? String(chargeRaw) : '—');

        const runtimeText = item.battery?.runtimeFormatted != null
            ? item.battery.runtimeFormatted
            : (item.battery?.runtimeRaw != null ? String(item.battery.runtimeRaw) : '—');

        const name = item.name || `UPS ${item.slot}`;
        const backend = item.type ? String(item.type).toUpperCase() : 'UPS';

        const loadPctNum = electrical.loadPercent && typeof electrical.loadPercent.value === 'number'
            ? electrical.loadPercent.value
            : null;
        const chargeBarNum = (chargePct != null && Number.isFinite(Number(chargePct))) ? Number(chargePct) : null;

        const hasVal = (v) => v != null && String(v).trim() !== '' && String(v) !== '—';
        const tilesHtml = [
            hasVal(inVText) ? upsMetricCompactTile('bi-plug', labels.inV, inVText, null, null, 'col-6') : null,
            hasVal(outVText) ? upsMetricCompactTile('bi-outlet', labels.outV, outVText, null, null, 'col-6') : null,
            hasVal(powerText) ? upsMetricCompactTile('bi-lightning-charge', labels.power, powerText, null, null, 'col-6') : null,
            hasVal(loadText) ? upsMetricCompactTile('bi-speedometer2', labels.load, loadText, loadPctNum, 'bg-warning', 'col-6') : null,
            hasVal(freqText) ? upsMetricCompactTile('bi-arrow-repeat', labels.freq, freqText, null, null, 'col-6') : null,
            hasVal(chargeText) ? upsMetricCompactTile('bi-battery-half', labels.charge, chargeText, chargeBarNum, 'bg-success', 'col-6') : null,
            hasVal(runtimeText) ? upsMetricCompactTile('bi-clock-history', labels.runtime, runtimeText, null, null, 'col-12') : null
        ].filter(Boolean).join('');

        if (item.error) {
            return `
                    <div class="${upsColClass}">
                        <div class="card h-100">
                            <div class="card-header py-2 px-2 d-flex justify-content-between align-items-center">
                                <div class="fw-semibold text-truncate pe-2" title="${escapeHtml(name)}">${escapeHtml(name)}</div>
                                <span class="badge bg-secondary">${escapeHtml(t('upsError') || 'Ошибка UPS')}</span>
                            </div>
                            <div class="card-body p-2">
                                <div class="small text-muted">${escapeHtml(backend)}: ${escapeHtml(item.error)}</div>
                            </div>
                        </div>
                    </div>
                `;
        }

        return `
                <div class="${upsColClass}">
                    <div class="card h-100">
                        <div class="card-header py-2 px-2 d-flex justify-content-between align-items-center">
                            <div class="fw-semibold text-truncate pe-2" title="${escapeHtml(name)}">${escapeHtml(name)}</div>
                            <span class="badge ${badgeClass}">${escapeHtml(statusLabel)}</span>
                        </div>
                        <div class="card-body p-2">
                            <div class="row g-2">
                                ${tilesHtml}
                            </div>
                        </div>
                    </div>
                </div>
            `;
    }).join('');

    return { html, rowClass };
}

function paintUpsMount(cardsEl, updatedAtEl, data, options) {
    const emptyMsg = options && options.emptyMsg;
    if (!cardsEl) return;

    cardsEl.innerHTML = '';
    cardsEl.className = 'row g-2 small';
    if (updatedAtEl) updatedAtEl.textContent = '';

    if (!data || !data.configured || !Array.isArray(data.items) || data.items.length === 0) {
        const msg = emptyMsg || (t('upsNotConfigured') || 'UPS не настроен');
        const err = data?.error ? `: ${data.error}` : '';
        cardsEl.innerHTML = `<div class="col-12"><div class="text-muted small">${escapeHtml(msg + err)}</div></div>`;
        if (updatedAtEl && data?.updatedAt) updatedAtEl.textContent = new Date(data.updatedAt).toLocaleString();
        return;
    }

    if (updatedAtEl && data?.updatedAt) {
        updatedAtEl.textContent = new Date(data.updatedAt).toLocaleString();
    }

    const { html, rowClass } = buildUpsCardsHtml(data);
    cardsEl.className = rowClass;
    cardsEl.innerHTML = html;
}

async function updateUPSDashboard() {
    const monitorCards = document.getElementById('upsMonitorCards');
    const dashboardCards = document.getElementById('dashboardUpsCards');
    const dashSection = document.getElementById('dashboardUpsSection');

    if (!monitorCards && !dashboardCards) return;

    const resetRow = (el) => {
        if (!el) return;
        el.innerHTML = '';
        el.className = 'row g-2 small';
    };
    resetRow(monitorCards);
    resetRow(dashboardCards);
    const upsUpdatedAt = document.getElementById('upsUpdatedAt');
    const dashboardUpsUpdatedAt = document.getElementById('dashboardUpsUpdatedAt');
    if (upsUpdatedAt) upsUpdatedAt.textContent = '';
    if (dashboardUpsUpdatedAt) dashboardUpsUpdatedAt.textContent = '';

    try {
        const res = await fetch('/api/ups/current');
        const data = await res.json();

        // Обновляем кеш доступности экрана для корректного свайп-порядка.
        upsMonitorConfigured = !!(data && data.configured && Array.isArray(data.items) && data.items.length > 0);

        await ensureUpsDisplaySlotsLoaded();
        const isMonitorCluster = monitorMode && monitorCurrentView === 'cluster';
        const slotsForDashboard = isMonitorCluster ? upsDisplaySlotsMonitor : upsDisplaySlotsDashboard;
        const safeSlotsForDashboard = (Array.isArray(slotsForDashboard) && slotsForDashboard.length > 0)
            ? slotsForDashboard
            : (upsDisplaySlotsLoadedOnce ? [] : [1, 2, 3, 4]);

        const dashboardItems = (Array.isArray(safeSlotsForDashboard) && safeSlotsForDashboard.length)
            ? (data.items || []).filter((it) => safeSlotsForDashboard.includes(it.slot))
            : data.items;

        const showDash = !!(data && data.configured && Array.isArray(dashboardItems) && dashboardItems.length > 0);
        if (dashSection) dashSection.style.display = showDash ? '' : 'none';

        paintUpsMount(monitorCards, upsUpdatedAt, data, {});
        const dashboardData = { ...data, items: dashboardItems };
        paintUpsMount(dashboardCards, dashboardUpsUpdatedAt, dashboardData, {});
    } catch (e) {
        const errHtml = `<div class="col-12"><div class="text-danger small">${escapeHtml((e && e.message) ? e.message : String(e))}</div></div>`;
        if (monitorCards) monitorCards.innerHTML = errHtml;
        if (dashboardCards) {
            dashboardCards.innerHTML = errHtml;
            if (dashSection) dashSection.style.display = '';
        }
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

    setText('clusterVmTotal', '—');
    setText('clusterVmRunning', '—');
    setText('clusterCtTotal', '—');
    setText('clusterCtRunning', '—');
    ['clusterVmRunningBar', 'clusterCtRunningBar'].forEach((id) => {
        const b = document.getElementById(id);
        if (b) b.style.width = '0%';
    });

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
    if (backupsJobsTable) {
        backupsJobsTable.destroy();
        backupsJobsTable = null;
    }
    if (backupsExecTable) {
        backupsExecTable.destroy();
        backupsExecTable = null;
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
    if (!clusterData) return;
    const nodes = Array.isArray(clusterData.nodes) ? clusterData.nodes : [];
    const total = nodes.length;
    const online = nodes.filter(n => n.status === 'online').length;
    const quorumOk = clusterData.quorum && online >= (clusterData.quorum.quorum || 0);
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
    setText('monitorVmTotal', String(summary.totalVMs || 0));
    setText('monitorVmRunning', String(summary.runningVMs != null ? summary.runningVMs : 0));
    setText('monitorCtTotal', String(summary.totalContainers || 0));
    setText('monitorCtRunning', String(summary.runningContainers != null ? summary.runningContainers : 0));
    const cpuBar = el('monitorCpuBar');
    if (cpuBar) cpuBar.style.width = Math.min(100, cpuPct) + '%';
    const memBar = el('monitorMemoryBar');
    if (memBar) memBar.style.width = Math.min(100, memPct) + '%';
    setText('monitorNodesTitle', t('tabNodes'));
    const listEl = el('monitorNodesList');
    if (listEl) {
        if (!nodes.length) {
            listEl.innerHTML = '<div class="monitor-view__empty">' + escapeHtml(t('backupNoData') || 'Нет данных') + '</div>';
        } else {
            listEl.innerHTML = nodes.map(node => {
                const statusClass = node.status === 'online' ? 'online' : 'offline';
                return `<div class="monitor-view__node-row"><span class="monitor-view__node-name">${escapeHtml(node.name)}</span><span class="monitor-view__node-status ${statusClass}" title="${node.status === 'online' ? t('nodeOnline') : t('nodeOffline')}"></span></div>`;
            }).join('');
        }
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
    setText('monitorVmTotal', '—');
    setText('monitorVmRunning', '—');
    setText('monitorCtTotal', '—');
    setText('monitorCtRunning', '—');
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

// Список сервисов в компактном виде монитора (только те, что не скрыты в настройках)
function renderMonitorServicesList() {
    const listEl = document.getElementById('monitorServicesList');
    if (!listEl) return;
    const list = Array.isArray(monitoredServices) ? monitoredServices : [];
    const visibleList = list.filter(s => !monitorHiddenServiceIds.includes(Number(s.id)));
    setText('monitorServicesTitle', t('tabServicesMonitor'));
    if (!visibleList.length) {
        listEl.innerHTML = '<div class="monitor-view__empty">' + escapeHtml(t('backupNoData') || 'Нет данных') + '</div>';
        return;
    }
    listEl.innerHTML = visibleList.map(s => {
        const name = s.name || getServiceTargetDisplay(s);
        const statusKey = s.lastStatus === 'up' ? 'connected' : (s.lastStatus === 'down' ? 'serverError' : 'notConnected');
        const statusLabel = t(statusKey);
        const statusClass = s.lastStatus === 'up' ? 'bg-success' : (s.lastStatus === 'down' ? 'bg-danger' : 'bg-secondary');
        const typeLabel = (s.type || 'tcp').toUpperCase();
        const target = getServiceTargetDisplay(s);
        const latency = typeof s.lastLatency === 'number' ? `${s.lastLatency} ms` : '—';
        return `
            <div class="monitor-view__card">
                <div class="d-flex justify-content-between align-items-center mb-1">
                    <span class="fw-semibold text-truncate" title="${escapeHtml(name)}">${escapeHtml(name)}</span>
                    <span class="badge ${statusClass}" title="${escapeHtml(statusLabel)}">${escapeHtml(statusLabel)}</span>
                </div>
                <div class="small mb-1">
                    <span class="badge bg-secondary me-1">${escapeHtml(typeLabel)}</span>
                    <code class="text-truncate d-inline-block" style="max-width: 180px;" title="${escapeHtml(target)}">${escapeHtml(target)}</code>
                </div>
                <div class="small text-muted">${t('serviceLatencyHeader') || 'Задержка'}: ${latency}</div>
            </div>
        `;
    }).join('');
}

function renderMonitorVmsList() {
    const listEl = document.getElementById('monitorVmsList');
    if (!listEl) return;
    setText('monitorVmsPanelTitle', t('monitoredVmsDashboardTitle'));
    const cluster = lastClusterData;
    const list = cluster && Array.isArray(cluster.vms) ? cluster.vms : [];
    const visible = list.filter(vm => monitoredVmIds.includes(Number(vm.vmid != null ? vm.vmid : vm.id)) && !monitorHiddenVmIds.includes(Number(vm.vmid != null ? vm.vmid : vm.id)));
    const emptyText = t('vmListEmpty');
    if (!visible.length) {
        listEl.innerHTML = '<div class="monitor-view__empty">' + escapeHtml(emptyText) + '</div>';
        return;
    }
    listEl.innerHTML = visible.map(vm => {
        const typeLabel = (vm.type || 'vm').toUpperCase();
        const status = vm.status || 'unknown';
        const statusClass = getVmStatusBadgeClass(status);
        const statusLabel = getVmStatusLabel(status);
        const note = vm.node ? (vm.node + (vm.vmid != null ? ` / ${vm.vmid}` : '')) : (vm.note || '');
        return `
            <div class="monitor-view__card">
                <div class="d-flex justify-content-between align-items-center mb-1">
                    <span class="fw-semibold text-truncate" title="${escapeHtml(vm.name || '')}">${escapeHtml(vm.name || '')}</span>
                    <span class="badge ${statusClass}" title="${escapeHtml(statusLabel)}">${escapeHtml(statusLabel)}</span>
                </div>
                <div class="small mb-1">
                    <span class="badge bg-secondary me-1">${escapeHtml(typeLabel)}</span>
                    <span class="text-muted" title="${escapeHtml(note || '')}">${escapeHtml(note || '')}</span>
                </div>
            </div>
        `;
    }).join('');
}

function renderVmsMonitorCards() {
    const container = document.getElementById('vmsMonitorCards');
    if (!container) return;
    const cluster = lastClusterData;
    const list = cluster && Array.isArray(cluster.vms) ? cluster.vms : [];
    const visible = list.filter(vm => monitoredVmIds.includes(Number(vm.vmid != null ? vm.vmid : vm.id)));
    if (!visible.length) {
        container.innerHTML = '<div class="col-12 text-muted small">' + (t('vmListEmpty') || 'VM/CT не выбраны') + '</div>';
        return;
    }
    const cards = visible.map(vm => {
        const typeLabel = (vm.type || 'vm').toUpperCase();
        const status = vm.status || 'unknown';
        const statusClass = getVmStatusBadgeClass(status);
        const statusLabel = getVmStatusLabel(status);
        const note = vm.node ? (vm.node + (vm.vmid != null ? ` / ${vm.vmid}` : '')) : (vm.note || '');
        return `
            <div class="col-md-4 col-lg-3 mb-3">
                <div class="node-card h-100">
                    <div class="d-flex justify-content-between align-items-center mb-2">
                        <h6 class="mb-0">${escapeHtml(vm.name || '')}</h6>
                        <span class="badge ${statusClass}" title="${escapeHtml(statusLabel)}">${escapeHtml(statusLabel)}</span>
                    </div>
                    <div class="mb-1">
                        <span class="badge bg-secondary me-1">${escapeHtml(typeLabel)}</span>
                        <span class="small text-muted" title="${escapeHtml(note || '')}">${escapeHtml(note || '')}</span>
                    </div>
                </div>
            </div>
        `;
    }).join('');
    setHTMLIfChanged('vmsMonitorCards', cards || '');
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
    
    const vmT = summary.totalVMs || 0;
    const vmR = summary.runningVMs != null ? summary.runningVMs : 0;
    const ctT = summary.totalContainers || 0;
    const ctR = summary.runningContainers != null ? summary.runningContainers : 0;
    setText('clusterVmTotal', String(vmT));
    setText('clusterVmRunning', String(vmR));
    setText('clusterCtTotal', String(ctT));
    setText('clusterCtRunning', String(ctR));
    const vmBar = el('clusterVmRunningBar');
    if (vmBar) vmBar.style.width = vmT > 0 ? Math.min(100, Math.round((vmR / vmT) * 100)) + '%' : '0%';
    const ctBar = el('clusterCtRunningBar');
    if (ctBar) ctBar.style.width = ctT > 0 ? Math.min(100, Math.round((ctR / ctT) * 100)) + '%' : '0%';

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

    if (monitorMode) {
        updateMonitorView(clusterData);
        renderMonitorServicesList();
        renderMonitorVmsList();
    }

    updateStorageUI(storageData);
    updateBackupsUI(backupsData);
    lastBackupsDataForMonitor = backupsData;
    if (monitorMode && monitorCurrentView === 'backupRuns') {
        renderMonitorBackupRuns(backupsData);
    }

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

// Update backups UI: задания (конфиг) и выполнения (vzdump)
function updateBackupsUI(data) {
    if (!data) return;
    const jobs = Array.isArray(data.jobs) ? data.jobs : [];
    const execs = Array.isArray(data.executions) ? data.executions : [];
    const stats = data.stats || { total: 0, enabled: 0, disabled: 0 };
    const exs = data.execution_stats || { shown: 0, success: 0, error: 0, running: 0 };
    const dtLangUrl = currentLanguage === 'ru'
        ? 'https://cdn.datatables.net/plug-ins/1.13.6/i18n/ru.json'
        : 'https://cdn.datatables.net/plug-ins/1.13.6/i18n/en-GB.json';

    setHTMLIfChanged('backupJobsStats', `
        <div class="col-6 col-md-4 col-lg-2"><div class="stat-card"><div class="stat-value">${stats.total}</div><div class="stat-label">${t('backupTotal')}</div></div></div>
        <div class="col-6 col-md-4 col-lg-2"><div class="stat-card"><div class="stat-value text-success">${stats.enabled}</div><div class="stat-label">${t('backupEnabled')}</div></div></div>
        <div class="col-6 col-md-4 col-lg-2"><div class="stat-card"><div class="stat-value text-secondary">${stats.disabled}</div><div class="stat-label">${t('backupDisabled')}</div></div></div>
    `);

    setHTMLIfChanged('backupExecStats', `
        <div class="col-6 col-md-4 col-lg-2"><div class="stat-card"><div class="stat-value">${exs.shown}</div><div class="stat-label">${t('backupExecShown')}</div></div></div>
        <div class="col-6 col-md-4 col-lg-2"><div class="stat-card"><div class="stat-value text-success">${exs.success}</div><div class="stat-label">${t('backupSuccess')}</div></div></div>
        <div class="col-6 col-md-4 col-lg-2"><div class="stat-card"><div class="stat-value text-danger">${exs.error}</div><div class="stat-label">${t('backupError')}</div></div></div>
        <div class="col-6 col-md-4 col-lg-2"><div class="stat-card"><div class="stat-value text-primary">${exs.running}</div><div class="stat-label">${t('backupRunning')}</div></div></div>
    `);

    const noJobsRow = `<tr><td colspan="7" class="text-center text-muted py-4">${escapeHtml(t('backupNoData'))}</td></tr>`;
    if (jobs.length === 0) {
        if (backupsJobsTable) {
            backupsJobsTable.destroy();
            backupsJobsTable = null;
        }
        setHTMLIfChanged('backupJobsBody', noJobsRow);
    } else {
        const jobsHtml = jobs.map(job => {
            const stateBadge = job.enabled
                ? `<span class="badge bg-success">${escapeHtml(t('backupEnabled'))}</span>`
                : `<span class="badge bg-secondary">${escapeHtml(t('backupDisabled_yes'))}</span>`;
            return `<tr>
                <td><strong>${escapeHtml(String(job.id))}</strong></td>
                <td><code>${escapeHtml(job.schedule || '—')}</code></td>
                <td>${stateBadge}</td>
                <td>${escapeHtml(job.storage || '—')}</td>
                <td>${job.vmid != null && job.vmid !== '' ? escapeHtml(String(job.vmid)) : escapeHtml(t('backupAll'))}</td>
                <td><span class="badge bg-info">${escapeHtml(job.mode || 'snapshot')}</span></td>
                <td><small>${escapeHtml(job.next_run || '—')}</small></td>
            </tr>`;
        }).join('');
        setHTMLIfChanged('backupJobsBody', jobsHtml);
        if (!backupsJobsTable) {
            backupsJobsTable = $('#backupJobsTable').DataTable({
                pageLength: 10,
                order: [[0, 'asc']],
                language: { url: dtLangUrl }
            });
        } else {
            backupsJobsTable.clear().rows.add($('#backupJobsBody').find('tr')).draw();
        }
    }

    const noExecRow = `<tr><td colspan="8" class="text-center text-muted py-4">${escapeHtml(t('backupNoExecData'))}</td></tr>`;
    if (execs.length === 0) {
        if (backupsExecTable) {
            backupsExecTable.destroy();
            backupsExecTable = null;
        }
        setHTMLIfChanged('backupExecutionsBody', noExecRow);
    } else {
        const execHtml = execs.map(tk => {
            const st = tk.status || '';
            const ex = tk.exitstatus || '';
            let badge = `<span class="badge bg-secondary">${escapeHtml(t('backupStatusUnknown'))}</span>`;
            if (st === 'OK' || String(ex).toLowerCase() === 'ok') {
                badge = `<span class="badge bg-success">${escapeHtml(t('backupStatusSuccess'))}</span>`;
            } else if (st === 'error' || String(ex).toLowerCase() === 'error') {
                badge = `<span class="badge bg-danger">${escapeHtml(t('backupStatusError'))}</span>`;
            } else if (st === 'running') {
                badge = `<span class="badge bg-primary">${escapeHtml(t('backupStatusRunning'))}</span>`;
            } else if (st) {
                badge = `<span class="badge bg-warning">${escapeHtml(st)}</span>`;
            }
            const upid = tk.upid || '';
            const upidShort = upid.length > 32 ? '…' + upid.slice(-30) : upid;
            const stOrder = Number(tk.starttime) || 0;
            const enOrder = Number(tk.endtime) || 0;
            const resCls = (String(ex).toLowerCase() === 'ok' || st === 'OK') ? 'text-success' : (st === 'error' ? 'text-danger' : '');
            return `<tr>
                <td data-order="${stOrder}"><small>${escapeHtml(tk.starttime_fmt || '—')}</small></td>
                <td data-order="${enOrder}"><small>${escapeHtml(tk.endtime_fmt || '—')}</small></td>
                <td>${escapeHtml(tk.node || '—')}</td>
                <td>${tk.id != null && tk.id !== '' ? escapeHtml(String(tk.id)) : '—'}</td>
                <td>${badge}</td>
                <td class="${resCls}"><small>${escapeHtml(ex || st || '—')}</small></td>
                <td><small>${escapeHtml(tk.user || '—')}</small></td>
                <td><code class="small text-break" style="max-width:12rem" title="${escapeHtml(upid)}">${escapeHtml(upidShort || '—')}</code></td>
            </tr>`;
        }).join('');
        setHTMLIfChanged('backupExecutionsBody', execHtml);
        if (!backupsExecTable) {
            backupsExecTable = $('#backupExecutionsTable').DataTable({
                pageLength: 15,
                order: [[0, 'desc']],
                language: { url: dtLangUrl }
            });
        } else {
            backupsExecTable.clear().rows.add($('#backupExecutionsBody').find('tr')).draw();
        }
    }
}

function monitorBackupStripClass(tk) {
    const st = tk.status || '';
    const ex = String(tk.exitstatus || '').toLowerCase();
    if (st === 'OK' || ex === 'ok') return 'monitor-backup-run-strip--ok';
    if (st === 'error' || ex === 'error') return 'monitor-backup-run-strip--err';
    if (st === 'running') return 'monitor-backup-run-strip--run';
    return 'monitor-backup-run-strip--warn';
}

function monitorBackupBadge(tk) {
    const st = tk.status || '';
    const ex = tk.exitstatus || '';
    if (st === 'OK' || String(ex).toLowerCase() === 'ok') {
        return `<span class="badge bg-success">${escapeHtml(t('backupStatusSuccess'))}</span>`;
    }
    if (st === 'error' || String(ex).toLowerCase() === 'error') {
        return `<span class="badge bg-danger">${escapeHtml(t('backupStatusError'))}</span>`;
    }
    if (st === 'running') {
        return `<span class="badge bg-primary">${escapeHtml(t('backupStatusRunning'))}</span>`;
    }
    if (st) return `<span class="badge bg-warning text-dark">${escapeHtml(st)}</span>`;
    return `<span class="badge bg-secondary">${escapeHtml(t('backupStatusUnknown'))}</span>`;
}

/** Короткая дата/время для одной строки на экране монитора */
function monitorBackupShortTime(fmt) {
    if (!fmt) return '—';
    const s = String(fmt).trim();
    const comma = s.indexOf(',');
    if (comma > 0) {
        const datePart = s.slice(0, comma).trim();
        const timePart = s.slice(comma + 1).trim();
        const dp = datePart.split('.');
        const dateShort = dp.length >= 2 ? `${dp[0]}.${dp[1]}` : datePart.slice(0, 5);
        const tm = timePart.match(/^(\d{1,2}:\d{2})/);
        return `${dateShort} ${tm ? tm[1] : timePart.slice(0, 5)}`;
    }
    return s.length > 14 ? s.slice(0, 14) : s;
}

const MONITOR_BACKUPS_UI_MAX = 10;

/** Экран бэкапов: до 10 vzdump на узел, без скролла */
function renderMonitorBackupRuns(data) {
    const rowEl = document.getElementById('backupsMonitorCardsRow');
    if (!rowEl) return;
    if (!data) {
        rowEl.innerHTML = `<div class="monitor-backup-node-empty w-100">${escapeHtml(t('backupMonitorNoDataYet'))}</div>`;
        return;
    }
    let byNode = data.executions_by_node && typeof data.executions_by_node === 'object' ? { ...data.executions_by_node } : null;
    if (!byNode || !Object.keys(byNode).length) {
        byNode = {};
        const execs = Array.isArray(data.executions) ? data.executions : [];
        for (const e of execs) {
            const n = e.node || '?';
            if (!byNode[n]) byNode[n] = [];
            byNode[n].push(e);
        }
    }
    const nodeNames = Object.keys(byNode).sort((a, b) => a.localeCompare(b, undefined, { sensitivity: 'base' }));

    if (!nodeNames.length) {
        rowEl.innerHTML = `<div class="monitor-backup-node-empty w-100">${escapeHtml(t('backupNoExecData'))}</div>`;
        return;
    }

    rowEl.innerHTML = nodeNames.map(node => {
        const allRuns = byNode[node] || [];
        const displayRuns = allRuns.slice(0, MONITOR_BACKUPS_UI_MAX);
        const totalOnNode = allRuns.length;
        const shown = displayRuns.length;
        const maxOnNode = Math.min(totalOnNode, 10);
        const countBadge = totalOnNode
            ? `<span class="monitor-backup-count-badge badge bg-secondary text-nowrap" title="${escapeHtml(t('backupMonitorFullListHint'))}"><span class="monitor-backup-count-num">${shown}</span><span class="mx-1">/</span><span>${maxOnNode}</span></span>`
            : '';
        const thVm = escapeHtml(t('backupMonitorColVm'));
        const thTime = escapeHtml(t('backupMonitorColTime'));
        const thSt = escapeHtml(t('backupMonitorColStatus'));
        const strips = displayRuns.length
            ? `<div class="monitor-backup-table-scroll">
                <table class="table monitor-backup-node-table mb-0">
                <thead><tr>
                    <th class="monitor-backup-col-vm">${thVm}</th>
                    <th class="monitor-backup-col-time">${thTime}</th>
                    <th class="monitor-backup-col-st text-end">${thSt}</th>
                </tr></thead>
                <tbody>${displayRuns.map(task => {
                const vm = task.id != null && task.id !== '' ? String(task.id) : '—';
                const rowCls = monitorBackupStripClass(task).replace('monitor-backup-run-strip--', 'monitor-backup-tr--');
                const ts = escapeHtml(monitorBackupShortTime(task.starttime_fmt));
                const timeTd = task.endtime_fmt
                    ? `<span class="monitor-backup-time-start">${ts}</span><span class="monitor-backup-time-sep"> → </span><span class="monitor-backup-time-end">${escapeHtml(monitorBackupShortTime(task.endtime_fmt))}</span>`
                    : `<span class="monitor-backup-time-single">${ts}</span>`;
                return `<tr class="monitor-backup-tr ${rowCls}" title="${escapeHtml(task.upid || '')}">
                    <td class="monitor-backup-col-vm">${escapeHtml(vm)}</td>
                    <td class="monitor-backup-col-time">${timeTd}</td>
                    <td class="monitor-backup-col-st">${monitorBackupBadge(task)}</td>
                </tr>`;
            }).join('')}</tbody></table></div>`
            : `<div class="monitor-backup-node-empty">${escapeHtml(t('backupMonitorNodeEmpty'))}</div>`;
        return `<div class="monitor-backup-node-col">
            <div class="card monitor-backup-node-card border h-100">
                <div class="card-header d-flex align-items-center gap-2">
                    <span class="text-truncate min-w-0 flex-grow-1"><i class="bi bi-hdd-network me-1 flex-shrink-0"></i>${escapeHtml(node)}</span>
                    ${countBadge}
                </div>
                <div class="card-body monitor-backup-card-body-table p-0">${strips}</div>
            </div>
        </div>`;
    }).join('');
}

// ==================== SERVICE MONITORING (отдельная вкладка, TCP/UDP/HTTP) ====================

// Monitored services are persisted via API; no local save needed

function toggleServiceTypeFields() {
    const typeSelect = document.getElementById('settingsServiceTypeSelect');
    const hostWrap = document.getElementById('settingsServiceHostWrap');
    const portWrap = document.getElementById('settingsServicePortWrap');
    const urlWrap = document.getElementById('settingsServiceUrlWrap');
    const urlLabel = document.getElementById('settingsServiceUrlLabel');
    const urlInput = document.getElementById('settingsServiceUrlInput');
    if (!typeSelect || !hostWrap || !portWrap || !urlWrap) return;
    const type = (typeSelect.value || 'tcp').toLowerCase();
    const isHttpUrl = type === 'http' || type === 'https';
    const needUrl = type === 'http' || type === 'https' || type === 'snmp' || type === 'nut';

    // For http/https: host+port are not needed, only URL is required.
    // For snmp/nut: host+port are needed + extra params in the URL field.
    hostWrap.classList.toggle('d-none', isHttpUrl);
    portWrap.classList.toggle('d-none', isHttpUrl);
    urlWrap.classList.toggle('d-none', !needUrl);

    if (urlLabel && urlInput) {
        if (type === 'snmp') {
            urlLabel.textContent = t('serviceUrlLabelSnmp');
            urlInput.placeholder = 'public|1.3.6.1.2.1.1.3.0';
        } else if (type === 'nut') {
            urlLabel.textContent = t('serviceUrlLabelNutHint');
            urlInput.placeholder = 'myups|ups.status';
        } else {
            urlLabel.textContent = 'URL';
            urlInput.placeholder = 'https://example.local/';
        }
    }
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
    if (type === 'snmp' || type === 'nut') {
        return { name, type, host: (s.host || '').trim(), port: parseInt(s.port, 10) || null, url: (s.url || '').trim() };
    }
    return { name, type: type || 'tcp', host: (s.host || '').trim(), port: parseInt(s.port, 10) };
}

function renderMonitoredServices() {
    const container = document.getElementById('servicesCards');
    if (!container) return;
    const list = Array.isArray(monitoredServices) ? monitoredServices : [];
    if (!list.length) {
        container.innerHTML = '<div class="col-12 text-muted small">' + escapeHtml(t('servicesNotConfigured')) + '</div>';
        return;
    }
    const cards = list.map((s, idx) => {
        const statusBadge = s.lastStatus === 'up'
            ? `<span class="badge bg-success">${t('connected')}</span>`
            : (s.lastStatus === 'down'
                ? `<span class="badge bg-danger">${t('serverError')}</span>`
                : `<span class="badge bg-secondary">${t('notConnected')}</span>`);
        const latency = typeof s.lastLatency === 'number' ? `${s.lastLatency} ms` : '—';
        const typeLabel = (s.type || 'tcp').toUpperCase();
        const target = getServiceTargetDisplay(s);
        return `
            <div class="col-md-4 col-lg-3 mb-3">
                <div class="node-card h-100">
                    <div class="d-flex justify-content-between align-items-center mb-2">
                        <h6 class="mb-0">${escapeHtml(s.name || target)}</h6>
                        ${statusBadge}
                    </div>
                    <div class="mb-1">
                        <span class="badge bg-secondary me-1">${escapeHtml(typeLabel)}</span>
                        <code class="small">${escapeHtml(target)}</code>
                    </div>
                    <div class="small text-muted">
                        ${t('serviceLatencyHeader') || 'Задержка'}: ${latency}
                    </div>
                </div>
            </div>
        `;
    }).join('');
    setHTMLIfChanged('servicesCards', cards || '');
}

function renderSettingsMonitoredServices() {
    const body = document.getElementById('settingsServicesBody');
    if (!body) return;
    const list = Array.isArray(monitoredServices) ? monitoredServices : [];
    const rows = list.map((s) => {
        const typeLabel = (s.type || 'tcp').toUpperCase();
        const target = getServiceTargetDisplay(s);
        const id = s.id != null ? s.id : 0;
        const showInMonitor = !monitorHiddenServiceIds.includes(Number(id));
        return `
            <tr>
                <td>${escapeHtml(s.name || target)}</td>
                <td><span class="badge bg-secondary">${escapeHtml(typeLabel)}</span></td>
                <td><code>${escapeHtml(target)}</code></td>
                <td class="text-center align-middle">
                    <input type="checkbox" class="form-check-input" id="monitorVisible_${id}" ${showInMonitor ? 'checked' : ''}
                           onchange="toggleMonitorVisible(${id})" title="${t('settingsServiceShowInMonitor') || 'Показывать в режиме монитора'}">
                </td>
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

function toggleMonitorVisible(serviceId) {
    const id = Number(serviceId);
    if (monitorHiddenServiceIds.includes(id)) {
        monitorHiddenServiceIds = monitorHiddenServiceIds.filter(x => x !== id);
    } else {
        monitorHiddenServiceIds = [...monitorHiddenServiceIds, id];
    }
    saveSettingsToServer({ monitorHiddenServiceIds: monitorHiddenServiceIds });
    renderSettingsMonitoredServices();
    renderMonitorServicesList();
}

function getClusterVms() {
    return (lastClusterData && Array.isArray(lastClusterData.vms)) ? lastClusterData.vms : [];
}

async function loadClusterVmsForSettings(options) {
    const silent = options && options.silent === true;
    if (currentServerType !== 'proxmox') return;
    const btn = document.getElementById('loadClusterVmsBtn');
    if (btn && !silent) { btn.disabled = true; setText('loadClusterVmsBtnText', t('loading') || 'Загрузка…'); }
    try {
        const connId = getCurrentConnectionId();
        const serverUrl = getCurrentServerUrl();
        const headers = connId ? { 'X-Connection-Id': connId } : { 'Authorization': apiToken, 'X-Server-Url': serverUrl };
        const res = await fetch('/api/cluster/full', { headers });
        const data = await res.json();
        if (res.ok && data && Array.isArray(data.vms)) {
            lastClusterData = data;
            renderSettingsMonitoredVms();
            renderMonitorVmsList();
            if (!silent) showToast(t('dataUpdated') || 'Список обновлён', 'success');
        } else {
            if (!silent) showToast(data?.error || (t('connectError') || 'Ошибка загрузки'), 'error');
        }
    } catch (e) {
        if (!silent) showToast((t('connectError') || 'Ошибка') + ': ' + e.message, 'error');
    }
    if (btn) { btn.disabled = false; setText('loadClusterVmsBtnText', t('loadClusterVmsBtnText')); }
}

/** Добавить VM/CT в монитор по введённому ID или имени */
function addVmToMonitorByIdOrName() {
    const input = document.getElementById('settingsVmIdOrNameInput');
    if (!input) return;
    const raw = (input.value || '').trim();
    if (!raw) {
        showToast(t('settingsVmEnterIdOrName') || 'Введите ID или имя VM/CT', 'warning');
        return;
    }
    let vms = getClusterVms();
    if (!vms.length) {
        showToast(t('settingsVmRefreshListFirst') || 'Сначала нажмите «Обновить список VM/CT»', 'warning');
        return;
    }
    const asNum = parseInt(raw, 10);
    const isNumeric = String(asNum) === raw && !Number.isNaN(asNum);
    const matched = vms.filter(vm => {
        if (isNumeric && vm.vmid != null) return Number(vm.vmid) === asNum;
        const name = (vm.name || '').toLowerCase();
        return name === raw.toLowerCase() || name.includes(raw.toLowerCase());
    });
    if (matched.length === 0) {
        showToast(t('settingsVmNotFound') || 'Не найдено. Проверьте ID/имя или обновите список.', 'warning');
        return;
    }
    matched.forEach(vm => {
        if (vm.vmid == null) return;
        const nid = Number(vm.vmid);
        if (!monitoredVmIds.includes(nid)) monitoredVmIds = [...monitoredVmIds, nid];
        monitorHiddenVmIds = monitorHiddenVmIds.filter(x => x !== nid);
    });
    saveSettingsToServer({ monitorVms: monitoredVmIds, monitorHiddenVmIds });
    renderSettingsMonitoredVms();
    renderMonitorVmsList();
    input.value = '';
    showToast(matched.length === 1
        ? (t('settingsVmAdded') || 'Добавлено в монитор')
        : (t('settingsVmAddedCount') || 'Добавлено в монитор').replace('{n}', matched.length),
        'success');
}

function getVmStatusBadgeClass(status) {
    const s = (status || '').toLowerCase();
    if (s === 'running') return 'bg-success';
    if (s === 'stopped') return 'bg-secondary';
    return 'bg-warning text-dark';
}

function getVmStatusLabel(status) {
    const key = 'vmStatus_' + (status || 'unknown').toLowerCase();
    return t(key) || (status || 'unknown');
}

function renderSettingsMonitoredVms() {
    const body = document.getElementById('settingsVmsBody');
    if (!body) return;
    const list = getClusterVms().filter(vm => monitoredVmIds.includes(Number(vm.vmid != null ? vm.vmid : vm.id)));
    const rows = list.map((vm) => {
        const id = vm.vmid != null ? vm.vmid : vm.id != null ? vm.id : 0;
        const showInMonitor = !monitorHiddenVmIds.includes(Number(id));
        const typeLabel = (vm.type || 'vm').toUpperCase();
        const status = vm.status || 'unknown';
        const note = vm.node ? (vm.node + (vm.vmid != null ? ` / ${vm.vmid}` : '')) : (vm.note || '');
        const statusClass = getVmStatusBadgeClass(status);
        const showInMonitorTitle = t('settingsVmShowInMonitor') || 'Показывать в режиме монитора';
        return `
            <tr>
                <td>${escapeHtml(vm.name || '')}</td>
                <td><span class="badge bg-secondary">${escapeHtml(typeLabel)}</span></td>
                <td><span class="badge ${statusClass}">${escapeHtml(getVmStatusLabel(status))}</span></td>
                <td>${note ? `<span class="text-muted small">${escapeHtml(note)}</span>` : '&mdash;'}</td>
                <td class="text-center align-middle">
                    <input type="checkbox" class="form-check-input" id="monitorVmVisible_${id}" ${showInMonitor ? 'checked' : ''}
                           onchange="toggleMonitorVmVisible(${id})" title="${escapeHtml(showInMonitorTitle)}">
                </td>
                <td class="text-nowrap">
                    <button class="btn btn-sm btn-outline-danger" onclick="removeMonitoredVm(${id})" title="${t('remove') || 'Удалить'}">
                        <i class="bi bi-trash"></i>
                    </button>
                </td>
            </tr>
        `;
    }).join('');
    setHTMLIfChanged('settingsVmsBody', rows || '');
}

function toggleMonitorVmVisible(vmId) {
    const id = Number(vmId);
    if (monitorHiddenVmIds.includes(id)) {
        monitorHiddenVmIds = monitorHiddenVmIds.filter(x => x !== id);
    } else {
        monitorHiddenVmIds = [...monitorHiddenVmIds, id];
    }
    saveSettingsToServer({ monitorHiddenVmIds });
    renderSettingsMonitoredVms();
    renderMonitorVmsList();
}

function removeMonitoredVm(vmId) {
    const id = Number(vmId);
    monitoredVmIds = monitoredVmIds.filter(x => x !== id);
    monitorHiddenVmIds = monitorHiddenVmIds.filter(x => x !== id);
    saveSettingsToServer({ monitorVms: monitoredVmIds, monitorHiddenVmIds });
    renderSettingsMonitoredVms();
    renderMonitorVmsList();
    if (lastClusterData) {
        const visible = (lastClusterData.vms || []).filter(vm => monitoredVmIds.includes(Number(vm.vmid)) && !monitorHiddenVmIds.includes(Number(vm.vmid)));
        const wrap = document.getElementById('monitoredVmsDashboardWrap');
        const tbody = document.getElementById('monitoredVmsDashboardBody');
        if (wrap) wrap.style.display = visible.length ? 'block' : 'none';
        if (tbody && visible.length) {
            tbody.innerHTML = visible.map(vm => {
                const typeLabel = (vm.type || 'vm').toUpperCase();
                const status = vm.status || 'unknown';
                const statusClass = getVmStatusBadgeClass(status);
                return `<tr><td>${escapeHtml(vm.name || '')}</td><td><span class="badge bg-secondary">${escapeHtml(typeLabel)}</span></td><td><span class="badge ${statusClass}">${escapeHtml(getVmStatusLabel(status))}</span></td><td class="text-muted small">${escapeHtml(vm.node || '')}</td></tr>`;
            }).join('');
        }
    }
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

async function exportServicesOnly() {
    try {
        const resp = await fetch('/api/settings/export/services');
        if (!resp.ok) {
            const data = await resp.json().catch(() => ({}));
            throw new Error(data.error || `HTTP ${resp.status}`);
        }
        const json = await resp.json();
        const only = { services: json.services || [] };
        const blob = new Blob([JSON.stringify(only, null, 2)], { type: 'application/json' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = 'homelab-monitor-services.json';
        document.body.appendChild(a);
        a.click();
        a.remove();
        URL.revokeObjectURL(url);
    } catch (e) {
        showToast((t('settingsImportError') || t('errorUpdate')) + ': ' + e.message, 'error');
    }
}

function triggerImportServices() {
    const input = document.getElementById('servicesImportFile');
    if (input) input.click();
}

async function handleImportServicesFile(event) {
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
            const resp = await fetch('/api/settings/import/services', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ services: parsed.services || parsed })
            });
            const data = await resp.json().catch(() => ({}));
            if (!resp.ok || data.success === false) {
                throw new Error(data.error || `HTTP ${resp.status}`);
            }
            showToast(t('settingsImportSuccess') || 'Настройки импортированы, данные обновлены', 'success');
            const servicesData = await fetch('/api/settings/services').then(r => r.json()).catch(() => ({ services: [] }));
            monitoredServices = Array.isArray(servicesData.services) ? servicesData.services : [];
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

async function exportVmsOnly() {
    try {
        const resp = await fetch('/api/settings/export/vms');
        if (!resp.ok) {
            const data = await resp.json().catch(() => ({}));
            throw new Error(data.error || `HTTP ${resp.status}`);
        }
        const json = await resp.json();
        const only = {
            monitor_vms: Array.isArray(json.monitor_vms) ? json.monitor_vms : [],
            monitor_hidden_vm_ids: Array.isArray(json.monitor_hidden_vm_ids) ? json.monitor_hidden_vm_ids : []
        };
        const blob = new Blob([JSON.stringify(only, null, 2)], { type: 'application/json' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = 'homelab-monitor-vms.json';
        document.body.appendChild(a);
        a.click();
        a.remove();
        URL.revokeObjectURL(url);
    } catch (e) {
        showToast((t('settingsImportError') || t('errorUpdate')) + ': ' + e.message, 'error');
    }
}

function triggerImportVms() {
    const input = document.getElementById('vmsImportFile');
    if (input) input.click();
}

async function handleImportVmsFile(event) {
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
        const body = {};
        if (Array.isArray(parsed.monitor_vms)) body.monitor_vms = parsed.monitor_vms;
        if (Array.isArray(parsed.monitor_hidden_vm_ids)) body.monitor_hidden_vm_ids = parsed.monitor_hidden_vm_ids;
        if (!body.monitor_vms && !body.monitor_hidden_vm_ids) {
            showToast(t('settingsImportError') || 'В файле нет monitor_vms или monitor_hidden_vm_ids', 'error');
            event.target.value = '';
            return;
        }
        try {
            const resp = await fetch('/api/settings/import/vms', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(body)
            });
            const data = await resp.json().catch(() => ({}));
            if (!resp.ok || data.success === false) {
                throw new Error(data.error || `HTTP ${resp.status}`);
            }
            showToast(t('settingsImportSuccess') || 'Настройки импортированы', 'success');
            await loadSettings();
            renderSettingsMonitoredVms();
            renderMonitorVmsList();
        } catch (err) {
            showToast((t('settingsImportError') || t('errorUpdate')) + ': ' + err.message, 'error');
        } finally {
            event.target.value = '';
        }
    };
    reader.readAsText(file, 'utf-8');
}

async function exportAllConfig() {
    try {
        const resp = await fetch('/api/settings/export/all');
        if (!resp.ok) {
            const data = await resp.json().catch(() => ({}));
            throw new Error(data.error || `HTTP ${resp.status}`);
        }
        const json = await resp.json();
        const blob = new Blob([JSON.stringify(json, null, 2)], { type: 'application/json' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = 'homelab-monitor-config.json';
        document.body.appendChild(a);
        a.click();
        a.remove();
        URL.revokeObjectURL(url);
    } catch (e) {
        showToast((t('settingsImportError') || t('errorUpdate')) + ': ' + e.message, 'error');
    }
}

function triggerImportAllConfig() {
    const input = document.getElementById('allConfigImportFile');
    if (input) input.click();
}

async function handleImportAllConfigFile(event) {
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
            const resp = await fetch('/api/settings/import/all', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(parsed)
            });
            const data = await resp.json().catch(() => ({}));
            if (!resp.ok || data.success === false) {
                throw new Error(data.error || `HTTP ${resp.status}`);
            }
            showToast(t('settingsImportSuccess') || 'Настройки импортированы, данные обновлены', 'success');
            await loadSettings();
            const servicesData = await fetch('/api/settings/services').then(r => r.json()).catch(() => ({ services: [] }));
            monitoredServices = Array.isArray(servicesData.services) ? servicesData.services : [];
            renderMonitoredServices();
            renderSettingsMonitoredServices();
            renderSettingsMonitoredVms();
            renderMonitorVmsList();
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
    } else if (type === 'snmp' || type === 'nut') {
        const url = urlInput ? urlInput.value.trim() : '';
        const host = hostInput ? hostInput.value.trim() : '';
        const port = portInput ? parseInt(portInput.value, 10) : null;
        if (!url) {
            showToast((t('serviceUrlRequired') || 'Укажите параметры') + '', 'error');
            return;
        }
        if (!host || !port || port < 1 || port > 65535) {
            showToast(t('serviceHostPortRequired') || 'Укажите хост и порт (1–65535)', 'error');
            return;
        }
        body.url = url;
        body.host = host;
        body.port = port;
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
        monitorHiddenServiceIds = monitorHiddenServiceIds.filter(x => x !== Number(id));
        saveSettingsToServer({ monitorHiddenServiceIds: monitorHiddenServiceIds });
        renderMonitoredServices();
        renderSettingsMonitoredServices();
        renderMonitorServicesList();
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
        persistSettingsSession();
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
        persistSettingsSession();
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

function logoutSettings() {
    clearSettingsSession();
    showToast(t('settingsLogoutDone') || 'Сессия настроек завершена', 'info');
    showDashboard();
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
    settingsSessionTtlMinutes = parseInt(data.session_ttl_minutes, 10) || 30;
    try {
        const expiry = sessionStorage.getItem(SETTINGS_UNLOCK_EXPIRY_KEY);
        if (expiry && Date.now() < parseInt(expiry, 10)) {
            settingsUnlocked = true;
        }
    } catch (_) {}

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
    if (Array.isArray(data.proxmox_servers) && data.proxmox_servers.length) proxmoxServers = data.proxmox_servers.map(u => normalizeUrlClient(u));
    if (Array.isArray(data.truenas_servers) && data.truenas_servers.length) truenasServers = data.truenas_servers.map(u => normalizeUrlClient(u));
    if (data.connection_id_map && typeof data.connection_id_map === 'object') {
        connectionIdMap = {};
        for (const [k, id] of Object.entries(data.connection_id_map)) {
            const parts = String(k).split('|');
            if (parts.length >= 2) {
                const type = parts[0];
                const url = parts.slice(1).join('|');
                connectionIdMap[connectionKey(type, url)] = id;
            } else {
                connectionIdMap[k] = id;
            }
        }
    }
    monitoredServices = Array.isArray(servicesData.services) ? servicesData.services : [];
    monitoredVmIds = [];
    if (Array.isArray(data.monitor_vms) && data.monitor_vms.length) {
        data.monitor_vms.forEach(x => {
            const id = typeof x === 'number' ? x : (x && (x.vmid ?? x.id));
            if (id != null) monitoredVmIds.push(Number(id));
        });
    }
    if (data.current_server_index != null) currentServerIndex = parseInt(data.current_server_index, 10) || 0;
    if (data.current_truenas_index != null) currentTrueNASServerIndex = parseInt(data.current_truenas_index, 10) || 0;
    if (data.server_type) currentServerType = data.server_type === 'truenas' ? 'truenas' : 'proxmox';
    if (data.monitor_theme === 'light' || data.monitor_theme === 'dark') monitorTheme = data.monitor_theme;
    if (data.custom_theme_style_settings !== undefined) {
        customThemeStyleSettings = data.custom_theme_style_settings;
        applyCustomThemeStyleSettings();
    } else if (data.custom_theme_css) {
        customThemeCss = normalizeCustomThemeCssInput(data.custom_theme_css);
        applyCustomThemeCss();
    }
    syncCustomThemeCssEditorUI();
    monitorHiddenServiceIds = Array.isArray(data.monitor_hidden_service_ids) ? data.monitor_hidden_service_ids : [];
    monitorHiddenVmIds = Array.isArray(data.monitor_hidden_vm_ids) ? data.monitor_hidden_vm_ids : [];
    monitorScreensOrder = Array.isArray(data.monitor_screens_order) && data.monitor_screens_order.length
        ? normalizeMonitorScreensOrder(data.monitor_screens_order)
        : MONITOR_SCREEN_IDS_ALL.slice();
    speedtestClientEnabled = !!(data.speedtest_enabled === true || data.speedtest_enabled === '1'
        || data.speedtest_enabled === 1 || data.speedtest_enabled === 'true');
    const spEn = document.getElementById('speedtestEnabledSelect');
    if (spEn) spEn.value = speedtestClientEnabled ? '1' : '0';
    const spSrv = document.getElementById('speedtestServerInput');
    if (spSrv) spSrv.value = data.speedtest_server != null ? String(data.speedtest_server) : '';
    const spDay = document.getElementById('speedtestPerDayInput');
    if (spDay) {
        let n = parseInt(data.speedtest_per_day, 10);
        if (!Number.isFinite(n) || n < 1) n = 4;
        if (n > 48) n = 48;
        spDay.value = String(n);
    }
    renderSettingsMonitorScreensOrderList();
    const ttlSel = document.getElementById('settingsSessionTtlSelect');
    if (ttlSel) {
        const v = String(settingsSessionTtlMinutes);
        if (ttlSel.querySelector('option[value="' + v + '"]')) ttlSel.value = v;
        else ttlSel.value = '30';
    }
    if (data.monitor_mode === true || data.monitor_mode === 'true') {
        monitorMode = true;
        document.body.classList.add('monitor-mode');
        const monitorBtn = document.getElementById('monitorModeBtn');
        if (monitorBtn) {
            monitorBtn.classList.add('active');
            monitorBtn.classList.remove('btn-outline-info');
            monitorBtn.classList.add('btn-info');
            monitorBtn.innerHTML = '<i class="bi bi-check-lg"></i> <span id="monitorModeText">' + t('monitorModeOn') + '</span>';
        }
        // По умолчанию после перезагрузки открываем экран кластера (без автозапуска fullscreen — только по клику пользователя)
        monitorCurrentView = 'cluster';
        applyMonitorView(monitorCurrentView);
        applyMonitorTheme();
        initMonitorSwipes();
    }
    // Preferred language select in settings
    const langSelect = document.getElementById('settingsPreferredLanguageSelect');
    if (langSelect && Array.isArray(availableLanguages) && availableLanguages.length) {
        langSelect.innerHTML = availableLanguages.map(code => {
            return `<option value="${code}">${code.toUpperCase()}</option>`;
        }).join('');
        if (data.preferred_language && availableLanguages.includes(data.preferred_language)) {
            langSelect.value = data.preferred_language;
        } else if (serverDefaultLanguage && availableLanguages.includes(serverDefaultLanguage)) {
            langSelect.value = serverDefaultLanguage;
        }
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

// Render one server list into a container
function renderOneServerList(containerId, servers, currentIdx, type) {
    const container = document.getElementById(containerId);
    if (!container) return;
    container.innerHTML = '';
    const placeholder = type === 'truenas' ? 'https://truenas.local' : 'https://192.168.1.1:8006';
    servers.forEach((server, index) => {
        const div = document.createElement('div');
        div.className = 'input-group mb-2';
        const isCurrent = index === currentIdx;
        const statusBadge = isCurrent ? '<span class="badge bg-success ms-2">✓</span>' : '';
        div.innerHTML = `
            <input type="text" class="form-control form-control-sm ${isCurrent ? 'border-success' : ''}"
                   value="${escapeHtml(server)}" data-index="${index}"
                   onchange="updateServerUrlByType('${type}', ${index}, this.value)"
                   placeholder="${placeholder}">
            <button class="btn btn-outline-secondary btn-sm" type="button" onclick="setCurrentServerByType('${type}', ${index})"
                    title="${t('currentServer')}">
                <i class="bi bi-${isCurrent ? 'check-lg' : 'arrow-right'}"></i>
            </button>
            <button class="btn btn-outline-danger btn-sm" type="button" onclick="removeServerByType('${type}', ${index})"
                    title="${t('removeServer')}">
                <i class="bi bi-trash"></i>
            </button>
            ${statusBadge}
        `;
        container.appendChild(div);
    });
}

// Render servers list (both Proxmox and TrueNAS blocks)
function renderServerList() {
    renderOneServerList('serverListProxmox', proxmoxServers, currentServerIndex, 'proxmox');
    renderOneServerList('serverListTrueNAS', truenasServers, currentTrueNASServerIndex, 'truenas');
}

// Add new server by type
function addServerByType(type) {
    if (type === 'truenas') {
        truenasServers.push('https://');
    } else {
        proxmoxServers.push('https://');
    }
    renderServerList();
    saveServers();
}

// Update server URL by type
function updateServerUrlByType(type, index, url) {
    const servers = type === 'truenas' ? truenasServers : proxmoxServers;
    servers[index] = String(url || '').trim();
    saveServers();
}

// Set current server by type
function setCurrentServerByType(type, index) {
    if (type === 'truenas') {
        currentTrueNASServerIndex = index;
        saveSettingsToServer({ currentTrueNASServerIndex: index });
    } else {
        currentServerIndex = index;
        saveSettingsToServer({ currentServerIndex: index });
    }
    renderServerList();
    updateCurrentServerBadge();
    const servers = type === 'truenas' ? truenasServers : proxmoxServers;
    if (servers[index]) {
        showToast(`${t('currentServer')}: ${servers[index]}`, 'info');
        if (currentServerType === type) refreshData();
    }
}

// Remove server by type
function removeServerByType(type, index) {
    const servers = type === 'truenas' ? truenasServers : proxmoxServers;
    if (servers.length <= 1) {
        showToast(t('toastCannotRemoveLastServer'), 'warning');
        return;
    }
    servers.splice(index, 1);
    const currentIdx = type === 'truenas' ? currentTrueNASServerIndex : currentServerIndex;
    if (currentIdx >= servers.length) {
        if (type === 'truenas') {
            currentTrueNASServerIndex = servers.length - 1;
            saveSettingsToServer({ currentTrueNASServerIndex: currentTrueNASServerIndex });
        } else {
            currentServerIndex = servers.length - 1;
            saveSettingsToServer({ currentServerIndex: currentServerIndex });
        }
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
