# Bracket Bot Pro

Multi-server Discord bracket bot with web dashboard/admin panel.

## Features
- Multi-server settings
- 1v1, 2v2, 3v3, 4v4
- Single Elimination functional
- Double Elimination selectable/prepared with safe fallback note
- Dashboard with Discord login
- Admin panel per guild
- SQLite database
- Slash commands

## Render Setup
Use one **Web Service** for this version because it hosts both the dashboard and bot.

Build command:
```bash
npm install && npm run deploy
```

Start command:
```bash
npm start
```

Env vars:
```env
DISCORD_TOKEN=
CLIENT_ID=
CLIENT_SECRET=
SESSION_SECRET=
BASE_URL=https://YOUR-RENDER-URL.onrender.com
DB_PATH=./data/bracketbot.sqlite
```

Discord Developer Portal OAuth redirect:
```txt
https://YOUR-RENDER-URL.onrender.com/auth/discord/callback
```

Bot invite scopes:
- bot
- applications.commands

Recommended permissions:
- View Channels
- Send Messages
- Embed Links
- Manage Channels
- Manage Roles
- Read Message History

## Commands
- /setupbracket
- /createbracket
- /register
- /startbracket
- /bracket
- /reportwin
- /approvewin
- /dqteam
- /resetbracket

