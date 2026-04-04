const express = require('express');
const router = express.Router();
const proxmox = require('../proxmox-api');
const { formatBytes, log } = require('../utils');
const checkAuth = require('../middleware/auth');
const { getScopeKeyFromRequest, applyOfflineToClusterNodes } = require('../pve-node-offline-tracker');
const { getCachedOrFetch } = require('../proxmox-route-cache');
const { resolveProxmoxConnectionId } = require('../proxmox-connection-id');
const hostNodeMetricSamples = require('../host-cpu-temp-samples');
const clusterAggregateSamples = require('../cluster-aggregate-samples');

function safeString(v) {
    return v == null ? '' : String(v);
}

/** Вызывается на каждый GET /full (в т.ч. из кэша), чтобы история метрик обновлялась с частотой опроса. */
function recordClusterPayloadSamples(req, payload) {
    const connectionId = resolveProxmoxConnectionId(req);
    const recordedAtIso = new Date().toISOString();
    if (!connectionId || !payload) return;
    const nodes = Array.isArray(payload.nodes) ? payload.nodes : [];
    if (nodes.length) {
        try {
            hostNodeMetricSamples.recordClusterNodeLoadSamples(connectionId, nodes, recordedAtIso);
        } catch (e) {
            log('warn', `[Cluster] record node load samples: ${e.message}`);
        }
    }
    const summary = payload.cluster && payload.cluster.summary;
    if (!summary) return;
    const cpu = Number(summary.cpuUsagePercent);
    const mem = Number(summary.memoryUsagePercent);
    if (!Number.isFinite(cpu) || !Number.isFinite(mem)) return;
    try {
        clusterAggregateSamples.recordClusterAggregateSamples(connectionId, cpu, mem, recordedAtIso);
    } catch (e) {
        log('warn', `[Cluster] record aggregate samples: ${e.message}`);
    }
}

async function fetchClusterFullPayload(req) {
    const [nodes, clusterStatus, clusterResources] = await Promise.all([
        proxmox.getNodes(req.token, req.serverUrl || null),
        proxmox.getClusterStatus(req.token, req.serverUrl || null),
        proxmox.getClusterResources(req.token, req.serverUrl || null)
    ]);
    log('info', `Found ${nodes.length} nodes`);

    const nodeIpMap = proxmox.extractNodeIpMap(clusterStatus);
    const clusterNodeOrderMap = proxmox.buildClusterNodeOrderMap(clusterStatus);

    const clusterSummary = {
        totalCPU: 0,
        usedCPU: 0,
        totalMemory: 0,
        usedMemory: 0,
        totalVMs: 0,
        totalContainers: 0,
        runningVMs: 0,
        runningContainers: 0
    };

    const nodesDetailsRaw = await Promise.all(
        nodes.map(async (node) => {
            const nodeName = node.node || node.name;
            try {
                const status = await proxmox.getNodeStatus(nodeName, req.token, req.serverUrl || null);

                const cpuCount = status.cpuinfo?.cpus || 0;
                const cpuUsage = status.cpu || 0;
                clusterSummary.totalCPU += cpuCount;
                clusterSummary.usedCPU += cpuCount * cpuUsage;

                const totalMem = status.memory?.total || 0;
                const usedMem = status.memory?.used || 0;
                clusterSummary.totalMemory += totalMem;
                clusterSummary.usedMemory += usedMem;

                return {
                    name: nodeName,
                    ip: nodeIpMap[nodeName] || null,
                    status: node.status || 'unknown',
                    cpu: cpuUsage ? Math.round(cpuUsage * 100) : 0,
                    cpuCount,
                    memory: usedMem > 0 ? Math.round((usedMem / totalMem) * 100) : 0,
                    memoryUsed: usedMem,
                    memoryTotal: totalMem,
                    nodeid: (() => {
                        const n = clusterNodeOrderMap.get(nodeName);
                        return Number.isFinite(n) ? n : null;
                    })(),
                    uptime: status.uptime || 0,
                    maxCpu: cpuCount,
                    totalMemory: totalMem
                };
            } catch (error) {
                log('error', `Error fetching node ${nodeName}: ${error.message}`);
                return {
                    name: nodeName,
                    ip: nodeIpMap[nodeName] || null,
                    status: 'offline',
                    cpu: 0,
                    cpuCount: 0,
                    memory: 0,
                    memoryUsed: 0,
                    memoryTotal: 0,
                    nodeid: (() => {
                        const n = clusterNodeOrderMap.get(nodeName);
                        return Number.isFinite(n) ? n : null;
                    })(),
                    uptime: 0
                };
            }
        })
    );
    const nodesDetails = proxmox.sortRowsByClusterNodeOrder(nodesDetailsRaw, clusterStatus, (row) => row.name);

    const vms = [];
    clusterResources.forEach((resource) => {
        if (resource.type === 'qemu' || resource.type === 'lxc') {
            const st = String(resource.status || '').toLowerCase();
            const isRun = st === 'running';
            if (resource.type === 'qemu') {
                clusterSummary.totalVMs++;
                if (isRun) clusterSummary.runningVMs++;
            } else if (resource.type === 'lxc') {
                clusterSummary.totalContainers++;
                if (isRun) clusterSummary.runningContainers++;
            }
            vms.push({
                vmid: resource.vmid,
                type: resource.type === 'qemu' ? 'vm' : 'ct',
                name: resource.name || '',
                node: resource.node || '',
                status: resource.status || 'unknown'
            });
        }
    });

    const quorumNodes =
        clusterStatus.length > 0
            ? clusterStatus
                  .filter((item) => item.type === 'node')
                  .map((item) => ({
                      name: item.name,
                      nodeid: Number.isFinite(parseInt(item.nodeid, 10)) ? parseInt(item.nodeid, 10) : null,
                      online: nodesDetails.find((n) => n.name === item.name)?.status === 'online',
                      votes: item.votes || 1
                  }))
            : nodesDetails.map((n) => ({
                  name: n.name,
                  nodeid: n.nodeid != null ? n.nodeid : null,
                  online: n.status === 'online',
                  votes: 1
              }));
    const sortedQuorumNodes = proxmox.sortRowsByClusterNodeOrder(quorumNodes, clusterStatus, (row) => row.name);

    const totalVotes = sortedQuorumNodes.reduce((sum, n) => sum + n.votes, 0);
    const onlineVotes = sortedQuorumNodes.filter((n) => n.online).reduce((sum, n) => sum + n.votes, 0);

    const cpuUsagePercent =
        clusterSummary.totalCPU > 0
            ? Math.round((clusterSummary.usedCPU / clusterSummary.totalCPU) * 100)
            : 0;
    const memoryUsagePercent =
        clusterSummary.totalMemory > 0
            ? Math.round((clusterSummary.usedMemory / clusterSummary.totalMemory) * 100)
            : 0;

    return {
        nodes: nodesDetails,
        vms,
        cluster: {
            summary: {
                totalCPU: clusterSummary.totalCPU,
                usedCPU: Math.round(clusterSummary.usedCPU),
                cpuUsagePercent,
                totalMemory: formatBytes(clusterSummary.totalMemory),
                usedMemory: formatBytes(clusterSummary.usedMemory),
                memoryUsagePercent,
                totalVMs: clusterSummary.totalVMs,
                totalContainers: clusterSummary.totalContainers,
                runningVMs: clusterSummary.runningVMs,
                runningContainers: clusterSummary.runningContainers
            }
        },
        quorum: {
            votes: onlineVotes,
            expected: totalVotes,
            quorum: Math.floor(totalVotes / 2) + 1,
            nodes: sortedQuorumNodes
        }
    };
}

router.get('/metric-history', checkAuth, (req, res) => {
    const connectionId = resolveProxmoxConnectionId(req);
    const metric = safeString(req.query.metric).trim();
    if (!connectionId) {
        return res.status(400).json({ success: false, error: 'connectionId required' });
    }
    if (metric !== 'cpu' && metric !== 'mem') {
        return res.status(400).json({ success: false, error: 'metric must be cpu or mem' });
    }
    try {
        const points = clusterAggregateSamples.getClusterAggregateHistory(connectionId, metric);
        res.json({
            success: true,
            metric,
            retentionHours: clusterAggregateSamples.CLUSTER_AGGREGATE_RETENTION_HOURS,
            points
        });
    } catch (e) {
        log('error', `[Cluster] GET /metric-history: ${e.message}`);
        res.status(500).json({ success: false, error: e.message });
    }
});

router.fetchClusterFullPayload = fetchClusterFullPayload;
router.recordClusterPayloadSamples = recordClusterPayloadSamples;

router.get('/full', checkAuth, async (req, res) => {
    const scopeKey = getScopeKeyFromRequest(req);

    try {
        const payload = await getCachedOrFetch('cluster_full', req, () => fetchClusterFullPayload(req));
        recordClusterPayloadSamples(req, payload);
        const out = JSON.parse(JSON.stringify(payload));
        if (scopeKey) applyOfflineToClusterNodes(scopeKey, out.nodes);
        res.json(out);
    } catch (error) {
        log('error', `Error fetching cluster data: ${error.message}`);
        if (error?.response?.status) {
            const st = error.response.status;
            res.status(st).json({
                error: st === 401 ? 'Требуется API токен (или токен неверный)' : `Ошибка API: ${st}`
            });
        } else {
            res.status(500).json({ error: 'Ошибка получения данных кластера' });
        }
    }
});

module.exports = router;
