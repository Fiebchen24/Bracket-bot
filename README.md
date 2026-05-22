# Bracket Bot Pro v8.5 Core Rebuild

## Important Render setup
Use the same GitHub repo for both services, but split modes:

### Background Worker
- Build Command: `npm install`
- Start Command: `npm start`
- Env: `SERVICE_MODE=bot`

### Web Service
- Build Command: `npm install`
- Start Command: `npm start`
- Env: `SERVICE_MODE=web`

Both services need the same `DATABASE_URL` from Render PostgreSQL.

## v8.5 fixes
- Double elimination lower-bracket routing rebuilt
- Winner final loser now drops into the lower final path instead of fake BYEs
- Grand Final and reset final handling improved
- Avoids fake one-player lower-bracket BYE chains
- `[object Object]` player rendering fixed by normalizing player entries
- `/unreg` retained
- Match channels continue to be created for newly generated matches
