const { getDbSync, saveDb } = require('./db');
const settingsStore = require('./settings-store');

const DEFAULT_RETENTION_HOURS = 72;
const TABLE = 'ups_metric_samples';

function getRetentionHours() {
    const raw = settingsStore.getSetting('metrics_history_retention_hours_ups') || settingsStore.getSetting('metrics_history_retention_hours');
    let n = parseInt(raw, 10);
    if (!Number.isFinite(n) || n < 24) n = DEFAULT_RETENTION_HOURS;
    if (n > 24 * 30) n = 24 * 30;
    return n;
}

function pruneUpsMetricSamples() {
    try {
        const retention = getRetentionHours();
        const db = getDbSync();
        db.run(`DELETE FROM ${TABLE} WHERE datetime(recorded_at) < datetime('now', ?)`, [`-${retention} hours`]);
        saveDb();
    } catch (_) {
        /* ignore */
    }
}

/**
 * @param {number} upsSlot
 * @param {Array<{ id?: string, format?: string, value?: number }>} metrics
 * @param {string} recordedAtIso
 */
function recordUpsMetricSamples(upsSlot, metrics, recordedAtIso) {
    const slot = Number(upsSlot);
    if (!Number.isFinite(slot) || !Array.isArray(metrics) || !metrics.length) return;
    const ts = recordedAtIso || new Date().toISOString();
    const db = getDbSync();

    for (const m of metrics) {
        const metricId = m && m.id != null ? String(m.id).trim() : '';
        const metricFormat = m && m.format != null ? String(m.format).trim() : '';
        const v = m && m.value != null ? Number(m.value) : null;
        if (!metricId || !metricFormat) continue;
        if (!Number.isFinite(v)) continue;

        db.run(
            `INSERT INTO ${TABLE} (ups_slot, recorded_at, metric_id, metric_format, metric_value) VALUES (?, ?, ?, ?, ?)`,
            [slot, ts, metricId, metricFormat, v]
        );
    }
    saveDb();
    pruneUpsMetricSamples();
}

/**
 * @param {number} upsSlot
 * @param {string} metricId
 * @returns {{ t: string, v: number }[]}
 */
function getUpsMetricHistory(upsSlot, metricId) {
    const slot = Number(upsSlot);
    if (!Number.isFinite(slot)) return [];
    const mid = String(metricId || '').trim();
    if (!mid) return [];

    const db = getDbSync();
    const retention = getRetentionHours();
    const stmt = db.prepare(
        `SELECT recorded_at, metric_value, metric_format FROM ${TABLE}
         WHERE ups_slot = ?
           AND metric_id = ?
           AND datetime(recorded_at) >= datetime('now', ?)
         ORDER BY recorded_at ASC`
    );
    stmt.bind([slot, mid, `-${retention} hours`]);
    const out = [];
    let metricFormat = null;
    while (stmt.step()) {
        const row = stmt.get();
        const iso = row[0];
        const v = Number(row[1]);
        if (!metricFormat && row[2] != null) metricFormat = String(row[2]);
        if (!iso || !Number.isFinite(v)) continue;
        out.push({ t: iso, v });
    }
    stmt.free();
    return { points: out, metricFormat: metricFormat || null };
}

module.exports = {
    recordUpsMetricSamples,
    getUpsMetricHistory,
    pruneUpsMetricSamples,
    getRetentionHours
};

