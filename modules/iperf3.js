'use strict';

const { spawn } = require('child_process');
const { getDbSync, saveDb } = require('./db');
const store = require('./settings-store');
const { log } = require('./utils');

let runLock = false;
let cliCache = { ok: false, checkedAt: 0 };

const IPERF3_MAX_RUNS_PER_DAY = 6;

function iperf3Executable() {
    const p = process.env.IPERF3_CLI || process.env.IPERF3_PATH;
    const s = p != null ? String(p).trim() : '';
    return s || 'iperf3';
}

function readSettings() {
    const rawEn = store.getSetting('iperf3_enabled');
    const enabled = rawEn === '1' || rawEn === 'true' || rawEn === true;
    const host = String(store.getSetting('iperf3_host') || '').trim();
    let port = parseInt(store.getSetting('iperf3_port'), 10);
    if (!Number.isFinite(port) || port < 1 || port > 65535) port = 5201;
    let duration = parseInt(store.getSetting('iperf3_duration_sec'), 10);
    if (!Number.isFinite(duration) || duration < 1) duration = 8;
    if (duration > 120) duration = 120;
    let parallel = parseInt(store.getSetting('iperf3_parallel'), 10);
    if (!Number.isFinite(parallel) || parallel < 1) parallel = 1;
    if (parallel > 32) parallel = 32;
    let perDay = parseInt(store.getSetting('iperf3_per_day'), 10);
    if (!Number.isFinite(perDay) || perDay < 1) perDay = 4;
    if (perDay > IPERF3_MAX_RUNS_PER_DAY) perDay = IPERF3_MAX_RUNS_PER_DAY;
    return { enabled, host, port, duration, parallel, perDay };
}

function parseStoredProviderMbps(settingKey) {
    const raw = store.getSetting(settingKey);
    if (raw == null || raw === '') return null;
    const n = parseFloat(String(raw).trim().replace(',', '.'));
    if (!Number.isFinite(n) || n <= 0) return null;
    return Math.min(Math.round(n * 1000) / 1000, 1_000_000);
}

function parseIperf3Json(stdout) {
    const raw = String(stdout || '').trim();
    if (!raw) return null;
    try {
        const o = JSON.parse(raw);
        return o && typeof o === 'object' ? o : null;
    } catch (_) {
        return null;
    }
}

/** Client → server (upload direction at client): sum_sent */
function mbpsFromUploadJson(obj) {
    const end = obj && obj.end;
    if (!end || !end.sum_sent) return null;
    const bps = end.sum_sent.bits_per_second;
    if (typeof bps !== 'number' || !Number.isFinite(bps)) return null;
    return Math.round((bps / 1e6) * 100) / 100;
}

/** Reverse: server → client (download at client): sum_received */
function mbpsFromDownloadJson(obj) {
    const end = obj && obj.end;
    if (!end || !end.sum_received) return null;
    const bps = end.sum_received.bits_per_second;
    if (typeof bps !== 'number' || !Number.isFinite(bps)) return null;
    return Math.round((bps / 1e6) * 100) / 100;
}

function iperf3SpawnOptions() {
    return {
        windowsHide: true,
        stdio: ['ignore', 'pipe', 'pipe'],
        env: { ...process.env }
    };
}

function probeCli() {
    return new Promise((resolve) => {
        const exe = iperf3Executable();
        const proc = spawn(exe, ['--version'], iperf3SpawnOptions());
        let done = false;
        const finish = (ok) => {
            if (done) return;
            done = true;
            try {
                proc.kill('SIGKILL');
            } catch (_) { /* ignore */ }
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
    const now = Date.now();
    if (now - cliCache.checkedAt < 120000) return cliCache.ok;
    cliCache.checkedAt = now;
    cliCache.ok = await probeCli();
    return cliCache.ok;
}

function buildBaseArgs(host, port, duration, parallel) {
    const args = ['-c', host, '-p', String(port), '-t', String(duration), '-J'];
    if (parallel > 1) args.push('-P', String(parallel));
    return args;
}

function runIperf3Once(extraArgs, timeoutMs) {
    return new Promise((resolve, reject) => {
        const exe = iperf3Executable();
        const { host, port, duration, parallel } = readSettings();
        if (!host) {
            reject(new Error('iperf3 host is not configured'));
            return;
        }
        const args = [...buildBaseArgs(host, port, duration, parallel), ...extraArgs];
        const proc = spawn(exe, args, iperf3SpawnOptions());
        let out = '';
        let err = '';
        const t = setTimeout(() => {
            try {
                proc.kill('SIGKILL');
            } catch (_) { /* ignore */ }
            reject(new Error('iperf3 timeout'));
        }, timeoutMs);
        proc.stdout.on('data', (d) => {
            out += d.toString();
        });
        proc.stderr.on('data', (d) => {
            err += d.toString();
        });
        proc.on('error', (e) => {
            clearTimeout(t);
            const code = e && e.code;
            if (code === 'ENOENT') {
                reject(new Error(`iperf3 executable not found (${exe}). Set IPERF3_CLI to the full path or install iperf3.`));
            } else {
                reject(new Error(e && e.message ? String(e.message) : String(e)));
            }
        });
        proc.on('close', (code) => {
            clearTimeout(t);
            const parsed = parseIperf3Json(out);
            if (parsed && code === 0) {
                resolve(parsed);
                return;
            }
            const hint = (err || '').trim() || (out || '').trim() || `exit ${code}`;
            reject(new Error(hint.slice(0, 500)));
        });
    });
}

async function runBidirectionalIperf3() {
    const { duration } = readSettings();
    const perRunMs = Math.min(300000, Math.max(45000, (Number(duration) || 8) * 20000));
    const uploadJson = await runIperf3Once([], perRunMs);
    const ul = mbpsFromUploadJson(uploadJson);
    if (ul == null) throw new Error('Could not parse iperf3 upload result (sum_sent)');
    const downloadJson = await runIperf3Once(['-R'], perRunMs);
    const dl = mbpsFromDownloadJson(downloadJson);
    if (dl == null) throw new Error('Could not parse iperf3 download result (sum_received, -R)');
    return { downloadMbps: dl, uploadMbps: ul };
}

function serverLabel() {
    const { host, port } = readSettings();
    if (!host) return null;
    return `${host}:${port}`;
}

function insertResult(row) {
    const db = getDbSync();
    const runAt = row.run_at || new Date().toISOString();
    db.run(
        `INSERT INTO iperf3_results (run_at, download_mbps, upload_mbps, ping_ms, server_id, server_name, error)
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
        db.run(`DELETE FROM iperf3_results WHERE datetime(run_at) < datetime('now', '-120 days')`);
        saveDb();
    } catch (_) { /* ignore */ }
}

function clearAllResults() {
    const db = getDbSync();
    db.run('DELETE FROM iperf3_results');
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
    const stmt = db.prepare('SELECT run_at FROM iperf3_results ORDER BY datetime(run_at) DESC LIMIT 1');
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
        `SELECT COUNT(*) FROM iperf3_results
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
        `SELECT download_mbps, upload_mbps FROM iperf3_results
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
         FROM iperf3_results ORDER BY datetime(run_at) DESC LIMIT 1`
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

function listRunsForLocalDay(startIso, endIso, limit = IPERF3_MAX_RUNS_PER_DAY) {
    const cap = Number(limit);
    const lim = Number.isFinite(cap) && cap > 0
        ? Math.min(Math.floor(cap), IPERF3_MAX_RUNS_PER_DAY)
        : IPERF3_MAX_RUNS_PER_DAY;
    const db = getDbSync();
    const stmt = db.prepare(
        `SELECT run_at, download_mbps, upload_mbps, ping_ms, server_id, server_name, error
         FROM iperf3_results
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
    const { enabled, host, port, duration, parallel, perDay } = readSettings();
    const cliOk = cliCache.ok;
    const { startIso, endIso } = localDayBoundsIso();
    const today = statsForTodayOk(startIso, endIso);
    const last = getLastRow();
    const providerDownloadMbps = parseStoredProviderMbps('iperf3_provider_download_mbps');
    const providerUploadMbps = parseStoredProviderMbps('iperf3_provider_upload_mbps');
    return {
        enabled,
        cliAvailable: cliOk,
        host: host || null,
        port,
        durationSec: duration,
        parallel,
        perDay,
        providerDownloadMbps,
        providerUploadMbps,
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
                server_name: serverLabel(),
                error: 'iperf3 CLI not found (install iperf3 and ensure it is in PATH, or set IPERF3_CLI)'
            });
            return { ok: false, error: 'cli_missing', source };
        }
        const { host } = readSettings();
        if (!host) {
            insertResult({
                run_at: runAt,
                download_mbps: null,
                upload_mbps: null,
                ping_ms: null,
                server_id: null,
                server_name: null,
                error: 'iperf3 server host is not configured'
            });
            return { ok: false, error: 'no_host', source };
        }
        const r = await runBidirectionalIperf3();
        insertResult({
            run_at: runAt,
            download_mbps: r.downloadMbps,
            upload_mbps: r.uploadMbps,
            ping_ms: null,
            server_id: null,
            server_name: serverLabel(),
            error: null
        });
        log('info', `[iperf3] ${source}: dl=${r.downloadMbps} Mbps ul=${r.uploadMbps} Mbps`);
        return { ok: true, source };
    } catch (e) {
        const msg = e && e.message ? e.message : String(e);
        insertResult({
            run_at: runAt,
            download_mbps: null,
            upload_mbps: null,
            ping_ms: null,
            server_id: null,
            server_name: serverLabel(),
            error: msg
        });
        log('warn', `[iperf3] ${source} failed: ${msg}`);
        return { ok: false, error: msg, source };
    } finally {
        runLock = false;
    }
}

async function runManual() {
    return executeRun('manual');
}

async function schedulerTick() {
    const { enabled, host, perDay } = readSettings();
    if (!enabled || !host || runLock) return;
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
        schedulerTick().catch((e) => log('warn', `[iperf3] scheduler: ${e.message}`));
    }, 120000);
    setTimeout(() => {
        schedulerTick().catch((e) => log('warn', `[iperf3] initial: ${e.message}`));
    }, 20000);
}

module.exports = {
    readSettings,
    checkCliAvailable,
    getSummaryPayload,
    runManual,
    startScheduler,
    clearAllResults
};
