const { getDbSync, saveDb } = require('./db');
const settingsStore = require('./settings-store');

const DEFAULT_RETENTION_HOURS = 72;
const TABLE = 'smart_sensor_metric_samples';

function getRetentionHours() {
    const raw = settingsStore.getSetting('metrics_history_retention_hours_smart') || settingsStore.getSetting('metrics_history_retention_hours');
    let n = parseInt(raw, 10);
    if (!Number.isFinite(n) || n < 24) n = DEFAULT_RETENTION_HOURS;
    if (n > 24 * 30) n = 24 * 30;
    return n;
}

function pruneSmartSensorMetricSamples() {
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
 * Запись числовых полей из /current (values[key].value) для графиков Tiles.
 * @param {Array<{ id?: string, error?: string|null, values?: object }>} items
 * @param {string} recordedAtIso
 */
function recordSmartSensorSamplesFromItems(items, recordedAtIso) {
    if (!Array.isArray(items) || !items.length) return;
    const ts = recordedAtIso || new Date().toISOString();
    const db = getDbSync();
    let wrote = false;
    for (const item of items) {
        if (!item || item.error) continue;
        const sensorId = String(item.id || '').trim();
        if (!sensorId) continue;
        const vals = item.values && typeof item.values === 'object' ? item.values : {};
        for (const [fieldKey, entry] of Object.entries(vals)) {
            const fk = String(fieldKey || '').trim().slice(0, 128);
            if (!fk) continue;
            const v = entry && entry.value != null ? Number(entry.value) : NaN;
            if (!Number.isFinite(v)) continue;
            db.run(
                `INSERT INTO ${TABLE} (sensor_id, field_key, recorded_at, value) VALUES (?, ?, ?, ?)`,
                [sensorId, fk, ts, v]
            );
            wrote = true;
        }
    }
    if (wrote) {
        saveDb();
        pruneSmartSensorMetricSamples();
    }
}

/**
 * @param {string} sensorId
 * @param {string} fieldKey
 * @returns {{ points: { t: string, v: number }[] }}
 */
function getSmartSensorMetricHistory(sensorId, fieldKey) {
    const sid = String(sensorId || '').trim();
    const fk = String(fieldKey || '').trim();
    if (!sid || !fk) return { points: [] };

    const db = getDbSync();
    const retention = getRetentionHours();
    const stmt = db.prepare(
        `SELECT recorded_at, value FROM ${TABLE}
         WHERE sensor_id = ?
           AND field_key = ?
           AND datetime(recorded_at) >= datetime('now', ?)
         ORDER BY recorded_at ASC`
    );
    stmt.bind([sid, fk, `-${retention} hours`]);
    const out = [];
    while (stmt.step()) {
        const row = stmt.get();
        const iso = row[0];
        const v = Number(row[1]);
        if (!iso || !Number.isFinite(v)) continue;
        out.push({ t: iso, v });
    }
    stmt.free();
    return { points: out };
}

module.exports = {
    recordSmartSensorSamplesFromItems,
    getSmartSensorMetricHistory,
    getRetentionHours
};
