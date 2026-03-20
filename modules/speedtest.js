'use strict';

const { spawn } = require('child_process');
const { getDbSync, saveDb } = require('./db');
const store = require('./settings-store');
const { log } = require('./utils');

let runLock = false;
let cliCache = { ok: false, checkedAt: 0 };

function readSettings() {
    const rawEn = store.getSetting('speedtest_enabled');
    const enabled = rawEn === '1' || rawEn === 'true' || rawEn === true;
    const server = String(store.getSetting('speedtest_server') || '').trim();
    let perDay = parseInt(store.getSetting('speedtest_per_day'), 10);
    if (!Number.isFinite(perDay) || perDay < 1) perDay = 4;
    if (perDay > 48) perDay = 48;
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

function probeCli() {
    return new Promise((resolve) => {
        const proc = spawn('speedtest', ['--version'], {
            windowsHide: true,
            stdio: ['ignore', 'pipe', 'pipe']
        });
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
    const now = Date.now();
    if (now - cliCache.checkedAt < 120000) return cliCache.ok;
    cliCache.checkedAt = now;
    cliCache.ok = await probeCli();
    return cliCache.ok;
}

function runSpeedtestProcess(serverIdOrEmpty) {
    return new Promise((resolve, reject) => {
        const args = ['--format=json', '--accept-license', '--accept-gdpr'];
        if (serverIdOrEmpty && /^\d+$/.test(serverIdOrEmpty)) {
            args.push(`--server-id=${serverIdOrEmpty}`);
        }
        const proc = spawn('speedtest', args, {
            windowsHide: true,
            stdio: ['ignore', 'pipe', 'pipe']
        });
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
            reject(e);
        });
        proc.on('close', (code) => {
            clearTimeout(t);
            if (code !== 0) {
                const msg = (err || out || `exit ${code}`).trim() || `speedtest exited with code ${code}`;
                reject(new Error(msg));
                return;
            }
            const parsed = parseStdout(out);
            if (!parsed) {
                reject(new Error('Could not parse speedtest JSON output'));
                return;
            }
            resolve(parsed);
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

function getSummaryPayload() {
    const { enabled, server, perDay } = readSettings();
    const cliOk = cliCache.ok;
    const { startIso, endIso } = localDayBoundsIso();
    const today = statsForTodayOk(startIso, endIso);
    const last = getLastRow();
    return {
        enabled,
        cliAvailable: cliOk,
        serverId: server || null,
        perDay,
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
    startScheduler
};
