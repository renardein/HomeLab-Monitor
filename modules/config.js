const path = require('path');
const dotenv = require('dotenv');

// Загружаем переменные окружения
dotenv.config();

let appVersion = '1.0.0';
try {
    const pkg = require(path.join(__dirname, '..', 'package.json'));
    if (pkg && typeof pkg.version === 'string') appVersion = pkg.version;
} catch (_) {}

module.exports = {
    // Сервер
    port: process.env.PORT || 3000,
    env: process.env.NODE_ENV || 'development',
    
    // Proxmox
    proxmox: {
        host: process.env.PROXMOX_HOST || '10.200.0.1',
        port: parseInt(process.env.PROXMOX_PORT) || 8006
    },

    // TrueNAS (CORE/SCALE)
    truenas: {
        host: process.env.TRUENAS_HOST || '10.200.0.2',
        port: parseInt(process.env.TRUENAS_PORT) || 443
    },
    
    // Безопасность
    corsOrigin: process.env.CORS_ORIGIN || '*',
    
    // Кэш (базовое значение для обратной совместимости)
    cacheTTL: parseInt(process.env.CACHE_TTL) || 30,
    
    // Детальные настройки кэширования (в секундах)
    cacheTTLs: {
        default: parseInt(process.env.CACHE_TTL) || 30,
        status: 10,        // Статус кластера/узлов (часто меняется)
        config: 60,        // Конфигурация хранилищ (меняется редко)
        backup: 120,       // История бэкапов (тяжелый запрос, меняется редко)
        auth: 300          // Токен авторизации (действует долго)
    },
    
    // Язык по умолчанию
    defaultLanguage: process.env.DEFAULT_LANGUAGE || 'ru',
    
    // Версия (из package.json)
    version: appVersion,
    
    // Сетевые интерфейсы для мониторинга скорости линка
    networkInterfaces: process.env.NETWORK_INTERFACES ? 
        process.env.NETWORK_INTERFACES.split(',').map(i => i.trim()) : 
        ['eth0', 'eth1', 'eno1', 'ens1']
};
