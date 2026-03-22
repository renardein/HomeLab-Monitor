const express = require('express');
const router = express.Router();
const speedtest = require('../speedtest');

router.get('/summary', async (req, res) => {
    try {
        await speedtest.checkCliAvailable();
        res.json(speedtest.getSummaryPayload());
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
});

router.post('/run', async (req, res) => {
    try {
        const out = await speedtest.runManual();
        const summary = speedtest.getSummaryPayload();
        res.json({ ...out, summary });
    } catch (e) {
        if (e.code === 'BUSY') {
            return res.status(409).json({ error: 'busy', message: 'Another speedtest is running' });
        }
        res.status(500).json({ error: e.message });
    }
});

router.delete('/results', (req, res) => {
    try {
        speedtest.clearAllResults();
        res.json({ ok: true, summary: speedtest.getSummaryPayload() });
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
});

module.exports = router;
