# Proxmox Host Metrics Agent

A minimal agent for a `Proxmox` host that provides:

- a list of available CPU temperature sensors
- a list of network interfaces
- the current temperature of the selected sensor
- the current link speed of the selected interface

The agent does not require external npm dependencies and runs with plain `node`.

## Files

- agent: `extras/proxmox-host-metrics-agent.js`
- example `systemd` unit: `extras/proxmox-host-metrics-agent.service.example`

## Node Requirements

Install:

```bash
apt update
apt install -y nodejs lm-sensors ethtool
```

Check that `lm-sensors` can see the sensors:

```bash
sensors -j
```

If sensors are not configured yet:

```bash
sensors-detect
```

## Manual Start

From the repository directory:

```bash
node extras/proxmox-host-metrics-agent.js
```

By default, the agent listens on:

```text
http://0.0.0.0:9105/host-metrics
```

## Environment Variables

- `HOST_METRICS_AGENT_HOST`
  - default: `0.0.0.0`
- `HOST_METRICS_AGENT_PORT`
  - default: `9105`
- `HOST_METRICS_AGENT_BASE_PATH`
  - default: `/host-metrics`
- `HOST_METRICS_COMMAND_TIMEOUT_MS`
  - default: `3000`
- `HOST_METRICS_SENSORS_BIN`
  - default: `sensors`
- `HOST_METRICS_ETHTOOL_BIN`
  - default: `ethtool`

Example:

```bash
HOST_METRICS_AGENT_PORT=9105 HOST_METRICS_AGENT_BASE_PATH=/host-metrics node extras/proxmox-host-metrics-agent.js
```

## Endpoints

### `GET /host-metrics`

Short information about the agent and its endpoints.

### `GET /host-metrics/healthz`

Agent availability check.

### `GET /host-metrics/discovery`

Example response:

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

Example:

```bash
curl "http://127.0.0.1:9105/host-metrics/current?cpuSensor=Package%20id%200&iface=enp3s0"
```

Example response:

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

## UI Integration

In the application settings, specify for each node:

- `Agent URL`
  - usually: `http://<node>:9105/host-metrics`
- `CPU Sensor`
  - from `discovery`
- `Interface`
  - from `discovery`

If the DNS name `node` cannot be resolved from the application server, use the node IP address instead:

```text
http://10.0.0.21:9105/host-metrics
```

## systemd

Copy the example `extras/proxmox-host-metrics-agent.service.example` to:

```text
/etc/systemd/system/proxmox-host-metrics-agent.service
```

Then run:

```bash
systemctl daemon-reload
systemctl enable --now proxmox-host-metrics-agent
systemctl status proxmox-host-metrics-agent
```
