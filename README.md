# ClawCraft (scaffold)

Single backend scaffold that runs:

- Mineflayer bot runtime (long-lived)
- prismarine-viewer (web view of what the bot has loaded)
- view-only dashboard (served from `public/`)
- SSE event stream + append-only JSONL log
- Supervisor skeleton (AI SDK) behind a feature flag
- Bot Runner HTTP API (blueprints, build, verify, render)

## Requirements

- Node.js **22+**
- A Java Edition Minecraft server you control (recommended: Paper **1.21.4**)
- Chromium (bundled by puppeteer) for milestone screenshots

## Quick start

1) Install deps

```bash
npm install
```

2) Configure env

```bash
cp .env.example .env
```

3) Start backend

```bash
npm run dev
```

4) Open dashboard

- Dashboard: `http://localhost:8080/`
- Viewer (prismarine-viewer): `http://localhost:3000/`
- Live SSE: `http://localhost:8080/v1/events/stream`
- JSONL event log: `http://localhost:8080/v1/events/log`
- API events: `http://localhost:8080/v1/events`

## Notes

- The viewer renders **only loaded chunks** (what the bot has streamed into `bot.world`).
- For dev, you can run the Minecraft server with `online-mode=false` and set `MC_AUTH=offline`.
- `ASSETS_DIR` stores rendered screenshots (served at `/assets/...`).

## Core API (v1)

- `POST /v1/blueprints/create` → `{ blueprintId }`
- `POST /v1/build/compile` → `ConstructionScript`
- `POST /v1/build/execute` → `{ jobId }`
- `GET /v1/jobs/{jobId}` → job status/result
- `POST /v1/verify/structure` → verification report
- `POST /v1/render/angles` → `{ jobId }` with image URLs in job result
- `POST /v1/control/set-build-zone`, `POST /v1/control/set-budgets`
- `POST /v1/world/ensure-loaded` for chunk residency

