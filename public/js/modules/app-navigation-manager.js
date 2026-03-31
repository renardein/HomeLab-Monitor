(function initAppNavigationManagerModule(global) {
    function createManager(deps) {
        function startAutoRefresh() {
            const current = deps.getAutoRefreshInterval();
            if (current) clearInterval(current);
            const next = setInterval(() => deps.refreshData({ silent: true }), deps.getRefreshIntervalMs());
            deps.setAutoRefreshInterval(next);
        }

        function showDashboard() {
            const configSection = document.getElementById('configSection');
            const dashboardSection = document.getElementById('dashboardSection');
            if (configSection) configSection.style.display = 'none';
            if (dashboardSection) dashboardSection.style.display = 'block';

            const dashboardContent = document.getElementById('dashboardContent');
            const monitorView = document.getElementById('monitorView');
            if (dashboardContent) dashboardContent.style.display = 'block';
            if (monitorView) monitorView.style.display = 'none';

            const servicesSection = document.getElementById('servicesMonitorSection');
            const backupsMon = document.getElementById('backupsMonitorSection');
            const drawMonDash = document.getElementById('drawMonitorSection');
            const netdevMonSection = document.getElementById('netdevMonitorSection');
            if (servicesSection) servicesSection.style.display = 'none';
            if (backupsMon) backupsMon.style.display = 'none';
            if (drawMonDash) drawMonDash.style.display = 'none';
            if (netdevMonSection) netdevMonSection.style.display = 'none';

            requestAnimationFrame(() => deps.updateHomeLabFontScale());
            if (deps.hasAuth()) {
                deps.refreshData();
                startAutoRefresh();
            }
        }

        function goToAppHome() {
            const configSection = document.getElementById('configSection');
            if (configSection) configSection.style.display = 'none';
            if (deps.getMonitorMode()) {
                deps.applyMonitorView('cluster');
                deps.renderMonitorScreenDots();
                if (deps.hasAuth()) {
                    deps.refreshData();
                    startAutoRefresh();
                }
                return;
            }
            showDashboard();
        }

        return { startAutoRefresh, showDashboard, goToAppHome };
    }

    global.AppNavigationManagerModule = { createManager };
})(window);
