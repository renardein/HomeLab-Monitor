# TLS certificates (project folder)

Place files here. They are **not** committed to git (see `.gitignore`).

Supported content:

- **PEM** (text with `-----BEGIN …-----`) — typical for `.pem`, and often for `.key` / `.cer`.
- **DER** (binary): single certificate in `.cer` is converted to PEM automatically; private key in `.key` as PKCS#8 or PKCS#1 DER is supported.

## Option A — PEM names (Let’s Encrypt style)

| File | Role |
|------|------|
| `privkey.pem` | Private key |
| `fullchain.pem` | Certificate + intermediates |
| `chain.pem` | Optional extra chain if not using fullchain |

## Option B — `.key` + `.cer` names

If **A** is not used, HTTPS is enabled when this pair exists:

| File | Role |
|------|------|
| `private.key` | Private key |
| `certificate.cer` | Server certificate (PEM or DER) |
| `chain.cer` | Optional; loaded if present when `SSL_CA_PATH` is not set |

## Overrides

Set `SSL_KEY_PATH`, `SSL_CERT_PATH`, and optionally `SSL_CA_PATH` in `.env` (absolute paths or paths relative to the project root). Any of the extensions above works.

### Example: Let’s Encrypt (PEM)

```bash
sudo cp /etc/letsencrypt/live/your.domain/privkey.pem ./certs/privkey.pem
sudo cp /etc/letsencrypt/live/your.domain/fullchain.pem ./certs/fullchain.pem
sudo chown "$USER:$USER" certs/*.pem
```

### Example: export as `private.key` / `certificate.cer`

Copy your PEM/DER key and certificate into `certs/private.key` and `certs/certificate.cer` using the names in the table (Option B).
