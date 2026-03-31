(function initCustomThemeManagerModule(global) {
    function createManager(deps) {
        const CUSTOM_THEME_STYLE_DEFAULTS = {
            normal: {
                light: {
                    cardBg: '#ffffff', cardTextColor: '#2d3748', cardHeaderFrom: '#667eea', cardHeaderTo: '#764ba2', cardHeaderTextColor: '#ffffff',
                    statValueColor: '#333333', statLabelColor: '#666666', statCardBg: '#ffffff', nodeCardBg: '#ffffff', nodeCardTextColor: '#2d3748',
                    tableHeaderBg: '#f8f9fa', tableHeaderTextColor: '#2d3748', tableCellTextColor: '#2d3748', tableBorderColor: 'rgba(0,0,0,0.125)',
                    tableHoverTdBg: 'rgba(0,0,0,0.03)', progressBg: '#e2e8f0', monitorViewCardBg: 'rgba(255, 255, 255, 0.95)'
                },
                dark: {
                    cardBg: '#1e1e1e', cardTextColor: '#ffffff', cardHeaderFrom: '#2a3f5c', cardHeaderTo: '#4a3478', cardHeaderTextColor: '#ffffff',
                    statValueColor: '#ffffff', statLabelColor: '#9e9e9e', statCardBg: '#1e1e1e', nodeCardBg: '#1c1c1c', nodeCardTextColor: '#e8e8e8',
                    tableHeaderBg: '#2a3f5c', tableHeaderTextColor: '#ffffff', tableCellTextColor: '#e8e8e8', tableBorderColor: 'rgba(255,255,255,0.09)',
                    tableHoverTdBg: 'rgba(66, 165, 245, 0.08)', progressBg: 'rgba(255,255,255,0.08)', monitorViewCardBg: 'rgba(0,0,0,0)'
                }
            },
            monitor: {
                light: {
                    cardBg: '#ffffff', cardTextColor: '#2d3748', cardHeaderFrom: '#edf2f7', cardHeaderTo: '#e2e8f0', cardHeaderTextColor: '#2d3748',
                    statValueColor: '#2d3748', statLabelColor: '#4a5568', statCardBg: '#ffffff', nodeCardBg: '#ffffff', nodeCardTextColor: '#2d3748',
                    tableHeaderBg: '#edf2f7', tableHeaderTextColor: '#2d3748', tableCellTextColor: '#2d3748', tableBorderColor: '#e2e8f0',
                    tableHoverTdBg: 'rgba(0,0,0,0.03)', progressBg: '#e2e8f0', monitorViewCardBg: 'rgba(255, 255, 255, 0.95)'
                },
                dark: {
                    cardBg: '#1e1e1e', cardTextColor: '#ffffff', cardHeaderFrom: '#2a3f5c', cardHeaderTo: '#4a3478', cardHeaderTextColor: '#ffffff',
                    statValueColor: '#ffffff', statLabelColor: '#9e9e9e', statCardBg: '#1e1e1e', nodeCardBg: '#1c1c1c', nodeCardTextColor: '#e8e8e8',
                    tableHeaderBg: '#2a3f5c', tableHeaderTextColor: '#ffffff', tableCellTextColor: '#e8e8e8', tableBorderColor: 'rgba(255,255,255,0.09)',
                    tableHoverTdBg: 'rgba(66, 165, 245, 0.08)', progressBg: 'rgba(255,255,255,0.08)', monitorViewCardBg: '#1c1c1c'
                }
            }
        };

        function ensureStyleEl() {
            let styleEl = document.getElementById(deps.styleElId);
            if (!styleEl) {
                styleEl = document.createElement('style');
                styleEl.id = deps.styleElId;
                document.head.appendChild(styleEl);
            }
            return styleEl;
        }

        function normalizeCssInput(input) {
            const base = { normal: { light: '', dark: '' }, monitor: { light: '', dark: '' } };
            if (!input || typeof input !== 'object') return base;
            const nested = input.normal || input.monitor ? input : null;
            const flat = !nested ? input : null;
            const normalSource = nested ? nested.normal : input.normal;
            const monitorSource = nested ? nested.monitor : input.monitor;
            const getStr = (obj, key) => (obj && typeof obj[key] === 'string') ? obj[key] : '';
            if (flat) {
                return {
                    normal: { light: typeof input.normalLight === 'string' ? input.normalLight : '', dark: typeof input.normalDark === 'string' ? input.normalDark : '' },
                    monitor: { light: typeof input.monitorLight === 'string' ? input.monitorLight : '', dark: typeof input.monitorDark === 'string' ? input.monitorDark : '' }
                };
            }
            return {
                normal: { light: getStr(normalSource, 'light'), dark: getStr(normalSource, 'dark') },
                monitor: { light: getStr(monitorSource, 'light'), dark: getStr(monitorSource, 'dark') }
            };
        }

        function variantScope(variantKey) {
            if (variantKey === 'normalLight') return 'body:not(.dark-mode):not(.monitor-mode)';
            if (variantKey === 'normalDark') return 'body.dark-mode:not(.monitor-mode)';
            if (variantKey === 'monitorLight') return 'body.monitor-mode:not(.monitor-theme-dark)';
            if (variantKey === 'monitorDark') return 'body.monitor-mode.monitor-theme-dark';
            return '';
        }

        function expandSnippet(snippet, scope) {
            const s = String(snippet ?? '').trim();
            if (!s) return '';
            const scopeReplaced = s.replaceAll('{{SCOPE}}', scope).replaceAll('{{scope}}', scope);
            const t = scopeReplaced.trim();
            if (!t) return '';
            if (t.startsWith('@')) return t;
            if (t.includes(scope) || s.includes('{{SCOPE}}') || s.includes('{{scope}}')) return t;
            return scope + ' ' + t;
        }

        function applyCss() {
            const styleEl = ensureStyleEl();
            const normalized = normalizeCssInput(deps.getCustomThemeCss());
            const variants = [
                { scope: variantScope('normalLight'), css: normalized.normal.light },
                { scope: variantScope('normalDark'), css: normalized.normal.dark },
                { scope: variantScope('monitorLight'), css: normalized.monitor.light },
                { scope: variantScope('monitorDark'), css: normalized.monitor.dark }
            ];
            styleEl.textContent = variants.map((v) => expandSnippet(v.css, v.scope)).filter(Boolean).join('\n\n');
        }

        function normalizeStyleSettingsInput(input) {
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

        function buildCssSnippet(styleVariant) {
            const s = styleVariant || {};
            const safe = (v) => (v == null ? '' : String(v));
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

        function applyStyleSettings() {
            const settings = deps.getCustomThemeStyleSettings();
            if (settings == null) {
                deps.setCustomThemeCss({ normal: { light: '', dark: '' }, monitor: { light: '', dark: '' } });
                applyCss();
                return;
            }
            const normalized = normalizeStyleSettingsInput(settings);
            if (!normalized) {
                deps.setCustomThemeStyleSettings(null);
                applyStyleSettings();
                return;
            }
            deps.setCustomThemeCss({
                normal: { light: buildCssSnippet(normalized.normal.light), dark: buildCssSnippet(normalized.normal.dark) },
                monitor: { light: buildCssSnippet(normalized.monitor.light), dark: buildCssSnippet(normalized.monitor.dark) }
            });
            applyCss();
            syncStyleSettingsUI();
        }

        function styleVariantDefaults(variantKey) {
            if (variantKey === 'normalLight') return CUSTOM_THEME_STYLE_DEFAULTS.normal.light;
            if (variantKey === 'normalDark') return CUSTOM_THEME_STYLE_DEFAULTS.normal.dark;
            if (variantKey === 'monitorLight') return CUSTOM_THEME_STYLE_DEFAULTS.monitor.light;
            if (variantKey === 'monitorDark') return CUSTOM_THEME_STYLE_DEFAULTS.monitor.dark;
            return CUSTOM_THEME_STYLE_DEFAULTS.normal.light;
        }

        function styleVariantFromSelect() {
            const sel = document.getElementById('customThemeVariantSelect');
            return sel ? String(sel.value || 'normalLight') : 'normalLight';
        }

        function readStyleVariantInputs() {
            const read = (id) => {
                const input = document.getElementById(id);
                return input ? String(input.value ?? '').trim() : '';
            };
            return {
                cardBg: read('customThemeStyleCardBg'), cardTextColor: read('customThemeStyleCardTextColor'), cardHeaderFrom: read('customThemeStyleCardHeaderFrom'),
                cardHeaderTo: read('customThemeStyleCardHeaderTo'), cardHeaderTextColor: read('customThemeStyleCardHeaderTextColor'), statValueColor: read('customThemeStyleStatValueColor'),
                statLabelColor: read('customThemeStyleStatLabelColor'), tableHeaderBg: read('customThemeStyleTableHeaderBg'), tableHeaderTextColor: read('customThemeStyleTableHeaderTextColor'),
                tableCellTextColor: read('customThemeStyleTableCellTextColor'), tableBorderColor: read('customThemeStyleTableBorderColor'), tableHoverTdBg: read('customThemeStyleTableHoverTdBg'),
                progressBg: read('customThemeStyleProgressBg'), monitorViewCardBg: read('customThemeStyleMonitorViewCardBg')
            };
        }

        function applyStyleVariantToInputs(variantKey) {
            const defaults = styleVariantDefaults(variantKey);
            const settings = deps.getCustomThemeStyleSettings();
            const stored = (() => {
                if (settings == null) return null;
                if (variantKey === 'normalLight') return settings?.normal?.light ?? null;
                if (variantKey === 'normalDark') return settings?.normal?.dark ?? null;
                if (variantKey === 'monitorLight') return settings?.monitor?.light ?? null;
                if (variantKey === 'monitorDark') return settings?.monitor?.dark ?? null;
                return null;
            })();
            const s = stored || defaults;
            const set = (id, val) => {
                const input = document.getElementById(id);
                if (input) input.value = String(val ?? '');
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

        function syncStyleSettingsUI() {
            applyStyleVariantToInputs(styleVariantFromSelect());
        }

        function syncCssEditorUI() {
            const textarea = document.getElementById('customThemeCssEditor');
            if (!textarea) return;
            const normalized = normalizeCssInput(deps.getCustomThemeCss());
            const variant = styleVariantFromSelect();
            if (variant === 'normalLight') textarea.value = normalized.normal.light || '';
            else if (variant === 'normalDark') textarea.value = normalized.normal.dark || '';
            else if (variant === 'monitorLight') textarea.value = normalized.monitor.light || '';
            else if (variant === 'monitorDark') textarea.value = normalized.monitor.dark || '';
        }

        async function saveStyleSettingsVariant() {
            const variantKey = styleVariantFromSelect();
            const values = readStyleVariantInputs();
            const normalized = normalizeStyleSettingsInput(deps.getCustomThemeStyleSettings() || {});
            if (!normalized) return;
            if (variantKey === 'normalLight') normalized.normal.light = { ...styleVariantDefaults('normalLight'), ...normalized.normal.light, ...values };
            else if (variantKey === 'normalDark') normalized.normal.dark = { ...styleVariantDefaults('normalDark'), ...normalized.normal.dark, ...values };
            else if (variantKey === 'monitorLight') normalized.monitor.light = { ...styleVariantDefaults('monitorLight'), ...normalized.monitor.light, ...values };
            else if (variantKey === 'monitorDark') normalized.monitor.dark = { ...styleVariantDefaults('monitorDark'), ...normalized.monitor.dark, ...values };
            deps.setCustomThemeStyleSettings(normalized);
            applyStyleSettings();
            deps.saveSettingsToServer({ customThemeStyleSettings: normalized });
            deps.showToast('Стили сохранены', 'success');
        }

        async function resetStyleSettingsVariant() {
            const variantKey = styleVariantFromSelect();
            const defaults = styleVariantDefaults(variantKey);
            const normalized = normalizeStyleSettingsInput(deps.getCustomThemeStyleSettings() || {});
            if (!normalized) return;
            if (variantKey === 'normalLight') normalized.normal.light = defaults;
            else if (variantKey === 'normalDark') normalized.normal.dark = defaults;
            else if (variantKey === 'monitorLight') normalized.monitor.light = defaults;
            else if (variantKey === 'monitorDark') normalized.monitor.dark = defaults;
            deps.setCustomThemeStyleSettings(normalized);
            applyStyleSettings();
            deps.saveSettingsToServer({ customThemeStyleSettings: normalized });
            syncStyleSettingsUI();
            deps.showToast('Вариант сброшен к значениям по умолчанию', 'info');
        }

        async function unloadStyleSettingsAll() {
            deps.setCustomThemeStyleSettings(null);
            applyStyleSettings();
            deps.saveSettingsToServer({ customThemeStyleSettings: null, customThemeCss: { normal: { light: '', dark: '' }, monitor: { light: '', dark: '' } } });
            syncStyleSettingsUI();
            deps.showToast('Кастомные стили отключены', 'info');
        }

        function exportStyleSettings() {
            const data = { exportedAt: new Date().toISOString(), type: 'customThemeStyleSettings', version: 1, customThemeStyleSettings: deps.getCustomThemeStyleSettings() };
            const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
            const a = document.createElement('a');
            a.href = URL.createObjectURL(blob);
            a.download = 'custom-theme-style-settings-' + new Date().toISOString().slice(0, 10) + '.json';
            a.click();
            URL.revokeObjectURL(a.href);
            deps.showToast('Экспорт готов', 'success');
        }

        async function importStyleSettingsFromFile(file) {
            if (!file) return;
            const text = await file.text();
            let parsed = null;
            try { parsed = JSON.parse(text); } catch (_) { deps.showToast('Невалидный JSON', 'error'); return; }
            const incoming = parsed?.customThemeStyleSettings ?? parsed;
            const normalized = normalizeStyleSettingsInput(incoming);
            if (!normalized) {
                deps.setCustomThemeStyleSettings(null);
                applyStyleSettings();
                deps.saveSettingsToServer({ customThemeStyleSettings: null });
                deps.showToast('Импорт: стили отключены', 'info');
                return;
            }
            deps.setCustomThemeStyleSettings(normalized);
            applyStyleSettings();
            syncStyleSettingsUI();
            await deps.saveSettingsToServer({ customThemeStyleSettings: normalized });
            deps.showToast('Импорт стилей выполнен', 'success');
        }

        async function saveCssVariant() {
            const variant = styleVariantFromSelect();
            const textarea = document.getElementById('customThemeCssEditor');
            if (!textarea) return;
            const value = String(textarea.value ?? '');
            const normalized = normalizeCssInput(deps.getCustomThemeCss());
            if (variant === 'normalLight') normalized.normal.light = value;
            else if (variant === 'normalDark') normalized.normal.dark = value;
            else if (variant === 'monitorLight') normalized.monitor.light = value;
            else if (variant === 'monitorDark') normalized.monitor.dark = value;
            deps.setCustomThemeCss(normalized);
            applyCss();
            deps.saveSettingsToServer({ customThemeCss: normalized });
            deps.showToast('Стили сохранены', 'success');
        }

        async function clearCssVariant() {
            const variant = styleVariantFromSelect();
            const textarea = document.getElementById('customThemeCssEditor');
            if (!textarea) return;
            const normalized = normalizeCssInput(deps.getCustomThemeCss());
            if (variant === 'normalLight') normalized.normal.light = '';
            else if (variant === 'normalDark') normalized.normal.dark = '';
            else if (variant === 'monitorLight') normalized.monitor.light = '';
            else if (variant === 'monitorDark') normalized.monitor.dark = '';
            deps.setCustomThemeCss(normalized);
            textarea.value = '';
            applyCss();
            deps.saveSettingsToServer({ customThemeCss: normalized });
            deps.showToast('Стили этого варианта удалены', 'info');
        }

        async function unloadCssAll() {
            const normalized = { normal: { light: '', dark: '' }, monitor: { light: '', dark: '' } };
            deps.setCustomThemeCss(normalized);
            const textarea = document.getElementById('customThemeCssEditor');
            if (textarea) textarea.value = '';
            applyCss();
            deps.saveSettingsToServer({ customThemeCss: normalized });
            deps.showToast('Пользовательские стили удалены', 'info');
        }

        function exportCss() {
            const normalized = normalizeCssInput(deps.getCustomThemeCss());
            const data = { exportedAt: new Date().toISOString(), type: 'customThemeCss', version: 1, customThemeCss: normalized };
            const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
            const a = document.createElement('a');
            a.href = URL.createObjectURL(blob);
            a.download = 'custom-theme-css-' + new Date().toISOString().slice(0, 10) + '.json';
            a.click();
            URL.revokeObjectURL(a.href);
            deps.showToast('Экспорт готов', 'success');
        }

        async function importCssFromFile(file) {
            if (!file) return;
            const text = await file.text();
            let parsed = null;
            try { parsed = JSON.parse(text); } catch (_) { deps.showToast('Невалидный JSON файла', 'error'); return; }
            const incoming = parsed?.customThemeCss ?? parsed;
            const normalized = normalizeCssInput(incoming);
            deps.setCustomThemeCss(normalized);
            applyCss();
            syncCssEditorUI();
            deps.saveSettingsToServer({ customThemeCss: normalized });
            deps.showToast('Импорт стилей выполнен', 'success');
        }

        return {
            ensureStyleEl,
            normalizeCssInput,
            applyCss,
            normalizeStyleSettingsInput,
            applyStyleSettings,
            getStyleVariantFromSelect: styleVariantFromSelect,
            syncStyleSettingsUI,
            onStyleVariantChange: syncStyleSettingsUI,
            saveStyleSettingsVariant,
            resetStyleSettingsVariant,
            unloadStyleSettingsAll,
            exportStyleSettings,
            importStyleSettingsFromFile,
            syncCssEditorUI,
            onCssVariantChange: syncCssEditorUI,
            saveCssVariant,
            clearCssVariant,
            unloadCssAll,
            exportCss,
            importCssFromFile
        };
    }

    global.CustomThemeManagerModule = { createManager };
})(window);
