# Proxmox Host Metrics Agent

Минимальный агент для `Proxmox`-хоста, который отдает:

- список доступных температурных датчиков CPU
- список сетевых интерфейсов
- текущую температуру выбранного датчика
- текущую скорость линка выбранного интерфейса

Агент не требует внешних npm-зависимостей и запускается обычным `node`.

## Файлы

- агент: `extras/proxmox-host-metrics-agent.js`
- пример `systemd`-юнита: `extras/proxmox-host-metrics-agent.service.example`

## Требования на узле

Установить:

```bash
apt update
apt install -y nodejs lm-sensors ethtool
```

Проверить, что `lm-sensors` видит датчики:

```bash
sensors -j
```

Если датчики еще не настроены:

```bash
sensors-detect
```

## Ручной запуск

Из каталога репозитория:

```bash
node extras/proxmox-host-metrics-agent.js
```

Агент по умолчанию слушает:

```text
http://0.0.0.0:9105/host-metrics
```

## Переменные окружения

- `HOST_METRICS_AGENT_HOST`
  - по умолчанию: `0.0.0.0`
- `HOST_METRICS_AGENT_PORT`
  - по умолчанию: `9105`
- `HOST_METRICS_AGENT_BASE_PATH`
  - по умолчанию: `/host-metrics`
- `HOST_METRICS_COMMAND_TIMEOUT_MS`
  - по умолчанию: `3000`
- `HOST_METRICS_SENSORS_BIN`
  - по умолчанию: `sensors`
- `HOST_METRICS_ETHTOOL_BIN`
  - по умолчанию: `ethtool`

Пример:

```bash
HOST_METRICS_AGENT_PORT=9105 HOST_METRICS_AGENT_BASE_PATH=/host-metrics node extras/proxmox-host-metrics-agent.js
```

## Endpoints

### `GET /host-metrics`

Короткая информация об агенте и его endpoints.

### `GET /host-metrics/healthz`

Проверка доступности агента.

### `GET /host-metrics/discovery`

Пример ответа:

```json
{
  "cpuSensors": [
    "Package id 0",
    "Tctl",
    "Core 0"
  ],
  "interfaces": [
    "eno1",
    "enp3s0",
    "vmbr0"
  ],
  "updatedAt": "2026-03-21T12:00:00.000Z"
}
```

### `GET /host-metrics/current?cpuSensor=...&iface=...`

Пример:

```bash
curl "http://127.0.0.1:9105/host-metrics/current?cpuSensor=Package%20id%200&iface=enp3s0"
```

Пример ответа:

```json
{
  "cpu": {
    "sensor": "Package id 0",
    "featureLabel": "Package id 0",
    "chipName": "coretemp-isa-0000",
    "tempC": 54
  },
  "link": {
    "interface": "enp3s0",
    "speedMbps": 1000,
    "state": "up"
  },
  "updatedAt": "2026-03-21T12:00:00.000Z"
}
```

## Интеграция с UI

В настройках приложения для каждого узла указывай:

- `URL агента`
  - обычно: `http://<node>:9105/host-metrics`
- `Датчик CPU`
  - из `discovery`
- `Интерфейс`
  - из `discovery`

Если DNS-имя `node` не резолвится с сервера приложения, используй IP адрес узла:

```text
http://10.0.0.21:9105/host-metrics
```

## systemd

Скопируй пример `extras/proxmox-host-metrics-agent.service.example` в:

```text
/etc/systemd/system/proxmox-host-metrics-agent.service
```

Потом:

```bash
systemctl daemon-reload
systemctl enable --now proxmox-host-metrics-agent
systemctl status proxmox-host-metrics-agent
```
