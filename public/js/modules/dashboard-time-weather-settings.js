(function initDashboardTimeWeatherSettingsModule(global) {
    function createManager(deps) {
        function applyProviderUI() {
            const sel = deps.el('settingsDashboardWeatherProviderSelect');
            if (!sel) return;
            const v = deps.normalizeDashboardWeatherProvider(sel.value);
            const show = (cls, on) => {
                document.querySelectorAll(cls).forEach((node) => {
                    node.style.display = on ? '' : 'none';
                });
            };
            show('.weather-provider-keys--owm', v === 'openweathermap');
            show('.weather-provider-keys--yandex', v === 'yandex');
            show('.weather-provider-keys--gismeteo', v === 'gismeteo');

            const phSet = deps.t('settingsWeatherApiKeyPlaceholderSet') || '••••••••';
            const state = deps.getState();
            const owm = deps.el('settingsWeatherOwmKeyInput');
            if (owm) owm.placeholder = state.weatherOpenweathermapApiKeySet ? phSet : '';
            const ya = deps.el('settingsWeatherYandexKeyInput');
            if (ya) ya.placeholder = state.weatherYandexApiKeySet ? phSet : '';
            const gis = deps.el('settingsWeatherGismeteoKeyInput');
            if (gis) gis.placeholder = state.weatherGismeteoApiKeySet ? phSet : '';
        }

        async function saveSettings() {
            const state = deps.getState();
            const cityInput = deps.el('settingsDashboardWeatherCityInput');
            const timezoneInput = deps.el('settingsDashboardTimezoneInput');
            const nextCity = deps.normalizeDashboardWeatherCity(cityInput ? cityInput.value : state.dashboardWeatherCity);
            const rawTimezone = String(timezoneInput ? timezoneInput.value : state.dashboardTimezone).trim();
            if (rawTimezone && !deps.isValidDashboardTimezone(rawTimezone)) {
                deps.showToast(deps.t('settingsDashboardTimezoneInvalid') || 'Invalid time zone', 'error');
                return;
            }
            const nextTimezone = deps.normalizeDashboardTimezone(rawTimezone);
            const provSel = deps.el('settingsDashboardWeatherProviderSelect');
            const nextProvider = provSel ? deps.normalizeDashboardWeatherProvider(provSel.value) : state.dashboardWeatherProvider;
            const cityChanged = nextCity !== state.dashboardWeatherCity;
            const timezoneChanged = nextTimezone !== state.dashboardTimezone;
            const providerChanged = nextProvider !== state.dashboardWeatherProvider;

            const patch = {
                dashboardShowTime: !!(deps.el('settingsDashboardShowTimeCheckbox') && deps.el('settingsDashboardShowTimeCheckbox').checked),
                dashboardShowWeather: !!(deps.el('settingsDashboardShowWeatherCheckbox') && deps.el('settingsDashboardShowWeatherCheckbox').checked),
                monitorShowTime: !!(deps.el('settingsMonitorShowTimeCheckbox') && deps.el('settingsMonitorShowTimeCheckbox').checked),
                monitorShowWeather: !!(deps.el('settingsMonitorShowWeatherCheckbox') && deps.el('settingsMonitorShowWeatherCheckbox').checked),
                monitorDisableChromeGestures: !!(deps.el('settingsMonitorDisableChromeGesturesCheckbox') && deps.el('settingsMonitorDisableChromeGesturesCheckbox').checked),
                monitorHotkeys: deps.normalizeMonitorHotkeys(state.monitorHotkeys),
                dashboardWeatherCity: nextCity,
                dashboardTimezone: nextTimezone,
                dashboardWeatherProvider: nextProvider
            };
            deps.setState(patch);

            if (cityChanged || timezoneChanged || providerChanged) deps.resetDashboardWeatherState();
            deps.setValue('settingsDashboardWeatherCityInput', nextCity);
            deps.setValue('settingsDashboardTimezoneInput', nextTimezone);
            if (provSel) provSel.value = nextProvider;
            applyProviderUI();
            deps.startDashboardClockTimer();

            const saveBody = {
                dashboardWeatherCity: nextCity,
                dashboardWeatherProvider: nextProvider,
                dashboardTimezone: nextTimezone,
                dashboardShowTime: patch.dashboardShowTime,
                dashboardShowWeather: patch.dashboardShowWeather,
                monitorShowTime: patch.monitorShowTime,
                monitorShowWeather: patch.monitorShowWeather,
                monitorDisableChromeGestures: patch.monitorDisableChromeGestures,
                monitorHotkeys: patch.monitorHotkeys
            };
            const owmIn = deps.el('settingsWeatherOwmKeyInput');
            const yaIn = deps.el('settingsWeatherYandexKeyInput');
            const gisIn = deps.el('settingsWeatherGismeteoKeyInput');
            if (owmIn && owmIn.value.trim()) saveBody.weatherOpenweathermapApiKey = owmIn.value.trim();
            if (yaIn && yaIn.value.trim()) saveBody.weatherYandexApiKey = yaIn.value.trim();
            if (gisIn && gisIn.value.trim()) saveBody.weatherGismeteoApiKey = gisIn.value.trim();

            try {
                await deps.saveSettingsToServer(saveBody);
                if (saveBody.weatherOpenweathermapApiKey) patch.weatherOpenweathermapApiKeySet = true;
                if (saveBody.weatherYandexApiKey) patch.weatherYandexApiKeySet = true;
                if (saveBody.weatherGismeteoApiKey) patch.weatherGismeteoApiKeySet = true;
                deps.setState(patch);
                if (owmIn) owmIn.value = '';
                if (yaIn) yaIn.value = '';
                if (gisIn) gisIn.value = '';
                applyProviderUI();
                deps.applyMonitorChromeGestureGuards();
                deps.refreshDashboardWeather(true).catch(() => {});
                deps.showToast(deps.t('dataUpdated') || 'Настройки сохранены', 'success');
            } catch (error) {
                console.error('Failed to save dashboard time/weather settings:', error);
                deps.showToast((deps.t('connectError') || 'Connection error') + ': ' + error.message, 'error');
            }
        }

        return { applyProviderUI, saveSettings };
    }

    global.DashboardTimeWeatherSettingsModule = { createManager };
})(window);
