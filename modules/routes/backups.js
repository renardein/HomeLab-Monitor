const express = require('express');
const router = express.Router();
const proxmox = require('../proxmox-api');
const { formatDate, calculateNextRun, log } = require('../utils');
const checkAuth = require('../middleware/auth');
const { getCachedOrFetch } = require('../proxmox-route-cache');

router.get('/jobs', checkAuth, async (req, res) => {
    try {
        const result = await getCachedOrFetch('backup_jobs_v4', req, async () => {
            const [jobs, tasksByNode] = await Promise.all([
                proxmox.getBackupJobs(req.token, req.serverUrl || null),
                proxmox.getVzdumpLastTasksPerNode(req.token, req.serverUrl || null, 10)
            ]);

            const jobDefinitions = jobs.map((job) => ({
                id: job.id,
                schedule: job.schedule || '',
                enabled: job.enabled === 1,
                storage: job.storage || '',
                mode: job.mode || 'snapshot',
                vmid: job.vmid,
                compress: job.compress,
                mailto: job.mailto,
                next_run: calculateNextRun(job.schedule)
            }));

            const taskStart = (t) => Number(t.starttime) || Number(t.pstart) || 0;
            const mapExec = (t, nodeName) => {
                const st = taskStart(t);
                const en = Number(t.endtime) || 0;
                return {
                    upid: t.upid || '',
                    node: nodeName || t.node || '',
                    id: t.id,
                    user: t.user || '',
                    starttime: st || t.starttime,
                    starttime_fmt: st ? formatDate(st) : '',
                    endtime: en || t.endtime,
                    endtime_fmt: en ? formatDate(en) : '',
                    status: t.status || '',
                    exitstatus: t.exitstatus != null ? String(t.exitstatus) : ''
                };
            };

            const executionsByNode = {};
            for (const [node, arr] of Object.entries(tasksByNode || {})) {
                executionsByNode[node] = (arr || []).map((t) => mapExec(t, node));
            }

            const vzdumpTasks = Object.values(executionsByNode)
                .flat()
                .sort((a, b) => (Number(b.starttime) || 0) - (Number(a.starttime) || 0));

            const execOk = vzdumpTasks.filter(
                (t) => t.status === 'OK' || String(t.exitstatus).toLowerCase() === 'ok'
            ).length;
            const execErr = vzdumpTasks.filter(
                (t) => t.status === 'error' || String(t.exitstatus).toLowerCase() === 'error'
            ).length;
            const execRun = vzdumpTasks.filter((t) => t.status === 'running').length;

            const stats = {
                total: jobDefinitions.length,
                enabled: jobDefinitions.filter((j) => j.enabled).length,
                disabled: jobDefinitions.filter((j) => !j.enabled).length
            };

            const execution_stats = {
                shown: vzdumpTasks.length,
                success: execOk,
                error: execErr,
                running: execRun
            };

            return {
                jobs: jobDefinitions,
                executions: vzdumpTasks,
                executions_by_node: executionsByNode,
                stats,
                execution_stats
            };
        });

        res.json(result);
    } catch (error) {
        log('error', `Error fetching backup jobs: ${error.message}`);
        if (error?.response?.status) {
            const st = error.response.status;
            res.status(st).json({
                error: st === 401 ? 'Требуется API токен (или токен неверный)' : `Ошибка API: ${st}`
            });
        } else {
            res.status(500).json({ error: 'Ошибка получения заданий бэкапа' });
        }
    }
});

module.exports = router;
