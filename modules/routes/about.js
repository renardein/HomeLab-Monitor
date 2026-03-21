const express = require('express');
const fs = require('fs');
const path = require('path');

const router = express.Router();
const ABOUT_FILE_PATH = path.join(__dirname, '..', '..', 'about.md');
const PACKAGE_FILE_PATH = path.join(__dirname, '..', '..', 'package.json');

async function loadAppVersion() {
    try {
        const raw = await fs.promises.readFile(PACKAGE_FILE_PATH, 'utf8');
        const pkg = JSON.parse(raw);
        return typeof pkg.version === 'string' && pkg.version.trim()
            ? pkg.version.trim()
            : '';
    } catch (_) {
        return '';
    }
}

router.get('/', async (_req, res) => {
    try {
        const markdown = await fs.promises.readFile(ABOUT_FILE_PATH, 'utf8');
        const version = await loadAppVersion();
        const renderedMarkdown = markdown.replace(/\{\{\{version\}\}\}/g, version);
        res.json({
            success: true,
            markdown: renderedMarkdown,
            path: 'about.md'
        });
    } catch (error) {
        if (error && error.code === 'ENOENT') {
            return res.status(404).json({
                success: false,
                error: 'about_not_found'
            });
        }
        res.status(500).json({
            success: false,
            error: error && error.message ? error.message : 'failed_to_read_about'
        });
    }
});

module.exports = router;
