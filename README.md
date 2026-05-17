# Bracket Bot Pro v8

Multi-server / multi-tournament Discord bracket bot with dashboard.

## v8 highlights

- Discord-first registration: no team name required.
  - 1v1: player 1 display name becomes the team name.
  - 2v2/3v3/4v4: player 1 display name becomes the team name.
- Optional registration role per tournament. The bot assigns it to all registered players.
- Optional role cleanup when ending/resetting the tournament.
- Flexible channels per tournament: signup, bracket, optional check-in, match category.
- Optional check-in requirement.
- Optional auto match text channels and voice channels.
- Single Elimination engine.
- Double Elimination engine with Winner Bracket, Loser Bracket, and Grand Final routing.
- Dashboard with dynamic graphical bracket tree.
- Dashboard admin controls: start, force win, approve reported win, edit/remove teams, end tournament.

## Render

Use Node 20.x. This is already pinned in package.json.

### Worker / Bot

Build command:

```txt
npm install && npm run deploy
```

Start command:

```txt
npm start
```

### Web Service / Dashboard

Build command:

```txt
npm install
```

Start command:

```txt
npm start
```

## Env vars

```env
DISCORD_TOKEN=your_bot_token
CLIENT_ID=your_application_id
CLIENT_SECRET=your_oauth_client_secret
BASE_URL=https://your-render-web-service.onrender.com
SESSION_SECRET=make_this_long_and_random
```

Also add this redirect URL in Discord Developer Portal > OAuth2:

```txt
https://your-render-web-service.onrender.com/auth/discord/callback
```

## Commands

- `/createbracket`
- `/register`
- `/checkin`
- `/startbracket`
- `/bracket`
- `/reportwin`
- `/approvewin`
- `/forcematchwin`
- `/dqteam`
- `/teamlist`
- `/tournaments`
- `/togglecheckin`
- `/resetbracket`

