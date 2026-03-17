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

// Логирование с меткой времени
function log(level, message, data = null) {
    const timestamp = new Date().toISOString();
    const logEntry = `[${timestamp}] [${level.toUpperCase()}] ${message}`;
    console.log(logEntry);
    if (data) {
        console.log(JSON.stringify(data, null, 2));
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
