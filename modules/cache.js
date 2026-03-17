const NodeCache = require('node-cache');
const config = require('./config');

// Создаем кэш с базовым TTL
const cache = new NodeCache({ stdTTL: config.cacheTTL });

module.exports = {
    // Получить значение из кэша
    get: (key) => cache.get(key),
    
    // Сохранить в кэш с автоматическим выбором TTL по типу данных
    set: (key, value, ttl) => {
        // Если TTL не указан явно, пытаемся определить его по ключу
        if (ttl === undefined) {
            if (key.includes('status') || key.includes('cluster') || key.includes('nodes')) {
                ttl = config.cacheTTLs.status;
            } else if (key.includes('storage') || key.includes('config')) {
                ttl = config.cacheTTLs.config;
            } else if (key.includes('backup')) {
                ttl = config.cacheTTLs.backup;
            } else if (key.includes('auth') || key.includes('token')) {
                ttl = config.cacheTTLs.auth;
            } else {
                ttl = config.cacheTTLs.default;
            }
        }
        return cache.set(key, value, ttl);
    },
    
    // Удалить из кэша
    del: (key) => cache.del(key),
    
    // Очистить кэш
    flush: () => cache.flushAll(),
    
    // Получить статистику
    stats: () => cache.getStats(),
    
    // Получить все ключи
    keys: () => cache.keys()
};
