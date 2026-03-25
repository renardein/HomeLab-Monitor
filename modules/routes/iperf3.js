const express = require('express');
const router = express.Router();
const iperf3 = require('../iperf3');

function routeErrorMessage(e) {
    if (e == null) return 'Unknown error';
    if (typeof e.message === 'string' && e.message.trim()) return e.message.trim();
    return String(e);
}

router.get('/summary', async (req, res) => {
    try {
        await iperf3.checkCliAvailable();
        res.json(iperf3.getSummaryPayload());
    } catch (e) {
        res.status(500).json({ error: routeErrorMessage(e) });
    }
});

router.post('/run', async (req, res) => {
    try {
        const out = await iperf3.runManual();
        const summary = iperf3.getSummaryPayload();
        res.json({ ...out, summary });
    } catch (e) {
        if (e && e.code === 'BUSY') {
            return res.status(409).json({ error: 'busy', message: 'Another iperf3 run is in progress' });
        }
        res.status(500).json({ error: routeErrorMessage(e) });
    }
});

router.delete('/results', (req, res) => {
    try {
        iperf3.clearAllResults();
        res.json({ ok: true, summary: iperf3.getSummaryPayload() });
    } catch (e) {
        res.status(500).json({ error: routeErrorMessage(e) });
    }
});

module.exports = router;
