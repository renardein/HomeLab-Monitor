'use strict';

const { spawn } = require('child_process');
const { getDbSync, saveDb } = require('./db');
const store = require('./settings-store');
const { log } = require('./utils');

let runLock = false;
let cliCache = { ok: false, checkedAt: 0, proxyKey: '' };

/** Максимум автоматических замеров за сутки и строк в списке «за сегодня» в summary. */
const SPEEDTEST_MAX_RUNS_PER_DAY = 6;

/** Исполняемый файл Ookla CLI: иначе ищется `speedtest` в PATH процесса Node (может отличаться от интерактивной оболочки). */
function speedtestExecutable() {
    const p = process.env.SPEEDTEST_CLI || process.env.SPEEDTEST_PATH;
    const s = p != null ? String(p).trim() : '';
    return s || 'speedtest';
}

function readSpeedtestProxyFromStore() {
    const http = String(store.getSetting('speedtest_http_proxy') || '').trim();
    const https = String(store.getSetting('speedtest_https_proxy') || '').trim();
    const noProxy = String(store.getSetting('speedtest_no_proxy') || '').trim();
    return { http, https, noProxy };
}

function speedtestProxyCacheKey() {
    const { http, https, noProxy } = readSpeedtestProxyFromStore();
    return `${http}\n${https}\n${noProxy}`;
}

/** Ключи прокси в окружении — при явной настройке в БД сбрасываем наследование от Node/системы (частая причина «не работает»). */
const SPEEDTEST_PROXY_ENV_KEYS = [
    'HTTP_PROXY',
    'http_proxy',
    'HTTPS_PROXY',
    'https_proxy',
    'NO_PROXY',
    'no_proxy',
    'ALL_PROXY',
    'all_proxy',
    'FTP_PROXY',
    'ftp_proxy'
];

/**
 * Переменные окружения для дочернего процесса.
 * Go http.ProxyFromEnvironment (часто у Ookla CLI): HTTPS без отдельного URL подхватывает HTTP_PROXY,
 * но смешение с устаревшим HTTPS_PROXY из среды Node даёт сбои — поэтому при заполненном HTTP(S) в настройках чистим прокси-переменные и задаём заново.
 */
function speedtestSpawnEnv() {
    const env = { ...process.env };
    const { http, https, noProxy } = readSpeedtestProxyFromStore();
    const setPair = (upper, lower, val) => {
        if (!val || val.length > 2048) return;
        env[upper] = val;
        env[lower] = val;
    };

    const hasHttpOrHttps = !!(http || https);
    if (hasHttpOrHttps) {
        for (const k of SPEEDTEST_PROXY_ENV_KEYS) {
            delete env[k];
        }
        setPair('HTTP_PROXY', 'http_proxy', http);
        const httpsEffective = https || http;
        setPair('HTTPS_PROXY', 'https_proxy', httpsEffective);
        setPair('NO_PROXY', 'no_proxy', noProxy);
    } else if (noProxy) {
        setPair('NO_PROXY', 'no_proxy', noProxy);
    }

    return env;
}

function speedtestSpawnOptions() {
    return {
        windowsHide: true,
        stdio: ['ignore', 'pipe', 'pipe'],
        env: speedtestSpawnEnv()
    };
}

function parseStoredProviderMbps(settingKey) {
    const raw = store.getSetting(settingKey);
    if (raw == null || raw === '') return null;
    const n = parseFloat(String(raw).trim().replace(',', '.'));
    if (!Number.isFinite(n) || n <= 0) return null;
    return Math.min(Math.round(n * 1000) / 1000, 1_000_000);
}

function readSettings() {
    const rawEn = store.getSetting('speedtest_enabled');
    const enabled = rawEn === '1' || rawEn === 'true' || rawEn === true;
    const server = String(store.getSetting('speedtest_server') || '').trim();
    let perDay = parseInt(store.getSetting('speedtest_per_day'), 10);
    if (!Number.isFinite(perDay) || perDay < 1) perDay = 4;
    if (perDay > SPEEDTEST_MAX_RUNS_PER_DAY) perDay = SPEEDTEST_MAX_RUNS_PER_DAY;
    return { enabled, server, perDay };
}

function bandwidthToMbps(bw) {
    if (typeof bw !== 'number' || !Number.isFinite(bw)) return null;
    return (bw * 8) / 1_000_000;
}

function parseResultObject(obj) {
    if (!obj || obj.type !== 'result') return null;
    const dl = obj.download && typeof obj.download.bandwidth === 'number'
        ? bandwidthToMbps(obj.download.bandwidth)
        : null;
    const ul = obj.upload && typeof obj.upload.bandwidth === 'number'
        ? bandwidthToMbps(obj.upload.bandwidth)
        : null;
    let ping = null;
    if (obj.ping && typeof obj.ping.latency === 'number') ping = obj.ping.latency;
    else if (typeof obj.ping === 'number') ping = obj.ping;
    const sid = obj.server && obj.server.id != null ? String(obj.server.id) : null;
    const sname = obj.server && obj.server.name != null ? String(obj.server.name) : null;
    return { download_mbps: dl, upload_mbps: ul, ping_ms: ping, server_id: sid, server_name: sname };
}

function parseStdout(stdout) {
    const raw = String(stdout || '').trim();
    const lines = raw.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
    let last = null;
    for (const line of lines) {
        if (!line.startsWith('{')) continue;
        try {
            const o = JSON.parse(line);
            if (o && o.type === 'result') last = o;
        } catch (_) { /* skip */ }
    }
    if (!last && raw.startsWith('{')) {
        try {
            const o = JSON.parse(raw);
            if (o && o.type === 'result') last = o;
        } catch (_) { /* skip */ }
    }
    return last ? parseResultObject(last) : null;
}

/** Ookla CLI пишет в stdout поток NDJSON: строки type:log (в т.ч. level:error) и в конце type:result. */
function lastErrorMessagesFromSpeedtestJsonl(stdout, maxLines = 4) {
    const raw = String(stdout || '').trim();
    const lines = raw.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
    const errors = [];
    for (const line of lines) {
        if (!line.startsWith('{')) continue;
        try {
            const o = JSON.parse(line);
            if (o && o.type === 'log' && String(o.level || '').toLowerCase() === 'error' && o.message) {
                errors.push(String(o.message).trim());
            }
        } catch (_) { /* skip */ }
    }
    if (!errors.length || maxLines <= 0) return errors;
    return errors.slice(-maxLines);
}

function probeCli() {
    return new Promise((resolve) => {
        const exe = speedtestExecutable();
        const proc = spawn(exe, ['--version'], speedtestSpawnOptions());
        let done = false;
        const finish = (ok) => {
            if (done) return;
            done = true;
            try { proc.kill('SIGKILL'); } catch (_) { /* ignore */ }
            resolve(ok);
        };
        const t = setTimeout(() => finish(false), 8000);
        proc.on('error', () => {
            clearTimeout(t);
            finish(false);
        });
        proc.on('close', (code) => {
            clearTimeout(t);
            finish(code === 0);
        });
    });
}

async function checkCliAvailable() {
    const pKey = speedtestProxyCacheKey();
    const now = Date.now();
    if (now - cliCache.checkedAt < 120000 && cliCache.proxyKey === pKey) return cliCache.ok;
    cliCache.checkedAt = now;
    cliCache.proxyKey = pKey;
    cliCache.ok = await probeCli();
    return cliCache.ok;
}

function runSpeedtestProcess(serverIdOrEmpty) {
    return new Promise((resolve, reject) => {
        const exe = speedtestExecutable();
        const args = ['--format=json', '--accept-license', '--accept-gdpr'];
        if (serverIdOrEmpty && /^\d+$/.test(serverIdOrEmpty)) {
            args.push(`--server-id=${serverIdOrEmpty}`);
        }
        const proc = spawn(exe, args, speedtestSpawnOptions());
        let out = '';
        let err = '';
        const t = setTimeout(() => {
            try { proc.kill('SIGKILL'); } catch (_) { /* ignore */ }
            reject(new Error('speedtest timeout'));
        }, 180000);
        proc.stdout.on('data', (d) => { out += d.toString(); });
        proc.stderr.on('data', (d) => { err += d.toString(); });
        proc.on('error', (e) => {
            clearTimeout(t);
            const code = e && e.code;
            const base = e && e.message ? String(e.message) : String(e);
            if (code === 'ENOENT') {
                reject(new Error(`Speedtest executable not found (${exe}). Set SPEEDTEST_CLI to the full path or install Ookla CLI.`));
            } else {
                reject(new Error(base));
            }
        });
        proc.on('close', (code) => {
            clearTimeout(t);
            const parsed = parseStdout(out);
            if (parsed) {
                resolve(parsed);
                return;
            }
            const logErrs = lastErrorMessagesFromSpeedtestJsonl(out);
            const logHint = logErrs.length ? logErrs.join('; ') : '';
            const stderrHint = (err || '').trim();
            if (code !== 0) {
                const parts = [logHint, stderrHint, (out || '').trim()].filter(Boolean);
                const msg = parts.length
                    ? parts.join(' · ')
                    : `speedtest exited with code ${code}`;
                reject(new Error(msg));
                return;
            }
            const parseFailMsg = logHint
                ? `Could not parse speedtest JSON output (${logHint})`
                : 'Could not parse speedtest JSON output';
            reject(new Error(parseFailMsg));
        });
    });
}

function insertResult(row) {
    const db = getDbSync();
    const runAt = row.run_at || new Date().toISOString();
    db.run(
        `INSERT INTO speedtest_results (run_at, download_mbps, upload_mbps, ping_ms, server_id, server_name, error)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
        [
            runAt,
            row.download_mbps,
            row.upload_mbps,
            row.ping_ms,
            row.server_id,
            row.server_name,
            row.error || null
        ]
    );
    saveDb();
    trimOldResults();
}

function trimOldResults() {
    try {
        const db = getDbSync();
        db.run(`DELETE FROM speedtest_results WHERE datetime(run_at) < datetime('now', '-120 days')`);
        saveDb();
    } catch (_) { /* ignore */ }
}

function clearAllResults() {
    const db = getDbSync();
    db.run('DELETE FROM speedtest_results');
    saveDb();
}

function localDayBoundsIso() {
    const now = new Date();
    const start = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    const end = new Date(start);
    end.setDate(end.getDate() + 1);
    return { startIso: start.toISOString(), endIso: end.toISOString() };
}

function getLastRunMs() {
    const db = getDbSync();
    const stmt = db.prepare('SELECT run_at FROM speedtest_results ORDER BY datetime(run_at) DESC LIMIT 1');
    stmt.step();
    const row = stmt.get();
    stmt.free();
    if (!row || !row[0]) return 0;
    const t = new Date(row[0]).getTime();
    return Number.isFinite(t) ? t : 0;
}

function countOkToday(startIso, endIso) {
    const db = getDbSync();
    const stmt = db.prepare(
        `SELECT COUNT(*) FROM speedtest_results
         WHERE error IS NULL AND download_mbps IS NOT NULL
           AND datetime(run_at) >= datetime(?) AND datetime(run_at) < datetime(?)`
    );
    stmt.bind([startIso, endIso]);
    stmt.step();
    const n = stmt.get()[0];
    stmt.free();
    return typeof n === 'number' ? n : parseInt(n, 10) || 0;
}

function statsForTodayOk(startIso, endIso) {
    const db = getDbSync();
    const stmt = db.prepare(
        `SELECT download_mbps, upload_mbps FROM speedtest_results
         WHERE error IS NULL AND download_mbps IS NOT NULL
           AND datetime(run_at) >= datetime(?) AND datetime(run_at) < datetime(?)`
    );
    stmt.bind([startIso, endIso]);
    const downloads = [];
    const uploads = [];
    while (stmt.step()) {
        const r = stmt.get();
        if (r[0] != null) downloads.push(Number(r[0]));
        if (r[1] != null) uploads.push(Number(r[1]));
    }
    stmt.free();
    const agg = (arr) => {
        if (!arr.length) return { avg: null, min: null, max: null };
        const sum = arr.reduce((a, b) => a + b, 0);
        return {
            avg: Math.round((sum / arr.length) * 10) / 10,
            min: Math.round(Math.min(...arr) * 10) / 10,
            max: Math.round(Math.max(...arr) * 10) / 10
        };
    };
    return { download: agg(downloads), upload: agg(uploads), count: downloads.length };
}

function getLastRow() {
    const db = getDbSync();
    const stmt = db.prepare(
        `SELECT run_at, download_mbps, upload_mbps, ping_ms, server_id, server_name, error
         FROM speedtest_results ORDER BY datetime(run_at) DESC LIMIT 1`
    );
    stmt.step();
    const row = stmt.get();
    stmt.free();
    if (!row) return null;
    return {
        runAt: row[0],
        downloadMbps: row[1],
        uploadMbps: row[2],
        pingMs: row[3],
        serverId: row[4],
        serverName: row[5],
        error: row[6]
    };
}

/** Все замеры за локальный календарный день [startIso, endIso), как у агрегатов «сегодня». */
function listRunsForLocalDay(startIso, endIso, limit = SPEEDTEST_MAX_RUNS_PER_DAY) {
    const cap = Number(limit);
    const lim = Number.isFinite(cap) && cap > 0
        ? Math.min(Math.floor(cap), SPEEDTEST_MAX_RUNS_PER_DAY)
        : SPEEDTEST_MAX_RUNS_PER_DAY;
    const db = getDbSync();
    const stmt = db.prepare(
        `SELECT run_at, download_mbps, upload_mbps, ping_ms, server_id, server_name, error
         FROM speedtest_results
         WHERE datetime(run_at) >= datetime(?) AND datetime(run_at) < datetime(?)
         ORDER BY datetime(run_at) DESC
         LIMIT ?`
    );
    stmt.bind([startIso, endIso, lim]);
    const out = [];
    while (stmt.step()) {
        const row = stmt.get();
        out.push({
            runAt: row[0],
            downloadMbps: row[1],
            uploadMbps: row[2],
            pingMs: row[3],
            serverId: row[4],
            serverName: row[5],
            error: row[6]
        });
    }
    stmt.free();
    return out;
}

function getSummaryPayload() {
    const { enabled, server, perDay } = readSettings();
    const cliOk = cliCache.ok;
    const { startIso, endIso } = localDayBoundsIso();
    const today = statsForTodayOk(startIso, endIso);
    const last = getLastRow();
    const providerDownloadMbps = parseStoredProviderMbps('speedtest_provider_download_mbps');
    const providerUploadMbps = parseStoredProviderMbps('speedtest_provider_upload_mbps');
    const px = readSpeedtestProxyFromStore();
    return {
        enabled,
        cliAvailable: cliOk,
        serverId: server || null,
        perDay,
        providerDownloadMbps,
        providerUploadMbps,
        proxy: {
            http: !!px.http,
            https: !!px.https,
            noProxy: !!px.noProxy
        },
        last: last
            ? {
                runAt: last.runAt,
                downloadMbps: last.downloadMbps,
                uploadMbps: last.uploadMbps,
                pingMs: last.pingMs,
                serverId: last.serverId,
                serverName: last.serverName,
                error: last.error
            }
            : null,
        runsToday: listRunsForLocalDay(startIso, endIso),
        today
    };
}

async function executeRun(source) {
    if (runLock) {
        const err = new Error('busy');
        err.code = 'BUSY';
        throw err;
    }
    runLock = true;
    const { server } = readSettings();
    const runAt = new Date().toISOString();
    try {
        await checkCliAvailable();
        if (!cliCache.ok) {
            insertResult({
                run_at: runAt,
                download_mbps: null,
                upload_mbps: null,
                ping_ms: null,
                server_id: null,
                server_name: null,
                error: 'Speedtest CLI not found (install Ookla speedtest and ensure it is in PATH)'
            });
            return { ok: false, error: 'cli_missing', source };
        }
        const r = await runSpeedtestProcess(server);
        insertResult({
            run_at: runAt,
            download_mbps: r.download_mbps,
            upload_mbps: r.upload_mbps,
            ping_ms: r.ping_ms,
            server_id: r.server_id,
            server_name: r.server_name,
            error: null
        });
        log('info', `[speedtest] ${source}: dl=${r.download_mbps} Mbps ul=${r.upload_mbps} Mbps`);
        return { ok: true, source };
    } catch (e) {
        const msg = e && e.message ? e.message : String(e);
        insertResult({
            run_at: runAt,
            download_mbps: null,
            upload_mbps: null,
            ping_ms: null,
            server_id: null,
            server_name: null,
            error: msg
        });
        log('warn', `[speedtest] ${source} failed: ${msg}`);
        return { ok: false, error: msg, source };
    } finally {
        runLock = false;
    }
}

async function runManual() {
    return executeRun('manual');
}

async function schedulerTick() {
    const { enabled, server, perDay } = readSettings();
    if (!enabled || runLock) return;
    await checkCliAvailable();
    if (!cliCache.ok) return;

    const minGapMs = Math.floor(86400000 / perDay);
    const { startIso, endIso } = localDayBoundsIso();
    const okToday = countOkToday(startIso, endIso);
    if (okToday >= perDay) return;

    const lastMs = getLastRunMs();
    const now = Date.now();
    if (lastMs && (now - lastMs) < minGapMs) return;

    await executeRun('scheduler');
}

function startScheduler() {
    setInterval(() => {
        schedulerTick().catch((e) => log('warn', `[speedtest] scheduler: ${e.message}`));
    }, 120000);
    setTimeout(() => {
        schedulerTick().catch((e) => log('warn', `[speedtest] initial: ${e.message}`));
    }, 15000);
}

module.exports = {
    readSettings,
    checkCliAvailable,
    getSummaryPayload,
    runManual,
    startScheduler,
    clearAllResults
};
