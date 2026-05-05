const { getDbSync, saveDb } = require('./db');
const settingsStore = require('./settings-store');

const DEFAULT_RETENTION_HOURS = 72;
const TABLE = 'host_node_metric_samples';

const METRIC_COLUMN = {
    temp: 'temp_c',
    cpu: 'cpu_usage_pct',
    mem: 'mem_usage_pct'
};

function getRetentionHours() {
    const raw = settingsStore.getSetting('metrics_history_retention_hours_host') || settingsStore.getSetting('metrics_history_retention_hours');
    let n = parseInt(raw, 10);
    if (!Number.isFinite(n) || n < 24) n = DEFAULT_RETENTION_HOURS;
    if (n > 24 * 30) n = 24 * 30;
    return n;
}

function pruneHostNodeMetricSamples() {
    try {
        const retention = getRetentionHours();
        const db = getDbSync();
        db.run(`DELETE FROM ${TABLE} WHERE datetime(recorded_at) < datetime('now', ?)`, [`-${retention} hours`]);
        saveDb();
    } catch (_) {
        /* ignore */
    }
}

/** Samples from /host-metrics/current (agent temperature). */
function recordHostCpuTempSamples(connectionId, items, recordedAtIso) {
    const cid = String(connectionId || '').trim();
    if (!cid || !Array.isArray(items)) return;
    const ts = recordedAtIso || new Date().toISOString();
    const db = getDbSync();
    for (const item of items) {
        const node = item && item.node != null ? String(item.node).trim() : '';
        const tv = Number(item.cpu && item.cpu.tempC);
        if (!node || !Number.isFinite(tv)) continue;
        db.run(
            `INSERT INTO ${TABLE} (connection_id, node_name, recorded_at, temp_c, cpu_usage_pct, mem_usage_pct) VALUES (?, ?, ?, ?, NULL, NULL)`,
            [cid, node, ts, tv]
        );
    }
    saveDb();
    pruneHostNodeMetricSamples();
}

/** CPU % and RAM % from Proxmox /cluster/full (node status), one row per online node per refresh. */
function recordClusterNodeLoadSamples(connectionId, nodes, recordedAtIso) {
    const cid = String(connectionId || '').trim();
    if (!cid || !Array.isArray(nodes)) return;
    const ts = recordedAtIso || new Date().toISOString();
    const db = getDbSync();
    for (const node of nodes) {
        if (!node || String(node.status || '').toLowerCase() !== 'online') continue;
        const name = node.name != null ? String(node.name).trim() : '';
        const cpu = Number(node.cpu);
        const mem = Number(node.memory);
        if (!name || !Number.isFinite(cpu) || !Number.isFinite(mem)) continue;
        db.run(
            `INSERT INTO ${TABLE} (connection_id, node_name, recorded_at, temp_c, cpu_usage_pct, mem_usage_pct) VALUES (?, ?, ?, NULL, ?, ?)`,
            [cid, name, ts, cpu, mem]
        );
    }
    saveDb();
    pruneHostNodeMetricSamples();
}

/**
 * @param {'temp'|'cpu'|'mem'} metric
 * @returns {{ t: string, v: number }[]}
 */
function getHostNodeMetricHistory(connectionId, nodeName, metric) {
    const col = METRIC_COLUMN[metric];
    if (!col) return [];
    const cid = String(connectionId || '').trim();
    const nn = String(nodeName || '').trim();
    if (!cid || !nn) return [];
    const db = getDbSync();
    const retention = getRetentionHours();
    const stmt = db.prepare(
        `SELECT recorded_at, ${col} AS v FROM ${TABLE}
         WHERE connection_id = ? AND node_name = ?
           AND datetime(recorded_at) >= datetime('now', ?)
           AND ${col} IS NOT NULL
         ORDER BY recorded_at ASC`
    );
    stmt.bind([cid, nn, `-${retention} hours`]);
    const out = [];
    while (stmt.step()) {
        const row = stmt.get();
        const iso = row[0];
        const v = Number(row[1]);
        if (!iso || !Number.isFinite(v)) continue;
        out.push({ t: iso, v });
    }
    stmt.free();
    return out;
}

/** @deprecated use getHostNodeMetricHistory(..., 'temp') */
function getHostCpuTempHistory(connectionId, nodeName) {
    return getHostNodeMetricHistory(connectionId, nodeName, 'temp');
}

module.exports = {
    recordHostCpuTempSamples,
    recordClusterNodeLoadSamples,
    getHostNodeMetricHistory,
    getHostCpuTempHistory,
    pruneHostNodeMetricSamples,
    getRetentionHours
};
