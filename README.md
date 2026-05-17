# Bracket Bot Pro Dashboard v8.2

Shared PostgreSQL upgrade for Render.

## Render services

### Background Worker
- Build Command: `npm install`
- Start Command: `npm start`
- Env:
  - `SERVICE_MODE=bot`
  - `DISCORD_TOKEN`
  - `CLIENT_ID`
  - `DATABASE_URL`

### Web Service
- Build Command: `npm install`
- Start Command: `npm start`
- Env:
  - `SERVICE_MODE=web`
  - `DISCORD_TOKEN`
  - `CLIENT_ID`
  - `CLIENT_SECRET` or `DISCORD_CLIENT_SECRET`
  - `SESSION_SECRET`
  - `BASE_URL=https://your-service.onrender.com`
  - `DATABASE_URL`

## Important
Create one Render PostgreSQL database and copy the same `DATABASE_URL` to BOTH services. The bot writes tournaments/teams/matches and the dashboard reads the same data.
