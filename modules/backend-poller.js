'use strict';

const crypto = require('crypto');
const config = require('./config');
const cache = require('./cache');
const connectionStore = require('./connection-store');
const { log } = require('./utils');
const { cacheKeyFromReq } = require('./proxmox-route-cache');
const clusterRouter = require('./routes/cluster');
const storageRouter = require('./routes/storage');
const backupsRouter = require('./routes/backups');
const truenas = require('./truenas-api');

/** Совпадает с `modules/routes/truenas-status.js` (prefix + serverUrl + apiKey). */
function truenasCacheKey(prefix, req) {
    const salt = `${req.serverUrl || 'default'}\n${req.apiKey || ''}`;
    const h = crypto.createHash('sha256').update(salt).digest('hex').slice(0, 16);
    return `truenas_${prefix}_${h}`;
}

const TRUENAS_OVERVIEW_TTL_SEC = 12;

function fakeProxmoxReq(conn) {
    return {
        token: conn.secret,
        serverUrl: conn.url,
        headers: { 'x-connection-id': String(conn.id) },
        cookies: {}
    };
}

function fakeTrueNASReq(conn) {
    return {
        apiKey: conn.secret,
        serverUrl: conn.url,
        headers: { 'x-connection-id': String(conn.id) },
        cookies: {}
    };
}

async function warmProxmox(conn) {
    const req = fakeProxmoxReq(conn);
    if (!String(req.token || '').trim()) return;

    try {
        const payload = await clusterRouter.fetchClusterFullPayload(req);
        cache.set(cacheKeyFromReq('cluster_full', req), payload);
        clusterRouter.recordClusterPayloadSamples(req, payload);
    } catch (e) {
        log('warn', `[BackgroundPoll] Proxmox cluster ${conn.id}: ${e.message}`);
    }

    try {
        const storagePayload = await storageRouter.fetchStoragePayload(req);
        cache.set(cacheKeyFromReq('storage', req), storagePayload);
    } catch (e) {
        log('warn', `[BackgroundPoll] Proxmox storage ${conn.id}: ${e.message}`);
    }

    try {
        const backupPayload = await backupsRouter.fetchBackupJobsPayload(req);
        cache.set(cacheKeyFromReq('backup_jobs_v4', req), backupPayload);
    } catch (e) {
        log('warn', `[BackgroundPoll] Proxmox backups ${conn.id}: ${e.message}`);
    }
}

async function warmTrueNAS(conn) {
    const req = fakeTrueNASReq(conn);
    if (!String(req.apiKey || '').trim()) return;

    try {
        const snap = await truenas.fetchDashboardSnapshot(req.apiKey, req.serverUrl || null, {
            includeReporting: true
        });
        const health = truenas.buildHealthSummary({
            system: snap.system,
            pools: snap.pools,
            alerts: snap.alerts,
            services: snap.services,
            interfaces: snap.interfaces,
            disks: snap.disks,
            scrubs: snap.scrubs,
            apps: snap.apps,
            capabilities: snap.capabilities
        });
        const overview = {
            system: snap.system,
            pools: snap.pools,
            alerts: snap.alerts,
            services: snap.services,
            interfaces: snap.interfaces,
            disks: snap.disks,
            scrubs: snap.scrubs,
            reporting: snap.reporting,
            apps: snap.apps,
            capabilities: snap.capabilities,
            health,
            updatedAt: new Date().toISOString()
        };
        cache.set(truenasCacheKey('overview', req), overview, TRUENAS_OVERVIEW_TTL_SEC);
    } catch (e) {
        log('warn', `[BackgroundPoll] TrueNAS overview ${conn.id}: ${e.message}`);
    }
}

let intervalId = null;
let running = false;
const state = {
    lastRunAt: null,
    lastRunOk: null,
    lastRunError: null
};

async function runOnce() {
    if (running) return;
    running = true;
    state.lastRunError = null;
    try {
        const rows = connectionStore.listConnections();
        for (const row of rows) {
            const conn = connectionStore.getConnectionById(row.id);
            if (!conn) continue;
            const t = String(conn.type || '').toLowerCase();
            if (t === 'proxmox') {
                await warmProxmox(conn);
            } else if (t === 'truenas') {
                await warmTrueNAS(conn);
            }
        }
        state.lastRunOk = true;
    } catch (e) {
        state.lastRunOk = false;
        state.lastRunError = e && e.message ? e.message : String(e);
        log('warn', `[BackgroundPoll] cycle: ${state.lastRunError}`);
    } finally {
        state.lastRunAt = new Date().toISOString();
        running = false;
    }
}

function start() {
    if (!config.backgroundPoll.enabled) {
        log('info', '[BackgroundPoll] disabled (set BACKGROUND_POLL=1 to enable)');
        return;
    }
    if (intervalId) return;
    const ms = config.backgroundPoll.intervalMs;
    log('info', `[BackgroundPoll] every ${ms}ms`);
    setTimeout(() => {
        runOnce().catch(() => {});
    }, 2000);
    intervalId = setInterval(() => {
        runOnce().catch(() => {});
    }, ms);
    if (typeof intervalId.unref === 'function') intervalId.unref();
}

function getStatus() {
    return {
        enabled: config.backgroundPoll.enabled,
        intervalMs: config.backgroundPoll.intervalMs,
        lastRunAt: state.lastRunAt,
        lastRunOk: state.lastRunOk,
        lastRunError: state.lastRunError,
        cycleRunning: running
    };
}

module.exports = { start, getStatus, runOnce };
