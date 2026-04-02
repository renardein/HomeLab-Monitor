const { getDbSync, saveDb } = require('./db');

const RETENTION_HOURS = 24;
const TABLE = 'smart_sensor_metric_samples';

function pruneSmartSensorMetricSamples() {
    try {
        const db = getDbSync();
        db.run(`DELETE FROM ${TABLE} WHERE datetime(recorded_at) < datetime('now', ?)`, [`-${RETENTION_HOURS} hours`]);
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
    const stmt = db.prepare(
        `SELECT recorded_at, value FROM ${TABLE}
         WHERE sensor_id = ?
           AND field_key = ?
           AND datetime(recorded_at) >= datetime('now', ?)
         ORDER BY recorded_at ASC`
    );
    stmt.bind([sid, fk, `-${RETENTION_HOURS} hours`]);
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
    SMART_SENSOR_METRIC_RETENTION_HOURS: RETENTION_HOURS
};
