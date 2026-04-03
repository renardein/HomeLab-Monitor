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
            if (dashboardContent) dashboardContent.style.display = 'block';
            if (typeof deps.hideAllMonitorShellSections === 'function') {
                deps.hideAllMonitorShellSections();
            }

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
