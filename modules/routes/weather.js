/**
 * Погода для карточки дашборда: геокод (Open-Meteo, без ключа) + провайдер по настройкам.
 * Ключи OpenWeatherMap / Яндекс / Gismeteo хранятся только на сервере.
 */
const express = require('express');
const axios = require('axios');
const { log } = require('../utils');
const store = require('../settings-store');

const router = express.Router();

const GEOCODE_URL = 'https://geocoding-api.open-meteo.com/v1/search';

function getProvider() {
    const v = String(store.getSetting('dashboard_weather_provider') || 'open_meteo').trim().toLowerCase();
    const allowed = new Set(['open_meteo', 'openweathermap', 'yandex', 'gismeteo']);
    return allowed.has(v) ? v : 'open_meteo';
}

function getSecret(key) {
    const v = store.getSetting(key);
    return v != null && String(v).trim() !== '' ? String(v).trim() : '';
}

async function geocodeCity(city, lang) {
    const geoLang = lang === 'ru' ? 'ru' : 'en';
    const { data, status } = await axios.get(GEOCODE_URL, {
        params: { name: city, count: 1, language: geoLang, format: 'json' },
        timeout: 15000,
        validateStatus: () => true
    });
    if (status >= 400) throw new Error(`Geocoding failed: ${status}`);
    if (data?.error) throw new Error(String(data.reason || data.error || 'Geocoding failed'));
    const r = Array.isArray(data?.results) ? data.results[0] : null;
    if (!r || r.latitude == null || r.longitude == null) throw new Error('City not found');
    const displayName = [r.name, r.admin1, r.country].filter(Boolean).join(', ');
    return {
        lat: Number(r.latitude),
        lon: Number(r.longitude),
        displayName
    };
}

/** Приблизительный WMO weather_code для иконок Bootstrap (как у Open-Meteo). */
function owmIdToWmo(id) {
    const i = Number(id);
    if (i === 800) return 0;
    if (i === 801) return 1;
    if (i === 802) return 2;
    if (i === 803 || i === 804) return 3;
    if (i >= 701 && i <= 781) return 45;
    if (i >= 200 && i <= 232) return 95;
    if (i >= 300 && i <= 321) return 51;
    if (i >= 500 && i <= 531) return 63;
    if (i >= 600 && i <= 622) return 73;
    if (i >= 611 && i <= 613) return 66;
    return 3;
}

function yandexConditionToWmo(condition) {
    const c = String(condition || '').toLowerCase();
    if (c === 'clear') return 0;
    if (c === 'partly-cloudy') return 2;
    if (c === 'cloudy' || c === 'overcast') return 3;
    if (c.includes('thunder')) return 95;
    if (c.includes('snow') || c.includes('wet-snow')) return 73;
    if (c.includes('rain') || c.includes('drizzle')) return 63;
    return 3;
}

function gismeteoPayloadToWeather(data) {
    const root = data?.response ?? data?.data ?? data;
    let t = null;
    const tryNum = (v) => {
        const n = typeof v === 'number' ? v : parseFloat(String(v).replace(',', '.'));
        return Number.isFinite(n) ? n : null;
    };
    if (root && typeof root === 'object') {
        t = tryNum(root.temperature?.air?.C ?? root.temperature?.air?.c ?? root.temperature?.air);
        if (t == null) t = tryNum(root.temperature?.comfort?.C ?? root.temperature?.comfort?.c);
        if (t == null) t = tryNum(root.temp ?? root.air?.temperature);
        if (t == null && root.temperature && typeof root.temperature === 'object') {
            const air = root.temperature.air;
            if (air && typeof air === 'object') t = tryNum(air.C ?? air.c ?? air.value);
        }
    }
    let code = 3;
    const desc = String(
        root?.description?.full ||
            root?.description?.rus ||
            root?.description?.eng ||
            root?.kind ||
            ''
    ).toLowerCase();
    if (desc.includes('ясн') || desc.includes('clear')) code = 0;
    else if (desc.includes('дожд') || desc.includes('rain')) code = 63;
    else if (desc.includes('снег') || desc.includes('snow')) code = 73;
    else if (desc.includes('гроз') || desc.includes('thunder')) code = 95;
    else if (desc.includes('туман') || desc.includes('fog')) code = 45;
    return { temperature: t, weatherCode: code };
}

async function fetchOpenMeteo(lat, lon, timezone) {
    const { data } = await axios.get('https://api.open-meteo.com/v1/forecast', {
        params: {
            latitude: lat,
            longitude: lon,
            current: 'temperature_2m,weather_code,is_day',
            timezone: timezone || 'auto'
        },
        timeout: 15000
    });
    const current = data?.current;
    if (!current || current.temperature_2m == null) throw new Error('Weather unavailable');
    return {
        temperature: Number(current.temperature_2m),
        weatherCode: Number(current.weather_code),
        isDay: Number(current.is_day) !== 0
    };
}

async function fetchOpenWeatherMap(lat, lon, apiKey, lang) {
    const { data } = await axios.get('https://api.openweathermap.org/data/2.5/weather', {
        params: {
            lat,
            lon,
            appid: apiKey,
            units: 'metric',
            lang: lang === 'ru' ? 'ru' : 'en'
        },
        timeout: 15000,
        validateStatus: () => true
    });
    if (data?.cod === 401 || data?.cod === 403) throw new Error('OpenWeatherMap: invalid API key');
    if (!data?.main || data.main.temp == null) {
        const msg = data?.message || `OpenWeatherMap HTTP ${data?.cod || 'error'}`;
        throw new Error(String(msg));
    }
    const wid = Array.isArray(data.weather) && data.weather[0] ? data.weather[0].id : 800;
    const isDay = data.sys && data.dt != null && data.sys.sunrise != null && data.sys.sunset != null
        ? data.dt >= data.sys.sunrise && data.dt < data.sys.sunset
        : true;
    return {
        temperature: Number(data.main.temp),
        weatherCode: owmIdToWmo(wid),
        isDay
    };
}

function yandexLang(lang) {
    if (lang === 'ru') return 'ru_RU';
    if (lang === 'be') return 'be_BY';
    if (lang === 'kk') return 'kk_KZ';
    if (lang === 'tr') return 'tr_TR';
    return 'en_US';
}

async function fetchYandex(lat, lon, apiKey, lang) {
    const { data, status } = await axios.get('https://api.weather.yandex.ru/v1/forecast', {
        params: {
            lat,
            lon,
            limit: 1,
            hours: false,
            lang: yandexLang(lang)
        },
        headers: { 'X-Yandex-Weather-Key': apiKey },
        timeout: 15000,
        validateStatus: () => true
    });
    if (status === 403 || status === 401) throw new Error('Yandex Weather: invalid API key');
    const fact = data?.fact;
    if (!fact || fact.temp == null) throw new Error(data?.message || 'Yandex Weather: no data');
    return {
        temperature: Number(fact.temp),
        weatherCode: yandexConditionToWmo(fact.condition),
        isDay: fact.daytime !== 'n'
    };
}

async function fetchGismeteo(lat, lon, token, lang) {
    const gl = lang === 'ru' ? 'ru' : 'en';
    const tryUrls = [
        ['https://api.gismeteo.net/v2/weather/current/', { latitude: lat, longitude: lon, lang: gl }],
        ['https://api.gismeteo.net/v2/weather/current', { latitude: lat, longitude: lon, lang: gl }]
    ];
    let lastErr = 'Gismeteo: request failed';
    for (const [url, params] of tryUrls) {
        try {
            const { data, status } = await axios.get(url, {
                params,
                headers: { 'X-Gismeteo-Token': token },
                timeout: 20000,
                validateStatus: () => true
            });
            if (status === 401 || status === 403) throw new Error('Gismeteo: invalid API token');
            if (status >= 400) {
                lastErr = data?.meta?.message || data?.errors?.[0]?.title || `Gismeteo HTTP ${status}`;
                continue;
            }
            const parsed = gismeteoPayloadToWeather(data);
            if (parsed.temperature == null) {
                lastErr = 'Gismeteo: temperature not found in response';
                continue;
            }
            const isDay = true;
            return {
                temperature: parsed.temperature,
                weatherCode: parsed.weatherCode,
                isDay
            };
        } catch (e) {
            lastErr = e.message || lastErr;
        }
    }
    throw new Error(lastErr);
}

router.get('/dashboard', async (req, res) => {
    try {
        const city = String(req.query.city || store.getSetting('dashboard_weather_city') || '').trim();
        if (!city) {
            return res.status(400).json({ success: false, error: 'City required' });
        }
        const timezone = String(store.getSetting('dashboard_timezone') || 'UTC').trim() || 'UTC';
        const lang = String(req.query.lang || 'en').replace(/[^a-z]/gi, '').slice(0, 5).toLowerCase() || 'en';
        const provider = getProvider();

        const { lat, lon, displayName } = await geocodeCity(city, lang === 'ru' ? 'ru' : 'en');

        let pack;
        if (provider === 'open_meteo') {
            pack = await fetchOpenMeteo(lat, lon, timezone);
        } else if (provider === 'openweathermap') {
            const key = getSecret('weather_openweathermap_api_key');
            if (!key) return res.status(400).json({ success: false, error: 'OpenWeatherMap API key not set' });
            pack = await fetchOpenWeatherMap(lat, lon, key, lang);
        } else if (provider === 'yandex') {
            const key = getSecret('weather_yandex_api_key');
            if (!key) return res.status(400).json({ success: false, error: 'Yandex Weather API key not set' });
            pack = await fetchYandex(lat, lon, key, lang);
        } else if (provider === 'gismeteo') {
            const key = getSecret('weather_gismeteo_api_key');
            if (!key) return res.status(400).json({ success: false, error: 'Gismeteo API token not set' });
            pack = await fetchGismeteo(lat, lon, key, lang);
        } else {
            pack = await fetchOpenMeteo(lat, lon, timezone);
        }

        res.json({
            success: true,
            provider,
            displayName,
            temperature: pack.temperature,
            weatherCode: pack.weatherCode,
            isDay: pack.isDay
        });
    } catch (e) {
        log('warn', `[Weather] dashboard: ${e.message}`);
        res.status(200).json({
            success: false,
            error: e.message || 'Weather unavailable'
        });
    }
});

module.exports = router;
