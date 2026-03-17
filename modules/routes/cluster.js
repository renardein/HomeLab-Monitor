const express = require('express');
const router = express.Router();
const proxmox = require('../proxmox-api');
const cache = require('../cache');
const { formatBytes, log } = require('../utils');
const checkAuth = require('../middleware/auth');

// Полная информация о кластере
router.get('/full', checkAuth, async (req, res) => {
    const cacheKey = `cluster_full_${req.token}`;
    const cached = cache.get(cacheKey);
    
    if (cached) {
        return res.json(cached);
    }
    
    try {
        // Получаем список узлов
        const nodes = await proxmox.getNodes(req.token);
        log('info', `Found ${nodes.length} nodes`);
        
        // Получаем статус кластера
        const clusterStatus = await proxmox.getClusterStatus(req.token);
        
        // Получаем ресурсы кластера
        const clusterResources = await proxmox.getClusterResources(req.token);
        
        // Инициализируем суммарные ресурсы
        const clusterSummary = {
            totalCPU: 0,
            usedCPU: 0,
            totalMemory: 0,
            usedMemory: 0,
            totalVMs: 0,
            totalContainers: 0
        };
        
        // Получаем детальную информацию по каждому узлу
        const nodesDetails = await Promise.all(
            nodes.map(async (node) => {
                const nodeName = node.node || node.name;
                try {
                    const status = await proxmox.getNodeStatus(nodeName, req.token);
                    
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
                        status: node.status || 'unknown',
                        cpu: cpuUsage ? Math.round(cpuUsage * 100) : 0,
                        cpuCount: cpuCount,
                        memory: usedMem > 0 ? Math.round((usedMem / totalMem) * 100) : 0,
                        memoryUsed: usedMem,
                        memoryTotal: totalMem,
                        uptime: status.uptime || 0,
                        maxCpu: cpuCount,
                        totalMemory: totalMem
                    };
                } catch (error) {
                    log('error', `Error fetching node ${nodeName}: ${error.message}`);
                    return {
                        name: nodeName,
                        status: 'offline',
                        cpu: 0,
                        cpuCount: 0,
                        memory: 0,
                        memoryUsed: 0,
                        memoryTotal: 0,
                        uptime: 0
                    };
                }
            })
        );
        
        // Считаем VM и контейнеры
        clusterResources.forEach(resource => {
            if (resource.type === 'qemu') {
                clusterSummary.totalVMs++;
            } else if (resource.type === 'lxc') {
                clusterSummary.totalContainers++;
            }
        });
        
        // Формируем данные о кворуме
        const quorumNodes = clusterStatus.length > 0 
            ? clusterStatus.filter(item => item.type === 'node').map(item => ({
                name: item.name,
                online: nodesDetails.find(n => n.name === item.name)?.status === 'online',
                votes: item.votes || 1
            }))
            : nodesDetails.map(n => ({
                name: n.name,
                online: n.status === 'online',
                votes: 1
            }));
        
        const totalVotes = quorumNodes.reduce((sum, n) => sum + n.votes, 0);
        const onlineVotes = quorumNodes.filter(n => n.online).reduce((sum, n) => sum + n.votes, 0);
        
        const result = {
            nodes: nodesDetails,
            cluster: {
                summary: {
                    totalCPU: clusterSummary.totalCPU,
                    usedCPU: Math.round(clusterSummary.usedCPU),
                    cpuUsagePercent: clusterSummary.totalCPU > 0 
                        ? Math.round((clusterSummary.usedCPU / clusterSummary.totalCPU) * 100) 
                        : 0,
                    totalMemory: formatBytes(clusterSummary.totalMemory),
                    usedMemory: formatBytes(clusterSummary.usedMemory),
                    memoryUsagePercent: clusterSummary.totalMemory > 0 
                        ? Math.round((clusterSummary.usedMemory / clusterSummary.totalMemory) * 100) 
                        : 0,
                    totalVMs: clusterSummary.totalVMs,
                    totalContainers: clusterSummary.totalContainers
                }
            },
            quorum: {
                votes: onlineVotes,
                expected: totalVotes,
                quorum: Math.floor(totalVotes / 2) + 1,
                nodes: quorumNodes
            }
        };
        
        cache.set(cacheKey, result);
        res.json(result);
        
    } catch (error) {
        log('error', `Error fetching cluster data: ${error.message}`);
        res.status(500).json({ error: 'Ошибка получения данных кластера' });
    }
});

module.exports = router;
