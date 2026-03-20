// Форматирование размера байтов
function formatBytes(bytes) {
    if (!bytes || bytes === 0) return '0 B';
    const units = ['B', 'KB', 'MB', 'GB', 'TB', 'PB'];
    let value = bytes;
    let unitIndex = 0;
    while (value >= 1024 && unitIndex < units.length - 1) {
        value /= 1024;
        unitIndex++;
    }
    return `${value.toFixed(1)} ${units[unitIndex]}`;
}

// Форматирование даты
function formatDate(timestamp) {
    if (!timestamp) return 'N/A';
    const date = new Date(timestamp * 1000);
    return date.toLocaleString('ru-RU');
}

// Форматирование времени работы
function formatUptime(seconds) {
    if (!seconds || seconds === 0) return 'N/A';
    const days = Math.floor(seconds / 86400);
    const hours = Math.floor((seconds % 86400) / 3600);
    const minutes = Math.floor((seconds % 3600) / 60);
    
    if (days > 0) return `${days}д ${hours}ч`;
    if (hours > 0) return `${hours}ч ${minutes}м`;
    return `${minutes}м`;
}

const fs = require('fs');
const path = require('path');

// Логирование с меткой времени + запись на диск с ротацией.
function log(level, message, data = null) {
    const timestamp = new Date().toISOString();
    const logEntry = `[${timestamp}] [${level.toUpperCase()}] ${message}`;

    // 1) Always keep console output (dev/operator convenience)
    console.log(logEntry);
    if (data) console.log(JSON.stringify(data, null, 2));

    // 2) Best-effort file append with rotation
    try {
        const logDir = process.env.LOG_DIR
            ? String(process.env.LOG_DIR)
            : path.join(__dirname, '..', 'data', 'logs');
        const maxBytes = parseInt(process.env.LOG_MAX_BYTES || String(5 * 1024 * 1024), 10);
        const backups = parseInt(process.env.LOG_BACKUPS || String(5), 10);

        if (!fs.existsSync(logDir)) fs.mkdirSync(logDir, { recursive: true });

        const basePath = path.join(logDir, 'app.log');
        const rotatedPath = (i) => (i === 0 ? basePath : `${basePath}.${i}`);

        // Rotate if needed
        if (fs.existsSync(basePath)) {
            const st = fs.statSync(basePath);
            if (st.size >= maxBytes) {
                // Remove oldest backup to avoid rename collisions on Windows.
                if (backups >= 1) {
                    const oldest = rotatedPath(backups);
                    if (fs.existsSync(oldest)) fs.unlinkSync(oldest);
                }

                for (let i = backups - 1; i >= 1; i--) {
                    const from = rotatedPath(i);
                    const to = rotatedPath(i + 1);
                    if (fs.existsSync(from)) {
                        if (fs.existsSync(to)) fs.unlinkSync(to);
                        fs.renameSync(from, to);
                    }
                }

                // Move current app.log -> app.log.1
                if (fs.existsSync(rotatedPath(1))) fs.unlinkSync(rotatedPath(1));
                fs.renameSync(basePath, rotatedPath(1));
            }
        }

        const filePayload = data ? `${logEntry}\n${JSON.stringify(data).slice(0, 20000)}\n` : `${logEntry}\n`;
        fs.appendFileSync(basePath, filePayload, 'utf8');
    } catch (_) {
        // Do not fail the app due to logging issues.
    }
}

// Расчет следующего запуска по cron (упрощенно)
function calculateNextRun(schedule) {
    if (!schedule) return 'N/A';
    
    const now = new Date();
    // Для демо возвращаем заглушку
    const next = new Date(now.getTime() + 24 * 60 * 60 * 1000);
    return next.toLocaleString('ru-RU');
}

module.exports = {
    formatBytes,
    formatDate,
    formatUptime,
    log,
    calculateNextRun
};
