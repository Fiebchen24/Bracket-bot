# Bracket Bot

A multi-server Discord bracket bot for esports events.

## Features

- Runs on multiple Discord servers with one bot instance
- Separate setup per server
- Separate tournament data per server
- 1v1, 2v2, 3v3 and 4v4 formats
- Team registration
- Check-in
- Start bracket
- Report win
- Staff approve win
- DQ team
- Reset bracket

## Important: Multi-server setup

The bot is already built for multiple servers.

It stores data like this:

```json
{
  "SERVER_ID_1": {
    "staffRoleId": "...",
    "bracketChannelId": "...",
    "matchCategoryId": "..."
  },
  "SERVER_ID_2": {
    "staffRoleId": "...",
    "bracketChannelId": "...",
    "matchCategoryId": "..."
  }
}
```

Each server uses its own Discord server ID, so Mask, GT and other servers never mix their settings or brackets.

## Render Environment Variables

Set these in Render:

```env
DISCORD_TOKEN=your_bot_token_here
CLIENT_ID=your_application_client_id_here
```

Do **not** set `GUILD_ID` if you want to use the bot on multiple servers.

Only set `GUILD_ID` when testing commands on one server.

## Render Commands

Build Command:

```bash
npm install && npm run deploy
```

Start Command:

```bash
npm start
```

## Invite Bot to multiple servers

Use an OAuth2 invite link with:

Scopes:

- bot
- applications.commands

Recommended bot permissions:

- Manage Channels
- Send Messages
- Embed Links
- Read Message History
- Manage Roles, only if you later add role features

Invite the same bot to every server where you want to use it.

## First setup on every server

Run this once per server:

```txt
/setupbracket
```

Choose:

- Staff role
- Bracket channel
- Match category

Then create an event:

```txt
/createbracket
```

Choose format:

- 1v1
- 2v2
- 3v3
- 4v4

## Commands

```txt
/setupbracket
/createbracket
/register
/checkin
/startbracket
/reportwin
/approvewin
/dqteam
/bracket
/resetbracket
```
