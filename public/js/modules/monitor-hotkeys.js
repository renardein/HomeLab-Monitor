(function initMonitorHotkeysModule(global) {
    const ACTIONS = ['refreshData', 'reloadPage', 'home', 'closeBrowser'];
    const DEFAULT_HOTKEYS = [
        { combo: 'Meta+R', clicks: 1, action: 'refreshData', enabled: true },
        { combo: 'Meta+Shift+R', clicks: 1, action: 'reloadPage', enabled: true },
        { combo: 'Meta+H', clicks: 1, action: 'home', enabled: true }
    ];

    function normalizeCombo(raw) {
        const s = String(raw || '').trim();
        if (!s) return '';
        const parts = s.split('+').map((x) => String(x || '').trim()).filter(Boolean);
        const out = [];
        const lower = parts.map((x) => x.toLowerCase());
        if (lower.includes('meta') || lower.includes('super') || lower.includes('win') || lower.includes('windows')) out.push('Meta');
        if (lower.includes('ctrl') || lower.includes('control')) out.push('Ctrl');
        if (lower.includes('alt') || lower.includes('option')) out.push('Alt');
        if (lower.includes('shift')) out.push('Shift');
        let key = parts[parts.length - 1] || '';
        const keyLower = key.toLowerCase();
        if (['meta', 'super', 'win', 'windows', 'ctrl', 'control', 'alt', 'option', 'shift'].includes(keyLower)) key = '';
        if (key.length === 1) key = key.toUpperCase();
        if (key) out.push(key);
        return out.join('+');
    }

    function actionLabel(action, t) {
        if (action === 'refreshData') return t('monitorHotkeyActionRefreshData');
        if (action === 'reloadPage') return t('monitorHotkeyActionReloadPage');
        if (action === 'home') return t('monitorHotkeyActionHome');
        if (action === 'closeBrowser') return t('monitorHotkeyActionCloseBrowser');
        return action;
    }

    function normalizeHotkeys(raw) {
        const list = Array.isArray(raw) ? raw : DEFAULT_HOTKEYS;
        const out = [];
        for (const item of list) {
            if (!item || typeof item !== 'object') continue;
            const action = ACTIONS.includes(item.action) ? item.action : '';
            const combo = normalizeCombo(item.combo);
            const clicks = Math.max(1, Math.min(3, parseInt(item.clicks, 10) || 1));
            if (!action || !combo) continue;
            out.push({ combo, clicks, action, enabled: item.enabled !== false });
        }
        if (!out.length) return DEFAULT_HOTKEYS.map((x) => ({ ...x }));
        return out.slice(0, 6);
    }

    function executeAction(action, api) {
        if (action === 'refreshData') return api.refreshData();
        if (action === 'reloadPage') return api.reloadPage();
        if (action === 'home') return api.goHome();
        if (action === 'closeBrowser') return api.closeBrowser();
    }

    function createManager(deps) {
        const t = deps.t;
        const escapeHtml = deps.escapeHtml;
        const api = deps.api;
        let clickState = { combo: '', clicks: 0, timer: null };

        function queueCombo(combo, hotkeys) {
            const clickWindowMs = 450;
            const rows = normalizeHotkeys(hotkeys).filter((x) => x.enabled !== false && x.combo === combo);
            if (!rows.length) return false;
            if (clickState.timer) clearTimeout(clickState.timer);
            if (clickState.combo !== combo) {
                clickState.combo = combo;
                clickState.clicks = 1;
            } else {
                clickState.clicks = Math.min(3, clickState.clicks + 1);
            }
            if (clickState.clicks >= 3) {
                const rule3 = rows.find((x) => x.clicks === 3);
                if (rule3) {
                    executeAction(rule3.action, api);
                    clickState = { combo: '', clicks: 0, timer: null };
                    return true;
                }
            }
            clickState.timer = setTimeout(() => {
                const c = clickState.clicks;
                const rule = rows.find((x) => x.clicks === c) || rows.find((x) => x.clicks === 1 && c >= 1);
                if (rule) executeAction(rule.action, api);
                clickState = { combo: '', clicks: 0, timer: null };
            }, clickWindowMs);
            return true;
        }

        function captureComboFromKeydown(event) {
            const key = String(event.key || '').trim();
            if (!key) return '';
            const parts = [];
            if (event.metaKey) parts.push('Meta');
            if (event.ctrlKey) parts.push('Ctrl');
            if (event.altKey) parts.push('Alt');
            if (event.shiftKey) parts.push('Shift');
            if (!['Control', 'Shift', 'Alt', 'Meta'].includes(key)) {
                parts.push(key.length === 1 ? key.toUpperCase() : key);
            } else if (!parts.length) {
                if (key === 'Meta') parts.push('Meta');
                else if (key === 'Control') parts.push('Ctrl');
                else if (key === 'Alt') parts.push('Alt');
                else if (key === 'Shift') parts.push('Shift');
            }
            return normalizeCombo(parts.join('+'));
        }

        function renderSettingsUI(container, hotkeys, onChange) {
            const rows = normalizeHotkeys(hotkeys);
            const optionsByAction = ACTIONS
                .map((a) => `<option value="${a}">${escapeHtml(actionLabel(a, t))}</option>`)
                .join('');
            container.innerHTML = rows.map((row, idx) => {
                const options = optionsByAction.replace(`value="${row.action}"`, `value="${row.action}" selected`);
                return `<div class="row g-2 align-items-center mb-2">
                  <div class="col-md-4">
                    <input class="form-control monitor-hotkey-combo-input" data-idx="${idx}" value="${escapeHtml(row.combo)}" readonly>
                  </div>
                  <div class="col-md-2">
                    <select class="form-select monitor-hotkey-clicks-select" data-idx="${idx}">
                      <option value="1" ${row.clicks === 1 ? 'selected' : ''}>1x</option>
                      <option value="2" ${row.clicks === 2 ? 'selected' : ''}>2x</option>
                      <option value="3" ${row.clicks === 3 ? 'selected' : ''}>3x</option>
                    </select>
                  </div>
                  <div class="col-md-3">
                    <select class="form-select monitor-hotkey-action-select" data-idx="${idx}">${options}</select>
                  </div>
                  <div class="col-md-3 d-flex align-items-center gap-2">
                    <div class="form-check m-0">
                      <input class="form-check-input monitor-hotkey-enabled-chk" type="checkbox" data-idx="${idx}" ${row.enabled !== false ? 'checked' : ''}>
                    </div>
                    <button class="btn btn-outline-secondary btn-sm monitor-hotkey-clear-btn" type="button" data-idx="${idx}">${escapeHtml(t('monitorHotkeyClearBtn'))}</button>
                  </div>
                </div>`;
            }).join('');

            const next = rows.map((x) => ({ ...x }));
            function update(fn) {
                fn(next);
                onChange(next.map((x) => ({ ...x })));
            }

            container.querySelectorAll('.monitor-hotkey-combo-input').forEach((inp) => {
                inp.addEventListener('keydown', (e) => {
                    e.preventDefault();
                    const idx = parseInt(inp.dataset.idx, 10);
                    if (!Number.isFinite(idx) || idx < 0 || idx >= next.length) return;
                    const combo = captureComboFromKeydown(e);
                    if (!combo) return;
                    update((arr) => {
                        arr[idx].combo = combo;
                        inp.value = combo;
                    });
                });
            });
            container.querySelectorAll('.monitor-hotkey-action-select').forEach((sel) => {
                sel.addEventListener('change', () => {
                    const idx = parseInt(sel.dataset.idx, 10);
                    if (!Number.isFinite(idx) || idx < 0 || idx >= next.length) return;
                    const action = String(sel.value || '');
                    if (!ACTIONS.includes(action)) return;
                    update((arr) => { arr[idx].action = action; });
                });
            });
            container.querySelectorAll('.monitor-hotkey-clicks-select').forEach((sel) => {
                sel.addEventListener('change', () => {
                    const idx = parseInt(sel.dataset.idx, 10);
                    if (!Number.isFinite(idx) || idx < 0 || idx >= next.length) return;
                    const clicks = Math.max(1, Math.min(3, parseInt(sel.value, 10) || 1));
                    update((arr) => { arr[idx].clicks = clicks; });
                });
            });
            container.querySelectorAll('.monitor-hotkey-enabled-chk').forEach((chk) => {
                chk.addEventListener('change', () => {
                    const idx = parseInt(chk.dataset.idx, 10);
                    if (!Number.isFinite(idx) || idx < 0 || idx >= next.length) return;
                    update((arr) => { arr[idx].enabled = !!chk.checked; });
                });
            });
            container.querySelectorAll('.monitor-hotkey-clear-btn').forEach((btn) => {
                btn.addEventListener('click', () => {
                    const idx = parseInt(btn.dataset.idx, 10);
                    if (!Number.isFinite(idx) || idx < 0 || idx >= next.length) return;
                    update((arr) => {
                        arr[idx].combo = '';
                        const input = container.querySelector(`.monitor-hotkey-combo-input[data-idx="${idx}"]`);
                        if (input) input.value = '';
                    });
                });
            });
        }

        return {
            actions: ACTIONS.slice(),
            defaultHotkeys: DEFAULT_HOTKEYS.map((x) => ({ ...x })),
            normalizeCombo,
            normalizeHotkeys,
            actionLabel: (action) => actionLabel(action, t),
            captureComboFromKeydown,
            executeAction: (action) => executeAction(action, api),
            queueCombo,
            renderSettingsUI
        };
    }

    global.MonitorHotkeysModule = { createManager };
})(window);
