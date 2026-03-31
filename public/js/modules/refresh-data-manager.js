(function initRefreshDataModule(global) {
    function createManager(deps) {
        async function refreshData(options = {}) {
            const silent = options === true ? true : !!options.silent;

            if (deps.getIsRefreshing()) return;
            deps.setIsRefreshing(true);
            const proxmoxHeaders = deps.getAuthHeadersForType('proxmox');
            const truenasHeaders = deps.getAuthHeadersForType('truenas');
            if (!proxmoxHeaders && !truenasHeaders) {
                if (!silent) deps.showToast(deps.t('errorNoToken'), 'error');
                deps.setIsRefreshing(false);
                return;
            }

            if (!silent) deps.showLoading(true);

            try {
                const prevScrollY = window.scrollY;
                const prevActiveId = document.activeElement && document.activeElement.id ? document.activeElement.id : null;

                if (proxmoxHeaders) {
                    const [clusterRes, storageRes, backupsRes] = await Promise.all([
                        fetch('/api/cluster/full', { headers: proxmoxHeaders }),
                        fetch('/api/storage', { headers: proxmoxHeaders }),
                        fetch('/api/backups/jobs', { headers: proxmoxHeaders })
                    ]);

                    const clusterData = await clusterRes.json();
                    const storageData = await storageRes.json();
                    const backupsData = await backupsRes.json();
                    let hostMetricsData = deps.getLastHostMetricsData();

                    if (!clusterRes.ok) throw new Error(clusterData?.error || `cluster: HTTP ${clusterRes.status}`);
                    if (!storageRes.ok) throw new Error(storageData?.error || `storage: HTTP ${storageRes.status}`);
                    if (!backupsRes.ok) throw new Error(backupsData?.error || `backups: HTTP ${backupsRes.status}`);

                    try {
                        const hmRes = await fetch('/api/host-metrics/current', { headers: proxmoxHeaders });
                        if (hmRes.ok) {
                            hostMetricsData = await hmRes.json();
                            deps.setLastHostMetricsData(hostMetricsData);
                        }
                    } catch (hmErr) {
                        console.warn('Host metrics refresh failed:', hmErr);
                    }

                    if (deps.getCurrentServerType() !== 'truenas') {
                        deps.updateDashboard(clusterData, storageData, backupsData, hostMetricsData);
                    }
                } else {
                    deps.setLastHostMetricsData(null);
                }

                if (truenasHeaders) {
                    const overviewRes = await fetch('/api/truenas/overview', { headers: truenasHeaders });
                    const overviewData = await overviewRes.json();
                    if (!overviewRes.ok) throw new Error(overviewData?.error || `overview: HTTP ${overviewRes.status}`);
                    deps.setLastTrueNASOverviewData(overviewData);
                    if (deps.getCurrentServerType() === 'truenas') {
                        deps.updateTrueNASDashboard(overviewData.system || {}, { all: (overviewData.pools || []).map((p) => ({
                            node: 'truenas',
                            name: p.name,
                            type: 'pool',
                            used: p.used || 0,
                            total: p.total || 0,
                            used_fmt: p.used || 0,
                            total_fmt: p.total || 0,
                            usage_percent: p.total > 0 ? Math.round(((p.used || 0) / p.total) * 100) : 0,
                            active: p.healthy !== false,
                            status: p.status || null
                        })), byType: { pool: { count: (overviewData.pools || []).length, total: (overviewData.pools || []).reduce((s, x) => s + (x.total || 0), 0), used: (overviewData.pools || []).reduce((s, x) => s + (x.used || 0), 0) } }, summary: { total: (overviewData.pools || []).length, active: (overviewData.pools || []).filter((p) => p.healthy !== false).length, total_space: (overviewData.pools || []).reduce((s, x) => s + (x.total || 0), 0), used_space: (overviewData.pools || []).reduce((s, x) => s + (x.used || 0), 0) } }, overviewData);
                    }
                }

                await deps.renderClusterDashboardTiles();
                deps.renderTilesMonitorScreen('tilesNormalGrid').catch(() => {});
                if (!deps.getMonitorMode() || deps.getMonitorCurrentView() === 'tiles') {
                    deps.renderTilesMonitorScreen().catch(() => {});
                }
                if (deps.getMonitorMode() && deps.getMonitorCurrentView() === 'truenasPools') {
                    deps.renderTrueNASMonitorScreenTiles('truenasPoolsMonitorGrid', 'truenas_pool').catch(() => {});
                }
                if (deps.getMonitorMode() && deps.getMonitorCurrentView() === 'truenasDisks') {
                    deps.renderTrueNASMonitorScreenTiles('truenasDisksMonitorGrid', 'truenas_disk').catch(() => {});
                }
                if (deps.getMonitorMode() && deps.getMonitorCurrentView() === 'truenasServices') {
                    deps.renderTrueNASMonitorScreenTiles('truenasServicesMonitorGrid', 'truenas_service').catch(() => {});
                }
                if (deps.getMonitorMode() && deps.getMonitorCurrentView() === 'truenasApps') {
                    deps.renderTrueNASMonitorScreenTiles('truenasAppsMonitorGrid', 'truenas_app').catch(() => {});
                }
                if (!deps.getMonitorMode() || deps.getMonitorCurrentView() === 'cluster' || deps.getMonitorCurrentView() === 'ups') {
                    deps.updateUPSDashboard().catch(() => {});
                }
                if (!deps.getMonitorMode() || deps.getMonitorCurrentView() === 'cluster' || deps.getMonitorCurrentView() === 'netdev') {
                    deps.updateNetdevDashboard().catch(() => {});
                }
                if (!deps.getMonitorMode() || deps.getMonitorCurrentView() === 'cluster' || deps.getMonitorCurrentView() === 'speedtest') {
                    deps.updateSpeedtestDashboard().catch(() => {});
                }
                if (!deps.getMonitorMode() || deps.getMonitorCurrentView() === 'cluster' || deps.getMonitorCurrentView() === 'iperf3') {
                    deps.updateIperf3Dashboard().catch(() => {});
                }
                if (!deps.getMonitorMode() || deps.getMonitorCurrentView() === 'cluster' || deps.getMonitorCurrentView() === 'smartSensors') {
                    deps.updateSmartSensorsDashboard().catch(() => {});
                }

                requestAnimationFrame(() => {
                    window.scrollTo({ top: prevScrollY, left: 0, behavior: 'auto' });
                    if (prevActiveId) {
                        const a = document.getElementById(prevActiveId);
                        if (a && typeof a.focus === 'function') a.focus({ preventScroll: true });
                    }
                });
                deps.setLastRefreshTime(Date.now());
                if (deps.getMonitorMode()) {
                    const toolbarEl = document.getElementById('monitorToolbarUpdate');
                    if (toolbarEl) {
                        const now = new Date();
                        const timeStr = now.getHours().toString().padStart(2, '0') + ':' + now.getMinutes().toString().padStart(2, '0');
                        toolbarEl.textContent = deps.t('lastUpdated') + ' ' + timeStr;
                    }
                    deps.checkAllServices().then(() => {
                        deps.renderMonitorServicesList();
                        deps.renderClusterDashboardTiles().catch(() => {});
                    });
                }
                if (!silent) deps.showToast(deps.t('dataUpdated'), 'success');
                requestAnimationFrame(() => deps.updateHomeLabFontScale());

            } catch (error) {
                if (!silent) deps.showToast(deps.t('errorUpdate') + ': ' + error.message, 'error');
            } finally {
                if (!silent) deps.showLoading(false);
                deps.setIsRefreshing(false);
            }
        }

        return { refreshData };
    }

    global.RefreshDataModule = { createManager };
})(typeof window !== 'undefined' ? window : globalThis);
