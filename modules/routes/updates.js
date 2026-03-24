const path = require('path');
const fs = require('fs');
const { spawnSync } = require('child_process');
const express = require('express');
const https = require('https');
const router = express.Router();
const config = require('../config');
const cache = require('../cache');
const store = require('../settings-store');
const { log } = require('../utils');
const { closeDb } = require('../db');

const RELEASES_CACHE_KEY = 'github_releases_latest_check';
const RELEASES_CACHE_TTL_SEC = 60 * 60;
const VERSION_RE = /^v?(\d+)\.(\d+)\.(\d+)-(alpha|beta|dev|release|hotfix)$/i;

function parseVersion(version) {
    if (typeof version !== 'string') return null;
    const match = version.trim().match(VERSION_RE);
    if (!match) return null;
    const raw = version.trim();
    const normalizedRaw = raw.startsWith('v') || raw.startsWith('V') ? raw.slice(1) : raw;
    return {
        raw: normalizedRaw,
        major: parseInt(match[1], 10),
        minor: parseInt(match[2], 10),
        patch: parseInt(match[3], 10),
        channel: match[4].toLowerCase()
    };
}

function compareVersions(a, b) {
    const parsedA = parseVersion(a);
    const parsedB = parseVersion(b);
    if (!parsedA || !parsedB) return 0;

    if (parsedA.major !== parsedB.major) return parsedA.major - parsedB.major;
    if (parsedA.minor !== parsedB.minor) return parsedA.minor - parsedB.minor;
    if (parsedA.patch !== parsedB.patch) return parsedA.patch - parsedB.patch;

    const channelRank = {
        alpha: 0,
        beta: 1,
        dev: 2,
        release: 3,
        hotfix: 4
    };
    return (channelRank[parsedA.channel] || 0) - (channelRank[parsedB.channel] || 0);
}

function resolveReleaseVersion(release) {
    const candidates = [release && release.tag_name, release && release.name]
        .map((value) => String(value || '').trim())
        .filter(Boolean);

    for (const candidate of candidates) {
        const parsed = parseVersion(candidate);
        if (parsed) return parsed.raw;
    }

    return '';
}

function fetchJson(url) {
    return new Promise((resolve, reject) => {
        const req = https.get(url, {
            headers: {
                'Accept': 'application/vnd.github+json',
                'User-Agent': `HomeLab-Monitor/${config.version}`
            }
        }, (res) => {
            let body = '';

            res.setEncoding('utf8');
            res.on('data', (chunk) => { body += chunk; });
            res.on('end', () => {
                if (res.statusCode < 200 || res.statusCode >= 300) {
                    return reject(new Error(`GitHub API returned ${res.statusCode}`));
                }
                try {
                    resolve(JSON.parse(body));
                } catch (error) {
                    reject(new Error(`Failed to parse GitHub response: ${error.message}`));
                }
            });
        });

        req.on('error', reject);
        req.setTimeout(10000, () => {
            req.destroy(new Error('GitHub API request timed out'));
        });
    });
}

async function loadLatestReleaseInfo(options = {}) {
    const bypassCache = !!options.bypassCache;
    if (!bypassCache) {
        const cached = cache.get(RELEASES_CACHE_KEY);
        if (cached) return cached;
    }

    const url = `https://api.github.com/repos/${config.github.owner}/${config.github.repo}/releases?per_page=20`;
    const releases = await fetchJson(url);
    const compatibleReleases = Array.isArray(releases)
        ? releases
            .map((release) => {
                const rawVersion = resolveReleaseVersion(release);
                const parsed = parseVersion(rawVersion);
                if (!parsed) return null;
                const tagName = String(release.tag_name || '').trim() || null;
                return {
                    version: parsed.raw,
                    tagName,
                    parsed,
                    name: release.name || parsed.raw,
                    url: release.html_url || `${config.github.repoUrl}/releases`,
                    publishedAt: release.published_at || release.created_at || null,
                    prerelease: !!release.prerelease
                };
            })
            .filter(Boolean)
        : [];

    compatibleReleases.sort((left, right) => compareVersions(right.version, left.version));
    const latest = compatibleReleases[0] || null;

    const payload = {
        currentVersion: config.version,
        latestVersion: latest ? latest.version : null,
        latestTag: latest ? (latest.tagName || latest.version) : null,
        updateAvailable: latest ? compareVersions(latest.version, config.version) > 0 : false,
        releaseName: latest ? latest.name : null,
        releaseUrl: latest ? latest.url : `${config.github.repoUrl}/releases`,
        repoUrl: config.github.repoUrl,
        publishedAt: latest ? latest.publishedAt : null,
        checkedAt: new Date().toISOString()
    };

    cache.set(RELEASES_CACHE_KEY, payload, RELEASES_CACHE_TTL_SEC);
    return payload;
}

function mergeApplyMeta(payload) {
    const hasPwd = store.hasSettingsPassword();
    const hasTok = !!config.updateApply.token;
    return Object.assign(payload, {
        applyEnabled: config.updateApply.enabled,
        canApply: config.updateApply.enabled && (hasPwd || hasTok),
        hasSettingsPassword: hasPwd,
        hasApplyToken: hasTok
    });
}

function authorizeUpdateApply(req) {
    const envToken = config.updateApply.token;
    const body = req.body || {};
    const sentToken = String(req.headers['x-update-apply-token'] || body.applyToken || '').trim();
    const password = body.password != null ? String(body.password) : '';
    const hasPwd = store.hasSettingsPassword();
    const hasTok = !!envToken;

    if (!hasPwd && !hasTok) {
        return { ok: false, status: 403, error: 'update_apply_not_configured' };
    }
    const tokenOk = hasTok && sentToken.length > 0 && sentToken === envToken;
    const pwdOk = hasPwd && password.length > 0 && store.verifySettingsPassword(password);
    if (tokenOk || pwdOk) return { ok: true };

    if (hasPwd && hasTok) {
        return { ok: false, status: 401, error: 'update_apply_unauthorized' };
    }
    if (hasPwd && !hasTok) {
        if (!password) return { ok: false, status: 401, error: 'update_apply_password_required' };
        return { ok: false, status: 401, error: 'update_apply_unauthorized' };
    }
    if (!sentToken) return { ok: false, status: 401, error: 'update_apply_token_required' };
    return { ok: false, status: 401, error: 'update_apply_invalid_token' };
}

function runCmd(cmd, args, cwd, timeoutMs) {
    const r = spawnSync(cmd, args, {
        cwd,
        encoding: 'utf8',
        maxBuffer: 25 * 1024 * 1024,
        timeout: timeoutMs || 300000,
        shell: false,
        env: {
            ...process.env,
            npm_config_audit: 'false',
            npm_config_fund: 'false'
        }
    });
    if (r.error) {
        const e = new Error(r.error.message || String(r.error));
        e.code = 'spawn_error';
        throw e;
    }
    if (r.status !== 0) {
        const msg = (r.stderr || r.stdout || '').trim() || `${cmd} exited ${r.status}`;
        const e = new Error(msg);
        e.code = 'nonzero_exit';
        throw e;
    }
    return [r.stdout || '', r.stderr || ''].filter(Boolean).join('\n').trim();
}

function readPackageVersionDisk(root) {
    const p = path.join(root, 'package.json');
    const raw = fs.readFileSync(p, 'utf8');
    const pkg = JSON.parse(raw);
    return pkg && typeof pkg.version === 'string' ? pkg.version.trim() : null;
}

function gitWorkingTreePorcelain(root) {
    const r = spawnSync('git', ['status', '--porcelain'], {
        cwd: root,
        encoding: 'utf8',
        shell: false
    });
    if (r.error || r.status !== 0) return null;
    return String(r.stdout || '').trim();
}

router.get('/apply-info', (req, res) => {
    try {
        const hasPwd = store.hasSettingsPassword();
        const hasTok = !!config.updateApply.token;
        res.json({
            applyEnabled: config.updateApply.enabled,
            canApply: config.updateApply.enabled && (hasPwd || hasTok),
            hasSettingsPassword: hasPwd,
            hasApplyToken: hasTok
        });
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
});

router.post('/apply', async (req, res) => {
    if (!config.updateApply.enabled) {
        return res.status(403).json({ success: false, error: 'update_apply_disabled' });
    }
    const auth = authorizeUpdateApply(req);
    if (!auth.ok) {
        return res.status(auth.status).json({ success: false, error: auth.error });
    }

    const root = config.projectRoot;
    if (!fs.existsSync(path.join(root, '.git'))) {
        return res.status(400).json({ success: false, error: 'update_apply_not_git_repo' });
    }

    let info;
    try {
        info = await loadLatestReleaseInfo({ bypassCache: true });
    } catch (e) {
        return res.status(502).json({ success: false, error: 'failed_to_check_updates' });
    }

    if (!info.updateAvailable || !info.latestVersion) {
        return res.status(400).json({ success: false, error: 'update_apply_already_up_to_date' });
    }

    const dirty = gitWorkingTreePorcelain(root);
    if (dirty === null) {
        return res.status(500).json({ success: false, error: 'update_apply_git_status_failed' });
    }
    if (dirty.length > 0) {
        return res.status(409).json({ success: false, error: 'update_apply_working_tree_dirty' });
    }

    const ref = info.latestTag || info.latestVersion;

    try {
        runCmd('git', ['fetch', 'origin', '--tags'], root, 180000);
        runCmd('git', ['checkout', ref], root, 120000);
        runCmd('npm', ['install', '--omit=dev'], root, 600000);
    } catch (e) {
        log('error', '[Updates] apply failed', { message: e.message });
        return res.status(500).json({
            success: false,
            error: 'update_apply_command_failed',
            detail: e.message
        });
    }

    cache.del(RELEASES_CACHE_KEY);
    let newVersion = null;
    try {
        newVersion = readPackageVersionDisk(root);
    } catch (_) {}

    log('info', '[Updates] apply completed', { ref, newVersion, previousVersion: config.version });

    res.json({
        success: true,
        ref,
        previousVersion: config.version,
        newVersion,
        message: 'update_apply_restarting'
    });

    setTimeout(() => {
        try {
            closeDb();
        } catch (_) {}
        process.exit(0);
    }, 500);
});

router.get('/', async (req, res) => {
    try {
        const q = req.query || {};
        const bypassCache = q.refresh === '1' || q.refresh === 'true' || q.force === '1' || q.force === 'true';
        const payload = await loadLatestReleaseInfo({ bypassCache });
        res.json(mergeApplyMeta(payload));
    } catch (error) {
        log('warn', '[Updates] GitHub releases check failed', {
            message: error && error.message ? error.message : String(error)
        });
        res.status(502).json(mergeApplyMeta({
            currentVersion: config.version,
            latestVersion: null,
            latestTag: null,
            updateAvailable: false,
            releaseUrl: `${config.github.repoUrl}/releases`,
            repoUrl: config.github.repoUrl,
            checkedAt: new Date().toISOString(),
            error: error && error.message ? error.message : 'failed_to_check_updates'
        }));
    }
});

module.exports = router;
