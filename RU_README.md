# HomeLab Monitor

[English](./README.md) | [Русский](./RU_README.md)

Локальная веб-панель для Proxmox и TrueNAS с отдельными макетами обычного и monitor-режима.

## Возможности

- мониторинг кластера Proxmox VE
- мониторинг TrueNAS CORE / SCALE
- проверка сервисов по TCP, UDP, HTTP(S), SNMP и NUT
- карточки VM / CT с кастомными иконками и цветами
- мониторинг UPS и сетевых SNMP-устройств
- отдельный экран Speedtest
- дополнительные метрики хостов Proxmox: температура CPU и скорость линка с помощью [Node.js агента](./docs/proxmox_agent_manual_ru.md)
- полноэкранный режим монитора с навигацией стрелками и свайпами
- по умолчанию monitor mode использует светлую тему
- пароль на настройки, импорт / экспорт и локальное хранение в SQLite

## UI-макет

Актуальное демо интерфейса представлено по ссылке в репозитории: [`demo/index.html`](./demo/index.html).

## Быстрый запуск

Требования:

- Node.js 16+

Установка зависимостей:

```bash
npm install
```

Запуск приложения:

```bash
npm start
```

Режим разработки:

```bash
npm run dev
```

Агент host metrics:

```bash
npm run host-metrics-agent
```

Адрес по умолчанию:

```text
http://localhost:81
```

## Настройка

1. Открой приложение в браузере.
2. В `Settings` добавь подключение к Proxmox и/или TrueNAS.
3. Настрой сервисы, VM / CT, UPS, SNMP-устройства, Speedtest и host metrics.
4. При необходимости измени порядок экранов monitor mode, темы, параметры отображения и видимость экранов.
5. При необходимости включи пароль на настройки и используй импорт / экспорт.

## Примечания

- Поддержки PBS сейчас нет.
- Страницы в [`demo/`](./demo/) отражают текущий UI-макет из репозитория.

## Донаты

Если проект оказался полезен, можно поддержать его развитие:

- ETH: `0xEe57816adDf7169CfebB54Ce77dA407b6fca9815`
- BTC: `bc1qlejccr50w24ujw2yeet985whgg7p96r8e8g5ng`
- USDT TRC20: `TEMp44kLxh51SGLoZZLVvnxvzs6g1taBaN`
- TON: `UQDGINS0CtpgF6J7CFrih8SS45AutPHUViz5xWKt3siODj3x`