const express = require('express');
const router = express.Router();
const proxmox = require('../proxmox-api');
const cache = require('../cache');
const { formatDate, calculateNextRun, log } = require('../utils');
const checkAuth = require('../middleware/auth');

// Информация о заданиях бэкапа
router.get('/jobs', checkAuth, async (req, res) => {
    const cacheKey = `backup_jobs_${req.token}`;
    const cached = cache.get(cacheKey);
    
    if (cached) {
        return res.json(cached);
    }
    
    try {
        const jobs = await proxmox.getBackupJobs(req.token, req.serverUrl || null);
        const tasks = await proxmox.getClusterTasks(req.token, 50, req.serverUrl || null);
        
        const jobsWithStatus = await Promise.all(
            jobs.map(async (job) => {
                const jobTasks = tasks.filter(t => 
                    t.type === 'vzdump' && 
                    (t.id === job.id || (job.vmid && t.id && t.id.includes(job.vmid)))
                );
                
                const lastTask = jobTasks.length > 0 ? jobTasks[0] : null;
                
                let status = 'unknown';
                let lastRun = null;
                
                if (lastTask) {
                    lastRun = {
                        starttime: lastTask.starttime,
                        starttime_fmt: formatDate(lastTask.starttime),
                        endtime: lastTask.endtime,
                        endtime_fmt: formatDate(lastTask.endtime),
                        status: lastTask.status,
                        exitstatus: lastTask.exitstatus,
                        node: lastTask.node
                    };
                    
                    if (lastTask.status === 'OK' || lastTask.exitstatus === 'OK') {
                        status = 'success';
                    } else if (lastTask.status === 'error' || lastTask.exitstatus === 'error') {
                        status = 'error';
                    } else if (lastTask.status === 'running') {
                        status = 'running';
                    } else {
                        status = 'warning';
                    }
                }
                
                return {
                    id: job.id,
                    schedule: job.schedule,
                    enabled: job.enabled === 1,
                    storage: job.storage,
                    mode: job.mode,
                    vmid: job.vmid,
                    compress: job.compress,
                    mailto: job.mailto,
                    last_run: lastRun,
                    status: status,
                    next_run: calculateNextRun(job.schedule)
                };
            })
        );
        
        const stats = {
            total: jobsWithStatus.length,
            enabled: jobsWithStatus.filter(j => j.enabled).length,
            disabled: jobsWithStatus.filter(j => !j.enabled).length,
            success: jobsWithStatus.filter(j => j.status === 'success').length,
            error: jobsWithStatus.filter(j => j.status === 'error').length,
            running: jobsWithStatus.filter(j => j.status === 'running').length
        };
        
        const result = {
            jobs: jobsWithStatus,
            stats: stats
        };
        
        cache.set(cacheKey, result);
        res.json(result);
        
    } catch (error) {
        log('error', `Error fetching backup jobs: ${error.message}`);
        if (error?.response?.status) {
            const st = error.response.status;
            res.status(st).json({ error: st === 401 ? 'Требуется API токен (или токен неверный)' : `Ошибка API: ${st}` });
        } else {
            res.status(500).json({ error: 'Ошибка получения заданий бэкапа' });
        }
    }
});

module.exports = router;
