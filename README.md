[zenfeed](https://github.com/glidea/zenfeed) Official lightweight WEB client

1. Deploy zenfeed

2. Connect it via Demo Website: https://zenfeed-web.pages.dev
> Default connection http://localhost:1300, configurable

> If you need to deploy it yourself, refer to the image `glidea/zenfeed-web:latest`

## Security Environment Variables

Set these variables on the **web server runtime** (not public browser env):

| Variable | Description | Default |
| :-- | :-- | :-- |
| `ZENFEED_API_AUTH_TOKEN` | Forwarded by the web proxy to backend `query_config` / `apply_config` as `Authorization: Bearer <token>`. Must match backend `api.http.auth_token`. | `""` |
| `ZENFEED_ALLOWED_BACKEND_URLS` | Allowlist for proxy `backendUrl`. Comma/space separated hosts (e.g. `localhost,127.0.0.1,zenfeed`) or origins (e.g. `http://zenfeed:1300`). | `localhost,127.0.0.1,zenfeed` |
| `ZENFEED_WEB_TOTP_SECRET` | Required Base32 TOTP secret used to verify 6-digit authenticator codes. The app refuses to start if this is missing or invalid. | Required |
| `ZENFEED_WEB_SESSION_MAX_AGE_SECONDS` | Lifetime of the signed `HttpOnly` login cookie after a successful TOTP login. | `2592000` (30 days) |

## Notes

- Web access login uses a server-verified TOTP code plus a signed, expiring `HttpOnly` cookie.
- `ZENFEED_WEB_TOTP_SECRET` must be a valid Base32 secret, such as one generated for Google Authenticator, 1Password, or similar apps.
- UI unlock is an extra guard. Backend auth (`api.http.auth_token`) should still be enabled.
- If backend API is exposed publicly, also restrict network access (firewall/reverse proxy allowlist).
