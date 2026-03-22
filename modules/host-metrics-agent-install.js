'use strict';

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { Client } = require('ssh2');

const REMOTE_DIR = '/opt/proxmox-host-metrics-agent';
const REMOTE_AGENT = `${REMOTE_DIR}/agent.js`;
const REMOTE_UNIT = '/etc/systemd/system/proxmox-host-metrics-agent.service';

function getAgentSourcePath() {
    return path.join(__dirname, '..', 'extras', 'proxmox-host-metrics-agent.js');
}

function readAgentBuffer() {
    const p = getAgentSourcePath();
    if (!fs.existsSync(p)) {
        throw new Error(`agent source not found: ${p}`);
    }
    return fs.readFileSync(p);
}

function buildSystemdUnit() {
    return `[Unit]
Description=Proxmox host metrics agent
After=network-online.target
Wants=network-online.target

[Service]
Type=simple
User=root
WorkingDirectory=${REMOTE_DIR}
ExecStart=/usr/bin/node ${REMOTE_AGENT}
Restart=always
RestartSec=3
Environment=HOST_METRICS_AGENT_HOST=0.0.0.0
Environment=HOST_METRICS_AGENT_PORT=9105
Environment=HOST_METRICS_AGENT_BASE_PATH=/host-metrics
Environment=HOST_METRICS_COMMAND_TIMEOUT_MS=3000

[Install]
WantedBy=multi-user.target
`;
}

/**
 * План установки для предпросмотра (без SSH).
 */
function getInstallPlan() {
    const buf = readAgentBuffer();
    const sha256 = crypto.createHash('sha256').update(buf).digest('hex');
    const unit = buildSystemdUnit();
    return {
        remoteDir: REMOTE_DIR,
        remoteAgentPath: REMOTE_AGENT,
        remoteUnitPath: REMOTE_UNIT,
        agentBytes: buf.length,
        agentSha256: sha256,
        unitBytes: Buffer.byteLength(unit, 'utf8'),
        steps: [
            `mkdir -p ${REMOTE_DIR}`,
            `SFTP: write ${REMOTE_AGENT} (${buf.length} bytes, SHA256 ${sha256})`,
            `SFTP: write ${REMOTE_UNIT} (systemd unit)`,
            `chmod 755 ${REMOTE_AGENT}`,
            'systemctl daemon-reload',
            'systemctl enable --now proxmox-host-metrics-agent',
            'systemctl status proxmox-host-metrics-agent --no-pager -l'
        ],
        prerequisites: 'Requires Node.js at /usr/bin/node (typical on Debian/Proxmox VE).'
    };
}

function execRemote(conn, command) {
    return new Promise((resolve, reject) => {
        conn.exec(command, (err, stream) => {
            if (err) return reject(err);
            let stdout = '';
            let stderr = '';
            let settled = false;
            const finish = (code) => {
                if (settled) return;
                settled = true;
                const c = typeof code === 'number' ? code : 0;
                resolve({ code: c, stdout, stderr });
            };
            stream.on('data', (d) => {
                stdout += d.toString();
            });
            if (stream.stderr) {
                stream.stderr.on('data', (d) => {
                    stderr += d.toString();
                });
            }
            stream.on('exit', (code) => finish(code));
            stream.on('close', (code) => finish(code));
        });
    });
}

/** Run script in login shell so redirects, `||`, and PATH match interactive SSH. */
function bashLc(script) {
    return `/bin/bash -lc ${JSON.stringify(script)}`;
}

function sftpWriteFile(sftp, remotePath, data) {
    return new Promise((resolve, reject) => {
        if (typeof sftp.writeFile === 'function') {
            sftp.writeFile(remotePath, data, (err) => (err ? reject(err) : resolve()));
            return;
        }
        sftp.open(remotePath, 'w', (err, handle) => {
            if (err) return reject(err);
            sftp.write(handle, data, 0, data.length, 0, (err2) => {
                if (err2) {
                    sftp.close(handle, () => reject(err2));
                    return;
                }
                sftp.close(handle, (err3) => (err3 ? reject(err3) : resolve()));
            });
        });
    });
}

function withSftp(conn) {
    return new Promise((resolve, reject) => {
        conn.sftp((err, sftp) => {
            if (err) reject(err);
            else resolve(sftp);
        });
    });
}

/**
 * Подключение по SSH/SFTP, выкладка файлов и запуск systemd.
 * Пароль не логировать.
 */
async function runRemoteInstall(opts) {
    const host = String(opts.sshHost || opts.host || '').trim();
    const port = Math.min(65535, Math.max(1, parseInt(opts.sshPort != null ? opts.sshPort : 22, 10) || 22));
    const username = String(opts.sshUser || opts.user || 'root').trim();
    const password = opts.sshPassword != null ? String(opts.sshPassword) : '';

    if (!host) throw new Error('ssh host required');
    if (!username) throw new Error('ssh user required');
    if (!password) throw new Error('ssh password required');

    const agentBuf = readAgentBuffer();
    const unitBuf = Buffer.from(buildSystemdUnit(), 'utf8');

    const client = new Client();
    const logs = [];

    await new Promise((resolve, reject) => {
        client
            .on('ready', () => resolve())
            .on('error', (e) => reject(e))
            .connect({
                host,
                port,
                username,
                password,
                readyTimeout: 35000
            });
    });

    try {
        let r = await execRemote(client, `mkdir -p ${REMOTE_DIR}`);
        logs.push(`$ mkdir -p ${REMOTE_DIR}\n${r.stdout || ''}${r.stderr || ''}`.trim());

        const sftp = await withSftp(client);
        await sftpWriteFile(sftp, REMOTE_AGENT, agentBuf);
        await sftpWriteFile(sftp, REMOTE_UNIT, unitBuf);
        sftp.end();

        r = await execRemote(client, `chmod 755 ${REMOTE_AGENT}`);
        logs.push(`$ chmod 755 ${REMOTE_AGENT}\n${r.stdout || ''}${r.stderr || ''}`.trim());

        r = await execRemote(client, 'systemctl daemon-reload');
        logs.push(`$ systemctl daemon-reload\n${r.stdout || ''}${r.stderr || ''}`.trim());

        r = await execRemote(client, 'systemctl enable --now proxmox-host-metrics-agent');
        logs.push(`$ systemctl enable --now proxmox-host-metrics-agent\n${r.stdout || ''}${r.stderr || ''}`.trim());

        if (r.code !== 0) {
            throw new Error(r.stderr || r.stdout || `systemctl exit ${r.code}`);
        }

        r = await execRemote(client, 'systemctl status proxmox-host-metrics-agent --no-pager -l || true');
        logs.push(`$ systemctl status …\n${r.stdout || ''}${r.stderr || ''}`.trim());

        return { ok: true, log: logs.join('\n\n') };
    } finally {
        client.end();
    }
}

/**
 * План удаления агента (без SSH).
 */
function getUninstallPlan() {
    const steps = [
        bashLc('systemctl stop proxmox-host-metrics-agent 2>/dev/null || true'),
        bashLc('systemctl disable proxmox-host-metrics-agent 2>/dev/null || true'),
        bashLc(`rm -f ${REMOTE_UNIT}`),
        bashLc(`rm -rf ${REMOTE_DIR}`),
        bashLc('systemctl daemon-reload')
    ];
    return {
        remoteDir: REMOTE_DIR,
        remoteAgentPath: REMOTE_AGENT,
        remoteUnitPath: REMOTE_UNIT,
        steps,
        prerequisites: 'Only paths managed by this installer are removed: the unit file and /opt/proxmox-host-metrics-agent.'
    };
}

/**
 * Остановка сервиса, удаление unit и каталога агента по SSH (только exec).
 */
async function runRemoteUninstall(opts) {
    const host = String(opts.sshHost || opts.host || '').trim();
    const port = Math.min(65535, Math.max(1, parseInt(opts.sshPort != null ? opts.sshPort : 22, 10) || 22));
    const username = String(opts.sshUser || opts.user || 'root').trim();
    const password = opts.sshPassword != null ? String(opts.sshPassword) : '';

    if (!host) throw new Error('ssh host required');
    if (!username) throw new Error('ssh user required');
    if (!password) throw new Error('ssh password required');

    const client = new Client();
    const logs = [];

    await new Promise((resolve, reject) => {
        client
            .on('ready', () => resolve())
            .on('error', (e) => reject(e))
            .connect({
                host,
                port,
                username,
                password,
                readyTimeout: 35000
            });
    });

    const shellCommands = [
        bashLc('systemctl stop proxmox-host-metrics-agent 2>/dev/null || true'),
        bashLc('systemctl disable proxmox-host-metrics-agent 2>/dev/null || true'),
        bashLc(`rm -f ${REMOTE_UNIT}`),
        bashLc(`rm -rf ${REMOTE_DIR}`),
        bashLc('systemctl daemon-reload')
    ];

    try {
        for (const cmd of shellCommands) {
            const r = await execRemote(client, cmd);
            logs.push(`$ ${cmd}\n${r.stdout || ''}${r.stderr || ''}`.trim());
        }
        return { ok: true, log: logs.join('\n\n') };
    } finally {
        client.end();
    }
}

module.exports = {
    getInstallPlan,
    runRemoteInstall,
    getUninstallPlan,
    runRemoteUninstall,
    getAgentSourcePath,
    REMOTE_DIR,
    REMOTE_AGENT,
    REMOTE_UNIT
};
