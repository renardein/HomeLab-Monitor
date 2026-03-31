(function initConnectionManagerModule(global) {
    function createManager(deps) {
        async function connect(options = {}) {
            const skipDashboard = !!options.skipDashboard;
            const type = deps.getCurrentServerType();
            const tokenInput = type === 'truenas'
                ? document.getElementById('apiTokenTrueNAS')
                : document.getElementById('apiToken');
            if (type === 'proxmox') deps.syncProxmoxApiTokenFromParts();
            const rawToken = tokenInput ? tokenInput.value.trim() : '';
            const masked = rawToken.includes('•');
            const token = masked ? (deps.getApiToken() || '') : rawToken;
            const connId = deps.getCurrentConnectionId();
            const reuseExistingSecret = connId && (!rawToken || (masked && !deps.getApiToken()));

            if (!reuseExistingSecret && !token) {
                deps.showToast(deps.t('tokenRequired'), 'error');
                return false;
            }

            const connectBtnId = type === 'truenas' ? 'connectBtnTrueNAS' : 'connectBtnProxmox';
            const connectBtn = document.getElementById(connectBtnId);
            const originalText = connectBtn ? connectBtn.innerHTML : '';
            if (connectBtn) {
                connectBtn.disabled = true;
                connectBtn.innerHTML = '<span class="spinner-border spinner-border-sm me-2"></span>' + deps.t('loading');
            }

            const serverUrl = deps.getCurrentServerUrl();
            try {
                if (reuseExistingSecret) {
                    const testRes = await fetch(`/api/connections/${connId}/test`, { method: 'POST' });
                    const testData = await testRes.json().catch(() => ({}));
                    if (!testRes.ok || !testData.success) throw new Error(testData?.error || `HTTP ${testRes.status}`);
                    deps.showToast(deps.t('connectSuccess'), 'success');
                    const logoutContainerId = type === 'truenas' ? 'logoutContainerTrueNAS' : 'logoutContainerProxmox';
                    deps.setDisplay(logoutContainerId, 'block');
                    updateConnectionStatus(true, type);
                    if (!skipDashboard) deps.showDashboard();
                    return true;
                }

                const upsertRes = await fetch('/api/connections/upsert', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ type, url: serverUrl, secret: token })
                });
                const upsertData = await upsertRes.json();
                if (!upsertRes.ok || !upsertData?.success) throw new Error(upsertData?.error || `connections: HTTP ${upsertRes.status}`);
                deps.saveConnectionId(type, upsertData.connection.url, upsertData.connection.id);
                deps.setApiToken(null);

                const response = await fetch(type === 'truenas' ? '/api/truenas/auth/test' : '/api/auth/test', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify(type === 'truenas' ? { apiKey: token, serverUrl } : { token, serverUrl })
                });
                const data = await response.json();
                if (data.success) {
                    deps.showToast(deps.t('connectSuccess'), 'success');
                    const logoutContainerId = type === 'truenas' ? 'logoutContainerTrueNAS' : 'logoutContainerProxmox';
                    deps.setDisplay(logoutContainerId, 'block');
                    updateConnectionStatus(true, type);
                    if (!skipDashboard) deps.showDashboard();
                    return true;
                }
                deps.showToast(deps.t('connectError') + ': ' + data.error, 'error');
                updateConnectionStatus(false, type);
                return false;
            } catch (error) {
                deps.showToast(deps.t('connectError') + ': ' + error.message, 'error');
                updateConnectionStatus(false, type);
                return false;
            } finally {
                if (connectBtn) {
                    connectBtn.disabled = false;
                    connectBtn.innerHTML = originalText;
                }
            }
        }

        async function testConnection() {
            const type = deps.getCurrentServerType();
            const tokenInput = type === 'truenas'
                ? document.getElementById('apiTokenTrueNAS')
                : document.getElementById('apiToken');
            if (type === 'proxmox') deps.syncProxmoxApiTokenFromParts();
            const rawToken = tokenInput ? tokenInput.value.trim() : '';
            const masked = rawToken.includes('•');
            const token = masked ? (deps.getApiToken() || '') : rawToken;
            const connId = deps.getCurrentConnectionId();
            const reuseExistingSecret = connId && (!rawToken || (masked && !deps.getApiToken()));

            const testBtnId = type === 'truenas' ? 'testConnectionBtnTrueNAS' : 'testConnectionBtnProxmox';
            const testBtn = document.getElementById(testBtnId);
            const originalText = testBtn.innerHTML;
            testBtn.disabled = true;
            testBtn.innerHTML = '<span class="spinner-border spinner-border-sm me-2"></span>' + deps.t('loading');

            const serverUrl = deps.getCurrentServerUrl();
            try {
                if (reuseExistingSecret) {
                    const testRes = await fetch(`/api/connections/${connId}/test`, { method: 'POST' });
                    const testData = await testRes.json();
                    if (testRes.ok && testData.success) {
                        deps.showToast(deps.t('connectionStatusConnected'), 'success');
                        updateConnectionStatus(true, type);
                        return;
                    }
                    deps.showToast(deps.t('connectionStatusDisconnected') + ': ' + (testData.error || `HTTP ${testRes.status}`), 'error');
                    updateConnectionStatus(false, type);
                    return;
                }

                if (!token) {
                    deps.showToast(deps.t('tokenRequired'), 'warning');
                    updateConnectionStatus(false, type);
                    return;
                }

                const response = await fetch(type === 'truenas' ? '/api/truenas/auth/test' : '/api/auth/test', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify(type === 'truenas' ? { apiKey: token, serverUrl } : { token, serverUrl })
                });
                const data = await response.json();
                if (data.success) {
                    deps.showToast(deps.t('connectionStatusConnected'), 'success');
                    updateConnectionStatus(true, type);
                } else {
                    deps.showToast(deps.t('connectionStatusDisconnected') + ': ' + data.error, 'error');
                    updateConnectionStatus(false, type);
                }
            } catch (error) {
                deps.showToast(deps.t('connectionStatusDisconnected') + ': ' + error.message, 'error');
                updateConnectionStatus(false, type);
            } finally {
                testBtn.disabled = false;
                testBtn.innerHTML = originalText;
            }
        }

        function updateConnectionStatus(connected, type) {
            const suffix = (type || deps.getCurrentServerType()) === 'truenas' ? 'TrueNAS' : 'Proxmox';
            const statusDisplay = document.getElementById('connectionStatusDisplay' + suffix);
            const statusBadge = document.getElementById('connectionStatusBadge' + suffix);
            const statusText = document.getElementById('connectionStatusText' + suffix);
            if (!statusDisplay || !statusBadge || !statusText) return;
            statusDisplay.style.display = 'block';
            if (connected) {
                statusBadge.className = 'badge bg-success';
                statusText.textContent = deps.t('connectionStatusConnected');
            } else {
                statusBadge.className = 'badge bg-danger';
                statusText.textContent = deps.t('connectionStatusDisconnected');
            }
        }

        return { connect, testConnection, updateConnectionStatus };
    }

    global.ConnectionManagerModule = { createManager };
})(window);
