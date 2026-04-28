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
| `ZENFEED_ADVANCED_CONFIG_PASSWORD` | Password required to unlock "Advanced Config" tab in UI. | `""` (disabled) |
| `ZENFEED_ADVANCED_AUTH_SECRET` | HMAC secret used to sign the advanced-unlock cookie. Use a long random value. | Falls back to `ZENFEED_ADVANCED_CONFIG_PASSWORD` |

## Notes

- Advanced-config unlock uses a signed, expiring `HttpOnly` cookie. Forged plain values like `zenfeed_advanced_unlocked=1` are rejected.
- UI unlock is an extra guard. Backend auth (`api.http.auth_token`) should still be enabled.
- If backend API is exposed publicly, also restrict network access (firewall/reverse proxy allowlist).
