(function initRefreshDataModule(global) {
    function createManager(deps) {
        let lastHeavyRenderAt = 0;
        const HEAVY_RENDER_THROTTLE_MS = 1200;

        async function refreshData(options = {}) {
            const silent = options === true ? true : !!options.silent;
            const skipTilesRender = options && typeof options === 'object' ? !!options.skipTilesRender : false;
            const visible = typeof deps.getIsPageVisible === 'function' ? !!deps.getIsPageVisible() : true;

            // Silent auto-refresh in background tab: skip expensive work entirely.
            if (silent && !visible) return;

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

                const proxmoxTask = (async () => {
                    if (!proxmoxHeaders) {
                        deps.setLastHostMetricsData(null);
                        return;
                    }
                    const [clusterRes, storageRes, backupsRes, hmRes] = await Promise.all([
                        fetch('/api/cluster/full', { headers: proxmoxHeaders }),
                        fetch('/api/storage', { headers: proxmoxHeaders }),
                        fetch('/api/backups/jobs', { headers: proxmoxHeaders }),
                        fetch('/api/host-metrics/current', { headers: proxmoxHeaders }).then(async (r) => {
                            if (!r || !r.ok) return null;
                            try {
                                return await r.json();
                            } catch {
                                return null;
                            }
                        }).catch(() => null)
                    ]);

                    const clusterData = await clusterRes.json();
                    const storageData = await storageRes.json();
                    const backupsData = await backupsRes.json();
                    const hmJson = hmRes;

                    if (!clusterRes.ok) throw new Error(clusterData?.error || `cluster: HTTP ${clusterRes.status}`);
                    if (!storageRes.ok) throw new Error(storageData?.error || `storage: HTTP ${storageRes.status}`);
                    if (!backupsRes.ok) throw new Error(backupsData?.error || `backups: HTTP ${backupsRes.status}`);

                    if (hmJson != null) deps.setLastHostMetricsData(hmJson);
                    const hostMetricsData = hmJson != null ? hmJson : deps.getLastHostMetricsData();

                    deps.updateDashboard(clusterData, storageData, backupsData, hostMetricsData);
                })();

                const truenasTask = (async () => {
                    if (!truenasHeaders) return;
                    const overviewRes = await fetch('/api/truenas/overview', { headers: truenasHeaders });
                    const overviewData = await overviewRes.json();
                    if (!overviewRes.ok) throw new Error(overviewData?.error || `overview: HTTP ${overviewRes.status}`);
                    deps.setLastTrueNASOverviewData(overviewData);
                    deps.updateTrueNASDashboard(
                        overviewData.system || {},
                        {
                            all: (overviewData.pools || []).map((p) => ({
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
                            })),
                            byType: {
                                pool: {
                                    count: (overviewData.pools || []).length,
                                    total: (overviewData.pools || []).reduce((s, x) => s + (x.total || 0), 0),
                                    used: (overviewData.pools || []).reduce((s, x) => s + (x.used || 0), 0)
                                }
                            },
                            summary: {
                                total: (overviewData.pools || []).length,
                                active: (overviewData.pools || []).filter((p) => p.healthy !== false).length,
                                total_space: (overviewData.pools || []).reduce((s, x) => s + (x.total || 0), 0),
                                used_space: (overviewData.pools || []).reduce((s, x) => s + (x.used || 0), 0)
                            }
                        },
                        overviewData
                    );
                })();

                const [proxmoxResult, truenasResult] = await Promise.allSettled([proxmoxTask, truenasTask]);
                const refreshErrors = [];
                if (proxmoxHeaders && proxmoxResult.status === 'rejected') {
                    const r = proxmoxResult.reason;
                    refreshErrors.push(r && r.message ? r.message : String(r));
                }
                if (truenasHeaders && truenasResult.status === 'rejected') {
                    const r = truenasResult.reason;
                    refreshErrors.push(r && r.message ? r.message : String(r));
                }
                if (refreshErrors.length && !silent) {
                    deps.showToast(deps.t('errorUpdate') + ': ' + refreshErrors.join(' · '), 'error');
                }

                const now = Date.now();
                const allowHeavyRender = !deps.getMonitorMode() || visible || (now - lastHeavyRenderAt >= HEAVY_RENDER_THROTTLE_MS);
                if (allowHeavyRender) {
                    await deps.renderClusterDashboardTiles();
                    lastHeavyRenderAt = now;
                }
                // На экране Tiles не обновляем превью в настройках (#tilesNormalGrid) — иначе каждый тик
                // автообновления удваивает fetch + Chart.js и перегружает главный поток.
                const onTilesMonitorScreen = deps.getMonitorMode() && deps.getMonitorCurrentView() === 'tiles';
                if (allowHeavyRender && !onTilesMonitorScreen) {
                    deps.renderTilesMonitorScreen('tilesNormalGrid').catch(() => {});
                }
                if (allowHeavyRender && !skipTilesRender && (!deps.getMonitorMode() || deps.getMonitorCurrentView() === 'tiles')) {
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

                if (!silent) {
                    requestAnimationFrame(() => {
                        window.scrollTo({ top: prevScrollY, left: 0, behavior: 'auto' });
                        if (prevActiveId) {
                            const a = document.getElementById(prevActiveId);
                            if (a && typeof a.focus === 'function') a.focus({ preventScroll: true });
                        }
                    });
                }
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
                if (!silent && !refreshErrors.length) deps.showToast(deps.t('dataUpdated'), 'success');
                if (allowHeavyRender) requestAnimationFrame(() => deps.updateHomeLabFontScale());
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
