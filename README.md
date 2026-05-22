# Bracket Bot Pro v8.9.1

## Render setup

Use the same GitHub repo for both services:

### Background Worker
- Build Command: `npm install`
- Start Command: `npm start`
- Env: `SERVICE_MODE=bot`

### Web Service
- Build Command: `npm install`
- Start Command: `npm start`
- Env: `SERVICE_MODE=web`

Both need `DATABASE_URL`.

## Important after this update
Round Robin is a slash-command option. Since the worker normally starts with `npm start`, run command deploy once after uploading this version:

Option A: temporarily set the Background Worker Start Command to `npm run deploy && npm start`, deploy once, then set it back to `npm start`.

Option B: run `npm run deploy` locally with DISCORD_TOKEN and CLIENT_ID.

## v8.9.1
- Round Robin visible in `/createbracket` after slash-command redeploy.
- Round Robin generator + dashboard standings table.
- Dashboard header shows server/channel/role names instead of raw IDs when Discord API can resolve them.
- Bracket connector lines use SVG paths instead of CSS pseudo-lines.
- Player/host dashboard access remains split: players can view, host/staff can manage.
