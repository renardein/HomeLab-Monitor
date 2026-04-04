(function initMonitorViewRouterModule(global) {
    function createManager(deps) {
        function hideAllSections(elements) {
            Object.values(elements).forEach((node) => {
                if (node) node.style.display = 'none';
            });
        }

        function applyView(view, state) {
            const elements = {
                dashboardSection: document.getElementById('dashboardSection'),
                dashboardContent: document.getElementById('dashboardContent'),
                servicesMonSection: document.getElementById('servicesMonitorSection'),
                vmsMonSection: document.getElementById('vmsMonitorSection'),
                upsMonSection: document.getElementById('upsMonitorSection'),
                netdevMonSection: document.getElementById('netdevMonitorSection'),
                speedtestMonSection: document.getElementById('speedtestMonitorSection'),
                iperf3MonSection: document.getElementById('iperf3MonitorSection'),
                smartSensorsMonSection: document.getElementById('smartSensorsMonitorSection'),
                backupsMon: document.getElementById('backupsMonitorSection'),
                tilesMonSection: document.getElementById('tilesMonitorSection'),
                truenasPoolsMonSection: document.getElementById('truenasPoolsMonitorSection'),
                truenasDisksMonSection: document.getElementById('truenasDisksMonitorSection'),
                truenasServicesMonSection: document.getElementById('truenasServicesMonitorSection'),
                truenasAppsMonSection: document.getElementById('truenasAppsMonitorSection'),
                drawMonSection: document.getElementById('drawMonitorSection'),
                monitorView: document.getElementById('monitorView')
            };

            if (!state.monitorMode) {
                if (elements.dashboardSection) elements.dashboardSection.style.display = 'block';
                if (elements.dashboardContent) elements.dashboardContent.style.display = 'block';
                hideAllSections({
                    servicesMonSection: elements.servicesMonSection,
                    vmsMonSection: elements.vmsMonSection,
                    upsMonSection: elements.upsMonSection,
                    netdevMonSection: elements.netdevMonSection,
                    speedtestMonSection: elements.speedtestMonSection,
                    iperf3MonSection: elements.iperf3MonSection,
                    smartSensorsMonSection: elements.smartSensorsMonSection,
                    backupsMon: elements.backupsMon,
                    tilesMonSection: elements.tilesMonSection,
                    truenasPoolsMonSection: elements.truenasPoolsMonSection,
                    truenasDisksMonSection: elements.truenasDisksMonSection,
                    truenasServicesMonSection: elements.truenasServicesMonSection,
                    truenasAppsMonSection: elements.truenasAppsMonSection,
                    drawMonSection: elements.drawMonSection,
                    monitorView: elements.monitorView
                });
                return { redirectedTo: null };
            }

            if (elements.dashboardSection) elements.dashboardSection.style.display = 'none';
            if (elements.dashboardContent) elements.dashboardContent.style.display = 'none';
            hideAllSections({
                servicesMonSection: elements.servicesMonSection,
                vmsMonSection: elements.vmsMonSection,
                upsMonSection: elements.upsMonSection,
                netdevMonSection: elements.netdevMonSection,
                speedtestMonSection: elements.speedtestMonSection,
                iperf3MonSection: elements.iperf3MonSection,
                smartSensorsMonSection: elements.smartSensorsMonSection,
                backupsMon: elements.backupsMon,
                tilesMonSection: elements.tilesMonSection,
                truenasPoolsMonSection: elements.truenasPoolsMonSection,
                truenasDisksMonSection: elements.truenasDisksMonSection,
                truenasServicesMonSection: elements.truenasServicesMonSection,
                truenasAppsMonSection: elements.truenasAppsMonSection,
                drawMonSection: elements.drawMonSection,
                monitorView: elements.monitorView
            });

            if (view === 'backupRuns' && !state.hasProxmoxBackendAuth) {
                return { redirectedTo: 'cluster' };
            }

            if (view === 'cluster') {
                if (elements.dashboardSection) elements.dashboardSection.style.display = 'block';
                if (elements.dashboardContent) elements.dashboardContent.style.display = 'block';
                const myTabContent = document.getElementById('myTabContent');
                if (myTabContent) {
                    myTabContent.querySelectorAll('.tab-pane').forEach((pane) => pane.classList.remove('show', 'active'));
                    const nodesPane = document.getElementById('nodes');
                    if (nodesPane) nodesPane.classList.add('show', 'active');
                }
            } else if (view === 'services') {
                if (elements.servicesMonSection) elements.servicesMonSection.style.display = 'block';
                deps.renderMonitoredServices();
            } else if (view === 'vms') {
                if (elements.vmsMonSection) elements.vmsMonSection.style.display = 'block';
                deps.renderVmsMonitorCards();
            } else if (view === 'ups') {
                if (elements.upsMonSection) elements.upsMonSection.style.display = 'block';
                deps.updateUPSDashboard().catch(() => {});
            } else if (view === 'netdev') {
                if (elements.netdevMonSection) elements.netdevMonSection.style.display = 'block';
                deps.updateNetdevDashboard().catch(() => {});
            } else if (view === 'speedtest') {
                if (elements.speedtestMonSection) elements.speedtestMonSection.style.display = 'block';
                deps.updateSpeedtestDashboard().catch(() => {});
            } else if (view === 'iperf3') {
                if (elements.iperf3MonSection) elements.iperf3MonSection.style.display = 'block';
                deps.updateIperf3Dashboard().catch(() => {});
            } else if (view === 'smartSensors') {
                if (elements.smartSensorsMonSection) elements.smartSensorsMonSection.style.display = 'block';
                deps.updateSmartSensorsDashboard().catch(() => {});
            } else if (view === 'tiles') {
                if (elements.tilesMonSection) elements.tilesMonSection.style.display = 'block';
                const maybeRefresh = deps.refreshData ? deps.refreshData({ silent: true }) : Promise.resolve();
                Promise.resolve(maybeRefresh).then(() => deps.renderTilesMonitorScreen())
                    .then(() => {
                        // После display:block размеры контейнера часто 0×0 до reflow; resize + update перерисовывает Chart.js.
                        requestAnimationFrame(() => {
                            setTimeout(() => {
                                try { deps.resizeTilesCharts && deps.resizeTilesCharts(); } catch (_) {}
                                setTimeout(() => {
                                    try { deps.resizeTilesCharts && deps.resizeTilesCharts(); } catch (_) {}
                                }, 320);
                            }, 120);
                        });
                    })
                    .catch(() => {});
            } else if (view === 'truenasPools') {
                if (elements.truenasPoolsMonSection) {
                    const el = elements.truenasPoolsMonSection;
                    el.style.display = 'flex';
                    el.style.flexDirection = 'column';
                    el.style.minHeight = '0';
                }
                deps.renderTrueNASMonitorScreenTiles('truenasPoolsMonitorGrid', 'truenas_pool').catch(() => {});
            } else if (view === 'truenasDisks') {
                if (elements.truenasDisksMonSection) {
                    const el = elements.truenasDisksMonSection;
                    el.style.display = 'flex';
                    el.style.flexDirection = 'column';
                    el.style.minHeight = '0';
                }
                deps.renderTrueNASMonitorScreenTiles('truenasDisksMonitorGrid', 'truenas_disk').catch(() => {});
            } else if (view === 'truenasServices') {
                if (elements.truenasServicesMonSection) {
                    const el = elements.truenasServicesMonSection;
                    el.style.display = 'flex';
                    el.style.flexDirection = 'column';
                    el.style.minHeight = '0';
                }
                deps.renderTrueNASMonitorScreenTiles('truenasServicesMonitorGrid', 'truenas_service').catch(() => {});
            } else if (view === 'truenasApps') {
                if (elements.truenasAppsMonSection) {
                    const el = elements.truenasAppsMonSection;
                    el.style.display = 'flex';
                    el.style.flexDirection = 'column';
                    el.style.minHeight = '0';
                }
                deps.renderTrueNASMonitorScreenTiles('truenasAppsMonitorGrid', 'truenas_app').catch(() => {});
            } else if (view === 'backupRuns') {
                if (elements.backupsMon) elements.backupsMon.style.display = 'flex';
                deps.renderMonitorBackupRuns(state.lastBackupsDataForMonitor);
            } else if (view === 'draw') {
                if (elements.drawMonSection) elements.drawMonSection.style.display = 'flex';
                deps.initMonitorDrawScreen();
                requestAnimationFrame(() => deps.resizeMonitorDrawCanvas());
            }

            return { redirectedTo: null };
        }

        return { applyView };
    }

    global.MonitorViewRouterModule = { createManager };
})(window);
