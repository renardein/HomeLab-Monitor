const { getDbSync, saveDb } = require('./db');
const settingsStore = require('./settings-store');

const DEFAULT_RETENTION_HOURS = 72;
const TABLE = 'cluster_aggregate_samples';

function getRetentionHours() {
    const raw = settingsStore.getSetting('metrics_history_retention_hours_cluster') || settingsStore.getSetting('metrics_history_retention_hours');
    let n = parseInt(raw, 10);
    if (!Number.isFinite(n) || n < 24) n = DEFAULT_RETENTION_HOURS;
    if (n > 24 * 30) n = 24 * 30;
    return n;
}

function pruneClusterAggregateSamples() {
    try {
        const retention = getRetentionHours();
        const db = getDbSync();
        db.run(`DELETE FROM ${TABLE} WHERE datetime(recorded_at) < datetime('now', ?)`, [`-${retention} hours`]);
        saveDb();
    } catch (_) {
        /* ignore */
    }
}

/** Одна строка на опрос /api/cluster/full (агрегат по кластеру). */
function recordClusterAggregateSamples(connectionId, cpuPct, memPct, recordedAtIso) {
    const cid = String(connectionId || '').trim();
    if (!cid) return;
    const cpu = Number(cpuPct);
    const mem = Number(memPct);
    if (!Number.isFinite(cpu) || !Number.isFinite(mem)) return;
    const ts = recordedAtIso || new Date().toISOString();
    const db = getDbSync();
    db.run(
        `INSERT INTO ${TABLE} (connection_id, recorded_at, cpu_usage_pct, mem_usage_pct) VALUES (?, ?, ?, ?)`,
        [cid, ts, cpu, mem]
    );
    saveDb();
    pruneClusterAggregateSamples();
}

/**
 * @param {'cpu'|'mem'} metric
 * @returns {{ t: string, v: number }[]}
 */
function getClusterAggregateHistory(connectionId, metric) {
    const col = metric === 'cpu' ? 'cpu_usage_pct' : metric === 'mem' ? 'mem_usage_pct' : null;
    if (!col) return [];
    const cid = String(connectionId || '').trim();
    if (!cid) return [];
    const db = getDbSync();
    const retention = getRetentionHours();
    const stmt = db.prepare(
        `SELECT recorded_at, ${col} AS v FROM ${TABLE}
         WHERE connection_id = ?
           AND datetime(recorded_at) >= datetime('now', ?)
           AND ${col} IS NOT NULL
         ORDER BY recorded_at ASC`
    );
    stmt.bind([cid, `-${retention} hours`]);
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

module.exports = {
    recordClusterAggregateSamples,
    getClusterAggregateHistory,
    pruneClusterAggregateSamples,
    getRetentionHours
};
