# DISCOMFORT

Verified effort only. A rep that isn't seen doesn't exist.

Camera + MediaPipe Pose, all processing on-device — frames never leave the phone,
only numeric results. Vite + React + TypeScript + Tailwind v4.

## Status

Phases 1–2: camera + Pose skeleton overlay, push-up tracker (hard shallow rule),
FAR MODE session screen (giant mono counter, fault flashes, Web Audio signals,
debug angle overlay). No Supabase yet.

## Develop

```bash
npm install
npm run dev        # HTTPS dev server (self-signed) so phones on the LAN get camera access
```

Open the printed **Network** URL on a phone, accept the self-signed cert warning.

## Deploy — Cloudflare Pages (connected to this GitHub repo)

Build settings in the Cloudflare Pages dashboard:

| Setting | Value |
| --- | --- |
| Framework preset | Vite |
| Build command | `npm run build` |
| Build output directory | `dist` |
| Node version | 20 or newer (env var `NODE_VERSION` if needed) |

Every push to `main` triggers a production deploy.
