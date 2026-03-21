const express = require('express');
const https = require('https');
const router = express.Router();
const config = require('../config');
const cache = require('../cache');
const { log } = require('../utils');

const RELEASES_CACHE_KEY = 'github_releases_latest_check';
const RELEASES_CACHE_TTL_SEC = 60 * 60;
const VERSION_RE = /^(\d+)\.(\d+)\.(\d+)-(release|dev)$/i;

function parseVersion(version) {
    if (typeof version !== 'string') return null;
    const match = version.trim().match(VERSION_RE);
    if (!match) return null;
    return {
        raw: version.trim(),
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

    const channelRank = { dev: 0, release: 1 };
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

async function loadLatestReleaseInfo() {
    const cached = cache.get(RELEASES_CACHE_KEY);
    if (cached) return cached;

    const url = `https://api.github.com/repos/${config.github.owner}/${config.github.repo}/releases?per_page=20`;
    const releases = await fetchJson(url);
    const compatibleReleases = Array.isArray(releases)
        ? releases
            .map((release) => {
                const rawVersion = resolveReleaseVersion(release);
                const parsed = parseVersion(rawVersion);
                if (!parsed) return null;
                return {
                    version: parsed.raw,
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

router.get('/', async (req, res) => {
    try {
        const payload = await loadLatestReleaseInfo();
        res.json(payload);
    } catch (error) {
        log('warn', '[Updates] GitHub releases check failed', {
            message: error && error.message ? error.message : String(error)
        });
        res.status(502).json({
            currentVersion: config.version,
            latestVersion: null,
            updateAvailable: false,
            releaseUrl: `${config.github.repoUrl}/releases`,
            repoUrl: config.github.repoUrl,
            checkedAt: new Date().toISOString(),
            error: error && error.message ? error.message : 'failed_to_check_updates'
        });
    }
});

module.exports = router;
