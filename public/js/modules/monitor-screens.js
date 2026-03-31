(function initMonitorScreensModule(global) {
    function createManager(deps) {
        const ids = deps.screenIds.slice();
        const t = deps.t;
        const escapeHtml = deps.escapeHtml;

        function normalizeOrder(arr) {
            const valid = new Set(ids);
            if (!Array.isArray(arr)) return ids.slice();
            const seen = new Set();
            const out = [];
            for (const x of arr) {
                const id = String(x || '').trim();
                if (valid.has(id) && !seen.has(id)) {
                    seen.add(id);
                    out.push(id);
                }
            }
            for (const id of ids) {
                if (!seen.has(id)) out.push(id);
            }
            return out;
        }

        function normalizeEnabled(raw) {
            const out = {};
            for (const id of ids) out[id] = true;
            if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return out;
            for (const id of ids) {
                if (Object.prototype.hasOwnProperty.call(raw, id)) out[id] = raw[id] !== false;
            }
            return out;
        }

        function label(id) {
            const map = {
                cluster: t('monitorScreenCluster'),
                tiles: 'Tiles',
                truenasPools: t('monitorScreenTruenasPools'),
                truenasDisks: t('monitorScreenTruenasDisks'),
                truenasServices: t('monitorScreenTruenasServices'),
                truenasApps: t('monitorScreenTruenasApps'),
                ups: t('monitorScreenUps'),
                netdev: t('monitorScreenNetdev'),
                speedtest: t('monitorScreenSpeedtest'),
                iperf3: t('monitorScreenIperf3'),
                smartSensors: t('monitorScreenSmartSensors'),
                vms: t('monitorScreenVms'),
                services: t('monitorScreenServices'),
                backupRuns: t('monitorScreenBackupRuns'),
                draw: t('monitorScreenDraw')
            };
            return map[id] || id;
        }

        function getViewsOrder(state) {
            const order = normalizeOrder(state.order);
            return order.filter((id) => {
                if (state.enabled[id] === false) return false;
                if (id === 'backupRuns' && state.currentServerType !== 'proxmox') return false;
                if (id === 'speedtest' && !state.speedtestClientEnabled) return false;
                if (id === 'iperf3' && !state.iperf3ClientEnabled) return false;
                if (id === 'ups' && state.availability.ups === false) return false;
                if (id === 'netdev' && state.availability.netdev === false) return false;
                if (id === 'speedtest' && state.availability.speedtest === false) return false;
                if (id === 'iperf3' && state.availability.iperf3 === false) return false;
                if (id === 'smartSensors' && state.availability.smartSensors === false) return false;
                return true;
            });
        }

        function renderSettingsOrderList(ul, state) {
            const order = normalizeOrder(state.order);
            ul.innerHTML = order.map((id, i) => `<li class="list-group-item d-flex align-items-center justify-content-between gap-2 py-2">
      <span class="text-truncate"><i class="bi bi-display me-2 text-muted"></i>${escapeHtml(label(id))}</span>
      <span class="d-flex align-items-center gap-2">
        <span class="form-check form-switch m-0">
          <input class="form-check-input monitor-screen-enable-input" type="checkbox" data-id="${escapeHtml(id)}" ${state.enabled[id] !== false ? 'checked' : ''}>
        </span>
      <span class="btn-group btn-group-sm flex-shrink-0" role="group">
        <button type="button" class="btn btn-outline-secondary monitor-screen-up-btn" ${i === 0 ? 'disabled' : ''} data-index="${i}" aria-label="Up"><i class="bi bi-arrow-up"></i></button>
        <button type="button" class="btn btn-outline-secondary monitor-screen-down-btn" ${i === order.length - 1 ? 'disabled' : ''} data-index="${i}" aria-label="Down"><i class="bi bi-arrow-down"></i></button>
      </span>
      </span>
    </li>`).join('');
            return order;
        }

        function renderDots(dotsEl, state) {
            if (!state.monitorMode) {
                dotsEl.innerHTML = '';
                dotsEl.style.display = 'none';
                return;
            }
            let views = state.views;
            if (!views.length) views = ['cluster'];
            dotsEl.style.display = 'flex';
            dotsEl.innerHTML = views.map((viewId) => {
                const isActive = viewId === state.currentView;
                const viewLabel = label(viewId);
                return `<button
                type="button"
                class="monitor-toolbar-dot${isActive ? ' is-active' : ''}"
                onclick="applyMonitorView('${escapeHtml(viewId)}')"
                title="${escapeHtml(viewLabel)}"
                aria-label="${escapeHtml(viewLabel)}"
            ></button>`;
            }).join('');
        }

        function moveOrder(order, index, delta) {
            const arr = normalizeOrder(order);
            const j = index + delta;
            if (j < 0 || j >= arr.length) return arr;
            const next = arr.slice();
            const t0 = next[index];
            next[index] = next[j];
            next[j] = t0;
            return next;
        }

        function toggleEnabled(enabled, id, value) {
            return normalizeEnabled({ ...(enabled || {}), [id]: !!value });
        }

        return {
            normalizeOrder,
            normalizeEnabled,
            label,
            getViewsOrder,
            renderSettingsOrderList,
            renderDots,
            moveOrder,
            toggleEnabled
        };
    }

    global.MonitorScreensModule = { createManager };
})(window);
