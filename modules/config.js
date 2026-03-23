const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const dotenv = require('dotenv');

dotenv.config();

const PROJECT_ROOT = path.join(__dirname, '..');
/** PEM/TLS files in repo: `certs/` (see certs/README.md). Ignored by git. */
const CERT_DIR = path.join(PROJECT_ROOT, 'certs');
const DEFAULT_SSL_KEY = path.join(CERT_DIR, 'privkey.pem');
const DEFAULT_SSL_CERT = path.join(CERT_DIR, 'fullchain.pem');
const DEFAULT_SSL_CA = path.join(CERT_DIR, 'chain.pem');
const DEFAULT_SSL_KEY_CER = path.join(CERT_DIR, 'private.key');
const DEFAULT_SSL_CERT_CER = path.join(CERT_DIR, 'certificate.cer');
const DEFAULT_SSL_CA_CER = path.join(CERT_DIR, 'chain.cer');

let appVersion = '1.0.0';
try {
    const pkg = require(path.join(__dirname, '..', 'package.json'));
    if (pkg && typeof pkg.version === 'string') appVersion = pkg.version;
} catch (_) {}

function resolvePath(p) {
    const s = String(p || '').trim();
    if (!s) return '';
    return path.isAbsolute(s) ? s : path.resolve(PROJECT_ROOT, s);
}

function isPemPayload(buf) {
    const head = buf.toString('utf8', 0, Math.min(120, buf.length));
    return head.includes('-----BEGIN');
}

/** Certificate / chain: PEM text or binary DER (.cer). */
function readTlsCertificate(filePath) {
    const abs = resolvePath(filePath);
    const buf = fs.readFileSync(abs);
    if (isPemPayload(buf)) {
        return buf.toString('utf8');
    }
    const b64 = buf.toString('base64').match(/.{1,64}/g);
    if (!b64) {
        throw new Error(`Invalid certificate file: ${abs}`);
    }
    return `-----BEGIN CERTIFICATE-----\n${b64.join('\n')}\n-----END CERTIFICATE-----`;
}

/** Private key: PEM or DER PKCS#8 / PKCS#1. */
function readTlsPrivateKey(filePath) {
    const abs = resolvePath(filePath);
    const buf = fs.readFileSync(abs);
    const text = buf.toString('utf8');
    if (text.includes('-----BEGIN')) {
        return text;
    }
    try {
        const k = crypto.createPrivateKey({ key: buf, format: 'der', type: 'pkcs8' });
        return k.export({ type: 'pkcs8', format: 'pem' });
    } catch (e1) {
        try {
            const k = crypto.createPrivateKey({ key: buf, format: 'der', type: 'pkcs1' });
            return k.export({ type: 'pkcs1', format: 'pem' });
        } catch (e2) {
            throw new Error(
                `Private key must be PEM or DER PKCS#8/PKCS#1 (${abs}): ${e1.message || e1}; ${e2.message || e2}`
            );
        }
    }
}

function loadSsl() {
    let keyPath = process.env.SSL_KEY_PATH ? String(process.env.SSL_KEY_PATH).trim() : '';
    let certPath = process.env.SSL_CERT_PATH ? String(process.env.SSL_CERT_PATH).trim() : '';
    let caPath = process.env.SSL_CA_PATH ? String(process.env.SSL_CA_PATH).trim() : '';

    if (!keyPath && !certPath) {
        if (fs.existsSync(DEFAULT_SSL_KEY) && fs.existsSync(DEFAULT_SSL_CERT)) {
            keyPath = DEFAULT_SSL_KEY;
            certPath = DEFAULT_SSL_CERT;
            if (!caPath && fs.existsSync(DEFAULT_SSL_CA)) {
                caPath = DEFAULT_SSL_CA;
            }
        } else if (fs.existsSync(DEFAULT_SSL_KEY_CER) && fs.existsSync(DEFAULT_SSL_CERT_CER)) {
            keyPath = DEFAULT_SSL_KEY_CER;
            certPath = DEFAULT_SSL_CERT_CER;
            if (!caPath && fs.existsSync(DEFAULT_SSL_CA_CER)) {
                caPath = DEFAULT_SSL_CA_CER;
            }
        } else {
            return { enabled: false, options: null, error: null };
        }
    }

    if (!keyPath || !certPath) {
        return {
            enabled: false,
            options: null,
            error: 'Both SSL_KEY_PATH and SSL_CERT_PATH are required for HTTPS'
        };
    }
    try {
        const key = readTlsPrivateKey(keyPath);
        const cert = readTlsCertificate(certPath);
        const options = { key, cert };
        if (caPath) {
            options.ca = readTlsCertificate(caPath);
        }
        return { enabled: true, options, error: null };
    } catch (e) {
        return {
            enabled: false,
            options: null,
            error: e && e.message ? e.message : String(e)
        };
    }
}

function parseTrustProxy() {
    const v = process.env.TRUST_PROXY;
    if (v === undefined || v === null || String(v).trim() === '') return false;
    const s = String(v).trim().toLowerCase();
    if (s === '1' || s === 'true' || s === 'yes' || s === 'on') return 1;
    if (/^\d+$/.test(s)) return parseInt(s, 10);
    return false;
}

const ssl = loadSsl();

const trustProxy = parseTrustProxy();

const publicUrl = String(process.env.PUBLIC_URL || process.env.APP_URL || '')
    .trim()
    .replace(/\/+$/, '');

function cookieSecureDefault() {
    if (process.env.COOKIE_SECURE === '0' || process.env.COOKIE_SECURE === 'false') return false;
    if (process.env.COOKIE_SECURE === '1' || process.env.COOKIE_SECURE === 'true') return true;
    return ssl.enabled || process.env.NODE_ENV === 'production';
}

module.exports = {
    port: parseInt(process.env.PORT, 10) || 3000,
    env: process.env.NODE_ENV || 'development',
    bindHost: process.env.BIND_HOST ? String(process.env.BIND_HOST).trim() : '0.0.0.0',

    proxmox: {
        host: process.env.PROXMOX_HOST || '10.200.0.1',
        port: parseInt(process.env.PROXMOX_PORT, 10) || 8006
    },

    truenas: {
        host: process.env.TRUENAS_HOST || '10.200.0.2',
        port: parseInt(process.env.TRUENAS_PORT, 10) || 443
    },

    corsOrigin: process.env.CORS_ORIGIN || '*',

    cacheTTL: parseInt(process.env.CACHE_TTL, 10) || 30,

    cacheTTLs: {
        default: parseInt(process.env.CACHE_TTL, 10) || 30,
        status: 10,
        config: 60,
        backup: 120,
        auth: 300
    },

    defaultLanguage: process.env.DEFAULT_LANGUAGE || 'ru',

    version: appVersion,

    github: {
        repoUrl: 'https://github.com/renardein/HomeLab-Monitor',
        owner: 'renardein',
        repo: 'HomeLab-Monitor'
    },

    networkInterfaces: process.env.NETWORK_INTERFACES
        ? process.env.NETWORK_INTERFACES.split(',').map((i) => i.trim())
        : ['eth0', 'eth1', 'eno1', 'ens1'],

    ssl,
    trustProxy,
    publicUrl,
    cookieSecure: cookieSecureDefault()
};
