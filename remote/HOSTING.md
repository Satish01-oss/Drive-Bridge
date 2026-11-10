# Zero-cost hosting constraint — 10 November 2026

The user has limited the current release to Windows and Android, with **no paid resources provisioned**. Mac/iPhone work is deferred. Use existing GitHub Pages for the website and tracker.

## Initial signaling trial

Render's free web service supports WebSockets and TLS, making it suitable for a small trial of this single-instance Node service. It sleeps after 15 minutes without inbound HTTP/WebSocket traffic and can take about a minute to wake. It has an ephemeral filesystem and 750 free instance-hours per workspace per month. Monthly bandwidth and build limits also apply. Avoid adding a payment method or enabling paid upgrades; when free limits are reached, stop or suspend instead of charging. Do not generate artificial traffic just to evade free-tier behavior.

Sources: [free-service limits](https://render.com/docs/free), [WebSocket behavior](https://render.com/docs/websocket). The user authorized setup in their signed-in account. `devicebridge-signaling-preview` is deployed on Free and its public HTTPS health check passes. No payment method or paid upgrade was added.

The broker's in-memory state resets at restart. Windows persists host-signed grants in DPAPI-protected storage and restores only reconnect-enabled, unexpired approvals after authenticating. Local revocation is persisted before making its network request, so a failed request cannot restore a locally removed grant. These paths pass real client/service tests; physical Android outage recovery is pending. Render's free Postgres is not used.

## Relay bandwidth

Use direct encrypted WebRTC where possible. Free STUN can help discover direct paths, but some network combinations need TURN; HTTPS website hosting alone cannot relay arbitrary WebRTC media.

Cloudflare documents free unlimited STUN and a 1,000 GB TURN free tier, with metered usage beyond it. This is a candidate for review, **not an unlimited-free guarantee**. Do not activate a billable service without a verified way to enforce the user's zero-cost requirement and their explicit authorization for any account/billing step. Without a configured relay, the app must explain when a restrictive network prevents a direct connection.

Source: [Cloudflare TURN FAQ](https://developers.cloudflare.com/realtime/turn/faq/).

## Other hosts

Railway currently advertises a small $1/month resource allowance on its free plan, which should not be confused with an always-running unlimited server. Vercel's WebSocket support is currently documented, but connections follow function lifetimes and reconnects may land on different instances; this in-memory broker would need shared durable state there. Neither is automatically provisioned.

Sources: [Railway pricing](https://docs.railway.com/pricing), [Vercel WebSocket behavior](https://vercel.com/kb/guide/do-vercel-serverless-functions-support-websocket-connections).
